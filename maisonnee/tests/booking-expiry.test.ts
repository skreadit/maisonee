import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { GET, POST } from '../src/app/api/route';
import { query, transaction } from '../src/lib/db';
import { expireBookingHolds, holdHours } from '../src/lib/booking-expiry';
import { createCheckout, processStripeEvent, verifyStripeWebhook } from '../src/lib/payments';

const origin = 'http://localhost:3000';
let client = '', chef = '', day = 8;
async function post(body: Record<string, unknown>, cookie = client) {
  const response = await POST(new Request(`${origin}/api`, { method: 'POST', headers: { origin, 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }));
  return { response, data: await response.json() };
}
async function bootstrap() { const response = await GET(new Request(`${origin}/api`, { headers: { cookie: client } })); expect(response.status).toBe(200); return response.json(); }
async function request(date = new Date(Date.now() + day++ * 86400000).toISOString().slice(0, 10)) {
  const payload = { action: 'createBooking', chefId: 'chef-gabriel', menuId: 'menu-chef-gabriel', date, guests: 4, address: '10 rue de la Paix, 75002 Paris', idempotencyKey: `expiry-${crypto.randomUUID()}` };
  const result = await post(payload); expect(result.response.status).toBe(201);
  return { id: result.data.bookingId as string, payload };
}
async function status(id: string) { return (await query<{ status: string; payment_status: string }>('SELECT status,payment_status FROM bookings WHERE id=$1', [id]))[0]; }
async function accept(id: string) { expect((await post({ action: 'transitionBooking', bookingId: id, status: 'ACCEPTED' }, chef)).response.status).toBe(200); }
async function elapsed(id: string) { await query("UPDATE bookings SET request_expires_at=now()-interval '1 minute',payment_expires_at=now()-interval '1 minute' WHERE id=$1", [id]); }
async function attempt(id: string, state: string) {
  const attemptId = `attempt-${id}`;
  await query(`INSERT INTO payment_attempts(id,booking_id,amount_cents,commission_cents,currency,stripe_account_id,state,expires_at) SELECT $1,id,total_cents,commission_cents,'eur','acct_fixture',$3,now()-interval '1 minute' FROM bookings WHERE id=$2`, [attemptId, id, state]);
  return attemptId;
}

beforeAll(async () => {
  process.env.APP_MODE = 'demo'; process.env.PGLITE_DATA_DIR = 'memory://'; process.env.APP_URL = origin; delete process.env.DATABASE_URL;
  for (const email of ['client@maisonnee.demo', 'chef@maisonnee.demo']) {
    const result = await post({ action: 'login', email, password: 'DemoMaisonnee2026!' }, ''); expect(result.response.status).toBe(200);
    const cookie = result.response.headers.get('set-cookie')!.split(';')[0]; if (email.startsWith('client')) client = cookie; else chef = cookie;
  }
});
afterEach(() => vi.unstubAllEnvs());

describe('unpaid booking hold deadlines', () => {
  it('uses bounded configurable pilot timeouts', () => {
    vi.stubEnv('REQUEST_TTL_HOURS', undefined); vi.stubEnv('PAYMENT_TTL_HOURS', undefined);
    expect(holdHours('request')).toBe(24); expect(holdHours('payment')).toBe(24);
    vi.stubEnv('REQUEST_TTL_HOURS', '6'); expect(holdHours('request')).toBe(6);
    for (const invalid of ['', '0', '169', '1.5', 'NaN']) { vi.stubEnv('PAYMENT_TTL_HOURS', invalid); expect(() => holdHours('payment')).toThrow(); }
  });

  it('records request expiry and releases an elapsed request exactly once on bootstrap', async () => {
    vi.stubEnv('REQUEST_TTL_HOURS', '2'); const b = await request();
    const [row] = await query<{ hours: number; payment_expires_at: unknown }>('SELECT EXTRACT(EPOCH FROM(request_expires_at-created_at))::float8/3600 AS hours,payment_expires_at FROM bookings WHERE id=$1', [b.id]);
    expect(row.hours).toBe(2); expect(row.payment_expires_at).toBeNull();
    await elapsed(b.id); await Promise.all([bootstrap(), bootstrap()]);
    expect((await status(b.id)).status).toBe('EXPIRED');
    expect(await query("SELECT id FROM booking_status_history WHERE booking_id=$1 AND status='EXPIRED'", [b.id])).toHaveLength(1);
    expect(await query("SELECT id FROM audit_logs WHERE resource_id=$1 AND action='BOOKING_EXPIRED'", [b.id])).toHaveLength(1);
    expect((await bootstrap()).chefs.find((c: { id: string }) => c.id === 'chef-gabriel').availability).toContain(b.payload.date);
  });

  it('releases an elapsed request before a replacement booking without needing a prior page load', async () => {
    const b = await request(); await elapsed(b.id);
    const replacement = await post({ ...b.payload, idempotencyKey: `replacement-${b.id}` });
    expect(replacement.response.status).toBe(201); expect(replacement.data.bookingId).not.toBe(b.id);
    expect((await status(b.id)).status).toBe('EXPIRED');
  });

  it('starts a separate payment deadline at acceptance', async () => {
    vi.stubEnv('PAYMENT_TTL_HOURS', '3'); const b = await request(); await accept(b.id);
    const [row] = await query<{ hours: number }>('SELECT EXTRACT(EPOCH FROM(payment_expires_at-updated_at))::float8/3600 AS hours FROM bookings WHERE id=$1', [b.id]);
    expect(row.hours).toBe(3);
    await query("UPDATE bookings SET request_expires_at=now()-interval '1 minute' WHERE id=$1", [b.id]);
    await bootstrap(); expect((await status(b.id)).status).toBe('ACCEPTED');
    await elapsed(b.id); await bootstrap(); expect((await status(b.id)).status).toBe('EXPIRED');
  });

  it('caps both deadlines before the Paris service date', async () => {
    vi.stubEnv('REQUEST_TTL_HOURS', '168'); vi.stubEnv('PAYMENT_TTL_HOURS', '168');
    const b = await request(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)); await accept(b.id);
    const [row] = await query<{ request_capped: boolean; payment_capped: boolean }>("SELECT request_expires_at=(date::date::timestamp AT TIME ZONE 'Europe/Paris') AS request_capped,payment_expires_at=(date::date::timestamp AT TIME ZONE 'Europe/Paris') AS payment_capped FROM bookings WHERE id=$1", [b.id]);
    expect(row).toEqual({ request_capped: true, payment_capped: true });
  });

  it('rejects acceptance of elapsed and past-dated requests', async () => {
    const timedOut = await request(); await elapsed(timedOut.id);
    expect((await post({ action: 'transitionBooking', bookingId: timedOut.id, status: 'ACCEPTED' }, chef)).response.status).toBe(409);
    const past = await request(); await query("UPDATE bookings SET date='2000-01-01' WHERE id=$1", [past.id]);
    expect((await post({ action: 'transitionBooking', bookingId: past.id, status: 'ACCEPTED' }, chef)).response.status).toBe(409);
    expect((await status(past.id)).status).toBe('EXPIRED');
  });

  it('keeps an outstanding failed Stripe attempt held until signed session expiry', async () => {
    const b = await request(); await accept(b.id); await elapsed(b.id); const attemptId = await attempt(b.id, 'PENDING');
    await query("UPDATE bookings SET payment_status='FAILED' WHERE id=$1", [b.id]);
    await bootstrap(); expect((await status(b.id)).status).toBe('ACCEPTED');
    const secret = 'whsec_expiry_local_fixture'; const stripe = new Stripe('sk_test_local_fixture_only');
    const raw = JSON.stringify({ id: `evt-${b.id}`, object: 'event', created: Math.floor(Date.now() / 1000), livemode: false, type: 'checkout.session.expired', data: { object: { id: `cs-${b.id}`, object: 'checkout.session', livemode: false, amount_total: 27600, currency: 'eur', metadata: { paymentId: attemptId, bookingId: b.id }, payment_intent: null } } });
    await processStripeEvent(verifyStripeWebhook(raw, stripe.webhooks.generateTestHeaderString({ payload: raw, secret }), secret));
    expect(await status(b.id)).toEqual({ status: 'EXPIRED', payment_status: 'UNPAID' });
  });

  it('never infers expiration for CREATED, paid, or pending payment states', async () => {
    for (const payment of ['UNPAID', 'PENDING', 'PAID']) {
      const b = await request(); await accept(b.id); await elapsed(b.id);
      await query('UPDATE bookings SET payment_status=$2 WHERE id=$1', [b.id, payment]);
      if (payment === 'UNPAID') await attempt(b.id, 'CREATED');
      await transaction(tx => expireBookingHolds(tx, { bookingId: b.id }));
      expect((await status(b.id)).status).toBe('ACCEPTED');
    }
  });

  it('cleans an elapsed unpaid reservation before starting checkout and never calls Stripe', async () => {
    const b = await request(); await accept(b.id); await elapsed(b.id);
    vi.stubEnv('STRIPE_SECRET_KEY', undefined);
    await expect(createCheckout({ id: 'demo-client', email: 'client@maisonnee.demo', role: 'CLIENT' }, b.id)).rejects.toMatchObject({ status: 503 });
    expect((await status(b.id)).status).toBe('EXPIRED');
  });
});

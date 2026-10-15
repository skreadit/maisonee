import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import Stripe from 'stripe';
import { assertCheckoutPermission, paymentConfiguration, processStripeEvent, requestFullRefund, requireTestStripeKey, trustedAppUrl, validateFrozenAmounts, verifyStripeWebhook } from '../src/lib/payments';
import type { DbClient } from '../src/lib/db';

const db = new PGlite();
const secret = 'whsec_local_test_fixture_only';
const signing = new Stripe('sk_test_local_test_fixture_only');
const now = Math.floor(Date.now() / 1000);
const tx = <T>(fn: (tx: DbClient) => Promise<T>) => db.transaction(async p => fn({ query: async <R>(sql: string, params: unknown[] = []) => (await p.query<R>(sql, params)).rows }));
const actor = { id: 'client', email: 'client@example.test', role: 'CLIENT' };
const intent = (overrides: Record<string, unknown> = {}) => ({ id: 'pi_fixture', object: 'payment_intent', livemode: false, amount: 42000, amount_received: 42000, application_fee_amount: 4000, currency: 'eur', metadata: { bookingId: 'booking', paymentId: 'attempt' }, transfer_data: { destination: 'acct_fixture' }, status: 'succeeded', ...overrides });
function signed(type: string, object: unknown, id = 'evt_fixture', created = now) {
  const raw = JSON.stringify({ id, object: 'event', api_version: '2026-09-30.endive', created, livemode: false, pending_webhooks: 1, request: null, type, data: { object } });
  const header = signing.webhooks.generateTestHeaderString({ payload: raw, secret });
  return verifyStripeWebhook(raw, header, secret);
}
async function booking() { return (await db.query<{ status: string; payment_status: string }>('SELECT status,payment_status FROM bookings WHERE id=$1', ['booking'])).rows[0]; }

beforeAll(async () => {
  await db.waitReady;
  await db.exec(await readFile('migrations/001_initial.sql', 'utf8'));
  await db.exec(await readFile('migrations/002_payments.sql', 'utf8'));
  await db.exec(await readFile('migrations/003_booking_expiry.sql', 'utf8'));
});
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec("TRUNCATE users,chef_profiles,menus,commission_rules,bookings,payment_attempts,payment_events,refunds,booking_status_history,notifications CASCADE");
  await db.exec(`INSERT INTO users(id,email,name,password_hash,role) VALUES ('client','client@example.test','Client','not-used','CLIENT'),('chef','chef@example.test','Chef','not-used','CHEF');
    INSERT INTO chef_profiles(id,user_id,slug,name,city,cuisine,bio,stripe_account_id,stripe_ready) VALUES('chef-profile','chef','chef-fixture','Chef','Paris','France','Fixture','acct_fixture',true);
    INSERT INTO menus(id,chef_id,name,description,starter,main,dessert,price_per_person,min_guests,max_guests) VALUES('menu','chef-profile','Menu','Fixture','Entrée','Plat','Dessert',10000,2,8);
    INSERT INTO commission_rules(id,basis_points) VALUES('rule',1000);
    INSERT INTO bookings(id,chef_id,client_id,menu_id,date,guests,menu_name,menu_snapshot,commission_rule_id,commission_basis_points,total_cents,commission_cents,chef_net_cents,travel_cents,status,payment_status,payment_expires_at,address,idempotency_key) VALUES('booking','chef-profile','client','menu','2027-01-01',4,'Menu','{}','rule',1000,42000,4000,38000,2000,'ACCEPTED','PENDING',now()+interval '1 day','Fixture','fixture');
    INSERT INTO payment_attempts(id,booking_id,amount_cents,commission_cents,currency,stripe_account_id,state,expires_at) VALUES('attempt','booking',42000,4000,'eur','acct_fixture','PENDING',now()+interval '1 day');`);
});

describe('payment guards', () => {
  it('refuses live and missing keys; validates trusted redirect origins', () => {
    expect(() => requireTestStripeKey('sk_live_forbidden')).toThrow();
    expect(() => requireTestStripeKey('')).toThrow();
    expect(requireTestStripeKey('sk_test_fixture')).toBe('sk_test_fixture');
    expect(() => trustedAppUrl('http://attacker.example')).toThrow();
    expect(() => trustedAppUrl('https://user:pass@example.test')).toThrow();
    expect(trustedAppUrl('http://localhost:3000/anything')).toBe('http://localhost:3000');
    expect(paymentConfiguration({})).toMatchObject({ configured: false, liveEnabled: false, refundsEnabled: false });
  });
  it('uses immutable service-only commission in integer cents', () => {
    expect(() => validateFrozenAmounts(42000, 4000, 'EUR', 2000, 1000)).not.toThrow();
    expect(() => validateFrozenAmounts(42000, 1, 'EUR', 2000, 1000)).toThrow();
    expect(() => validateFrozenAmounts(42000.01, 4000, 'EUR')).toThrow();
    expect(() => validateFrozenAmounts(42000, 4200, 'usd')).toThrow();
  });
  it('requires the owning client and an accepted unexpired booking', () => {
    const b = { client_id: 'client', date: '2099-01-01', status: 'ACCEPTED', payment_status: 'UNPAID', payment_expires_at: null };
    expect(() => assertCheckoutPermission(b, actor)).not.toThrow();
    expect(() => assertCheckoutPermission(b, { ...actor, id: 'other' })).toThrow();
    expect(() => assertCheckoutPermission(b, { ...actor, role: 'CHEF' })).not.toThrow();
    expect(() => assertCheckoutPermission({ ...b, status: 'REQUESTED' }, actor)).toThrow();
    expect(() => assertCheckoutPermission({ ...b, payment_status: 'PAID' }, actor)).toThrow();
    expect(() => assertCheckoutPermission({ ...b, payment_expires_at: '2020-01-01' }, actor)).toThrow();
    expect(() => assertCheckoutPermission({ ...b, date: '2020-01-01' }, actor)).toThrow();
  });
  it('requires an administrator and a configured refund policy', async () => {
    await expect(requestFullRefund(actor, 'booking', 'Customer request')).rejects.toMatchObject({ status: 403 });
    await expect(requestFullRefund({ ...actor, role: 'ADMIN' }, 'booking', 'Customer request')).rejects.toMatchObject({ status: 503 });
  });
});

describe('signed webhook transactions (local fixtures, no external Stripe calls)', () => {
  it('rejects invalid, modified, expired signatures and real-mode events', () => {
    expect(() => verifyStripeWebhook('{}', 'invalid', secret)).toThrow();
    const raw = JSON.stringify({ livemode: false });
    const header = signing.webhooks.generateTestHeaderString({ payload: raw, secret });
    expect(() => verifyStripeWebhook(raw + ' ', header, secret)).toThrow();
    const old = signing.webhooks.generateTestHeaderString({ payload: raw, secret, timestamp: now - 600 });
    expect(() => verifyStripeWebhook(raw, old, secret)).toThrow();
    const live = JSON.stringify({ livemode: true });
    expect(() => verifyStripeWebhook(live, signing.webhooks.generateTestHeaderString({ payload: live, secret }), secret)).toThrow();
  });
  it('commits a success once and deduplicates simultaneous delivery', async () => {
    const event = signed('payment_intent.succeeded', intent());
    const results = await Promise.all([processStripeEvent(event, tx), processStripeEvent(event, tx)]);
    expect(results.filter(r => r.duplicate)).toHaveLength(1);
    expect(await booking()).toEqual({ status: 'CONFIRMED', payment_status: 'PAID' });
    expect((await db.query('SELECT * FROM booking_status_history')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM notifications')).rows).toHaveLength(1);
  });
  it.each([
    { amount: 1 }, { amount_received: 1 }, { currency: 'usd' }, { application_fee_amount: 1 },
    { transfer_data: { destination: 'acct_intruder' } }, { metadata: { paymentId: 'attempt', bookingId: 'intruder' } },
  ])('rolls back an inconsistent financial event: %j', async override => {
    await expect(processStripeEvent(signed('payment_intent.succeeded', intent(override)), tx)).rejects.toMatchObject({ status: 409 });
    expect(await booking()).toEqual({ status: 'ACCEPTED', payment_status: 'PENDING' });
    expect((await db.query('SELECT * FROM payment_events')).rows).toHaveLength(0);
  });
  it('does not attach a different intent to an existing payment', async () => {
    await db.query("UPDATE payment_attempts SET payment_intent_id='pi_original'");
    await expect(processStripeEvent(signed('payment_intent.succeeded', intent()), tx)).rejects.toThrow();
  });
  it('records a late payment without resurrecting a canceled booking', async () => {
    await db.query("UPDATE bookings SET status='CANCELLED'");
    expect(await processStripeEvent(signed('payment_intent.succeeded', intent()), tx)).toMatchObject({ outcome: 'PAID_REQUIRES_REVIEW' });
    expect(await booking()).toEqual({ status: 'CANCELLED', payment_status: 'PAID' });
  });
  it('does not confirm an expired payment window', async () => {
    await db.query("UPDATE bookings SET payment_expires_at=now()-interval '1 hour'");
    await processStripeEvent(signed('payment_intent.succeeded', intent()), tx);
    expect(await booking()).toEqual({ status: 'ACCEPTED', payment_status: 'PAID' });
    expect((await db.query("SELECT state FROM payment_attempts")).rows[0]).toEqual({ state: 'REVIEW' });
  });
  it('never marks paid from a Checkout completion alone', async () => {
    await processStripeEvent(signed('checkout.session.completed', { id: 'cs_fixture', object: 'checkout.session', livemode: false, amount_total: 42000, currency: 'eur', metadata: { bookingId: 'booking', paymentId: 'attempt' }, payment_intent: 'pi_fixture' }), tx);
    expect(await booking()).toEqual({ status: 'ACCEPTED', payment_status: 'PENDING' });
  });
  it('records failure then success, and ignores a late failure after success', async () => {
    const failure = intent({ status: 'requires_payment_method', amount_received: 0 });
    await processStripeEvent(signed('payment_intent.payment_failed', failure, 'evt_failed'), tx);
    expect((await booking()).payment_status).toBe('FAILED');
    await processStripeEvent(signed('payment_intent.succeeded', intent(), 'evt_succeeded'), tx);
    await processStripeEvent(signed('payment_intent.payment_failed', failure, 'evt_failed_late', now - 10), tx);
    expect(await booking()).toEqual({ status: 'CONFIRMED', payment_status: 'PAID' });
  });
  it('preserves a full refund when older success or partial refund arrives later', async () => {
    const charge = { id: 'ch_fixture', object: 'charge', livemode: false, payment_intent: 'pi_fixture', amount: 42000, amount_refunded: 42000, currency: 'eur', metadata: { bookingId: 'booking', paymentId: 'attempt' } };
    await processStripeEvent(signed('charge.refunded', charge, 'evt_refunded'), tx);
    await processStripeEvent(signed('payment_intent.succeeded', intent(), 'evt_late_success'), tx);
    await processStripeEvent(signed('charge.refunded', { ...charge, amount_refunded: 5000 }, 'evt_late_partial'), tx);
    expect((await booking()).payment_status).toBe('REFUNDED');
  });
  it('never re-enables an account using an older readiness event', async () => {
    const account = { id: 'acct_fixture', object: 'account', charges_enabled: true, payouts_enabled: true, details_submitted: true, capabilities: { transfers: 'active' }, requirements: {} };
    await processStripeEvent(signed('account.updated', { ...account, charges_enabled: false }, 'evt_revoked', now), tx);
    await processStripeEvent(signed('account.updated', account, 'evt_stale_ready', now - 10), tx);
    expect((await db.query('SELECT stripe_ready FROM chef_profiles')).rows[0]).toEqual({ stripe_ready: false });
  });
});

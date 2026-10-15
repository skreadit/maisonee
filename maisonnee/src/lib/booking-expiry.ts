import { randomUUID } from 'node:crypto';
import type { DbClient } from './db';
import { AppError, parisDate } from './domain';

/** Technical pilot holds, independent of any cancellation/refund policy. */
export function holdHours(kind: 'request' | 'payment'): number {
  const key = kind === 'request' ? 'REQUEST_TTL_HOURS' : 'PAYMENT_TTL_HOURS';
  const raw = process.env[key] ?? '24';
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 168) throw new AppError(503, `${key} doit être un nombre entier entre 1 et 168 heures.`);
  return Number(raw);
}

/** Caller owns the transaction. No Stripe attempt is inferred expired from local time. */
export async function expireBookingHolds(tx: DbClient, scope: { chefId?: string; bookingId?: string } = {}): Promise<string[]> {
  const candidates = await tx.query<{ id: string; client_id: string; chef_user_id: string; status: string; date: string }>(`
    SELECT b.id,b.client_id,c.user_id AS chef_user_id,b.status,b.date
    FROM bookings b JOIN chef_profiles c ON c.id=b.chef_id
    WHERE b.status IN ('REQUESTED','ACCEPTED') AND b.payment_status IN ('UNPAID','FAILED')
      AND (b.date<=$1 OR (b.status='REQUESTED' AND b.request_expires_at<=now()) OR (b.status='ACCEPTED' AND b.payment_expires_at<=now()))
      AND ($2::text IS NULL OR b.chef_id=$2) AND ($3::text IS NULL OR b.id=$3)
    ORDER BY b.id FOR UPDATE OF b`, [parisDate(), scope.chefId ?? null, scope.bookingId ?? null]);
  const expired: string[] = [];
  for (const booking of candidates) {
    // Re-read after the booking lock: Checkout may have created an attempt while we waited.
    // Only a signed Checkout expiry can make an external attempt releasable.
    if ((await tx.query("SELECT id FROM payment_attempts WHERE booking_id=$1 AND state<>'EXPIRED' LIMIT 1", [booking.id])).length) continue;
    await tx.query("UPDATE bookings SET status='EXPIRED',updated_at=now() WHERE id=$1", [booking.id]);
    await tx.query("INSERT INTO booking_status_history(id,booking_id,status) VALUES($1,$2,'EXPIRED')", [randomUUID(), booking.id]);
    await tx.query("INSERT INTO audit_logs(id,action,resource_type,resource_id,metadata) VALUES($1,'BOOKING_EXPIRED','booking',$2,$3)", [randomUUID(), booking.id, JSON.stringify({ from: booking.status, reason: 'UNPAID_HOLD_DEADLINE' })]);
    for (const userId of [booking.client_id, booking.chef_user_id]) await tx.query('INSERT INTO notifications(id,user_id,title,body) VALUES($1,$2,$3,$4)', [randomUUID(), userId, 'Demande expirée', `Le délai de la réservation du ${booking.date} est dépassé. Aucun paiement n’a été encaissé et le créneau est libéré.`]);
    expired.push(booking.id);
  }
  return expired;
}

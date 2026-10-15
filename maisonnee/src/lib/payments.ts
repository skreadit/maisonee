import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { query, transaction, type DbClient } from './db';
import { expireBookingHolds } from './booking-expiry';
import { parisDate } from './domain';

export class PaymentError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
type Actor = { id: string; email: string; role: string };
type Booking = { id: string; client_id: string; chef_id: string; date: string; menu_name: string; total_cents: number; commission_cents: number; commission_basis_points: number; travel_cents: number; currency: string; status: string; payment_status: string; payment_expires_at: string | null; stripe_account_id: string | null; stripe_ready: boolean };
type Attempt = { id: string; booking_id: string; checkout_session_id: string | null; payment_intent_id: string | null; amount_cents: number; commission_cents: number; currency: string; stripe_account_id: string; state: string; refunded_cents: number; checkout_url: string | null; created_at: string; expires_at: string };
const terminalPayments = new Set(['SUCCEEDED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'REVIEW']);

export function paymentConfiguration(env: Record<string, string | undefined> = process.env) {
  return { mode: 'test' as const, configured: !!env.STRIPE_SECRET_KEY?.startsWith('sk_test_') && !!env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_') && !!env.APP_URL, liveEnabled: false, refundsEnabled: env.REFUND_POLICY_MODE === 'manual_admin_review' && !!env.REFUND_POLICY_VERSION };
}
export function requireTestStripeKey(key = process.env.STRIPE_SECRET_KEY): string {
  if (!key?.startsWith('sk_test_')) throw new PaymentError(503, 'Les paiements de test ne sont pas configurés. Les clés de production sont interdites.');
  return key;
}
function stripeClient() { return new Stripe(requireTestStripeKey(), { maxNetworkRetries: 2, timeout: 15000 }); }
export function trustedAppUrl(raw = process.env.APP_URL): string {
  if (!raw) throw new PaymentError(503, 'L’adresse du service de paiement reste à configurer.');
  let url: URL;
  try { url = new URL(raw); } catch { throw new PaymentError(503, 'Adresse du service incorrecte.'); }
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new PaymentError(503, 'Une adresse HTTPS est requise.');
  return url.origin;
}
export function validateFrozenAmounts(amount: number, commission: number, currency: string, travel = 0, basisPoints = 1000) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(travel) || travel < 0 || travel >= amount || !Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 5000 || !Number.isSafeInteger(commission) || commission !== Math.round((amount - travel) * basisPoints / 10000) || currency.toLowerCase() !== 'eur') throw new PaymentError(409, 'Le montant enregistré doit être vérifié par le support.');
}
export function assertCheckoutPermission(booking: Pick<Booking, 'client_id' | 'date' | 'status' | 'payment_status' | 'payment_expires_at'>, actor: Actor) {
  if (actor.id !== booking.client_id) throw new PaymentError(403, 'Cette réservation ne vous appartient pas.');
  if (booking.status !== 'ACCEPTED' || ['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(booking.payment_status)) throw new PaymentError(409, 'Cette réservation ne peut pas être payée.');
  if (booking.date <= parisDate()) throw new PaymentError(409, 'La date de cette réservation est dépassée.');
  if (booking.payment_expires_at && new Date(booking.payment_expires_at).getTime() <= Date.now()) throw new PaymentError(409, 'Le délai de paiement est expiré.');
}

export async function createCheckout(actor: Actor, bookingId: string) {
  await transaction(tx => expireBookingHolds(tx, { bookingId }));
  const stripe = stripeClient();
  const origin = trustedAppUrl();
  if (!process.env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) throw new PaymentError(503, 'La confirmation sécurisée des paiements reste à configurer.');
  const { booking, attempt } = await transaction(async tx => {
    const [booking] = await tx.query<Booking>('SELECT b.*, c.stripe_account_id, c.stripe_ready FROM bookings b JOIN chef_profiles c ON c.id=b.chef_id WHERE b.id=$1 FOR UPDATE OF b', [bookingId]);
    if (!booking) throw new PaymentError(404, 'Réservation introuvable.');
    assertCheckoutPermission(booking, actor);
    validateFrozenAmounts(booking.total_cents, booking.commission_cents, booking.currency, booking.travel_cents, booking.commission_basis_points);
    if (!booking.stripe_account_id || !booking.stripe_ready) throw new PaymentError(409, 'Le chef doit terminer la vérification de son compte de paiement.');
    const [existing] = await tx.query<Attempt>('SELECT * FROM payment_attempts WHERE booking_id=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE', [bookingId]);
    if (existing && existing.state !== 'EXPIRED') return { booking, attempt: existing };
    const expiresAt = Math.min(Date.now() + 23 * 60 * 60 * 1000, booking.payment_expires_at ? new Date(booking.payment_expires_at).getTime() : Infinity);
    if (expiresAt < Date.now() + 31 * 60 * 1000) throw new PaymentError(409, 'Le délai restant est trop court. Contactez le support.');
    const [attempt] = await tx.query<Attempt>(`INSERT INTO payment_attempts (id,booking_id,amount_cents,commission_cents,currency,stripe_account_id,state,expires_at) VALUES ($1,$2,$3,$4,$5,$6,'CREATED',$7) RETURNING *`, [randomUUID(), bookingId, booking.total_cents, booking.commission_cents, booking.currency.toLowerCase(), booking.stripe_account_id, new Date(expiresAt).toISOString()]);
    await tx.query("UPDATE bookings SET payment_status='PENDING' WHERE id=$1", [bookingId]);
    return { booking, attempt };
  });
  if (terminalPayments.has(attempt.state)) throw new PaymentError(409, 'Le paiement de cette réservation est déjà traité.');
  // Never replay an unbound creation after Stripe's 24-hour idempotency retention window.
  if (!attempt.checkout_session_id && Date.now() - new Date(attempt.created_at).getTime() > 23 * 60 * 60 * 1000) throw new PaymentError(409, 'Ce paiement nécessite une vérification du support avant toute nouvelle tentative.');
  const session = attempt.checkout_session_id
    ? await stripe.checkout.sessions.retrieve(attempt.checkout_session_id)
    : await stripe.checkout.sessions.create({
      mode: 'payment', allowed_payment_method_types: ['card'], locale: 'fr', client_reference_id: booking.id,
      metadata: { bookingId: booking.id, paymentId: attempt.id },
      line_items: [{ quantity: 1, price_data: { currency: attempt.currency, unit_amount: attempt.amount_cents, product_data: { name: booking.menu_name } } }],
      payment_intent_data: { application_fee_amount: attempt.commission_cents, transfer_data: { destination: attempt.stripe_account_id }, metadata: { bookingId: booking.id, paymentId: attempt.id } },
      success_url: `${origin}/espace/reservations?paiement=retour`, cancel_url: `${origin}/espace/reservations?paiement=interrompu`, expires_at: Math.floor(new Date(attempt.expires_at).getTime() / 1000),
    }, { idempotencyKey: `checkout:${attempt.id}` });
  if (session.livemode) throw new PaymentError(503, 'Un paiement de production a été bloqué.');
  if (session.status !== 'open' || !session.url) throw new PaymentError(409, 'La session de paiement est terminée. Actualisez votre réservation.');
  const stillAccepted = await transaction(async tx => {
    const [current] = await tx.query<Booking>('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [booking.id]);
    const intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
    await tx.query("UPDATE payment_attempts SET checkout_session_id=$2,checkout_url=$3,payment_intent_id=COALESCE(payment_intent_id,$4),state=CASE WHEN state='CREATED' THEN 'PENDING' ELSE state END,updated_at=NOW() WHERE id=$1", [attempt.id, session.id, session.url, intent]);
    await tx.query('UPDATE bookings SET stripe_checkout_session_id=$2,stripe_payment_intent_id=COALESCE(stripe_payment_intent_id,$3) WHERE id=$1', [booking.id, session.id, intent]);
    return current?.status === 'ACCEPTED' && (!current.payment_expires_at || new Date(current.payment_expires_at).getTime() > Date.now());
  });
  if (!stillAccepted) {
    await stripe.checkout.sessions.expire(session.id);
    throw new PaymentError(409, 'La réservation a changé pendant la création du paiement.');
  }
  return { url: session.url, mode: 'test' };
}

export async function startConnect(actor: Actor) {
  if (actor.role !== 'CHEF') throw new PaymentError(403, 'Cet espace est réservé aux chefs.');
  const stripe = stripeClient();
  const origin = trustedAppUrl();
  const [chef] = await query<{ id: string; stripe_account_id: string | null }>('SELECT id,stripe_account_id FROM chef_profiles WHERE user_id=$1', [actor.id]);
  if (!chef) throw new PaymentError(409, 'Créez d’abord votre profil chef.');
  let accountId = chef.stripe_account_id;
  if (!accountId) {
    const account = await stripe.accounts.create({ country: 'FR', email: actor.email, controller: { stripe_dashboard: { type: 'express' }, fees: { payer: 'application' }, losses: { payments: 'application' }, requirement_collection: 'stripe' }, capabilities: { card_payments: { requested: true }, transfers: { requested: true } }, metadata: { chefId: chef.id } }, { idempotencyKey: `chef-connect:${chef.id}` });
    accountId = account.id;
    await query('UPDATE chef_profiles SET stripe_account_id=$2,stripe_ready=false WHERE id=$1 AND stripe_account_id IS NULL', [chef.id, accountId]);
  }
  const link = await stripe.accountLinks.create({ account: accountId, type: 'account_onboarding', return_url: `${origin}/espace/chef?connect=retour`, refresh_url: `${origin}/espace/chef?connect=renouveler` });
  return { url: link.url, mode: 'test' };
}

export function verifyStripeWebhook(raw: string, signature: string | null, secret = process.env.STRIPE_WEBHOOK_SECRET): Stripe.Event {
  if (!secret?.startsWith('whsec_')) throw new PaymentError(503, 'Les notifications de paiement ne sont pas configurées.');
  if (!signature) throw new PaymentError(400, 'Signature absente.');
  let event: Stripe.Event;
  try { event = new Stripe('sk_test_signature_verification_only').webhooks.constructEvent(raw, signature, secret); }
  catch { throw new PaymentError(400, 'Signature de paiement invalide.'); }
  if (event.livemode !== false) throw new PaymentError(400, 'Les événements de production sont interdits.');
  return event;
}

function stripeId(value: unknown): string | null {
  return typeof value === 'string' ? value : value && typeof value === 'object' && 'id' in value ? String(value.id) : null;
}
async function lockAttempt(tx: DbClient, id: string): Promise<Attempt | undefined> {
  const [candidate] = await tx.query<Attempt>('SELECT * FROM payment_attempts WHERE id=$1', [id]);
  if (!candidate) return undefined;
  // Checkout and webhooks acquire their locks in the same order.
  await tx.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE', [candidate.booking_id]);
  const [locked] = await tx.query<Attempt>('SELECT * FROM payment_attempts WHERE id=$1 FOR UPDATE', [id]);
  return locked;
}
export function verifyIntent(intent: Stripe.PaymentIntent, attempt: Pick<Attempt, 'id' | 'booking_id' | 'amount_cents' | 'commission_cents' | 'currency' | 'stripe_account_id' | 'payment_intent_id'>) {
  if (intent.livemode || intent.metadata?.bookingId !== attempt.booking_id || intent.metadata?.paymentId !== attempt.id || intent.amount !== attempt.amount_cents || intent.currency !== attempt.currency || intent.application_fee_amount !== attempt.commission_cents || stripeId(intent.transfer_data?.destination) !== attempt.stripe_account_id || (attempt.payment_intent_id && attempt.payment_intent_id !== intent.id)) throw new PaymentError(409, 'Événement incohérent avec le paiement enregistré.');
}

/** Only verified signed events may be passed here; exported to test the durable transaction. */
export async function processStripeEvent(event: Stripe.Event, runTransaction: typeof transaction = transaction) {
  if (event.livemode !== false) throw new PaymentError(400, 'Événement réel interdit.');
  return runTransaction(async tx => {
    const inserted = await tx.query<{ id: string }>("INSERT INTO payment_events(id,type,outcome) VALUES($1,$2,'RECEIVED') ON CONFLICT(id) DO NOTHING RETURNING id", [event.id, event.type]);
    if (!inserted.length) return { received: true, duplicate: true };
    let outcome = 'IGNORED';
    if (event.type === 'account.updated') {
      const account = event.data.object as Stripe.Account;
      if (event.account && event.account !== account.id) throw new PaymentError(409, 'Compte Stripe incohérent.');
      const ready = account.charges_enabled && account.payouts_enabled && account.details_submitted && account.capabilities?.transfers === 'active' && !account.requirements?.disabled_reason;
      await tx.query('UPDATE chef_profiles SET stripe_ready=$2,stripe_event_created=$3 WHERE stripe_account_id=$1 AND (stripe_event_created<$3 OR (stripe_event_created=$3 AND $2=false))', [account.id, !!ready, event.created]);
      outcome = 'ACCOUNT_UPDATED';
    } else if (event.type.startsWith('payment_intent.')) {
      const intent = event.data.object as Stripe.PaymentIntent;
      const attempt = await lockAttempt(tx, intent.metadata?.paymentId ?? '');
      if (attempt) {
        verifyIntent(intent, attempt);
        await tx.query('UPDATE payment_attempts SET payment_intent_id=$2,updated_at=NOW() WHERE id=$1', [attempt.id, intent.id]);
        await tx.query('UPDATE bookings SET stripe_payment_intent_id=COALESCE(stripe_payment_intent_id,$2) WHERE id=$1', [attempt.booking_id, intent.id]);
        if (event.type === 'payment_intent.succeeded') {
          if (intent.status !== 'succeeded' || intent.amount_received !== attempt.amount_cents) throw new PaymentError(409, 'Le montant reçu ne correspond pas au total attendu.');
          const [booking] = await tx.query<Booking>('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [attempt.booking_id]);
          if (!terminalPayments.has(attempt.state)) {
            const confirm = booking.status === 'ACCEPTED' && (!booking.payment_expires_at || new Date(booking.payment_expires_at).getTime() >= event.created * 1000);
            await tx.query('UPDATE payment_attempts SET state=$2,updated_at=NOW() WHERE id=$1', [attempt.id, confirm ? 'SUCCEEDED' : 'REVIEW']);
            await tx.query("UPDATE bookings SET payment_status='PAID',status=CASE WHEN $2 THEN 'CONFIRMED' ELSE status END WHERE id=$1", [attempt.booking_id, confirm]);
            if (confirm) await tx.query("INSERT INTO booking_status_history(id,booking_id,status) VALUES($1,$2,'CONFIRMED')", [randomUUID(), attempt.booking_id]);
            await tx.query("INSERT INTO notifications(id,user_id,title,body) VALUES($1,$2,$3,$4)", [randomUUID(), booking.client_id, confirm ? 'Paiement confirmé' : 'Paiement reçu — vérification en cours', confirm ? 'Votre réservation est confirmée. Retrouvez ses détails dans votre espace.' : 'Le statut de votre réservation a changé avant la confirmation. Contactez le support.']);
            outcome = confirm ? 'PAYMENT_CONFIRMED' : 'PAID_REQUIRES_REVIEW';
          } else outcome = 'ALREADY_SETTLED';
        } else if (['payment_intent.payment_failed', 'payment_intent.canceled'].includes(event.type) && !terminalPayments.has(attempt.state)) {
          await tx.query("UPDATE bookings SET payment_status='FAILED' WHERE id=$1 AND payment_status NOT IN ('PAID','REFUNDED','PARTIALLY_REFUNDED')", [attempt.booking_id]);
          outcome = 'PAYMENT_FAILED';
        }
      }
    } else if (['checkout.session.completed', 'checkout.session.expired'].includes(event.type)) {
      const session = event.data.object as Stripe.Checkout.Session;
      const attempt = await lockAttempt(tx, session.metadata?.paymentId ?? '');
      if (attempt) {
        if (session.livemode || session.metadata?.bookingId !== attempt.booking_id || session.amount_total !== attempt.amount_cents || session.currency !== attempt.currency || (attempt.checkout_session_id && attempt.checkout_session_id !== session.id) || (attempt.payment_intent_id && stripeId(session.payment_intent) && attempt.payment_intent_id !== stripeId(session.payment_intent))) throw new PaymentError(409, 'Session Stripe incohérente.');
        await tx.query('UPDATE payment_attempts SET checkout_session_id=$2,payment_intent_id=COALESCE(payment_intent_id,$3),updated_at=NOW() WHERE id=$1', [attempt.id, session.id, stripeId(session.payment_intent)]);
        if (event.type === 'checkout.session.expired' && !terminalPayments.has(attempt.state) && attempt.state !== 'EXPIRED') {
          await tx.query("UPDATE payment_attempts SET state='EXPIRED',updated_at=NOW() WHERE id=$1", [attempt.id]);
          await tx.query("UPDATE bookings SET payment_status='UNPAID' WHERE id=$1 AND payment_status NOT IN ('PAID','REFUNDED','PARTIALLY_REFUNDED')", [attempt.booking_id]);
          await expireBookingHolds(tx, { bookingId: attempt.booking_id });
        }
        outcome = event.type === 'checkout.session.completed' ? 'AWAITING_PAYMENT_INTENT' : 'SESSION_EXPIRED';
      }
    } else if (event.type === 'charge.refunded') {
      outcome = await reconcileRefund(tx, event.data.object as Stripe.Charge);
    } else if (event.type === 'refund.updated' || event.type === 'refund.failed' || event.type === 'refund.created') {
      const refund = event.data.object as Stripe.Refund;
      await tx.query('UPDATE refunds SET state=$2 WHERE stripe_refund_id=$1', [refund.id, refund.status ?? 'pending']);
      outcome = 'REFUND_STATUS_UPDATED';
    }
    await tx.query('UPDATE payment_events SET outcome=$2 WHERE id=$1', [event.id, outcome]);
    return { received: true, duplicate: false, outcome };
  });
}

async function reconcileRefund(tx: DbClient, charge: Stripe.Charge) {
  const [candidate] = await tx.query<Attempt>('SELECT * FROM payment_attempts WHERE payment_intent_id=$1 OR id=$2', [stripeId(charge.payment_intent), charge.metadata?.paymentId ?? '']);
  const attempt = candidate ? await lockAttempt(tx, candidate.id) : undefined;
  if (!attempt) return 'UNMATCHED_REFUND';
  if (charge.livemode || charge.amount !== attempt.amount_cents || charge.currency !== attempt.currency || (attempt.payment_intent_id && stripeId(charge.payment_intent) !== attempt.payment_intent_id) || (!attempt.payment_intent_id && (charge.metadata?.bookingId !== attempt.booking_id || charge.metadata?.paymentId !== attempt.id)) || !Number.isInteger(charge.amount_refunded) || charge.amount_refunded < 0 || charge.amount_refunded > attempt.amount_cents) throw new PaymentError(409, 'Remboursement incohérent.');
  if (charge.amount_refunded === 0) return 'NO_REFUND';
  // Never let an older partial-refund snapshot reverse a fully refunded state.
  if (attempt.state === 'REFUNDED' || charge.amount_refunded <= attempt.refunded_cents) return 'ALREADY_REFUNDED';
  const state = charge.amount_refunded === attempt.amount_cents ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  await tx.query('UPDATE payment_attempts SET state=$2,refunded_cents=$3,payment_intent_id=COALESCE(payment_intent_id,$4),updated_at=NOW() WHERE id=$1', [attempt.id, state, charge.amount_refunded, stripeId(charge.payment_intent)]);
  await tx.query('UPDATE bookings SET payment_status=$2 WHERE id=$1', [attempt.booking_id, state]);
  return state;
}

export async function requestFullRefund(actor: Actor, bookingId: string, reason: string) {
  if (actor.role !== 'ADMIN') throw new PaymentError(403, 'Action réservée à l’administration.');
  if (!paymentConfiguration().refundsEnabled) throw new PaymentError(503, 'Une politique de remboursement validée doit être configurée avant toute opération.');
  const stripe = stripeClient();
  const refund = await transaction(async tx => {
    const [attempt] = await tx.query<Attempt>("SELECT * FROM payment_attempts WHERE booking_id=$1 AND state IN ('SUCCEEDED','REVIEW') ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [bookingId]);
    if (!attempt?.payment_intent_id) throw new PaymentError(409, 'Aucun paiement intégral remboursable.');
    const [existing] = await tx.query<{ id: string; payment_intent_id: string; amount_cents: number; created_at: string }>('SELECT r.*,p.payment_intent_id FROM refunds r JOIN payment_attempts p ON p.id=r.payment_attempt_id WHERE r.payment_attempt_id=$1', [attempt.id]);
    if (existing) return existing;
    const [created] = await tx.query<{ id: string; amount_cents: number; created_at: string }>("INSERT INTO refunds (id,booking_id,payment_attempt_id,amount_cents,state,policy_version,reason,created_by) VALUES($1,$2,$3,$4,'requested',$5,$6,$7) RETURNING *", [randomUUID(), bookingId, attempt.id, attempt.amount_cents, process.env.REFUND_POLICY_VERSION, reason, actor.id]);
    return { ...created, payment_intent_id: attempt.payment_intent_id };
  });
  if (Date.now() - new Date(refund.created_at).getTime() > 23 * 60 * 60 * 1000) throw new PaymentError(409, 'Ce remboursement doit être rapproché avec Stripe avant une nouvelle tentative.');
  const result = await stripe.refunds.create({ payment_intent: refund.payment_intent_id, amount: refund.amount_cents, reverse_transfer: true, refund_application_fee: true, metadata: { bookingId, refundId: refund.id } }, { idempotencyKey: `refund:${refund.id}` });
  await query('UPDATE refunds SET stripe_refund_id=$2,state=$3 WHERE id=$1', [refund.id, result.id, result.status]);
  return { id: refund.id, status: result.status, message: 'Demande transmise en mode test. Le statut comptable attend la notification signée.' };
}

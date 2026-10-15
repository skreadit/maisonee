import { z } from 'zod';
import { requireUser, requireAdmin, assertSameOrigin, rateLimit } from '@/lib/auth';
import { createCheckout, startConnect, requestFullRefund, paymentConfiguration, processStripeEvent, verifyStripeWebhook, PaymentError } from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const bookingInput = z.object({ bookingId: z.string().min(1).max(100) }).strict();
const refundInput = bookingInput.extend({ reason: z.string().trim().min(10).max(1000) }).strict();
type Context = { params: Promise<{ path: string[] }> };
function response(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } }); }

export async function GET(_request: Request, context: Context) {
  const { path } = await context.params;
  if (path.join('/') !== 'status') return response({ error: 'Route introuvable.' }, 404);
  return response(paymentConfiguration());
}

export async function POST(request: Request, context: Context) {
  try {
    const route = (await context.params).path.join('/');
    if (route === 'webhook') {
      const body = await request.text();
      if (body.length > 262144) throw new PaymentError(413, 'Notification trop volumineuse.');
      return response(await processStripeEvent(verifyStripeWebhook(body, request.headers.get('stripe-signature'))));
    }
    if (!['checkout', 'connect', 'refund'].includes(route)) return response({ error: 'Route introuvable.' }, 404);
    assertSameOrigin(request);
    if (!request.headers.get('content-type')?.includes('application/json')) throw new PaymentError(415, 'Un contenu JSON est attendu.');
    const actor = route === 'refund' ? await requireAdmin(request) : await requireUser(request);
    await rateLimit(`payments:${route}:${actor.id}`, 20, 600);
    const raw = await request.text();
    if (raw.length > 4096) throw new PaymentError(413, 'Requête trop volumineuse.');
    let body: unknown;
    try { body = JSON.parse(raw || '{}'); } catch { throw new PaymentError(400, 'Le formulaire est invalide.'); }
    if (route === 'checkout') return response(await createCheckout(actor, bookingInput.parse(body).bookingId));
    if (route === 'connect') { z.object({}).strict().parse(body); return response(await startConnect(actor)); }
    const input = refundInput.parse(body);
    return response(await requestFullRefund(actor, input.bookingId, input.reason));
  } catch (error) {
    if (error instanceof z.ZodError) return response({ error: 'Les informations envoyées sont invalides.' }, 400);
    if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' && error.status >= 400 && error.status < 600) return response({ error: error instanceof Error ? error.message : 'Action refusée.' }, error.status);
    // Never return Stripe request dumps or secrets to a browser.
    console.error('payment_operation_failed', error instanceof Error ? error.name : 'unknown');
    return response({ error: 'Le service de paiement est temporairement indisponible. Réessayez sans créer une nouvelle réservation.' }, 502);
  }
}

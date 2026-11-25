import 'server-only';
import type Stripe from 'stripe';

import { digitalSamplePurpose as purpose, verifyDigitalTestPayment } from './digital-payment-proof';
import { createServiceClient } from './service';
import { getStripe } from './stripe';

type Db = ReturnType<typeof createServiceClient>;
type TestOrder = {
  id: string; annonce_id: string; acheteur: string; vendeur: string; montant: number; destination: string;
  titre: string; conditions: string; duree: number | null; version: string; session_id: string | null;
  intent_id: string | null; statut: 'pending' | 'paid' | 'expired' | 'revoked'; accepte_le: string;
};

export function digitalTestOrigin() {
  if (process.env.TYAGA_DIGITAL_CHECKOUT_TEST !== '1' || !process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) return null;
  try {
    const url = new URL(process.env.TYAGA_DIGITAL_TEST_ORIGIN ?? '');
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return url.origin;
  } catch { /* An incomplete test installation never enables checkout. */ }
  return null;
}

async function runRpc(db: Db, name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error('Service de recette indisponible.');
  return data;
}

export async function attachSample(id: string, userId: string, text: string) {
  if (!digitalTestOrigin()) throw new Error('Recette fermée.');
  await runRpc(createServiceClient(), 'licence_echantillon', { p_annonce: id, p_auteur: userId, p_texte: text, p_atteste: true });
}

export async function createTestCheckout(id: string, userId: string, version: string) {
  const origin = digitalTestOrigin();
  if (!origin) throw new Error('Recette fermée.');
  const db = createServiceClient();
  const order = await runRpc(db, 'licence_devis_test', { p_annonce: id, p_acheteur: userId, p_version: version, p_accepte: true }) as TestOrder;
  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(order.destination);
  if (!account.charges_enabled || !account.payouts_enabled || account.capabilities?.transfers !== 'active') throw new Error('Vendeur de recette indisponible.');
  if (order.session_id) {
    const existing = await stripe.checkout.sessions.retrieve(order.session_id);
    if (existing.status === 'expired') await settle(db, order, order.session_id, null, 'expired');
    if (existing.status !== 'open' || existing.livemode || !existing.url) throw new Error('Cette session est terminée. Actualise la licence.');
    return existing.url;
  }
  // Avoid creating a new session with a provider idempotency key past its retention.
  if (Date.now() - Date.parse(order.accepte_le) >= 23 * 3600_000) throw new Error('Le devis de recette doit être rapproché par le serveur.');
  const metadata = { app_slug: 'tyaga', purpose, digital_order_id: order.id, buyer_id: userId, seller_id: order.vendeur };
  const session = await stripe.checkout.sessions.create({
    mode: 'payment', payment_method_types: ['card'], client_reference_id: order.id, metadata,
    line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: order.montant, product_data: { name: 'Échantillon de test · ' + order.titre } } }],
    payment_intent_data: { metadata, transfer_data: { destination: order.destination } },
    success_url: origin + '/marketplace/' + id + '?licence=retour', cancel_url: origin + '/marketplace/' + id,
  }, { idempotencyKey: 'tyaga-digital-sample-' + order.id });
  if (session.livemode || !session.url) throw new Error('Session de test indisponible.');
  await runRpc(db, 'licence_session_test', { p_commande: order.id, p_session: session.id });
  return session.url;
}

async function settle(db: Db, order: TestOrder, sessionId: string, intent: string | null, status: 'revoked' | 'paid' | 'expired') {
  await runRpc(db, 'licence_regler_test', { p_commande: order.id, p_session: sessionId, p_intent: intent, p_acheteur: order.acheteur,
    p_destination: order.destination, p_montant: order.montant, p_devise: 'eur', p_statut: status });
}

async function reconcile(db: Db, order: TestOrder) {
  if (!order.session_id) throw new Error('En attente de la session de recette.');
  const session = await getStripe().checkout.sessions.retrieve(order.session_id, { expand: ['payment_intent.latest_charge'] });
  const proof = verifyDigitalTestPayment(session, order);
  if (proof.status === 'open') return null;
  await settle(db, order, session.id, proof.intent, proof.status);
  return proof.status === 'paid' ? proof.intent : null;
}

export async function refreshSample(id: string, userId: string, read: boolean) {
  if (!digitalTestOrigin()) return null;
  const db = createServiceClient();
  const order = await runRpc(db, 'licence_commande_test', { p_commande: null, p_annonce: id, p_acheteur: userId }) as TestOrder | null;
  if (!order || !order.session_id || order.statut === 'revoked') return null;
  const intent = await reconcile(db, order);
  if (!intent) return null;
  // Only the DB clock decides if the licence has expired. A missing row means
  // closed access, including a refund processed concurrently with this read.
  if (!read) return { received: true, text: null };
  const { data, error } = await db.rpc('licence_lire_echantillon', { p_annonce: id, p_acheteur: userId, p_intent: intent });
  if (error?.code === 'P0002') return null;
  if (error) throw new Error('Lecture momentanément indisponible.');
  return { received: true, text: data as string };
}

/** The shared dispatcher has already authenticated the internal request and
 * verified Stripe's signature. Retrieve provider state on every relevant event
 * so an old completed event cannot restore refunded or disputed access. */
export async function handleDigitalTestEvent(event: Stripe.Event): Promise<boolean> {
  if (event.livemode || !digitalTestOrigin()) return false;
  const obj = event.data.object as { metadata?: Record<string, string> | null };
  let metadata = obj.metadata;
  // A dispute has its own metadata. The Checkout metadata lives on the
  // underlying PaymentIntent. Work only with references signed by Stripe.
  if (metadata?.purpose !== purpose && event.type === 'charge.dispute.created') {
    const dispute = event.data.object;
    let intentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
    if (!intentId) {
      const charge = typeof dispute.charge === 'string' ? await getStripe().charges.retrieve(dispute.charge) : dispute.charge;
      intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    }
    if (intentId) metadata = (await getStripe().paymentIntents.retrieve(intentId)).metadata;
  } else if (metadata?.purpose !== purpose && event.type === 'charge.refunded') {
    const charge = event.data.object;
    const intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    if (intentId) metadata = (await getStripe().paymentIntents.retrieve(intentId)).metadata;
  }
  if (metadata?.purpose !== purpose || metadata?.app_slug !== 'tyaga') return false;
  const orderId = metadata.digital_order_id;
  const db = createServiceClient();
  const order = await runRpc(db, 'licence_commande_test', { p_commande: orderId, p_annonce: null, p_acheteur: null }) as TestOrder | null;
  if (!order) throw new Error('Commande de recette inconnue.');
  // The provider may have created a session despite a network failure while
  // saving its ID. A signed event with the matching immutable quote can bind it.
  if (!order.session_id && (event.type === 'checkout.session.completed' || event.type === 'checkout.session.expired')) {
    const session = event.data.object;
    if (session.client_reference_id !== order.id || session.metadata?.buyer_id !== order.acheteur ||
        session.metadata?.seller_id !== order.vendeur || session.currency !== 'eur' || session.amount_total !== order.montant)
      throw new Error('Événement de recette incohérent.');
    await runRpc(db, 'licence_session_test', { p_commande: order.id, p_session: session.id });
    order.session_id = session.id;
  }
  // Pre-completion events are advisory. Settlement begins on Checkout completion,
  // expiration or a later reversal. Reading also rechecks the exact same session.
  if (['checkout.session.completed', 'checkout.session.expired', 'charge.refunded', 'charge.dispute.created'].includes(event.type)) await reconcile(db, order);
  return true;
}

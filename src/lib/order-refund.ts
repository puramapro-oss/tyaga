import { z } from 'zod';
import type { SettlementDependencies, Transfer } from './order-settlement';

const refundSchema = z.object({
  order_id: z.string().uuid(), amount_cents: z.number().int().nonnegative(),
  currency: z.literal('eur'), destination: z.string().nullable(), transfer_group: z.string(),
  claimed_at: z.string().nullable(), stripe_transfer_id: z.string().nullable(),
  refund_state: z.enum(['partial_review', 'pending_transfer', 'pending_reversal',
    'reversing', 'reversal_review', 'complete']),
});
type Refund = z.infer<typeof refundSchema>;
interface RefundCharge {
  id: string; amount: number; amount_refunded: number; currency: string; refunded: boolean;
  payment_intent: string | { id: string } | null;
}
export interface RefundDependencies {
  store: SettlementDependencies['store'];
  getTransfers(): {
    list(args: { transfer_group: string; limit: number }): PromiseLike<{ data: Transfer[]; has_more: boolean }>;
    retrieve(id: string): PromiseLike<Transfer>;
    createReversal(id: string, args: { amount: number; metadata: Record<string, string> },
      options: { idempotencyKey: string }): PromiseLike<{
        id: string; amount: number; currency: string; transfer: string | { id: string };
        metadata: Record<string, string> | null;
      }>;
  };
}

function matches(transfer: Transfer, refund: Refund): boolean {
  const destination = typeof transfer.destination === 'string' ? transfer.destination : transfer.destination?.id;
  return /^tr_[A-Za-z0-9]+$/.test(transfer.id)
    && (!refund.stripe_transfer_id || refund.stripe_transfer_id === transfer.id)
    && transfer.amount === refund.amount_cents && transfer.currency === refund.currency
    && transfer.metadata?.order_id === refund.order_id && transfer.metadata?.app_slug === 'tyaga'
    && typeof transfer.reversed === 'boolean' && Number.isSafeInteger(transfer.amount_reversed)
    && transfer.amount_reversed >= 0 && transfer.amount_reversed <= transfer.amount
    // L'ancien protocole n'avait pas de groupe, ni de destination historique
    // figée. Son reçu explicite + metadata + montant reste la preuve de lien.
    && (refund.claimed_at === null || (destination === refund.destination
      && transfer.transfer_group === refund.transfer_group));
}

function proof(transfer: Transfer, reversalId?: string) {
  return {
    id: transfer.id, amount: transfer.amount, currency: transfer.currency,
    destination: typeof transfer.destination === 'string' ? transfer.destination : transfer.destination?.id,
    transfer_group: transfer.transfer_group, order_id: transfer.metadata?.order_id,
    app_slug: transfer.metadata?.app_slug, amount_reversed: transfer.amount_reversed,
    reversed: transfer.reversed, ...(reversalId ? { reversal_id: reversalId } : {}),
  };
}

/** Résout uniquement un remboursement prouvé. Toute compensation inconnue
 * lève une erreur : le webhook existant réessaiera sans marqueur de succès. */
export async function refundCompletedSale(charge: RefundCharge, deps: RefundDependencies): Promise<void> {
  const paymentIntent = typeof charge.payment_intent === 'string'
    ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntent) throw new Error('paiement du remboursement non identifié');
  const args = { p_payment_intent: paymentIntent, p_charge: charge.id, p_amount: charge.amount,
    p_refunded: charge.amount_refunded, p_currency: charge.currency, p_full: charge.refunded };
  async function prepare(): Promise<Refund | null> {
    const response = await deps.store.rpc('prepare_order_refund', args);
    if (response.error) throw new Error(`comptabilité remboursement (${response.error.code})`);
    return response.data === null ? null : refundSchema.parse(response.data);
  }
  async function record(refund: Refund, transfer: Transfer, reversalId?: string): Promise<Refund> {
    const response = await deps.store.rpc('record_order_reversal', {
      p_order: refund.order_id, p_transfer: proof(transfer, reversalId),
    });
    if (response.error) throw new Error(`preuve de compensation (${response.error.code})`);
    const saved = refundSchema.parse(response.data);
    if (saved.order_id !== refund.order_id || saved.stripe_transfer_id !== transfer.id) {
      throw new Error('preuve de compensation incohérente');
    }
    return saved;
  }

  let refund = await prepare();
  // Stripe ne garantit pas l'ordre : le refund peut précéder le checkout
  // qui rattache le PaymentIntent. Ne jamais acquitter ce cas comme résolu.
  if (!refund) throw new Error('commande du remboursement pas encore rattachée');
  if (refund.refund_state === 'complete') return;
  if (refund.refund_state === 'partial_review') throw new Error('remboursement partiel à vérifier');
  const transfers = deps.getTransfers();
  if (!refund.stripe_transfer_id) {
    if (refund.claimed_at === null) throw new Error('transfert historique à rapprocher');
    const found = await transfers.list({ transfer_group: refund.transfer_group, limit: 2 });
    if (found.has_more || found.data.length !== 1 || !matches(found.data[0], refund)) {
      throw new Error('transfert à rapprocher avant compensation');
    }
    const stored = await deps.store.rpc('record_order_transfer', {
      p_order: refund.order_id, p_transfer: proof(found.data[0]),
    });
    if (stored.error) throw new Error(`reçu tardif (${stored.error.code})`);
    refund = await prepare();
    if (!refund || !refund.stripe_transfer_id) throw new Error('reçu tardif non confirmé');
  }

  const transfer = await transfers.retrieve(refund.stripe_transfer_id);
  if (!matches(transfer, refund)) throw new Error('transfert étranger ou incohérent');
  if (transfer.reversed || transfer.amount_reversed > 0) {
    const saved = await record(refund, transfer);
    if (saved.refund_state === 'complete') return;
    throw new Error('réversion partielle à vérifier');
  }
  const claimed = await deps.store.rpc('claim_order_reversal', {
    p_order: refund.order_id, p_transfer: transfer.id,
  });
  if (claimed.error) throw new Error(`réservation de compensation (${claimed.error.code})`);
  const claim = z.object({ issue: z.boolean(), settlement: refundSchema }).parse(claimed.data);
  if (claim.settlement.order_id !== refund.order_id || claim.settlement.stripe_transfer_id !== transfer.id
      || claim.settlement.amount_cents !== transfer.amount) throw new Error('compensation incohérente');
  if (claim.settlement.refund_state === 'complete') return;
  if (!claim.issue || claim.settlement.refund_state !== 'reversing') {
    throw new Error('compensation en cours ou à vérifier');
  }
  // Le montant entier est figé ; aucune tentative automatique de complément
  // après une réversion partielle. Le claim n'expire jamais, même après 24 h.
  const reversal = await transfers.createReversal(transfer.id, {
    amount: transfer.amount, metadata: { app_slug: 'tyaga', order_id: refund.order_id },
  }, { idempotencyKey: `tyaga:refund:v1:${refund.order_id}` });
  const reversedTransfer = typeof reversal.transfer === 'string' ? reversal.transfer : reversal.transfer.id;
  if (!/^trr_[A-Za-z0-9]+$/.test(reversal.id) || reversedTransfer !== transfer.id
      || reversal.amount !== transfer.amount || reversal.currency !== transfer.currency
      || reversal.metadata?.app_slug !== 'tyaga' || reversal.metadata?.order_id !== refund.order_id) {
    throw new Error('réponse de compensation incohérente');
  }
  const saved = await record(refund, { ...transfer, reversed: true, amount_reversed: transfer.amount }, reversal.id);
  if (saved.refund_state !== 'complete') throw new Error('compensation non confirmée');
}

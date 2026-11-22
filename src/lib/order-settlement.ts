import { z } from 'zod';

/** La base consomme le droit d'émission AVANT Stripe. Aucun rejeu ne recrée
 * un transfert : une clé Stripe seule peut être oubliée après 24 heures. */
const frameSchema = z.object({
  order: z.object({
    id: z.string().uuid(), status: z.string(), escrow_status: z.string(),
    stripe_transfer_id: z.string().nullable(),
  }),
  settlement: z.object({
    order_id: z.string().uuid(),
    state: z.enum(['awaiting_account', 'ready', 'issuing', 'transferred',
      'no_transfer_due', 'legacy_review', 'refund_review']),
    amount_cents: z.number().int().nonnegative(), currency: z.literal('eur'),
    destination: z.string().nullable(), transfer_group: z.string(),
    idempotency_key: z.string(), stripe_transfer_id: z.string().nullable(),
  }),
  issue: z.boolean(),
});
type Frame = z.infer<typeof frameSchema>;

export interface Transfer {
  id: string;
  amount: number;
  currency: string;
  destination: string | { id: string } | null;
  transfer_group: string | null;
  metadata: Record<string, string> | null;
  reversed: boolean;
  amount_reversed: number;
}
export interface SettlementDependencies {
  store: {
    rpc(name: string, args: Record<string, unknown>): PromiseLike<{
      data: unknown; error: { code?: string } | null;
    }>;
  };
  getTransfers(): {
    create(args: {
      amount: number; currency: string; destination: string;
      transfer_group: string; metadata: Record<string, string>;
    }, options: { idempotencyKey: string }): PromiseLike<Transfer>;
    list(args: { transfer_group: string; limit: number }): PromiseLike<{
      data: Transfer[]; has_more: boolean;
    }>;
  };
}
export interface SettlementResult {
  order: Frame['order'];
  settlement: { status: 'paid' | 'awaiting_account' | 'verification_required' | 'not_required' };
}

function result(frame: Frame): SettlementResult {
  const state = frame.settlement.state;
  const paid = state === 'transferred' && frame.order.status === 'completed'
    && frame.order.escrow_status === 'released' && frame.order.stripe_transfer_id !== null
    && frame.order.stripe_transfer_id === frame.settlement.stripe_transfer_id;
  return {
    order: frame.order,
    settlement: { status: paid ? 'paid'
      : state === 'awaiting_account' ? 'awaiting_account'
        : state === 'no_transfer_due' ? 'not_required' : 'verification_required' },
  };
}

function matches(transfer: Transfer, frame: Frame): boolean {
  const expected = frame.settlement;
  const destination = typeof transfer.destination === 'string'
    ? transfer.destination : transfer.destination?.id;
  return /^tr_[A-Za-z0-9]+$/.test(transfer.id)
    && transfer.amount === expected.amount_cents && transfer.currency === expected.currency
    && destination === expected.destination && transfer.transfer_group === expected.transfer_group
    && transfer.metadata?.app_slug === 'tyaga' && transfer.metadata?.order_id === expected.order_id
    && typeof transfer.reversed === 'boolean'
    && Number.isSafeInteger(transfer.amount_reversed) && transfer.amount_reversed >= 0;
}

export async function finalizeCompletedSale(
  orderId: string, buyerId: string, deps: SettlementDependencies
): Promise<SettlementResult> {
  const prepared = await deps.store.rpc('prepare_order_settlement', {
    p_order: orderId, p_buyer: buyerId,
  });
  if (prepared.error) throw new Error(`finalisation (${prepared.error.code ?? 'indisponible'})`);
  const frame = frameSchema.parse(prepared.data);
  const claim = frame.settlement;
  if (frame.order.id !== orderId || claim.order_id !== orderId) throw new Error('commande incohérente');
  if (claim.state !== 'issuing') {
    if (frame.issue) throw new Error('droit de virement incohérent');
    return result(frame);
  }
  if (!claim.destination || claim.amount_cents <= 0
      || frame.order.status !== 'completed' || frame.order.escrow_status !== 'held'
      || frame.order.stripe_transfer_id !== null || claim.stripe_transfer_id !== null
      || claim.transfer_group !== `tyaga_order_${orderId}`
      || claim.idempotency_key !== `tyaga:settlement:v1:${orderId}`) {
    throw new Error('paramètres de virement incohérents');
  }

  let transfer: Transfer;
  try {
    const transfers = deps.getTransfers();
    if (frame.issue) {
      transfer = await transfers.create({
        amount: claim.amount_cents, currency: claim.currency, destination: claim.destination,
        transfer_group: claim.transfer_group, metadata: { app_slug: 'tyaga', order_id: orderId },
      }, { idempotencyKey: claim.idempotency_key });
    } else {
      // Lecture seule, même des mois plus tard. Zéro résultat ne prouve pas
      // qu'une requête antérieure n'a pas abouti : jamais de nouvelle émission.
      const found = await transfers.list({ transfer_group: claim.transfer_group, limit: 2 });
      if (found.has_more || found.data.length !== 1) return result(frame);
      transfer = found.data[0];
    }
  } catch {
    // Échec définitif ou réponse perdue : on ne peut pas les confondre.
    // Le claim reste durablement consommé ; le prochain essai ne fait que lire.
    return result(frame);
  }
  if (!matches(transfer, frame)) return result(frame);
  const recorded = await deps.store.rpc('record_order_transfer', {
    p_order: orderId,
    p_transfer: {
      id: transfer.id, amount: transfer.amount, currency: transfer.currency,
      destination: typeof transfer.destination === 'string' ? transfer.destination : transfer.destination?.id,
      transfer_group: transfer.transfer_group, order_id: transfer.metadata?.order_id,
      app_slug: transfer.metadata?.app_slug, reversed: transfer.reversed,
      amount_reversed: transfer.amount_reversed,
    },
  });
  if (recorded.error) throw new Error(`reçu de virement (${recorded.error.code ?? 'indisponible'})`);
  const receipt = frameSchema.parse(recorded.data);
  if (receipt.order.id !== orderId || receipt.settlement.order_id !== orderId
      || receipt.order.stripe_transfer_id !== transfer.id
      || receipt.settlement.stripe_transfer_id !== transfer.id
      || !['transferred', 'refund_review'].includes(receipt.settlement.state)) {
    throw new Error('reçu de virement incohérent');
  }
  return result(receipt);
}

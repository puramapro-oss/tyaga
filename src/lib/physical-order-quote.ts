import { computeCommission, physicalPilotQuote, type CommissionBreakdown } from './commission';
import { PHYSICAL_PILOT_POLICY } from './physical-sale-pilot';
import type { createServerSupabaseClient } from './supabase-server';

export interface NegotiationMessage {
  offer_cents: number;
  created_at: string;
}

export function agreedSalePrice(
  listed: number,
  offer: NegotiationMessage | null,
  acceptance: NegotiationMessage | null,
): number {
  if (!offer || !acceptance || acceptance.created_at <= offer.created_at) return listed;
  if (offer.offer_cents !== acceptance.offer_cents || !Number.isSafeInteger(offer.offer_cents)) return listed;
  if (offer.offer_cents < 100 || offer.offer_cents > listed) return listed;
  return offer.offer_cents;
}

export function sameSaleQuote(a: CommissionBreakdown, b: CommissionBreakdown) {
  return a.grossCents === b.grossCents && a.commissionCents === b.commissionCents &&
    a.commissionPct === b.commissionPct && a.netCents === b.netCents &&
    a.policy === b.policy && a.itemCents === b.itemCents && a.buyerFeeCents === b.buyerFeeCents;
}

export async function physicalOrderQuote(
  client: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  listing: { id: string; user_id: string; price_cents: number; fee_policy?: string },
  buyerId: string,
): Promise<CommissionBreakdown | null> {
  if (listing.fee_policy && listing.fee_policy !== PHYSICAL_PILOT_POLICY && listing.fee_policy !== 'legacy') return null;
  const compute = listing.fee_policy === PHYSICAL_PILOT_POLICY ? physicalPilotQuote : computeCommission;
  const { data: conversation, error } = await client.from('conversations').select('id')
    .eq('annonce_id', listing.id).eq('buyer_id', buyerId).maybeSingle();
  if (error) return null;
  if (!conversation) return compute(listing.price_cents);

  const latestOffer = (senderId: string) => client.from('inbox_messages')
    .select('offer_cents, created_at').eq('conversation_id', conversation.id)
    .eq('sender_id', senderId).eq('flagged_off_platform', false).not('offer_cents', 'is', null)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle();
  const [offered, accepted] = await Promise.all([latestOffer(buyerId), latestOffer(listing.user_id)]);
  if (offered.error || accepted.error) return null;
  return compute(agreedSalePrice(listing.price_cents, offered.data, accepted.data));
}

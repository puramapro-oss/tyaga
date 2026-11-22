/** Un séquestre libéré ne prouve pas, à lui seul, le virement Connect. */
export function orderPaymentLabel(order: {
  escrow_status: string;
  stripe_transfer_id: string | null;
  net_amount_cents: number;
}): string {
  if (order.escrow_status === 'refunded') return 'Remboursée';
  if (order.stripe_transfer_id && order.escrow_status === 'released') return 'Virement vendeur effectué';
  if (order.net_amount_cents === 0 && order.escrow_status === 'released') return 'Aucun versement vendeur dû';
  if (order.escrow_status === 'released') return 'Versement vendeur à vérifier';
  if (order.stripe_transfer_id && order.escrow_status === 'held') return 'Versement vendeur à vérifier';
  if (order.escrow_status === 'held') return 'Fonds sous séquestre';
  return 'Paiement non réglé';
}

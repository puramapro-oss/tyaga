// The policy stored on a listing stays with its quote, order and payment receipt.
export const PREVIOUS_PHYSICAL_PILOT_POLICY = 'fr_p2p_test_v2';
export const PHYSICAL_PILOT_POLICY = 'fr_p2p_test_v3';
export const PHYSICAL_PILOT_POLICIES = [PREVIOUS_PHYSICAL_PILOT_POLICY, PHYSICAL_PILOT_POLICY] as const;
export type PhysicalPilotPolicy = typeof PHYSICAL_PILOT_POLICIES[number];

const buyerPermille: Record<PhysicalPilotPolicy, number> = {
  fr_p2p_test_v2: 29,
  fr_p2p_test_v3: 30,
};

export function isPhysicalPilotPolicy(value: unknown): value is PhysicalPilotPolicy {
  return value === PREVIOUS_PHYSICAL_PILOT_POLICY || value === PHYSICAL_PILOT_POLICY;
}

export function physicalBuyerFeeCents(itemCents: number, policy: PhysicalPilotPolicy) {
  return Math.round(itemCents * buyerPermille[policy] / 1000) + 35;
}

export function physicalBuyerFeePercentLabel(policy: PhysicalPilotPolicy) {
  return (buyerPermille[policy] / 10).toLocaleString('fr-FR', { minimumFractionDigits: 1 });
}

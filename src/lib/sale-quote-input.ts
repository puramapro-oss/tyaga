import { z } from 'zod';

/** An older API client may omit this field. The current UI always confirms its displayed quote. */
export const expectedSaleQuote = z.object({
  policy: z.literal('fr_p2p_test_v2').optional(),
  itemCents: z.number().int().positive().optional(),
  buyerFeeCents: z.number().int().nonnegative().optional(),
  grossCents: z.number().int().nonnegative(),
  commissionCents: z.number().int().nonnegative(),
  commissionPct: z.number().min(0).max(30),
  netCents: z.number().int().nonnegative(),
}).strict().optional();

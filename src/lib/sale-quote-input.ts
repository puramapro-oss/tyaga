import { z } from 'zod';

/** An older API client may omit this field. The current UI always confirms its displayed quote. */
export const expectedSaleQuote = z.object({
  grossCents: z.number().int().nonnegative(),
  commissionCents: z.number().int().nonnegative(),
  commissionPct: z.number().min(0).max(30),
  netCents: z.number().int().nonnegative(),
}).strict().optional();

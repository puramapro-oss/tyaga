import 'server-only';
import { z } from 'zod';

type TestEnvironment = Readonly<Record<string, string | undefined>>;

const productionHosts = new Set(['purama.dev', 'www.purama.dev', 'one.purama.dev', 'tyaga.purama.dev', 'pay.purama.dev', 'auth.purama.dev']);

function isolatedOrigin(source: string | undefined) {
  if (!source) return null;
  try {
    const url = new URL(source);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || productionHosts.has(hostname)) return null;
    if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname))) {
      return url.origin;
    }
  } catch { /* An invalid test configuration is closed. */ }
  return null;
}

export function pointsPromotionTestOrigin(env: TestEnvironment) {
  if (env.TYAGA_PROMOTION_POINTS_TEST !== '1' || env.VERCEL_ENV === 'production') return null;
  if (env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA && env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA !== 'tyaga') return null;
  const app = isolatedOrigin(env.TYAGA_PROMOTION_POINTS_TEST_ORIGIN);
  const backend = isolatedOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
  const expected = isolatedOrigin(env.TYAGA_PROMOTION_POINTS_TEST_SUPABASE_ORIGIN);
  return app && backend && backend === expected ? app : null;
}

const positiveUnits = z.number().int().positive().max(2_147_483_647);
const tariffId = z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export const promotionReceiptRequest = z.object({ tariffId, requestId: z.string().uuid() }).strict();
export const promotionPurchaseRequest = promotionReceiptRequest.extend({ confirmed: z.literal(true) });

export const promotionPointsQuote = z.object({
  tariff_id: tariffId,
  cost_points: positiveUnits,
  duration_hours: positiveUnits.max(168),
  balance_points: z.number().int().nonnegative().max(2_147_483_647),
}).transform(value => ({
  tariffId: value.tariff_id, costPoints: value.cost_points,
  durationHours: value.duration_hours, balancePoints: value.balance_points,
}));

const receiptRow = z.object({
  grant_id: z.string().uuid(), receipt_id: z.string().min(1).max(256), cost_points: positiveUnits,
});
function receiptView(value: z.infer<typeof receiptRow>) {
  return { grantId: value.grant_id, receiptId: value.receipt_id, costPoints: value.cost_points };
}
export const promotionPointsReceipt = receiptRow.transform(receiptView);
export const promotionPointsReceiptHistory = receiptRow.extend({
  status: z.enum(['purchased', 'refunded']),
}).transform(value => ({ ...receiptView(value), status: value.status }));

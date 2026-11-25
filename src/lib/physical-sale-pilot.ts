import 'server-only';

import { APP_DOMAIN } from './constants';
import type { createServerSupabaseClient } from './supabase-server';

export const PHYSICAL_PILOT_POLICY = 'fr_p2p_test_v2' as const;

export function hasPhysicalTestStripeKey(): boolean {
  return process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') === true &&
    process.env.VERCEL_ENV !== 'production';
}

export function physicalPilotTestOrigin(): string | null {
  if (!hasPhysicalTestStripeKey() || process.env.TYAGA_PHYSICAL_FEE_TEST !== '1') return null;
  try {
    const url = new URL(process.env.TYAGA_PHYSICAL_FEE_TEST_ORIGIN ?? '');
    if (url.username || url.password || url.pathname !== '/' || url.hash || url.search ||
        url.hostname === APP_DOMAIN) return null;
    if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
      return url.origin;
    }
  } catch { /* An incomplete staging environment cannot create a checkout. */ }
  return null;
}

export function isPhysicalPilotTestMode() {
  return physicalPilotTestOrigin() !== null;
}

export async function canUsePhysicalSalePilot(client: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  if (!isPhysicalPilotTestMode()) return false;
  const { data, error } = await client.rpc('can_publish_test_fee');
  return !error && data === true;
}

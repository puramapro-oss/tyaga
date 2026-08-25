import 'server-only';

import Stripe from 'stripe';

/**
 * Client Stripe singleton (clé live plateforme). TYAGA n'a AUCUN webhook
 * dédié (EX-E4) : tout passe par le dispatcher karma → /api/internal/stripe-fulfillment.
 */

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY manquante');
    client = new Stripe(key, { apiVersion: '2026-07-29.dahlia' });
  }
  return client;
}

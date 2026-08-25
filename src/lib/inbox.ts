/**
 * EX-F — messagerie interne : détection hors plateforme (F4) et suggestions
 * 1-clic déterministes (F2/F3). Pur, sans dépendance → testable unitaire.
 * Aucun envoi automatique : les suggestions ne deviennent des messages que
 * sur clic explicite de l'utilisateur (POST /messages).
 */

export type InboxRole = 'buyer' | 'seller';

export type SuggestionType = 'answer' | 'negotiate' | 'accept' | 'decline';

export interface SuggestionDraft {
  suggestion_type: SuggestionType;
  price_counter_cents: number | null;
  body: string;
}

export interface SuggestionContext {
  role: InboxRole;
  priceCents: number;            // prix affiché de l'annonce
  floorCents: number | null;     // plancher vendeur (EX-F3), null = non défini
  lastOfferCents: number | null; // dernière offre de l'acheteur (offer_cents)
}

/** EX-F4 — motifs de paiement / contact hors plateforme (SPEC). */
const OFF_PLATFORM_PATTERNS: readonly { label: string; fr: string; re: RegExp }[] = [
  { label: 'IBAN', fr: 'IBAN', re: /\b[A-Z]{2}\d{2}(?:\s?[0-9A-Z]{4}){2,7}(?:\s?[0-9A-Z]{1,3})?\b/ },
  { label: 'RIB', fr: 'RIB', re: /\b\d{5}[\s.-]?\d{5}[\s.-]?\d{11}[\s.-]?\d{2}\b/ },
  { label: 'PayPal', fr: 'PayPal', re: /\bpay\s?pal\b/i },
  { label: 'WhatsApp', fr: 'WhatsApp', re: /\bwhats\s?app\b|\bwa\.me\b/i },
  { label: 'Telegram', fr: 'Telegram', re: /\btelegram\b|\bt\.me\b/i },
  { label: 'Revolut', fr: 'Revolut', re: /\brevolut\b/i },
  { label: 'Lydia', fr: 'Lydia', re: /\blydia\b/i },
  { label: 'email', fr: 'email de contact', re: /\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/i },
  {
    label: 'téléphone',
    fr: 'numéro de téléphone',
    re: /(?:\+|00)\s?33\s?[1-9](?:[\s.-]?\d{2}){4}|\b0[1-9](?:[\s.-]?\d{2}){4}\b/,
  },
];

/** Retourne le motif détecté (label + libellé FR) ou null si rien à bloquer. */
export function detectOffPlatform(body: string): { label: string; fr: string } | null {
  for (const p of OFF_PLATFORM_PATTERNS) {
    if (p.re.test(body)) return { label: p.label, fr: p.fr };
  }
  return null;
}

function euros(cents: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/**
 * EX-F2/EX-F3 — modèles proposés selon le rôle et l'état (plancher, dernière
 * offre). Déterministe. Invariant F3 : tout `price_counter_cents` produit est
 * TOUJOURS ≥ plancher quand un plancher existe (la négo ne descend jamais sous
 * le plancher ; sous le plancher on PROPOSE un refus poli).
 */
export function buildSuggestions(ctx: SuggestionContext): SuggestionDraft[] {
  if (ctx.role === 'buyer') {
    // L'acheteur ne connaît pas le plancher : on ne lui propose aucun montant.
    return [
      {
        suggestion_type: 'answer',
        price_counter_cents: null,
        body: 'Bonjour ! L’objet est-il toujours disponible ?',
      },
      {
        suggestion_type: 'answer',
        price_counter_cents: null,
        body: 'Peux-tu préciser l’état exact et les éventuels défauts ?',
      },
      {
        suggestion_type: 'negotiate',
        price_counter_cents: null,
        body: 'Bonjour ! Proposes-tu un petit geste sur le prix ?',
      },
    ];
  }

  const floor = ctx.floorCents;
  if (ctx.lastOfferCents !== null && floor !== null && ctx.lastOfferCents < floor) {
    return [
      {
        suggestion_type: 'decline',
        price_counter_cents: null,
        body: `Merci pour ta proposition ! Je ne descends pas sous ${euros(floor)}, mais je reste à l’écoute.`,
      },
      {
        suggestion_type: 'negotiate',
        price_counter_cents: floor,
        body: `Je peux te laisser l’objet à ${euros(floor)} (mon prix plancher) — ça te va ?`,
      },
    ];
  }

  if (ctx.lastOfferCents !== null) {
    return [
      {
        suggestion_type: 'accept',
        price_counter_cents: ctx.lastOfferCents,
        body: `Marché conclu pour ${euros(ctx.lastOfferCents)} ! Tu peux payer directement via le bouton Acheter de l’annonce.`,
      },
      {
        suggestion_type: 'negotiate',
        price_counter_cents: null,
        body: `Merci ! Je maintiens le prix affiché (${euros(ctx.priceCents)}) vu l’état de l’objet.`,
      },
    ];
  }

  return [
    {
      suggestion_type: 'answer',
      price_counter_cents: null,
      body: 'Bonjour ! Oui, l’objet est toujours disponible.',
    },
    {
      suggestion_type: 'answer',
      price_counter_cents: null,
      body: 'Tu peux acheter directement via le bouton Acheter de l’annonce — paiement sécurisé TYAGA.',
    },
  ];
}

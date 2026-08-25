import Anthropic from '@anthropic-ai/sdk';

import 'server-only';

/**
 * TYAGA estimation : fiche objet → prix de revente réaliste + délai ESTIMÉ.
 * L'IA propose des euros ; ce module les borne et les convertit en centimes.
 * Le net vendeur n'est JAMAIS calculé ici (voir commission.ts, serveur).
 */

const ESTIMATE_MODEL = process.env.ANTHROPIC_MODEL_MAIN || 'claude-sonnet-4-6';

export type ItemCondition =
  | 'neuf'
  | 'excellent'
  | 'tres_bon'
  | 'bon'
  | 'satisfaisant'
  | 'a_reparer';

export interface EstimateInput {
  category: string;
  brand: string;
  model: string;
  condition: ItemCondition;
}

export interface EstimateResult {
  price_suggested_cents: number;
  price_min_cents: number;
  price_max_cents: number;
  delay_days_min: number;
  delay_days_max: number;
  confidence: 'low' | 'medium' | 'high';
  rationale: string;
}

const SYSTEM_PROMPT = `Tu es TYAGA, estimateur d'objets d'occasion sur le marché français (références : Vinted, Leboncoin, Back Market).
On te décrit un objet. Tu estimes son prix de revente réaliste et sa durée de vente probable.
Réponds UNIQUEMENT en JSON valide, sans texte autour :
{
  "price_suggested_eur": <entier>,
  "price_min_eur": <entier>,
  "price_max_eur": <entier>,
  "delay_days_min": <entier>,
  "delay_days_max": <entier>,
  "confidence": "low|medium|high",
  "rationale": "1 à 2 phrases en français"
}
Règles strictes :
- price_min <= price_suggested <= price_max, en euros entiers, minimum 1.
- Marque ou modèle inconnu/vide : fourchette large et confidence "low".
- La durée de vente est une ESTIMATION. Formule la rationale avec "estimé" ou "estimation".
- Interdit de promettre une vente ou un délai : jamais le mot "garanti", jamais "assuré".
- Objets invendables (hors prix raisonnable) : reste sous 500 € et confidence "low".`;

interface RawEstimate {
  price_suggested_eur: number;
  price_min_eur: number;
  price_max_eur: number;
  delay_days_min: number;
  delay_days_max: number;
  confidence: string;
  rationale: string;
}

/** Bornage défensif : l'IA peut dériver, la DB ne doit jamais recevoir l'incohérent. */
function sanitize(raw: RawEstimate): EstimateResult {
  const toCents = (v: number) =>
    Math.max(100, Math.min(5_000_000, Math.round(Number(v) || 1) * 100));
  const suggested = toCents(raw.price_suggested_eur);
  const minCents = Math.min(toCents(raw.price_min_eur), suggested);
  const maxCents = Math.max(toCents(raw.price_max_eur), suggested);

  const delays = [raw.delay_days_min, raw.delay_days_max]
    .map((v) => Math.max(1, Math.min(365, Math.round(Number(v) || 1))))
    .sort((a, b) => a - b);

  const confidence: EstimateResult['confidence'] =
    raw.confidence === 'high' || raw.confidence === 'low' ? raw.confidence : 'medium';

  return {
    price_suggested_cents: suggested,
    price_min_cents: minCents,
    price_max_cents: maxCents,
    delay_days_min: delays[0],
    delay_days_max: delays[1],
    confidence,
    // EX-C5 : aucun mot de la famille « garanti » ne doit atteindre l'UI
    rationale: (raw.rationale || '')
      .replace(/garanti\w*/gi, 'estimé')
      .slice(0, 500),
  };
}

export async function estimateItem(input: EstimateInput): Promise<EstimateResult> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!,
    timeout: 30_000, // borné, jamais de spinner infini
  });

  const description = [
    `Catégorie : ${input.category || 'non précisée'}`,
    `Marque : ${input.brand || 'inconnue'}`,
    `Modèle : ${input.model || 'inconnu'}`,
    `État : ${input.condition}`,
  ].join('\n');

  const response = await client.messages.create({
    model: ESTIMATE_MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: description }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('ESTIMATE_INVALID_RESPONSE');
  return sanitize(JSON.parse(match[0]) as RawEstimate);
}

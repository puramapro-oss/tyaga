import Anthropic from '@anthropic-ai/sdk';

import 'server-only';

/**
 * TYAGA annonce assistée (EX-D1) : scan + estimation → titre + description +
 * tags. Le résultat est MONTRÉ à l'utilisateur avant toute insertion en DB :
 * ce module ne écrit jamais, il propose. La publication est un acte séparé
 * et explicite (EX-D2, cf /api/annonces).
 */

const LISTING_MODEL = process.env.ANTHROPIC_MODEL_MAIN || 'claude-sonnet-4-6';

export interface ListingInput {
  title: string;
  category: string;
  brand: string;
  model: string;
  condition: string;
  conditionLabel: string;
  priceCents: number;
  priceMinCents: number;
  priceMaxCents: number;
}

export interface ListingDraft {
  title: string;
  description: string;
  tags: string[];
}

const SYSTEM_PROMPT = `Tu es TYAGA, rédacteur d'annonces de revente pour le marché français de l'occasion (Vinted, Leboncoin).
On te décrit un objet estimé. Tu rédiges SON annonce de revente.
Réponds UNIQUEMENT en JSON valide, sans texte autour :
{
  "title": "<titre annonce, max 70 caractères, concret, sans emoji>",
  "description": "<description 60 à 120 mots : objet, état, atouts, usage, honnête (défauts cités si signalés)>",
  "tags": ["<5 tags max, minuscules, sans #, 1-2 mots chacun>"]
}
Règles strictes :
- Français naturel, ton factuel, PAS de markdown, PAS de majuscules criardes.
- Pas d'invention : n'ajoute aucun détail absent de la fiche (pas de "livré avec boîte" etc.).
- L'état et la marque doivent apparaître dans la description.
- Jamais le mot "garanti", jamais "assuré", jamais de promesse de vente ou de délai.`;

interface RawListing {
  title: string;
  description: string;
  tags: unknown;
}

/** Bornage défensif (même principe que estimate-ai) : l'IA propose, on cadre. */
function sanitize(raw: RawListing): ListingDraft {
  const strip = (s: unknown) =>
    String(s ?? '')
      // EX-C5/EX-D : aucune promesse de garantie ne doit atteindre l'UI
      .replace(/garanti\w*/gi, 'estimé')
      .replace(/\s+/g, ' ')
      .trim();

  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((t) => strip(t).toLowerCase().replace(/^#/, '').slice(0, 24))
        .filter((t) => t.length >= 2)
    : [];

  return {
    title: strip(raw.title).slice(0, 70) || 'Objet à vendre',
    description: strip(raw.description).slice(0, 1200),
    tags: [...new Set(tags)].slice(0, 5),
  };
}

export async function generateListing(input: ListingInput): Promise<ListingDraft> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!,
    timeout: 30_000, // borné, jamais de chargement infini
  });

  const euros = (cents: number) => (cents / 100).toLocaleString('fr-FR');

  const description = [
    `Objet : ${input.title || input.category || 'non nommé'}`,
    `Catégorie : ${input.category || 'non précisée'}`,
    `Marque : ${input.brand || 'inconnue'}`,
    `Modèle : ${input.model || 'inconnu'}`,
    `État : ${input.conditionLabel} (${input.condition})`,
    `Prix de vente souhaité : ${euros(input.priceCents)} € (fourchette estimée ${euros(input.priceMinCents)} – ${euros(input.priceMaxCents)} €)`,
  ].join('\n');

  const response = await client.messages.create({
    model: LISTING_MODEL,
    max_tokens: 700,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: description }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('LISTING_INVALID_RESPONSE');
  return sanitize(JSON.parse(match[0]) as RawListing);
}

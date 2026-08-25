import Anthropic from '@anthropic-ai/sdk';

import 'server-only';

/**
 * TYAGA vision : 3 photos → proposition catégorie / marque / modèle / état.
 * L'IA PROPOSE, l'utilisateur dispose (EX-B4). Sortie contrainte par Zod
 * côté route appelante — ce module ne fait que l'appel modèle.
 */

const VISION_MODEL = process.env.ANTHROPIC_MODEL_MAIN || 'claude-sonnet-4-6';

export interface ScanProposal {
  category: string;
  brand: string;
  model: string;
  condition: 'neuf' | 'excellent' | 'tres_bon' | 'bon' | 'satisfaisant' | 'a_reparer';
  condition_confidence: 'low' | 'medium' | 'high';
  hints: string;
}

export interface VisionPhoto {
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

const SYSTEM_PROMPT = `Tu es TYAGA, assistant de revente d'objets d'occasion.
On te donne 3 photos d'un même objet (face, dos, défaut/étiquette).
Réponds UNIQUEMENT en JSON valide, sans texte autour :
{
  "category": "catégorie courte en français (ex: sneakers, manteau, smartphone, livre, vélo)",
  "brand": "marque visible ou chaîne vide",
  "model": "modèle/référence visible ou chaîne vide",
  "condition": "neuf|excellent|tres_bon|bon|satisfaisant|a_reparer",
  "condition_confidence": "low|medium|high",
  "hints": "1 phrase max en français sur ce que tu as observé (usure, défaut, étiquette)"
}
Si une information n'est pas visible, mets une chaîne vide. Ne devine jamais une marque.`;

export async function analyzePhotos(photos: VisionPhoto[]): Promise<ScanProposal> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!,
    timeout: 30_000, // EX-B3 : borné, jamais de spinner infini
  });

  const content: Anthropic.MessageCreateParams['messages'][number]['content'] = [
    ...photos.map((p) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: p.mediaType, data: p.base64 },
    })),
    {
      type: 'text' as const,
      text: 'Analyse cet objet et réponds au format JSON demandé.',
    },
  ];

  const response = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Robustesse : extraire le JSON même si le modèle l'entoure de ```json
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('VISION_INVALID_RESPONSE');
  return JSON.parse(match[0]) as ScanProposal;
}

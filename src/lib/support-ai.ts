import Anthropic from '@anthropic-ai/sdk';

import 'server-only';

/**
 * Chatbot SAV (P4) — tier fast. Répond sur le périmètre RÉEL de TYAGA V1
 * uniquement ; ce qui sort du périmètre renvoie vers le contact humain.
 * La route appelante gère auth + rate limit + Zod — ce module fait l'appel.
 */

const FAST_MODEL = process.env.ANTHROPIC_MODEL_FAST || 'claude-haiku-4-5-20251001';

export interface SupportTurn {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `Tu es le service client de TYAGA, l'app qui aide à revendre ses objets d'occasion pour financer ses objectifs.
Réponds en français, ton chaleureux et sobre, 3 phrases maximum, pas de liste à puces sauf si indispensable.

Périmètre RÉEL de TYAGA V1 (ne promets rien d'autre) :
- Vendre : 3 photos de l'objet → TYAGA propose catégorie/marque/état et une fourchette de prix → annonce rédigée par IA, relue et publiée par le vendeur.
- Commission : 10% du prix de vente, affichée AVANT publication, jamais de frais caché. Le vendeur touche le net affiché.
- Paiement : Stripe, argent en séquestre — le vendeur est payé quand l'acheteur confirme la réception (ou automatiquement après livraison).
- Expédition V1 : pas de transporteur intégré — checklist d'emballage, l'adresse de livraison est communiquée au vendeur seulement après le paiement, suivi manuel (expédiée / reçue).
- Négociation : messagerie intégrée, le vendeur peut refuser une offre sous son prix plancher ; les messages qui tentent de contourner la plateforme (IBAN, PayPal, WhatsApp, téléphone…) sont bloqués.
- Points Vida : chaque vente terminée rapporte des points (1 point = 1 € de net, environnement bac à sable, aucun virement réel) répartis vers des objectifs.
- Fiscal : un compteur d'historique de ventes alerte dès 250 € de nets cumulés sur l'année (seuil de déclaration 305 €).
- Parrainage : code TY-XXXXXX, le parrain gagne 50% de la commission de la première vente de son filleul, en points.

Si la question sort de ce périmètre (litige d'argent, remboursement immédiat, suppression de compte, problème de connexion, réclamation) : dis que tu transmets au support humain et donne l'e-mail hello@tyaga.purama.dev (réponse sous 48 h). N'invente jamais une politique, un délai ou un chiffre qui n'est pas ci-dessus.`;

export async function answerSupport(
  message: string,
  history: SupportTurn[]
): Promise<string> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!,
    timeout: 20_000, // borné : jamais d'attente infinie côté client
  });

  const response = await client.messages.create({
    model: FAST_MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [
      ...history.slice(-6).map((t) => ({ role: t.role, content: t.content })),
      { role: 'user', content: message },
    ],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('réponse modèle vide');
  return text;
}

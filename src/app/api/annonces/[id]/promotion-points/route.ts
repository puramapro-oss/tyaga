import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  pointsPromotionTestOrigin, promotionPointsQuote, promotionPointsReceipt, promotionPointsReceiptHistory,
  promotionPurchaseRequest, promotionReceiptRequest,
} from '@/lib/promotion-points-test';
import { rateLimit } from '@/lib/rate-limit';
import { createServiceClient } from '@/lib/service';
import { createServerSupabaseClient } from '@/lib/supabase-server';

type ListingParams = { params: Promise<{ id: string }> };
const headers = { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie, Origin' };
const listingId = z.string().uuid();
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

async function listingActor(id: string, requirePublishedOwner: boolean) {
  try {
    const userDb = await createServerSupabaseClient();
    const { data: { user } } = await userDb.auth.getUser();
    if (!user) return { response: reply({ error: 'Connexion requise.' }, 401) };
    if (requirePublishedOwner) {
      const { data, error } = await userDb.from('annonces').select('id')
        .eq('id', id).eq('user_id', user.id).eq('status', 'published').maybeSingle();
      if (error) return { response: reply({ error: 'Vérification momentanément indisponible.' }, 503) };
      if (!data) return { response: reply({ error: 'Annonce indisponible.' }, 404) };
    }
    return { actor: user.id };
  } catch {
    return { response: reply({ error: 'Vérification momentanément indisponible.' }, 503) };
  }
}

async function pointsRpc(name: 'promotion_points_test_quote' | 'promotion_points_test_receipt' | 'purchase_promotion_with_test_points', args: Record<string, string>) {
  try {
    return await createServiceClient().rpc(name, args);
  } catch {
    return { data: null, error: { code: 'UNAVAILABLE' } };
  }
}

function requestOrigin(request: Request) {
  const target = pointsPromotionTestOrigin(process.env);
  return target && new URL(request.url).origin === target ? target : null;
}

export async function GET(request: Request, { params }: ListingParams) {
  const query = new URL(request.url).searchParams;
  const lookup = query.size > 0;
  if (!requestOrigin(request)) {
    return lookup ? reply({ error: 'Consultation de recette fermée.' }, 403) : reply({ quote: null });
  }
  const { id } = await params;
  if (!listingId.safeParse(id).success) return reply({ error: 'Annonce indisponible.' }, 404);
  const owner = await listingActor(id, !lookup);
  if (owner.response) return owner.response;
  if (lookup) {
    const keys = promotionReceiptRequest.safeParse(Object.fromEntries(query));
    if (!keys.success || query.size !== 2) return reply({ error: 'Référence de reçu invalide.' }, 400);
    const { data, error } = await pointsRpc('promotion_points_test_receipt', {
      p_listing: id, p_actor: owner.actor, p_tariff_id: keys.data.tariffId, p_request_id: keys.data.requestId,
    });
    if (error) return reply({ error: 'Vérification du reçu momentanément indisponible.' }, 503);
    if (data === null) return reply({ receipt: null });
    const receipt = promotionPointsReceiptHistory.safeParse(data);
    return receipt.success ? reply({ receipt: receipt.data }) : reply({ error: 'Reçu de recette illisible.' }, 503);
  }
  const { data, error } = await pointsRpc('promotion_points_test_quote', {
    p_listing: id, p_actor: owner.actor,
  });
  if (error) return reply({ error: 'Devis de recette momentanément indisponible.' }, 503);
  if (data === null) return reply({ quote: null });
  const quote = promotionPointsQuote.safeParse(data);
  return quote.success ? reply({ quote: quote.data }) : reply({ error: 'Devis de recette illisible.' }, 503);
}

export async function POST(request: Request, { params }: ListingParams) {
  const origin = requestOrigin(request);
  if (!origin) return reply({ error: 'Achat de recette fermé.' }, 403);
  if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    return reply({ error: 'Origine refusée.' }, 403);
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return reply({ error: 'Le corps doit être au format JSON.' }, 415);
  }
  const { id } = await params;
  if (!listingId.safeParse(id).success) return reply({ error: 'Annonce indisponible.' }, 404);
  const owner = await listingActor(id, true);
  if (owner.response) return owner.response;
  const limit = rateLimit('points-promotion:' + owner.actor, 30, 60 * 1000);
  if (!limit.ok) return NextResponse.json({ error: 'Réessaie dans un instant avec la même confirmation.' }, {
    status: 429, headers: { ...headers, 'Retry-After': String(limit.retryAfterSec) },
  });
  if (Number(request.headers.get('content-length')) > 2048) return reply({ error: 'Demande trop longue.' }, 413);
  const reader = request.body?.getReader();
  if (!reader) return reply({ error: 'Confirmation manquante.' }, 400);
  let text = '';
  let size = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let parsed: ReturnType<typeof promotionPurchaseRequest.safeParse>;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) {
        await reader.cancel();
        return reply({ error: 'Demande trop longue.' }, 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    parsed = promotionPurchaseRequest.safeParse(JSON.parse(text + decoder.decode()));
  } catch {
    return reply({ error: 'Confirmation illisible.' }, 400);
  } finally {
    reader.releaseLock();
  }
  if (!parsed.success) return reply({ error: 'Confirme le devis affiché avant cet achat.' }, 400);

  const { data, error } = await pointsRpc('purchase_promotion_with_test_points', {
    p_listing: id, p_actor: owner.actor, p_tariff_id: parsed.data.tariffId, p_request_id: parsed.data.requestId,
  });
  if (error?.code === '23505') return reply({ code: 'REQUEST_CONFLICT', error: 'Cette confirmation appartient déjà à une autre demande.' }, 409);
  if (error?.code === '23514') return reply({ code: 'TERMS_UNAVAILABLE', error: 'Le devis, le solde autorisé ou le bon est indisponible. Relis le devis.' }, 409);
  if (error?.code === '42501') return reply({ error: 'Cette opération est réservée aux participants de recette autorisés.' }, 403);
  if (error) return reply({ error: 'Résultat à vérifier. Réessaie avec la même confirmation.' }, 503);
  const receipt = promotionPointsReceipt.safeParse(data);
  return receipt.success ? reply({ receipt: receipt.data }) :
    reply({ error: 'Reçu à vérifier. Réessaie avec la même confirmation.' }, 503);
}

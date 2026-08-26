import { NextResponse } from 'next/server';
import { z } from 'zod';

import { answerSupport, type SupportTurn } from '@/lib/support-ai';
import { rateLimit } from '@/lib/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * P4 — Chatbot SAV. Auth requise, rate limit 20 req/h/user, historique
 * borné côté client ET côté serveur (6 tours). Hors périmètre IA →
 * message FR avec contact humain, jamais d'erreur brute.
 */

export const maxDuration = 30;

const turnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(2000),
});

const bodySchema = z.object({
  message: z.string().min(1, 'Pose une question.').max(2000),
  history: z.array(turnSchema).max(6).default([]),
});

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Connecte-toi pour discuter avec le support.' },
      { status: 401 }
    );
  }

  const limit = rateLimit(`support:${user.id}`, 20, 60 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: `Trop de questions d'un coup — réessaie dans ${limit.retryAfterSec} min ou écris à hello@tyaga.purama.dev.`,
      },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Requête illisible.' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Question invalide (2000 caractères max).' },
      { status: 400 }
    );
  }

  try {
    const answer = await answerSupport(
      parsed.data.message,
      parsed.data.history satisfies SupportTurn[]
    );
    return NextResponse.json({ answer });
  } catch {
    return NextResponse.json(
      {
        error:
          "L'assistant est momentanément indisponible. Écris-nous à hello@tyaga.purama.dev — réponse sous 48 h.",
      },
      { status: 503 }
    );
  }
}

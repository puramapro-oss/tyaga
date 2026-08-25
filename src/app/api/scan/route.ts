import { createHash } from 'crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { analyzePhotos } from '@/lib/claude';
import { rateLimit } from '@/lib/rate-limit';
import { createServiceClient } from '@/lib/service';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * EX-B — Scan : upload 3 photos + analyse IA vision.
 * POST : photos → storage + preuves sha256 → proposition IA (jamais imposée).
 * PUT  : enregistre les champs VALIDÉS/MODIFIÉS par l'utilisateur → statut scanned.
 */

export const maxDuration = 60;

const ANGLES = ['face', 'dos', 'defaut'] as const;
const MAX_BYTES = 10 * 1024 * 1024;
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const saveSchema = z.object({
  itemId: z.string().uuid(),
  category: z.string().trim().max(80),
  brand: z.string().trim().max(80),
  model: z.string().trim().max(80),
  condition: z.enum([
    'neuf',
    'excellent',
    'tres_bon',
    'bon',
    'satisfaisant',
    'a_reparer',
  ]),
  title: z.string().trim().max(120).optional(),
});

export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Connecte-toi pour scanner un objet.' },
        { status: 401 }
      );
    }

    const limit = rateLimit(`scan:${user.id}`, 10, 60 * 60 * 1000);
    if (!limit.ok) {
      return NextResponse.json(
        {
          error: `Trop de scans pour l'instant. Réessaie dans ${limit.retryAfterSec} secondes.`,
        },
        { status: 429 }
      );
    }

    const form = await request.formData();
    const files: { angle: string; file: File }[] = [];
    for (const angle of ANGLES) {
      const file = form.get(angle);
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json(
          {
            error: `Photo « ${angle} » manquante. Ajoute les 3 photos (face, dos, défaut/étiquette).`,
          },
          { status: 400 }
        );
      }
      files.push({ angle, file });
    }

    for (const { file } of files) {
      const ext = MIME_EXT[file.type];
      if (!ext) {
        return NextResponse.json(
          { error: 'Format non supporté. Utilise JPG, PNG ou WebP.' },
          { status: 400 }
        );
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json(
          { error: 'Une photo dépasse 10 Mo. Compresse-la et réessaie.' },
          { status: 400 }
        );
      }
    }

    // Item draft : les photos et preuves sont conservées même si l'IA échoue.
    const { data: item, error: itemError } = await supabase
      .from('items')
      .insert({ user_id: user.id })
      .select('id')
      .single();
    if (itemError || !item) {
      return NextResponse.json(
        { error: 'Impossible de créer l\'objet. Réessaie dans un instant.' },
        { status: 500 }
      );
    }

    const service = createServiceClient();
    const visionPhotos: Parameters<typeof analyzePhotos>[0] = [];

    for (const { angle, file } of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      const ext = MIME_EXT[file.type];
      const path = `${user.id}/${item.id}/${angle}.${ext}`;

      const { error: upError } = await service.storage
        .from('tyaga-photos')
        .upload(path, buffer, { contentType: file.type, upsert: true });
      if (upError) {
        return NextResponse.json(
          {
            error:
              'Échec de l\'enregistrement des photos. Vérifie ta connexion et réessaie.',
          },
          { status: 500 }
        );
      }

      const { error: photoError } = await supabase.from('item_photos').insert({
        item_id: item.id,
        user_id: user.id,
        storage_path: path,
        angle,
        position: ANGLES.indexOf(angle as (typeof ANGLES)[number]),
        sha256,
        captured_at: new Date(file.lastModified || Date.now()).toISOString(),
      });
      if (photoError) {
        return NextResponse.json(
          { error: 'Preuve photo non enregistrée. Réessaie le scan.' },
          { status: 500 }
        );
      }

      visionPhotos.push({
        base64: buffer.toString('base64'),
        mediaType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
      });
    }

    try {
      const proposal = await analyzePhotos(visionPhotos);
      return NextResponse.json({ itemId: item.id, proposal });
    } catch {
      // Photos + sha256 conservés : l'utilisateur relance sans tout recharger.
      return NextResponse.json(
        {
          itemId: item.id,
          proposal: null,
          message:
            'Photos enregistrées, mais TYAGA n\'a pas réussi à les analyser. Relance l\'analyse dans un instant.',
        },
        { status: 200 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: 'Erreur inattendue pendant le scan. Réessaie.' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Connecte-toi pour enregistrer un objet.' },
        { status: 401 }
      );
    }

    const body = saveSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json(
        { error: 'Certains champs sont invalides. Vérifie catégorie et état.' },
        { status: 400 }
      );
    }

    const { itemId, ...fields } = body.data;
    const { data: item, error } = await supabase
      .from('items')
      .update({
        category: fields.category || null,
        brand: fields.brand || null,
        model: fields.model || null,
        condition: fields.condition,
        title: fields.title || null,
        status: 'scanned',
      })
      .eq('id', itemId)
      .eq('user_id', user.id) // RLS : uniquement son objet
      .select('id, title, category, brand, model, condition, status')
      .single();

    if (error || !item) {
      return NextResponse.json(
        { error: 'Objet introuvable ou non enregistrable. Réessaie.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ item });
  } catch {
    return NextResponse.json(
      { error: 'Erreur inattendue à l\'enregistrement. Réessaie.' },
      { status: 500 }
    );
  }
}

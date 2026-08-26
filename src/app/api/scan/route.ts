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
type SniffedImageType = 'image/jpeg' | 'image/png' | 'image/webp';

const MIME_EXT: Record<SniffedImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Jury bugs P6 : le Content-Type déclaré par le client est une parole, pas un
 * fait — on tranche sur les octets (magic bytes) avant d'exposer le fichier au
 * storage ou à l'API vision.
 */
function sniffImageType(buf: Buffer): SniffedImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

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

    // Octets lus UNE fois : la validation comme l'upload partagent le buffer.
    const photos: {
      angle: string;
      buffer: Buffer;
      type: SniffedImageType;
      capturedAt: string;
    }[] = [];
    for (const { angle, file } of files) {
      if (file.size > MAX_BYTES) {
        return NextResponse.json(
          { error: 'Une photo dépasse 10 Mo. Compresse-la et réessaie.' },
          { status: 400 }
        );
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const type = sniffImageType(buffer);
      if (!type) {
        return NextResponse.json(
          { error: 'Format non supporté. Utilise JPG, PNG ou WebP.' },
          { status: 400 }
        );
      }
      photos.push({
        angle,
        buffer,
        type,
        capturedAt: new Date(file.lastModified || Date.now()).toISOString(),
      });
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

    for (const { angle, buffer, type, capturedAt } of photos) {
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      const ext = MIME_EXT[type];
      const path = `${user.id}/${item.id}/${angle}.${ext}`;

      const { error: upError } = await service.storage
        .from('tyaga-photos')
        .upload(path, buffer, { contentType: type, upsert: true });
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
        captured_at: capturedAt,
      });
      if (photoError) {
        return NextResponse.json(
          { error: 'Preuve photo non enregistrée. Réessaie le scan.' },
          { status: 500 }
        );
      }

      visionPhotos.push({
        base64: buffer.toString('base64'),
        mediaType: type,
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

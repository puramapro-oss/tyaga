import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import 'server-only';

/** Client serveur côté requête utilisateur (respecte la RLS). */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA || 'tyaga' },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Appelé depuis un Server Component : ignorable si le
            // middleware rafraîchit déjà les sessions.
          }
        },
      },
    }
  );
}

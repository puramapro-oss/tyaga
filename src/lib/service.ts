import { createClient } from '@supabase/supabase-js';

import 'server-only';

/**
 * Client service_role — UNIQUEMENT pour les opérations que la RLS ne peut
 * pas couvrir (upload storage depuis le serveur, lecture de preuves).
 * Toujours appelé côté serveur ; le chemin est construit avec l'uuid user
 * fourni par la session, jamais par une entrée client.
 */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA || 'tyaga' } }
  );
}

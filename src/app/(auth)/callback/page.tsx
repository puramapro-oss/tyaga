'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { createClient } from '@/lib/supabase';

/**
 * Fin de parcours OAuth / confirmation e-mail : échange le code contre une
 * session puis redirige. Un seul essai garanti par le ref (React 18 double
 * montage en dev).
 */
function CallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(false);

  useEffect(() => {
    if (tried.current) return;
    tried.current = true;

    const code = searchParams.get('code');
    const next = searchParams.get('next') || '/dashboard';
    if (!code) {
      setError('Lien de connexion incomplet. Redémarre la connexion.');
      return;
    }
    createClient()
      .auth.exchangeCodeForSession(code)
      .then(({ error: exchangeError }) => {
        if (exchangeError) {
          setError(
            `Connexion impossible (${exchangeError.message}). Redémarre la connexion.`
          );
          return;
        }
        router.push(next);
        router.refresh();
      });
  }, [router, searchParams]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <p className="text-sm text-foreground-muted">
        {error ?? 'Connexion en cours…'}
      </p>
    </main>
  );
}

export default function CallbackPage() {
  return (
    <Suspense>
      <CallbackInner />
    </Suspense>
  );
}

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { internalRedirectPath } from '@/lib/auth-redirect';
import { createClient } from '@/lib/supabase';

/**
 * Fin de parcours OAuth / confirmation e-mail : échange le code contre une
 * session puis redirige. La promesse partagée évite de consommer deux fois
 * le code lors de la reprise des effets en StrictMode.
 */
function CallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    // Redirection interne uniquement : un `next` externe (//evil.com, https://…)
    // serait une ouverture de redirection après connexion.
    const next = internalRedirectPath(searchParams.get('next'));
    if (!code) {
      setError('Lien de connexion incomplet. Redémarre la connexion.');
      return;
    }
    if (!attempt.current) {
      const authCode = code;
      attempt.current = (async () => {
        try {
          const { data, error: exchangeError } = await createClient().auth.exchangeCodeForSession(authCode);
          return !exchangeError && Boolean(data.session && data.user?.id);
        } catch {
          return false;
        }
      })();
    }

    let active = true;
    async function complete() {
      try {
        const authenticated = await attempt.current;
        if (!active) return;
        if (!authenticated) {
          setError('Connexion impossible. Redémarre la connexion.');
          return;
        }
        router.push(next);
        router.refresh();
      } catch {
        if (active) setError('Connexion impossible. Redémarre la connexion.');
      }
    }
    void complete();
    return () => { active = false; };
  }, [router, searchParams]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <p role={error ? 'alert' : 'status'} className="text-sm text-foreground-muted">
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

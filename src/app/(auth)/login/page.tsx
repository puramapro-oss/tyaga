'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import AuthShell from '@/components/auth/AuthShell';
import {
  EmailField,
  ErrorBanner,
  GoogleButton,
  PasswordField,
  SubmitButton,
} from '@/components/auth/AuthFields';
import { authContinuationHref, internalRedirectPath } from '@/lib/auth-redirect';
import { createClient } from '@/lib/supabase';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Redirection interne uniquement (anti open redirect après connexion)
  const next = internalRedirectPath(searchParams.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (authError) {
      setLoading(false);
      setError(
        authError.message === 'Invalid login credentials'
          ? 'E-mail ou mot de passe incorrect. Vérifie tes identifiants ou crée un compte.'
          : authError.message === 'Email not confirmed'
            ? 'Adresse non confirmée. Ouvre le lien reçu par e-mail, puis reconnecte-toi.'
            : `Connexion impossible (${authError.message}). Réessaie dans un instant.`
      );
      return;
    }
    router.push(next);
    router.refresh();
  }

  async function handleGoogle() {
    setError(null);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + authContinuationHref('/callback', next),
      },
    });
  }

  return (
    <AuthShell
      title="Se connecter"
      subtitle="Retrouve tes annonces, tes ventes et ton solde Vida."
    >
      {error && <ErrorBanner message={error} />}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <EmailField value={email} onChange={setEmail} disabled={loading} />
        <PasswordField
          value={password}
          onChange={setPassword}
          disabled={loading}
        />
        <SubmitButton label="Se connecter" loading={loading} />
      </form>
      <GoogleButton onClick={handleGoogle} disabled={loading} />
      <div className="flex items-center justify-between text-sm">
        <Link href="/forgot-password" className="link-nav">
          Mot de passe oublié
        </Link>
        <span className="text-foreground-secondary">
          Pas de compte ?{' '}
          <Link href={authContinuationHref('/signup', next)} className="link-action">
            Créer un compte
          </Link>
        </span>
      </div>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

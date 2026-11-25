'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

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
import { REFERRAL_STORAGE_KEY } from '@/lib/referral';

function SignupForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [viaReferral, setViaReferral] = useState(false);
  const supabase = createClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const next = internalRedirectPath(searchParams.get('next'));

  // Parrainage : le lien d'invitation survit à la confirmation email et à
  // l'OAuth Google (redirections) via sessionStorage — le dashboard consomme.
  useEffect(() => {
    const ref = searchParams.get('ref');
    if (ref && ref.length >= 4 && ref.length <= 12) {
      try {
        sessionStorage.setItem(REFERRAL_STORAGE_KEY, ref.toUpperCase());
        setViaReferral(true);
      } catch {
        // Navigation privée stricte : sans stockage, la saisie manuelle reste possible
      }
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    if (password.length < 8) {
      setError('Choisis un mot de passe d’au moins 8 caractères.');
      return;
    }
    setLoading(true);
    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin + authContinuationHref('/callback', next),
      },
    });
    setLoading(false);
    if (authError) {
      setError(
        authError.message === 'User already registered'
          ? 'Un compte existe déjà avec cette adresse. Connecte-toi plutôt.'
          : `Inscription impossible (${authError.message}). Réessaie dans un instant.`
      );
      return;
    }
    if (data?.session && data.user?.id) {
      router.replace(next);
      router.refresh();
      return;
    }
    setSent(true);
  }

  async function handleGoogle() {
    setError(null);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + authContinuationHref('/callback', next) },
    });
  }

  if (sent) {
    return (
      <AuthShell
        title="Vérifie ta boîte mail"
        subtitle={`Un lien de confirmation vient d'être envoyé à ${email}. Ouvre-le pour activer ton compte.`}
      >
        <Link
          href={authContinuationHref('/login', next)}
          className="link-nav flex h-12 items-center justify-center rounded-pill border border-border-control font-medium"
        >
          Retour à la connexion
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Créer un compte"
      subtitle="Vends ce qui t’encombre, Vida encaisse pour tes objectifs."
    >
      {error && <ErrorBanner message={error} />}
      {viaReferral && !error && (
        <p className="rounded-md border border-border-control bg-surface-raised px-4 py-3 text-sm text-foreground-secondary">
          Invitation de parrain détectée — ton parrain sera lié à ton compte à
          la première connexion.
        </p>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <EmailField value={email} onChange={setEmail} disabled={loading} />
        <PasswordField
          value={password}
          onChange={setPassword}
          disabled={loading}
          autoComplete="new-password"
          label="Mot de passe (8 caractères min.)"
          minLength={8}
        />
        <PasswordField
          value={confirm}
          onChange={setConfirm}
          disabled={loading}
          autoComplete="new-password"
          label="Confirmer le mot de passe"
        />
        <SubmitButton label="Créer mon compte" loading={loading} />
      </form>
      <GoogleButton onClick={handleGoogle} disabled={loading} />
      <p className="text-center text-xs leading-relaxed text-foreground-muted">
        En créant un compte, tu acceptes les{' '}
        <Link href="/legal/cgu" className="link-action text-xs">
          CGU
        </Link>{' '}
        et la{' '}
        <Link href="/legal/politique-confidentialite" className="link-action text-xs">
          politique de confidentialité
        </Link>
        .
      </p>
      <p className="text-center text-sm text-foreground-secondary">
        Déjà un compte ?{' '}
        <Link href={authContinuationHref('/login', next)} className="link-action">
          Se connecter
        </Link>
      </p>
    </AuthShell>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}

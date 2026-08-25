'use client';

import Link from 'next/link';
import { useState } from 'react';

import AuthShell from '@/components/auth/AuthShell';
import { EmailField, ErrorBanner, SubmitButton } from '@/components/auth/AuthFields';
import { createClient } from '@/lib/supabase';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      { redirectTo: `${window.location.origin}/callback` }
    );
    setLoading(false);
    if (resetError) {
      setError(
        `Envoi impossible (${resetError.message}). Vérifie ton adresse et réessaie.`
      );
      return;
    }
    setSent(true);
  }

  return (
    <AuthShell
      title="Mot de passe oublié"
      subtitle="Nous t'envoyons un lien pour choisir un nouveau mot de passe."
    >
      {error && <ErrorBanner message={error} />}
      {sent ? (
        <p className="rounded-md border border-border px-4 py-3 text-sm text-foreground-muted">
          Si un compte existe pour {email}, le lien de réinitialisation arrive
          dans ta boîte mail.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <EmailField value={email} onChange={setEmail} disabled={loading} />
          <SubmitButton label="Envoyer le lien" loading={loading} />
        </form>
      )}
      <Link href="/login" className="link-nav text-center text-sm">
        Retour à la connexion
      </Link>
    </AuthShell>
  );
}

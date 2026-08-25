'use client';

/**
 * Champs + boutons partagés login/signup (client). Les gestionnaires
 * d'envoi restent dans chaque page — seule la présentation est factorisée.
 */
import { Loader2 } from 'lucide-react';

export function EmailField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      <span className="text-foreground-muted">Adresse e-mail</span>
      <input
        type="email"
        required
        autoComplete="email"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="prenom@exemple.fr"
        className="h-12 rounded-md border border-border-control bg-background-soft px-4 text-foreground placeholder:text-foreground-secondary focus:border-primary disabled:opacity-50"
      />
    </label>
  );
}

export function PasswordField({
  value,
  onChange,
  disabled,
  autoComplete = 'current-password',
  label = 'Mot de passe',
  minLength,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  autoComplete?: string;
  label?: string;
  minLength?: number;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      <span className="text-foreground-muted">{label}</span>
      <input
        type="password"
        required
        autoComplete={autoComplete}
        value={value}
        disabled={disabled}
        minLength={minLength}
        onChange={(e) => onChange(e.target.value)}
        placeholder="••••••••"
        className="h-12 rounded-md border border-border-control bg-background-soft px-4 text-foreground placeholder:text-foreground-secondary focus:border-primary disabled:opacity-50"
      />
    </label>
  );
}

export function GoogleButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-12 items-center justify-center gap-3 rounded-pill border border-border-control bg-background-soft font-medium transition-colors hover:border-foreground-secondary disabled:opacity-50"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
        <path
          fill="#4285F4"
          d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.3h6.5c-.1 1.1-.8 2.7-2.4 3.8l-.1.1 3.5 2.7.2.1c2.2-2.1 3.8-5.1 3.8-8.8"
        />
        <path
          fill="#34A853"
          d="M12 24c3.2 0 5.9-1.1 7.7-2.9l-3.7-2.9c-1 .7-2.3 1.2-4 1.2-3.1 0-5.8-2.1-6.7-5l-.1.1-3.6 2.8-.1.2C3.3 21.3 7.3 24 12 24"
        />
        <path
          fill="#FBBC05"
          d="M5.3 14.4c-.3-.7-.4-1.5-.4-2.4s.2-1.7.4-2.4V9.5L1.6 6.7l-.1.2C.6 8.4 0 10.1 0 12s.6 3.6 1.5 5.1l3.8-2.7"
        />
        <path
          fill="#EA4335"
          d="M12 4.7c2.2 0 3.7.9 4.5 1.7l3.3-3.2C17.9 1.2 15.2 0 12 0 7.3 0 3.3 2.7 1.5 6.7l3.8 2.9c.9-2.9 3.6-4.9 6.7-4.9"
        />
      </svg>
      Continuer avec Google
    </button>
  );
}

export function SubmitButton({
  label,
  loading,
}: {
  label: string;
  loading: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="flex h-12 items-center justify-center gap-2 rounded-pill bg-primary font-medium text-primary-on-dark transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
    >
      {loading && <Loader2 size={18} className="animate-spin" />}
      {label}
    </button>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-alert/40 bg-alert/10 px-4 py-3 text-sm text-foreground"
    >
      {message}
    </p>
  );
}

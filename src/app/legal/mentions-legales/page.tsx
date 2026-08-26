import type { Metadata } from 'next';

import LegalShell, { LegalSection } from '../LegalShell';
import { COMPANY_INFO } from '@/lib/constants';

export const metadata: Metadata = {
  title: 'Mentions légales — TYAGA',
  description: 'Mentions légales de TYAGA, édité par SASU PURAMA.',
};

export default function MentionsLegalesPage() {
  return (
    <LegalShell
      title="Mentions légales"
      intro="Informations légales relatives au site tyaga.purama.dev, édité par PURAMA."
    >
      <LegalSection h="Éditeur du site">
        <p>
          {COMPANY_INFO.name} — {COMPANY_INFO.address}, France.
        </p>
        <p>
          Directeur de la publication : le représentant légal de la{' '}
          {COMPANY_INFO.name}.
        </p>
        <p>
          {COMPANY_INFO.legal}. Contact :{' '}
          <a
            href="mailto:hello@tyaga.purama.dev"
            className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-primary"
          >
            hello@tyaga.purama.dev
          </a>{' '}
          (réponse sous 48 h, du lundi au samedi).
        </p>
      </LegalSection>

      <LegalSection h="Hébergement">
        <p>
          Vercel Inc. — 440 N Barranca Ave #4133, Covina, CA 91723,
          États-Unis —{' '}
          <a
            href="https://vercel.com"
            className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-primary"
          >
            vercel.com
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection h="Propriété intellectuelle">
        <p>
          Le nom TYAGA, la marque PURAMA, le logo, les textes et l’interface du
          site sont protégés par le droit de la propriété intellectuelle. Toute
          reproduction sans autorisation est interdite.
        </p>
        <p>
          Les photos et les annonces que tu publies restent ta propriété : tu
          nous autorises, le temps de la mise en ligne, à les afficher sur la
          marketplace pour permettre la vente.
        </p>
      </LegalSection>

      <LegalSection h="Données personnelles">
        <p>
          Le traitement de tes données est décrit dans notre{' '}
          <a
            href="/legal/politique-confidentialite"
            className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-primary"
          >
            politique de confidentialité
          </a>
          .
        </p>
      </LegalSection>
    </LegalShell>
  );
}

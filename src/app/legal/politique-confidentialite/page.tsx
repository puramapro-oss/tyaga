import type { Metadata } from 'next';

import LegalShell, { LegalSection } from '../LegalShell';

export const metadata: Metadata = {
  title: 'Politique de confidentialité — TYAGA',
  description: 'Comment TYAGA traite tes données personnelles (RGPD).',
};

export default function ConfidentialitePage() {
  return (
    <LegalShell
      title="Politique de confidentialité"
      intro="Cette politique explique quelles données TYAGA collecte, pourquoi, qui y accède, et quels sont tes droits."
    >
      <LegalSection h="1. Responsable du traitement">
        <p>
          SASU PURAMA, 8 Rue Chapelle, 25560 Frasne, France — contact :
          hello@tyaga.purama.dev.
        </p>
      </LegalSection>

      <LegalSection h="2. Données collectées">
        <p>
          <strong className="text-foreground">Compte :</strong> ton adresse
          e-mail et ton mot de passe (jamais stocké en clair), ton pseudo et
          tes préférences d’affichage.
        </p>
        <p>
          <strong className="text-foreground">Ventes :</strong> les photos de
          tes objets, tes annonces et estimations, tes commandes et ventes,
          tes messages avec l’autre partie.
        </p>
        <p>
          <strong className="text-foreground">Points et parrainage :</strong>{' '}
          ton solde de points Vida, tes objectifs et leurs répartitions, ton
          code de parrainage et tes filleuls.
        </p>
        <p>
          <strong className="text-foreground">Paiement :</strong> les
          transactions passent par Stripe ; TYAGA ne stocke jamais ton numéro
          de carte.
        </p>
        <p>
          <strong className="text-foreground">Sécurité :</strong> journaux
          techniques (connexions, erreurs) conservés 13 mois au maximum.
        </p>
      </LegalSection>

      <LegalSection h="3. Pourquoi (finalités et bases légales)">
        <p>
          Fournir le service — compte, annonces, ventes, séquestre — sur la
          base de l’exécution du contrat. Prévenir la fraude et bloquer les
          contournements de paiement, sur la base de l’intérêt légitime.
          Conserver la trace comptable des ventes, sur la base de l’obligation
          légale.
        </p>
      </LegalSection>

      <LegalSection h="4. Tes photos et l’IA">
        <p>
          Les photos que tu envoies sont analysées par un modèle d’IA le temps
          de produire ton annonce (catégorie, état, description, fourchette de
          prix). Elles ne sont pas utilisées pour entraîner des modèles et ne
          sont visibles sur la marketplace que si tu publies l’annonce.
        </p>
      </LegalSection>

      <LegalSection h="5. Qui accède aux données">
        <p>
          Nous ne vendons aucune donnée. Nos sous-traitants : l’infrastructure
          de l’écosystème PURAMA (base de données et authentification,
          auth.purama.dev, Union européenne), Vercel (hébergement du site,
          États-Unis — EU-US Data Privacy Framework) et Stripe (paiement et
          séquestre).
        </p>
      </LegalSection>

      <LegalSection h="6. Durées de conservation">
        <p>
          Les données sont conservées tant que ton compte est actif. À ta
          demande de suppression, elles sont effacées sous 30 jours, sauf les
          ventes déjà réalisées, conservées de façon anonymisée pour
          l’obligation comptable.
        </p>
      </LegalSection>

      <LegalSection h="7. Tes droits">
        <p>
          Accès, rectification, effacement, limitation, opposition et
          portabilité : écris à hello@tyaga.purama.dev depuis l’adresse de ton
          compte — réponse sous un mois. Tu peux aussi saisir la CNIL
          (cnil.fr).
        </p>
      </LegalSection>

      <LegalSection h="8. Cookies">
        <p>
          TYAGA n’utilise aucun cookie publicitaire ni traceur tiers. Seuls
          des cookies strictement nécessaires maintiennent ta session
          connectée.
        </p>
      </LegalSection>

      <LegalSection h="9. Sécurité">
        <p>
          Les échanges sont chiffrés (HTTPS), chaque compte n’accède qu’à ses
          propres données (Row Level Security en base), et les secrets
          techniques restent côté serveur.
        </p>
      </LegalSection>
    </LegalShell>
  );
}

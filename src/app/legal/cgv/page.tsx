import type { Metadata } from 'next';

import LegalShell, { LegalSection } from '../LegalShell';

export const metadata: Metadata = {
  title: 'CGV — TYAGA',
  description: 'Conditions générales de vente de TYAGA (côté acheteur).',
};

export default function CgvPage() {
  return (
    <LegalShell
      title="Conditions générales de vente"
      intro="Ces conditions s’appliquent quand tu achètes un objet sur TYAGA. Elles s’ajoutent aux conditions générales d’utilisation."
    >
      <LegalSection h="1. Ce que tu achètes">
        <p>
          Les objets proposés sur TYAGA sont des objets d’occasion vendus par
          des particuliers. La vente est conclue entre toi et le vendeur :
          l’annonce (photos, description, état) engage le vendeur, et TYAGA
          sécurise la transaction.
        </p>
      </LegalSection>

      <LegalSection h="2. Prix et commande">
        <p>
          Le prix payé est celui affiché sur l’annonce au moment de la
          commande. Ta commande est enregistrée dès le paiement validé, et le
          vendeur en est informé.
        </p>
      </LegalSection>

      <LegalSection h="3. Paiement sécurisé">
        <p>
          Tu paies par carte via Stripe. Les fonds sont mis en séquestre : le
          vendeur n’en dispose pas tant que la transaction n’est pas terminée.
        </p>
      </LegalSection>

      <LegalSection h="4. Livraison">
        <p>
          C’est le vendeur, particulier, qui expédie avec le transporteur de
          son choix et marque la commande « expédiée ». Tu suis chaque étape
          depuis la page Commandes. Aucun délai de livraison garanti n’est
          promis par TYAGA.
        </p>
      </LegalSection>

      <LegalSection h="5. Réception et libération du séquestre">
        <p>
          Dès réception, tu confirmes dans l’app : le paiement est libéré vers
          le vendeur. Si tu ne confirmes pas, la commande se clôt
          automatiquement après le délai de confirmation et le paiement est
          libéré.
        </p>
      </LegalSection>

      <LegalSection h="6. Litiges et remboursements">
        <p>
          Objet non reçu, cassé à la réception, ou très différent de son
          annonce : écris à hello@tyaga.purama.dev sans confirmer la
          réception. Tant qu’un litige est ouvert, les fonds restent bloqués ;
          après examen, la commande est annulée et tu es remboursé sur la carte
          utilisée, ou le paiement est libéré au vendeur.
        </p>
      </LegalSection>

      <LegalSection h="7. Rétractation">
        <p>
          Les ventes sur TYAGA se font entre particuliers : le vendeur n’étant
          pas un professionnel, le droit légal de rétractation de 14 jours
          (art. L221-18 du code de la consommation) ne s’applique pas. Ta
          protection repose sur le paiement séquestré, bloqué jusqu’à ta
          confirmation de réception, et sur le traitement des litiges par le
          support.
        </p>
      </LegalSection>

      <LegalSection h="8. Droit applicable">
        <p>
          Ces conditions sont soumises au droit français. En cas de litige,
          écris d’abord à hello@tyaga.purama.dev — réponse sous 48 h, du lundi
          au samedi. À défaut d’accord amiable, recours gratuit au médiateur
          de la consommation, puis aux tribunaux compétents du domicile du
          consommateur.
        </p>
      </LegalSection>
    </LegalShell>
  );
}

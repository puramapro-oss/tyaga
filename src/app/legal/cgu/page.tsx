import type { Metadata } from 'next';

import LegalShell, { LegalSection } from '../LegalShell';

export const metadata: Metadata = {
  title: 'CGU — TYAGA',
  description: 'Conditions générales d’utilisation de TYAGA.',
};

export default function CguPage() {
  return (
    <LegalShell
      title="Conditions générales d’utilisation"
      intro="Ces conditions encadrent l’utilisation de TYAGA, la marketplace d’occasion de l’écosystème PURAMA. En créant un compte, tu les acceptes."
    >
      <LegalSection h="1. Objet de TYAGA">
        <p>
          TYAGA est une plateforme de vente d’objets d’occasion{' '}
          <strong className="text-foreground">entre particuliers</strong> :
          elle t’aide à créer ton annonce à partir de photos (catégorie, marque,
          état, fourchette de prix), met en relation acheteur et vendeur, et
          sécurise le paiement.
        </p>
        <p>
          Les ventes sont conclues entre particuliers. La SASU PURAMA n’est pas
          partie au contrat de vente : elle édite la plateforme, fournit
          l’assistance d’annonce et le service de paiement séquestré,
          rémunéré par une commission sur les ventes complétées.
        </p>
      </LegalSection>

      <LegalSection h="2. Ton compte">
        <p>
          Tu dois avoir au moins 16 ans et fournir une adresse e-mail valide.
          Tu es responsable de la confidentialité de ton mot de passe et de
          l’activité de ton compte. Un compte par personne.
        </p>
      </LegalSection>

      <LegalSection h="3. Ce que tu peux vendre">
        <p>
          Uniquement des objets que tu possèdes, licites et expédiables. Sont
          interdits notamment : les contrefaçons, les biens volés, les produits
          dangereux ou réglementés, les objets qui ne t’appartiennent pas.
        </p>
        <p>
          Chaque annonce est relue avant publication : TYAGA peut refuser ou
          retirer une annonce qui ne respecte pas ces règles, sans que ce
          refus ouvre droit à indemnisation.
        </p>
        <p>
          Le titre et la description de l’annonce sont proposés par
          l’intelligence artificielle de TYAGA à partir de tes photos, puis
          modifiables avant publication : tu restes responsable de leur
          exactitude et de la conformité de l’annonce.
        </p>
      </LegalSection>

      <LegalSection h="4. Commission">
        <p>
          TYAGA prélève une commission de 10 % du prix de vente, uniquement si
          l’objet se vend. Elle est affichée — avec le net vendeur exact —
          avant la publication de l’annonce. Aucun frais d’inscription, aucun
          frais caché.
        </p>
      </LegalSection>

      <LegalSection h="5. Paiement et séquestre">
        <p>
          L’acheteur paie par carte via Stripe. Les fonds restent en séquestre
          pendant l’expédition, puis sont libérés vers le vendeur quand
          l’acheteur confirme la réception — ou à la clôture automatique de la
          commande. En cas de litige signalé au support, les fonds restent
          bloqués jusqu’à sa résolution.
        </p>
        <p>
          Passer par la plateforme est obligatoire : payer ou être payé hors
          plateforme fait perdre à la fois la protection acheteur et la
          sécurisation du paiement vendeur.
        </p>
      </LegalSection>

      <LegalSection h="6. Expédition">
        <p>
          C’est le vendeur qui expédie, avec le transporteur de son choix, puis
          marque la commande « expédiée ». L’adresse de livraison de l’acheteur
          est communiquée au vendeur uniquement après le paiement.
        </p>
      </LegalSection>

      <LegalSection h="7. Messages et sécurité">
        <p>
          Les échanges passent par la messagerie de TYAGA. Les messages qui
          tentent de contourner la plateforme (IBAN, RIB, PayPal, WhatsApp,
          Telegram, numéro de téléphone, e-mail…) sont bloqués : c’est une
          protection contre la fraude, pas une censure.
        </p>
      </LegalSection>

      <LegalSection h="8. Points Vida et parrainage">
        <p>
          Chaque vente terminée crédite des points Vida : 1 point = 1 € de net
          vendeur. Les points forment un programme de fidélité : ils n’ont pas
          de valeur monétaire légale et ne sont pas retirable en euros dans
          cette version. Le programme et ses règles peuvent évoluer.
        </p>
        <p>
          Parrainage : quand une personne parrainée avec ton code complète sa
          première vente, tu reçois 50 % de la commission TYAGA sur cette
          vente, en points Vida. Le programme de parrainage peut être modifié
          ou arrêté ; les gains déjà acquis restent acquis.
        </p>
      </LegalSection>

      <LegalSection h="9. Fiscalité">
        <p>
          Tu restes responsable de tes obligations fiscales. TYAGA affiche un
          compteur de ventes nettes et t’alerte dès 250 € cumulés sur l’année —
          en dessous du seuil de déclaration (305 €). Ce compteur est indicatif
          et ne constitue pas un conseil fiscal.
        </p>
      </LegalSection>

      <LegalSection h="10. Modération et responsabilité">
        <p>
          TYAGA peut retirer tout contenu illicite ou contraire à ces CGU, et
          suspendre un compte en cas d’abus. Les objets, leurs photos et leurs
          descriptions sont fournis par les vendeurs : TYAGA ne garantit pas
          leur exactitude mais arbitre les litiges signalés au support.
        </p>
      </LegalSection>

      <LegalSection h="11. Résiliation">
        <p>
          Tu peux supprimer ton compte à tout moment en écrivant à
          hello@tyaga.purama.dev. Les commandes en cours sont honorées ; ton
          profil et tes données sont supprimés sous 30 jours, sauf les ventes
          déjà réalisées, conservées de façon anonymisée (obligation
          comptable).
        </p>
      </LegalSection>

      <LegalSection h="12. Évolution des CGU">
        <p>
          Ces conditions peuvent évoluer. En cas de changement important, tu en
          es informé dans l’app ; continuer à utiliser TYAGA vaut acceptation
          de la nouvelle version.
        </p>
      </LegalSection>

      <LegalSection h="13. Droit applicable">
        <p>
          Ces CGU sont soumises au droit français. En cas de litige, écris
          d’abord à hello@tyaga.purama.dev — réponse sous 48 h, du lundi au
          samedi. À défaut d’accord amiable avec un consommateur, recours à
          la médiation de la consommation, puis aux tribunaux compétents.
        </p>
      </LegalSection>
    </LegalShell>
  );
}

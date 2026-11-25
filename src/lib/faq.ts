/**
 * FAQ /aide (P4) — contenu RÉEL du périmètre TYAGA V1. Chaque réponse reflète
 * ce qui existe dans l'app (commission 10% D13, séquestre Stripe, expédition
 * manuelle D15, points Vida sandbox D17, alerte 250 € D14). Aucune promesse
 * hors V1 : le chatbot SAV suit le même périmètre (lib/support-ai.ts).
 */

export interface FaqEntry {
  q: string;
  a: string;
}

export interface FaqCategory {
  title: string;
  entries: FaqEntry[];
}

export const FAQ_CATEGORIES: FaqCategory[] = [
  {
    title: 'Vendre un objet',
    entries: [
      {
        q: 'Comment ça marche, concrètement ?',
        a: "Prends 3 photos de ton objet (face, dos, défaut ou étiquette). TYAGA reconnaît la catégorie, la marque et l'état, propose une fourchette de prix réaliste, puis rédige l'annonce. Tu relis tout, tu ajustes si besoin, tu publies. Rien n'est publié sans ta validation.",
      },
      {
        q: "Pourquoi l'IA propose parfois un prix très différent du mien ?",
        a: "La fourchette vient du marché de l'occasion pour des objets équivalents (marque, modèle, état). Le prix final reste toujours ta décision : c'est toi qui fixes le prix de l'annonce, et tu peux refuser toute offre sous ton plancher.",
      },
      {
        q: "Quels objets puis-je vendre ?",
        a: "Tout objet personnel que tu possèdes et peux expédier : vêtements, sneakers, high-tech, livres, vélo… Les contrefaçons et les biens interdits sont exclus, et l'annonce passe par ta relecture avant publication.",
      },
    ],
  },
  {
    title: 'Paiement & commission',
    entries: [
      {
        q: 'Combien coûte TYAGA ?',
        a: 'Le brouillon indique le tarif appliqué, le total acheteur et le net vendeur. Sur le tarif habituel, la commission est déduite du prix vendeur. Les participants qualifiés à la recette française peuvent tester un tarif distinct de 0 % vendeur et 2,9 % + 0,35 € côté acheteur, sans argent réel.',
      },
      {
        q: 'Comment suis-je payé ?',
        a: "L'acheteur paie par carte via Stripe. L'argent reste en séquestre le temps de l'expédition, puis le net vendeur est versé quand l'acheteur confirme la réception. Jamais de paiement direct entre acheteur et vendeur.",
      },
      {
        q: 'Et si l’acheteur ne confirme jamais ?',
        a: 'La commande passe « livrée » puis se clôt automatiquement après le délai de confirmation : le séquestre est libéré et ta vente est enregistrée. Tu suis chaque étape depuis Commandes.',
      },
    ],
  },
  {
    title: 'Expédition',
    entries: [
      {
        q: 'Qui expédie, et comment ?',
        a: "Toi, depuis chez toi. TYAGA te guide avec une checklist d'emballage en 6 étapes dès que l'objet est payé. L'adresse de livraison de l'acheteur t'est communiquée uniquement après le paiement, jamais avant.",
      },
      {
        q: 'Pas de transporteur intégré ?',
        a: 'Pas encore : tu expédies avec le transporteur de ton choix et tu marques la commande « expédiée », puis l’acheteur la marque « reçue ». L’intégration étiquette en un clic arrive dans une prochaine version.',
      },
    ],
  },
  {
    title: 'Sécurité & litiges',
    entries: [
      {
        q: 'Pourquoi mon message a-t-il été bloqué ?',
        a: "TYAGA bloque les messages qui tentent de contourner la plateforme : IBAN, RIB, PayPal, WhatsApp, Telegram, numéro de téléphone, e-mail… C'est une protection : payer hors plateforme fait perdre la protection acheteur ET la sécurisation du paiement vendeur.",
      },
      {
        q: 'Je me dispute avec l’autre partie, qui tranche ?',
        a: "Décris la situation au support (hello@tyaga.purama.dev). L'argent en séquestre n'est libéré qu'une fois le litige tranché — personne ne peut le retirer seul.",
      },
    ],
  },
  {
    title: 'Points Vida',
    entries: [
      {
        q: 'C’est quoi les points Vida ?',
        a: 'Chaque vente terminée crédite des points : 1 point = 1 € de net vendeur. Tu répartis ces points vers tes objectifs (voyage, projet, épargne…) à 0, 30, 50 ou 100 % — toujours sur confirmation explicite, jamais automatiquement.',
      },
      {
        q: 'Je peux retirer mes points en euros ?',
        a: "Pas encore : l'environnement actuel est un bac à sable, aucun virement réel n'est déclenché. Les points reflètent ce que tes ventes ont financé et serviront de base aux versements à venir.",
      },
    ],
  },
  {
    title: 'Compte & fiscal',
    entries: [
      {
        q: 'Vendre m’oblige-t-il à déclarer quelque chose ?',
        a: "Les ventes d'objets personnels usagés sont en principe non imposables, sauf si tu vends trop cher ou trop souvent. TYAGA affiche un compteur de nets cumulés sur l'année et t'alerte dès 250 € — en dessous du seuil de déclaration (305 €) — pour rester serein.",
      },
      {
        q: 'Comment supprimer mon compte et mes données ?',
        a: "Écris à hello@tyaga.purama.dev depuis l'adresse de ton compte : suppression du profil et des données dans les 30 jours, conformément au RGPD. Les ventes déjà réalisées restent tracées de façon anonymisée (obligation comptable).",
      },
      {
        q: 'Le parrainage, comment il marche ?',
        a: "Partage ton code TY-XXXXXX. Quand une personne parrainée fait sa première vente admissible hors recette, tu reçois 50 % de la commission TYAGA sur cette vente, en points Vida.",
      },
    ],
  },
];

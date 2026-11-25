# Annonces et avantages TYAGA

TYAGA porte le catalogue et les conversations pour la vente d’objets et pour les offres et demandes numériques. Dans PURAMA ONE, Commerce donne accès à PURA SHARE. VASTU conserve la location d’objets physiques et la recherche inversée de location.

## Installation et vérification

Les extensions s’appliquent à la base PostgreSQL de TYAGA sur une version incluant les règlements de la contribution #1. Sur base neuve, installer schema.sql dans un environnement Supabase disposant de auth et storage. Pour la mise à niveau des règlements et remboursements suivre les étapes décrites dans REGLEMENTS.md. Appliquer ensuite ces migrations dans l’ordre.

1. digital-listings.sql
2. digital-licenses.sql
3. digital-checkout-test.sql
4. listing-promotions.sql
5. sale-promotion-rewards.sql

Après installation recharger le cache de schéma PostgREST avec `NOTIFY pgrst, 'reload schema';`. Exécuter les régressions sur une base jetable. Les contrôles d’intégration sous PGlite se lancent avec `node --test tests/member-marketplace.sql.mjs`. La recette de concurrence native utilise `tests/listing-promotion-concurrency.mjs`, le pilote pg et deux connexions PostgreSQL indépendantes.

## Publication et droits

Une recherche d’objet contient un budget. Une offre numérique indique son format, son prix, ses conditions et, pour une licence temporaire, sa durée. L’auteur d’une offre atteste ses droits. Le formulaire permet de partager la fiche de l’annonce. La livraison intégrée porte sur un texte original fourni par son auteur. Le contenu privé est contrôlé à chaque ouverture. Un lecteur peut conserver ce qu’il a déjà lu. Les fichiers PDF, audio et vidéo indiqués sur une annonce restent des descriptions tant qu’une livraison adaptée au format n’est pas raccordée.

Les licences payantes utilisent exclusivement des échantillons sur un environnement de test. Pour la recette Stripe, le serveur doit disposer de son intégration de test et du routage du webhook signé, d’un vendeur Connect test éligible, de `TYAGA_DIGITAL_CHECKOUT_TEST=1` et de l’origine de recette `TYAGA_DIGITAL_TEST_ORIGIN`. Une confirmation affichée dans le navigateur ne constitue pas une preuve de paiement. Les acquisitions et leurs annulations doivent être rapprochées avec les événements du prestataire. Une mise en vente commerciale nécessite aussi ses conditions de fourniture, le traitement du droit de rétractation, une confirmation durable et un circuit de litiges qualifié.

## Mise en avant et avantages

L’administrateur peut renseigner `TYAGA_LISTING_PROMOTION_QUOTE` pour publier un devis daté. Le prix TTC en centimes et le prix en points sont des valeurs indépendantes. Les reçus de règlement proviennent du prestataire compétent. L’adaptateur de confiance doit vérifier le paiement et sa devise ou le débit définitif des points, le titulaire, le montant, le barème et la durée. Il réserve l’inventaire et remet un seul bon avec `tyaga_promotion.issue_grant`; il conserve la référence originale et utilise `revoke_grant` pour rapprocher les annulations. Les membres activent les bons disponibles sur leurs annonces. L’interface étiquette et limite les emplacements sponsorisés dans les résultats compatibles. Le portefeuille VIDA conserve son usage propre.

Une campagne de récompenses transactionnelles se configure dans `tyaga_promotion.sale_campaigns` par l’exploitant de la base. Elle exige une référence d’inventaire publicitaire effectivement réservée, une fenêtre de vente, un nombre maximal de paires de bons, une limite par personne, un minimum de vente et les durées de diffusion et de validité. La table est vide à l’installation. Les quotas comptent également les bons révoqués. Chaque vente effectivement réglée et rapprochée peut alors attribuer un bon à l’acheteur et un bon au vendeur. Le numéro de commande assure l’unicité. Le remboursement ou le passage du règlement en réexamen retire les droits. Les bons et leur statut apparaissent dans Commandes. Le rapprochement serveur peut rejouer `tyaga_promotion.award_sale(order_id)` pendant la campagne si l’attribution a été différée.

Les reçus PAY et les confirmations d’un débit en points demandent un raccordement au prestataire ou au registre compétent. Le lancement d’un règlement en crypto requiert la qualification du jeton et du prestataire pour chaque territoire servi. Une publication gratuite ne génère aucun solde transférable.

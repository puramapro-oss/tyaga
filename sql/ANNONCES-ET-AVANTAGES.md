# Annonces et avantages TYAGA

TYAGA porte le catalogue et les conversations pour la vente d’objets et pour les offres et demandes numériques. Dans PURAMA ONE, Commerce donne accès à PURA SHARE. VASTU conserve la location d’objets physiques et la recherche inversée de location.

## Installation et vérification

Les extensions s’appliquent à la base PostgreSQL de TYAGA sur une version incluant les règlements de la contribution #1. Sur base neuve, installer schema.sql dans un environnement Supabase disposant de auth et storage. Pour la mise à niveau des règlements et remboursements suivre les étapes décrites dans REGLEMENTS.md. Appliquer ensuite ces migrations dans l’ordre.

1. digital-listings.sql
2. digital-licenses.sql
3. digital-checkout-test.sql
4. listing-promotions.sql
5. sale-promotion-rewards.sql
6. public-listing-previews.sql
7. physical-sale-fee-v2.sql
8. licensed-files.sql

Après installation recharger le cache de schéma PostgREST avec `NOTIFY pgrst, 'reload schema';`. Exécuter les régressions sur une base jetable. Les contrôles d’intégration sous PGlite se lancent avec `npm run test:member-marketplace`. La recette de concurrence native utilise `tests/listing-promotion-concurrency.mjs`, le pilote pg et deux connexions PostgreSQL indépendantes.

## Publication et droits

Une recherche d’objet contient un budget. Une offre numérique indique son format, son prix, ses conditions et, pour une licence temporaire, sa durée. L’auteur d’une offre atteste ses droits. Le lien normal ouvre la fiche connectée. L’auteur peut également vérifier le titre, le type et le prix, puis autoriser un aperçu public. Ce lien est révocable. Une modification du titre, du prix ou du type, ou le retrait de l’annonce, invalide le lien. Le contenu de la licence et la messagerie restent privés. Le créateur peut joindre un texte original ou un fichier privé. Les formats admis sont PDF, PNG, JPEG, WAV et MP4, dans la limite de 2 Mio pour le fichier. Les octets sont livrés après vérification de la licence. L’échéance ferme les futures ouvertures sur TYAGA. Une personne qui a déjà téléchargé un fichier peut en avoir conservé une copie.

Les licences payantes utilisent exclusivement des échantillons sur un environnement de test. Pour la recette Stripe, le serveur doit disposer de son intégration de test et du routage du webhook signé, d’un vendeur Connect test éligible, de `TYAGA_DIGITAL_CHECKOUT_TEST=1` et de l’origine de recette `TYAGA_DIGITAL_TEST_ORIGIN`. Une confirmation affichée dans le navigateur ne constitue pas une preuve de paiement. Les acquisitions et leurs annulations doivent être rapprochées avec les événements du prestataire. Une mise en vente commerciale nécessite aussi ses conditions de fourniture, le traitement du droit de rétractation, une confirmation durable et un circuit de litiges qualifié.

## Mise en avant et avantages

L’administrateur peut renseigner `TYAGA_LISTING_PROMOTION_QUOTE` pour publier un devis daté. Le prix TTC en centimes et le prix en points sont des valeurs indépendantes. Les reçus de règlement proviennent du prestataire compétent. L’adaptateur de confiance doit vérifier le paiement et sa devise ou le débit définitif des points, le titulaire, le montant, le barème et la durée. Il réserve l’inventaire et remet un seul bon avec `tyaga_promotion.issue_grant`; il conserve la référence originale et utilise `revoke_grant` pour rapprocher les annulations. Les membres activent les bons disponibles sur leurs annonces. L’interface étiquette et limite les emplacements sponsorisés dans les résultats compatibles. Le portefeuille VIDA conserve son usage propre.

## Tarif physique de recette

Le tarif historique des annonces existantes est conservé. Le pilote français permet à deux comptes particuliers de test qualifiés de valider un prix produit, des frais acheteur de 2,9 % + 0,35 € et un net vendeur égal au prix produit. Le vendeur choisit ce tarif avant publication. L’acheteur reconfirme le total lorsqu’un accord négocié change. Les commandes de test distinguent le prix produit des frais acheteur, restent exclues des avantages réels et du parrainage. Pour une recette isolée, renseigner une origine dédiée dans `TYAGA_PHYSICAL_FEE_TEST_ORIGIN` et `TYAGA_PHYSICAL_FEE_TEST=1`, avec les clés Stripe de test et des profils de test FR qualifiés dans `tyaga_fee.pilot_sellers`. À 50 € de prix produit, le total acheteur est de 51,80 € et le net vendeur de 50 €. Aucun résultat de recette n’autorise un règlement en production.

## Récompenses à l’issue d’une vente

Une campagne de récompenses transactionnelles se configure dans `tyaga_promotion.sale_campaigns` par l’exploitant de la base. Elle exige une référence d’inventaire publicitaire effectivement réservée, une fenêtre de vente, un nombre maximal de paires de bons, une limite par personne, un minimum de vente et les durées de diffusion et de validité. La table est vide à l’installation. Les quotas comptent également les bons révoqués. Chaque vente effectivement réglée et rapprochée peut alors attribuer un bon à l’acheteur et un bon au vendeur. Le numéro de commande assure l’unicité. Le remboursement ou le passage du règlement en réexamen retire les droits. Les bons et leur statut apparaissent dans Commandes. Le rapprochement serveur peut rejouer `tyaga_promotion.award_sale(order_id)` pendant la campagne si l’attribution a été différée.

Les reçus PAY et les confirmations d’un débit en points demandent un raccordement au prestataire ou au registre compétent. Le lancement d’un règlement en crypto requiert la qualification du jeton et du prestataire pour chaque territoire servi. Une publication gratuite ne génère aucun solde transférable.

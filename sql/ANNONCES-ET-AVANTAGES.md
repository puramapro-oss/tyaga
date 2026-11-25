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
9. promotion-points-pilot.sql
10. published-listing-benefits.sql
11. physical-sale-fee-v3.sql

Après installation recharger le cache de schéma PostgREST avec `NOTIFY pgrst, 'reload schema';`. Exécuter les régressions sur une base jetable. Les contrôles d’intégration sous PGlite se lancent avec `npm run test:member-marketplace`. La recette de concurrence native utilise `tests/listing-promotion-concurrency.mjs`, le pilote pg et deux connexions PostgreSQL indépendantes.

## Publication et droits

Une recherche d’objet contient un budget. Une offre numérique indique son format, son prix, ses conditions et, pour une licence temporaire, sa durée. L’auteur d’une offre atteste ses droits. Le lien normal ouvre la fiche connectée. L’auteur peut également vérifier le titre, le type et le prix, puis autoriser un aperçu public. Ce lien est révocable. Une modification du titre, du prix ou du type, ou le retrait de l’annonce, invalide le lien. Le contenu de la licence et la messagerie restent privés. Le créateur peut joindre un texte original ou un fichier privé. Les formats admis sont PDF, PNG, JPEG, WAV et MP4, dans la limite de 2 Mio pour le fichier. Les octets sont livrés après vérification de la licence. L’échéance ferme les futures ouvertures sur TYAGA. Une personne qui a déjà téléchargé un fichier peut en avoir conservé une copie.

Les licences payantes utilisent exclusivement des échantillons sur un environnement de test. Pour la recette Stripe, le serveur doit disposer de son intégration de test et du routage du webhook signé, d’un vendeur Connect test éligible, de `TYAGA_DIGITAL_CHECKOUT_TEST=1` et de l’origine de recette `TYAGA_DIGITAL_TEST_ORIGIN`. Une confirmation affichée dans le navigateur ne constitue pas une preuve de paiement. Les acquisitions et leurs annulations doivent être rapprochées avec les événements du prestataire. Une mise en vente commerciale nécessite aussi ses conditions de fourniture, le traitement du droit de rétractation, une confirmation durable et un circuit de litiges qualifié.

## Mise en avant et avantages

L’administrateur peut renseigner `TYAGA_LISTING_PROMOTION_QUOTE` pour publier un devis daté. Le prix TTC en centimes et le prix en points sont des valeurs indépendantes. Les reçus de règlement proviennent du prestataire compétent. L’adaptateur de confiance doit vérifier le paiement et sa devise ou le débit définitif des points, le titulaire, le montant, le barème et la durée. Il réserve l’inventaire et remet un seul bon avec `tyaga_promotion.issue_grant`; il conserve la référence originale et utilise `revoke_grant` pour rapprocher les annulations. Les membres activent les bons disponibles sur leurs annonces. L’interface étiquette et limite les emplacements sponsorisés dans les résultats compatibles. Le portefeuille VIDA conserve son usage propre.

## Avantage de publication

Une campagne active de `tyaga_promotion.publication_campaigns` peut offrir un bon à la première publication admissible d’une annonce d’offre ou de recherche. L’opérateur renseigne les références du financement et des emplacements réservés, la période, la durée de visibilité et les plafonds de campagne et par membre. Le parcours contrôle en base l’identité de l’auteur, la validation de l’annonce, le contenu de sa description et les champs requis pour le type de bien. Un retrait suivi d’une republication et une copie de même titre normalisé, même type et même sens par la même personne ne déclenchent pas un deuxième bon. L’interface identifie le bon reçu sur l’annonce d’origine. Les campagnes commencent sans dotation et l’historique antérieur à leur installation est exclu.

## Tarif physique de recette

Le vendeur qui choisit le nouveau tarif français pour une annonce physique de recette reçoit le prix convenu. L’acheteur paie 3 % du prix de l’article, arrondis au centime, plus 0,35 €. À 50 € de prix produit, il paie 51,85 € hors livraison et le vendeur reçoit 50 €. Le système présente le nouveau total à confirmer si la négociation modifie le prix. Un remboursement intégral porte sur le total débité.

Le tarif est fixé à la création de l’annonce. Les annonces antérieures marquées `fr_p2p_test_v2` conservent 2,9 % + 0,35 € pour leurs achats et remboursements. Les nouveaux contrats du pilote utilisent `fr_p2p_test_v3`. La migration V3 s’applique après V2. Sur une base déjà en V3, les mises à jour reprennent à partir de la dernière migration appliquée.

Pour tester, utiliser deux comptes de particuliers français qualifiés dans `tyaga_fee.pilot_sellers`, une origine de recette dédiée dans `TYAGA_PHYSICAL_FEE_TEST_ORIGIN`, `TYAGA_PHYSICAL_FEE_TEST=1` et les clés Stripe de test. Les commandes de recette restent exclues des avantages réels et du parrainage.

## Récompenses à l’issue d’une vente

Une campagne de récompenses transactionnelles se configure dans `tyaga_promotion.sale_campaigns` par l’exploitant de la base. Elle exige une référence d’inventaire publicitaire effectivement réservée, une fenêtre de vente, un nombre maximal de paires de bons, une limite par personne, un minimum de vente et les durées de diffusion et de validité. La table est vide à l’installation. Les quotas comptent également les bons révoqués. Chaque vente effectivement réglée et rapprochée peut alors attribuer un bon à l’acheteur et un bon au vendeur. Le numéro de commande assure l’unicité. Le remboursement ou le passage du règlement en réexamen retire les droits. Les bons et leur statut apparaissent dans Commandes. Le rapprochement serveur peut rejouer `tyaga_promotion.award_sale(order_id)` pendant la campagne si l’attribution a été différée.

## Acheter un bon avec des points en recette

Ce parcours utilise le registre de points PAY dans la même base PostgreSQL isolée que TYAGA, avec une identité de test commune. Le serveur consulte le prix de la campagne et les points que ce participant est autorisé à y dépenser. Après confirmation du membre, le débit PAY `debit_catalog` et la délivrance du bon sont enregistrés dans une seule transaction. L’acheteur choisit ensuite quand utiliser le bon. Une annulation administrative d’un bon inutilisé rapproche le débit initial, retire le bon et inscrit un mouvement PAY `reversal`.

Pour reproduire le parcours, installer le schéma officiel PAY sur une base de recette jetable. L’opérateur qualifie cette base avec le paramètre de base `tyaga.promotion_points_environment=isolated_test`. Il inscrit une offre datée dans `tyaga_promotion.points_pilot_offers`, son inventaire réservé et son tarif en points, puis renseigne dans `points_pilot_members` l’autorisation du participant synthétique pour cette campagne. Chaque modification de prix nécessite une nouvelle référence de tarif. Les tables de campagne sont vides à l’installation. La nouvelle interface exige `TYAGA_PROMOTION_POINTS_TEST=1`, l’origine dédiée `TYAGA_PROMOTION_POINTS_TEST_ORIGIN` et une origine Supabase isolée dans `TYAGA_PROMOTION_POINTS_TEST_SUPABASE_ORIGIN` qui correspond à `NEXT_PUBLIC_SUPABASE_URL`.

Pour tester avec le registre canonique, fournir le fichier SQL PAY de la révision `03edd69`, le pilote Node `pg` et les exécutables PostgreSQL `initdb` et `pg_ctl`, puis lancer `PAY_SCHEMA_PATH=/chemin/vers/schema.sql node tests/promotion-points-pilot.postgres.mjs`. Le test crée une base locale éphémère et vérifie l’empreinte du fichier avant de l’utiliser. La suite générale vérifie aussi la fermeture du parcours en l’absence de PAY.

Un bon n’attribue aucune valeur en euros aux points. L’utilisation commerciale de points exige les conditions d’émission appropriées pour le programme et un environnement PAY exploitable. Pour les nouveaux achats de visibilité en euros, le raccordement au prestataire reste à réaliser. Le lancement d’un règlement en crypto requiert la qualification du jeton et du prestataire pour chaque territoire servi. Une publication gratuite ne génère aucun solde transférable.

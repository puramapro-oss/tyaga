# STATUS.md — TYAGA

## Décision §5 BRIEF — MODE DE PUBLICATION (BLOQUANT, TRANCHÉ)

**Décision : Option C — Marketplace interne PURAMA.** Confirmée par Tissma le **2026-08-24**.

Option B (assisté Vinted/Leboncoin) intégrée comme **filet de sécurité** : export d'annonce texte prêt à copier, l'utilisateur publie lui-même (légal, zéro contournement de CGU).

### Justification
- Connect Express + Embedded Components déjà configurés pour l'écosystème (19/04/2026, STRIPE_CONNECT_KARMA_V4.md V4.1) — code prêt, pas de `STRIPE_CONNECT_CLIENT_ID` nécessaire.
- Webhook unique partagé de l'écosystème réutilisé, routage `metadata.app_slug = "tyaga"` (BRIEF §0 : jamais de webhook dédié).
- Socle anti-fraude des 13 apps marketplace réutilisable (identité vérifiée, paiement séquestré).
- Compte unifié 21 apps = acheteurs potentiels dès le jour 1 (amorce de liquidité).
- Seule option rendant la promesse « Je prends une photo. TYAGA vend. » réalisable légalement (plateforme propre = autopilote possible).

### Implications
- Stripe Connect **requis dès V1** (BRIEF §7 : « nécessaire uniquement si Option C » → cas actif).
- Commission vendeur : **10%** V1 (env `TYAGA_COMMISSION_PCT`), affichée AVANT publication et avant confirmation de vente.
- Fiscal léger V1 : compteur de revenus annuels par vendeur + alerte à 250€ (seuil déclaration 305€, pattern Tax Assistant V4.1 flow occasionnel).
- Anti-fraude socle : photos sha256 + horodatage, paiements séquestrés, blocage paiements hors plateforme dans l'inbox.

## État général
- 2026-08-24 — P0 en cours. Plan approuvé (« ok ») + Option C confirmée. Aucun code encore.

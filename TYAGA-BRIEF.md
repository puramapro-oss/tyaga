# TYAGA-BRIEF.md
**TYAGA** (त्याग = lâcher-prise, se détacher du superflu) — Revente autopilote + réinvestissement, écosystème PURAMA
Terminal dédié : GLM (glm-5.3) — Claude reste juge/certification finale si besoin d'audit croisé.

---

## 0. À lire avant de coder
Lancer avec `glm` (fonction shell z.ai, effort `high`) → **"Lis tous les fichiers. Plan d'abord. NE CODE PAS."**
Design : CLAUDE-2.md GOD MODE V3 (sections 9/9bis/9ter) — jamais improvisé, `palette_seed` déterministe pour TYAGA.
Stack imposée : Next.js 15, Supabase self-hosted (auth.purama.dev), Vercel (team puramapro-oss), repo dédié `puramapro-oss/purama-tyaga`, pas de `.env` tracké.
Stripe : passe par le webhook unique partagé de l'écosystème (jamais un webhook dédié), route via `metadata.app_slug = tyaga`.

---

## 1. Vision produit

TYAGA n'est pas "une app pour revendre ses affaires". C'est **le passage automatique du désencombrement à l'investissement** : photo → annonce → vente → argent transformé en objectif Vida (abonnement, soin, investissement écosystème).

Boucle : **Scanner → Vendre → Transformer.**

Promesse : *"Je prends une photo. TYAGA vend. Vida encaisse."*

Règles non-négociables :
- 0% commission cachée : taux affiché avant chaque vente
- Jamais de paiement hors plateforme (anti-arnaque)
- Pas de fausse promesse de prix ("vendu en 24h garanti" interdit)
- L'utilisateur valide toujours la vente finale et le transfert vers Vida Vault
- Respect strict des CGU des plateformes tierces connectées (voir §5)

---

## 2. Architecture fonctionnelle — V1 (MVP, 30 jours, périmètre strict)

### 2.1 Scan
- Capture 3 photos (face / dos / défaut-étiquette) ou upload galerie
- IA : détection catégorie, marque/modèle si visible, état proposé et modifiable

### 2.2 Estimation + plan de vente
- Prix conseillé + fourchette, délai estimé, net estimé après commission affichée

### 2.3 Annonce assistée
- Titre + description + tags générés par IA, toujours validés par l'utilisateur avant publication
- Publication sur 1 plateforme au choix (celle avec l'API officielle la plus accessible — à trancher, cf. §5)

### 2.4 Inbox assistant (pas "autopilote total" en V1)
- Modèles de réponses pré-écrits, 1 clic pour envoyer (pas d'envoi automatique sans API messagerie officielle)
- Suggestions de prix de négociation selon prix plancher défini par l'utilisateur

### 2.5 Expédition guidée
- Checklist emballage + étiquette si transporteur intégré + suivi

### 2.6 Vida Vault
- Wallet interne : à chaque vente confirmée, proposition de transfert (0/30/50/100%) vers un objectif Vida
- Pas de vrai virement bancaire en V1, juste le wallet de points + progression affichée

---

## 3. V2 (après V1 certifié, pas avant)
- Multi-plateformes (2-3 connecteurs officiels simultanés)
- Négociation semi-automatique élargie
- Anti-arnaque avancé (scoring de risque, détection paiement hors plateforme)
- Mode "Pile" (scan de 10 objets, tri automatique)
- Story auto partageable

## 4. V3 (exploratoire, ne pas coder sans validation)
- Autopilote total — uniquement si API officielle le permet, jamais par contournement
- Scan vidéo/3D d'une pièce entière
- Pickup à domicile
- Guildes / défis collectifs

---

## 5. Contrainte légale prioritaire — à trancher avant tout dev de publication (bloquant)

Vinted/Leboncoin n'ont pas d'API publique pour publier/négocier automatiquement ; les automatiser sans API officielle = contournement de CGU, interdit. eBay a une API officielle mais orientée pro/volume.

Décision à prendre avant de coder au-delà du scan/estimation :
- **Option A** — eBay via API officielle (autopilote réel possible)
- **Option B** — Vinted/Leboncoin en mode assisté uniquement (l'app prépare tout, l'utilisateur publie lui-même — légal, moins "magique")
- **Option C** — TYAGA comme marketplace interne PURAMA (paiement Stripe Connect comme les 13 apps marketplace déjà verrouillées, autopilote total possible car plateforme propre)

Le scan + estimation + Vida Vault (§2.1, 2.2, 2.6) peuvent démarrer immédiatement, sans attendre ce choix. Documenter la décision retenue dans STATUS.md avant de coder le module de publication.

---

## 6. Anti-fraude
- Preuve photo horodatée pour chaque objet scanné
- Si Option C : reprendre le socle anti-fraude des 13 apps marketplace (identité vérifiée, paiement séquestré si applicable)
- Blocage des demandes de paiement hors plateforme détectées dans l'inbox

---

## 7. Monétisation
- Commission TYAGA sur vente réussie : 5-10% (affiché avant publication)
- Premium (V2+) : annonces illimitées, mode Pile, templates avancés
- Pas de Stripe Connect en V1 si Option A/B ; nécessaire uniquement si Option C

---

## 8. Definition of Done V1
- tsc 0 erreur, `npm run lint` clean, `npm run build` vert
- Scan → estimation → annonce générée : testé bout en bout avec un objet réel
- Vida Vault : wallet de points fonctionnel, transfert testé (sandbox), progression affichée
- Décision §5 tranchée et documentée dans STATUS.md avant tout code de publication automatisée
- Design conforme GOD MODE V3, palette_seed TYAGA générée
- Rien poussé sans validation explicite de Tissma (commits locaux uniquement sauf feu vert)

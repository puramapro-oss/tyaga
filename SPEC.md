# SPEC.md — TYAGA V1-CORE

Exigences testables EX-ID (VEGA : anti-malentendu). Chaque EX a un test et une preuve. Gate certifie UNIQUEMENT le V1-CORE. Backlog : V1.1-BACKLOG.md.

Référentiels : TYAGA-BRIEF.md (contrat produit), CLAUDE.md V13, design.md V5, PURAMA_MASTER_UPGRADE Design System V1, STRIPE_CONNECT_KARMA_V4.md (paiement), STATUS.md (§5 = Option C).

---

## EX-A — Auth & compte
| ID | Exigence |
|---|---|
| EX-A1 | Inscription email+mot de passe crée le compte ; email de confirmation envoyé ; connexion fonctionne après confirmation. |
| EX-A2 | Google OAuth fonctionne EN VRAI (provider activé sur le VPS avant test, redirection `*.purama.dev` autorisée). |
| EX-A3 | Middleware : toute route `(dashboard)` non authentifiée → `/login?next=<route>` ; authentifiée sans compte → création auto profil schéma `tyaga` (trigger). |
| EX-A4 | Déconnexion : `signOut()` + clear storage + redirect `/` — bouton non mort (erreur connue #2). |

## EX-B — Scan (BRIEF §2.1)
| ID | Exigence |
|---|---|
| EX-B1 | L'utilisateur charge 3 photos (face / dos / défaut-étiquette) via capture OU galerie ; upload vers bucket storage `tyaga-photos`, chemin `{user_id}/{item_id}/…`. |
| EX-B2 | Chaque photo enregistrée avec `sha256` + `captured_at` (preuve horodatée, BRIEF §6). |
| EX-B3 | L'IA vision (sonnet-4-6) retourne : catégorie, marque/modèle si visible, état proposé — en <20s ou message FR d'attente/erreur. |
| EX-B4 | Catégorie/marque/état MODIFIABLES par l'utilisateur avant sauvegarde ; l'IA propose, jamais n'impose. |
| EX-B5 | Item créé statut `scanned`, photos liées (3 angles), visible dans la liste des objets. |

## EX-C — Estimation (BRIEF §2.2)
| ID | Exigence |
|---|---|
| EX-C1 | Affiche : prix conseillé + fourchette (min/max) + délai estimé de vente. |
| EX-C2 | Affiche le NET vendeur après commission : `net = prix × (1 − TYAGA_COMMISSION_PCT/100)` — calcul côté serveur, jamais côté client seul. |
| EX-C3 | Le TAUX de commission (10%) est affiché AVANT toute publication et avant toute confirmation de vente (0% commission cachée). |
| EX-C4 | Estimation persistée (historique) ; re-demande possible = nouvelle ligne, l'ancienne conservée. |
| EX-C5 | JAMAIS de promesse de délai garantie (« vendu en 24h garanti » interdit) — formulation « estimé ». |

## EX-D — Annonce assistée (BRIEF §2.3)
| ID | Exigence |
|---|---|
| EX-D1 | L'IA génère titre + description + tags à partir du scan et de l'estimation ; l'utilisateur voit le résultat AVANT publication. |
| EX-D2 | Publication IMPOSSIBLE sans validation explicite de l'utilisateur (bouton inactif tant que non validé ; aucun `published` sans action user). |
| EX-D3 | Publication sur la marketplace interne (Option C) : l'annonce publiée est visible par tout utilisateur authentifié. |
| EX-D4 | Export filet B : texte d'annonce prêt à copier (titre+description+tags formatés) utilisable sur Vinted/Leboncoin manuellement. |

## EX-E — Marketplace interne (Option C, BRIEF §5/§6/§7)
| ID | Exigence |
|---|---|
| EX-E1 | Achat : paiement Stripe Connect, fonds SÉQUESTRÉS jusqu'à confirmation de livraison ; acheteur ≠ vendeur. |
| EX-E2 | Commission 10% calculée et tracée à chaque vente (`ventes.commission_amount`, `net_amount`). |
| EX-E3 | Cycle commande : `pending → paid → shipped → delivered → completed | cancelled` — chaque transition par action de la bonne partie uniquement (RLS). |
| EX-E4 | Webhook : UNIQUEMENT le webhook partagé écosystème, routé par `metadata.app_slug = "tyaga"` ; idempotence sur `event_id` ; JAMAIS de webhook dédié TYAGA. |
| EX-E5 | Interdiction absolue de paiement hors plateforme : aucune UI ne suggère de régler hors Stripe ; messages suspects bloqués (EX-F4). |

## EX-F — Inbox assistant (BRIEF §2.4)
| ID | Exigence |
|---|---|
| EX-F1 | Messagerie interne par annonce : acheteur ↔ vendeur, temps réel ou refresh, messages persistés. |
| EX-F2 | Réponses 1-clic : modèles pré-écrits PROPOSÉS, envoi UNIQUEMENT sur clic utilisateur — zéro envoi automatique. |
| EX-F3 | Prix plancher défini par le vendeur par objet ; suggestions de négo JAMAIS sous le plancher ; refus poli proposé si offre < plancher. |
| EX-F4 | Détection paiement hors plateforme : regex (IBAN/RIB, PayPal, WhatsApp, Telegram, Revolut, Lydia, numéro tel, email de contact) dans un message → message BLOQUÉ + avertissement FR à l'envoyeur + flag `flagged_off_platform`. |

## EX-G — Expédition (BRIEF §2.5)
| ID | Exigence |
|---|---|
| EX-G1 | Après paiement : checklist emballage (4+ étapes concrètes) affichée au vendeur. |
| EX-G2 | Adresse de livraison de l'acheteur visible par le vendeur UNIQUEMENT après paiement confirmé. |
| EX-G3 | Suivi V1 manuel : vendeur marque « envoyé », acheteur confirme « reçu » → déclenche libération séquestre + vente finalisée. |

## EX-H — Vida Vault (BRIEF §2.6)
| ID | Exigence |
|---|---|
| EX-H1 | Wallet interne en POINTS (1 pt = 1€ net vendeur), créé auto à l'inscription. |
| EX-H2 | Après chaque vente confirmée : proposition de transfert 0/30/50/100% du net vers un objectif Vida. |
| EX-H3 | Le transfert exige confirmation explicite de l'utilisateur (jamais automatique). |
| EX-H4 | Progression de l'objectif affichée (barre + montant) ; objectifs CRUD par l'utilisateur. |
| EX-H5 | SANDBOX : 0 virement bancaire réel V1 ; le wallet est des points, clairement libellé. |

## EX-I — Design (GOD MODE V5 + Design System V1)
| ID | Exigence |
|---|---|
| EX-I1 | palette_seed `warmth-community-tyaga` → couleurs générées par `/lib/brand/` ; 0 hex en dur dans les composants (grep vérifiable). |
| EX-I2 | Typo : Bricolage Grotesque (display) + Geist Sans/Mono (body/utilitaire). |
| EX-I3 | Responsive 375px→1920px sans overflow ; sidebar 280px desktop + bottom tabs mobile ; safe areas iOS. |
| EX-I4 | Fond animé PuramaBackground (WebGL/CSS), PAS de fond statique ni image bg ni gradient CSS bg. |
| EX-I5 | Lighthouse ≥95 perf/accessibility/best-practices/SEO. |
| EX-I6 | Anti-slop : variante « revente consumer » (photo-first, badges état, prix nets) — validée par les 3 questions design. |

## EX-J — Transverse (CLAUDE.md V13)
| ID | Exigence |
|---|---|
| EX-J1 | `tsc --noEmit` 0 erreur ; `npm run lint` clean ; `npm run build` vert. |
| EX-J2 | Toutes les erreurs utilisateur : message FR + solution (jamais « Error 500 », jamais écran blanc). |
| EX-J3 | Chaque vue a états loading + error + empty (0 skeleton infini, timeout 10s). |
| EX-J4 | L'IA s'appelle « TYAGA » dans toute l'UI — jamais « Claude » ni « IA générique ». |
| EX-J5 | RLS activée sur 100% des tables ; `user_id = auth.uid()` partout ; lecture publique limitée aux annonces publiées. |
| EX-J6 | Rate limit sur toutes les API ; validation Zod sur toutes les entrées ; try/catch sur toutes les routes. |
| EX-J7 | Fiscal : compteur revenus annuels vendeur + alerte affichée dès 250€ nets cumulés. |
| EX-J8 | 0 placeholder/TODO/Lorem/console.log/`any` ; 0 faux avis/chiffres (compteurs DB, 0 si 0). |
| EX-J9 | Favicon + OG image custom TYAGA ; `dev.purama.tyaga` réservé au bundle mobile futur. |

## EX-K — Accueil & navigation
| ID | Exigence |
|---|---|
| EX-K1 | `/` = écran app (logo TYAGA + « Commencer » + « Se connecter ») — PAS de landing 13 sections. |
| EX-K2 | Dashboard : 3 blocs above the fold (parrainage, ambassadeur, cross-promo VIDA/KASH WELCOME50) + objets + solde Vault. |

---

## Matrice de traçabilité EX → test → preuve

| EX | Test | Preuve |
|---|---|---|
| EX-A1 | Playwright : signup email → confirmation → login | PW vert + screenshot |
| EX-A2 | Playwright : clic « Continuer avec Google » → session créée | PW vert + capture compte |
| EX-A3 | curl `/dashboard` sans cookie → 307 `/login?next=` | Corps de réponse |
| EX-A4 | Playwright : clic déconnexion → `/` + storage vide | PW vert |
| EX-B1/B2 | Playwright : upload 3 photos → lignes `item_photos` avec sha256 | PW + requête SQL |
| EX-B3/B4/B5 | Playwright : scan → champs IA modifiés → save → statut `scanned` | PW + SQL |
| EX-C1..C5 | Playwright : estimation affichée, net vérifié, taux visible avant publication ; grep UI « garanti » = 0 | PW + grep |
| EX-D1/D2 | Playwright : génération → bouton publier inactif → validation → publication | PW |
| EX-D3 | Playwright : 2e compte voit l'annonce publiée | PW |
| EX-D4 | Playwright : copie export → presse-papier contient titre+desc | PW |
| EX-E1..E5 | Test Stripe sandbox : achat → séquestre → livraison → libération ; SQL `marketplace_orders`/`ventes` ; grep webhook `metadata.app_slug` | Cartes test Stripe + SQL |
| EX-F1..F4 | Playwright : échange 2 comptes ; clic modèle ; offre < plancher → refus proposé ; message « PayPal » → bloqué | PW + SQL `flagged_off_platform` |
| EX-G1..G3 | Playwright : checklist affichée post-paiement ; adresse masquée avant paiement ; « envoyé »+« reçu » → completed | PW + SQL |
| EX-H1..H5 | Playwright : vente → choix 50% → confirmation → progression à jour ; grep code : 0 appel virement | PW + SQL |
| EX-I1 | `grep -rn '#[0-9a-fA-F]\{6\}' src/components src/app` (tolérance fichiers tokens) = 0 hex dur | Sortie grep |
| EX-I2..I6 | DA screenshots 3 viewports + Lighthouse CI | DESIGN-SCORE.md ≥9 + rapport LH |
| EX-J1 | CI : `tsc && lint && build` | Logs CI verts |
| EX-J2/J3 | Revue code + PW états empty/error | Grep + PW |
| EX-J4 | `grep -ri 'claude' src/` UI = 0 | Grep |
| EX-J5 | Requête SQL : `relrowsecurity` = true toutes tables | SQL |
| EX-J6 | Revue code routes : Zod + rate limit présents | Grep |
| EX-J7 | Playwright : somme ventes ≥250€ → bannière alerte | PW |
| EX-J8 | `grep -rE 'TODO\|FIXME\|Lorem\|console.log\|: any' src/` = 0 | Grep |
| EX-K1/K2 | Screenshot accueil + dashboard | DA score ≥9 |

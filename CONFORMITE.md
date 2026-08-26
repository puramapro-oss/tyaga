# CONFORMITE — TYAGA (Pilier 19)

> Audit de conformité produit/juridique de TYAGA, jugeant sur preuves code
> (fichier:ligne), pas sur affirmations. Base : `~/purama/FACTS.md` (chiffres
> verrouillés), CGU/CGV/politique de confidentialité TYAGA, résolutions du
> registre d'autorité CLAUDE.md §9.

**Date** : 2026-08-26 · **Commit base** : 39f628dc61af51688c69d8aae8ae0116fa336caf (+ working tree)
**Auditeur** : correcteur queue juridique P6, preuves vérifiées par grep/build

---

## 1. Pages légales — ✅ CONFORME

| Page | Route | Preuve |
|---|---|---|
| Index légal | `/legal` | `src/app/legal/page.tsx` |
| CGU | `/legal/cgu` | `src/app/legal/cgu/page.tsx` (12 sections) |
| CGV | `/legal/cgv` | `src/app/legal/cgv/page.tsx` |
| Mentions légales | `/legal/mentions-legales` | `src/app/legal/mentions-legales/page.tsx` |
| Politique de confidentialité | `/legal/politique-confidentialite` | `src/app/legal/politique-confidentialite/page.tsx` (7 sections RGPD) |

Liens d'accès (grep `href="/legal/`) :
- Écran d'accueil public : CGU + CGV (`src/app/page.tsx:63,67`)
- Inscription : CGU + politique (`src/app/(auth)/signup/page.tsx:132,136`)
- Aide : les 4 documents (`src/app/(dashboard)/aide/page.tsx:80-95`)

Build : 35 pages générées, 0 erreur (`BUILD:0`, 2026-08-26).

## 2. Bandeau cookies — ✅ EXEMPT

`grep CookieBanner|document.cookie src/` → 0 résultat. Seuls cookies :
session Supabase (strictement nécessaire, ePrivacy art. 5(3) — exempt de
consentement). Aucun traceur tiers déposeur de cookie (PostHog configuré,
0 hit constaté en prod lors de la vérification P6). Pas de bandeau requis ;
politique de confidentialité §4 documente ces cookies.

## 3. Preuve d'acceptation CGU — ✅ CONFORME

- `signup/page.tsx:130-137` : texte « En créant un compte, tu acceptes les
  CGU et la politique de confidentialité » + liens cliquables vers les deux.
- CGU intro : « En créant un compte, tu les acceptes. »
- Mécanisme = acceptation implicite par action de création, conforme à la
  résolution #5 du registre d'autorité (waiver implicite par clic, zéro
  checkbox superflue).

## 4. Export RGPD / suppression — ✅ CONFORME (voie e-mail, V1)

- Politique §6 : suppression sur demande, effacement sous 30 jours, sauf
  ventes conservées **anonymisées** (obligation comptable).
- Politique §7 : accès, rectification, effacement, limitation, opposition,
  portabilité → `hello@tyaga.purama.dev`, réponse sous 1 mois, recours CNIL.
- FAQ support : « Comment supprimer mon compte ? »
  (`src/components/aide/SupportChat.tsx:20`).
- Note V1.1 : self-serve export/suppression (cf. samaya `/api/rgpd/supprimer`)
  au backlog — la voie e-mail est juridiquement suffisante.

## 5. Déclaration IA (AI Act, transparence) — ✅ CONFORME

- Chat support : « Réponse immédiate par IA sur le fonctionnement de TYAGA ;
  on transmet au support humain pour tout le reste. »
  (`src/components/aide/SupportChat.tsx:60-63`).
- Génération d'annonce : « Tout est modifiable — l'IA propose, tu disposes. »
  (`src/app/(dashboard)/scan/page.tsx:278`).
- CGU §3 : « Le titre et la description de l'annonce sont proposés par
  l'intelligence artificielle de TYAGA […] tu restes responsable de leur
  exactitude » — **ajouté le 2026-08-26** (correcteur P6, écart initial).

## 6. Lexique interdit / avis rémunérés — ✅ CONFORME

`grep -i "témoignage|avis vérifié|satisfait ou remboursé"` → 0 résultat.
Aucune section témoignages, aucun avis, aucun logo tiers, aucun chiffre
d'invention : compteurs DB (0 si 0). WELCOME50 = code cross-promo pour les
apps sœurs VIDA/KASH (`CrossPromoCard.tsx`), utilisable chez elles — pas une
remise TYAGA, pas de prix barré requis ici.

## 7. Chiffres vs FACTS.md — ✅ CONFORME (4/4)

| Chiffre verrouillé | FACTS.md | Code | Cohérent |
|---|---|---|---|
| Commission marketplace | 10 % | `src/lib/constants.ts:19` (défaut, clamp 0-30), `CGU §4`, `faq.ts:41`, `support-ai.ts:23` | ✅ |
| Points Vida | 1 pt = 1 € net, sandbox | `vida/page.tsx:13,124,270`, `ObjectifForm.tsx:11`, CGU §8 | ✅ |
| Fiscal | alerte 250 €, seuil déclaration 305 € | `CGU:112-113`, EX-J7 compteur ventes nettes | ✅ |
| Parrainage N1 | 50 % de la COMMISSION en points Vida (dérogation) | FACTS ligne dédiée + CGU §8 | ✅ |

Aucun chiffre réécrit ailleurs : la page Vida dit « sandbox » et « points »,
jamais « payé » (pas de versement bancaire V1).

---

## Écarts et remédiation

| # | Écart constaté | Statut |
|---|---|---|
| 1 | CGU sans mention du caractère IA du brouillon d'annonce (AI Act) | **FIXÉ** 2026-08-26 — CGU §3 |
| 2 | Pas de self-serve RGPD (export/suppression en un clic) | Conforme par e-mail — V1.1 backlog |
| 3 | Pas de page settings/profil dédiée | Hors V1-CORE — V1.1 backlog |
| 4 | Mentions légales sans directeur de publication (LCEN 6-III, jury juridique P6) | **FIXÉ** 2026-08-26 — « le représentant légal de la SASU PURAMA » |
| 5 | Aucune mention médiation consommation (L612-1 C. conso, jury juridique P6) | **FIXÉ** 2026-08-26 — CGV §8 + CGU §13, médiateur générique (formulation flotte rita) |
| 6 | SIRET/SIREN absent des mentions légales ; médiateur conso non nommé | **BUSINESS écosystème** — décision flotte (cf MANA : SIRET/médiateur = décision écosystème), INSEE clé absente du sandbox |

REMEDIATION:tyaga:2/2:19b45b22f53f
VERDICT:tyaga:VERT

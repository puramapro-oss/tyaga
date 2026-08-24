# PATTERNS.md — TYAGA

Patterns validés à réutiliser (aucun bug connu).

|DATE|PATTERN|CONTEXTE|
|---|---|---|
|2026-08-24|Webhook Stripe = UNIQUEMENT le webhook partagé écosystème, routage `metadata.app_slug = "tyaga"`, idempotence `event_id`|BRIEF §0 + Pilier 15|
|2026-08-24|Couleurs uniquement via /lib/brand/ (parseSeed xmur3) — 0 hex en dur composants|GOD MODE V5|
|2026-08-24|App self-contained : 0 dep runtime `@purama/*`|D11 repo dédié|
|2026-08-24|Schéma Postgres dédié `tyaga` (pas purama_marketplace)|D10 — V13 §12|

# ERRORS.md — TYAGA

|DATE|BUG|CAUSE|FIX|
|---|---|---|---|
|2026-08-25|DDL tyaga rejeté "must be owner of schema tyaga"|`docker exec -i supabase-db psql -U postgres -d postgres` + `SET ROLE supabase_admin` → permission denied|Toujours lancer le DDL tyaga via `psql -U supabase_admin -d postgres` (ni `-U postgres`, ni SET ROLE)|
|2026-08-25|e2e p5 échec "element(s) not found" sur `span.font-mono` dans puce Refuser|Puce Refuser = price_counter_cents null → aucun span montant ; le contre-prix ne s'affiche que sur la puce Négocier|Pointer l'assertion montant sur la puce Négocier (`getByRole('button', { name: /Négocier/ })`)|
|2026-08-25|e2e hang login 30s (run 1 p5) après kill d'un run Playwright|Serveur dev 3198 orphelin accepte les connexions mais ne répond plus|Avant chaque rerun : `pkill -f "next dev -p 3198"; lsof -ti:3198 \| xargs kill -9`|
| 2026-08-25 | TYAGA e2e p6 : PostgREST PATCH cross-schema → PGRST205 "Could not find the table 'public.marketplace_orders'" | Accept-Profile ne vaut QUE pour les lectures ; les écritures lisent Content-Profile | Ajouter `Content-Profile: tyaga` aux headers service sur tout PATCH/POST PostgREST |
| 2026-08-25 | TYAGA e2e p6 strict mode : getByText statut résolu en 2 éléments | run e2e avorté laisse une commande pending en DB → rows dupliquées au run suivant | Scoper TOUS les assert de statut à `locator('li.glass').first()` (ou nettoyer la commande avant) |

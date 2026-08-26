// Résolution des imports relatifs SANS extension (./constants → ./constants.ts)
// pour `node --test` en type stripping natif — Node ne devine pas l'extension
// .ts alors que webpack/Next, lui, le fait. Chargé via --import dans test:unit.
//
// register() (hooks asynchrones du loader thread) : le test runner charge les
// modules via ModuleJob.syncLink → resolveAndMaybeBlockOnLoaderThread, qui ne
// passe QUE par les hooks du loader thread — registerHooks in-thread ne suffit pas.
import { register } from 'node:module';

register('./ts-resolve-hooks.mjs', import.meta.url);

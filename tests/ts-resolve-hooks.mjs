// Hooks asynchrones (loader thread) — résolution des imports relatifs sans
// extension pour le type stripping natif. Enregistrés par ts-resolve.mjs.
import { existsSync } from 'node:fs';

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && (context.parentURL ?? '').endsWith('.ts')) {
    try {
      return await next(specifier, context);
    } catch (err) {
      if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
      for (const suffix of ['.ts', '/index.ts']) {
        const candidate = new URL(specifier + suffix, context.parentURL);
        if (existsSync(new URL(candidate).pathname)) {
          return next(candidate.href, context);
        }
      }
      throw err;
    }
  }
  return next(specifier, context);
}

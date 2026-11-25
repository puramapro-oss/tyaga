const FALLBACK = '/dashboard';
const BASE = 'https://tyaga.invalid';

/** Resolve the callback destination without letting URL normalization change its origin. */
export function internalRedirectPath(rawNext: string | null): string {
  if (
    !rawNext?.startsWith('/') ||
    rawNext.startsWith('//') ||
    Array.from(rawNext).some((character) => {
      const code = character.charCodeAt(0);
      return character === '\\' || code < 32 || code === 127;
    })
  ) {
    return FALLBACK;
  }

  try {
    const destination = new URL(rawNext, BASE);
    // A path such as /a/..//host normalizes to //host. Returning that path
    // to a router would resolve it as a new authority on its next parse.
    if (destination.origin !== BASE || destination.pathname.startsWith('//')) {
      return FALLBACK;
    }
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return FALLBACK;
  }
}

/** Carry the same internal destination through login, signup and the callback. */
export function authContinuationHref(page: '/login' | '/signup' | '/callback', rawNext: string | null) {
  const next = internalRedirectPath(rawNext);
  return next === FALLBACK ? page : page + '?' + new URLSearchParams({ next }).toString();
}

// Générateurs pseudo-aléatoires déterministes — même seed, mêmes couleurs,
// à chaque build, sur chaque machine (EX-I1 : 0 hex en dur, la seed décide).

/** Hash de chaîne → graine 32 bits (xmur3, domaine public). */
export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** PRNG 32 bits rapide et reproductible (mulberry32, domaine public). */
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** PRNG seedé par une chaîne : rand() ∈ [0,1), déterministe. */
export function seededRandom(seed: string): () => number {
  return mulberry32(xmur3(seed)());
}

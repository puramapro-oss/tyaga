import type { CSSProperties } from 'react';

/**
 * EX-I4 — fond animé de l'app : braises montantes (métaphore La Boucle —
 * chaque objet lâché alimente la progression). CSS pur, transform/opacity
 * uniquement (GPU), positions DÉTERMINISTES (pas de Math.random : sinon
 * écart SSR/CSR = hydration mismatch). `prefers-reduced-motion` → braises
 * figées en lueur statique (globals.css). 0 hex dur : color-mix sur tokens.
 */

interface Braise {
  /** position horizontale de départ */
  x: string;
  /** diamètre en px */
  s: number;
  /** durée du cycle en s */
  d: number;
  /** délai négatif = déjà en cours au chargement (aucun temps mort) */
  delay: number;
  /** opacité maximale */
  o: number;
  /** dérive horizontale sur la montée */
  drift: string;
  tone: 'primary' | 'secondary';
}

const BRAISES: Braise[] = [
  { x: '6%', s: 5, d: 26, delay: -3, o: 0.5, drift: '2vw', tone: 'primary' },
  { x: '14%', s: 3, d: 31, delay: -18, o: 0.35, drift: '-2vw', tone: 'secondary' },
  { x: '23%', s: 6, d: 24, delay: -11, o: 0.45, drift: '3vw', tone: 'primary' },
  { x: '34%', s: 4, d: 29, delay: -25, o: 0.3, drift: '-1vw', tone: 'primary' },
  { x: '45%', s: 3, d: 33, delay: -7, o: 0.35, drift: '2vw', tone: 'secondary' },
  { x: '56%', s: 6, d: 27, delay: -20, o: 0.5, drift: '-3vw', tone: 'primary' },
  { x: '67%', s: 4, d: 30, delay: -14, o: 0.4, drift: '1vw', tone: 'primary' },
  { x: '78%', s: 3, d: 34, delay: -28, o: 0.3, drift: '-2vw', tone: 'secondary' },
  { x: '89%', s: 5, d: 25, delay: -9, o: 0.45, drift: '2vw', tone: 'primary' },
];

export default function PuramaBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {BRAISES.map((b) => (
        <span
          key={b.x}
          className="braise"
          data-tone={b.tone}
          style={
            {
              left: b.x,
              width: `${b.s}px`,
              height: `${b.s}px`,
              animationDuration: `${b.d}s`,
              animationDelay: `${b.delay}s`,
              '--braise-opacity': b.o,
              '--braise-drift': b.drift,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

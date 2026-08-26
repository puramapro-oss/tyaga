'use client';

import { motion, useReducedMotion } from 'framer-motion';

/**
 * La Boucle — signature TYAGA (DESIGN-PLAN §6) : chaque objet vendu devient
 * une braise qui rejoint l'anneau de progression vers l'objectif Vida.
 * Anneau SVG + braise animée spring (framer-motion) ; l'arc se remplit du
 * même élan. `prefers-reduced-motion` → rendu statique immédiat (arc plein,
 * braise posée sur l'anneau). 0 hex dur : tokens identité uniquement.
 */

export default function BoucleRing({
  current,
  target,
  size = 84,
}: {
  current: number;
  target: number;
  size?: number;
}) {
  const reduce = useReducedMotion();

  const pct =
    target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const stroke = 5;
  const r = (size - stroke) / 2 - 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);

  // La braise se pose au bout de l'arc rempli (départ à 12 h)
  const angle = ((pct / 100) * 360 - 90) * (Math.PI / 180);
  const bx = size / 2 + r * Math.cos(angle);
  const by = size / 2 + r * Math.sin(angle);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={
        target > 0
          ? `La Boucle : ${pct} % de l’objectif (${current} / ${target} points)`
          : 'La Boucle : crée un objectif Vida pour alimenter l’anneau'
      }
      className="shrink-0"
    >
      {/* Piste */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--border)"
        strokeWidth={stroke}
      />

      {/* Arc de progression — spring au chargement */}
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        initial={reduce ? false : { strokeDashoffset: c }}
        animate={{ strokeDashoffset: offset }}
        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 40, damping: 18 }}
        style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}
      />

      {/* La braise — née au centre, rejoint le bout de l’arc */}
      <motion.g
        initial={reduce ? false : { x: 0, y: 0, opacity: 0, scale: 0.3 }}
        animate={{ x: reduce ? 0 : bx - size / 2, y: reduce ? 0 : by - size / 2, opacity: 1, scale: 1 }}
        transition={
          reduce
            ? { duration: 0 }
            : { type: 'spring', stiffness: 50, damping: 14, delay: 0.35 }
        }
        style={{ transformOrigin: `${size / 2}px ${size / 2}px` }}
      >
        <circle cx={size / 2} cy={size / 2} r={7} fill="var(--primary)" opacity={0.25} />
        <circle cx={size / 2} cy={size / 2} r={3.5} fill="var(--primary)" />
      </motion.g>

      {/* Pourcentage au centre — chiffres tabulaires */}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="font-mono"
        fontSize={size / 5}
        fill="var(--foreground)"
      >
        {pct}%
      </text>
    </svg>
  );
}

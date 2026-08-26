import { tyagaPalette } from '@/lib/brand/palette'

/**
 * Marque TYAGA — boucle de braise sur tuile gradient, même motif que le
 * logo de l'écran d'accueil (src/app/page.tsx). Utilisée par les routes
 * de génération d'images Next.js (icon, apple-icon, opengraph-image).
 * Couleurs littérales (pas de var(--…)) : rendu satori hors DOM.
 */
const INK = '#0a0a0f' // var(--background) — trait sur le gradient

export function TyagaMark({ size }: { size: number }) {
  const loop = Math.round(size * 0.47) // 30/64 comme l'accueil
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(135deg, ${tyagaPalette.primary} 0%, ${tyagaPalette.secondary} 100%)`,
      }}
    >
      <svg width={loop} height={loop} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M12 3c-4.5 0-8 3.4-8 7.8 0 4.4 3.5 8.2 8 8.2 3 0 5.6-1.6 7-4"
          stroke={INK}
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle cx="19" cy="7" r="2.4" fill={INK} />
      </svg>
    </div>
  )
}

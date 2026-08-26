import { ImageResponse } from 'next/og'

import { tyagaPalette } from '@/lib/brand/palette'
import { TyagaMark } from '@/lib/og-logo'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'TYAGA — Prends une photo. TYAGA rédige l’annonce, gère la vente.'

const OG_BACKGROUND_IMAGE = `radial-gradient(circle at 15% 10%, ${tyagaPalette.primary}59, transparent 55%), radial-gradient(circle at 85% 90%, ${tyagaPalette.secondary}2E, transparent 55%)`

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0f',
          backgroundImage: OG_BACKGROUND_IMAGE,
          padding: 80,
        }}
      >
        <div style={{ display: 'flex', marginBottom: 36, borderRadius: 32, overflow: 'hidden' }}>
          <TyagaMark size={112} />
        </div>
        <div
          style={{
            fontSize: 88,
            fontWeight: 700,
            color: '#f5f5fa',
            letterSpacing: -2,
            display: 'flex',
          }}
        >
          TYAGA
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: 34,
            color: 'rgba(245,245,250,0.72)',
            textAlign: 'center',
            maxWidth: 920,
            lineHeight: 1.4,
            display: 'flex',
          }}
        >
          Prends une photo. TYAGA rédige l’annonce, gère la vente.
        </div>
        <div
          style={{
            marginTop: 40,
            fontSize: 26,
            color: tyagaPalette.primaryOnDark,
            display: 'flex',
          }}
        >
          tyaga.purama.dev
        </div>
      </div>
    ),
    size
  )
}

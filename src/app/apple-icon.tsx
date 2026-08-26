import { ImageResponse } from 'next/og'

import { TyagaMark } from '@/lib/og-logo'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 40,
        }}
      >
        <TyagaMark size={180} />
      </div>
    ),
    size
  )
}

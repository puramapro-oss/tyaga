import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Geist, Geist_Mono } from 'next/font/google';

import { paletteCssVars, tyagaPalette } from '@/lib/brand/palette';
import { APP_NAME } from '@/lib/constants';
import PuramaBackground from '@/components/shared/PuramaBackground';

import './globals.css';

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
});

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'TYAGA — Vends ce qui t’encombre',
    template: '%s · TYAGA',
  },
  description:
    'Prends une photo. TYAGA rédige l’annonce, gère la vente et la mise en scène. Vida encaisse pour tes objectifs.',
  applicationName: APP_NAME,
};

export const viewport: Viewport = {
  themeColor: tyagaPalette.primary,
  width: 'device-width',
  initialScale: 1,
  // EX-I3 — safe areas iOS : laisse env(safe-area-inset-*) s'appliquer
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="fr"
      className={`${bricolage.variable} ${geist.variable} ${geistMono.variable}`}
    >
      <body>
        {/* Tokens identité générés depuis la seed — injectés serveur, zéro flash */}
        <style
          dangerouslySetInnerHTML={{
            __html: `:root {\n    ${paletteCssVars(tyagaPalette)}\n  }`,
          }}
        />
        {/* EX-I4 — braises montantes, derrière tout le contenu */}
        <PuramaBackground />
        {children}
      </body>
    </html>
  );
}

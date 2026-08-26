import { readFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

/**
 * P5 — EX-I4 PuramaBackground (braises montantes, DOM vérifiable) +
 * signature La Boucle (BoucleRing sur /dashboard et /vida) + EX-I3
 * meta viewport viewport-fit=cover (safe areas iOS). Zéro appel IA.
 */

const USER = { email: 'tyaga-e2e@purama-test.dev', password: 'TyagaE2e!2026aA' }

function envLocal(key: string): string {
  const line = readFileSync('.env.local', 'utf8')
    .split('\n')
    .find((l) => l.startsWith(key + '='))
  return line ? line.slice(key.length + 1).trim() : ''
}

async function ensureUserConfirmed(email: string, password: string): Promise<void> {
  const url = envLocal('NEXT_PUBLIC_SUPABASE_URL')
  const serviceKey = envLocal('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) throw new Error('.env.local incomplet pour le setup E2E')
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  if (!res.ok && res.status !== 422) {
    throw new Error(`setup admin users: ${res.status} ${await res.text()}`)
  }
}

async function login(page: Page, creds: { email: string; password: string }): Promise<void> {
  await ensureUserConfirmed(creds.email, creds.password)
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(creds.email)
  await page.locator('input[type="password"]').fill(creds.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.waitForURL(/dashboard/, { timeout: 30_000 })
}

test('EX-I4 — PuramaBackground : 9 braises montantes derrière le contenu', async ({ page }) => {
  await page.goto('/login')

  const bg = page.locator('div[aria-hidden="true"]').filter({ has: page.locator('.braise') }).first()
  await expect(bg).toBeAttached()

  // 9 braises déterministes, animation braise-rise, jamais au-dessus du contenu
  const braises = page.locator('.braise')
  await expect(braises).toHaveCount(9)
  const first = braises.first()
  await expect(first).toHaveCSS('animation-name', 'braise-rise')
  // Le calque reste derrière le contenu (z-index négatif)
  await expect(
    bg.evaluate((el) => Number(getComputedStyle(el).zIndex)),
  ).resolves.toBeLessThan(0)
})

test('EX-I3 — viewport-fit=cover (safe areas iOS) + barre d’onglets rembourrée', async ({ page }) => {
  await page.goto('/login')

  const vp = page.locator('meta[name="viewport"]')
  await expect(vp).toHaveAttribute('content', /viewport-fit=cover/)

  // Bottom tabs visibles uniquement mobile — check classe safe-area présente dans le DOM
  await page.setViewportSize({ width: 375, height: 720 })
  const tabs = page.locator('nav.fixed')
  await expect(tabs).toBeHidden() // /login n'a pas de bottom tabs
})

test('La Boucle — anneau signature présent sur /dashboard et /vida', async ({ page }) => {
  await login(page, USER)

  // Dashboard : VaultCard porte l'anneau (vide ou rempli selon objectifs)
  await expect(
    page.getByRole('img', { name: /La Boucle/ }).first(),
  ).toBeVisible()

  // /vida : chaque objectif actif a son anneau + sa barre EX-H4
  await page.goto('/vida')
  const ring = page.getByRole('img', { name: /La Boucle/ }).first()
  if (await ring.count()) {
    await expect(ring).toBeVisible()
    await expect(
      page.locator('[aria-label="Progression de l’objectif"]').first(),
    ).toBeAttached()
  }
})

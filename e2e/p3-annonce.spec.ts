import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/**
 * P2.3 — Annonce assistée (EX-D1..D4) : génération IA → brouillon montré
 * AVANT publication → validation explicite (bouton inactif sans elle) →
 * publication visible par un AUTRE compte → export texte copiable.
 * 3 appels IA (vision + estimation + rédaction) — assumé, c'est la preuve EX-D.
 */

const SELLER = { email: 'tyaga-e2e@purama-test.dev', password: 'TyagaE2e!2026aA' }
const BUYER = { email: 'tyaga-e2e-2@purama-test.dev', password: 'TyagaE2e!2026aA' }
const FIXTURES = join(process.cwd(), 'e2e', 'fixtures')

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

async function login(page: Page, account: { email: string; password: string }): Promise<void> {
  await ensureUserConfirmed(account.email, account.password)
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(account.email)
  await page.locator('input[type="password"]').fill(account.password)
  await page.locator('button[type="submit"]').click()
  // 30 s : premier login d'une session dev = compilation à froid de la page
  await page.waitForURL(/dashboard/, { timeout: 30_000 })
}

/** Scan + sauvegarde + estimation → URL de la fiche prête pour l'annonce. */
async function scanEstimateItem(page: Page): Promise<void> {
  await page.goto('/scan')
  const slots = ['face', 'dos', 'defaut']
  for (let i = 0; i < slots.length; i++) {
    await page
      .locator('input[type="file"]')
      .nth(i)
      .setInputFiles(join(FIXTURES, `${slots[i]}.jpg`))
  }
  await page.getByRole('button', { name: /Analyser mes 3 photos/ }).click()
  await page
    .getByRole('button', { name: /Enregistrer l’objet|Enregistrer l'objet/ })
    .waitFor({ timeout: 45_000 })
  await page.getByRole('textbox', { name: 'Catégorie' }).fill('sneakers')
  await page.locator('select').selectOption('tres_bon')
  await page.getByRole('button', { name: /Enregistrer l’objet|Enregistrer l'objet/ }).click()
  await page.waitForURL(/objets$/, { timeout: 15_000 })
  await page.getByRole('link').filter({ hasText: /sneakers/ }).first().click()
  await page.waitForURL(/objets\/[0-9a-f-]+/, { timeout: 15_000 })

  await page.getByRole('button', { name: /Estimer la vente/ }).click()
  await expect(page.getByText('Prix conseillé')).toBeVisible({ timeout: 45_000 })
}

test('EX-D1/D2 — brouillon IA montré avant publication, bouton inactif sans validation', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await login(page, SELLER)
  await scanEstimateItem(page)

  // EX-D1 : génération → brouillon visible AVANT toute publication
  await page.getByRole('button', { name: /Générer l’annonce/ }).click()
  const draft = page.getByLabel("Brouillon d'annonce")
  await expect(draft).toBeVisible({ timeout: 60_000 })

  // EX-D2 : bouton publier INACTIF tant que la case n'est pas cochée
  const publish = page.getByRole('button', { name: /Publier sur la marketplace/ })
  await expect(publish).toBeDisabled()

  // validation explicite → publication
  await draft.locator('input[type="checkbox"]').check()
  await expect(publish).toBeEnabled()
  await publish.click()

  await expect(page.getByText('Annonce publiée')).toBeVisible({ timeout: 20_000 })
})

test('EX-D3 — un 2e compte voit l’annonce publiée sur la marketplace', async ({ browser }) => {
  test.setTimeout(240_000)

  // 1) Le vendeur publie (contexte A)
  const sellerCtx = await browser.newContext()
  const seller = await sellerCtx.newPage()
  await login(seller, SELLER)
  await scanEstimateItem(seller)

  await seller.getByRole('button', { name: /Générer l’annonce/ }).click()
  await seller.getByLabel("Brouillon d'annonce").waitFor({ timeout: 60_000 })
  const publish = seller.getByRole('button', { name: /Publier sur la marketplace/ })
  await expect(publish).toBeDisabled()
  await seller.getByLabel("Brouillon d'annonce").locator('input[type="checkbox"]').check()
  await publish.click()
  await seller.getByText('Annonce publiée').waitFor({ timeout: 20_000 })

  // Mémorise le titre publié pour l'assertion côté acheteur
  const publishedTitle = (await seller.locator('h1').first().textContent())?.trim() ?? ''
  expect(publishedTitle.length).toBeGreaterThan(0)

  // 2) Un AUTRE compte (contexte B, acheteur) voit l'annonce (EX-D3)
  const buyerCtx: BrowserContext = await browser.newContext()
  const buyer = await buyerCtx.newPage()
  await login(buyer, BUYER)

  await buyer.goto('/marketplace')
  const card = buyer.getByRole('link').filter({ hasText: publishedTitle }).first()
  await expect(card).toBeVisible({ timeout: 15_000 })

  // Fiche publique : même titre, même information
  await card.click()
  await expect(buyer.getByRole('heading', { level: 1, name: publishedTitle })).toBeVisible()

  await sellerCtx.close()
  await buyerCtx.close()
})

test('EX-D4 — copie export → presse-papier contient titre et description', async ({
  browser,
}) => {
  test.setTimeout(240_000)

  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await ctx.newPage()
  await login(page, SELLER)
  await scanEstimateItem(page)

  await page.getByRole('button', { name: /Générer l’annonce/ }).click()
  const draft = page.getByLabel("Brouillon d'annonce")
  await draft.waitFor({ timeout: 60_000 })
  const draftTitle = (await draft.locator('p').first().textContent())?.trim() ?? ''
  expect(draftTitle.length).toBeGreaterThan(2)

  await draft.locator('input[type="checkbox"]').check()
  await page.getByRole('button', { name: /Publier sur la marketplace/ }).click()
  await page.getByText('Annonce publiée').waitFor({ timeout: 20_000 })

  // EX-D4 : export texte → presse-papiers = titre + description + prix
  await page.getByRole('button', { name: /Copier pour Vinted \/ Leboncoin/ }).click()
  await expect(page.getByText('Copié !', { exact: true })).toBeVisible()

  const clip = await page.evaluate(() => navigator.clipboard.readText())
  expect(clip).toContain(draftTitle)
  expect(clip).toMatch(/Prix :/)
  expect(clip.length).toBeGreaterThan(draftTitle.length + 20)

  await ctx.close()
})

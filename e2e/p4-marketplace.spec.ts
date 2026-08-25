import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type BrowserContext } from '@playwright/test'

/**
 * P2.3 — Marketplace payante (EX-E1/E3/E5) : publication vendeur → fiche
 * acheteur → adresse → Checkout Stripe (session RÉELLE créée, AUCUNE carte
 * saisie : aucun débit) → retour → commande pending visible des deux côtés →
 * annulation par l'acheteur uniquement (RLS E3). Le cycle complet
 * paid→shipped→delivered→completed est prouvé par la matrice SQL RLS
 * (PREUVES.md) — pas de paiement réel en e2e (interdit sans feu vert).
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

async function login(page: import('@playwright/test').Page, account: { email: string; password: string }): Promise<void> {
  await ensureUserConfirmed(account.email, account.password)
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(account.email)
  await page.locator('input[type="password"]').fill(account.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/dashboard/, { timeout: 30_000 })
}

/** Scan + sauvegarde + estimation + génération + publication → titre publié. */
async function publishAnnonce(page: import('@playwright/test').Page): Promise<string> {
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
  await page.getByRole('button', { name: /Générer l’annonce/ }).click()
  const draft = page.getByLabel("Brouillon d'annonce")
  await draft.waitFor({ timeout: 60_000 })
  await draft.locator('input[type="checkbox"]').check()
  await page.getByRole('button', { name: /Publier sur la marketplace/ }).click()
  await page.getByText('Annonce publiée').waitFor({ timeout: 20_000 })
  return ((await page.locator('h1').first().textContent())?.trim() ?? '')
}

test('EX-E1/E5 — achat : adresse → Checkout Stripe réel, aucun règlement hors plateforme', async ({
  browser,
}) => {
  test.setTimeout(300_000)

  const sellerCtx: BrowserContext = await browser.newContext()
  const seller = await sellerCtx.newPage()
  await login(seller, SELLER)
  const title = await publishAnnonce(seller)
  expect(title.length).toBeGreaterThan(0)

  // EX-E1 : le vendeur ne peut PAS acheter son propre objet
  await seller.goto('/marketplace')
  await seller.getByRole('link').filter({ hasText: title }).first().click()
  await expect(seller.getByText(/C’est ton annonce/)).toBeVisible()

  const buyerCtx: BrowserContext = await browser.newContext()
  const buyer = await buyerCtx.newPage()
  await login(buyer, BUYER)

  await buyer.goto('/marketplace')
  await buyer.getByRole('link').filter({ hasText: title }).first().click()
  await expect(buyer.getByRole('heading', { level: 1, name: title })).toBeVisible()

  // EX-E5 : la seule voie affichée = Stripe, message anti-hors-plateforme
  await expect(buyer.getByText(/aucun règlement hors plateforme/)).toBeVisible()

  // Adresse de livraison (EX-G2 : cachée au vendeur avant paiement)
  await buyer.getByLabel('Nom complet').fill('Alex Acheteur')
  await buyer.getByLabel('Adresse').fill('9 avenue des Tests')
  await buyer.getByLabel('Code postal').fill('75011')
  await buyer.getByLabel('Ville').fill('Paris')

  // Acheter → session Checkout Stripe RÉELLE (aucun débit : pas de carte saisie)
  await buyer.getByRole('button', { name: /Acheter —/ }).click()
  await buyer.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 })
  expect(buyer.url()).toMatch(/checkout\.stripe\.com/)

  // Abandon contrôlé (pas de saisie carte) → commande reste pending côté app
  await buyer.goto('/commandes')
  const row = buyer.locator('li.glass').first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  await expect(row.getByText(/Achat · En attente de paiement/)).toBeVisible()

  // EX-E3 (e2e) : l'acheteur annule SA commande pending → RLS buyer
  await row.getByRole('button', { name: /Annuler la commande/ }).click()
  await expect(row.getByText(/Achat · Annulée/)).toBeVisible({ timeout: 15_000 })

  // Vendeur : voit la vente annulée, et PAS d'adresse de livraison
  await seller.goto('/commandes')
  const sale = seller.locator('li.glass').first()
  await expect(sale.getByText(/Vente · Annulée/)).toBeVisible({ timeout: 15_000 })
  await expect(sale.getByText('Adresse de livraison')).toHaveCount(0)

  await sellerCtx.close()
  await buyerCtx.close()
})

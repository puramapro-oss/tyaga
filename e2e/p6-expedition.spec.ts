import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/**
 * P2.5 — Expédition guidée (EX-G) : achat réel jusqu'au Checkout Stripe
 * (aucune carte saisie) → paiement simulé côté système (service, comme le
 * webhook karma) → checklist emballage vendeur (G1) → adresse visible
 * UNIQUEMENT après paiement (G2) → « expédié » vendeur + « reçu » acheteur
 * → commande completed + séquestre released (G3), preuve SQL via PostgREST.
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
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.waitForURL(/dashboard/, { timeout: 30_000 })
}

/** Scan + sauvegarde + estimation + génération + publication → titre publié. */
async function publishAnnonce(page: Page): Promise<string> {
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
  await page.getByText('Prix conseillé').waitFor({ timeout: 45_000 })
  await page.getByRole('button', { name: /Générer l’annonce/ }).click()
  const draft = page.getByLabel("Brouillon d'annonce")
  await draft.waitFor({ timeout: 60_000 })
  await draft.locator('input[type="checkbox"]').check()
  await page.getByRole('button', { name: /Publier sur la marketplace/ }).click()
  await page.getByText('Annonce publiée').waitFor({ timeout: 20_000 })
  return ((await page.locator('h1').first().textContent())?.trim() ?? '')
}

function serviceHeaders(): Record<string, string> {
  const serviceKey = envLocal('SUPABASE_SERVICE_ROLE_KEY')
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Accept-Profile': 'tyaga',
    // PostgREST lit le schéma des écritures dans Content-Profile (Accept ne
    // vaut que pour les lectures — PGRST205 sinon sur le PATCH)
    'Content-Profile': 'tyaga',
  }
}

/** Le webhook karma n'est pas déclenchable en e2e : le système (service)
 * passe la commande pending → paid + held, exactement comme le fulfillment. */
async function simulateStripePayment(orderId: string): Promise<void> {
  const url = envLocal('NEXT_PUBLIC_SUPABASE_URL')
  const res = await fetch(`${url}/rest/v1/marketplace_orders?id=eq.${orderId}`, {
    method: 'PATCH',
    headers: serviceHeaders(),
    body: JSON.stringify({ status: 'paid', escrow_status: 'held' }),
  })
  if (!res.ok) throw new Error(`simulate payment: ${res.status} ${await res.text()}`)
}

async function latestOrder(): Promise<{ id: string; status: string; escrow_status: string }> {
  const url = envLocal('NEXT_PUBLIC_SUPABASE_URL')
  const res = await fetch(
    `${url}/rest/v1/marketplace_orders?select=id,status,escrow_status&order=created_at.desc&limit=1`,
    { headers: serviceHeaders() }
  )
  if (!res.ok) throw new Error(`PostgREST: ${res.status} ${await res.text()}`)
  const rows = (await res.json()) as { id: string; status: string; escrow_status: string }[]
  return rows[0]
}

test('EX-G — expédition : checklist, adresse post-paiement, envoyé/reçu → completed', async ({
  browser,
}) => {
  test.setTimeout(300_000)

  const sellerCtx: BrowserContext = await browser.newContext()
  const seller = await sellerCtx.newPage()
  await login(seller, SELLER)
  const title = await publishAnnonce(seller)
  expect(title.length).toBeGreaterThan(0)

  const buyerCtx: BrowserContext = await browser.newContext()
  const buyer = await buyerCtx.newPage()
  await login(buyer, BUYER)

  await buyer.goto('/marketplace')
  await buyer.getByRole('link').filter({ hasText: title }).first().click()
  await buyer.getByLabel('Nom complet').fill('Alex Acheteur')
  await buyer.getByLabel('Adresse').fill('9 avenue des Tests')
  await buyer.getByLabel('Code postal').fill('75011')
  await buyer.getByLabel('Ville').fill('Paris')
  await buyer.getByRole('button', { name: /Acheter —/ }).click()
  await buyer.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 })

  // Commande pending créée → le système encaisse (rôle webhook)
  await buyer.goto('/commandes')
  const pendingRow = buyer.locator('li.glass').first()
  await expect(pendingRow.getByText(/Achat · En attente de paiement/)).toBeVisible({
    timeout: 15_000,
  })
  const order = await latestOrder()
  expect(order.status).toBe('pending')
  await simulateStripePayment(order.id)

  // EX-G1 : checklist emballage vendeur dès le paiement confirmé
  await seller.goto('/commandes')
  const sale = seller.locator('li.glass').first()
  await expect(sale.getByText(/Vente · Payée/)).toBeVisible({ timeout: 15_000 })
  const checklist = sale.locator('section[aria-label="Emballage avant envoi"]')
  await expect(checklist).toBeVisible()
  await expect(checklist.getByText('0/6 étapes')).toBeVisible()

  // EX-G2 : adresse visible par le vendeur APRÈS paiement uniquement
  await expect(sale.getByText('Adresse de livraison')).toBeVisible()
  await expect(sale.getByText('Alex Acheteur')).toBeVisible()

  // La case cochée progresse (mémorisée par commande)
  await checklist.getByLabel(/Étape 1 :/).check()
  await expect(checklist.getByText('1/6 étapes')).toBeVisible()

  // EX-G3 : vendeur marque expédié → checklist disparaît, statut Expédiée
  await sale.getByRole('button', { name: /Objet expédié/ }).click()
  await expect(sale.getByText(/Vente · Expédiée/)).toBeVisible({ timeout: 15_000 })
  await expect(sale.locator('section[aria-label="Emballage avant envoi"]')).toHaveCount(0)

  // Acheteur confirme la réception → vente finalisée
  await buyer.goto('/commandes')
  const purchase = buyer.locator('li.glass').first()
  await expect(purchase.getByText(/Achat · Expédiée/)).toBeVisible({ timeout: 15_000 })
  await purchase.getByRole('button', { name: /J’ai bien reçu l’objet|J'ai bien reçu l'objet/ }).click()
  await expect(purchase.getByText(/Achat · Terminée/)).toBeVisible({ timeout: 15_000 })
  await expect(purchase.getByText('Vendeur payé')).toBeVisible()

  // Preuve SQL : completed + released
  const final = await latestOrder()
  expect(final.id).toBe(order.id)
  expect(final.status).toBe('completed')
  expect(final.escrow_status).toBe('released')

  await sellerCtx.close()
  await buyerCtx.close()
})

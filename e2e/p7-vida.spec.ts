import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/**
 * P2.6 — Vida Vault sandbox (EX-H) : vente complétée → points crédités (H1),
 * proposition 50 % vers un objectif (H2), confirmation EXPLICITE (H3),
 * progression à jour (H4), libellé sandbox visible (H5), preuve SQL wallet +
 * objectif via PostgREST. 0 appel de virement dans le code (grep = PREUVES).
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
    'Content-Profile': 'tyaga',
  }
}

async function rest(path: string): Promise<unknown> {
  const url = envLocal('NEXT_PUBLIC_SUPABASE_URL')
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: serviceHeaders() })
  if (!res.ok) throw new Error(`PostgREST ${path}: ${res.status} ${await res.text()}`)
  return res.json()
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

async function latestOrder(): Promise<{ id: string; status: string }> {
  const rows = (await rest(
    'marketplace_orders?select=id,status&order=created_at.desc&limit=1'
  )) as { id: string; status: string }[]
  return rows[0]
}

async function sellerWalletBalance(sellerId: string): Promise<number> {
  const rows = (await rest(
    `vida_wallet?user_id=eq.${sellerId}&select=balance_points`
  )) as { balance_points: number }[]
  return rows[0]?.balance_points ?? 0
}

/** Les comptes e2e persistent entre exécutions : on purge les propositions
 * restées « proposed » pour ne confirmer que celle de CE run. */
async function purgeProposedTransfers(sellerId: string): Promise<void> {
  const url = envLocal('NEXT_PUBLIC_SUPABASE_URL')
  const res = await fetch(
    `${url}/rest/v1/vida_transfers?user_id=eq.${sellerId}&status=eq.proposed`,
    { method: 'DELETE', headers: serviceHeaders() }
  )
  if (!res.ok) throw new Error(`purge proposed: ${res.status} ${await res.text()}`)
}

test('EX-H — Vida : points, proposition 50 %, confirmation explicite, progression', async ({
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

  await buyer.goto('/commandes')
  await expect(
    buyer.locator('li.glass').first().getByText(/Achat · En attente de paiement/)
  ).toBeVisible({ timeout: 15_000 })
  const order = await latestOrder()
  await simulateStripePayment(order.id)

  // Chaîne complète jusqu'à completed (déclenche le crédit de points EX-H1)
  await seller.goto('/commandes')
  const sale = seller.locator('li.glass').first()
  await expect(sale.getByText(/Vente · Payée/)).toBeVisible({ timeout: 15_000 })
  await sale.getByRole('button', { name: /Objet expédié/ }).click()
  await expect(sale.getByText(/Vente · Expédiée/)).toBeVisible({ timeout: 15_000 })
  await buyer.goto('/commandes')
  const purchase = buyer.locator('li.glass').first()
  await expect(purchase.getByText(/Achat · Expédiée/)).toBeVisible({ timeout: 15_000 })
  await purchase.getByRole('button', { name: /J’ai bien reçu l’objet|J'ai bien reçu l'objet/ }).click()
  await expect(purchase.getByText(/Achat · Terminée/)).toBeVisible({ timeout: 15_000 })

  // Preuve SQL de la vente + solde AVANT transfert (les comptes e2e se
  // réutilisent entre specs : on raisonne en delta, jamais en absolu)
  const ventes = (await rest(
    `ventes?order_id=eq.${order.id}&select=seller_id,net_amount_cents`
  )) as { seller_id: string; net_amount_cents: number }[]
  expect(ventes.length).toBe(1)
  const net = ventes[0].net_amount_cents
  const netPts = Math.floor(net / 100)
  const transferredPts = Math.floor((netPts * 50) / 100)
  const before = await sellerWalletBalance(ventes[0].seller_id)
  expect(before).toBeGreaterThanOrEqual(netPts) // EX-H1 : le net est crédité
  await purgeProposedTransfers(ventes[0].seller_id)

  // EX-H5 — libellé sandbox visible en permanence
  await seller.goto('/vida')
  await expect(seller.getByText('Sandbox :')).toBeVisible()

  // EX-H4 — création d'un objectif
  const objectifNom = `Abonnement Vida e2e ${Date.now()}`
  await seller.getByLabel('Nom').fill(objectifNom)
  await seller.getByLabel(/Cible/).fill('100')
  await seller.getByRole('button', { name: /Créer l’objectif/ }).click()
  const objectifCard = seller.locator(`article[aria-label="Objectif ${objectifNom}"]`)
  await expect(objectifCard.getByText('0 / 100 pts')).toBeVisible({ timeout: 15_000 })

  // EX-H2 — proposition 50 % vers l'objectif (jamais automatique)
  const proposalForm = seller.locator('form[aria-label^="Répartir la vente"]').first()
  await expect(proposalForm).toBeVisible()
  await proposalForm.locator('input[type="radio"][value="50"]').check()
  await proposalForm.getByLabel(/Objectif destinataire/).selectOption({ label: objectifNom })
  await proposalForm.getByRole('button', { name: /^Proposer/ }).click()

  // EX-H3 — étape 2 : confirmation EXPLICITE, rien n'a bougé avant
  const pendingCard = seller
    .locator('article')
    .filter({ hasText: `${transferredPts} pts vers « ${objectifNom} »` })
  await expect(pendingCard.getByText('Proposition en attente de ta confirmation')).toBeVisible({
    timeout: 15_000,
  })
  await expect(objectifCard.getByText('0 / 100 pts')).toBeVisible() // toujours 0
  await pendingCard.getByRole('button', { name: /Confirmer le transfert/ }).click()

  // EX-H4 — progression à jour après confirmation
  await expect(objectifCard.getByText(`${transferredPts} / 100 pts`)).toBeVisible({
    timeout: 15_000,
  })
  await expect(
    seller
      .locator('section[aria-label="Historique des transferts"]')
      .getByText('Confirmé', { exact: true })
      .first()
  ).toBeVisible()

  // Preuve SQL finale : wallet débité, objectif crédité — cohérence exacte
  const after = await sellerWalletBalance(ventes[0].seller_id)
  expect(after).toBe(before - transferredPts)
  const objectifsRows = (await rest(
    `vida_objectifs?label=eq.${encodeURIComponent(objectifNom)}&select=current_points,target_points`
  )) as { current_points: number; target_points: number }[]
  expect(objectifsRows[0].current_points).toBe(transferredPts)
  expect(objectifsRows[0].target_points).toBe(100)

  await sellerCtx.close()
  await buyerCtx.close()
})

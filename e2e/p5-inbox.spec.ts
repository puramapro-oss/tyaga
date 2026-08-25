import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/**
 * P2.4 — Inbox assistant + anti-fraude (EX-F) : plancher vendeur (F3) →
 * contact acheteur → offre chiffrée → clic modèle vendeur « refus sous
 * plancher » (F2 : envoi UNIQUEMENT sur clic) → message « PayPal » bloqué +
 * avertissement FR à l'envoyeur, JAMAIS visible du destinataire (F4) →
 * vérification SQL `flagged_off_platform` via PostgREST service key.
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

/** F4 — le dernier message de la conversation est-il flaggé ? (PostgREST service) */
async function lastMessageFlag(): Promise<{ body: string; flagged: boolean }> {
  const url = envLocal('NEXT_PUBLIC_SUPABASE_URL')
  const serviceKey = envLocal('SUPABASE_SERVICE_ROLE_KEY')
  const res = await fetch(
    `${url}/rest/v1/inbox_messages?select=body,flagged_off_platform&order=created_at.desc&limit=1`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Accept-Profile': 'tyaga',
      },
    }
  )
  if (!res.ok) throw new Error(`PostgREST: ${res.status} ${await res.text()}`)
  const rows = (await res.json()) as { body: string; flagged_off_platform: boolean }[]
  return { body: rows[0].body, flagged: rows[0].flagged_off_platform }
}

test('EX-F — inbox : contact, offre, refus sous plancher, blocage PayPal', async ({ browser }) => {
  test.setTimeout(300_000)

  const sellerCtx: BrowserContext = await browser.newContext()
  const seller = await sellerCtx.newPage()
  await login(seller, SELLER)
  await publishAnnonce(seller)

  // EX-F3 : le vendeur fixe un plancher de 60 € (page objet déjà ouverte)
  const floorPanel = seller.locator('section[aria-label="Prix plancher"]')
  await floorPanel.getByLabel('Plancher en euros').fill('60')
  await floorPanel.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(floorPanel.getByText('Enregistré', { exact: true })).toBeVisible({ timeout: 15_000 })

  // EX-F1 : l'acheteur contacte le vendeur depuis l'annonce
  const buyerCtx: BrowserContext = await browser.newContext()
  const buyer = await buyerCtx.newPage()
  await login(buyer, BUYER)
  await buyer.goto('/marketplace')
  // marketplace triée published_at desc → notre annonce est la première carte
  await buyer.locator('ul.grid a').first().click()
  await buyer.waitForURL(/marketplace\/[0-9a-f-]+/, { timeout: 15_000 })
  await buyer.getByRole('button', { name: /Poser une question/ }).click()
  await buyer.waitForURL(/messages\/[0-9a-f-]+/, { timeout: 15_000 })

  // Suggestions acheteur PROPOSÉES (F2) : clic sur la première = envoi explicite
  await buyer.getByRole('button', { name: /Répondre/ }).first().click()
  await expect(buyer.getByText(/toujours disponible \?/).last()).toBeVisible({ timeout: 15_000 })

  // Titre réel de l'annonce = h1 du fil, MAINTENANT que la conversation est chargée
  const annonceTitle = ((await buyer.locator('h1').first().textContent())?.trim() ?? '')
  expect(annonceTitle.length).toBeGreaterThan(5)

  // Offre chiffrée 50 € < plancher 60 € (F3 côté vendeur ensuite)
  await buyer.getByLabel(/Montant de l'offre/).fill('50')
  await buyer.getByRole('button', { name: 'Proposer' }).click()
  await expect(buyer.getByText('Offre : 50')).toBeVisible({ timeout: 15_000 })

  // Vendeur : voit l'offre, suggestion Refus ≥ plancher — envoi sur CLIC (F2/F3)
  await seller.goto('/messages')
  await seller.getByRole('link').filter({ hasText: annonceTitle }).first().click()
  await seller.waitForURL(/messages\/[0-9a-f-]+/, { timeout: 15_000 })
  await expect(seller.getByText('Offre : 50')).toBeVisible({ timeout: 20_000 })
  await expect(seller.getByText(/plancher/).first()).toBeVisible()
  // F3 : le contre-propos chiffré proposé au vendeur = le plancher exact (60 €)
  const negotiate = seller.getByRole('button', { name: /Négocier/ }).first()
  await expect(negotiate.locator('span.font-mono')).toHaveText(/60/)
  const decline = seller.getByRole('button', { name: /Refuser/ }).first()
  await decline.click()
  await expect(seller.getByText(/Je ne descends pas sous 60/).last()).toBeVisible({ timeout: 15_000 })

  // EX-F4 : « PayPal » côté acheteur → message BLOQUÉ + avertissement FR
  await buyer.locator('input[aria-label="Message"]').fill('On peut payer via PayPal ?')
  await buyer.getByRole('button', { name: 'Envoyer' }).click()
  await expect(buyer.getByText(/Message bloqué : PayPal détecté/)).toBeVisible({ timeout: 15_000 })

  // Le vendeur ne voit JAMAIS le message bloqué (RLS msgs_select)
  await seller.reload()
  await expect(seller.getByText(/PayPal/)).toHaveCount(0)
  await expect(seller.getByText(/Je ne descends pas sous 60/).last()).toBeVisible()

  // Preuve SQL : dernier message persisté flagged_off_platform = true
  const flag = await lastMessageFlag()
  expect(flag.body).toContain('PayPal')
  expect(flag.flagged).toBe(true)

  // La liste /messages existe des deux côtés
  await buyer.goto('/messages')
  await expect(buyer.getByText(annonceTitle).first()).toBeVisible({ timeout: 15_000 })

  await sellerCtx.close()
  await buyerCtx.close()
})

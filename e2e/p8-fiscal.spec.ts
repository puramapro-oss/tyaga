import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

/**
 * P2.7 — EX-J7 fiscal : compteur de revenus annuels nets sur /dashboard,
 * bannière d'alerte dès 250 € nets cumulés (>=, frontière incluse).
 * Les prix IA varient à chaque exécution → on PATCH la dernière vente du
 * vendeur à 300 € nets (service, comme le fulfillment) pour franchir le
 * seuil de façon déterministe, et on raisonne sur le cumul réel de l'année.
 */

const SELLER = { email: 'tyaga-e2e@purama-test.dev', password: 'TyagaE2e!2026aA' }
const YEAR = new Date().getFullYear()

interface Vente {
  id: string
  seller_id: string
  net_amount_cents: number
  fiscal_year: number
}

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

async function login(page: import('@playwright/test').Page): Promise<void> {
  await ensureUserConfirmed(SELLER.email, SELLER.password)
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(SELLER.email)
  await page.locator('input[type="password"]').fill(SELLER.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.waitForURL(/dashboard/, { timeout: 30_000 })
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

/** Même formatage que src/lib/fiscal.ts — la comparaison est byte-à-byte. */
function formatEuros(cents: number): string {
  return `${Math.round(cents / 100).toLocaleString('fr-FR')} €`
}

test('EX-J7 — compteur revenus annuels + alerte dès 250 € nets cumulés', async ({
  browser,
}) => {
  test.setTimeout(180_000)

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await login(page)

  // Cumul réel du vendeur sur l'année (les specs p6/p7 ont produit >= 1 vente)
  const ventes = (await rest(
    'ventes?order=completed_at.desc&select=id,seller_id,net_amount_cents,fiscal_year'
  )) as Vente[]
  const rowsYear = ventes.filter((v) => v.fiscal_year === YEAR)
  expect(rowsYear.length).toBeGreaterThan(0)
  const sumBefore = rowsYear.reduce((acc, v) => acc + v.net_amount_cents, 0)

  // État initial : le compteur affiche le cumul réel (alerte OU progression,
  // selon les runs précédents — on ne présuppose pas)
  await page.goto('/dashboard')
  const section = page.locator('section[aria-label="Revenus annuels"]')
  await expect(section).toBeVisible()
  await expect(section.getByText(`Revenus nets ${YEAR}`)).toBeVisible()
  await expect(section.getByText(formatEuros(sumBefore)).first()).toBeVisible()

  // Dernière vente de l'année → 300 € nets déterministes (service = fulfillment)
  const target = rowsYear[0]
  const url = envLocal('NEXT_PUBLIC_SUPABASE_URL')
  const res = await fetch(`${url}/rest/v1/ventes?id=eq.${target.id}`, {
    method: 'PATCH',
    headers: serviceHeaders(),
    body: JSON.stringify({
      net_amount_cents: 30_000,
      gross_amount_cents: 33_333,
      commission_amount_cents: 3_333,
    }),
  })
  if (!res.ok) throw new Error(`patch vente: ${res.status} ${await res.text()}`)

  const sumAfter = sumBefore - target.net_amount_cents + 30_000
  expect(sumAfter).toBeGreaterThanOrEqual(25_000) // seuil franchi, >=

  // Bannière d'alerte + cumul à jour
  await page.reload()
  const alerted = page.locator('section[aria-label="Revenus annuels"]')
  await expect(alerted.getByLabel('Alerte seuil fiscal 250 euros')).toBeVisible()
  await expect(
    alerted.getByText('250 € de revenus nets atteints cette année.')
  ).toBeVisible()
  await expect(alerted.getByText(formatEuros(sumAfter)).first()).toBeVisible()
  // La barre de progression disparaît au profit de l'alerte
  await expect(alerted.getByRole('progressbar')).toHaveCount(0)

  await ctx.close()
})

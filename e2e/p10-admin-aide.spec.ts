import { readFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

/**
 * P4 — /aide (chatbot SAV + FAQ) et /admin (God Mode super-admin).
 * ZÉRO appel IA : le chatbot n'est pas déclenché (pas de crédit brûlé) ;
 * on teste le rendu, le guard 401 et le gate admin via le flag DB
 * is_super_admin — JAMAIS via le compte réel matiss.frasne@gmail.com.
 */

const SELLER = { email: 'tyaga-e2e@purama-test.dev', password: 'TyagaE2e!2026aA' }

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

async function profileId(email: string): Promise<string> {
  const url = envLocal('NEXT_PUBLIC_SUPABASE_URL')
  const res = await fetch(`${url}/rest/v1/profiles?email=eq.${email}&select=id`, {
    headers: serviceHeaders(),
  })
  if (!res.ok) throw new Error(`PostgREST profiles: ${res.status} ${await res.text()}`)
  const rows = (await res.json()) as { id: string }[]
  if (!rows.length) throw new Error(`profil introuvable: ${email}`)
  return rows[0].id
}

/** Bascule le flag super-admin du profil — permet le gate sans compte réel. */
async function setSuperAdmin(id: string, value: boolean): Promise<void> {
  const url = envLocal('NEXT_PUBLIC_SUPABASE_URL')
  const res = await fetch(`${url}/rest/v1/profiles?id=eq.${id}`, {
    method: 'PATCH',
    headers: serviceHeaders(),
    body: JSON.stringify({ is_super_admin: value }),
  })
  if (!res.ok) throw new Error(`patch is_super_admin: ${res.status} ${await res.text()}`)
}

test('/aide — FAQ complète + chatbot SAV rendu', async ({ page }) => {
  await login(page, SELLER)
  await page.goto('/aide')
  await expect(page.getByRole('heading', { name: 'Aide & FAQ' })).toBeVisible()

  // Les 6 catégories de la FAQ, en accordéon natif
  const details = page.locator('details')
  await expect(details.first()).toBeVisible()
  expect(await details.count()).toBeGreaterThanOrEqual(6)
  await expect(page.getByRole('heading', { name: 'Paiement & commission' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sécurité & litiges' })).toBeVisible()

  // Chatbot : suggestions rapides + zone de saisie présentes (aucun envoi IA)
  await expect(
    page.getByRole('button', { name: 'Comment suis-je payé pour une vente ?' })
  ).toBeVisible()
  await expect(page.getByLabel('Ta question au support TYAGA')).toBeVisible()

  // Contact humain visible (lien mailto de la carte contact, hors accordéon)
  await expect(
    page.getByRole('link', { name: 'hello@tyaga.purama.dev' })
  ).toHaveAttribute('href', 'mailto:hello@tyaga.purama.dev')
})

test('/api/ai/support — non connecté : 401 en français', async ({ request }) => {
  const res = await request.post('/api/ai/support', {
    data: { message: 'Où est ma commande ?', history: [] },
  })
  expect(res.status()).toBe(401)
  const body = (await res.json()) as { error?: string }
  expect(body.error).toContain('Connecte-toi')
})

test('/admin — gate : non-admin renvoyé au dashboard, super-admin voit le God Mode', async ({
  page,
}) => {
  const sellerId = await profileId(SELLER.email)
  await setSuperAdmin(sellerId, false)

  // 1. Simple utilisateur : redirection immédiate, aucun contenu admin
  await login(page, SELLER)
  await page.goto('/admin')
  await page.waitForURL(/dashboard/, { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'God Mode' })).toHaveCount(0)

  // 2. Flag super-admin activé → accès lecture seule au God Mode
  await setSuperAdmin(sellerId, true)
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'God Mode' })).toBeVisible()
  await expect(page.locator('.text-gold').first()).toBeVisible()
  await expect(page.getByText('Utilisateurs').first()).toBeVisible()
  await expect(page.getByText('Commandes').first()).toBeVisible()
  await expect(page.getByText('Litiges').first()).toBeVisible()

  // 3. Retour à la normale : le gate se referme
  await setSuperAdmin(sellerId, false)
  await page.goto('/admin')
  await page.waitForURL(/dashboard/, { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'God Mode' })).toHaveCount(0)
})

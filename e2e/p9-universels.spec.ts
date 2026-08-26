import { readFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

/**
 * P3 — EX-K2 universels : 3 blocs above the fold sur /dashboard (parrainage,
 * ambassadeur, cross-promo VIDA/KASH WELCOME50) + solde Vault, puis boucle
 * complète du Parrainage V4 : le filleul consomme le code du vendeur et le
 * compteur du parrain passe à 1. Garde self : son propre code ne crée rien.
 */

const SELLER = { email: 'tyaga-e2e@purama-test.dev', password: 'TyagaE2e!2026aA' }
const BUYER = { email: 'tyaga-e2e-2@purama-test.dev', password: 'TyagaE2e!2026aA' }

const CODE_RE = /TY-[A-F0-9]{6}/

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

/**
 * Change d'utilisateur dans le MÊME contexte : sans purge, le middleware
 * voit la session du précédent et redirige /login → /dashboard.
 */
async function logout(page: Page): Promise<void> {
  await page.context().clearCookies()
  await page.evaluate(() => {
    try {
      localStorage.clear()
      sessionStorage.clear()
    } catch {}
  })
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

async function rest(path: string): Promise<unknown> {
  const url = envLocal('NEXT_PUBLIC_SUPABASE_URL')
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: serviceHeaders() })
  if (!res.ok) throw new Error(`PostgREST ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function profileId(email: string): Promise<string> {
  const rows = (await rest(`profiles?email=eq.${email}&select=id`)) as { id: string }[]
  if (!rows.length) throw new Error(`profil introuvable: ${email}`)
  return rows[0].id
}

/** Nettoie les rattachements antérieurs du filleul pour un run déterministe. */
async function resetReferrals(referredId: string): Promise<void> {
  const url = envLocal('NEXT_PUBLIC_SUPABASE_URL')
  const res = await fetch(`${url}/rest/v1/referrals?referred_id=eq.${referredId}`, {
    method: 'DELETE',
    headers: serviceHeaders(),
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`reset referrals: ${res.status} ${await res.text()}`)
  }
}

test('EX-K2 — 4 blocs universels visibles above the fold', async ({ page }) => {
  await login(page, SELLER)
  await expect(page.getByRole('heading', { name: 'Parrainage' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ambassadeur' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Écosystème PURAMA' })).toBeVisible()
  await expect(page.getByText('Vida Vault')).toBeVisible()

  // Code au format TY-XXXXXX affiché + lien d'invitation copiable
  const codeText = await page.locator('p.font-mono', { hasText: CODE_RE }).first().textContent()
  expect(codeText ?? '').toMatch(CODE_RE)
  await expect(page.getByRole('button', { name: 'Copier mon lien d’invitation' })).toBeVisible()

  // Cross-promo : les 2 apps sœurs + le code WELCOME50
  await expect(page.getByRole('link', { name: /VIDA/ })).toHaveAttribute(
    'href',
    'https://vida.purama.dev'
  )
  await expect(page.getByRole('link', { name: /KASH/ })).toHaveAttribute(
    'href',
    'https://kash.purama.dev'
  )
  await expect(
    page.getByRole('button', { name: 'Copier le code WELCOME50' })
  ).toBeVisible()
})

test('Parrainage V4 — le filleul se rattache, le compteur parrain passe à 1', async ({
  page,
}) => {
  const sellerId = await profileId(SELLER.email)
  const buyerId = await profileId(BUYER.email)
  await resetReferrals(buyerId)

  // 1. Code du vendeur lu sur SON dashboard
  await login(page, SELLER)
  const code = (await page.locator('p.font-mono', { hasText: CODE_RE }).first().textContent())?.trim()
  if (!code) throw new Error('code parrain illisible sur le dashboard')
  expect(code).toMatch(CODE_RE)

  // 2. Le filleul dépose le code (même chemin que /signup?ref=… → dashboard)
  await logout(page)
  await login(page, BUYER)
  await page.evaluate((c) => sessionStorage.setItem('tyaga_ref', c), code)
  await page.reload()
  await page.waitForURL(/dashboard/)
  await expect(page.getByRole('heading', { name: 'Écosystème PURAMA' })).toBeVisible()

  // 3. Ligne referrals créée : referrer = vendeur, referred = acheteur
  // (poll : l'attach POST s'exécute après hydratation du dashboard)
  await expect
    .poll(
      async () =>
        ((await rest(`referrals?referred_id=eq.${buyerId}&select=referrer_id,code`)) as {
          referrer_id: string
          code: string
        }[]),
      { timeout: 15_000 }
    )
    .toHaveLength(1)
  const rows = (await rest(
    `referrals?referred_id=eq.${buyerId}&select=referrer_id,code`
  )) as { referrer_id: string; code: string }[]
  expect(rows[0].referrer_id).toBe(sellerId)
  expect(rows[0].code).toBe(code)

  // 4. Le compteur du parrain reflète 1 filleul rattaché
  await logout(page)
  await login(page, SELLER)
  await expect(page.getByText('1 filleul', { exact: true })).toBeVisible()

  // 5. Garde self : rejouer SON propre code ne crée aucune ligne
  await page.evaluate((c) => sessionStorage.setItem('tyaga_ref', c), code)
  const attachDone = page.waitForResponse(
    (r) => r.url().includes('/api/referral/attach'),
    { timeout: 15_000 }
  )
  await page.reload()
  await attachDone
  const selfRows = (await rest(
    `referrals?referrer_id=eq.${sellerId}&referred_id=eq.${sellerId}&select=id`
  )) as unknown[]
  expect(selfRows).toHaveLength(0)
})

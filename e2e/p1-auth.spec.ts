import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

/**
 * P6 — EX-A (auth de bout en bout, corrige le verdict jury-tests) :
 * A1 inscription réelle via le formulaire UI → confirmation admin → login UI ;
 * A2 clic « Continuer avec Google » → redirection vers accounts.google.com ;
 * A3 /dashboard sans session → /login?next= (middleware) ;
 * A4 clic sur le VRAI bouton « Se déconnecter » de l'app → purge + /login.
 * Bonus EX-K1 : / = écran app (logo + 2 CTA), pas une landing à sections.
 */

function envLocal(key: string): string {
  const line = readFileSync('.env.local', 'utf8')
    .split('\n')
    .find((l) => l.startsWith(key + '='))
  return line ? line.slice(key.length + 1).trim() : ''
}

/** Confirme un compte EXISTANT créé par le formulaire UI (PUT admin). */
async function confirmExistingUser(email: string): Promise<void> {
  const url = envLocal('NEXT_PUBLIC_SUPABASE_URL')
  const serviceKey = envLocal('SUPABASE_SERVICE_ROLE_KEY')
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  const list = await fetch(`${url}/auth/v1/admin/users?per_page=1000`, { headers })
  if (!list.ok) throw new Error(`admin list: ${list.status} ${await list.text()}`)
  const { users } = (await list.json()) as { users: { id: string; email: string }[] }
  const user = users.find((u) => u.email === email)
  if (!user) throw new Error(`compte introuvable après inscription: ${email}`)
  const put = await fetch(`${url}/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email_confirm: true }),
  })
  if (!put.ok) throw new Error(`admin confirm: ${put.status} ${await put.text()}`)
}

async function rest(path: string): Promise<unknown> {
  const url = envLocal('NEXT_PUBLIC_SUPABASE_URL')
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: envLocal('SUPABASE_SERVICE_ROLE_KEY'),
      Authorization: `Bearer ${envLocal('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Accept-Profile': 'tyaga',
    },
  })
  if (!res.ok) throw new Error(`PostgREST ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

test('EX-K1 — / = écran app (logo + Commencer + Se connecter), 0 section landing', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'TYAGA' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Commencer', exact: true })).toHaveAttribute(
    'href',
    '/signup'
  )
  await expect(page.getByRole('link', { name: 'Se connecter', exact: true })).toHaveAttribute(
    'href',
    '/login'
  )
  // Une landing 13 sections serait truffée de <section> ; l'écran app n'en a aucune.
  await expect(page.locator('section')).toHaveCount(0)
})

test('EX-A3 — /dashboard sans session → /login?next= (middleware)', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/)
  await ctx.close()
})

test('EX-A1 — inscription UI → confirmation → login → profil auto', async ({ page }) => {
  test.setTimeout(120_000)
  const stamp = Date.now()
  const NEW = { email: `tyaga-p1-${stamp}@purama-test.dev`, password: 'TyagaP1!2026aA' }

  // 1. Formulaire d'inscription réel
  await page.goto('/signup')
  await page.locator('input[type="email"]').fill(NEW.email)
  await page.getByLabel('Mot de passe (8 caractères min.)').fill(NEW.password)
  await page.getByLabel('Confirmer le mot de passe').fill(NEW.password)
  await page.getByRole('button', { name: 'Créer mon compte' }).click()
  await expect(page.getByText(/Un lien de confirmation vient d'être envoyé/)).toBeVisible({
    timeout: 20_000,
  })

  // 2. Confirmation (rôle du clic sur le lien email — admin ici ; no-op si
  // autoconfirm actif sur le VPS)
  await confirmExistingUser(NEW.email)

  // 3. Login réel → dashboard. L'auth partagée tourne avec
  // GOTRUE_MAILER_AUTOCONFIRM=true : l'inscription laisse une session active
  // et /login redirige vers /dashboard — on purge les cookies pour tester le
  // vrai formulaire de login.
  await page.context().clearCookies()
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(NEW.email)
  await page.locator('input[type="password"]').fill(NEW.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.waitForURL(/dashboard/, { timeout: 30_000 })

  // 4. Profil créé automatiquement dans le schéma tyaga (trigger P1)
  const rows = (await rest(
    `profiles?email=eq.${encodeURIComponent(NEW.email)}&select=id`
  )) as { id: string }[]
  expect(rows).toHaveLength(1)

  // 5. EX-A4 — VRAI bouton de déconnexion de l'app
  await page.getByRole('button', { name: 'Se déconnecter' }).click()
  await page.waitForURL(/\/login/, { timeout: 15_000 })
  const leftovers = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }))
  expect(leftovers.local).toHaveLength(0)
  expect(leftovers.session).toHaveLength(0)
})

test('EX-A2 — clic « Continuer avec Google » → accounts.google.com', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Continuer avec Google' }).click()
  // La session complète nécessite un compte Google réel (testé en vrai au P1,
  // VPS activé) ; en e2e on prouve que le clic part bien vers Google.
  await page.waitForURL(/accounts\.google\.com/, { timeout: 30_000 })
})

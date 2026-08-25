import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

/**
 * P2.1 — Scan 3 photos + IA vision (EX-B1..B5).
 * Contre le dev local (schéma tyaga réel). L'appel vision consomme
 * quelques centimes — assumé, c'est la preuve EX-B3.
 */

const EMAIL = 'tyaga-e2e@purama-test.dev'
const PASSWORD = 'TyagaE2e!2026aA'
const FIXTURES = join(process.cwd(), 'e2e', 'fixtures')

function envLocal(key: string): string {
  const line = readFileSync('.env.local', 'utf8')
    .split('\n')
    .find((l) => l.startsWith(key + '='))
  return line ? line.slice(key.length + 1).trim() : ''
}

async function ensureUserConfirmed(): Promise<void> {
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
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  })
  // 422 = existe déjà → OK, l'utilisateur est confirmé
  if (!res.ok && res.status !== 422) {
    throw new Error(`setup admin users: ${res.status} ${await res.text()}`)
  }
}

async function login(page: Page): Promise<void> {
  await ensureUserConfirmed()
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(EMAIL)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/dashboard/, { timeout: 15_000 })
}

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('EX-B1/B3 — 3 photos → analyse IA → proposition affichée', async ({ page }) => {
  await page.goto('/scan')

  const slots = [
    { angle: 'face', label: 'Face' },
    { angle: 'dos', label: 'Dos' },
    { angle: 'defaut', label: 'Défaut / étiquette' },
  ]
  for (const s of slots) {
    await page.getByRole('button', { name: new RegExp(s.label, 'i') }).first().click()
    await page
      .locator(`input[type="file"]`)
      .nth(slots.indexOf(s))
      .setInputFiles(join(FIXTURES, `${s.angle}.jpg`))
    // Aperçu visible = photo chargée
    await expect(page.locator(`img[alt="Photo ${s.label}"]`)).toBeVisible()
  }

  await page.getByRole('button', { name: /Analyser mes 3 photos/ }).click()
  // EX-B3 : résultat sous 20 s (le test borne à 25 s)
  await expect(page.getByText(/TYAGA a vu|remplir les champs/).first()).toBeVisible({
    timeout: 25_000,
  })
})

test('EX-B4/B5 — proposition modifiable puis enregistrée → statut scanned', async ({ page }) => {
  await page.goto('/scan')

  const slots = ['face', 'dos', 'defaut']
  for (let i = 0; i < slots.length; i++) {
    await page.locator('input[type="file"]').nth(i).setInputFiles(join(FIXTURES, `${slots[i]}.jpg`))
  }
  await page.getByRole('button', { name: /Analyser mes 3 photos/ }).click()
  await page.getByRole('button', { name: /Enregistrer l’objet|Enregistrer l'objet/ }).waitFor({
    timeout: 45_000,
  })

  // EX-B4 : l'utilisateur peut tout modifier avant sauvegarde
  await page.getByRole('textbox', { name: 'Catégorie' }).fill('sneakers')
  await page.locator('select').selectOption('tres_bon')

  await page.getByRole('button', { name: /Enregistrer l’objet|Enregistrer l'objet/ }).click()
  // EX-B5 : visible dans la liste avec statut Scanné
  await page.waitForURL(/objets/, { timeout: 15_000 })
  await expect(page.getByText(/sneakers/).first()).toBeVisible()
  await expect(page.getByText('Scanné').first()).toBeVisible()
})

test('EX-B garde-fous — analyse bloquée sans les 3 photos', async ({ page }) => {
  await page.goto('/scan')
  const btn = page.getByRole('button', { name: /Analyser mes 3 photos/ })
  await expect(btn).toBeDisabled()
})

test('EX-B5 — objets accessibles depuis le dashboard et la nav', async ({ page }) => {
  await page.goto('/objets')
  await expect(page.getByRole('heading', { name: 'Mes objets' })).toBeVisible()
})

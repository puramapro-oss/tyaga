import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

/**
 * P2.2 — Estimation + net commission serveur (EX-C1..C5).
 * Déroule scan → sauvegarde → fiche → estimation. 2 appels IA
 * (vision + estimation) — assumé, c'est la preuve EX-C.
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

/** Scan + sauvegarde → URL de la fiche du dernier objet créé. */
async function scanAndSaveItem(page: Page): Promise<void> {
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
  // Dernier objet = premier de la liste (created_at desc)
  await page.getByRole('link').filter({ hasText: /sneakers/ }).first().click()
  await page.waitForURL(/objets\/[0-9a-f-]+/, { timeout: 15_000 })
}

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('EX-C1/C2/C3/C5 — estimation affiche prix, fourchette, délai estimé, taux et net', async ({
  page,
}) => {
  test.setTimeout(150_000)
  await scanAndSaveItem(page)

  await page.getByRole('button', { name: /Estimer la vente/ }).click()

  // EX-C1 : prix conseillé + fourchette + délai
  await expect(page.getByText('Prix conseillé')).toBeVisible({ timeout: 45_000 })
  await expect(page.getByText('Fourchette')).toBeVisible()
  await expect(page.getByText('Délai estimé', { exact: true })).toBeVisible()

  // EX-C3 : taux affiché avant toute publication
  await expect(page.getByText(/Commission TYAGA \(10 %\)/)).toBeVisible()
  // EX-C2 : net serveur affiché
  await expect(page.getByText('Net pour toi')).toBeVisible()
  await expect(page.getByText(/^−\d/).first()).toBeVisible()

  // EX-C5 : formulation « estimé », 0 occurrence de « garanti » dans l'UI
  await expect(page.getByText('Délai estimé', { exact: true })).toBeVisible()
  await expect(page.getByText(/garanti/i)).toHaveCount(0)

  // Statut passé à Estimé
  await expect(page.getByText('Estimé', { exact: true })).toBeVisible()
})

test('EX-C4 — nouvelle estimation = nouvelle ligne, historique conservé', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await scanAndSaveItem(page)

  await page.getByRole('button', { name: /Estimer la vente/ }).click()
  await expect(page.getByText('Prix conseillé')).toBeVisible({ timeout: 45_000 })

  // Re-demande possible : le bouton devient "nouvelle estimation".
  // Une panne IA transitoire (503) ne doit pas casser le parcours : 1 retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole('button', { name: /nouvelle estimation/ }).click()
    const history = page.getByText('Historique des estimations')
    const failed = page.getByRole('alert')
    await Promise.race([
      history.waitFor({ state: 'visible', timeout: 60_000 }),
      failed.waitFor({ state: 'visible', timeout: 60_000 }),
    ])
    if (await history.isVisible()) break
  }
  await expect(page.getByText('Historique des estimations')).toBeVisible()
  // 2 lignes minimum dans l'historique (l'ancienne est conservée)
  const rows = page.locator('section:has-text("Historique") li')
  await expect(rows).toHaveCount(2, { timeout: 10_000 })
})

/**
 * EX-J7 — preuve unitaire : cumul annuel des nets + frontière d'alerte 250 €.
 * `node --test tests/` (type stripping natif), miroir de tests/vida.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const mod = (await import(
  new URL('../src/lib/fiscal.ts', import.meta.url).pathname
)) as typeof import('../src/lib/fiscal');
const {
  FISCAL_ALERT_THRESHOLD_CENTS,
  fiscalSummary,
  formatEuros,
} = mod;

const YEAR = 2026;

test('cumule uniquement les ventes de l’année demandée', () => {
  const s = fiscalSummary(
    [
      { net_amount_cents: 10_000, fiscal_year: YEAR },
      { net_amount_cents: 5_000, fiscal_year: YEAR },
      { net_amount_cents: 99_999, fiscal_year: YEAR - 1 },
    ],
    YEAR
  );
  assert.equal(s.netCents, 15_000);
  assert.equal(s.year, YEAR);
  assert.equal(s.alert, false);
});

test('liste vide → 0 net, pas d’alerte (0 si 0)', () => {
  const s = fiscalSummary([], YEAR);
  assert.equal(s.netCents, 0);
  assert.equal(s.alert, false);
});

test('pas d’alerte sous 250 € nets cumulés', () => {
  assert.equal(
    fiscalSummary([{ net_amount_cents: 24_999, fiscal_year: YEAR }], YEAR).alert,
    false
  );
});

test('alerte dès 250 € nets cumulés (>=, frontière exacte)', () => {
  assert.equal(
    fiscalSummary(
      [{ net_amount_cents: FISCAL_ALERT_THRESHOLD_CENTS, fiscal_year: YEAR }],
      YEAR
    ).alert,
    true
  );
  assert.equal(
    fiscalSummary(
      [
        { net_amount_cents: 12_000, fiscal_year: YEAR },
        { net_amount_cents: 13_000, fiscal_year: YEAR },
      ],
      YEAR
    ).alert,
    true
  );
});

test('seuil constant 25 000 cents', () => {
  assert.equal(FISCAL_ALERT_THRESHOLD_CENTS, 25_000);
});

test('formatEuros arrondit et formate en français', () => {
  // toLocaleString('fr-FR') insère une espace insécable (U+00A0/U+202F) — on compare sans séparateurs
  const compact = (s: string) => s.replace(/[\s  ]/g, '');
  assert.equal(compact(formatEuros(0)), '0€');
  assert.equal(compact(formatEuros(25_000)), '250€');
  assert.equal(compact(formatEuros(123_450)), '1235€'); // Math.round(1234.5) = 1235
});

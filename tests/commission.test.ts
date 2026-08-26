import assert from 'node:assert/strict';
import test from 'node:test';

// node --test 'tests/*.test.ts' (type stripping natif), miroir de tests/referral
const mod = (await import(
  new URL('../src/lib/commission.ts', import.meta.url).pathname
)) as typeof import('../src/lib/commission');
const { computeCommission } = mod;

test('EX-C2 — net serveur = prix × 90 % (commission 10 %)', () => {
  const r = computeCommission(10000); // 100 €
  assert.equal(r.grossCents, 10000);
  assert.equal(r.commissionPct, 10);
  assert.equal(r.netCents, 9000);
  assert.equal(r.commissionCents, 1000);
});

test('EX-E2 — arrondi au centime inférieur, jamais de centime fantôme', () => {
  const r = computeCommission(999); // 9,99 € → net 8,991 → 899
  assert.equal(r.netCents, 899);
  assert.equal(r.commissionCents, 100);
});

test('invariant : net + commission = brut, sur montants impairs', () => {
  for (const cents of [1, 7, 133, 12345, 999999]) {
    const r = computeCommission(cents);
    assert.equal(r.netCents + r.commissionCents, cents);
    assert.equal(r.commissionCents, cents - Math.floor((cents * 90) / 100));
  }
});

test('gardes : négatif, NaN, infini → erreur explicite', () => {
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => computeCommission(bad), /Montant invalide/);
  }
  assert.equal(computeCommission(0).netCents, 0);
});

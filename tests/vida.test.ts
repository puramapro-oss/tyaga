/**
 * EX-H1/H2/H4 — preuve unitaire : points, transferts 0/30/50/100, progression.
 * `node --test tests/` (type stripping natif), miroir de tests/order-transitions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const mod = (await import(
  new URL('../src/lib/vida.ts', import.meta.url).pathname
)) as typeof import('../src/lib/vida');

test('EX-H1 — pointsFromNet : 1 pt = 1 € net, floor toujours', () => {
  assert.equal(mod.pointsFromNet(0), 0);
  assert.equal(mod.pointsFromNet(9_900), 99);
  assert.equal(mod.pointsFromNet(10_050), 100); // 100,50 € → 100 pts
  assert.equal(mod.pointsFromNet(-5), 0); // entrée invalide → 0
  assert.equal(mod.pointsFromNet(Number.NaN), 0);
});

test('EX-H2 — transferts : exactement 0/30/50/100, floor du montant versé', () => {
  assert.deepEqual([...mod.TRANSFER_PCTS], [0, 30, 50, 100]);
  assert.equal(mod.transferPoints(10_000, 0), 0);
  assert.equal(mod.transferPoints(10_000, 30), 30); // 100 pts → 30
  assert.equal(mod.transferPoints(10_000, 50), 50);
  assert.equal(mod.transferPoints(10_000, 100), 100);
  // 99 pts : 30 % = 29,7 → 29 (floor), jamais 30 au-dessus du wallet
  assert.equal(mod.transferPoints(9_900, 30), 29);
  assert.equal(mod.transferPoints(9_900, 100), 99);
});

test('isTransferPct refuse toute autre valeur', () => {
  for (const ok of [0, 30, 50, 100]) assert.ok(mod.isTransferPct(ok));
  for (const ko of [10, 25, -1, 101, '50', null, undefined]) {
    assert.ok(!mod.isTransferPct(ko), `${String(ko)} ne doit pas passer`);
  }
});

test('EX-H4 — progression : pct plafonné, reste, seuil atteint', () => {
  assert.deepEqual(mod.progression(0, 100), { pct: 0, remainingPoints: 100, complete: false });
  assert.deepEqual(mod.progression(30, 100), { pct: 30, remainingPoints: 70, complete: false });
  assert.deepEqual(mod.progression(100, 100), { pct: 100, remainingPoints: 0, complete: true });
  // dépassement : barre plafonnée à 100, reste 0
  assert.deepEqual(mod.progression(140, 100), { pct: 100, remainingPoints: 0, complete: true });
  // tiers arrondi propre
  const t = mod.progression(1, 3);
  assert.equal(t.pct, 33);
  assert.equal(t.remainingPoints, 2);
  // défense entrées nulles/négatives
  assert.deepEqual(mod.progression(-10, 100).pct, 0);
  assert.equal(mod.progression(5, 0).pct, 100); // cible invalide traitée comme 1
});

test('libellés objectifs : miroir du CHECK base, fallback « Autre »', () => {
  assert.equal(mod.objectifTypeLabel('vida_subscription'), 'Abonnement Vida');
  assert.equal(mod.objectifTypeLabel('soin'), 'Soin / santé');
  assert.equal(mod.objectifTypeLabel('investissement'), 'Épargne / investissement');
  assert.equal(mod.objectifTypeLabel('pas-un-type'), 'Autre objectif');
});

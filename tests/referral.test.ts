import assert from 'node:assert/strict';
import test from 'node:test';

// node --test 'tests/*.test.ts' (type stripping natif), miroir de tests/vida
const mod = (await import(
  new URL('../src/lib/referral.ts', import.meta.url).pathname
)) as typeof import('../src/lib/referral');
const { n1PointsFromCommission, normalizeCode, referralLink, REFERRAL_CODE_PATTERN } = mod;

test('N1 = 50 % de la commission, arrondi au point', () => {
  assert.equal(n1PointsFromCommission(2000), 10); // 20 € → 10 pts
  assert.equal(n1PointsFromCommission(3333), 17); // 33,33 € → 16,67 → 17
  assert.equal(n1PointsFromCommission(100), 1); // 1 € → 0,5 → 1 (banque arrondi)
  assert.equal(n1PointsFromCommission(99), 0); // 0,495 → 0
});

test('N1 gardes : négatif, nul, non fini → 0', () => {
  assert.equal(n1PointsFromCommission(0), 0);
  assert.equal(n1PointsFromCommission(-5000), 0);
  assert.equal(n1PointsFromCommission(Number.NaN), 0);
  assert.equal(n1PointsFromCommission(Number.POSITIVE_INFINITY), 0);
});

test('normalizeCode : trim + majuscules', () => {
  assert.equal(normalizeCode('  ty-ab12cd '), 'TY-AB12CD');
  assert.equal(normalizeCode('ty-ab12cd'), 'TY-AB12CD');
});

test('referralLink : origin + code encodé', () => {
  assert.equal(
    referralLink('TY-AB12CD', 'https://tyaga.purama.dev'),
    'https://tyaga.purama.dev/signup?ref=TY-AB12CD'
  );
});

test('pattern code : TY- + 6 hexa majuscules', () => {
  assert.ok(REFERRAL_CODE_PATTERN.test('TY-AB12CD'));
  assert.ok(!REFERRAL_CODE_PATTERN.test('ty-ab12cd'));
  assert.ok(!REFERRAL_CODE_PATTERN.test('TY-AB12C'));
  assert.ok(!REFERRAL_CODE_PATTERN.test('TY-AB12CG'));
});

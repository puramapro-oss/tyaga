import assert from 'node:assert/strict';
import test from 'node:test';

const { internalRedirectPath } = (await import(
  new URL('../src/lib/auth-redirect.ts', import.meta.url).pathname
)) as typeof import('../src/lib/auth-redirect');

const origin = 'https://tyaga.purama.dev';

for (const input of [
  null, '', 'dashboard', ' /dashboard', '//outside.example/path',
  '///outside.example/path', 'https://outside.example/path',
  'https://tyaga.purama.dev/dashboard', 'javascript:alert(1)',
  '/\\outside.example/path', '/\t/outside.example/path',
  '/\n/outside.example/path', '/\r/outside.example/path',
  '/a/..//outside.example/path', '/a/%2e%2e//outside.example/path',
  '/a/../\\outside.example/path', '/safe\u0000/path', '/safe\u007f/path',
]) {
  test(`refuse une destination ambiguë ou externe : ${JSON.stringify(input)}`, () => {
    assert.equal(internalRedirectPath(input), '/dashboard');
  });
}

for (const input of [
  '/', '/dashboard', '/commandes', '/objets/123?vue=liste#details',
  '/objets/../dashboard', '/mes objets?q=café#été',
  '/dashboard?return=https%3A%2F%2Foutside.example%2F',
  '/objets/123?key=a%2Fb%2Bc', '/@outside.example/path',
]) {
  test(`préserve la destination interne : ${input}`, () => {
    const expected = new URL(input, origin);
    const output = internalRedirectPath(input);
    assert.equal(output, `${expected.pathname}${expected.search}${expected.hash}`);
    assert.equal(new URL(output, origin).origin, origin);
  });
}

test('aucun caractère de contrôle brut ne peut ouvrir une nouvelle origine', () => {
  for (const code of [...Array.from({ length: 32 }, (_, index) => index), 127]) {
    const output = internalRedirectPath(`/${String.fromCharCode(code)}/outside.example/path`);
    assert.equal(output, '/dashboard');
    assert.equal(new URL(output, origin).origin, origin);
  }
});

test('la destination retournée reste interne après normalisation et reparsage', () => {
  const prefixes = ['/', '/a/../', '/a/%2e%2e/', '/a/./../', '/%2f', '/%5c'];
  const suffixes = ['/outside.example', '\\outside.example', '%2foutside.example', '?next=//outside.example'];
  for (const prefix of prefixes) {
    for (const suffix of suffixes) {
      const output = internalRedirectPath(prefix + suffix);
      assert.equal(new URL(output, origin).origin, origin, JSON.stringify({ prefix, suffix, output }));
      assert.equal(output.startsWith('//'), false);
    }
  }
});

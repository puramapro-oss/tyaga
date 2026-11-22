import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test, { after } from 'node:test';
import vm from 'node:vm';

import { internalRedirectPath } from '../src/lib/auth-redirect.ts';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const ts = require('typescript');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://tyaga.example.test/callback',
});
const previous = new Map();
for (const [name, value] of Object.entries({
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
})) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
after(() => {
  dom.window.close();
  for (const [name, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

const React = require('react');
const { createRoot } = require('react-dom/client');
const file = new URL('../src/app/(auth)/callback/page.tsx', import.meta.url);
const compiled = ts.transpileModule(await readFile(file, 'utf8'), {
  fileName: file.pathname,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
  },
  reportDiagnostics: true,
});
assert.deepEqual(compiled.diagnostics, [], 'the real callback component transpiles');

function successfulReply() {
  const user = { id: 'member-one' };
  return { error: null, data: { user, session: { user, access_token: 'test-token' } } };
}

// React, ReactDOM, the component and the destination helper are real. Only
// Next navigation and the authentication provider boundary are replaced.
async function mount(t, options = {}) {
  const calls = { clients: 0, exchanges: [], destinations: [], refreshes: 0 };
  const search = new URLSearchParams(options.query ?? 'code=test-code&next=%2Fcommandes');
  const bindings = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/navigation': {
      useRouter: () => router,
      useSearchParams: () => search,
    },
    '@/lib/auth-redirect': { internalRedirectPath },
    '@/lib/supabase': { createClient() {
      calls.clients++;
      if (options.clientThrows) throw new Error('client unavailable');
      return { auth: { async exchangeCodeForSession(code) {
        calls.exchanges.push(code);
        if (options.exchangeThrows) throw new Error('transport unavailable');
        if (options.exchange) return options.exchange(code);
        return options.reply === undefined ? successfulReply() : options.reply;
      } } };
    } },
  };
  const router = {
    push(path) { calls.destinations.push(path); },
    refresh() { calls.refreshes++; },
  };
  const context = vm.createContext({ URL, console,
    fetch: () => { throw new Error('Unexpected authentication network request'); },
  });
  const component = new vm.SourceTextModule(compiled.outputText, { context, identifier: file.pathname });
  await component.link(name => {
    const values = bindings[name];
    assert.ok(values, `Unexpected product dependency: ${name}`);
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await component.evaluate();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let mounted = true;
  async function unmount() {
    if (!mounted) return;
    mounted = false;
    await React.act(async () => root.unmount());
    host.remove();
  }
  t.after(unmount);
  await React.act(async () => {
    const page = React.createElement(component.namespace.default);
    root.render(options.strict ? React.createElement(React.StrictMode, null, page) : page);
  });
  return { calls, host, unmount };
}

function assertFailure(app) {
  assert.deepEqual(app.calls.destinations, []);
  assert.equal(app.calls.refreshes, 0);
  assert.match(app.host.textContent, /Connexion impossible/);
  assert.doesNotMatch(app.host.textContent, /Connexion en cours/);
}

test('real callback redirects only after a successful session and preserves the OAuth code', async t => {
  const app = await mount(t, { query: 'code=a%2Bb%2Fc%3D&next=%2Fcommandes%3Fvue%3Dachat%23recues' });
  assert.deepEqual(app.calls.exchanges, ['a+b/c=']);
  assert.deepEqual(app.calls.destinations, ['/commandes?vue=achat#recues']);
  assert.equal(app.calls.refreshes, 1);
});

test('real callback uses the existing internal destination guard', async t => {
  const app = await mount(t, { query: 'code=test-code&next=%2F%5Coutside.example' });
  assert.deepEqual(app.calls.destinations, ['/dashboard']);
});

test('missing code stops before creating an authentication client', async t => {
  const app = await mount(t, { query: 'next=%2Fcommandes' });
  assert.equal(app.calls.clients, 0);
  assert.deepEqual(app.calls.destinations, []);
  assert.match(app.host.textContent, /Lien de connexion incomplet/);
});

test('StrictMode consumes the callback code once and completes the navigation', async t => {
  const app = await mount(t, { strict: true });
  assert.deepEqual(app.calls.exchanges, ['test-code']);
  assert.deepEqual(app.calls.destinations, ['/commandes']);
  assert.equal(app.calls.refreshes, 1);
});

for (const [name, options] of [
  ['a rejected exchange promise', { exchangeThrows: true }],
  ['a synchronous client failure', { clientThrows: true }],
  ['a provider rejection', { reply: { error: { message: 'expired code' }, data: { user: null, session: null } } }],
  ['an absent session and user', { reply: { error: null, data: { user: null, session: null } } }],
  ['an absent session', { reply: { error: null, data: { user: { id: 'member-one' }, session: null } } }],
  ['an absent user', { reply: { error: null, data: { user: null, session: { access_token: 'test-token' } } } }],
]) test(`${name} shows an error and never navigates`, async t => {
  assertFailure(await mount(t, options));
});

test('an exchange completing after leaving the callback cannot navigate the new page', async t => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const app = await mount(t, { exchange: () => pending });
  assert.deepEqual(app.calls.destinations, []);
  await app.unmount();
  await React.act(async () => resolve(successfulReply()));
  assert.deepEqual(app.calls.destinations, []);
  assert.equal(app.calls.refreshes, 0);
});

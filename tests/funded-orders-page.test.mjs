import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import * as display from '../src/lib/funded-order-display.ts';
import * as payment from '../src/lib/order-payment-label.ts';
import * as policies from '../src/lib/physical-fee-policy.ts';
import * as utils from '../src/lib/utils.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const source = await readFile(new URL('../src/app/(dashboard)/commandes/page.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const base = { id: 'order-a', buyer_id: 'buyer', seller_id: 'seller', status: 'pending', escrow_status: 'pending',
  stripe_transfer_id: null, amount_cents: 11999, net_amount_cents: 11616, commission_amount_cents: 0,
  fee_policy: 'fr_p2p_test_v3', item_amount_cents: 11616, buyer_fee_cents: 383, funding_route: 'pay_test',
  shipping_address: { fullName: 'Adresse privée' }, created_at: '2026-11-28T05:00:00Z', annonces: { id: 'a', title: 'Lampe' } };
const status = { order_id: base.id, pay_status: 'captured', seller_status: 'unconfirmed',
  reconciliation_status: 'awaiting_settlement', funded_cents: 10000, buyer_due_cents: 1999 };

async function render(user, view, { order = base, missingColumn = false } = {}) {
  const calls = [];
  const client = {
    auth: { async getUser() { return { data: { user: user ? { id: user } : null } }; } },
    from(table) {
      assert.equal(table, 'marketplace_orders');
      return { select(columns) { return { order() { return { async limit() {
        if (missingColumn && columns.includes('funding_route')) return { error: { code: '42703', message: 'funding_route column does not exist' } };
        return { data: [order] };
      } }; } }; } };
    },
    async rpc(name, { p_orders }) {
      calls.push([name, Array.from(p_orders)]);
      if (name === 'my_sale_promotions') return { data: [] };
      assert.equal(name, 'my_test_funded_orders');
      return view ? { data: [view] } : { data: null, error: { code: 'PGRST202' } };
    },
  };
  const bindings = {
    'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': { Package: () => null },
    'next/link': { default: ({ href, children }) => React.createElement('a', { href }, children) },
    '@/components/marketplace/CommandeActions': { default: () => React.createElement('button', null, 'Action historique') },
    '@/components/marketplace/PackingChecklist': { default: () => React.createElement('div', null, 'Préparer le colis') },
    '@/lib/physical-fee-policy': policies, '@/lib/order-payment-label': payment, '@/lib/funded-order-display': display,
    '@/lib/utils': utils, '@/lib/supabase-server': { createServerSupabaseClient: async () => client },
  };
  const output = {};
  vm.runInNewContext(compiled, { exports: output, require(name) {
    assert.ok(bindings[name], 'Unexpected import ' + name); return bindings[name];
  } });
  const element = await output.default({ searchParams: Promise.resolve({}) });
  const html = renderToStaticMarkup(element);
  return { html: html.replaceAll('\u00a0',' ').replaceAll('\u202f',' '), calls };
}

test('acheteur et vendeur voient leur financement et le complément en attente sans action logistique', async () => {
  for (const user of ['buyer','seller']) {
    const { html, calls } = await render(user,status);
    assert.match(html,user === 'buyer' ? /Achat/ : /Vente/);
    assert.match(html,/Traitement logistique en attente/);
    assert.match(html,/Financement utilisé · 100,00 €/);
    assert.match(html,/Complément acheteur à régler · 19,99 €/);
    assert.match(html,/Règlement du vendeur en attente/);
    assert.doesNotMatch(html,/Action historique|Préparer le colis|Adresse privée|Règlement du vendeur confirmé/);
    assert.deepEqual(calls.at(-1),['my_test_funded_orders',['order-a']]);
  }
});

test('réservation, libération, confirmation, remboursements et revue ont chacun leur libellé', async () => {
  const cases = [
    ['awaiting_funding','unconfirmed','awaiting_funding',/En attente d’une affectation/],
    ['reserved','unconfirmed','awaiting_settlement',/Financement réservé · 119,99 €/],
    ['released','unconfirmed','released',/Réservation libérée · 119,99 €/],
    ['captured','confirmed','seller_confirmed',/Règlement du vendeur confirmé/],
    ['captured','reversed','awaiting_buyer_return',/Restitution à l’acheteur en attente/],
    ['refunded','confirmed','review',/Contrôle en cours du retour vendeur/],
    ['refunded','reversed','returned',/Retour du règlement vendeur confirmé/],
  ];
  for (const [pay_status,seller_status,reconciliation_status,expected] of cases) {
    for (const user of ['buyer','seller']) {
      const { html } = await render(user,{...status,pay_status,seller_status,reconciliation_status,
        funded_cents:pay_status==='awaiting_funding'?null:11999,buyer_due_cents:null});
      assert.match(html,expected);
      if(pay_status==='refunded') assert.match(html,/Financement restitué à l’acheteur · 119,99 €/);
      assert.doesNotMatch(html,/Complément acheteur à régler|Préparer le colis|Adresse privée/);
    }
  }
});

test('visiteur et tiers ne reçoivent ni commande ni état même si un adaptateur renvoie la ligne', async () => {
  for (const user of [null,'other']) {
    const { html, calls } = await render(user,status);
    assert.match(html,/Aucune commande/);
    assert.doesNotMatch(html,/Lampe|Financement utilisé/);
    assert.deepEqual(calls,[]);
  }
});

test('port absent et Stripe historique conservent des résultats distincts', async () => {
  const { html } = await render('buyer',null);
  assert.match(html,/Suivi du financement indisponible/);
  assert.doesNotMatch(html,/Fonds sous séquestre|Financement utilisé|Règlement du vendeur confirmé/);
  for (const missingColumn of [false,true]) {
    const stripe = await render('seller',null,{order:{...base,funding_route:missingColumn?undefined:'stripe',status:'paid',escrow_status:'held'},missingColumn});
    assert.match(stripe.html,/Fonds sous séquestre/);
    assert.match(stripe.html,/Préparer le colis/);
    assert.match(stripe.html,/Action historique/);
    assert.doesNotMatch(stripe.html,/Financement de cette commande/);
    assert.ok(!stripe.calls.some(([n]) => n==='my_test_funded_orders'));
  }
});

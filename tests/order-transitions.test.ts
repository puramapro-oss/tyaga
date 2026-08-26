/**
 * EX-E3 — preuve unitaire : matrice de transitions = miroir de la RLS
 * orders_update. Lancé par `node --test tests/` (type stripping natif).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { OrderActor, OrderStatus } from '../src/lib/order-transitions';

// Import dynamique (chemin calculé) : node strip-types charge le .ts réel.
const mod = (await import(
  new URL('../src/lib/order-transitions.ts', import.meta.url).pathname
)) as {
  canTransition: (actor: OrderActor, from: OrderStatus, to: OrderStatus) => boolean;
  assertTransition: (actor: OrderActor, from: OrderStatus, to: OrderStatus) => void;
  USER_ACTIONS: Record<string, { actor: OrderActor; to: OrderStatus }>;
  TransitionError: new (...args: never[]) => Error;
};
const { canTransition, assertTransition, USER_ACTIONS, TransitionError } = mod;

test('buyer : pending→cancelled et shipped→delivered uniquement', () => {
  assert.ok(canTransition('buyer', 'pending', 'cancelled'));
  assert.ok(canTransition('buyer', 'shipped', 'delivered'));
  assert.ok(!canTransition('buyer', 'pending', 'paid')); // jamais le paiement
  assert.ok(!canTransition('buyer', 'paid', 'shipped')); // rôle vendeur
  assert.ok(!canTransition('buyer', 'paid', 'delivered')); // saute l'expédition
  assert.ok(!canTransition('buyer', 'delivered', 'completed')); // système seul
  assert.ok(!canTransition('buyer', 'completed', 'cancelled'));
});

test('seller : paid→shipped et pending→cancelled (retrait de vente)', () => {
  assert.ok(canTransition('seller', 'paid', 'shipped'));
  assert.ok(canTransition('seller', 'pending', 'cancelled')); // retrait avant paiement
  assert.ok(!canTransition('seller', 'shipped', 'delivered')); // réception = acheteur
  assert.ok(!canTransition('seller', 'paid', 'completed'));
  assert.ok(!canTransition('seller', 'paid', 'cancelled')); // payé : remboursement = système
});

test('system : paiement, clôture, remboursement', () => {
  assert.ok(canTransition('system', 'pending', 'paid'));
  assert.ok(canTransition('system', 'delivered', 'completed'));
  assert.ok(canTransition('system', 'paid', 'cancelled'));
  assert.ok(canTransition('system', 'shipped', 'cancelled'));
  assert.ok(canTransition('system', 'completed', 'cancelled'));
  assert.ok(!canTransition('system', 'pending', 'shipped')); // pas de saut d'état
});

test('USER_ACTIONS mappent les 4 actions utilisateur', () => {
  assert.deepEqual(USER_ACTIONS.cancel, { actor: 'buyer', to: 'cancelled' });
  assert.deepEqual(USER_ACTIONS.seller_cancel, { actor: 'seller', to: 'cancelled' });
  assert.deepEqual(USER_ACTIONS.ship, { actor: 'seller', to: 'shipped' });
  assert.deepEqual(USER_ACTIONS.deliver, { actor: 'buyer', to: 'delivered' });
});

test('assertTransition lève TransitionError sur transition interdite', () => {
  assert.ok(assertTransition('seller', 'paid', 'shipped') === undefined);
  assert.throws(
    () => assertTransition('buyer', 'paid', 'shipped'),
    TransitionError
  );
});

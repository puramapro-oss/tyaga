import assert from 'node:assert/strict';
import test from 'node:test';
import type Stripe from 'stripe';
import { digitalSamplePurpose, verifyDigitalTestPayment } from '../src/lib/digital-payment-proof';

const order = { id: 'order-1', acheteur: 'buyer', vendeur: 'seller', montant: 800, destination: 'acct_testSeller' };
const metadata = { purpose: digitalSamplePurpose, app_slug: 'tyaga', digital_order_id: order.id, buyer_id: order.acheteur, seller_id: order.vendeur };
const charge = { livemode: false, paid: true, amount: 800, currency: 'eur', payment_intent: 'pi_test', refunded: false, disputed: false, amount_refunded: 0 };
const intent = { id: 'pi_test', livemode: false, status: 'succeeded', currency: 'eur', amount: 800, amount_received: 800, metadata,
  transfer_data: { destination: order.destination }, latest_charge: charge };
const session = { id: 'cs_test', livemode: false, mode: 'payment', client_reference_id: order.id, metadata, currency: 'eur', amount_total: 800,
  status: 'complete', payment_status: 'paid', payment_intent: intent };
const verify = (value: unknown) => verifyDigitalTestPayment(value as Stripe.Checkout.Session, order);

test('Le reçu Stripe de recette vérifie la destination, le bénéficiaire, la devise, le montant et la charge', () => {
  assert.deepEqual(verify(session), { status: 'paid', intent: 'pi_test' });
  for (const change of [{ livemode: true }, { mode: 'setup' }, { amount_total: 801 }, { currency: 'usd' },
    { client_reference_id: 'other' }, { metadata: { ...metadata, buyer_id:'other' } }, { metadata: { ...metadata, seller_id:'other' } }]) {
    assert.throws(() => verify({ ...session, ...change }));
  }
  for (const change of [{ status: 'processing' }, { amount_received: 700 }, { amount: 900 }, { currency: 'usd' }, { livemode: true },
    { transfer_data: { destination: 'acct_other' } }, { metadata: { ...metadata, purpose: 'physical' } }, { latest_charge: 'ch_missing' }]) {
    assert.throws(() => verify({ ...session, payment_intent: { ...intent, ...change } }));
  }
  for (const change of [{ livemode: true }, { paid: false }, { payment_intent: 'pi_other' }, { currency: 'usd' }, { amount: 799 }]) {
    assert.throws(() => verify({ ...session, payment_intent: { ...intent, latest_charge: { ...charge, ...change } } }));
  }
});

test('Un remboursement ou un litige révoque une licence, un abandon et une attente ne délivrent rien', () => {
  for (const change of [{ refunded: true }, { amount_refunded: 1 }, { disputed: true }]) {
    assert.deepEqual(verify({ ...session, payment_intent: { ...intent, latest_charge: { ...charge, ...change } } }),
      { status: 'revoked', intent: 'pi_test' });
  }
  assert.deepEqual(verify({ ...session, status:'expired', payment_status:'unpaid' }), { status:'expired', intent:null });
  assert.deepEqual(verify({ ...session, status:'open', payment_status:'unpaid' }), { status:'open', intent:null });
  assert.deepEqual(verify({ ...session, payment_status:'unpaid' }), { status:'open', intent:null });
});

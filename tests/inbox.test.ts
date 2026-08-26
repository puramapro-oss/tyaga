import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * EX-F — tests unitaires de la logique messagerie :
 * F4 détection hors plateforme (positifs + négatifs), F3 invariant plancher,
 * F2 suggestions par rôle/état. Pur : aucune DB ni réseau.
 */

type InboxModule = typeof import('../src/lib/inbox.ts');

async function loadInbox(): Promise<InboxModule> {
  // node --test + type-stripping : import dynamique du .ts
  return import(new URL('../src/lib/inbox.ts', import.meta.url).pathname);
}

test('EX-F4 : détecte IBAN', async () => {
  const { detectOffPlatform } = await loadInbox();
  const hit = detectOffPlatform('Envoie sur mon compte : FR7630006000011234567890189');
  assert.ok(hit);
  assert.equal(hit.label, 'IBAN');
});

test('EX-F4 : détecte PayPal', async () => {
  const { detectOffPlatform } = await loadInbox();
  const hit = detectOffPlatform('On peut régler via paypal si tu veux');
  assert.ok(hit);
  assert.equal(hit.label, 'PayPal');
});

test('EX-F4 : détecte WhatsApp, Telegram, Revolut, Lydia', async () => {
  const { detectOffPlatform } = await loadInbox();
  assert.equal(detectOffPlatform('Écris-moi sur whatsapp !')?.label, 'WhatsApp');
  assert.equal(detectOffPlatform('Mon pseudo telegram : @x')?.label, 'Telegram');
  assert.equal(detectOffPlatform('Passe par revolut')?.label, 'Revolut');
  assert.equal(detectOffPlatform('Je te fais un Lydia')?.label, 'Lydia');
});

test('EX-F4 : détecte téléphone FR (+33 et 0X)', async () => {
  const { detectOffPlatform } = await loadInbox();
  assert.equal(detectOffPlatform('Appelle-moi : +33 6 12 34 56 78')?.label, 'téléphone');
  assert.equal(detectOffPlatform('06 98 76 54 32 pour convenir')?.label, 'téléphone');
});

test('EX-F4 : détecte email de contact', async () => {
  const { detectOffPlatform } = await loadInbox();
  assert.equal(detectOffPlatform('Écris-moi à toto.dupont@mail-example.com')?.label, 'email');
});

test('EX-F4 : détecte RIB français', async () => {
  const { detectOffPlatform } = await loadInbox();
  const hit = detectOffPlatform('RIB : 12345 67890 12345678901 23');
  assert.ok(hit);
  assert.equal(hit.label, 'RIB');
});

test('EX-F4 : laisse passer un message normal', async () => {
  const { detectOffPlatform } = await loadInbox();
  assert.equal(detectOffPlatform('Bonjour ! L’objet est-il toujours disponible ?'), null);
  assert.equal(detectOffPlatform('Je te propose 40 €, ça te va ?'), null);
  // Forme compacte 0X non séparée : assumé non détecté (trop de faux positifs
  // sur identifiants/montants) — les formes séparées et +33/00 33 le sont.
  assert.equal(detectOffPlatform('Commande 0612345678 à retrouver'), null);
  assert.equal(detectOffPlatform('Parfait, j’achète via le bouton Acheter !'), null);
});

test('EX-F2 : acheteur = 3 suggestions sans montant (plancher inconnu)', async () => {
  const { buildSuggestions } = await loadInbox();
  const out = buildSuggestions({ role: 'buyer', priceCents: 5000, floorCents: 4000, lastOfferCents: null });
  assert.equal(out.length, 3);
  for (const s of out) {
    assert.equal(s.price_counter_cents, null);
  }
});

test('EX-F3 : offre sous plancher → refus poli proposé, jamais de contre < plancher', async () => {
  const { buildSuggestions } = await loadInbox();
  const out = buildSuggestions({ role: 'seller', priceCents: 8000, floorCents: 6000, lastOfferCents: 5000 });
  const decline = out.find((s) => s.suggestion_type === 'decline');
  assert.ok(decline, 'refus proposé');
  assert.match(decline.body, /6 ?000|60/);
  for (const s of out) {
    if (s.price_counter_cents !== null) {
      assert.ok(s.price_counter_cents >= 6000, 'invariant F3 : contre ≥ plancher');
    }
  }
});

test('EX-F3 : contre-offre au plancher exact quand offre < plancher', async () => {
  const { buildSuggestions } = await loadInbox();
  const out = buildSuggestions({ role: 'seller', priceCents: 8000, floorCents: 6000, lastOfferCents: 5000 });
  const negotiate = out.find((s) => s.suggestion_type === 'negotiate');
  assert.ok(negotiate);
  assert.equal(negotiate.price_counter_cents, 6000);
});

test('EX-F3 : offre ≥ plancher → acceptation proposée au montant offert', async () => {
  const { buildSuggestions } = await loadInbox();
  const out = buildSuggestions({ role: 'seller', priceCents: 8000, floorCents: 4000, lastOfferCents: 6500 });
  const accept = out.find((s) => s.suggestion_type === 'accept');
  assert.ok(accept);
  assert.equal(accept.price_counter_cents, 6500);
});

test('EX-F2 : vendeur sans offre = 2 réponses d’accueil', async () => {
  const { buildSuggestions } = await loadInbox();
  const noFloor = buildSuggestions({ role: 'seller', priceCents: 8000, floorCents: null, lastOfferCents: null });
  assert.equal(noFloor.length, 2);
  assert.ok(noFloor.every((s) => s.suggestion_type === 'answer'));

  // Plancher défini mais aucune offre reçue → accueil aussi
  const withFloor = buildSuggestions({ role: 'seller', priceCents: 8000, floorCents: 6000, lastOfferCents: null });
  assert.equal(withFloor.length, 2);
});

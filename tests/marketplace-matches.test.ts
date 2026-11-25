import assert from 'node:assert/strict';
import test from 'node:test';

import { listingPhotoName } from '../src/components/marketplace/listingPhotos';
import { closestListings } from '../src/components/marketplace/rankListingMatches';

const make = (id: string, title: string, price_cents: number, tags: string[] = []) => ({
  id, title, price_cents, tags,
});

test('Les sujets proches priment, les accents, pluriels et tags sont pris en compte', () => {
  const source = make('demande', 'Je cherche un vélo électrique', 100, ['VTT']);
  const candidates = [
    make('autre', 'Guitare électrique', 45),
    make('partiel', 'Velo de ville', 80),
    make('proche', 'Vélos VTT électriques', 95),
    make('sans', 'Chaise de jardin', 25),
  ];
  assert.deepEqual(closestListings(source, candidates).map(row => row.id), ['proche', 'partiel']);
  assert.deepEqual(closestListings(source, candidates, 1).map(row => row.id), ['proche']);
});

test('Les termes génériques, le prix ou un format commun ne suffisent pas', () => {
  const source = make('demande', 'Licence PDF pour un produit', 20);
  assert.deepEqual(closestListings(source, [make('offre', 'PDF format numérique', 20)]), []);
});

test('Les photos signées correspondent au propriétaire et à l’objet de la fiche', () => {
  assert.equal(listingPhotoName('a/b/face.jpg', 'a', 'b'), true);
  assert.equal(listingPhotoName('a/b/defaut.webp', 'a', 'b'), true);
  assert.equal(listingPhotoName('a/b/face.jpg', 'c', 'b'), false);
  assert.equal(listingPhotoName('a/b/face.jpg', 'a', 'c'), false);
  assert.equal(listingPhotoName('a/b/face.jpg', 'a', null), false);
  assert.equal(listingPhotoName('a/b/autre.pdf', 'a', 'b'), false);
  assert.equal(listingPhotoName('a/b/../face.jpg', 'a', 'b'), false);
});

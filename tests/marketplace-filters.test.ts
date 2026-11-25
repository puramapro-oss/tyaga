import assert from 'node:assert/strict';
import { test } from 'node:test';
const { marketplaceHref, marketplaceLoginReturn, parseMarketplaceFilters } = await import(
  new URL('../src/lib/marketplace-filters.ts', import.meta.url).href
) as typeof import('../src/lib/marketplace-filters');

test('les filtres de catalogue survivent à la connexion et à la pagination', () => {
  const query = new URLSearchParams({ kind: 'digital', mode: 'rental', q: 'son & image', format: 'PDF', page: '2' });
  const destination = marketplaceLoginReturn(query);
  assert.equal(destination, '/marketplace?kind=digital&mode=rental&q=son+%26+image&format=PDF&page=2');
  const filters = parseMarketplaceFilters(Object.fromEntries(query));
  assert.equal(marketplaceHref(filters, 1), '/marketplace?kind=digital&mode=rental&q=son+%26+image&format=PDF');
});

test('une ancienne URL sans filtre revient au catalogue simple', () => {
  assert.equal(marketplaceLoginReturn(new URLSearchParams()), '/marketplace');
});

test('les champs inconnus, ambigus et hors limites restent en dehors du retour', () => {
  const query = new URLSearchParams('kind=physical&kind=digital&intent=offer&mode=nope&page=150000&tracking=campaign&next=/dashboard');
  assert.equal(marketplaceLoginReturn(query), '/marketplace?intent=offer');
});

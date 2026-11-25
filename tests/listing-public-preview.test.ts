import assert from 'node:assert/strict';
import { test } from 'node:test';
const { listingPreviewSummary, renderListingPreview } = await import(
  new URL('../src/lib/listing-preview.ts', import.meta.url).href
) as typeof import('../src/lib/listing-preview');

test('une recherche publique n’expose que son titre relu, son type et son budget', () => {
  const listing = { title: 'Bande originale', priceCents: 1500, kind: 'digital', mode: 'rental', intent: 'wanted' } as const;
  assert.match(listingPreviewSummary(listing), /Recherche · Création numérique · Location ou licence temporaire · Budget 15,00/);
  const html = renderListingPreview({...listing, title: 'Mon « projet » & sa musique'}, '8718a46c-ca04-43d6-9b08-c17969aea46d');
  assert.ok(html.includes('<meta name="robots" content="noindex,nofollow,noarchive">'));
  assert.ok(html.includes('<meta property="og:title" content="Mon « projet » &amp; sa musique">'));
  assert.ok(html.includes('<h1>Mon « projet » &amp; sa musique</h1>'));
  assert.ok(html.includes('href="/marketplace/8718a46c-ca04-43d6-9b08-c17969aea46d"'));
});

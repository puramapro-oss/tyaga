// node --test tests/member-marketplace.sql.mjs
// PGlite is already a development dependency of the settlement tests.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const prelude = `
  CREATE SCHEMA auth;
  CREATE SCHEMA storage;
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE ROLE service_role BYPASSRLS;
  CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}');
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean);
  CREATE TABLE storage.objects(bucket_id text, name text);
  CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT string_to_array($1, '/') $$;
  GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;`;

test('TYAGA installe son schéma complet et ses extensions sur une base vierge', async suite => {
  const db = await PGlite.create();
  try {
    await db.exec(prelude);
    await db.exec(await read('schema.sql'));
    await db.exec(await read('sql/20261122-order-settlement.sql'));
    await db.exec(await read('sql/20261122-order-refund.sql'));
    const extensions = ['digital-listings', 'digital-licenses', 'digital-checkout-test', 'listing-promotions', 'sale-promotion-rewards', 'public-listing-previews', 'physical-sale-fee-v2', 'licensed-files', 'promotion-points-pilot', 'published-listing-benefits'];
    for (let pass = 0; pass < 2; pass++) {
      for (const name of extensions) await db.exec(await read('sql/' + name + '.sql'));
    }
    for (const name of ['member-listings', 'public-listing-previews', 'digital-license', 'digital-checkout-test', 'licensed-files', 'sale-promotion-rewards', 'physical-sale-fee-v2', 'promotion-points-pilot', 'published-listing-benefits']) {
      await suite.test(name, async () => {
        await db.exec(await read('tests/' + name + '.integration.sql'));
      });
    }
  } finally {
    await db.close();
  }
});

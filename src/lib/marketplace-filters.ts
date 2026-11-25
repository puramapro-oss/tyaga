type Query = Record<string, string | string[] | undefined>;

export function parseMarketplaceFilters(params: Query) {
  const kind = params.kind === 'digital' || params.kind === 'physical' ? params.kind : '';
  const intent = params.intent === 'wanted' || params.intent === 'offer' ? params.intent : '';
  const mode = params.mode === 'rental' || params.mode === 'sale' ? params.mode : '';
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 70) : '';
  const format = typeof params.format === 'string' ? params.format.trim().slice(0, 80) : '';
  const rawPage = typeof params.page === 'string' ? Number(params.page) : 1;
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 100000 ? rawPage : 1;
  return { kind, intent, mode, q, format, page };
}

export function marketplaceHref(filters: ReturnType<typeof parseMarketplaceFilters>, page = filters.page) {
  const params = new URLSearchParams();
  for (const key of ['kind', 'intent', 'mode', 'q', 'format'] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  if (page > 1) params.set('page', String(page));
  return params.size ? '/marketplace?' + params.toString() : '/marketplace';
}

/** Keep only single-valued public catalogue filters when returning from authentication. */
export function marketplaceLoginReturn(search: URLSearchParams) {
  const filters: Query = {};
  for (const name of ['kind', 'intent', 'mode', 'q', 'format', 'page']) {
    const values = search.getAll(name);
    if (values.length === 1) filters[name] = values[0];
  }
  return marketplaceHref(parseMarketplaceFilters(filters));
}

export function readPage(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) ? Math.min(Math.max(page, 1), 10000) : 1;
}

export function updateQuery(current: URLSearchParams, patch: Record<string, string | null>): string {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query ? `?${query}` : '';
}

export function updateListFilters(current: URLSearchParams, patch: Record<string, string | null>): string {
  return updateQuery(current, { ...patch, page: null, cursor: null });
}

export function retainSelection(selected: ReadonlySet<string>, available: ReadonlySet<string>): Set<string> {
  return new Set([...selected].filter(id => available.has(id)));
}

export function removeActedItems(selected: ReadonlySet<string>, succeeded: ReadonlySet<string>): Set<string> {
  return new Set([...selected].filter(id => !succeeded.has(id)));
}

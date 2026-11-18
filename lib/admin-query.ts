/** Server-only query string construction; never interpolate arbitrary text into PostgREST filters. */
export type PassStatus = 'all' | 'unused' | 'reserved' | 'claimed';

export function isPassStatus(value: string): value is PassStatus {
  return value === 'all' || value === 'unused' || value === 'reserved' || value === 'claimed';
}

/** Search supports pass number, key, full name, username, and email. */
export function normalizePassSearch(value: string): string {
  return value.trim().slice(0, 80).replace(/[^a-zA-Z0-9@._ +\-]/g, '').trim();
}

export function passFilter(status: PassStatus, search: string, serverNow: string): string | null {
  const terms: string[] = [];
  if (status === 'claimed') terms.push('status.eq.claimed');
  if (status === 'reserved') terms.push(`and(status.eq.reserved,reserved_until.gt.${serverNow})`);
  if (status === 'unused') terms.push(`or(status.eq.unused,and(status.eq.reserved,reserved_until.lte.${serverNow}))`);
  const query = normalizePassSearch(search);
  if (query) {
    const filters = ['pass_key', 'claimed_full_name', 'claimed_username', 'claimed_email']
      .map(column => `${column}.ilike.*${query}*`);
    if (/^\d{1,15}$/.test(query)) filters.push(`id.eq.${query}`);
    terms.push(`or(${filters.join(',')})`);
  }
  if (!terms.length) return null;
  return terms.length === 1 ? terms[0] : `and(${terms.join(',')})`;
}

/** Protect spreadsheet exports from formula execution (CSV injection). */
export function csvCell(value: unknown): string {
  let output = value == null ? '' : String(value);
  if (/^[\s]*[=+\-@]/.test(output)) output = `'${output}`;
  return `"${output.replace(/"/g, '""')}"`;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',');
}

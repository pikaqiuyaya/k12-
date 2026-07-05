function asFiniteInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Math.max(0, Number(value.trim()));
  return undefined;
}

function extractDirectTotal(record: Record<string, unknown>, pageItemCount: number): number | undefined {
  for (const key of ["total", "total_count", "totalCount", "total_items", "totalItems"]) {
    const value = asFiniteInteger(record[key]);
    if (value !== undefined) return value;
  }
  const count = asFiniteInteger(record.count);
  return count !== undefined && count > pageItemCount ? count : undefined;
}

export function extractSub2ApiListTotal(payload: unknown, pageItemCount = 0): number | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  const direct = extractDirectTotal(record, pageItemCount);
  if (direct !== undefined) return direct;
  for (const key of ["pagination", "pager", "page", "meta"]) {
    const nested = record[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const total = extractDirectTotal(nested as Record<string, unknown>, pageItemCount);
      if (total !== undefined) return total;
    }
  }
  return undefined;
}

export function shouldFetchNextSub2ApiListPage(input: {
  loadedUniqueCount: number;
  total?: number;
  lastPageItemCount: number;
  addedUniqueCount: number;
  page: number;
  maxPages: number;
}): boolean {
  if (input.page >= input.maxPages) return false;
  if (input.lastPageItemCount <= 0) return false;
  if (input.total !== undefined) return input.loadedUniqueCount < input.total;
  return input.addedUniqueCount > 0;
}

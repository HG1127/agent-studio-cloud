export const MAX_PAGE_NUMBER = 10_000;

export function firstSearchParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function pageFromSearchParam(value: string | string[] | undefined): number {
  const parsed = Number(firstSearchParam(value));
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, MAX_PAGE_NUMBER) : 1;
}

import type { Endpoint, HttpMethod } from '../schema/endpoint.js';

const HTTP_METHOD_ORDER: Record<HttpMethod, number> = {
  GET: 1,
  POST: 2,
  PUT: 3,
  PATCH: 4,
  DELETE: 5,
  OPTIONS: 6,
  HEAD: 7,
};

/**
 * Locale-independent string comparison function.
 * Avoids any environment- or system-locale divergence (e.g. localeCompare).
 */
export function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Normalizes a URL path to always have a leading slash and no trailing slash (unless it's just '/').
 */
export function normalizePath(path: string): string {
  let cleaned = path.trim();
  if (!cleaned.startsWith('/')) {
    cleaned = '/' + cleaned;
  }
  if (cleaned.length > 1 && cleaned.endsWith('/')) {
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned;
}

/**
 * Generates a stable and unique endpoint identifier in the format "METHOD /path".
 *
 * @example
 * generateEndpointId('GET', '/users/:id') // => "GET /users/:id"
 * generateEndpointId('post', 'users')     // => "POST /users"
 */
export function generateEndpointId(method: string, path: string): string {
  const normalizedMethod = method.trim().toUpperCase();
  const normalizedRoutePath = normalizePath(path);
  return `${normalizedMethod} ${normalizedRoutePath}`;
}

/**
 * Deterministically and locale-independently sorts an array of endpoints.
 * Order:
 * 1. Normalized path alphabetically (using code-point / binary string comparison)
 * 2. HTTP method in canonical order (GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD)
 * 3. Endpoint ID as tie-breaker
 */
export function sortEndpoints(endpoints: readonly Endpoint[]): Endpoint[] {
  return [...endpoints].sort((a, b) => {
    const pathA = normalizePath(a.path);
    const pathB = normalizePath(b.path);

    const pathComparison = compareStrings(pathA, pathB);
    if (pathComparison !== 0) {
      return pathComparison;
    }

    const methodRankA = HTTP_METHOD_ORDER[a.method] ?? 99;
    const methodRankB = HTTP_METHOD_ORDER[b.method] ?? 99;

    if (methodRankA !== methodRankB) {
      return methodRankA - methodRankB;
    }

    return compareStrings(a.id, b.id);
  });
}

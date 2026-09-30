import { describe, it, expect } from 'vitest';
import {
  compareStrings,
  generateEndpointId,
  normalizePath,
  sortEndpoints,
  type Endpoint,
} from '../src/index.js';

describe('Deterministic Locale-Independent Endpoint Helpers', () => {
  describe('compareStrings', () => {
    it('performs exact code-point comparison independent of environment locale', () => {
      expect(compareStrings('a', 'b')).toBe(-1);
      expect(compareStrings('b', 'a')).toBe(1);
      expect(compareStrings('abc', 'abc')).toBe(0);
      expect(compareStrings('A', 'a')).toBe(-1);
    });
  });

  describe('normalizePath', () => {
    it('ensures leading slash and strips trailing slash', () => {
      expect(normalizePath('users')).toBe('/users');
      expect(normalizePath('/users/')).toBe('/users');
      expect(normalizePath('/users/profile/')).toBe('/users/profile');
      expect(normalizePath('/')).toBe('/');
    });
  });

  describe('generateEndpointId', () => {
    it('generates consistent uppercase method and normalized path ID', () => {
      expect(generateEndpointId('get', 'users/:id')).toBe('GET /users/:id');
      expect(generateEndpointId('POST', '/api/v1/auth/login/')).toBe('POST /api/v1/auth/login');
      expect(generateEndpointId('delete', '/items/')).toBe('DELETE /items');
    });
  });

  describe('sortEndpoints', () => {
    const sampleEndpoints: Endpoint[] = [
      {
        id: 'DELETE /users/:id',
        method: 'DELETE',
        path: '/users/:id',
        provenance: { kind: 'literal', filePath: 'users.ts', line: 40 },
        auth: { type: 'bearer' },
        effect: 'destructive',
        params: [],
        responses: [],
        middleware: [],
        confidence: 'confirmed',
      },
      {
        id: 'GET /users',
        method: 'GET',
        path: '/users',
        provenance: { kind: 'literal', filePath: 'users.ts', line: 10 },
        auth: { type: 'none' },
        effect: 'read',
        params: [],
        responses: [],
        middleware: [],
        confidence: 'confirmed',
      },
      {
        id: 'POST /users',
        method: 'POST',
        path: '/users',
        provenance: { kind: 'literal', filePath: 'users.ts', line: 20 },
        auth: { type: 'bearer' },
        effect: 'write',
        params: [],
        responses: [],
        middleware: [],
        confidence: 'confirmed',
      },
      {
        id: 'GET /auth/login',
        method: 'GET',
        path: '/auth/login',
        provenance: { kind: 'literal', filePath: 'auth.ts', line: 5 },
        auth: { type: 'none' },
        effect: 'read',
        params: [],
        responses: [],
        middleware: [],
        confidence: 'confirmed',
      },
      {
        id: 'GET /users/:id',
        method: 'GET',
        path: '/users/:id',
        provenance: { kind: 'literal', filePath: 'users.ts', line: 30 },
        auth: { type: 'none' },
        effect: 'read',
        params: [],
        responses: [],
        middleware: [],
        confidence: 'confirmed',
      },
    ];

    it('sorts endpoints deterministically by path and canonical method order', () => {
      const sorted = sortEndpoints(sampleEndpoints);

      expect(sorted.map((e) => e.id)).toEqual([
        'GET /auth/login',
        'GET /users',
        'POST /users',
        'GET /users/:id',
        'DELETE /users/:id',
      ]);
    });

    it('proves that any arbitrary input ordering produces identical, deterministic output', () => {
      const perm1 = [...sampleEndpoints].reverse();
      const perm2 = [
        sampleEndpoints[3],
        sampleEndpoints[1],
        sampleEndpoints[4],
        sampleEndpoints[0],
        sampleEndpoints[2],
      ];
      const perm3 = [
        sampleEndpoints[2],
        sampleEndpoints[0],
        sampleEndpoints[1],
        sampleEndpoints[3],
        sampleEndpoints[4],
      ];

      const sorted1 = sortEndpoints(perm1);
      const sorted2 = sortEndpoints(perm2);
      const sorted3 = sortEndpoints(perm3);

      expect(sorted1.map((e) => e.id)).toEqual(sorted2.map((e) => e.id));
      expect(sorted2.map((e) => e.id)).toEqual(sorted3.map((e) => e.id));
    });
  });
});

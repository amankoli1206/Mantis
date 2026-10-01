import { describe, it, expect } from 'vitest';
import { parseFile, extractDirectRoutes } from '../src/index.js';

describe('Route Extractor (extractDirectRoutes)', () => {
  it('extracts direct HTTP routes with correct provenance and effects', () => {
    const code = [
      "const express = require('express');",
      'const app = express();',
      "app.get('/users', (req, res) => {});",
      "app.post('/users', (req, res) => {});",
      "app.put('/users/:id', (req, res) => {});",
      "app.delete('/users/:id', (req, res) => {});",
    ].join('\n');

    const { ast } = parseFile(code, 'src/app.js');
    expect(ast).not.toBeNull();

    const { endpoints, diagnostics } = extractDirectRoutes(ast!, 'src/app.js', code);

    expect(diagnostics).toEqual([]);
    expect(endpoints).toHaveLength(4);

    expect(endpoints[0]).toMatchObject({
      id: 'GET /users',
      method: 'GET',
      path: '/users',
      effect: 'read',
      confidence: 'confirmed',
      provenance: {
        kind: 'literal',
        filePath: 'src/app.js',
        line: 3,
        snippet: "app.get('/users', (req, res) => {});",
      },
    });

    expect(endpoints[1]).toMatchObject({
      id: 'POST /users',
      method: 'POST',
      path: '/users',
      effect: 'write',
      confidence: 'confirmed',
      provenance: {
        kind: 'literal',
        filePath: 'src/app.js',
        line: 4,
        snippet: "app.post('/users', (req, res) => {});",
      },
    });

    expect(endpoints[2]).toMatchObject({
      id: 'PUT /users/:id',
      method: 'PUT',
      path: '/users/:id',
      effect: 'write',
      params: [
        {
          name: 'id',
          in: 'path',
          required: true,
          provenance: {
            kind: 'literal',
            filePath: 'src/app.js',
            line: 5,
          },
        },
      ],
      provenance: {
        kind: 'literal',
        filePath: 'src/app.js',
        line: 5,
      },
    });

    expect(endpoints[3]).toMatchObject({
      id: 'DELETE /users/:id',
      method: 'DELETE',
      path: '/users/:id',
      effect: 'destructive',
      provenance: {
        kind: 'literal',
        filePath: 'src/app.js',
        line: 6,
      },
    });
  });

  it('ignores variables named "app" that are NOT initialized as an Express app instance', () => {
    const code = [
      'class FakeApp {',
      '  get(path, handler) {}',
      '}',
      'const app = new FakeApp();',
      "app.get('/fake', () => {});",
    ].join('\n');

    const { ast } = parseFile(code, 'src/fake.js');
    expect(ast).not.toBeNull();

    const { endpoints, diagnostics } = extractDirectRoutes(ast!, 'src/fake.js', code);

    // Because app is not bound to express(), it must be ignored
    expect(endpoints).toHaveLength(0);
    expect(diagnostics).toHaveLength(0);
  });

  it('supports direct instantiation const app = require("express")()', () => {
    const code = [
      "const app = require('express')();",
      "app.get('/direct', (req, res) => {});",
    ].join('\n');

    const { ast } = parseFile(code, 'src/direct.js');
    expect(ast).not.toBeNull();

    const { endpoints } = extractDirectRoutes(ast!, 'src/direct.js', code);

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]!.id).toBe('GET /direct');
  });

  it('emits DG-R003 and marks endpoint uncertain for dynamic path expressions', () => {
    const code = [
      "const express = require('express');",
      'const app = express();',
      "const DYNAMIC = '/dynamic-' + Date.now();",
      'app.get(DYNAMIC, (req, res) => {});',
    ].join('\n');

    const { ast } = parseFile(code, 'src/dynamic.js');
    expect(ast).not.toBeNull();

    const { endpoints, diagnostics } = extractDirectRoutes(ast!, 'src/dynamic.js', code);

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]!.confidence).toBe('uncertain');
    expect(endpoints[0]!.confidenceReason).toBe('DG-R003');
    expect(endpoints[0]!.provenance.kind).toBe('unresolved');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('DG-R003');
    expect(diagnostics[0]!.file).toBe('src/dynamic.js');
    expect(diagnostics[0]!.line).toBe(4);
  });
});

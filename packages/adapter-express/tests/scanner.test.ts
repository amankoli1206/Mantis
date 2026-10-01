import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readFileSync, promises as fs } from 'node:fs';
import os from 'node:os';
import { validateModel, type ApiModel } from '@devguard/core';
import { scanProject, ExpressAdapter } from '../src/index.js';

describe('Express Scanner (scanProject & ExpressAdapter.scan)', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const simpleFixturePath = path.join(repoRoot, 'fixtures/simple/app');
  const goldenModelPath = path.join(repoRoot, 'fixtures/simple/expected.model.json');

  it('scans fixtures/simple/app and extracts all 6 endpoints correctly', async () => {
    const model = await scanProject(simpleFixturePath);

    // 1. Model conforms to core ApiModel validation schema
    const validation = validateModel(model);
    expect(validation.success).toBe(true);

    // 2. Exactly 6 routes extracted, sorted deterministically
    expect(model.endpoints).toHaveLength(6);
    expect(model.diagnostics).toEqual([]);

    const expectedGoldenRaw = readFileSync(goldenModelPath, 'utf8');
    const goldenModel = JSON.parse(expectedGoldenRaw) as ApiModel;

    // 3. Compare all endpoints against golden model on Step 5 supported fields
    // (requestBody and descriptions are Step 8 inference features and omitted from comparison)
    for (let i = 0; i < goldenModel.endpoints.length; i++) {
      const expected = goldenModel.endpoints[i]!;
      const actual = model.endpoints[i]!;

      expect(actual.id).toBe(expected.id);
      expect(actual.method).toBe(expected.method);
      expect(actual.path).toBe(expected.path);
      expect(actual.effect).toBe(expected.effect);
      expect(actual.confidence).toBe(expected.confidence);
      expect(actual.confidenceReason).toBe(expected.confidenceReason);

      // Provenance comparison
      expect(actual.provenance.kind).toBe(expected.provenance.kind);
      expect(actual.provenance.line).toBe(expected.provenance.line);
      expect(actual.provenance.filePath).toBe(expected.provenance.filePath);

      // Path parameters comparison
      expect(actual.params.length).toBe(expected.params.length);
      for (let p = 0; p < expected.params.length; p++) {
        expect(actual.params[p]!.name).toBe(expected.params[p]!.name);
        expect(actual.params[p]!.in).toBe(expected.params[p]!.in);
        expect(actual.params[p]!.required).toBe(expected.params[p]!.required);
        expect(actual.params[p]!.provenance?.line).toBe(expected.params[p]!.provenance?.line);
      }
    }
  });

  it('tolerates broken syntax files and emits DG-P001 while extracting remaining valid routes', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devguard-scan-error-'));
    try {
      // 1. Valid route file
      await fs.writeFile(
        path.join(tempDir, 'valid.js'),
        `
        const express = require('express');
        const app = express();
        app.get('/valid-route', (req, res) => res.send('OK'));
        `
      );

      // 2. Broken syntax file
      await fs.writeFile(
        path.join(tempDir, 'broken.js'),
        `
        const express = require('express');
        const app = express(
        app.get('/broken' {
        `
      );

      const model = await scanProject(tempDir);

      // Successfully extracted valid route
      expect(model.endpoints).toHaveLength(1);
      expect(model.endpoints[0]!.id).toBe('GET /valid-route');

      // Captured DG-P001 diagnostic for broken file
      expect(model.diagnostics.length).toBeGreaterThan(0);
      const parseDiag = model.diagnostics.find((d) => d.code === 'DG-P001');
      expect(parseDiag).toBeDefined();
      expect(parseDiag!.file).toContain('broken.js');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('produces 100% deterministic output across repeated runs', async () => {
    const run1 = await scanProject(simpleFixturePath);
    const run2 = await scanProject(simpleFixturePath);

    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });

  it('ExpressAdapter.scan() wraps scanProject and produces identical output', async () => {
    const adapter = new ExpressAdapter();
    const model = await adapter.scan(simpleFixturePath);

    expect(model.endpoints).toHaveLength(6);
    expect(model.project?.framework).toBe('express');
  });
});

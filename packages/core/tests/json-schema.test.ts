import { describe, it, expect } from 'vitest';
import { getApiModelJsonSchema } from '../src/index.js';

describe('JSON Schema Generator', () => {
  it('generates a valid JSON Schema root object with definitions', () => {
    const schema = getApiModelJsonSchema();

    expect(schema).toBeDefined();
    expect(typeof schema).toBe('object');
    expect(schema).toHaveProperty('definitions');

    const definitions = schema.definitions as Record<string, unknown>;
    expect(definitions).toHaveProperty('ApiModel');
  });
});

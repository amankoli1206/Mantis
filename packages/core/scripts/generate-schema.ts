import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getApiModelJsonSchema } from '../src/schema/json-schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const outputPath = resolve(__dirname, '../api-model.schema.json');
const schema = getApiModelJsonSchema();

writeFileSync(outputPath, JSON.stringify(schema, null, 2) + '\n', 'utf-8');
console.log(`Generated JSON Schema at: ${outputPath}`);

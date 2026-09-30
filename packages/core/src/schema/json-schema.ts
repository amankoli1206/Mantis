import { zodToJsonSchema } from 'zod-to-json-schema';
import { ApiModelSchema } from './model.js';

/**
 * Returns the OpenAPI/JSON Schema (draft-07) representation of ApiModel.
 */
export function getApiModelJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(ApiModelSchema, {
    name: 'ApiModel',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
}

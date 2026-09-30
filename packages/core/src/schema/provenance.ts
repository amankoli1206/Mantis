import { z } from 'zod';

export const ProvenanceKindSchema = z.enum(['literal', 'resolved', 'inferred', 'unresolved']);
export type ProvenanceKind = z.infer<typeof ProvenanceKindSchema>;

export const ProvenanceSchema = z.object({
  kind: ProvenanceKindSchema,
  filePath: z.string().min(1, 'File path must not be empty'),
  line: z.number().int().nonnegative('Line number must be non-negative'),
  column: z.number().int().nonnegative('Column number must be non-negative').optional(),
  snippet: z.string().optional(),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;

export const ConfidenceSchema = z.enum(['confirmed', 'uncertain']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

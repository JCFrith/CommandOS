import { z } from 'zod';

/**
 * The deterministic structured shape every agent execution must return. Enforced
 * twice: by the provider's structured-output mode (the JSON schema below) and by
 * re-validating the parsed response with this Zod schema (defense against a
 * malformed or non-conforming payload → an `invalid_output` failure, never a
 * crash or an unsafe render).
 */
export const executionResultSchema = z.object({
  summary: z.string().min(1).max(4000),
  keyPoints: z.array(z.string().max(500)).max(12),
  risks: z.array(z.string().max(500)).max(12),
  recommendations: z.array(z.string().max(500)).max(12),
  confidence: z.enum(['high', 'medium', 'low']),
});

/**
 * JSON Schema handed to the provider's structured-output mode (`strict: true`).
 * Kept in lockstep with {@link executionResultSchema}. Hand-authored to avoid a
 * zod-to-json-schema dependency for this small, fixed shape.
 */
export const EXECUTION_RESULT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'keyPoints', 'risks', 'recommendations', 'confidence'],
  properties: {
    summary: { type: 'string' },
    keyPoints: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    recommendations: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
} as const;

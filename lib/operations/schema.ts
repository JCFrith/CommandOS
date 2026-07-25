import { z } from 'zod';

import type { OperationStatus } from '@/types';
import { OPERATION_STATUSES } from '@/lib/operations/state-machine';

/**
 * Validation schemas for Operation input, shared by the client forms
 * (React Hook Form) and the server actions, which re-validate with the same
 * schema — the boundary that actually enforces the rules.
 */

export const operationPrioritySchema = z.enum(['low', 'medium', 'high']);

export const operationStatusSchema = z.enum(
  OPERATION_STATUSES as unknown as [OperationStatus, ...OperationStatus[]],
);

const titleSchema = z
  .string()
  .trim()
  .min(1, 'Give the operation a title.')
  .max(120, 'Keep the title under 120 characters.');

const descriptionSchema = z
  .string()
  .trim()
  .max(2000, 'Descriptions are limited to 2000 characters.')
  .optional();

/** Fields accepted when creating an Operation. */
export const createOperationSchema = z.object({
  title: titleSchema,
  description: descriptionSchema,
  priority: operationPrioritySchema.default('medium'),
});

/** Fields accepted when editing an Operation (same editable surface). */
export const updateOperationSchema = z.object({
  title: titleSchema,
  description: descriptionSchema,
  priority: operationPrioritySchema,
});

/** Input accepted when requesting a lifecycle transition. */
export const transitionOperationSchema = z.object({
  to: operationStatusSchema,
});

export type CreateOperationInput = z.infer<typeof createOperationSchema>;
export type UpdateOperationInput = z.infer<typeof updateOperationSchema>;

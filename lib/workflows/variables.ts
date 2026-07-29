import type { WorkflowValue, WorkflowVariable, WorkflowVariables } from './types';

/**
 * The variable / execution-context engine. A run carries a flat, JSON-safe
 * variable store seeded from the trigger input + declared defaults, written by
 * step outputs, and read by conditions and templates.
 *
 * Values are bounded primitives (`string | number | boolean | null`), so the
 * context is always safe to serialize into a checkpoint and — after the Signal
 * layer's own sanitization — into audit Signals. Variables never hold secrets by
 * construction: they are operator-declared or produced by safe step outputs.
 */

const MAX_STRING = 4_000;

/** Coerce an arbitrary value to a bounded {@link WorkflowValue}. */
export function toWorkflowValue(value: unknown): WorkflowValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string')
    return value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  // Anything structured is stringified (bounded) so the store stays flat + safe.
  try {
    const s = JSON.stringify(value);
    return s.length > MAX_STRING ? s.slice(0, MAX_STRING) : s;
  } catch {
    return null;
  }
}

/** Coerce a value to a declared variable's type. */
function coerceToType(value: WorkflowValue, type: WorkflowVariable['type']): WorkflowValue {
  if (value === null) return null;
  if (type === 'number') return typeof value === 'number' ? value : Number(value);
  if (type === 'boolean')
    return typeof value === 'boolean' ? value : value === 'true' || value === 1;
  return String(value);
}

/**
 * Seed the initial variable store from declarations + trigger input. Declared
 * defaults apply when the input omits a key; only declared keys are admitted
 * (an undeclared input key is ignored — the schema is the contract).
 */
export function seedVariables(
  declarations: WorkflowVariable[],
  input: Record<string, unknown> = {},
): WorkflowVariables {
  const vars: WorkflowVariables = {};
  for (const decl of declarations) {
    if (!isSafeVariableKey(decl.key)) continue; // prototype-pollution guard
    const provided = decl.key in input ? toWorkflowValue(input[decl.key]) : undefined;
    const value = provided ?? decl.default ?? null;
    vars[decl.key] = coerceToType(toWorkflowValue(value), decl.type);
  }
  return vars;
}

/** Keys that could pollute the prototype chain — never admitted to the store. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Whether a variable key is safe to store (defense against prototype pollution). */
export function isSafeVariableKey(key: string): boolean {
  return !UNSAFE_KEYS.has(key);
}

/**
 * Set a variable (returns a new store — the caller checkpoints it). Dangerous
 * keys (`__proto__`/`constructor`/`prototype`) are ignored so the flat store can
 * never be used to pollute a prototype. (Object spread + computed keys are
 * already safe, but this is belt-and-suspenders.)
 */
export function setVariable(
  vars: WorkflowVariables,
  key: string,
  value: unknown,
): WorkflowVariables {
  if (!isSafeVariableKey(key)) return vars;
  return { ...vars, [key]: toWorkflowValue(value) };
}

/**
 * Interpolate a template against the variables. `{{key}}` is replaced with the
 * variable's string form; an unknown key becomes an empty string. Purely
 * textual — no expression evaluation.
 */
export function interpolate(template: string, vars: WorkflowVariables): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const value = vars[key];
    return value === null || value === undefined ? '' : String(value);
  });
}

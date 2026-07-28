import type { Condition, CompareOp, ValueRef, WorkflowValue, WorkflowVariables } from './types';

/**
 * The condition engine — a safe, deterministic evaluator for the structured
 * {@link Condition} boolean expressions used by `condition` and `branch` nodes.
 *
 * It is **not** a string language: there is no `eval`, no code execution, no
 * property-path traversal into arbitrary objects — only variable lookups,
 * literals, comparisons, and boolean combinators over the run's flat variable
 * store. This keeps guards injection-proof and reproducible.
 */

/** Resolve a value reference against the run's variables. */
export function resolveValue(ref: ValueRef, vars: WorkflowVariables): WorkflowValue {
  if ('literal' in ref) return ref.literal;
  return ref.var in vars ? vars[ref.var]! : null;
}

function compare(left: WorkflowValue, op: CompareOp, right: WorkflowValue): boolean {
  switch (op) {
    case 'eq':
      return left === right;
    case 'ne':
      return left !== right;
    case 'gt':
      return typeof left === 'number' && typeof right === 'number' && left > right;
    case 'gte':
      return typeof left === 'number' && typeof right === 'number' && left >= right;
    case 'lt':
      return typeof left === 'number' && typeof right === 'number' && left < right;
    case 'lte':
      return typeof left === 'number' && typeof right === 'number' && left <= right;
    case 'contains':
      return typeof left === 'string' && typeof right === 'string' && left.includes(right);
    case 'exists':
      return left !== null && left !== undefined;
  }
}

/** Evaluate a condition to a boolean against the run's variables. */
export function evaluateCondition(condition: Condition, vars: WorkflowVariables): boolean {
  switch (condition.kind) {
    case 'const':
      return condition.value;
    case 'compare': {
      const left = resolveValue(condition.left, vars);
      const right = condition.right ? resolveValue(condition.right, vars) : null;
      return compare(left, condition.op, right);
    }
    case 'and':
      return condition.all.every((c) => evaluateCondition(c, vars));
    case 'or':
      return condition.any.some((c) => evaluateCondition(c, vars));
    case 'not':
      return !evaluateCondition(condition.condition, vars);
  }
}

import type { SignalCategory, SignalSeverity, SignalSource } from './types';

/**
 * The signal-type catalog — the canonical registry mapping each signal type to
 * its source, category, and default severity, plus a short human title.
 *
 * Emitters reference a {@link SignalType} constant rather than a free string, so
 * the taxonomy stays consistent across every subsystem. `createSignal` reads the
 * catalog to fill in source/category/severity (each overridable per-emission —
 * e.g. an operation transition that lands in a terminal state can raise its own
 * severity). Adding a new capability means adding a catalog entry here, once.
 */

/** Static description of a signal type. */
export interface SignalTypeSpec {
  type: string;
  source: SignalSource;
  category: SignalCategory;
  severity: SignalSeverity;
  /** Short, human-facing title used when an emitter does not supply one. */
  title: string;
}

function spec(
  type: string,
  source: SignalSource,
  category: SignalCategory,
  severity: SignalSeverity,
  title: string,
): SignalTypeSpec {
  return { type, source, category, severity, title };
}

/**
 * The representative platform signal types. This is the shared vocabulary — the
 * list every current subsystem emits from, and the seam future subsystems extend.
 */
export const SIGNAL_CATALOG = {
  // --- Operations (lifecycle) ---
  'operation.created': spec(
    'operation.created',
    'operations',
    'lifecycle',
    'info',
    'Operation created',
  ),
  'operation.updated': spec(
    'operation.updated',
    'operations',
    'lifecycle',
    'info',
    'Operation updated',
  ),
  'operation.status_changed': spec(
    'operation.status_changed',
    'operations',
    'lifecycle',
    'info',
    'Operation status changed',
  ),
  'operation.archived': spec(
    'operation.archived',
    'operations',
    'lifecycle',
    'notice',
    'Operation archived',
  ),

  // --- Agents (lifecycle) ---
  'agent.created': spec('agent.created', 'agents', 'lifecycle', 'info', 'Agent created'),
  'agent.updated': spec('agent.updated', 'agents', 'lifecycle', 'info', 'Agent updated'),
  'agent.activated': spec('agent.activated', 'agents', 'lifecycle', 'notice', 'Agent activated'),
  'agent.paused': spec('agent.paused', 'agents', 'lifecycle', 'notice', 'Agent paused'),
  'agent.status_changed': spec(
    'agent.status_changed',
    'agents',
    'lifecycle',
    'info',
    'Agent status changed',
  ),
  'agent.archived': spec('agent.archived', 'agents', 'lifecycle', 'notice', 'Agent archived'),

  // --- Agent execution (execution) ---
  'agent.execution.started': spec(
    'agent.execution.started',
    'agents',
    'execution',
    'info',
    'Agent execution started',
  ),
  'agent.execution.completed': spec(
    'agent.execution.completed',
    'agents',
    'execution',
    'notice',
    'Agent execution completed',
  ),
  'agent.execution.failed': spec(
    'agent.execution.failed',
    'agents',
    'execution',
    'error',
    'Agent execution failed',
  ),

  // --- AI runtime (execution/system) ---
  'execution.started': spec(
    'execution.started',
    'runtime',
    'execution',
    'trace',
    'Execution started',
  ),
  'execution.completed': spec(
    'execution.completed',
    'runtime',
    'execution',
    'info',
    'Execution completed',
  ),
  'execution.failed': spec('execution.failed', 'runtime', 'execution', 'error', 'Execution failed'),
  'execution.retried': spec(
    'execution.retried',
    'runtime',
    'execution',
    'notice',
    'Execution retried',
  ),
  'execution.timed_out': spec(
    'execution.timed_out',
    'runtime',
    'execution',
    'error',
    'Execution timed out',
  ),
  'execution.cancelled': spec(
    'execution.cancelled',
    'runtime',
    'execution',
    'warning',
    'Execution cancelled',
  ),

  // --- Provider (system) ---
  'provider.unavailable': spec(
    'provider.unavailable',
    'provider',
    'system',
    'error',
    'Provider unavailable',
  ),

  // --- Authentication / authorization (security) ---
  'auth.succeeded': spec('auth.succeeded', 'auth', 'security', 'info', 'Authentication succeeded'),
  'auth.failed': spec('auth.failed', 'auth', 'security', 'warning', 'Authentication failed'),
  'authz.permission_denied': spec(
    'authz.permission_denied',
    'authz',
    'security',
    'warning',
    'Permission denied',
  ),

  // --- Workspace (lifecycle) ---
  'workspace.changed': spec(
    'workspace.changed',
    'workspace',
    'lifecycle',
    'info',
    'Workspace changed',
  ),

  // --- Command surface (interaction) ---
  'command.executed': spec(
    'command.executed',
    'commands',
    'interaction',
    'trace',
    'Command executed',
  ),
} as const;

/** A known, catalogued signal type. */
export type SignalType = keyof typeof SIGNAL_CATALOG;

/** Look up a catalog entry; returns `undefined` for an unknown type. */
export function signalTypeSpec(type: string): SignalTypeSpec | undefined {
  return (SIGNAL_CATALOG as Record<string, SignalTypeSpec>)[type];
}

/** Every catalogued type spec, for docs / registration / tests. */
export function signalCatalog(): SignalTypeSpec[] {
  return Object.values(SIGNAL_CATALOG);
}

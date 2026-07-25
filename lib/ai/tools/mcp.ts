import type { ToolDefinition, ToolContext, ToolResult } from './tool';

/**
 * MCP readiness — INTERFACES ONLY (no implementation this sprint).
 *
 * These extension points let future Model Context Protocol servers plug in as
 * tool sources without touching the runtime or callers, and stay entirely
 * provider-independent. An MCP server is discovered, its capabilities are mapped
 * to {@link ToolDefinition}s via a {@link ToolAdapter}, and invocations flow over
 * a {@link Transport} whose {@link ConnectionLifecycle} the platform manages.
 */

/** Connection configuration for an MCP server (no secrets stored inline). */
export interface McpServerConfig {
  id: string;
  name: string;
  /** Opaque endpoint reference; credentials resolved via the secret store. */
  endpoint: string;
  transport: 'stdio' | 'http' | 'websocket';
}

/** Abstracts how requests/responses are carried to an MCP server. */
export interface Transport {
  readonly kind: McpServerConfig['transport'];
  send(method: string, params: unknown, signal?: AbortSignal): Promise<unknown>;
}

/** Lifecycle of a connection to an MCP server. */
export interface ConnectionLifecycle {
  connect(config: McpServerConfig): Promise<void>;
  disconnect(serverId: string): Promise<void>;
  status(serverId: string): 'disconnected' | 'connecting' | 'connected' | 'error';
}

/** Discovers the tools a connected MCP server exposes. */
export interface CapabilityDiscovery {
  discover(serverId: string): Promise<ToolDefinition[]>;
}

/** Adapts an external (MCP) tool into the platform's tool invocation shape. */
export interface ToolAdapter {
  /** The platform-side definitions this adapter contributes. */
  definitions(): ToolDefinition[];
  invoke(toolName: string, input: unknown, ctx: ToolContext): Promise<ToolResult<unknown>>;
}

/** Registers MCP servers as tool sources with the platform. */
export interface McpRegistration {
  register(config: McpServerConfig): Promise<ToolAdapter>;
  unregister(serverId: string): Promise<void>;
  list(): McpServerConfig[];
}

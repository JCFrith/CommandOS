# Tool Framework

A reusable tool architecture (`lib/ai/tools/`) so future tools — and future
MCP-backed tools — plug in without architectural change. This sprint ships the
infrastructure plus a few **internal demonstration tools only**.

## Interfaces — `tool.ts`

| Type                | Purpose                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `ToolContext`       | Scope handed to a tool: `workspaceId`, `operatorId`, optional `signal`. **Ids only — no secrets.** |
| `ToolDefinition<I>` | Discoverable metadata + input contract: `name`, `description`, `inputSchema` (Zod).                |
| `Tool<I, O>`        | `{ definition, execute(input, ctx): Promise<ToolResult<O>> }`.                                     |
| `ToolInvocation`    | `{ tool: string, input: unknown }` — untrusted input, validated at invoke.                         |
| `ToolResult<O>`     | `{ ok: true, output } \| { ok: false, error: ToolError }`.                                         |
| `ToolError`         | `{ code, message }` — safe; never internals.                                                       |

Helpers: `toolOk(output)`, `toolError(code, message)`.

## Registry — `registry.ts`

`ToolRegistry` provides capability discovery and one validated, workspace-scoped
invocation path:

- `register<I, O>(tool)` — rejects duplicate names.
- `has(name)`, `list(): ToolDefinition[]` — discovery.
- `invoke(invocation, ctx): Promise<ToolResult<unknown>>` — validates
  `invocation.input` against the tool's schema, runs it, and converts a thrown
  tool bug into a safe `tool_failed` result. Unknown tools return `unknown_tool`.

`toolRegistry` is the shared instance, seeded with the demo tools.

## Demonstration tools — `builtin.ts`

Deterministic, pure, side-effect-free — they prove the framework end-to-end, not
ship capability:

- `echo` — returns the provided text.
- `calculator` — safe two-operand arithmetic (no `eval`); rejects divide-by-zero.
- `workspace_info` — echoes `ctx.workspaceId` (demonstrates scoping).

## Security boundaries

- Tool input is **untrusted** and validated against the tool's Zod schema before
  execution.
- Tools receive only ids + a cancellation signal — never keys or raw
  credentials.
- Tool errors are caught and returned as safe `ToolResult`s.

## MCP readiness (interfaces only) — `mcp.ts`

No MCP is implemented. Provider-independent extension points let a future MCP
server register as a tool source:

- `McpServerConfig` — connection descriptor (no inline secrets).
- `Transport` — carries requests (`stdio | http | websocket`).
- `ConnectionLifecycle` — `connect` / `disconnect` / `status`.
- `CapabilityDiscovery` — `discover(serverId): ToolDefinition[]`.
- `ToolAdapter` — maps external tools into `ToolResult`s.
- `McpRegistration` — `register` / `unregister` / `list`.

An MCP tool becomes an ordinary registry entry via a `ToolAdapter`, so the
runtime and callers need no change.

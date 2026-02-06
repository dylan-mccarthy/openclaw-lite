# Agent Loop Roadmap (OpenClaw Lite)

Goal: move from the current minimal loop to a production-grade loop closer to OpenClaw's behavior, while keeping local-first simplicity.

## Phase 0 - Baseline Audit (Now)
- [x] Map current entry points that use the loop (web, CLI, integration).
- [x] Document current event stream coverage and gaps vs OpenClaw (tool start/end, lifecycle, assistant deltas).
- [x] Trace tool call formats accepted (native tool_calls vs custom tags).

Findings
- Web entry points: POST /api/agent/run (AgentIntegration.run), POST /api/agent/stream (MemoryStreamingAgent.runWithMemory), plus steering/memory helper endpoints (/api/agent/queue, /api/agent/interrupt, /api/agent/memory/*). See [src/web/server.ts](src/web/server.ts#L1699-L2020).
- CLI: no direct agent-loop command found; CLI is chat/ask/tooling oriented. See [src/cli/cli.ts](src/cli/cli.ts).
- Integration: AgentIntegration wraps AgentLoop + ToolBridge. See [src/agent/agent-integration.ts](src/agent/agent-integration.ts).
- Event stream coverage: lifecycle + message/tool events are emitted in AgentLoop, but streaming is synthetic and not model delta-based; EventStream just ends on agent_end. See [src/agent/event-stream.ts](src/agent/event-stream.ts) and [src/agent/streaming-agent.ts](src/agent/streaming-agent.ts#L1-L156).
- Tool call formats: supports OpenAI `tool_calls` plus custom `<tool_call>{...}</tool_call>` and ```tool_code blocks. See [src/agent/agent-loop.ts](src/agent/agent-loop.ts#L232-L398).

## Phase 1 - Real Streaming + Event Parity (In Progress)
- [x] Add streaming support to OpenClawOpenAIClient (OpenAI-compatible SSE parsing for assistant deltas).
- [x] Add streaming path in AgentLoop that emits message_update events via EventStream.
- [x] Wire StreamingAgent to consume EventStream instead of emitting synthetic events.
- [x] Add lifecycle timestamps on agent_start / agent_end / error events.
- [x] Add tool result formatting hook (summary vs full output) to AgentLoop or ToolBridge.
- [x] Update web /api/agent/stream to use real streaming deltas.

## Phase 2 - Session Discipline + Queueing
- [x] Add per-session serialization to avoid concurrent runs clobbering history.
- [x] Introduce run IDs and session metadata (start/end times, model, prompt size).
- [x] Add cancel/timeout handling per run with clean abort semantics.

## Phase 3 - Tool Lifecycle + Reply Shaping
- [x] Add tool_start/tool_update/tool_result events (UI propagation TBD).
- [x] Implement messaging-tool dedupe (avoid double replies).
- [x] Add reply shaping rules (NO_REPLY suppression, tool error fallback).

## Phase 4 - Compaction + Retry Path
- [x] Add compaction threshold and retry logic for context overflow.
- [x] Emit compaction events to the stream and log metrics.

## Phase 5 - Hooks + Extensibility
- [x] Add before/after tool hooks in the loop.
- [x] Add before_agent_start and agent_end hooks.
- [x] Provide a plugin-friendly lifecycle event surface.

## Phase 6 - Tests + Observability
- [x] Unit tests for loop event ordering and tool call handling.
- [x] Integration tests for streaming + tool execution + memory.
- [x] Add trace logs for run IDs, tool timing, and compaction retries.

# AGENTS.md - OpenClaw Lite Workspace

This is the workspace for OpenClaw Lite, a minimal AI agent for local LLMs.

## Memory System

OpenClaw Lite has a memory system that:
- Auto-saves conversations to `/home/openclaw/.openclaw-lite/memory/`
- Stores tool usage with parameters
- Supports semantic search for recall
- Maintains conversation context

## Tool System

The agent has access to 18 tools:
- **File operations:** read, write, edit, list, mkdir, delete, copy, move, file_info, search
- **Git operations:** git_status, git_log
- **System operations:** exec, ps, kill
- **HTTP operations:** http_request
- **Development:** Various utilities

## Agent Features

**Streaming Agent:** Real-time updates via Server-Sent Events
**Steering:** Message queuing with priorities (low, normal, high, urgent)
**Memory Integration:** Auto-save conversations and semantic search
**Tool Bridge:** Connects agent to tool execution system

## Configuration

- **Model:** Qwen3-4B-Instruct-2507:latest (default)
- **Ollama URL:** http://atlas.lan:11434
- **Memory:** Enabled with auto-save
- **Tools:** All 18 tools available

## Usage

The agent runs at http://localhost:3000 with:
- Web UI at `/`
- API endpoints at `/api/*`
- Agent streaming at `/api/agent/stream`
- Memory search at `/api/agent/memory/search`

## Notes

This is a development workspace for testing OpenClaw Lite features. The agent is configured to be direct with tools and efficient in responses.
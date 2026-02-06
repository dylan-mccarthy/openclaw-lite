# Foundation Phase (OpenClaw Lite)

Goal: deliver a single-user gateway with Telegram pairing, filesystem-first tools, skills registry support, CRON jobs, CLI onboarding, and deep logging.

## Scope Principles
- Single-user first (no multi-channel inbox or multi-agent routing)
- Telegram is the only chat integration for now
- Tools focus on filesystem + Telegram actions
- Skills must be extensible with a registry + install gating
- CRON for scheduled/recurring jobs
- Deep logging for audit/debug (no runbooks)

## Phase 1 - Foundation (Now)

### 1) Gateway Control Plane Skeleton
- [x] WebSocket control plane (clients, events, auth token)
- [x] Session model for single-user `main` + minimal group handling
- [x] Presence/typing/usage events (basic)
- [x] Config load/validate with sane defaults
- [x] Health endpoint + version metadata

### 2) CLI + Onboarding
- [x] `claw-lite onboard` for workspace + config + model selection
- [x] Telegram pairing flow in onboarding
- [x] `claw-lite gateway start|stop|status`
- [x] `claw-lite config validate` (errors + warnings)

### 3) Telegram Integration
- [x] Bot token config (env + config)
- [x] Polling mode with optional webhook toggle
- [x] DM pairing code + allowlist
- [x] Group mention gating + allowlist

### 4) Tools (Filesystem + Telegram Actions)
- [x] Filesystem tools: read/write/edit/list/search
- [x] Tool approvals: dev auto-approve + production gate
- [x] Telegram send/reply tools for agent actions

### 5) Skills Platform v1
- [x] Skill registry client + local cache
- [x] Install gating + allowlist policy
- [x] Versioned skill install + activation

### 6) CRON Jobs
- [x] Schedule store + persistence
- [x] Run history + last-run metadata
- [x] Enable/disable/trigger controls

### 7) Deep Logging
- [x] Structured logs (run, tool, message, error)
- [x] Tool audit trail with inputs/outputs
- [x] Log export bundle for debugging

## Out of Scope for Foundation
- Multi-channel inbox
- Multi-agent routing
- Voice wake / talk mode
- Canvas / nodes / mobile apps
- Runbooks
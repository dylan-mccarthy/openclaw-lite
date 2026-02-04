# OpenClaw Lite Cleanup Tasks

## Current State (Assessment)
- Monorepo-style project with CLI, web server, agent loop, tools, memory, identity, and security scaffolding.
- Security paths normalized to ~/.openclaw-lite and installer aligned.
- Tool approvals are effectively disabled for development; tooling is broadly enabled.
- Agent loop + tool bridge exists; web server exposes tool endpoints and memory integration.
- Security features exist (encryption manager, secure key manager, skill verifier) but are not fully enforced end‑to‑end.

## Tasks

### 1) Configuration & Path Consistency
- [x] Normalize paths to ~/.openclaw-lite across installer and docs.
- [x] Review config defaults vs runtime usage to ensure no legacy paths remain.
- [x] Confirm config file creation is consistent with runtime schema.

### 2) Development Tooling Defaults
- [x] Disable tool approval gating in dev (auto‑approve).
- [x] Ensure all tool integrations (web endpoints + agent loop) honor the dev auto‑approval behavior.
- [x] Add a single switch/flag to re‑enable approvals later.

### 3) Security Enforcement (Post‑dev)
- [x] Make encryption enforcement explicit when secure storage is present.
- [x] Require approvals for dangerous tools in production mode.
- [x] Add clear UX messaging when secure storage is missing.

### 4) Codebase Cleanup
- [x] Identify unused/duplicate integrations and remove or consolidate.
- [x] Reduce dead code paths in agent/tool integrations.
- [x] Align CLI commands with actual features and remove stale help text.

### 5) Docs & State Tracking
- [x] Update README.md to reflect current functionality (web server + agent loop).
- [x] Update CURRENT-STATE.md to match actual code behavior.
- [x] Add a short “security mode” section (dev vs production).

### 6) Testing & Verification
- [x] Add smoke tests for tool execution.
- [x] Add security tests for encryption and secure key access.
- [x] Verify web endpoints respond correctly with dev approvals off.

# Phases

## Phase 1 — Foundation (must-have) ✅
- Gateway control plane skeleton (WS server, auth, config surface)
- CLI + onboarding wizard (initial config + Telegram pairing + gateway start/stop/status)
- Telegram integration (bot token, polling/webhook, DM pairing, allowlist)
- Filesystem tools + approvals (read/write/edit/list/search + dev auto-approve toggle)
- Deep logging (structured logs + tool audit + basic export)

## Phase 2 — Core platform features
- CRON jobs (schedule, persist, run history, enable/disable)
- Skills platform v1 (registry + install gating + versioned installs)
- Session model (single-user main, minimal group handling for Telegram)

## Phase 3 — Hardening + UX
- Gateway diagnostics summary (no runbooks)
- Model/tool usage metrics surface (basic stats)
- CLI polish (doctor-like checks, config validation)

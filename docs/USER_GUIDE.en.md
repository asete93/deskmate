[한국어](USER_GUIDE.md) · **English**

# Deskmate User Guide

> **Prerequisites**: the server must have **Claude Code installed and authenticated**, and for security we recommend using Deskmate **inside a private network or VPN only**.
> Below, the "**data folder**" defaults to `~/.claude-control/<name>/`, or whatever you pass to `--data <path>`. The actual path is shown in the startup banner and on the Settings screen.

Contents: [Getting started](#1-getting-started) · [Core structure](#2-core-structure) · [Chat](#3-chat) · [Org & members](#4-org-chart--members) · [Work tracking](#5-work-tracking) · [Pin review](#6-artifact-pin-review) · [Files](#7-files) · [Terminal](#8-terminal) · [Git](#9-git) · [Settings](#10-settings) · [Usage](#11-usage--tokens) · [Deployment](#12-deployment) · [Troubleshooting](#13-troubleshooting)

## 1. Getting started

```bash
npx github:asete93/deskmate \
  --port auto --name myproject \
  --allow 100.64.0.0/10,192.168.0.0/16,127.0.0.1/32 \
  --https --lang en --driver sdk
```

- `--port auto` picks a free port / `--name` separates data spaces / `--data` sets the data path directly
- `--allow` allowed CIDRs — blocked requests are logged to the server console as `접근 차단: <IP>`. Omit to allow all (not recommended)
- `--https` self-signed TLS (clipboard etc.) / `--lang ko|en` system language / `--no-terminal --no-files` hard-disable features
- Auth (pick one): a machine already `claude /login`-ed is auto-detected · `CLAUDE_CODE_OAUTH_TOKEN` (recommended, via `claude setup-token`) · `ANTHROPIC_API_KEY`
- Without credentials it boots the mock driver (UI preview).

## 2. Core structure

| Role | Who | Does |
|---|---|---|
| **CEO** | you | instruct · approve · review |
| **Team Lead** | main agent | analyze · decompose · brief · verify · report. **File editing is blocked server-side** — must delegate |
| **Members** | worker agents | implement & verify from briefs, report to the Lead |

- **Only three ways a member is created**: ① Lead files an approval → CEO approves (spec adjustable) ② direct hire from the org chart ③ external AI (OpenAI Codex). Everything else is refused by the server.
- **Run modes** (chat ⚙): Plan (plan-approval card before execution) / Auto (file edits auto-accepted) / Ask.
- **4-layer instructions**: server logic → immutable platform constitution → project CLAUDE.md (editable in the chat screen tab) → runtime settings.

## 3. Chat

- **A room = an independent memory.** Per-room **MODEL/EFFORT overrides** (⚙ popup — changing them mid-work interrupts the current turn). Cross-room decisions are fetched via the Lead's history-search tool.
- **@name** targets a member; the recipient pill pins the target.
- **Large pastes** (8+ lines or 600+ chars) collapse into a `📋 Pasted text · N lines` chip — click to view; agents receive the full text.
- Shift+Enter newline · drag/paste file & image attachments · click a sender avatar to open that member's settings.
- **Cards** (choice / form / edit approval / artifact review / plan approval): instead of answering, you can just type a new message — it is **injected as the answer**, so the flow never stalls. Long bodies show as a summary + "view full text" popup.
- Header buttons: **Export** (current room → Markdown file), **Clear** (full reset = messages + memory, or messages-only = memory & in-flight work kept).

## 4. Org chart · members

- Click a member card (org chart shows a "Open chat / Model & settings" chooser) → **settings popup**: name · avatar (1–4 chars/emoji) · role · custom instructions · model · effort.
- **Export spec (JSON)**: save a well-tuned member's role/instructions/model as `deskmate-member-<name>.json` for sharing.
- Dismissal: the card's dismiss button (CEO authority) or a Lead-filed approval.
- Clearing a member's 1:1 conversation resets their session when it grows token-heavy.

## 5. Work tracking

- **Tickets**: auto-created per delegation → review on member reply → done when the REQ completes. Manual tickets/adjustments allowed. Board/table views.
- **Requests (REQ)**: units of CEO work — conversation, tokens and the report are grouped.
- **Reports**: registered on completion — web view (**4 themes**: classic/document/dashboard/dark) + **PPTX/Excel export**.
- **Approvals**: hires/dismissals/decisions, with history.

## 6. Artifact pin review

From an artifact-review card —
- **Right-click = pin comment** (left-click keeps normal page behavior). Pins highlight their target; clicking a pin in the list scrolls to it.
- ✏️ mode: click text to **edit it in place**.
- Submitting sends a structured change order (selectors, before/after) to the team; the revision returns for another round.
- Pages wider than the screen auto-scale to fit.

## 7. Files

Workspace-scoped explorer + CodeMirror editor (syntax highlighting, ⌘S).
Tree DnD move · drag-in upload · download · multi-select (Ctrl/Shift click, rubber-band drag) · **⌘C/⌘X/⌘V/Del** · context menu · clipboard-paste upload. Mobile: editor-first with a file-tree popup. **Off by default — enable in Settings → Menu visibility.**

## 8. Terminal

Web access to the server shell. Horizontal/vertical splits · per-pane font (Ctrl+wheel) · DnD pane arrangement · copy/paste (HTTPS required) · wheel scrollback · pop-out window. X closes only the pane; the server session survives and is reaped after 30 idle minutes. **Off by default.**

## 9. Git

- **Commit history**: branches · commit graph · per-commit diffs · collapsible file tree (snapshot at that commit).
- **Changes · Commit**: stage/unstage per file · diff preview · `.gitignore` editor (applies on save) · commit. **Leave the message empty to auto-generate one** from the staged diff (one Haiku call; zero-token rule-based fallback).
- **Off by default.** If git is missing on the server the menu is disabled automatically (with a notice in Settings).

## 10. Settings

- **Connected services**: register other instances (ports/servers) and switch from the sidebar.
- **Language**: Korean/English — switches the UI, the agents' working language, and default seed names (팀장↔TeamLead, 메인 채팅↔Main Chat — only while unchanged).
- **Login**: single password (scrypt hash), 5 failures = 15-min lockout. Forgot it? `touch <data-dir>/reset-password` on the server, then try signing in again.
- **Scheduled jobs**: once/daily/weekly automatic instructions.
- **Menu visibility**: Git/Terminal/Files toggles — off blocks the APIs too. (Features disabled via `--no-*` don't appear here at all.)
- **Danger zone**: **Reset all memory** (keeps data; resets agent sessions incl. CLI auto-memory) / **Reset all data** (full wipe, requires typing a confirmation word).

## 11. Usage · tokens

- The widget (mobile: the "Usage" bottom tab) shows subscription limits (session/weekly), reset times and today's tokens. Tokens are accounted per REQ.
- Saving tips: set casual rooms to Haiku/low · hire repetitive-work members on small models · reset memory when sessions grow · offload reviews to a Codex member.

## 12. Deployment

For always-on operation use systemd:

```ini
# /etc/systemd/system/deskmate.service
[Unit]
Description=Deskmate
After=network.target
[Service]
Environment=CLAUDE_CODE_OAUTH_TOKEN=<token>
ExecStart=/usr/bin/npx github:asete93/deskmate --port 3200 --name prod --https --allow <trusted-cidr>
Restart=always
User=<dedicated-user>   # prefer a least-privilege account over root
[Install]
WantedBy=multi-user.target
```

- Update: `rm -rf ~/.npm/_npx` and restart (or reinstall via `npm i -g github:asete93/deskmate`). Data lives in the data folder and survives.
- Full reset: stop the service → delete the data folder → start again.
- Hardening: private network/VPN first; if public, login + `--allow` + a TLS reverse proxy; consider systemd `ProtectSystem=strict`, `NoNewPrivileges=yes`.

## 13. Troubleshooting

| Symptom | Fix |
|---|---|
| "forbidden" on access | Your IP is outside `--allow` — check the server console's blocked-IP log and add that range. Allow all by omitting `--allow` or using `0.0.0.0/0` |
| Node version error | Node 22.5+ required — `nvm install 22 && nvm use 22` |
| No Git menu | git isn't installed on the server (Settings shows a notice) — install and restart |
| Codex member silent | `npm i -g @openai/codex` + `codex login` |
| Agents recall odd past context | Danger zone → Reset all memory |
| New commits not picked up by npx | `rm -rf ~/.npm/_npx` and rerun |
| Forgot the password | `touch <data-dir>/reset-password`, then attempt sign-in |

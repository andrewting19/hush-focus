# HUSH — Focus Sanctuary

A productivity tool that silences distracting websites unless Claude Code is actively working.

## Project Structure

Monorepo with three packages:

```
packages/
├── server/      # Node.js WebSocket server + CLI (npm: claude-blocker)
├── extension/   # Chrome extension (Manifest V3)
└── shared/      # Shared TypeScript types
```

## Architecture

```
Claude Code → hooks → Server (localhost:8765) ← WebSocket → Chrome Extension
```

1. **Claude Code hooks** (`~/.claude/settings.json`) send HTTP POST to `/hook` on session/tool events
2. **Server** tracks session states (idle/working/waiting_for_input) and broadcasts via WebSocket
3. **Extension** silences configured domains when no session is "working"

## Key Files

### Server (`packages/server/`)
- `src/bin.ts` - CLI entrypoint (`npx claude-blocker`)
- `src/server.ts` - HTTP + WebSocket server
- `src/state.ts` - Session state management, cleanup, broadcasting
- `src/setup.ts` - Claude Code hook installation
- `src/types.ts` - Server-specific types (extends shared)

### Extension (`packages/extension/`)
- `src/service-worker.ts` - WebSocket connection, state sync, opens sidebar on click
- `src/content-script.ts` - Sanctuary overlay, blocking logic, sounds, toasts
- `src/sidebar.ts/html/css` - Side panel UI with sessions list and settings modal
- `src/offscreen.ts/html` - Offscreen document for reliable Web Audio API playback
- `manifest.json` - Chrome extension manifest v3 (uses Side Panel API)

### Shared (`packages/shared/`)
- `src/types.ts` - Common types: `HookPayload`, `Session`, `SessionInfo`, `ServerMessage`, `ClientMessage`

## Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Development mode (watch)
pnpm dev

# Typecheck all packages
pnpm typecheck

# Build extension only
pnpm --filter @claude-blocker/extension build

# Build server only
pnpm --filter claude-blocker build

# Pack extension as zip
pnpm --filter @claude-blocker/extension zip
```

## Session States

| State | Sites | Description |
|-------|-------|-------------|
| `idle` | Blocked | Claude not working — sites silenced |
| `working` | Unblocked | Claude actively processing — sites accessible |
| `waiting_for_input` | Unblocked | Claude asked a question — shows toast notification |

## Notifications

- **Block sound** - Warm descending two-note chime (G4→D4) when site gets silenced
- **Finish sound** - Gentle ascending resolution (C5→E5→G5) when Claude finishes responding
- **Finish toast** - Shows "Complete" with truncated prompt context (auto-dismisses after 5s)
- **Question toast** - Shows when Claude has a question for user (non-blocking)

Sounds are generated using Web Audio API oscillators (sine waves) via an offscreen document for reliable playback. Volume is set to 12% for subtle, refined alerts.

## Hook Events

Configured in `~/.claude/settings.json`:
- `SessionStart` - New Claude Code session
- `SessionEnd` - Session closed
- `UserPromptSubmit` - User submitted prompt (→ working), includes `prompt` field with user's message
- `PreToolUse` - Tool about to execute (→ working, or waiting_for_input for user input tools)
- `Stop` - Claude finished responding (→ idle)

### Hook Command Format

The hook command captures stdin, enriches with git repo info, and POSTs to the server:

```bash
payload=$(cat); git_repo=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null); [ -n "$git_repo" ] && payload=$(echo "$payload" | sed 's/}$/,"git_repo":"'"$git_repo"'"}/'); curl -s -X POST http://${CLAUDE_BLOCKER_HOST:-localhost}:8765/hook -H 'Content-Type: application/json' -d "$payload" > /dev/null 2>&1 &
```

**Important**: Use `payload=$(cat)` to capture stdin first, then pass `$payload` to curl. Direct `$(cat)` in the `-d` flag causes shell interpretation issues.

The hook also injects `git_repo` (the git repository name) into the payload for better session identification in Docker environments where all sessions share the same `/workspace` cwd.

Run `npx claude-blocker --setup` to automatically configure hooks, or `npx claude-blocker --remove` to remove them.

## Extension Features

- **Side Panel UI** - Sessions list with settings modal accessible via gear icon
  - Main view shows active Claude Code sessions (git repo or folder name, status, last prompt)
  - Settings modal contains silenced domains and emergency bypass
- **Sanctuary overlay** - Full-screen blocking modal with HUSH branding (no bypass on overlay)
- **Emergency Exit** - 5-minute bypass available in settings (once per day, resets at midnight)
- **Real-time updates** - Instant state changes via WebSocket
- **Configurable domains** - Synced via Chrome storage
- **Default silenced**: x.com, youtube.com
- **Notification sounds** - Web Audio API chimes via offscreen document
- **Finish toasts** - Show last prompt when Claude finishes responding
- **Media pause** - Automatically pauses video/audio when blocking activates
- **Persistent blocking** - Mutation observer re-adds overlay if page tries to remove it

## Server Ports

- Default: 8765
- HTTP endpoints: `/status` (GET), `/hook` (POST)
- WebSocket: `/ws`

## Environment Variables

- `CLAUDE_BLOCKER_HOST` - Server host for Docker (default: localhost)

## Version

Current: 0.0.3

## Legacy Files (not used)

The following files exist but are no longer part of the build:
- `src/popup.ts/html/css` - Replaced by sidebar
- `src/options.ts/html/css` - Merged into sidebar

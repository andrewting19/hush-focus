# Claude Blocker

A productivity tool that blocks distracting websites unless Claude Code is actively running inference.

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
3. **Extension** blocks configured domains when no session is "working"

## Key Files

### Server (`packages/server/`)
- `src/bin.ts` - CLI entrypoint (`npx claude-blocker`)
- `src/server.ts` - HTTP + WebSocket server
- `src/state.ts` - Session state management, cleanup, broadcasting
- `src/setup.ts` - Claude Code hook installation
- `src/types.ts` - Server-specific types (extends shared)

### Extension (`packages/extension/`)
- `src/service-worker.ts` - WebSocket connection, state sync, opens sidebar on click
- `src/content-script.ts` - Modal overlay, blocking logic, sounds, toasts
- `src/sidebar.ts/html/css` - Side panel UI with sessions list and settings modal
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

- `idle` - Claude not working (sites blocked)
- `working` - Claude actively processing (sites unblocked)
- `waiting_for_input` - Claude asked user a question (sites blocked)

## Notifications

- **Block sound** - Gentle descending chime (A5→E5) when site gets blocked
- **Finish sound** - Pleasant ascending chime (C5→E5→G5) when Claude finishes responding
- **Finish toast** - Shows "Claude finished" with truncated prompt context (auto-dismisses after 5s)
- **Question toast** - Shows when Claude has a question for user

Sounds are generated using Web Audio API oscillators (sine waves) - no audio files needed. Volume is set to 15% for subtle, non-jarring alerts.

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
  - Settings modal contains blocked domains and emergency bypass
- Soft block with modal overlay (no bypass option on overlay)
- Emergency bypass available in settings (5 minutes, once per day)
- Real-time state updates via WebSocket
- Configurable blocked domains (synced via Chrome storage)
- Default blocked: x.com, youtube.com
- **Notification sounds** - Web Audio API generated chimes (no audio files needed)
- **Finish toasts** - Show last prompt when Claude finishes responding

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

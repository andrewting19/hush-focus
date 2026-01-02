# HUSH — Focus Sanctuary

*Silence the noise. Find your flow.*

Block distracting websites unless [Claude Code](https://claude.ai/claude-code) is actively working. When Claude stops, your distractions go quiet.

**The premise is simple:** if Claude is working, you should be too.

## How It Works

```
┌─────────────────┐     hooks      ┌─────────────────┐    websocket    ┌─────────────────┐
│   Claude Code   │ ─────────────► │  HUSH Server    │ ◄─────────────► │ Chrome Extension│
│   (terminal)    │                │  (localhost)    │                 │   (browser)     │
└─────────────────┘                └─────────────────┘                 └─────────────────┘
       │                                   │                                   │
       │ UserPromptSubmit                  │ tracks sessions                   │ silences sites
       │ PreToolUse                        │ broadcasts state                  │ shows overlay
       │ Stop                              │                                   │ notifies you
       └───────────────────────────────────┴───────────────────────────────────┘
```

1. **Claude Code hooks** notify the server when you submit a prompt or when Claude finishes
2. **HUSH server** tracks all Claude Code sessions and their working/idle states
3. **Chrome extension** silences configured sites when no session is actively working

## Quick Start

### 1. Install the server

```bash
npx claude-blocker --setup
```

This installs the Claude Code hooks and starts the server. The hooks are configured in `~/.claude/settings.json`.

### 2. Install the Chrome extension

- Download from [Chrome Web Store](#) *(coming soon)*
- Or load unpacked from `packages/extension/dist`

### 3. Configure silenced sites

Click the extension icon to open the side panel, then tap the gear icon to add sites you want silenced when Claude is idle.

Default silenced sites: `x.com`, `youtube.com`

## Features

### Intelligent Blocking

- **Soft blocking** — Sites show a full-screen sanctuary overlay, not a hard redirect
- **Three-state awareness** — Distinguishes between Claude working, idle, and waiting for your input
- **Real-time updates** — Instant state changes via WebSocket, no page refresh needed
- **Multi-session support** — Tracks multiple Claude Code instances simultaneously
- **Persistent blocking** — Mutation observer re-adds overlay if page tries to remove it
- **Media pause** — Automatically pauses videos and audio when blocking activates

### Notifications

- **Completion sound** — Gentle ascending chime when Claude finishes a task
- **Block sound** — Warm descending tone when sites get silenced
- **Completion toast** — Shows what task Claude just finished (with your prompt context)
- **Question toast** — Non-blocking notification when Claude has a question for you

All sounds are generated using Web Audio API oscillators — no audio files needed.

### Side Panel UI

- **Status hero** — Visual indicator showing connection state (Offline/Quiet/Ready/Working/Waiting)
- **Active sessions** — See all Claude Code instances, their status, and last prompt
- **Metrics strip** — Sessions count, active count, and gate status at a glance
- **Settings modal** — Manage silenced domains and emergency bypass

### Emergency Exit

- **5-minute bypass** — When you absolutely need access
- **Once per day** — Resets at midnight to prevent abuse
- **Countdown timer** — Shows remaining bypass time in the UI

### Docker Support

- **Git repo detection** — Sessions are identified by repository name, not just `/workspace`
- **Configurable host** — Set `CLAUDE_BLOCKER_HOST` for Docker environments

## Server CLI

```bash
# Start with auto-setup (recommended for first run)
npx claude-blocker --setup

# Start on custom port
npx claude-blocker --port 9000

# Skip setup prompts (for Docker/CI)
npx claude-blocker --skip-setup

# Remove hooks from Claude Code settings
npx claude-blocker --remove

# Show help
npx claude-blocker --help
```

## Session States

| State | Sites | Description |
|-------|-------|-------------|
| `working` | **Unblocked** | Claude is actively processing your request |
| `waiting_for_input` | **Unblocked** | Claude asked a question (shows toast notification) |
| `idle` | **Blocked** | Claude finished — time to send a new prompt |

## Requirements

- Node.js 18+
- Chrome 116+ (or Chromium-based browser)
- [Claude Code](https://claude.ai/claude-code)

## Development

```bash
# Clone and install
git clone https://github.com/t3-content/claude-blocker.git
cd claude-blocker
pnpm install

# Build everything
pnpm build

# Development mode (watch)
pnpm dev

# Type check
pnpm typecheck

# Package extension as zip
pnpm --filter @claude-blocker/extension zip
```

### Project Structure

```
packages/
├── server/      # Node.js WebSocket server + CLI (npm: claude-blocker)
├── extension/   # Chrome extension (Manifest V3)
└── shared/      # Shared TypeScript types
```

### Key Files

**Server:**
- `src/bin.ts` — CLI entrypoint
- `src/server.ts` — HTTP + WebSocket server
- `src/state.ts` — Session state management and broadcasting
- `src/setup.ts` — Claude Code hook installation

**Extension:**
- `src/service-worker.ts` — WebSocket connection, state management
- `src/content-script.ts` — Sanctuary overlay, blocking logic, toasts
- `src/sidebar.ts` — Side panel UI with sessions list and settings
- `src/offscreen.ts` — Reliable audio playback via Web Audio API

## Privacy

- **No data collection** — All data stays on your machine
- **Local only** — Server runs on localhost, no external connections
- **Chrome sync** — Silenced sites list syncs via your Chrome account (if enabled)

See [PRIVACY.md](PRIVACY.md) for full privacy policy.

## Credits

Originally created by [Theo Browne](https://github.com/t3dotgg). Significantly enhanced with the HUSH rebrand, premium UI design, notification system, and additional features.

## License

MIT

// Hook event payload (from Claude Code + enriched by our hook command)
export interface HookPayload {
  session_id: string;
  hook_event_name:
    | "UserPromptSubmit"
    | "PreToolUse"
    | "Stop"
    | "SessionStart"
    | "SessionEnd";
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  transcript_path?: string;
  prompt?: string; // User's message (available on UserPromptSubmit)
  git_repo?: string; // Git repo name (injected by our hook command)
}

// Session state tracked by server
export interface Session {
  id: string;
  status: "idle" | "working" | "waiting_for_input";
  lastActivity: Date;
  waitingForInputSince?: Date;
  cwd?: string;
  gitRepo?: string; // Git repo name
  lastPrompt?: string; // Last user prompt for this session
}

// Session data sent to extension (serialized)
export interface SessionInfo {
  id: string;
  status: "idle" | "working" | "waiting_for_input";
  cwd?: string;
  gitRepo?: string;
  lastPrompt?: string;
}

// WebSocket messages from server to extension
export type ServerMessage =
  | {
      type: "state";
      blocked: boolean;
      sessions: SessionInfo[];
      working: number;
      waitingForInput: number;
      finishedSessionId?: string; // Session that just finished (for notifications)
      finishedPrompt?: string; // Last prompt from the finished session
    }
  | { type: "pong" };

// Tools that indicate Claude is waiting for user input
export const USER_INPUT_TOOLS = [
  "AskUserQuestion",
  "ask_user",
  "ask_human",
];

// WebSocket messages from extension to server
export type ClientMessage = { type: "ping" } | { type: "subscribe" };

// Server configuration
export const DEFAULT_PORT = 8765;
export const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const WORKING_IDLE_TIMEOUT_MS = 10 * 1000; // 10 seconds - if working but no activity, assume interrupted

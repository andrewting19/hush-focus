import type { Session, HookPayload, ServerMessage, SessionInfo } from "./types.js";
import { SESSION_TIMEOUT_MS, USER_INPUT_TOOLS } from "./types.js";

type StateChangeCallback = (message: ServerMessage) => void;

// Track finished session for one-time notification
interface FinishedNotification {
  sessionId: string;
  prompt?: string;
}

class SessionState {
  private sessions: Map<string, Session> = new Map();
  private listeners: Set<StateChangeCallback> = new Set();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private pendingFinish: FinishedNotification | null = null;

  constructor() {
    // Start cleanup interval for stale sessions
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleSessions();
    }, 30_000); // Check every 30 seconds
  }

  subscribe(callback: StateChangeCallback): () => void {
    this.listeners.add(callback);
    // Immediately send current state to new subscriber
    callback(this.getStateMessage());
    return () => this.listeners.delete(callback);
  }

  private broadcast(): void {
    const message = this.getStateMessage();
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  private getStateMessage(): ServerMessage {
    const sessions = Array.from(this.sessions.values());
    const working = sessions.filter((s) => s.status === "working").length;
    const waitingForInput = sessions.filter(
      (s) => s.status === "waiting_for_input"
    ).length;

    // Convert to serializable session info
    const sessionInfos: SessionInfo[] = sessions.map((s) => ({
      id: s.id,
      status: s.status,
      cwd: s.cwd,
      gitRepo: s.gitRepo,
      lastPrompt: s.lastPrompt,
    }));

    const message: ServerMessage = {
      type: "state",
      blocked: working === 0,
      sessions: sessionInfos,
      working,
      waitingForInput,
    };

    // Include finished session info if pending (one-time notification)
    if (this.pendingFinish) {
      message.finishedSessionId = this.pendingFinish.sessionId;
      message.finishedPrompt = this.pendingFinish.prompt;
      this.pendingFinish = null; // Clear after including
    }

    return message;
  }

  handleHook(payload: HookPayload): void {
    const { session_id, hook_event_name } = payload;

    switch (hook_event_name) {
      case "SessionStart":
        this.sessions.set(session_id, {
          id: session_id,
          status: "idle",
          lastActivity: new Date(),
          cwd: payload.cwd,
          gitRepo: payload.git_repo,
        });
        console.log("Claude Code session connected");
        break;

      case "SessionEnd":
        this.sessions.delete(session_id);
        console.log("Claude Code session disconnected");
        break;

      case "UserPromptSubmit":
        this.ensureSession(session_id, payload.cwd, payload.git_repo);
        const promptSession = this.sessions.get(session_id)!;
        promptSession.status = "working";
        promptSession.waitingForInputSince = undefined;
        promptSession.lastActivity = new Date();
        // Store the user's prompt for finish notifications
        if (payload.prompt) {
          promptSession.lastPrompt = payload.prompt;
        }
        break;

      case "PreToolUse":
        this.ensureSession(session_id, payload.cwd, payload.git_repo);
        const toolSession = this.sessions.get(session_id)!;
        // Check if this is a user input tool
        if (payload.tool_name && USER_INPUT_TOOLS.includes(payload.tool_name)) {
          toolSession.status = "waiting_for_input";
          toolSession.waitingForInputSince = new Date();
        } else if (toolSession.status === "waiting_for_input") {
          // If waiting for input, only reset after 500ms (to ignore immediate tool calls like Edit)
          const elapsed = Date.now() - (toolSession.waitingForInputSince?.getTime() ?? 0);
          if (elapsed > 500) {
            toolSession.status = "working";
            toolSession.waitingForInputSince = undefined;
          }
        } else {
          toolSession.status = "working";
        }
        toolSession.lastActivity = new Date();
        break;

      case "Stop":
        this.ensureSession(session_id, payload.cwd, payload.git_repo);
        const idleSession = this.sessions.get(session_id)!;
        const wasWorking = idleSession.status === "working";

        if (idleSession.status === "waiting_for_input") {
          // If waiting for input, only reset after 500ms (to ignore immediate Stop after AskUserQuestion)
          const elapsed = Date.now() - (idleSession.waitingForInputSince?.getTime() ?? 0);
          if (elapsed > 500) {
            idleSession.status = "idle";
            idleSession.waitingForInputSince = undefined;
          }
        } else {
          idleSession.status = "idle";
        }
        idleSession.lastActivity = new Date();

        // If session was working and is now idle, emit finish notification
        if (wasWorking && idleSession.status === "idle") {
          this.pendingFinish = {
            sessionId: session_id,
            prompt: idleSession.lastPrompt,
          };
        }
        break;
    }

    this.broadcast();
  }

  private ensureSession(sessionId: string, cwd?: string, gitRepo?: string): void {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId,
        status: "idle",
        lastActivity: new Date(),
        cwd,
        gitRepo,
      });
      console.log("Claude Code session connected");
    } else if (gitRepo && !this.sessions.get(sessionId)!.gitRepo) {
      // Update gitRepo if we didn't have it before
      this.sessions.get(sessionId)!.gitRepo = gitRepo;
    }
  }

  private cleanupStaleSessions(): void {
    const now = Date.now();
    let removed = 0;

    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity.getTime() > SESSION_TIMEOUT_MS) {
        this.sessions.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      this.broadcast();
    }
  }

  getStatus(): { blocked: boolean; sessions: SessionInfo[] } {
    const sessions = Array.from(this.sessions.values());
    const working = sessions.filter((s) => s.status === "working").length;
    return {
      blocked: working === 0,
      sessions: sessions.map((s) => ({
        id: s.id,
        status: s.status,
        cwd: s.cwd,
        gitRepo: s.gitRepo,
        lastPrompt: s.lastPrompt,
      })),
    };
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.sessions.clear();
    this.listeners.clear();
  }
}

export const state = new SessionState();

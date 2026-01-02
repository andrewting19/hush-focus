export {};

const WS_URL = "ws://localhost:8765/ws";
const KEEPALIVE_INTERVAL = 20_000;
const RECONNECT_BASE_DELAY = 1_000;
const RECONNECT_MAX_DELAY = 30_000;

// Offscreen document for audio playback
let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });

  if (existingContexts.length > 0) {
    return; // Already exists
  }

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: "Playing notification sounds for Claude session events",
  });

  await creatingOffscreen;
  creatingOffscreen = null;
}

async function playSound(type: "block" | "finish"): Promise<void> {
  await ensureOffscreenDocument();
  chrome.runtime.sendMessage({ type: "PLAY_SOUND", sound: type }).catch(() => {});
}

// Session info from server
interface SessionInfo {
  id: string;
  status: "idle" | "working" | "waiting_for_input";
  cwd?: string;
  lastPrompt?: string;
}

// The actual state - service worker is single source of truth
interface State {
  serverConnected: boolean;
  sessions: SessionInfo[];
  working: number;
  waitingForInput: number;
  bypassUntil: number | null;
  // Track for finish notifications
  lastFinishedPrompt: string | null;
  lastFinishedSessionId: string | null;
}

const state: State = {
  serverConnected: false,
  sessions: [],
  working: 0,
  waitingForInput: 0,
  bypassUntil: null,
  lastFinishedPrompt: null,
  lastFinishedSessionId: null,
};

let websocket: WebSocket | null = null;
let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let retryCount = 0;

// Load bypass from storage on startup
chrome.storage.sync.get(["bypassUntil"], (result) => {
  if (result.bypassUntil && result.bypassUntil > Date.now()) {
    state.bypassUntil = result.bypassUntil;
  }
});

// Compute derived state
function getPublicState(includeFinish = false) {
  const bypassActive = state.bypassUntil !== null && state.bypassUntil > Date.now();
  // Don't block if waiting for input - only block when truly idle
  const isIdle = state.working === 0 && state.waitingForInput === 0;
  const shouldBlock = !bypassActive && (isIdle || !state.serverConnected);

  const publicState: Record<string, unknown> = {
    serverConnected: state.serverConnected,
    sessions: state.sessions, // Full session info array
    sessionCount: state.sessions.length,
    working: state.working,
    waitingForInput: state.waitingForInput,
    blocked: shouldBlock,
    bypassActive,
    bypassUntil: state.bypassUntil,
  };

  // Include finish notification info (one-time, cleared after broadcast)
  if (includeFinish && state.lastFinishedSessionId) {
    publicState.finishedSessionId = state.lastFinishedSessionId;
    publicState.finishedPrompt = state.lastFinishedPrompt;
    // Clear after including
    state.lastFinishedSessionId = null;
    state.lastFinishedPrompt = null;
  }

  return publicState;
}

// Broadcast current state to all tabs and extension pages (sidebar)
function broadcast(includeFinish = false) {
  const publicState = getPublicState(includeFinish);

  // Send to content scripts in tabs
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: "STATE", ...publicState }).catch(() => {});
      }
    }
  });

  // Send to extension pages (sidebar, popup, etc.)
  chrome.runtime.sendMessage({ type: "STATE", ...publicState }).catch(() => {});
}

// WebSocket connection management
function connect() {
  if (websocket?.readyState === WebSocket.OPEN) return;
  if (websocket?.readyState === WebSocket.CONNECTING) return;

  try {
    websocket = new WebSocket(WS_URL);

    websocket.onopen = () => {
      console.log("[Claude Blocker] Connected");
      state.serverConnected = true;
      retryCount = 0;
      startKeepalive();
      broadcast();
    };

    websocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "state") {
          state.sessions = msg.sessions ?? [];
          state.working = msg.working;
          state.waitingForInput = msg.waitingForInput ?? 0;

          // Capture finish notification from server
          const hasFinish = msg.finishedSessionId !== undefined;
          if (hasFinish) {
            state.lastFinishedSessionId = msg.finishedSessionId;
            state.lastFinishedPrompt = msg.finishedPrompt ?? null;
            // Play finish sound via offscreen document
            playSound("finish");
          }

          broadcast(hasFinish);
        }
      } catch {}
    };

    websocket.onclose = () => {
      console.log("[Claude Blocker] Disconnected");
      state.serverConnected = false;
      stopKeepalive();
      broadcast();
      scheduleReconnect();
    };

    websocket.onerror = () => {
      state.serverConnected = false;
      stopKeepalive();
    };
  } catch {
    scheduleReconnect();
  }
}

function startKeepalive() {
  stopKeepalive();
  keepaliveInterval = setInterval(() => {
    if (websocket?.readyState === WebSocket.OPEN) {
      websocket.send(JSON.stringify({ type: "ping" }));
    }
  }, KEEPALIVE_INTERVAL);
}

function stopKeepalive() {
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, retryCount), RECONNECT_MAX_DELAY);
  retryCount++;
  reconnectTimeout = setTimeout(connect, delay);
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_STATE") {
    sendResponse(getPublicState());
    return true;
  }

  if (message.type === "PLAY_SOUND" && message.sound) {
    playSound(message.sound);
    return false;
  }

  if (message.type === "ACTIVATE_BYPASS") {
    const today = new Date().toDateString();
    chrome.storage.sync.get(["lastBypassDate"], (result) => {
      if (result.lastBypassDate === today) {
        sendResponse({ success: false, reason: "Already used today" });
        return;
      }
      state.bypassUntil = Date.now() + 5 * 60 * 1000;
      chrome.storage.sync.set({ bypassUntil: state.bypassUntil, lastBypassDate: today });
      broadcast();
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === "GET_BYPASS_STATUS") {
    const today = new Date().toDateString();
    chrome.storage.sync.get(["lastBypassDate"], (result) => {
      sendResponse({
        usedToday: result.lastBypassDate === today,
        bypassActive: state.bypassUntil !== null && state.bypassUntil > Date.now(),
        bypassUntil: state.bypassUntil,
      });
    });
    return true;
  }

  return false;
});

// Check bypass expiry
setInterval(() => {
  if (state.bypassUntil && state.bypassUntil <= Date.now()) {
    state.bypassUntil = null;
    chrome.storage.sync.remove("bypassUntil");
    broadcast();
  }
}, 5000);

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId) {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

// Start
connect();

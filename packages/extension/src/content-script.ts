export {};

const MODAL_ID = "claude-blocker-modal";
const TOAST_ID = "claude-blocker-toast";
const FINISH_TOAST_ID = "claude-blocker-finish-toast";
const DEFAULT_DOMAINS = ["x.com", "youtube.com"];

// ============================================
// Sound utilities using Web Audio API
// ============================================

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

// Play a pleasant notification sound
// type: "block" = gentle descending chime (site blocked)
// type: "finish" = soft ascending chime (work complete)
function playSound(type: "block" | "finish"): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Create gain node for volume control
    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    masterGain.gain.value = 0.15; // Keep it subtle

    if (type === "block") {
      // Gentle descending two-note chime (like a soft doorbell)
      playTone(ctx, masterGain, 880, now, 0.15); // A5
      playTone(ctx, masterGain, 659, now + 0.12, 0.2); // E5
    } else {
      // Pleasant ascending chime (positive/complete feeling)
      playTone(ctx, masterGain, 523, now, 0.12); // C5
      playTone(ctx, masterGain, 659, now + 0.1, 0.12); // E5
      playTone(ctx, masterGain, 784, now + 0.2, 0.2); // G5
    }
  } catch {
    // Audio not available, fail silently
  }
}

function playTone(
  ctx: AudioContext,
  destination: AudioNode,
  frequency: number,
  startTime: number,
  duration: number
): void {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(destination);

  oscillator.type = "sine";
  oscillator.frequency.value = frequency;

  // Soft attack and release for a gentle sound
  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(1, startTime + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.1);
}

// State shape from service worker
interface PublicState {
  serverConnected: boolean;
  sessionCount: number;
  working: number;
  waitingForInput: number;
  blocked: boolean;
  bypassActive: boolean;
  finishedSessionId?: string;
  finishedPrompt?: string;
}

// Track current state so we can re-render if modal gets removed
let lastKnownState: PublicState | null = null;
let shouldBeBlocked = false;
let wasBlocked = false; // Track previous blocked state for sound
let blockedDomains: string[] = [];
let toastDismissed = false;
let finishToastDismissed = false;

// Load domains from storage
function loadDomains(): Promise<string[]> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["blockedDomains"], (result) => {
      if (result.blockedDomains && Array.isArray(result.blockedDomains)) {
        resolve(result.blockedDomains);
      } else {
        resolve(DEFAULT_DOMAINS);
      }
    });
  });
}

function isBlockedDomain(): boolean {
  const hostname = window.location.hostname.replace(/^www\./, "");
  return blockedDomains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
}

function getModal(): HTMLElement | null {
  return document.getElementById(MODAL_ID);
}

function getShadow(): ShadowRoot | null {
  return getModal()?.shadowRoot ?? null;
}

function createModal(): void {
  if (getModal()) return;

  const container = document.createElement("div");
  container.id = MODAL_ID;
  const shadow = container.attachShadow({ mode: "open" });

  // Use inline styles with bulletproof Arial font (won't change when page loads custom fonts)
  shadow.innerHTML = `
    <div style="all:initial;position:fixed;top:0;left:0;right:0;bottom:0;width:100vw;height:100vh;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;z-index:2147483647;-webkit-font-smoothing:antialiased;">
      <div style="all:initial;background:#1a1a1a;border:1px solid #333;border-radius:16px;padding:40px;max-width:480px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased;">
        <svg style="width:64px;height:64px;margin-bottom:24px;" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="11" width="18" height="11" rx="2" fill="#FFD700" stroke="#B8860B" stroke-width="1"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="#888" stroke-width="2" fill="none"/>
        </svg>
        <div style="color:#fff;font-size:24px;font-weight:bold;margin:0 0 16px;line-height:1.2;">Time to Work</div>
        <div id="message" style="color:#888;font-size:16px;line-height:1.5;margin:0 0 24px;font-weight:normal;">Loading...</div>
        <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;background:#2a2a2a;border-radius:20px;font-size:14px;color:#666;line-height:1;">
          <span id="dot" style="width:8px;height:8px;border-radius:50%;background:#666;flex-shrink:0;"></span>
          <span id="status" style="color:#666;font-size:14px;font-family:Arial,Helvetica,sans-serif;">...</span>
        </div>
        <div id="hint" style="margin-top:24px;font-size:13px;color:#555;line-height:1.4;font-family:Arial,Helvetica,sans-serif;"></div>
      </div>
    </div>
  `;

  // Mount to documentElement (html) instead of body - more resilient to React hydration
  document.documentElement.appendChild(container);
}

function removeModal(): void {
  getModal()?.remove();
}

function getToast(): HTMLElement | null {
  return document.getElementById(TOAST_ID);
}

function showToast(): void {
  if (getToast() || toastDismissed) return;

  const container = document.createElement("div");
  container.id = TOAST_ID;
  const shadow = container.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <div style="all:initial;position:fixed;bottom:24px;right:24px;background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:16px 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#fff;z-index:2147483647;display:flex;align-items:center;gap:12px;box-shadow:0 4px 12px rgba(0,0,0,0.3);-webkit-font-smoothing:antialiased;">
      <span style="font-size:18px;">💬</span>
      <span>Claude has a question for you!</span>
      <button id="dismiss" style="all:initial;margin-left:8px;padding:4px 8px;background:#333;border:none;border-radius:6px;color:#888;font-family:Arial,Helvetica,sans-serif;font-size:12px;cursor:pointer;">Dismiss</button>
    </div>
  `;

  const dismissBtn = shadow.getElementById("dismiss");
  dismissBtn?.addEventListener("click", () => {
    toastDismissed = true;
    removeToast();
  });

  document.documentElement.appendChild(container);
}

function removeToast(): void {
  getToast()?.remove();
}

function getFinishToast(): HTMLElement | null {
  return document.getElementById(FINISH_TOAST_ID);
}

function showFinishToast(prompt?: string): void {
  if (getFinishToast() || finishToastDismissed) return;

  const container = document.createElement("div");
  container.id = FINISH_TOAST_ID;
  const shadow = container.attachShadow({ mode: "open" });

  // Truncate prompt if too long
  const displayPrompt = prompt
    ? prompt.length > 60
      ? prompt.slice(0, 60) + "..."
      : prompt
    : null;

  shadow.innerHTML = `
    <div style="all:initial;position:fixed;bottom:24px;right:24px;background:#1a1a1a;border:1px solid #22c55e33;border-radius:12px;padding:16px 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#fff;z-index:2147483647;max-width:320px;box-shadow:0 4px 20px rgba(0,0,0,0.4);-webkit-font-smoothing:antialiased;">
      <div style="display:flex;align-items:flex-start;gap:12px;">
        <span style="font-size:20px;line-height:1;">✓</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;color:#22c55e;margin-bottom:4px;">Claude finished</div>
          ${displayPrompt ? `<div style="font-size:12px;color:#888;line-height:1.4;word-break:break-word;">${displayPrompt}</div>` : ""}
        </div>
        <button id="dismiss" style="all:initial;padding:4px;background:transparent;border:none;color:#666;cursor:pointer;font-size:18px;line-height:1;">×</button>
      </div>
    </div>
  `;

  const dismissBtn = shadow.getElementById("dismiss");
  dismissBtn?.addEventListener("click", () => {
    finishToastDismissed = true;
    removeFinishToast();
  });

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    removeFinishToast();
  }, 5000);

  document.documentElement.appendChild(container);
}

function removeFinishToast(): void {
  getFinishToast()?.remove();
}

// Watch for our modal being removed by the page and re-add it
function setupMutationObserver(): void {
  const observer = new MutationObserver(() => {
    if (shouldBeBlocked && !getModal()) {
      // Modal was removed but should exist - re-create it
      createModal();
      if (lastKnownState) {
        renderState(lastKnownState);
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function setDotColor(dot: HTMLElement, color: "green" | "red" | "gray"): void {
  const colors = {
    green: "background:#22c55e;box-shadow:0 0 8px #22c55e;",
    red: "background:#ef4444;box-shadow:0 0 8px #ef4444;",
    gray: "background:#666;box-shadow:none;",
  };
  dot.style.cssText = `width:8px;height:8px;border-radius:50%;flex-shrink:0;${colors[color]}`;
}

function renderState(state: PublicState): void {
  const shadow = getShadow();
  if (!shadow) return;

  const message = shadow.getElementById("message");
  const dot = shadow.getElementById("dot");
  const status = shadow.getElementById("status");
  const hint = shadow.getElementById("hint");
  if (!message || !dot || !status || !hint) return;

  if (!state.serverConnected) {
    message.textContent = "Server offline. Start the blocker server to continue.";
    setDotColor(dot, "red");
    status.textContent = "Server Offline";
    hint.innerHTML = `Run <span style="background:#2a2a2a;padding:2px 8px;border-radius:4px;font-family:ui-monospace,monospace;font-size:12px;">npx claude-blocker</span> to start`;
  } else if (state.sessionCount === 0) {
    message.textContent = "No Claude Code sessions detected.";
    setDotColor(dot, "green");
    status.textContent = "Waiting for Claude Code";
    hint.textContent = "Open a terminal and start Claude Code";
  } else {
    message.textContent = "Your job finished!";
    setDotColor(dot, "green");
    status.textContent = `${state.sessionCount} session${state.sessionCount > 1 ? "s" : ""} idle`;
    hint.textContent = "Type a prompt in Claude Code to unblock";
  }
}

function renderError(): void {
  const shadow = getShadow();
  if (!shadow) return;

  const message = shadow.getElementById("message");
  const dot = shadow.getElementById("dot");
  const status = shadow.getElementById("status");
  const hint = shadow.getElementById("hint");
  if (!message || !dot || !status || !hint) return;

  message.textContent = "Cannot connect to extension.";
  setDotColor(dot, "red");
  status.textContent = "Extension Error";
  hint.textContent = "Try reloading the extension";
}

// Handle state updates from service worker
function handleState(state: PublicState): void {
  lastKnownState = state;

  // Handle finish notification (show toast and play sound) - even on non-blocked domains
  if (state.finishedSessionId) {
    showFinishToast(state.finishedPrompt);
    playSound("finish");
    finishToastDismissed = false; // Reset for next finish
  }

  if (!isBlockedDomain()) {
    shouldBeBlocked = false;
    wasBlocked = false;
    removeModal();
    removeToast();
    return;
  }

  // Show toast notification when Claude has a question (non-blocking)
  if (state.waitingForInput > 0) {
    showToast();
  } else {
    toastDismissed = false; // Reset so next question can show toast
    removeToast();
  }

  // Show blocking modal when truly idle
  if (state.blocked) {
    // Play block sound only when transitioning from unblocked to blocked
    if (!wasBlocked && !state.bypassActive) {
      playSound("block");
    }
    shouldBeBlocked = true;
    wasBlocked = true;
    createModal();
    renderState(state);
  } else {
    shouldBeBlocked = false;
    wasBlocked = false;
    removeModal();
  }
}

// Request state from service worker
function requestState(): void {
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (response) => {
    if (chrome.runtime.lastError || !response) {
      // Service worker not ready, retry
      setTimeout(requestState, 500);
      createModal();
      renderError();
      return;
    }
    handleState(response);
  });
}

// Listen for broadcasts from service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "STATE") {
    handleState(message);
  }
  if (message.type === "DOMAINS_UPDATED") {
    blockedDomains = message.domains;
    // Re-evaluate if we should be blocked
    if (lastKnownState) {
      handleState(lastKnownState);
    }
  }
});

// Initialize
async function init(): Promise<void> {
  blockedDomains = await loadDomains();

  if (isBlockedDomain()) {
    setupMutationObserver();
    createModal();
    requestState();
  }
}

init();

export {};

const MODAL_ID = "hush-sanctuary-modal";
const TOAST_ID = "hush-toast";
const FINISH_TOAST_ID = "hush-finish-toast";
const DEFAULT_DOMAINS = ["x.com", "youtube.com"];

// Play sounds via service worker (which uses offscreen document)
function playSound(type: "block" | "finish"): void {
  chrome.runtime.sendMessage({ type: "PLAY_SOUND", sound: type }).catch(() => {});
}

// Pause all media elements on the page to stop content playing behind the overlay
function pauseAllMedia(): void {
  const mediaElements = document.querySelectorAll("video, audio");
  mediaElements.forEach((el) => {
    const media = el as HTMLMediaElement;
    if (!media.paused) {
      media.pause();
    }
  });
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
let wasBlocked = false;
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

// Inject Google Fonts for the overlay
function injectFonts(): void {
  if (document.getElementById("hush-fonts")) return;

  const link = document.createElement("link");
  link.id = "hush-fonts";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&family=DM+Sans:wght@400;500&display=swap";
  document.head.appendChild(link);
}

function createModal(): void {
  if (getModal()) return;

  injectFonts();

  const container = document.createElement("div");
  container.id = MODAL_ID;
  const shadow = container.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&family=DM+Sans:wght@400;500&display=swap');

      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      .sanctuary {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100vw;
        height: 100vh;
        background: #0A0908;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'DM Sans', -apple-system, sans-serif;
        z-index: 2147483646;
        -webkit-font-smoothing: antialiased;
        overflow: hidden;
      }

      /* Animated gradient background */
      .sanctuary::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background:
          radial-gradient(ellipse 80% 50% at 50% 0%, rgba(196, 93, 62, 0.08) 0%, transparent 50%),
          radial-gradient(ellipse 60% 40% at 80% 100%, rgba(122, 158, 126, 0.05) 0%, transparent 50%),
          radial-gradient(ellipse 50% 50% at 20% 80%, rgba(107, 143, 173, 0.04) 0%, transparent 50%);
        animation: ambientShift 20s ease-in-out infinite;
      }

      @keyframes ambientShift {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
      }

      /* Grain texture */
      .sanctuary::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        opacity: 0.025;
        pointer-events: none;
        background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
      }

      .content {
        position: relative;
        z-index: 1;
        text-align: center;
        padding: 48px;
        max-width: 420px;
        animation: fadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes fadeUp {
        from {
          opacity: 0;
          transform: translateY(30px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .logo-container {
        margin-bottom: 40px;
        animation: fadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both;
      }

      .logo-ring {
        width: 100px;
        height: 100px;
        margin: 0 auto 24px;
        border-radius: 50%;
        background: linear-gradient(135deg, #1F1D1A 0%, #171613 100%);
        border: 2px solid rgba(245, 240, 232, 0.1);
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow:
          0 0 60px rgba(196, 93, 62, 0.15),
          inset 0 0 30px rgba(0, 0, 0, 0.3);
      }

      .logo-icon {
        width: 40px;
        height: 40px;
        color: #C45D3E;
        opacity: 0.9;
      }

      .brand {
        font-family: 'Playfair Display', Georgia, serif;
        font-size: 28px;
        font-weight: 500;
        letter-spacing: 6px;
        color: #F5F0E8;
        margin-bottom: 8px;
      }

      .tagline {
        font-size: 11px;
        letter-spacing: 2px;
        text-transform: uppercase;
        color: #7A746A;
      }

      .message-container {
        margin-bottom: 40px;
        animation: fadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both;
      }

      .headline {
        font-family: 'Playfair Display', Georgia, serif;
        font-size: 32px;
        font-weight: 400;
        font-style: italic;
        color: #F5F0E8;
        margin-bottom: 16px;
        line-height: 1.3;
      }

      .subtext {
        font-size: 14px;
        color: #7A746A;
        line-height: 1.6;
        max-width: 280px;
        margin: 0 auto;
      }

      .status-container {
        animation: fadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both;
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 12px 20px;
        background: rgba(31, 29, 26, 0.8);
        border: 1px solid rgba(245, 240, 232, 0.08);
        border-radius: 100px;
        backdrop-filter: blur(10px);
      }

      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #4A4640;
        flex-shrink: 0;
      }

      .status-dot.connected {
        background: #7A9E7E;
        box-shadow: 0 0 12px rgba(122, 158, 126, 0.5);
      }

      .status-dot.offline {
        background: #C45D5D;
        box-shadow: 0 0 12px rgba(196, 93, 93, 0.5);
      }

      .status-dot.working {
        background: #D4A855;
        box-shadow: 0 0 12px rgba(212, 168, 85, 0.5);
        animation: breathe 2s ease-in-out infinite;
      }

      @keyframes breathe {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.6; transform: scale(1.1); }
      }

      .status-text {
        font-size: 12px;
        font-weight: 500;
        color: #B8B0A4;
        letter-spacing: 0.5px;
      }

      .hint {
        margin-top: 32px;
        font-size: 12px;
        color: #4A4640;
        animation: fadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.4s both;
      }

      .hint code {
        display: inline-block;
        margin-top: 8px;
        padding: 6px 12px;
        background: rgba(31, 29, 26, 0.6);
        border: 1px solid rgba(245, 240, 232, 0.06);
        border-radius: 6px;
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 11px;
        color: #7A746A;
      }
    </style>

    <div class="sanctuary">
      <div class="content">
        <div class="logo-container">
          <div class="logo-ring">
            <svg class="logo-icon" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
              <path d="M12 20V12C12 12 14 10 16 10C18 10 20 12 20 12V20C20 20 18 22 16 22C14 22 12 20 12 20Z" fill="currentColor" opacity="0.8"/>
              <line x1="8" y1="8" x2="24" y2="24" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="brand">HUSH</div>
          <div class="tagline">Focus Sanctuary</div>
        </div>

        <div class="message-container">
          <div class="headline" id="headline">Finding stillness...</div>
          <div class="subtext" id="subtext">Preparing your focus environment</div>
        </div>

        <div class="status-container">
          <div class="status-pill">
            <span class="status-dot" id="status-dot"></span>
            <span class="status-text" id="status-text">Connecting</span>
          </div>
          <div class="hint" id="hint"></div>
        </div>
      </div>
    </div>
  `;

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
    <style>
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&display=swap');

      .toast {
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: #171613;
        border: 1px solid rgba(107, 143, 173, 0.3);
        border-radius: 12px;
        padding: 16px 20px;
        font-family: 'DM Sans', -apple-system, sans-serif;
        font-size: 14px;
        color: #F5F0E8;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        -webkit-font-smoothing: antialiased;
      }

      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(10px) translateX(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0) translateX(0);
        }
      }

      .icon {
        font-size: 18px;
        color: #6B8FAD;
      }

      .text {
        color: #B8B0A4;
      }

      .dismiss {
        margin-left: 8px;
        padding: 4px 10px;
        background: rgba(245, 240, 232, 0.06);
        border: none;
        border-radius: 6px;
        color: #7A746A;
        font-family: 'DM Sans', sans-serif;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.15s;
      }

      .dismiss:hover {
        background: rgba(245, 240, 232, 0.1);
        color: #B8B0A4;
      }
    </style>

    <div class="toast">
      <span class="icon">💭</span>
      <span class="text">Claude has a question for you</span>
      <button class="dismiss" id="dismiss">Dismiss</button>
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
    ? prompt.length > 50
      ? prompt.slice(0, 50) + "…"
      : prompt
    : null;

  shadow.innerHTML = `
    <style>
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&family=Playfair+Display:ital@1&display=swap');

      .toast {
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: #171613;
        border: 1px solid rgba(122, 158, 126, 0.3);
        border-radius: 14px;
        padding: 18px 22px;
        font-family: 'DM Sans', -apple-system, sans-serif;
        color: #F5F0E8;
        z-index: 2147483647;
        max-width: 300px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        animation: slideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        -webkit-font-smoothing: antialiased;
      }

      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(10px) translateX(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0) translateX(0);
        }
      }

      .header {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding-right: 28px;
      }

      .icon {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: rgba(122, 158, 126, 0.15);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .icon svg {
        width: 12px;
        height: 12px;
        color: #7A9E7E;
      }

      .body {
        flex: 1;
        min-width: 0;
      }

      .title {
        font-weight: 500;
        font-size: 14px;
        color: #7A9E7E;
        margin-bottom: 4px;
      }

      .prompt {
        font-family: 'Playfair Display', Georgia, serif;
        font-size: 12px;
        font-style: italic;
        color: #7A746A;
        line-height: 1.4;
        word-break: break-word;
      }

      .dismiss {
        position: absolute;
        top: 12px;
        right: 12px;
        width: 24px;
        height: 24px;
        background: transparent;
        border: none;
        color: #4A4640;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        transition: all 0.15s;
      }

      .dismiss:hover {
        background: rgba(245, 240, 232, 0.06);
        color: #7A746A;
      }
    </style>

    <div class="toast">
      <div class="header">
        <div class="icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20,6 9,17 4,12"/>
          </svg>
        </div>
        <div class="body">
          <div class="title">Complete</div>
          ${displayPrompt ? `<div class="prompt">"${displayPrompt}"</div>` : ""}
        </div>
      </div>
      <button class="dismiss" id="dismiss">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
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

function setDotClass(dot: HTMLElement, state: "connected" | "offline" | "working"): void {
  dot.className = `status-dot ${state}`;
}

function renderState(state: PublicState): void {
  const shadow = getShadow();
  if (!shadow) return;

  const headline = shadow.getElementById("headline");
  const subtext = shadow.getElementById("subtext");
  const dot = shadow.getElementById("status-dot");
  const statusText = shadow.getElementById("status-text");
  const hint = shadow.getElementById("hint");
  if (!headline || !subtext || !dot || !statusText || !hint) return;

  if (!state.serverConnected) {
    headline.textContent = "Sanctuary Offline";
    subtext.textContent = "The focus server needs to be running to protect your attention.";
    setDotClass(dot, "offline");
    statusText.textContent = "Server Disconnected";
    hint.innerHTML = `<code>npx claude-blocker</code>`;
  } else if (state.sessionCount === 0) {
    headline.textContent = "Awaiting Focus";
    subtext.textContent = "Start a Claude Code session to begin your deep work.";
    setDotClass(dot, "connected");
    statusText.textContent = "No Active Sessions";
    hint.textContent = "";
  } else {
    headline.textContent = "Return to Work";
    subtext.textContent = "Your task is complete. Send a new prompt to continue.";
    setDotClass(dot, "connected");
    statusText.textContent = `${state.sessionCount} session${state.sessionCount > 1 ? "s" : ""} idle`;
    hint.textContent = "";
  }
}

function renderError(): void {
  const shadow = getShadow();
  if (!shadow) return;

  const headline = shadow.getElementById("headline");
  const subtext = shadow.getElementById("subtext");
  const dot = shadow.getElementById("status-dot");
  const statusText = shadow.getElementById("status-text");
  const hint = shadow.getElementById("hint");
  if (!headline || !subtext || !dot || !statusText || !hint) return;

  headline.textContent = "Connection Lost";
  subtext.textContent = "Unable to communicate with the extension.";
  setDotClass(dot, "offline");
  statusText.textContent = "Extension Error";
  hint.textContent = "Try reloading the page";
}

// Handle state updates from service worker
function handleState(state: PublicState): void {
  lastKnownState = state;

  // Handle finish notification (show toast and play sound) - even on non-blocked domains
  if (state.finishedSessionId) {
    showFinishToast(state.finishedPrompt);
    playSound("finish");
    finishToastDismissed = false;
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
    toastDismissed = false;
    removeToast();
  }

  // Show blocking modal when truly idle
  if (state.blocked) {
    // Play block sound only when transitioning from unblocked to blocked
    if (!wasBlocked && !state.bypassActive) {
      playSound("block");
      pauseAllMedia();
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

export {};

const DEFAULT_DOMAINS = ["x.com", "youtube.com"];

interface SessionInfo {
  id: string;
  status: "idle" | "working" | "waiting_for_input";
  cwd?: string;
  gitRepo?: string;
  lastPrompt?: string;
}

interface ExtensionState {
  blocked: boolean;
  serverConnected: boolean;
  sessions: SessionInfo[];
  sessionCount: number;
  working: number;
  waitingForInput: number;
  bypassActive: boolean;
}

interface BypassStatus {
  usedToday: boolean;
  bypassActive: boolean;
  bypassUntil: number | null;
}

// Elements - Status Hero
const statusHero = document.getElementById("status-hero") as HTMLElement;
const statusLabel = document.getElementById("status-label") as HTMLElement;
const statusDetail = document.getElementById("status-detail") as HTMLElement;

// Elements - Metrics
const sessionsEl = document.getElementById("sessions") as HTMLElement;
const workingEl = document.getElementById("working") as HTMLElement;
const blockStatusEl = document.getElementById("block-status") as HTMLElement;
const sessionsList = document.getElementById("sessions-list") as HTMLUListElement;

// Settings modal elements
const settingsBtn = document.getElementById("settings-btn") as HTMLButtonElement;
const modalOverlay = document.getElementById("modal-overlay") as HTMLElement;
const modalClose = document.getElementById("modal-close") as HTMLButtonElement;
const addForm = document.getElementById("add-form") as HTMLFormElement;
const domainInput = document.getElementById("domain-input") as HTMLInputElement;
const domainList = document.getElementById("domain-list") as HTMLUListElement;
const siteCount = document.getElementById("site-count") as HTMLElement;
const bypassBtn = document.getElementById("bypass-btn") as HTMLButtonElement;
const bypassText = document.getElementById("bypass-text") as HTMLElement;
const bypassStatus = document.getElementById("bypass-status") as HTMLElement;

let bypassCountdown: ReturnType<typeof setInterval> | null = null;
let currentDomains: string[] = [];
let currentSessions: SessionInfo[] = [];

// Load domains from storage
async function loadDomains(): Promise<string[]> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["blockedDomains"], (result) => {
      if (result.blockedDomains && Array.isArray(result.blockedDomains)) {
        resolve(result.blockedDomains);
      } else {
        chrome.storage.sync.set({ blockedDomains: DEFAULT_DOMAINS });
        resolve(DEFAULT_DOMAINS);
      }
    });
  });
}

// Save domains to storage
async function saveDomains(domains: string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ blockedDomains: domains }, () => {
      // Notify all tabs about the change
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: "DOMAINS_UPDATED", domains }).catch(() => {});
          }
        }
      });
      resolve();
    });
  });
}

// Normalize domain input
function normalizeDomain(input: string): string {
  let domain = input.toLowerCase().trim();
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.replace(/^www\./, "");
  domain = domain.replace(/\/.*$/, "");
  return domain;
}

// Validate domain format
function isValidDomain(domain: string): boolean {
  const regex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;
  return regex.test(domain);
}

// Render the domain list
function renderDomains(): void {
  domainList.innerHTML = "";
  siteCount.textContent = String(currentDomains.length);

  if (currentDomains.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    domainList.appendChild(empty);
    return;
  }

  for (const domain of currentDomains) {
    const li = document.createElement("li");
    li.className = "domain-item";

    const nameSpan = document.createElement("span");
    nameSpan.className = "domain-name";
    nameSpan.textContent = domain;

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.title = "Remove site";
    removeBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    `;
    removeBtn.addEventListener("click", () => removeDomain(domain));

    li.appendChild(nameSpan);
    li.appendChild(removeBtn);
    domainList.appendChild(li);
  }
}

// Add a domain
async function addDomain(raw: string): Promise<void> {
  const domain = normalizeDomain(raw);

  if (!domain) return;

  if (!isValidDomain(domain)) {
    domainInput.classList.add("error");
    setTimeout(() => domainInput.classList.remove("error"), 400);
    return;
  }

  if (currentDomains.includes(domain)) {
    domainInput.value = "";
    return;
  }

  currentDomains.push(domain);
  currentDomains.sort();
  await saveDomains(currentDomains);
  renderDomains();
  domainInput.value = "";
}

// Remove a domain
async function removeDomain(domain: string): Promise<void> {
  currentDomains = currentDomains.filter((d) => d !== domain);
  await saveDomains(currentDomains);
  renderDomains();
}

// Get display name for session (prefer gitRepo, fallback to folder from cwd)
function getSessionName(session: SessionInfo): string {
  if (session.gitRepo) return session.gitRepo;
  if (!session.cwd) return "Unknown";
  const parts = session.cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] || session.cwd;
}

// Truncate prompt for display
function truncatePrompt(prompt: string | undefined, maxLength = 50): string {
  if (!prompt) return "";
  if (prompt.length <= maxLength) return prompt;
  return prompt.substring(0, maxLength) + "…";
}

// Render sessions list
function renderSessions(): void {
  sessionsList.innerHTML = "";

  if (currentSessions.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-sessions";
    empty.innerHTML = `
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
        <circle cx="12" cy="12" r="10"/>
        <path d="M8 12h8M12 8v8" opacity="0.5"/>
      </svg>
      <p>No active sessions</p>
      <span>Start Claude Code to begin</span>
    `;
    sessionsList.appendChild(empty);
    return;
  }

  for (const session of currentSessions) {
    const li = document.createElement("li");
    li.className = "session-item";

    const statusClass = session.status === "waiting_for_input" ? "waiting" : session.status;
    const statusLabel = session.status === "waiting_for_input" ? "Waiting" :
                       session.status.charAt(0).toUpperCase() + session.status.slice(1);

    li.innerHTML = `
      <div class="session-header">
        <span class="session-status-dot ${statusClass}"></span>
        <span class="session-cwd" title="${session.cwd || "Unknown"}">${getSessionName(session)}</span>
        <span class="session-status-label ${statusClass}">${statusLabel}</span>
      </div>
      ${session.lastPrompt ? `<div class="session-prompt">${truncatePrompt(session.lastPrompt)}</div>` : ""}
    `;

    sessionsList.appendChild(li);
  }
}

// Update UI with extension state
function updateUI(state: ExtensionState): void {
  // Reset status hero classes
  statusHero.className = "status-hero";

  // Status indicator
  if (!state.serverConnected) {
    statusHero.classList.add("offline");
    statusLabel.textContent = "Offline";
    statusDetail.textContent = "Server not connected";
  } else if (state.working > 0) {
    statusHero.classList.add("working");
    statusLabel.textContent = "Working";
    statusDetail.textContent = `Claude is actively processing`;
  } else if (state.waitingForInput > 0) {
    statusHero.classList.add("waiting");
    statusLabel.textContent = "Waiting";
    statusDetail.textContent = "Claude has a question for you";
  } else if (state.sessionCount > 0) {
    statusHero.classList.add("connected");
    statusLabel.textContent = "Ready";
    statusDetail.textContent = `${state.sessionCount} session${state.sessionCount > 1 ? "s" : ""} connected`;
  } else {
    statusHero.classList.add("connected");
    statusLabel.textContent = "Quiet";
    statusDetail.textContent = "No active sessions";
  }

  // Metrics
  sessionsEl.textContent = String(state.sessionCount ?? state.sessions?.length ?? 0);
  workingEl.textContent = String(state.working);

  // Block status with semantic labels
  if (state.bypassActive) {
    blockStatusEl.textContent = "Open";
    blockStatusEl.style.color = "#D4A855";
  } else if (state.blocked) {
    blockStatusEl.textContent = "Shut";
    blockStatusEl.style.color = "#C45D5D";
  } else {
    blockStatusEl.textContent = "Open";
    blockStatusEl.style.color = "#7A9E7E";
  }

  // Update sessions list
  if (state.sessions && Array.isArray(state.sessions)) {
    currentSessions = state.sessions;
    renderSessions();
  }
}

// Update bypass button state
function updateBypassButton(status: BypassStatus): void {
  if (bypassCountdown) {
    clearInterval(bypassCountdown);
    bypassCountdown = null;
  }

  if (status.bypassActive && status.bypassUntil) {
    bypassBtn.disabled = true;
    bypassBtn.classList.add("active");

    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((status.bypassUntil! - Date.now()) / 1000));
      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;
      bypassText.textContent = `${minutes}:${seconds.toString().padStart(2, "0")} remaining`;

      if (remaining <= 0) {
        if (bypassCountdown) clearInterval(bypassCountdown);
        refreshState();
      }
    };

    updateCountdown();
    bypassCountdown = setInterval(updateCountdown, 1000);
    bypassStatus.textContent = "Bypass active";
  } else if (status.usedToday) {
    bypassBtn.disabled = true;
    bypassBtn.classList.remove("active");
    bypassText.textContent = "Used Today";
    bypassStatus.textContent = "Resets at midnight";
  } else {
    bypassBtn.disabled = false;
    bypassBtn.classList.remove("active");
    bypassText.textContent = "Activate";
    bypassStatus.textContent = "5 minutes of freedom, once daily";
  }
}

// Refresh state from service worker
function refreshState(): void {
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (state: ExtensionState) => {
    if (state) {
      updateUI(state);
    }
  });

  chrome.runtime.sendMessage({ type: "GET_BYPASS_STATUS" }, (status: BypassStatus) => {
    if (status) {
      updateBypassButton(status);
    }
  });
}

// Modal handlers
function openModal(): void {
  modalOverlay.classList.add("open");
}

function closeModal(): void {
  modalOverlay.classList.remove("open");
}

// Event listeners
settingsBtn.addEventListener("click", openModal);
modalClose.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) {
    closeModal();
  }
});

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  addDomain(domainInput.value);
});

bypassBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "ACTIVATE_BYPASS" }, (response) => {
    if (response?.success) {
      refreshState();
    } else if (response?.reason) {
      bypassStatus.textContent = response.reason;
    }
  });
});

// Listen for state broadcasts
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "STATE") {
    updateUI(message);
  }
});

// Initialize
async function init(): Promise<void> {
  currentDomains = await loadDomains();
  renderDomains();
  renderSessions();
  refreshState();
}

init();

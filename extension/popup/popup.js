import { render, clear } from './render.js';

const isDetached = new URLSearchParams(window.location.search).get('detached') === '1';

const form = document.getElementById('form');
const input = document.getElementById('input');
const submitBtn = document.getElementById('submit');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const popoutBtn = document.getElementById('popout');
const urlHintEl = document.getElementById('url-hint');
const inflightEl = document.getElementById('inflight-banner');
const searchCtaEl = document.getElementById('search-override-cta');
const searchBtn = document.getElementById('search-override-btn');

const TWEET_URL_RE = /^https?:\/\/(www\.)?(x|twitter)\.com\/[^\s]+$/i;
const CACHE_TTL_MS = 5 * 60 * 1000;
const STALE_INFLIGHT_MS = 5 * 60 * 1000;
const VALID_MODES = ['quick', 'standard', 'deep'];

// Module-level mode state — single source of truth (see spec §7).
let currentMode = 'standard';

// Tracks the input that produced the currently-displayed result, used by the search-override button to re-submit the same input.
let lastAnalyzedInput = '';

// ---------- Pop-out button ----------
if (isDetached) {
  popoutBtn?.classList.add('hidden');
} else {
  popoutBtn?.addEventListener('click', async () => {
    await chrome.windows.create({
      url: chrome.runtime.getURL('popup/popup.html?detached=1'),
      type: 'popup',
      width: 440,
      height: 720,
    });
    window.close();
  });
}

// ---------- Mode pill controls ----------
function applyModeUI(mode) {
  document.querySelectorAll('.mode-pill').forEach(btn => {
    const isSelected = btn.dataset.mode === mode;
    btn.classList.toggle('is-selected', isSelected);
    btn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
  });
}

document.querySelectorAll('.mode-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (!VALID_MODES.includes(mode)) return;
    currentMode = mode;
    applyModeUI(mode);
    chrome.storage.local.set({ mode }).catch(() => {});
  });
});

// ---------- Inflight cancel button ----------
document.getElementById('inflight-cancel').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'cancel' });
  hideInFlight();
});

// ---------- Search-override button ----------
searchBtn.addEventListener('click', async () => {
  if (!lastAnalyzedInput) return;
  hideSearchCta();
  setLoading(true);
  clear();
  resultEl.classList.add('hidden');

  const response = await chrome.runtime.sendMessage({
    type: 'analyze',
    input: lastAnalyzedInput,
    mode: currentMode,
    searchOverride: true,
  });

  setLoading(false);

  if (!response || !response.ok) {
    showError(response?.error || 'Unknown error during search-augmented analysis.');
    return;
  }
  showResult(response.data, response.searchAvailable);
});

// ---------- On-open: load mode + restore cached/in-flight state ----------
(async () => {
  try {
    const { mode: storedMode } = await chrome.storage.local.get('mode');
    if (typeof storedMode === 'string' && VALID_MODES.includes(storedMode)) {
      currentMode = storedMode;
      if (storedMode !== 'standard') applyModeUI(storedMode);
    }
  } catch { /* storage failed — keep default 'standard' */ }

  let inFlight = await chrome.runtime.sendMessage({ type: 'getInFlight' });
  if (inFlight && Date.now() - inFlight.startedAt > STALE_INFLIGHT_MS) {
    await chrome.runtime.sendMessage({ type: 'cancel' });
    inFlight = null;
  }

  if (inFlight) {
    input.value = inFlight.input || '';
    lastAnalyzedInput = inFlight.input || '';
    showInFlight();
    setupInFlightListener();
    return;
  }

  const cached = await chrome.runtime.sendMessage({ type: 'getCachedResult' });
  if (cached && Date.now() - cached.completedAt < CACHE_TTL_MS) {
    input.value = cached.input || '';
    lastAnalyzedInput = cached.input || '';
    showResult(cached.data, cached.searchAvailable);
  }
})();

// ---------- Submit ----------
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  hideUrlHint();
  hideSearchCta();
  if (TWEET_URL_RE.test(text)) {
    showUrlHint('Heads up: tweet URLs often fail to load (X requires auth). Pasting the tweet text usually works better. Trying anyway…');
  }

  setLoading(true);
  clear();
  resultEl.classList.add('hidden');

  const response = await chrome.runtime.sendMessage({ type: 'analyze', input: text, mode: currentMode });

  setLoading(false);

  if (!response || !response.ok) {
    showError(response?.error || 'Unknown error. Is the proxy running on localhost?');
    return;
  }

  lastAnalyzedInput = text;
  showResult(response.data, response.searchAvailable);
});

function setLoading(on) {
  submitBtn.disabled = on;
  searchBtn.disabled = on;
  if (on) {
    statusEl.textContent = 'Analyzing… web search can take 30–90 seconds.';
    statusEl.classList.remove('hidden', 'error');
  } else {
    statusEl.classList.add('hidden');
  }
}

function showError(msg) {
  statusEl.textContent = `Error: ${msg}`;
  statusEl.classList.remove('hidden');
  statusEl.classList.add('error');
}

function showResult(data, searchAvailable) {
  hideInFlight();
  render(data);
  resultEl.classList.remove('hidden');
  // Show the search-override CTA only when the result didn't include search
  // (i.e., Quick or Standard without override). Hidden when search ran (Deep, or override-augmented).
  if (searchAvailable === false) {
    showSearchCta();
  } else {
    hideSearchCta();
  }
}

function showSearchCta() {
  searchCtaEl.classList.remove('hidden');
}
function hideSearchCta() {
  searchCtaEl.classList.add('hidden');
}

function showUrlHint(msg) {
  urlHintEl.textContent = msg;
  urlHintEl.classList.remove('hidden');
  urlHintEl.classList.add('info');
}
function hideUrlHint() {
  urlHintEl.classList.add('hidden');
  urlHintEl.classList.remove('info');
  urlHintEl.textContent = '';
}

function showInFlight() {
  document.getElementById('inflight-text').textContent =
    'Analysis is still running in the background — will display when ready…';
  inflightEl.classList.remove('hidden');
  inflightEl.classList.add('info');
  submitBtn.disabled = true;
  searchBtn.disabled = true;
  hideSearchCta();
}
function hideInFlight() {
  inflightEl.classList.add('hidden');
  inflightEl.classList.remove('info');
  document.getElementById('inflight-text').textContent = '';
  submitBtn.disabled = false;
  searchBtn.disabled = false;
}

function setupInFlightListener() {
  const handler = (changes, area) => {
    if (area !== 'session') return;
    if ('lastResult' in changes && changes.lastResult.newValue) {
      const cached = changes.lastResult.newValue;
      if (cached.input === input.value) {
        showResult(cached.data, cached.searchAvailable);
        chrome.storage.onChanged.removeListener(handler);
      }
    }
    if ('inFlight' in changes && !changes.inFlight.newValue) {
      setTimeout(async () => {
        const finalCheck = await chrome.runtime.sendMessage({ type: 'getCachedResult' });
        if (!finalCheck || finalCheck.input !== input.value) {
          hideInFlight();
          showError('Background analysis ended without a result. Check the proxy log.');
          chrome.storage.onChanged.removeListener(handler);
        }
      }, 500);
    }
  };
  chrome.storage.onChanged.addListener(handler);
}

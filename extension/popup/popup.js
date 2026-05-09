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

const TWEET_URL_RE = /^https?:\/\/(www\.)?(x|twitter)\.com\/[^\s]+$/i;
const CACHE_TTL_MS = 5 * 60 * 1000;

// Hide pop-out button when already in a detached window (no recursion).
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

document.getElementById('inflight-cancel').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'cancel' });
  hideInFlight();
});

// On open: restore cached result OR show in-flight banner.
const STALE_INFLIGHT_MS = 5 * 60 * 1000; // 5 min — longer than proxy's 180s timeout + slack

(async () => {
  let inFlight = await chrome.runtime.sendMessage({ type: 'getInFlight' });

  // Stale-detection: if the marker is older than the proxy could reasonably take,
  // the worker that owned it is dead. Clear and treat as no-in-flight.
  if (inFlight && Date.now() - inFlight.startedAt > STALE_INFLIGHT_MS) {
    await chrome.runtime.sendMessage({ type: 'cancel' });
    inFlight = null;
  }

  if (inFlight) {
    input.value = inFlight.input || '';
    showInFlight();
    setupInFlightListener();
    return;
  }

  const cached = await chrome.runtime.sendMessage({ type: 'getCachedResult' });
  if (cached && Date.now() - cached.completedAt < CACHE_TTL_MS) {
    input.value = cached.input || '';
    showResult(cached.data);
  }
})();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  hideUrlHint();
  if (TWEET_URL_RE.test(text)) {
    showUrlHint('Heads up: tweet URLs often fail to load (X requires auth). Pasting the tweet text usually works better. Trying anyway…');
  }

  setLoading(true);
  clear();
  resultEl.classList.add('hidden');

  const response = await chrome.runtime.sendMessage({ type: 'analyze', input: text });

  setLoading(false);

  if (!response || !response.ok) {
    showError(response?.error || 'Unknown error. Is the proxy running on localhost?');
    return;
  }

  showResult(response.data);
});

function setLoading(on) {
  submitBtn.disabled = on;
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

function showResult(data) {
  hideInFlight();
  render(data);
  resultEl.classList.remove('hidden');
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
}
function hideInFlight() {
  inflightEl.classList.add('hidden');
  inflightEl.classList.remove('info');
  document.getElementById('inflight-text').textContent = '';
  submitBtn.disabled = false;
}

function setupInFlightListener() {
  const handler = (changes, area) => {
    if (area !== 'session') return;
    if ('lastResult' in changes && changes.lastResult.newValue) {
      const cached = changes.lastResult.newValue;
      // Only render if the change is for this input
      if (cached.input === input.value) {
        showResult(cached.data);
        chrome.storage.onChanged.removeListener(handler);
      }
    }
    if ('inFlight' in changes && !changes.inFlight.newValue) {
      // inFlight cleared without lastResult => an error happened in the worker
      // Wait briefly for lastResult to settle, otherwise surface a generic message
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

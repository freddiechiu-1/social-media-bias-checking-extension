import { render, clear } from './render.js';

const form = document.getElementById('form');
const input = document.getElementById('input');
const submitBtn = document.getElementById('submit');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');

(async () => {
  const cached = await chrome.runtime.sendMessage({ type: 'getCachedResult' });
  if (cached && Date.now() - cached.completedAt < 5 * 60 * 1000) {
    input.value = cached.input || '';
    showResult(cached.data);
  }
})();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

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
    statusEl.textContent = 'Analyzing… web search may take 20–30 seconds.';
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
  render(data);
  resultEl.classList.remove('hidden');
}

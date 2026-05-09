const PROXY_URL = 'http://localhost:3001/analyze';

let activeAbortController = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'analyze') {
    handleAnalyze(msg.input, msg.mode, msg.searchOverride)
      .then(({ data, searchAvailable }) => sendResponse({ ok: true, data, searchAvailable }))
      .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (msg.type === 'getCachedResult') {
    chrome.storage.session.get('lastResult').then(({ lastResult }) => {
      sendResponse(lastResult || null);
    });
    return true;
  }

  if (msg.type === 'getInFlight') {
    chrome.storage.session.get('inFlight').then(({ inFlight }) => {
      sendResponse(inFlight || null);
    });
    return true;
  }

  if (msg.type === 'cancel') {
    if (activeAbortController) {
      try { activeAbortController.abort(); } catch { /* ignore */ }
      activeAbortController = null;
    }
    chrome.storage.session.remove('inFlight').then(() => sendResponse(true));
    return true;
  }
});

async function handleAnalyze(input, mode, searchOverride = false) {
  const requestedAt = Date.now();
  await chrome.storage.session.set({ inFlight: { input, mode, searchOverride, startedAt: requestedAt } });

  if (activeAbortController) {
    try { activeAbortController.abort(); } catch { /* ignore */ }
  }
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;

  try {
    let res;
    try {
      res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, mode, searchOverride }),
        signal,
      });
    } catch (netErr) {
      if (netErr.name === 'AbortError') {
        throw new Error('Analysis cancelled');
      }
      throw new Error(`Couldn't reach the proxy at ${PROXY_URL}. Is it running? (${netErr.message})`);
    }
    if (!res.ok) {
      let msg = `Proxy returned ${res.status}`;
      try {
        const body = await res.json();
        if (body && typeof body.error === 'string') msg = body.error;
      } catch { /* response body not JSON; fall back to status */ }
      throw new Error(msg);
    }
    const body = await res.json();
    // Unwrap envelope. Forward-compat: handle older proxy returning just JSON.
    const data = (body && typeof body === 'object' && 'data' in body) ? body.data : body;
    const searchAvailable = (body && typeof body === 'object' && 'searchAvailable' in body) ? !!body.searchAvailable : null;
    if (!data || typeof data !== 'object' || !Array.isArray(data.claims)) {
      throw new Error('Proxy returned unexpected response shape (missing claims array).');
    }
    await chrome.storage.session.set({
      lastResult: { data, searchAvailable, requestedAt, completedAt: Date.now(), input, mode }
    });
    return { data, searchAvailable };
  } finally {
    if (activeAbortController?.signal === signal) {
      activeAbortController = null;
    }
    await chrome.storage.session.remove('inFlight');
  }
}

const PROXY_URL = 'http://localhost:9999/analyze'; // TODO Phase 2: switch to 3001

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'analyze') {
    handleAnalyze(msg.input)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
    return true; // keep channel open for async response
  }

  if (msg.type === 'getCachedResult') {
    chrome.storage.session.get('lastResult').then(({ lastResult }) => {
      sendResponse(lastResult || null);
    });
    return true;
  }
});

async function handleAnalyze(input) {
  const requestedAt = Date.now();
  let res;
  try {
    res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input })
    });
  } catch (netErr) {
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
  const data = await res.json();
  if (!data || typeof data !== 'object' || !Array.isArray(data.claims)) {
    throw new Error('Proxy returned unexpected response shape (missing claims array).');
  }
  await chrome.storage.session.set({
    lastResult: { data, requestedAt, completedAt: Date.now(), input }
  });
  return data;
}

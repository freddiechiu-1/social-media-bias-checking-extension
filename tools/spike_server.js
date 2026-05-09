// Phase 0 Task 0.2 spike — verify chrome-extension → localhost path with CORS.
// This file is vestigial after Phase 0; left as a scaffold artifact.
import http from 'node:http';

const server = http.createServer((req, res) => {
  // Allow any extension origin for dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/test') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, url: req.url, method: req.method }));
    return;
  }

  res.writeHead(404);
  res.end();
});

const PORT = 9999;
server.listen(PORT, () => {
  console.log(`Spike server listening on http://localhost:${PORT}`);
});

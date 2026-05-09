import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, 'sample_response.json');

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/analyze') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      console.log('mock_proxy: received', body.slice(0, 80) + '...');
      await new Promise(r => setTimeout(r, 800));
      const fixture = await fs.readFile(FIXTURE_PATH, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(fixture);
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

const PORT = 9999;
server.listen(PORT, () => {
  console.log(`mock_proxy listening on http://localhost:${PORT}`);
});

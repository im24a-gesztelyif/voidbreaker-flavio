// Serve the exact Vercel export for browser tests, without a game server.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { iceResponse } from '../lib/server/ice.mjs';

const root = resolve('dist/client');
let turn;
if (process.env.E2E_LOCAL_TURN === '1') {
  const { default: Turn } = await import('node-turn');
  const { randomBytes } = await import('node:crypto');
  const credential = randomBytes(24).toString('hex');
  turn = new Turn({
    listeningIps: ['127.0.0.1'],
    relayIps: ['127.0.0.1'],
    listeningPort: 34780,
    minPort: 50000,
    maxPort: 50100,
    authMech: 'long-term',
    credentials: { e2e: credential },
    debugLevel: 'OFF',
  });
  turn.start();
  process.env.TURN_ICE_SERVERS = JSON.stringify([
    { urls: 'turn:127.0.0.1:34780?transport=udp', username: 'e2e', credential },
  ]);
}
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, 'http://localhost').pathname,
    );
    if (pathname === '/api/ice') {
      const response = await iceResponse(
        new Request(`http://${req.headers.host}${req.url}`, {
          method: req.method,
          headers: req.headers,
        }),
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
      return;
    }
    const file = resolve(
      root,
      `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`,
    );
    if (!file.startsWith(root + sep)) throw new Error('Invalid path');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () =>
  console.log('Vercel export ready at http://127.0.0.1:4173'),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    turn?.stop();
    server.close();
  });

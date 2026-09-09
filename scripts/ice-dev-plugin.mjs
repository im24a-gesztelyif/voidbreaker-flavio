import { loadEnv } from 'vite';
import { iceResponse } from '../lib/server/ice.mjs';

// Match Vercel's root /api function in the local Vite development server.
export function iceDevPlugin() {
  let env;
  return {
    name: 'voidbreaker-ice-dev',
    configResolved(config) {
      env = loadEnv(config.mode, config.envDir, '');
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/api/ice') return next();
        try {
          const request = new Request(`http://${req.headers.host}${req.url}`, {
            method: req.method,
            headers: req.headers,
          });
          const response = await iceResponse(request, env);
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(await response.text());
        } catch {
          res.writeHead(500);
          res.end();
        }
      });
    },
  };
}

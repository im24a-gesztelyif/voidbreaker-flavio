import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Set the same export mode on Windows, macOS, Linux, and Vercel, without a shell.
const root = new URL('../', import.meta.url);
const cli = fileURLToPath(new URL('./cli.js', import.meta.resolve('vinext')));
const result = spawnSync(process.execPath, [cli, 'build'], {
  cwd: fileURLToPath(root),
  env: { ...process.env, VOIDBREAKER_STATIC_EXPORT: '1' },
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

// A client JS bundle alone is not a deployable static site.
await access(new URL('dist/client/index.html', root));
console.log('Vercel export ready: dist/client/index.html');

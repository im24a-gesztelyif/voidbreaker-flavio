import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const relay = process.argv.includes('--relay');
const env = { ...process.env };
if (relay) {
  env.E2E_FORCE_RELAY = '1';
  // Deployed tests must use the deployment's real provider, never a local substitute.
  if (!env.E2E_BASE_URL) env.E2E_LOCAL_TURN = '1';
}
const run = (file, args = []) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Command exited with ${code}`)),
    );
  });
try {
  if (!env.E2E_BASE_URL) await run('scripts/build-vercel.mjs');
  await run(require.resolve('@playwright/test/cli'), ['test']);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

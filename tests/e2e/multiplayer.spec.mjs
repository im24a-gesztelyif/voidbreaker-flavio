import { test, expect } from '@playwright/test';

const status = (page) => page.evaluate(() => window.__readGame?.());

async function instrument(context) {
  await context.addInitScript(
    ({ relay }) => {
      localStorage.setItem(
        'voidbreaker-save-v1',
        JSON.stringify({
          version: 1,
          settings: { quality: 'low', volume: 0, autoFire: false },
        }),
      );
      Object.defineProperty(document, 'modelContext', {
        configurable: true,
        value: {
          registerTool: (tool) => {
            if (tool.name === 'get_voidbreaker_status')
              window.__readGame = tool.execute;
          },
        },
      });
      window.__rtc = [];
      const RTC = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends RTC {
        constructor(config, ...rest) {
          super(
            { ...config, ...(relay ? { iceTransportPolicy: 'relay' } : {}) },
            ...rest,
          );
          window.__rtc.push(this);
        }
      };
      window.__signaling = [];
      const Socket = window.WebSocket;
      window.WebSocket = class extends Socket {
        constructor(...args) {
          super(...args);
          window.__signaling.push(this);
        }
      };
    },
    { relay: process.env.E2E_FORCE_RELAY === '1' },
  );
}

test('real peers: join, rejoin, launch, movement, dash, pause, signaling recovery, disconnect', async ({
  browser,
  baseURL,
}, testInfo) => {
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  await Promise.all(contexts.map(instrument));
  const [host, guest] = await Promise.all(contexts.map((c) => c.newPage()));
  const errors = [];
  for (const page of [host, guest])
    page.on('pageerror', (error) => errors.push(error.message));
  try {
    await host.goto(baseURL);
    await host.getByRole('button', { name: 'ONLINE CO-OP' }).click();
    await host.getByRole('button', { name: 'CREATE ROOM' }).click();
    await expect(host.locator('.room-code strong')).toBeVisible();
    const code = await host.locator('.room-code strong').innerText();
    const launch = host.getByRole('button', { name: 'LAUNCH TOGETHER' });
    const join = async () => {
      await guest.goto(`${baseURL}/?room=${code}`);
      await guest.getByRole('button', { name: 'JOIN ROOM' }).click();
      await expect(launch).toBeEnabled();
      await expect(
        guest.getByText('Waiting for the commander to launch.', {
          exact: true,
        }),
      ).toBeVisible();
    };
    await join();
    await guest
      .getByRole('button', { name: 'Leave room', exact: true })
      .click();
    await expect(launch).toBeDisabled();
    await join();

    if (process.env.E2E_FORCE_RELAY === '1') {
      for (const page of [host, guest]) {
        const selectedPaths = () =>
          page.evaluate(async () => {
            const stats = await window.__rtc.at(-1).getStats();
            return [...stats.values()]
              .filter(
                (s) =>
                  s.type === 'candidate-pair' &&
                  s.state === 'succeeded' &&
                  s.nominated,
              )
              .map((s) => ({
                local: stats.get(s.localCandidateId).candidateType,
                remote: stats.get(s.remoteCandidateId).candidateType,
              }));
          });
        await expect
          .poll(selectedPaths)
          .toContainEqual({ local: 'relay', remote: 'relay' });
        const paths = await selectedPaths();
        await testInfo.attach('selected ICE path', {
          body: JSON.stringify(paths),
          contentType: 'application/json',
        });
      }
    }
    await launch.click();
    await expect(host.locator('.wingmate-hud')).toBeVisible();
    await expect(guest.locator('.wingmate-hud')).toBeVisible();
    await expect.poll(async () => (await status(guest))?.phase).toBe('playing');
    const initial = await status(guest);
    await guest.keyboard.down('d');
    await expect
      .poll(async () => (await status(host)).partner.x)
      .toBeGreaterThan(initial.player.x + 3);
    await guest.keyboard.press('Space');
    await expect
      .poll(async () => (await status(guest)).player.dashCooldown)
      .toBeGreaterThan(0);
    await guest.keyboard.up('d');
    await host.keyboard.down('a');
    const before = await status(host);
    await expect
      .poll(async () => (await status(guest)).partner.x)
      .toBeLessThan(before.player.x - 3);
    await host.keyboard.up('a');

    // Signaling reconnects while the independent data channels and run survive.
    for (const page of [host, guest])
      await page.evaluate(() => window.__signaling.at(-1).close());
    await expect
      .poll(() => host.evaluate(() => window.__signaling.length))
      .toBeGreaterThan(1);
    await expect
      .poll(() => guest.evaluate(() => window.__signaling.length))
      .toBeGreaterThan(1);
    await expect
      .poll(async () => (await status(guest)).time)
      .toBeGreaterThan(before.time + 2);
    expect((await status(host)).multiplayer.run).toBe(initial.multiplayer.run);
    expect((await status(guest)).multiplayer.status).toBe('connected');
    // Focus loss clears controls without pausing visible co-op windows.
    await guest.evaluate(() => window.dispatchEvent(new Event('blur')));
    expect((await status(guest)).phase).toBe('playing');

    await guest.keyboard.press('Escape');
    await expect(
      host.getByRole('heading', { name: 'TAKE A BREATH.' }),
    ).toBeVisible();
    await expect(
      guest.getByRole('button', { name: 'COMMANDER RESUMES' }),
    ).toBeDisabled();
    await host.getByRole('button', { name: 'RESUME FLIGHT' }).click();
    await expect.poll(async () => (await status(guest)).phase).toBe('playing');
    await host.screenshot({ path: testInfo.outputPath('host.png') });
    await guest.screenshot({ path: testInfo.outputPath('guest.png') });
    await guest.close();
    await expect(
      host.getByRole('heading', { name: 'REGROUP IN THE HANGAR.' }),
    ).toBeVisible({ timeout: 40_000 });
    expect(errors).toEqual([]);
  } finally {
    for (const [i, page] of [host, guest].entries()) {
      if (!page.isClosed())
        await testInfo.attach(`pilot-${i}-status`, {
          body: JSON.stringify(await status(page)),
          contentType: 'application/json',
        });
    }
    await Promise.all(contexts.map((c) => c.close()));
  }
});

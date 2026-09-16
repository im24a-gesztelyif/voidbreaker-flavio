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
    await host.getByLabel('Room mission').selectOption('endless');
    await host.getByLabel('Room difficulty').selectOption('veteran');
    await host.getByLabel('Power-ups').selectOption('false');
    await host.getByLabel('Kill display').selectOption('false');
    const code = await host.locator('.room-code strong').innerText();
    const launch = host.getByRole('button', { name: 'LAUNCH TOGETHER' });
    const join = async () => {
      await guest.goto(`${baseURL}/?room=${code}`);
      await guest.getByRole('button', { name: 'JOIN ROOM' }).click();
      await expect(launch).toBeEnabled();
      await expect(guest.getByLabel('Room mission')).toHaveValue('endless');
      await expect(guest.getByLabel('Room difficulty')).toHaveValue('veteran');
      await expect(guest.getByLabel('Power-ups')).toHaveValue('false');
      await expect(guest.getByLabel('Kill display')).toHaveValue('false');
      await expect(guest.getByLabel('Power-ups')).toBeDisabled();
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
    await host.locator('.lobby-loadout summary').click();
    await host.getByRole('tab', {name:/BASTION/}).click();
    await expect(guest.getByLabel('Room mission')).toHaveValue('endless');
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

test('four real pilots: roster, fifth-player rejection, independent controls, shared hangar and rematch', async ({browser,baseURL},testInfo)=>{
  test.setTimeout(180_000);
  const contexts=await Promise.all(Array.from({length:5},()=>browser.newContext({viewport:{width:1280,height:720}})));
  await Promise.all(contexts.map(instrument));
  const pages=await Promise.all(contexts.map(c=>c.newPage()));const [host,...guests]=pages;const errors=[];
  pages.forEach(p=>p.on('pageerror',e=>errors.push(e.message)));
  try {
    await host.goto(baseURL);await host.getByRole('button',{name:'ONLINE CO-OP'}).click();await host.getByRole('button',{name:'CREATE ROOM'}).click();
    await expect(host.locator('.room-code strong')).toBeVisible();const code=await host.locator('.room-code strong').innerText();
    await host.getByLabel('Power-ups').selectOption('false');await host.getByLabel('Kill display').selectOption('false');await host.getByLabel('Room mission').selectOption('endless');
    await host.getByLabel('YOUR PILOT NAME').fill('Nova');
    await Promise.all(guests.slice(0,3).map(async(p,i)=>{await p.goto(`${baseURL}/?room=${code}`);await p.getByLabel('YOUR PILOT NAME').fill(`Ace ${i+1}`);}));
    await Promise.all(guests.slice(0,3).map(p=>p.getByRole('button',{name:'JOIN ROOM'}).click()));
    await expect(host.locator('.room-code small')).toHaveText('4/4 PILOTS IN PARTY');
    for(const p of pages.slice(0,4))for(const name of ['Nova','Ace 1','Ace 2','Ace 3'])await expect(p.locator('.crew-grid')).toContainText(name);
    for(const p of pages.slice(0,4)){await expect(p.locator('.crew-grid > div:not(.crew-empty)')).toHaveCount(4);await expect(p.getByLabel('Power-ups')).toHaveValue('false');}
    await guests[1].getByRole('button',{name:'Leave room',exact:true}).click();await expect(host.locator('.room-code small')).toHaveText('3/4 PILOTS IN PARTY');
    await guests[1].goto(`${baseURL}/?room=${code}`);await guests[1].getByRole('button',{name:'JOIN ROOM'}).click();await expect(host.locator('.room-code small')).toHaveText('4/4 PILOTS IN PARTY');
    await guests[3].goto(`${baseURL}/?room=${code}`);await guests[3].getByRole('button',{name:'JOIN ROOM'}).click();await expect(guests[3].getByRole('alert')).toContainText('full');
    await guests[1].locator('.lobby-loadout summary').click();await guests[1].getByRole('tab',{name:/WRAITH/}).click();
    await expect(host.locator('.crew-grid')).toContainText('WRAITH');
    await host.getByRole('button',{name:'LAUNCH TOGETHER'}).click();
    for(const p of pages.slice(0,4)){await expect.poll(async()=> (await status(p))?.pilots.length).toBe(4);await expect(p.locator('.wingmate-hud')).toHaveCount(3);await expect(p.locator('.wingmate-stack')).toContainText('Ace');}
    const before=await Promise.all(pages.slice(0,4).map(status));expect(new Set(before.map(s=>s.localPilot)).size).toBe(4);
    const keys=['a','d','w','s'];await Promise.all(pages.slice(0,4).map((p,i)=>p.keyboard.down(keys[i])));
    for(let i=0;i<4;i++)await expect.poll(async()=>{
      const now=await status(pages[i]);return Math.hypot(now.player.x-before[i].player.x,now.player.y-before[i].player.y);
    }).toBeGreaterThan(3);
    await Promise.all(pages.slice(0,4).map((p,i)=>p.keyboard.up(keys[i])));
    for(let i=1;i<4;i++){const local=await status(pages[i]);await expect.poll(async()=>{
      const remote=(await status(host)).pilots.find(m=>m.slot===local.localPilot);return Math.hypot(remote.x-local.player.x,remote.y-local.player.y);
    }).toBeLessThan(2);}
    await guests[2].keyboard.press('Escape');await expect(host.getByRole('heading',{name:'TAKE A BREATH.'})).toBeVisible();
    for(const p of guests.slice(0,3))await expect(p.getByRole('button',{name:'COMMANDER RESUMES'})).toBeDisabled();
    await host.getByRole('button',{name:'RESUME FLIGHT'}).click();await expect.poll(async()=> (await status(guests[2])).phase).toBe('playing');
    await host.screenshot({path:testInfo.outputPath('four-pilot-host.png')});
    await guests[2].setViewportSize({width:844,height:390});await guests[2].screenshot({path:testInfo.outputPath('four-pilot-landscape.png')});
    await host.keyboard.press('Escape');await host.getByRole('button',{name:/Abandon run/}).click();
    for(const p of guests.slice(0,3)){await expect(p.locator('.room-code strong')).toHaveText(code);await expect.poll(async()=> (await status(p)).phase).toBe('menu');}
    await host.getByRole('button',{name:'ONLINE CO-OP'}).click();await host.getByRole('button',{name:'LAUNCH TOGETHER'}).click();
    for(const p of pages.slice(0,4)){await expect.poll(async()=> (await status(p)).phase).toBe('playing');expect((await status(p)).multiplayer.run).not.toBe(before[0].multiplayer.run);}
    await guests[2].close();
    for(const p of pages.slice(0,3))await expect(p.getByRole('heading',{name:'REGROUP IN THE HANGAR.'})).toBeVisible({timeout:40000});
    expect(errors).toEqual([]);
  } finally {await Promise.all(contexts.map(c=>c.close()));}
});


test('three pilots with identical ships have distinct names and isolated controls',async({browser,baseURL})=>{
  const contexts=await Promise.all(Array.from({length:3},()=>browser.newContext({viewport:{width:1280,height:720}})));
  await Promise.all(contexts.map(instrument));const pages=await Promise.all(contexts.map(c=>c.newPage()));const [host,a,b]=pages;
  try {
    await host.goto(baseURL);await expect(host.locator('link[rel="icon"][href="/favicon.png"]')).toHaveCount(1);
    await host.getByRole('button',{name:'ONLINE CO-OP'}).click();await host.getByLabel('YOUR PILOT NAME').fill('Commander');await host.getByRole('button',{name:'CREATE ROOM'}).click();
    const code=await host.locator('.room-code strong').innerText();
    for(const [i,p] of [a,b].entries()){await p.goto(`${baseURL}/?room=${code}`);await p.getByLabel('YOUR PILOT NAME').fill(`Twin ${i+1}`);await p.getByRole('button',{name:'JOIN ROOM'}).click();}
    for(const p of pages){await expect(p.locator('.crew-grid > div:not(.crew-empty)')).toHaveCount(3);await expect(p.getByLabel('Power-ups')).toHaveValue('false');await expect(p.getByLabel('Kill display')).toHaveValue('false');}
    await b.getByLabel('YOUR PILOT NAME').fill('Renamed');for(const p of pages)await expect(p.locator('.crew-grid')).toContainText('Renamed');
    await host.getByRole('button',{name:'LAUNCH TOGETHER'}).click();for(const p of pages)await expect.poll(async()=> (await status(p))?.pilots.length).toBe(3);
    const before=await Promise.all(pages.map(status));expect(new Set(before.map(s=>s.localPilot)).size).toBe(3);
    const otherSlot=before[2].localPilot, movingSlot=before[1].localPilot;
    await a.keyboard.down('d');await expect.poll(async()=> (await status(a)).player.x-before[1].player.x).toBeGreaterThan(5);await a.keyboard.up('d');
    const after=await status(host);const other=after.pilots.find(p=>p.slot===otherSlot);expect(Math.hypot(other.x-before[2].player.x,other.y-before[2].player.y)).toBeLessThan(.5);expect(after.pilots.find(p=>p.slot===movingSlot).x-before[1].player.x).toBeGreaterThan(3);
    await b.keyboard.down('a');await expect.poll(async()=>before[2].player.x-(await status(b)).player.x).toBeGreaterThan(5);await b.keyboard.up('a');
    for(const p of pages)await expect(p.locator('.wingmate-hud')).toHaveCount(2);
  }finally{await Promise.all(contexts.map(c=>c.close()));}
});

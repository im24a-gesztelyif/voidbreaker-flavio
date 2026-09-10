# VOIDBREAKER — The Last Light

A Three.js space roguelite with solo and online two-player cooperative runs. Fly one of three ships, choose one of three weapons, and build your arsenal through a three-sector campaign or an endless expedition. All game text is in English. Existing browser saves remain compatible.

## Run locally

Requires Node.js 22.13 or newer.

```sh
npm install
npm run dev -- --host 0.0.0.0
```

Open the local URL printed by the server. For another device on the same network, use the host computer's LAN address and port instead of `localhost`. A remotely hosted copy should use HTTPS.

## Play together

1. Choose **Online Co-op** and open **Your Ship & Weapon** to select your loadout.
2. The commander chooses **Create Room** and sets the mission rules.
3. Share the eight-character room code or use **Copy Invite**. A localhost invite must be changed to an address the other device can reach.
4. The second pilot enters the code and chooses **Join Room**.
5. When both ships are connected, the commander chooses **Launch Together**.

Both pilots move, shoot, dash, and use EMP independently. Experience, scrap, and score are shared; enemy health scales to the squad. Before launch, the commander chooses campaign/endless, difficulty, shared or individual power-ups, and shared or separate kill displays. Shared modules upgrade both ships; individual modules offer each pilot their own cards and rerolls, and time resumes once both have chosen. The commander buys station supplies, resumes paused runs, and starts rematches. Either pilot can pause. A downed ship returns with at least half hull when the surviving pilot clears a wave. The run ends when both ships are down. Completed runs award progression in each pilot's own browser.

Keep both tabs open. Switching focus between visible co-op windows clears held controls without pausing; hiding a game tab pauses the shared run. The commander resumes it. Brief signaling outages reconnect without stopping an established game. A lost gameplay connection stops the run and offers a return to the hangar, within about 32 seconds for an abruptly closed browser. Guests can leave and rejoin the same lobby before launch. There is no host migration or mid-run reconnection.

## Missions and builds

Press **Launch Solo** to select the mission, difficulty, ship, and weapon, then **Begin Mission**. The main menu stays clear of configuration. Co-op loadouts and owner settings live inside the multiplayer lobby.

- **Campaign:** three sectors, ending with the Chronovore.
- **Endless:** stations continue after every boss, sector numbers keep climbing, and six bosses rotate across successive circuits. Enemy and boss health/damage increase with sector depth; density and projectile speed have bounds. Fully completed builds receive hull recovery instead of empty upgrade screens.
- **Easy / Normal / Hard / Veteran / Ace:** each tier changes enemy health, damage, speed, attack frequency, projectile speed, warning time, population, and score multiplier.
- **New enemies:** Needle Lancer locks a firing lane; Brood Ark releases swarms; Veil Manta fires sweeping crescents; Rift Anchor marks delayed blast zones.
- **New bosses:** Gravemaw pulls pilots toward marked gravity wells; Mirror Regent unleashes four-way crossfire; Chronovore strikes the position you occupied when its warning began. Marked circles show the damaging blast radius.

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Move | WASD / arrow keys | Left joystick |
| Aim | Mouse | Automatically tracks the nearest enemy |
| Fire | Left click; auto-fire enabled by default | Auto-fire |
| Dash | Space | Dash button |
| Null Pulse / EMP | Q, at 100% charge | Null Pulse button |
| Toggle auto-fire | F / weapon HUD | Auto-fire remains enabled by default |
| Pause | Escape / pause button | Pause button |
| Select upgrade | 1 / 2 / 3 or click | Tap a card |

Graphics, sound, volume, and screen shake are adjustable in Settings. Turn off bloom for lower-powered devices. The hangar and dialogs scroll on small screens; gameplay fits the viewport and respects device safe areas.

## Multiplayer implementation

The commander runs one authoritative 60 Hz simulation. The wingmate sends changed movement at up to 20 Hz, immediate one-shot abilities, and a 10 Hz idle keepalive. Snapshots arrive at up to 20 Hz (1 Hz while paused). Reliable binary WebRTC messages use compact entity tuples, integer quantization to 0.01 units, cached metadata, a 32 KB backpressure threshold, and bounded visual prediction for ships, enemies, and projectiles. A reproducible 30-enemy/120-projectile fixture measures approximately 88% less snapshot payload per second than the previous full-state 40 Hz stream; actual traffic varies by scene and excludes transport overhead. Run IDs, input sequence numbers, single-use ability flags, a 400 ms input timeout, and connection heartbeats prevent stale controls and old-run actions.

Connections use [PeerJS](https://peerjs.com/client/api/peer) for public signaling, with explicit STUN servers and configurable TURN relays. PeerJS 1.5.5's bundled TURN hostnames had no DNS address records during the September 2026 investigation; relying on them allowed local tests to pass while remote players failed. A working TURN provider is necessary for players whose networks cannot connect directly. The game fetches ICE configuration from `/api/ice` before connecting, and shows a setup notice when a relay is unavailable. Room codes are invite secrets, not an authenticated identity system.

Vercel runs only the credential endpoint; it does not host a persistent game server. The commander owns the simulation, and encrypted WebRTC data travels directly or through the configured TURN service. Provider admin keys stay in the server environment. The endpoint returns only the client credentials needed by WebRTC.

## Checks

```sh
npm test
npm run typecheck
npm run lint:game
npm run build
npm run test:multiplayer
npm run test:multiplayer:relay
```

The unit tests cover simulation, co-op protocol, signaling recovery, failed handshakes, asynchronous ability serialization, and credential handling. Browser tests build the Vercel export and use two isolated Chromium contexts with real PeerJS signaling and WebRTC. They exercise lobby rejoining, launch, both pilots' movement, dash, pause/resume, signaling interruption, and disconnect handling. `test:multiplayer:relay` starts an authenticated TURN fixture bound only to loopback, forces both browsers through it, and asserts the selected ICE candidates are relays. This verifies the relay transport and credential endpoint without requiring paid provider credentials; it does not verify a production provider's availability.

Install the browser once with `npx playwright install chromium`. On Windows, an installed Edge can be used instead: `$env:E2E_BROWSER_CHANNEL = 'msedge'`. Browser tests require internet access to PeerJS signaling. Full-repository `npm run lint` includes existing issues in the supplied UI catalog; `lint:game` checks the game and multiplayer source.

## Hosting

### Vercel

Import this repository into Vercel with the repository root as the Root Directory, then deploy. The committed `vercel.json` sets the framework to **Other**, runs `npm ci` and `npm run build:vercel`, and publishes **`dist/client`**. Do not select the Next.js preset: this project uses Vinext, which has a different build output. These settings are supplied by the repository rather than requiring dashboard overrides.

To reproduce the Vercel build locally:

```sh
npm run build:vercel
```

The build exports the game to `dist/client/index.html`, with JavaScript, styles, fonts, and public assets. Vercel also deploys the root `api/ice.mjs` as a Node function. It does not require a Cloudflare Worker or Sites account. Invite links use the deployed Vercel address.

### Required setup for reliable cross-network multiplayer on Vercel

**You can keep hosting on Vercel Hobby and use a free relay plan.** TURN is the name of the connection-relay protocol, not a paid subscription. Direct multiplayer connections work without a relay; a relay is needed when the players' networks cannot connect directly.

For the free setup, create a [Metered / OpenRelay account](https://www.metered.ca/tools/openrelay/), obtain its TURN credentials URL, and add that URL as `TURN_CREDENTIALS_URL` in your Vercel project's environment variables. Redeploy the game. OpenRelay currently advertises 20 GB of free relay traffic per month; its [free-tier documentation](https://www.metered.ca/tools/openrelay/webrtc-signaling-server/) states that no credit card is required. Stay on the free plan and within its limits. This project already supports that credentials URL; no networking rewrite is needed.

Configure **one** TURN provider in **Vercel → Project → Settings → Environment Variables**, for Production and any Preview environment you intend to test:

| Provider | Server environment variables |
| --- | --- |
| Metered / OpenRelay (free allowance available) | `TURN_CREDENTIALS_URL`: the complete HTTPS credentials URL supplied by your provider, including its API key |
| Cloudflare Realtime TURN (alternative) | `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` from a TURN key |
| Your own TURN server | `TURN_ICE_SERVERS`: JSON array containing `urls`, `username`, and `credential` for limited TURN client credentials |

For Cloudflare, [create a TURN key](https://developers.cloudflare.com/realtime/turn/generate-credentials/); the endpoint generates client credentials valid for two hours. Create a fresh room after a long idle session. For Metered, follow its [OpenRelay setup](https://www.metered.ca/tools/openrelay/). Prefer a provider offering TURN over TLS on port 443 for restricted networks. The service's quota and network availability still apply.

Do **not** prefix admin secrets with `NEXT_PUBLIC_` or `VITE_`, or commit them. `.env.example` documents the fields; for local `npm run dev`, copy it to ignored `.env.local` and fill in your provider. In a public deployment, use provider spending/quota controls and a Vercel Firewall rate-limit rule on `/api/ice`; this intentionally anonymous game's origin checks are not authentication.

Redeploy after configuring the variables. On the deployed site, `/api/ice` should return `relayAvailable: true`; `false` with `issue: "not-configured"` means setup is missing, and `issue: "unavailable"` means the configuration or provider request failed. Without TURN, solo and direct peer connections can still work, but remote multiplayer is not fully configured.

To verify the actual deployment (PowerShell):

```powershell
$env:E2E_BASE_URL = 'https://YOUR-PROJECT.vercel.app'
$env:E2E_BROWSER_CHANNEL = 'msedge' # optional, if Edge is installed
npm run test:multiplayer:relay
```

With `E2E_BASE_URL` set, the test uses that deployment and its real relay provider. It does not start the local TURN fixture or replace the deployment's ICE configuration. No deployed URL or provider credentials were available during the local verification.

After pushing a change, deploy the new commit in Vercel. Redeploying an older commit will reuse its old configuration.

### Sites / Cloudflare

`npm run dev`, `npm run build`, and `npm start` retain the original Sites / Cloudflare workflow outside Vercel. The Vite development server serves `/api/ice` locally. A production host other than Vercel needs to expose the same credential endpoint to use TURN; the static client falls back to direct connections if it is absent. The existing Sites project previously returned `project_not_found` to the connected account. That account-access issue is separate from Vercel deployment.

# VOIDBREAKER — The Last Light

A Three.js space roguelite with solo and online two-player cooperative runs. Fly one of three ships, choose one of three weapons, and build your arsenal across three sectors and bosses. All game text is in English. Existing browser saves remain compatible.

## Run locally

Requires Node.js 22.13 or newer.

```sh
npm install
npm run dev -- --host 0.0.0.0
```

Open the local URL printed by the server. For another device on the same network, use the host computer's LAN address and port instead of `localhost`. A remotely hosted copy should use HTTPS.

## Play together

1. Each pilot selects a ship and weapon in the hangar.
2. Choose **Online Co-op**. The commander chooses **Create Room**.
3. Share the eight-character room code or use **Copy Invite**. A localhost invite must be changed to an address the other device can reach.
4. The second pilot enters the code and chooses **Join Room**.
5. When both ships are connected, the commander chooses **Launch Together**.

Both pilots move, shoot, dash, and use EMP independently. Experience, upgrades, scrap, and score are shared; enemy health scales to the squad. The commander selects shared upgrades, buys station supplies, resumes paused runs, and starts rematches. Either pilot can pause. A downed ship returns with at least half hull when the surviving pilot clears a wave. The run ends when both ships are down. Completed runs award progression in each pilot's own browser.

Keep both tabs open. Losing the connection stops the run and offers a return to the hangar. There is no host migration or mid-run reconnection.

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

The commander runs one authoritative 60 Hz simulation. The wingmate sends validated inputs at up to 30 Hz; snapshots arrive at up to 15 Hz. Reliable binary WebRTC messages support chunking, with snapshot backpressure and visual smoothing. Run IDs, input sequence numbers, single-use ability flags, a 400 ms input timeout, and connection heartbeats prevent stale controls and old-run actions.

Connections use [PeerJS](https://peerjs.com/client/api/peer) and its default public signaling/ICE configuration. There is no application database, account requirement, or custom multiplayer server. The signaling service and a network that permits WebRTC are required. Some restrictive networks may need a separately operated TURN service; cross-network connectivity is not guaranteed. Room codes are invite secrets, not an authenticated identity system.

## Checks

```sh
npm test
npm run typecheck
npm run lint:game
npm run build
```

The tests cover deterministic simulation, firing cadence, independent co-op movement and weapons, damage, revivals, shared progression, stations, all sector bosses, rewards, save recovery, and the two-client message protocol through an in-memory transport. They do not substitute for an end-to-end WebRTC test between physical devices. Full-repository `npm run lint` also includes existing issues in the supplied UI component catalog; `lint:game` checks the game source and co-op UI.

## Hosting

The project retains its existing Vinext / Cloudflare / Sites configuration. The configured Sites project currently returns `project_not_found` to the connected account, so this update has not been published. Restore access to that project before deployment. No replacement project or public deployment was created.

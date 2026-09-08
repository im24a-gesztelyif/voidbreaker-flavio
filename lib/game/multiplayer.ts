import type { Peer, DataConnection } from 'peerjs';
import { loadSave } from './simulation';
import type { GameInput, GameState, SaveData } from './types';

export type RoomStatus =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'connected'
  | 'disconnected'
  | 'error';
export const neutralInput = (): GameInput => ({
  x: 0,
  y: 0,
  aimX: 0,
  aimY: -20,
  firing: false,
  dash: false,
  pulse: false,
});
export function cleanInput(value: unknown): GameInput | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (
    !['x', 'y', 'aimX', 'aimY'].every(
      (k) => typeof v[k] === 'number' && Number.isFinite(v[k]),
    )
  )
    return null;
  const clamp = (n: unknown, max: number) =>
    Math.max(-max, Math.min(max, n as number));
  return {
    x: clamp(v.x, 1),
    y: clamp(v.y, 1),
    aimX: clamp(v.aimX, 150),
    aimY: clamp(v.aimY, 150),
    firing: v.firing === true,
    dash: v.dash === true,
    pulse: v.pulse === true,
  };
}
export function guestView(s: GameState): GameState {
  if (!s.partner) return s;
  return {
    ...s,
    player: s.partner,
    ship: s.partnerShip!,
    weapon: s.partnerWeapon!,
    autoFire: !!s.partnerAutoFire,
    partner: s.player,
    partnerShip: s.ship,
    partnerWeapon: s.weapon,
    partnerAutoFire: s.autoFire,
  };
}
const PREFIX = 'voidbreaker-v2-';
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const normalizeCode = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);

/** One commander owns the simulation. The wingmate can only submit inputs and pause requests. */
export class Multiplayer {
  role: 'host' | 'guest' = 'host';
  status: RoomStatus = 'idle';
  code = '';
  message = '';
  remoteSave: SaveData | null = null;
  run = '';
  latency = 0;
  private peer?: Peer;
  private connection?: DataConnection;
  private timer?: ReturnType<typeof setInterval>;
  private timeout?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private lastSeen = 0;
  private lastInput = 0;
  private sequence = 0;
  private received = -1;
  private input = neutralInput();
  private pending = neutralInput();
  private sentAt = 0;
  private snapshotAt = 0;
  constructor(
    private callbacks: {
      change: () => void;
      snapshot: (state: GameState, newRun: boolean) => void;
      pause: () => void;
      save: () => SaveData;
    },
  ) {}
  private update(status: RoomStatus, message = '') {
    this.status = status;
    this.message = message;
    this.callbacks.change();
  }
  async open(role: 'host' | 'guest', code = '') {
    this.role = role;
    this.code =
      role === 'host'
        ? Array.from(
            crypto.getRandomValues(new Uint8Array(8)),
            (n) => alphabet[n % alphabet.length],
          ).join('')
        : normalizeCode(code);
    if (this.code.length !== 8) {
      this.update('error', 'Enter the eight-character room code.');
      return;
    }
    this.update('connecting');
    try {
      const { Peer } = await import('peerjs');
      if (this.disposed) return;
      this.peer = role === 'host' ? new Peer(PREFIX + this.code) : new Peer();
      this.timeout = setTimeout(
        () =>
          this.fail(
            'Connection timed out. Check the room code and try another network.',
          ),
        25000,
      );
      this.peer.on('open', () => {
        if (role === 'host') {
          clearTimeout(this.timeout);
          this.update('waiting');
        } else
          this.attach(
            this.peer!.connect(PREFIX + this.code, {
              reliable: true,
              serialization: 'binary',
              metadata: { protocol: 2 },
            }),
          );
      });
      this.peer.on('connection', (c) => {
        if (role !== 'host' || this.connection || c.metadata?.protocol !== 2) {
          c.on('open', () => {
            void c.send({
              type: 'reject',
              message: 'This room is full or incompatible.',
            });
            setTimeout(() => c.close(), 200);
          });
          return;
        }
        this.attach(c);
      });
      this.peer.on('error', (e) =>
        this.fail(
          e.type === 'peer-unavailable'
            ? 'Room not found. Ask the commander to create a room and check the code.'
            : e.type === 'unavailable-id'
              ? 'This code is taken. Create a new room.'
              : 'Unable to connect. Check your connection or try a different network.',
        ),
      );
      this.peer.on('disconnected', () => {
        if (!this.disposed && this.peer && !this.peer.destroyed)
          this.peer.reconnect();
      });
    } catch {
      this.fail(
        'Multiplayer could not start. Use a browser with WebRTC support.',
      );
    }
  }
  private attach(c: DataConnection) {
    this.connection = c;
    c.on('open', () => {
      clearTimeout(this.timeout);
      this.lastSeen = Date.now();
      this.send({ type: 'hello', protocol: 2, save: this.callbacks.save() });
      this.timer = setInterval(() => {
        if (Date.now() - this.lastSeen > 12000) {
          this.fail(
            'Your wingmate disconnected. Return to the hangar to regroup.',
          );
          return;
        }
        this.send({ type: 'ping', time: Date.now() });
      }, 2000);
    });
    c.on('data', (data) => this.receive(data));
    c.on('close', () => {
      if (!this.disposed && this.status !== 'error')
        this.fail(
          'Your wingmate left the room. Return to the hangar to regroup.',
        );
    });
    c.on('error', () =>
      this.fail(
        'The connection was interrupted. Return to the hangar and reconnect.',
      ),
    );
  }
  private receive(data: unknown) {
    if (!data || typeof data !== 'object' || this.disposed) return;
    const m = data as {
      type?: string;
      message?: unknown;
      time?: unknown;
      protocol?: number;
      save?: unknown;
      run?: string;
      seq?: number;
      input?: unknown;
      autoFire?: boolean;
      state?: GameState;
    };
    this.lastSeen = Date.now();
    if (m.type === 'reject') {
      this.fail(String(m.message));
      return;
    }
    if (m.type === 'ping') {
      this.send({ type: 'pong', time: m.time });
      return;
    }
    if (m.type === 'pong' && typeof m.time === 'number') {
      this.latency = Math.max(0, Date.now() - m.time);
      return;
    }
    if (m.type === 'hello' && m.protocol === 2) {
      if (this.run) return;
      this.remoteSave = loadSave(JSON.stringify(m.save));
      this.update('connected');
      return;
    }
    if (this.status !== 'connected') return;
    if (this.role === 'host') {
      if (m.run !== this.run || !this.run) return;
      if (
        m.type === 'input' &&
        typeof m.seq === 'number' &&
        Number.isSafeInteger(m.seq) &&
        m.seq > this.received
      ) {
        const next = cleanInput(m.input);
        if (!next) return;
        next.dash ||= this.input.dash;
        next.pulse ||= this.input.pulse;
        this.received = m.seq;
        this.input = next;
        this.lastInput = Date.now();
        if (typeof m.autoFire === 'boolean' && this.remoteSave)
          this.remoteSave.settings.autoFire = m.autoFire;
      }
      if (m.type === 'pause') this.callbacks.pause();
    } else if (
      m.type === 'state' &&
      typeof m.run === 'string' &&
      m.state?.partner &&
      m.state?.player &&
      Array.isArray(m.state.enemies) &&
      m.state.enemies.length <= 100 &&
      Array.isArray(m.state.bullets) &&
      m.state.bullets.length <= 700 &&
      ['playing', 'paused', 'upgrade', 'station', 'victory', 'defeat'].includes(
        m.state.phase,
      ) &&
      m.state.sector >= 0 &&
      m.state.sector < 3
    ) {
      const newRun = this.run !== m.run;
      this.run = m.run;
      this.callbacks.snapshot(guestView(m.state as GameState), newRun);
    }
  }
  send(data: unknown) {
    if (this.connection?.open) {
      try {
        const sent = this.connection.send(data);
        if (sent)
          void sent.catch(() =>
            this.fail(
              'The connection was interrupted. Reconnect from the hangar.',
            ),
          );
      } catch {
        this.fail('The connection was interrupted. Reconnect from the hangar.');
      }
    }
  }
  updateLoadout() {
    if (!this.run)
      this.send({ type: 'hello', protocol: 2, save: this.callbacks.save() });
  }
  begin() {
    this.run = Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
      n.toString(16).padStart(2, '0'),
    ).join('');
    this.received = -1;
    this.input = neutralInput();
    this.lastInput = 0;
  }
  broadcast(state: GameState, force = false) {
    if (this.role !== 'host' || !this.run || this.status !== 'connected')
      return;
    const now = performance.now();
    if (
      !force &&
      (now - this.snapshotAt < 66 ||
        (this.connection?.dataChannel?.bufferedAmount || 0) > 128000)
    )
      return;
    this.snapshotAt = now;
    this.send({ type: 'state', run: this.run, state: structuredClone(state) });
  }
  submit(input: GameInput, autoFire: boolean) {
    this.pending = {
      ...input,
      dash: input.dash || this.pending.dash,
      pulse: input.pulse || this.pending.pulse,
    };
    if (performance.now() - this.sentAt < 33) return;
    this.sentAt = performance.now();
    this.send({
      type: 'input',
      run: this.run,
      seq: ++this.sequence,
      input: this.pending,
      autoFire,
    });
    this.pending.dash = false;
    this.pending.pulse = false;
  }
  consume(): GameInput {
    if (Date.now() - this.lastInput > 400) return neutralInput();
    const result = { ...this.input };
    this.input.dash = false;
    this.input.pulse = false;
    return result;
  }
  requestPause() {
    this.send({ type: 'pause', run: this.run });
  }
  private fail(message: string) {
    if (this.disposed) return;
    clearInterval(this.timer);
    clearTimeout(this.timeout);
    this.input = neutralInput();
    this.update('error', message);
    this.callbacks.pause();
  }
  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    clearTimeout(this.timeout);
    this.connection?.close();
    this.peer?.destroy();
  }
}

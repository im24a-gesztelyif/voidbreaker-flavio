import { SnapshotEncoder } from '../../../lib/game/codec';
import { freshSave } from '../../../lib/game/content';
import { cleanOptions, defaultOptions } from '../../../lib/game/rules';
import { loadSave, Simulation } from '../../../lib/game/simulation';
import type { GameInput, PilotId, RoomOptions, SaveData } from '../../../lib/game/types';

export interface Env {
  ROOM: DurableObjectNamespace;
  /** Optional comma-separated Vercel origins. Leave empty while testing workers.dev. */
  ALLOWED_ORIGINS?: string;
}

type Member = { slot: PilotId; name: string; save: SaveData };
type Attachment = Member;
type ClientMessage =
  | { type: 'join'; name?: unknown; save?: unknown }
  | { type: 'loadout'; name?: unknown; save?: unknown }
  | { type: 'configure'; options?: unknown }
  | { type: 'launch' }
  | { type: 'input'; input?: unknown; autoFire?: unknown }
  | { type: 'pause' | 'resume' | 'hangar' }
  | { type: 'choose'; id?: unknown; draft?: unknown }
  | { type: 'reroll'; draft?: unknown };

const CODE = /^[A-Z0-9]{8}$/;
const MAX_PLAYERS = 4;
const nameOf = (value: unknown, fallback: string) =>
  typeof value === 'string'
    ? value.normalize('NFKC').replace(/[\p{Cc}\p{Cf}<>]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20) || fallback
    : fallback;
const parseSave = (value: unknown) => loadSave(JSON.stringify(value ?? freshSave()));
const isSocket = (request: Request) => request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
const neutralInput = (): GameInput => ({ x: 0, y: 0, aimX: 0, aimY: -20, firing: false, dash: false, pulse: false });
const cleanInput = (value: unknown): GameInput | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (!['x', 'y', 'aimX', 'aimY'].every((key) => typeof source[key] === 'number' && Number.isFinite(source[key]))) return null;
  const clamp = (value: number, max: number) => Math.max(-max, Math.min(max, value));
  return { x: clamp(source.x as number, 1), y: clamp(source.y as number, 1), aimX: clamp(source.aimX as number, 150), aimY: clamp(source.aimY as number, 150), firing: source.firing === true, dash: source.dash === true, pulse: source.pulse === true };
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'voidbreaker-multiplayer' });
    const match = /^\/room\/([A-Za-z0-9]{8})$/.exec(url.pathname);
    if (!match) return new Response('Not found', { status: 404 });
    if (!isSocket(request)) return new Response('Use a WebSocket connection.', { status: 426 });
    const origin = request.headers.get('Origin');
    const allowed = env.ALLOWED_ORIGINS?.split(',').map((item) => item.trim()).filter(Boolean) || [];
    if (allowed.length && (!origin || !allowed.includes(origin))) return new Response('Origin not allowed', { status: 403 });
    const room = env.ROOM.getByName(match[1].toUpperCase());
    return room.fetch(request);
  },
};

/** One object is one private room. It owns slots, simulation and all snapshots. */
export class GameRoom implements DurableObject {
  private readonly ctx: DurableObjectState;
  private members = new Map<WebSocket, Member>();
  private inputs = new Map<PilotId, GameInput>();
  private options: RoomOptions = defaultOptions();
  private simulation?: Simulation;
  private run = '';
  private lastTick = Date.now();
  private sentAt = 0;
  private encoder = new SnapshotEncoder();

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    for (const socket of ctx.getWebSockets()) {
      const member = socket.deserializeAttachment() as Attachment | null;
      if (member?.save && Number.isInteger(member.slot)) this.members.set(socket, member);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > 4096) return this.close(socket, 1003, 'Invalid message');
    let data: ClientMessage;
    try { data = JSON.parse(message) as ClientMessage; } catch { return this.close(socket, 1003, 'Invalid JSON'); }
    const member = this.members.get(socket);
    if (data.type === 'join') return this.join(socket, data);
    if (!member) return this.close(socket, 1008, 'Join a room first');
    if (data.type === 'loadout' && !this.simulation) {
      const updated = { ...member, name: nameOf(data.name, member.name), save: parseSave(data.save) };
      this.members.set(socket, updated); socket.serializeAttachment(updated); return this.broadcastRoster();
    }
    this.tick();
    if (data.type === 'input') {
      const input = cleanInput(data.input);
      if (input) this.inputs.set(member.slot, input);
      return;
    }
    if (data.type === 'configure' && member.slot === 0 && !this.simulation) {
      this.options = cleanOptions(data.options);
      return this.broadcastRoster();
    }
    if (data.type === 'launch' && member.slot === 0) return this.launch();
    if (!this.simulation) return;
    if (data.type === 'pause') { this.simulation.pause(); return this.snapshot(true); }
    if (data.type === 'resume' && member.slot === 0) { this.simulation.resume(); return this.snapshot(true); }
    if (data.type === 'hangar' && member.slot === 0) { this.simulation = undefined; this.run = ''; return this.broadcastRoster(); }
    if (data.type === 'choose' && typeof data.id === 'string' && Number.isInteger(data.draft)) {
      this.simulation.chooseUpgrade(data.id as never, member.slot, data.draft as number);
      return this.snapshot(true);
    }
    if (data.type === 'reroll' && Number.isInteger(data.draft)) {
      this.simulation.reroll(member.slot, data.draft as number);
      return this.snapshot(true);
    }
  }

  webSocketClose(socket: WebSocket, code: number, reason: string, wasClean: boolean) {
    this.members.delete(socket);
    if (this.simulation) {
      this.simulation = undefined;
      this.run = '';
    }
    this.broadcastRoster();
    socket.close(code, reason);
  }

  private join(socket: WebSocket, data: Extract<ClientMessage, { type: 'join' }>) {
    if (this.members.has(socket)) return;
    if (this.simulation || this.members.size >= MAX_PLAYERS) return this.close(socket, 1008, 'Room is full or already flying');
    const used = new Set([...this.members.values()].map((member) => member.slot));
    const slot = ([0, 1, 2, 3] as PilotId[]).find((candidate) => !used.has(candidate));
    if (slot === undefined) return this.close(socket, 1008, 'Room is full');
    const member = { slot, name: nameOf(data.name, slot === 0 ? 'Commander' : `Pilot ${slot + 1}`), save: parseSave(data.save) };
    this.members.set(socket, member);
    socket.serializeAttachment(member);
    this.inputs.set(slot, neutralInput());
    this.broadcastRoster();
  }

  private launch() {
    const ordered = [...this.members.values()].sort((a, b) => a.slot - b.slot);
    if (ordered.length < 2 || ordered[0]?.slot !== 0) return;
    const commander = ordered[0];
    this.simulation = new Simulation(commander.save.ship, commander.save.weapon, commander.save, Date.now(), this.options.difficulty, this.options);
    for (const member of ordered.slice(1)) this.simulation.addPilot(member.slot, member.save.ship, member.save.weapon, member.save);
    this.simulation.state.pilotNames = Object.fromEntries(ordered.map((member) => [member.slot, member.name]));
    this.simulation.start();
    this.run = crypto.randomUUID().replace(/-/g, '');
    this.lastTick = Date.now();
    this.encoder.reset();
    this.snapshot(true);
  }

  private tick() {
    if (!this.simulation || this.simulation.state.phase !== 'playing') return;
    const now = Date.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    if (!dt) return;
    this.simulation.step(dt, this.inputs.get(0) || neutralInput(), this.inputs.get(1) || neutralInput(), { 2: this.inputs.get(2), 3: this.inputs.get(3) });
    if (now - this.sentAt >= 50) this.snapshot(false);
  }

  private snapshot(force: boolean) {
    if (!this.simulation) return;
    this.sentAt = Date.now();
    const frame = this.encoder.encode(this.simulation.state, force);
    this.broadcast({ type: 'state', run: this.run, frame });
  }

  private broadcastRoster() {
    const members = [...this.members.values()].sort((a, b) => a.slot - b.slot);
    for (const [socket, member] of this.members) {
      try { socket.send(JSON.stringify({ type: 'roster', slot: member.slot, members, options: this.options, flying: !!this.simulation })); } catch { this.members.delete(socket); }
    }
  }

  private broadcast(data: unknown) {
    const payload = JSON.stringify(data);
    for (const socket of this.members.keys()) {
      try { socket.send(payload); } catch { this.members.delete(socket); }
    }
  }

  private close(socket: WebSocket, code: number, reason: string) { socket.close(code, reason); }
}

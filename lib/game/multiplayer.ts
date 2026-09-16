import { squad } from './squad';
import type { Peer, DataConnection } from 'peerjs';
import { SnapshotEncoder, SnapshotDecoder } from './codec';
import { cleanOptions, defaultOptions } from './rules';
import { loadSave } from './simulation';
import type { GameInput, GameState, SaveData, RoomOptions, UpgradeId, PilotId } from './types';
import {
  STUN_SERVERS,
  normalizeIceServers,
  hasRelay,
} from '../network/ice.mjs';

export type RoomStatus =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'connected'
  | 'disconnected'
  | 'error';
export const MAX_PARTY_PLAYERS = 4;
export const ROOM_PROTOCOL = 6;
export const cleanPilotName = (value: unknown) => typeof value === 'string' ? value.normalize('NFKC').replace(/[\p{Cc}\p{Cf}<>]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20) : '';
export function savedPilotName() { try { return cleanPilotName(localStorage.getItem('voidbreaker-pilot-name')); } catch { return ''; } }
export function storePilotName(name: string) { try { localStorage.setItem('voidbreaker-pilot-name', cleanPilotName(name)); } catch {} }

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
export function guestView(s: GameState, slot: PilotId = 1): GameState {
  const crew=squad(s), local=crew.find(p=>p.slot===slot), host=crew.find(p=>p.slot===0);
  if (!local || !host || slot===0) return s;
  return {...s,localPilot:slot,player:local.player,ship:local.ship,weapon:local.weapon,autoFire:local.autoFire,
    upgrades:s.sharedUpgrades?s.upgrades:local.upgrades,choices:s.sharedUpgrades?[]:local.choices,rerolls:s.sharedUpgrades?0:local.rerolls,
    partner:host.player,partnerShip:host.ship,partnerWeapon:host.weapon,partnerAutoFire:host.autoFire,
    partnerUpgrades:host.upgrades,partnerChoices:host.choices,partnerRerolls:host.rerolls,
    extraPilots:crew.filter(p=>p.slot!==slot&&p.slot!==0).map(p=>({...p}))};
}
interface Link {
  slot: PilotId; name: string; save: SaveData | null; input: GameInput; received: number; lastInput: number; lastSeen: number;
  latency: number; encoder: SnapshotEncoder; timer?: ReturnType<typeof setInterval>; timeout?: ReturnType<typeof setTimeout>;
}
export interface RoomMember {slot:PilotId; name?:string; save:SaveData}
const PREFIX = 'voidbreaker-v6-';
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const normalizeCode = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);

/** One commander owns the simulation. Guests submit controls over their own channel-assigned pilot slot. */
export class Multiplayer {
  role: 'host' | 'guest' = 'host';
  status: RoomStatus = 'idle';
  code = '';
  message = '';
  remoteSave: SaveData | null = null;
  partySize = 1;
  slot: PilotId = 1;
  members: RoomMember[] = [];
  name = savedPilotName();
  setName(value: string) {
    if (this.run) return;
    this.name = cleanPilotName(value); storePilotName(this.name); this.updateLoadout(); this.callbacks.change();
  }

  private links = new Map<DataConnection,Link>();
  get canLaunch() {return this.status==='connected' && this.links.size>0 && [...this.links.values()].every(l=>!!l.save);}
  get remotes() {return this.members.filter(m=>m.slot!==0);}
  run = '';
  latency = 0;
  relayAvailable = false;
  networkNotice = '';
  options: RoomOptions = defaultOptions();
  private encoder = new SnapshotEncoder();
  private decoder = new SnapshotDecoder();
  private lastSentInput = '';
  private peer?: Peer;
  private connection?: DataConnection;
  private connections = new Set<DataConnection>();
  private timer?: ReturnType<typeof setInterval>;
  private timeout?: ReturnType<typeof setTimeout>;
  private handshakeTimeout?: ReturnType<typeof setTimeout>;
  private reconnectTimeout?: ReturnType<typeof setTimeout>;
  private reconnectDelay = 1000;
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
      hangar?: () => void;
      choose?: (id: UpgradeId | null, draft: number, pilot: PilotId) => void;
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
      const [{ Peer }, config] = await Promise.all([
        import('peerjs'),
        this.iceConfig(),
      ]);
      if (this.disposed) return;
      this.connectPeer(
        role === 'host'
          ? new Peer(PREFIX + this.code, { config })
          : new Peer({ config }),
      );
    } catch {
      this.fail(
        'Multiplayer could not start. Use a browser with WebRTC support.',
      );
    }
  }
  private async iceConfig(): Promise<RTCConfiguration> {
    let iceServers: RTCIceServer[] = STUN_SERVERS;
    try {
      const response = await fetch('/api/ice', {
        cache: 'no-store',
        signal: AbortSignal.timeout(9000),
      });
      if (response.ok) {
        const body = (await response.json()) as { iceServers?: unknown };
        const configured = normalizeIceServers(body.iceServers);
        if (configured.length) iceServers = configured;
      }
    } catch {
      /* Static hosts can still make direct connections. */
    }
    this.relayAvailable = hasRelay(iceServers);
    this.networkNotice = this.relayAvailable
      ? ''
      : 'This deployment has no available connection relay. Some networks cannot join until the site owner completes the multiplayer setup in the README.';
    return { iceServers };
  }
  private connectPeer(peer: Peer) {
    this.peer = peer;
    this.timeout = setTimeout(
      () =>
        this.fail(
          'Connection timed out. Check the room code and try another network.',
        ),
      25000,
    );
    peer.on('open', () => {
      if (this.disposed || this.status === 'error') return;
      clearTimeout(this.timeout);
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
      this.reconnectDelay = 1000;
      // Signaling can reconnect while the independent WebRTC channel lives on.
      // Never replace that channel or reset an already connected room.
      if (this.connection) return;
      if (this.role === 'host') {
        this.syncRoster();
      } else {
        try {
          this.attach(
            peer.connect(PREFIX + this.code, {
              reliable: true,
              serialization: 'binary',
              metadata: { protocol: ROOM_PROTOCOL },
            }),
          );
        } catch {
          this.fail(
            'The room connection could not start. Ask the site owner to check the relay configuration.',
          );
        }
      }
    });
    peer.on('connection', (c) => {
      if (this.disposed || this.status === 'error') {
        c.close();
        return;
      }
      if (
        this.role !== 'host' ||
        this.connections.size >= MAX_PARTY_PLAYERS - 1 ||
        this.run ||
        c.metadata?.protocol !== ROOM_PROTOCOL
      ) {
        const cleanup = setTimeout(() => c.close(), 20000);
        c.on('error', () => {
          clearTimeout(cleanup);
          c.close();
        });
        c.on('close', () => clearTimeout(cleanup));
        c.on('open', () => {
          Promise.resolve(
            c.send({
              type: 'reject',
              message: 'This room is full or incompatible.',
            }),
          ).catch(() => c.close());
          setTimeout(() => c.close(), 200);
        });
        return;
      }
      this.attach(c);
    });
    peer.on('error', (e) => {
      if (['network', 'socket-error', 'socket-closed'].includes(e.type)) {
        this.reconnect();
        return;
      }
      // PeerJS reports negotiation errors on the peer as well as the channel.
      if (e.type === 'webrtc' && this.connection) {
        // Individual channel errors are handled by their own connection listeners.
        return;
      }
      this.fail(
        e.type === 'peer-unavailable'
          ? 'Room not found. Ask the commander to create a room and check the code.'
          : e.type === 'unavailable-id'
            ? 'This code is taken. Create a new room.'
            : 'Unable to connect. Check your connection or try a different network.',
      );
    });
    peer.on('disconnected', () => this.reconnect());
  }
  private reconnect() {
    if (this.disposed || this.status === 'error' || this.reconnectTimeout)
      return;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = undefined;
      if (this.peer?.disconnected && !this.peer.destroyed) {
        try {
          this.peer.reconnect();
        } catch {
          /* Retry while data channels stay alive. */
        }
        this.reconnectDelay = Math.min(10000, this.reconnectDelay * 2);
        this.reconnect();
      }
    }, this.reconnectDelay);
  }
  private sendTo(c: DataConnection, data: unknown) {
    if (!c.open) return;
    try { const result=c.send(data); if(result) void result.catch(()=>this.connectionFailed(c)); }
    catch {this.connectionFailed(c);}
  }
  private syncRoster() {
    if (this.role!=='host' || this.run) return;
    const ready=[...this.links.values()].filter(l=>l.save);
    const pending=[...this.links.values()].filter(l=>!l.save);
    [...ready,...pending].forEach((l,i)=>{l.slot=(i+1) as PilotId;});
    this.members=[{slot:0,name:this.name || 'Commander',save:this.callbacks.save()},...ready.map(l=>({slot:l.slot,name:l.name || `Pilot ${l.slot+1}`,save:l.save!}))];
    this.partySize=this.members.length;
    this.remoteSave=ready[0]?.save || null;
    for(const [c,l] of this.links) if(l.save) this.sendTo(c,{type:'roster',slot:l.slot,members:this.members,options:this.options});
    this.update(ready.length?'connected':'waiting');
  }
  private attach(c: DataConnection) {
    const link:Link={slot:([...this.links.keys()].length+1) as PilotId,name:'',save:null,input:neutralInput(),received:-1,lastInput:0,lastSeen:Date.now(),latency:0,encoder:new SnapshotEncoder()};
    this.links.set(c,link);this.connections.add(c);
    if(!this.connection)this.connection=c;
    link.timeout=setTimeout(()=>this.connectionFailed(c),20000);
    c.on('open',()=>{
      if(!this.links.has(c)||this.disposed)return;
      link.lastSeen=Date.now();
      this.sendTo(c,{type:'hello',protocol:ROOM_PROTOCOL,name:this.name,save:this.callbacks.save(),...(this.role==='host'?{options:this.options,slot:link.slot}:{})});
      if(!this.links.has(c))return;
      link.timer=setInterval(()=>{
        if(Date.now()-link.lastSeen>30000){this.connectionFailed(c);return;}
        this.sendTo(c,{type:'ping',time:Date.now()});
      },2000);
    });
    c.on('data',data=>{if(this.links.has(c))this.receive(data,c);});
    c.on('close',()=>this.connectionFailed(c));c.on('error',()=>this.connectionFailed(c));
    this.callbacks.change();
  }
  private connectionFailed(c: DataConnection) {
    const link=this.links.get(c);
    if(this.disposed||!link||this.status==='error')return;
    clearInterval(link.timer);clearTimeout(link.timeout);
    this.links.delete(c);this.connections.delete(c);
    if(this.connection===c)this.connection=this.connections.values().next().value;
    c.close();
    if(this.role==='host'&&!this.run){this.syncRoster();return;}
    const message='A pilot disconnected. Regroup in the hangar to start a new squad run.';
    if(this.role==='host')this.send({type:'reject',message});
    this.fail(message);
  }
  private releaseConnection() {
    clearInterval(this.timer);clearTimeout(this.handshakeTimeout);
    for(const link of this.links.values()){clearInterval(link.timer);clearTimeout(link.timeout);}
    this.links.clear();
    const all=this.connections.size?[...this.connections]:this.connection?[this.connection]:[];
    this.connection=undefined;this.connections.clear();this.members=[];this.partySize=1;
    all.forEach(c=>c.close());
  }
  private receive(data: unknown, source?: DataConnection) {
    if (!data || typeof data !== 'object' || this.disposed) return;
    const m = data as {
      slot?: PilotId;
      name?: unknown;
      members?: RoomMember[];
      type?: string;
      message?: unknown;
      time?: unknown;
      protocol?: number;
      save?: unknown;
      run?: string;
      seq?: number;
      input?: unknown;
      autoFire?: boolean;
      frame?: unknown;
      options?: unknown;
      id?: UpgradeId;
      draft?: number;
    };
    const link=source?this.links.get(source):undefined;
    if(link)link.lastSeen=Date.now();
    this.lastSeen = Date.now();
    if (m.type === 'reject') {
      this.fail(String(m.message));
      return;
    }
    if (m.type === 'ping') {
      if(source)this.sendTo(source,{type:'pong',time:m.time});else this.send({type:'pong',time:m.time});
      return;
    }
    if (m.type === 'pong' && typeof m.time === 'number') {
      this.latency = Math.max(0, Date.now() - m.time);
      if(link)link.latency=this.latency;
      return;
    }
    if (m.type === 'hangar' && this.status==='connected' && m.run===this.run) {
      if(this.role==='host')this.returnToHangar();
      else {this.clearRun();this.callbacks.hangar?.();}
      return;
    }
    if (m.type==='hello' && m.protocol===ROOM_PROTOCOL) {
      if(this.run)return;
      if(link){clearTimeout(link.timeout);link.save=loadSave(JSON.stringify(m.save));link.name=cleanPilotName(m.name);}
      this.remoteSave=loadSave(JSON.stringify(m.save));
      if(this.role==='host'&&link)this.syncRoster();
      else {if(this.role==='guest'){this.options=cleanOptions(m.options);}this.update('connected');}
      return;
    }
    if(m.type==='roster' && this.role==='guest' && !this.run && Array.isArray(m.members) && m.members.length>=2 && m.members.length<=4 && [1,2,3].includes(m.slot!)) {
      if(!m.members.every(x=>[0,1,2,3].includes(x.slot))||new Set(m.members.map(x=>x.slot)).size!==m.members.length)return;
      this.slot=m.slot!;this.members=m.members.map(x=>({slot:x.slot,name:cleanPilotName(x.name) || `Pilot ${x.slot+1}`,save:loadSave(JSON.stringify(x.save))}));
      this.partySize=this.members.length;this.options=cleanOptions(m.options);this.update('connected');return;
    }
    if (m.type === 'options' && this.role === 'guest' && !this.run) {
      this.options = cleanOptions(m.options); this.callbacks.change(); return;
    }
    if (this.status !== 'connected') return;
    if (this.role === 'host') {
      if (m.run !== this.run || !this.run) return;
      if (
        m.type === 'input' &&
        typeof m.seq === 'number' &&
        Number.isSafeInteger(m.seq) &&
        m.seq > (link?.received ?? this.received)
      ) {
        const next = cleanInput(m.input);
        if (!next) return;
        next.dash ||= (link?.input ?? this.input).dash;
        next.pulse ||= (link?.input ?? this.input).pulse;
        if(link){link.received=m.seq;link.input=next;link.lastInput=Date.now();if(typeof m.autoFire==='boolean'&&link.save)link.save.settings.autoFire=m.autoFire;}
        this.received = m.seq;
        this.input = next;
        this.lastInput = Date.now();
        if (!link && typeof m.autoFire === 'boolean' && this.remoteSave)
          this.remoteSave.settings.autoFire = m.autoFire;
      }
      if ((m.type === 'choose' || m.type === 'reroll') && !this.options.sharedUpgrades && Number.isSafeInteger(m.draft)) {
        this.callbacks.choose?.(m.type === 'reroll' ? null : m.id!, m.draft!, link?.slot ?? 1);
      }
      if (m.type === 'pause') this.callbacks.pause();
    } else if (m.type === 'state' && typeof m.run === 'string' && m.run.length === 32) {
      // Identity comes from this channel's authoritative snapshot, never a default guest slot.
      if (![1,2,3].includes(m.slot!)) return;
      const newRun = this.run !== m.run;
      if (newRun) this.decoder.reset();
      const state = this.decoder.decode(m.frame);
      if (!state) return;
      if (!squad(state).some(p=>p.slot===m.slot)) { this.fail('Your ship is missing from this run. Refresh all pilots and create a new room.'); return; }
      this.slot=m.slot!;
      this.run = m.run;
      this.callbacks.snapshot(guestView(state,this.slot), newRun);
    }
  }
  send(data: unknown) {
    const all=this.connections.size?[...this.connections]:this.connection?[this.connection]:[];
    for(const c of all)this.sendTo(c,data);
  }
  updateLoadout() {
    if(this.run)return;
    if(this.role==='host' && (this.links.size || !this.connection))this.syncRoster();
    else this.send({type:'hello',protocol:ROOM_PROTOCOL,name:this.name,save:this.callbacks.save(),...(this.role==='host'?{options:this.options}:{})});
  }
  configure(options: Partial<RoomOptions>) {
    if (this.role !== 'host' || this.run) return;
    this.options = cleanOptions({...this.options, ...options});
    this.send({type: 'options', options: this.options});
    this.callbacks.change();
  }
  choose(id: UpgradeId | null, draft: number) {
    this.send({type: id === null ? 'reroll' : 'choose', id, draft, run: this.run});
  }
  begin() {
    this.clearRun();
    this.encoder.reset();
    for(const link of this.links.values()){link.encoder.reset();link.input=neutralInput();link.received=-1;link.lastInput=0;}
    this.snapshotAt = 0;
    this.run = Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
      n.toString(16).padStart(2, '0'),
    ).join('');
    this.received = -1;
    this.input = neutralInput();
    this.lastInput = 0;
  }
  private clearRun() {
    this.run = '';
    this.encoder.reset();
    this.snapshotAt = 0;
    this.received = -1;
    this.input = neutralInput();
    this.pending = neutralInput();
    this.lastInput = 0;
  }
  returnToHangar() {
    if (this.status !== 'connected')return;
    this.send({type:'hangar',run:this.run});
    if(this.role==='host'){this.clearRun();this.callbacks.hangar?.();this.syncRoster();}
  }
  broadcast(state: GameState, force = false) {
    if (this.role !== 'host' || !this.run || this.status !== 'connected')
      return;
    const now = performance.now();
    if (!force && now-this.snapshotAt < (state.phase==='playing'?50:1000))return;
    this.snapshotAt=now;
    if(!this.links.size){this.send({type:'state',slot:1,run:this.run,frame:this.encoder.encode(state,force)});return;}
    for(const [c,link] of this.links){
      if(!link.save||!c.open)continue;
      if(!force&&(c.dataChannel?.bufferedAmount||0)>32000)continue;
      this.sendTo(c,{type:'state',slot:link.slot,run:this.run,frame:link.encoder.encode(state,force)});
    }
  }
  submit(input: GameInput, autoFire: boolean) {
    this.pending = {
      ...input,
      dash: input.dash || this.pending.dash,
      pulse: input.pulse || this.pending.pulse,
    };
    const signature = JSON.stringify([Math.round(input.x*100),Math.round(input.y*100),Math.round(input.aimX*10),Math.round(input.aimY*10),input.firing,autoFire]);
    if (!this.pending.dash && !this.pending.pulse && performance.now() - this.sentAt < (signature === this.lastSentInput ? 100 : 50)) return;
    this.lastSentInput = signature;
    this.sentAt = performance.now();
    this.send({
      type: 'input',
      run: this.run,
      seq: ++this.sequence,
      input: { ...this.pending },
      autoFire,
    });
    this.pending.dash = false;
    this.pending.pulse = false;
  }
  consume(slot: PilotId = 1): GameInput {
    const link=[...this.links.values()].find(l=>l.slot===slot);
    if(link){
      if(Date.now()-link.lastInput>400)return neutralInput();
      const result={...link.input};link.input.dash=false;link.input.pulse=false;return result;
    }
    if(this.links.size || slot!==1)return neutralInput();
    if (Date.now() - this.lastInput > 400) return neutralInput();
    const result = { ...this.input };
    this.input.dash = false;
    this.input.pulse = false;
    return result;
  }
  requestPause() {
    this.send({ type: 'pause', run: this.run });
  }
  releaseInput() {
    this.pending = neutralInput();
    if (this.role === 'guest' && this.run && this.status === 'connected')
      this.send({
        type: 'input',
        run: this.run,
        seq: ++this.sequence,
        input: neutralInput(),
      });
  }
  private fail(message: string) {
    if (this.disposed || this.status === 'error') return;
    clearTimeout(this.timeout);
    clearTimeout(this.reconnectTimeout);
    this.releaseConnection();
    this.input = neutralInput();
    this.update('error', message);
    this.peer?.destroy();
    this.callbacks.pause();
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timeout);
    clearTimeout(this.reconnectTimeout);
    this.releaseConnection();
    this.peer?.destroy();
  }
}

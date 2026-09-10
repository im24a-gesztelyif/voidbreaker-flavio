'use client';
/* oxlint-disable react/react-compiler -- The imperative 60Hz engine is held in refs; a throttled tick explicitly refreshes the HUD. */
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Crosshair,
  Volume2,
  VolumeX,
  Maximize,
  ChevronRight,
  Shield,
  Zap,
  Heart,
  Rocket,
  Orbit,
  Gem,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Trophy,
  X,
  Radio,
  Flame,
  Snowflake,
  Wind,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  SHIPS,
  WEAPONS,
  SECTORS,
  UPGRADES,
  ACHIEVEMENTS,
  freshSave,
} from '@/lib/game/content';
import { ShipPreview } from '@/components/ship-preview';
import { CoopLobby } from '@/components/coop-lobby';
import { Multiplayer } from '@/lib/game/multiplayer';
import { Simulation, loadSave } from '@/lib/game/simulation';
import { GameAudio } from '@/lib/game/audio';
import type { SpaceRenderer } from '@/lib/game/renderer';
import { DIFFICULTIES, BOSS_VARIANTS, sectorNumber } from '@/lib/game/rules';
import type { ShipId, GameInput, SaveData, Difficulty, GameMode, UpgradeId } from '@/lib/game/types';
const SAVE_KEY = 'voidbreaker-save-v1';
const clock = (s: number) =>
  `${Math.floor(s / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(s % 60)
    .toString()
    .padStart(2, '0')}`;
const icons: Record<string, typeof Zap> = {
  flame: Flame,
  zap: Zap,
  heart: Heart,
  shield: Shield,
  rocket: Rocket,
  orbit: Orbit,
  gem: Gem,
  radio: Radio,
  snow: Snowflake,
  wind: Wind,
  crosshair: Crosshair,
};
export default function Home() {
  const host = useRef<HTMLDivElement>(null),
    sim = useRef(new Simulation()),
    renderer = useRef<SpaceRenderer | null>(null),
    audio = useRef<GameAudio | null>(null),
    saveRef = useRef(freshSave());
  const keys = useRef(new Set<string>()),
    mouse = useRef({ x: 0, y: 0, down: false, moved: false }),
    touch = useRef({ x: 0, y: 0, active: false }),
    actions = useRef({ dash: false, pulse: false });
  const [, tick] = useState(0);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [panel, setPanel] = useState<'settings' | 'archive' | 'multiplayer' | 'mission' | null>(
      null,
    ),
    [difficulty, setDifficulty] = useState<Difficulty>('normal'),
    [mode, setMode] = useState<GameMode>('campaign');
  const [result, setResult] = useState({
    earned: 0,
    achievements: [] as string[],
  });
  const room = useRef<Multiplayer | null>(null);
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const [inviteCode, setInviteCode] = useState('');
  const isGuest = room.current?.role === 'guest' && !!room.current.run;
  const pauseGame = () => {
    if (room.current?.role === 'guest') room.current.requestPause();
    else {
      sim.current.pause();
      room.current?.broadcast(sim.current.state, true);
    }
    refresh();
  };
  const toggleFire = () => {
    const autoFire = !saveRef.current.settings.autoFire;
    changeSettings({ autoFire });
    sim.current.state.autoFire = autoFire;
    refresh();
  };
  const leaveRoom = () => {
    room.current?.dispose();
    room.current = null;
    refresh();
  };
  const connectRoom = (role: 'host' | 'guest', code?: string) => {
    leaveRoom();
    const connection = new Multiplayer({
      change: refresh,
      choose: (id, draft) => {
        if (id === null) sim.current.reroll(1, draft);
        else sim.current.chooseUpgrade(id, 1, draft);
        room.current?.broadcast(sim.current.state, true);
        refresh();
      },
      save: () => saveRef.current,
      pause: () => {
        sim.current.pause();
        room.current?.broadcast(sim.current.state, true);
        refresh();
      },
      snapshot: (state, newRun) => {
        if (newRun) {
          sim.current = new Simulation();
          setResult({ earned: 0, achievements: [] });
          setPanel(null);
          keys.current.clear();
          void audio.current?.unlock();
        }
        sim.current.state = state;
      },
    });
    if (role === 'host') connection.configure({mode, difficulty});
    room.current = connection;
    void connection.open(role, code);
  };
  const refresh = () => tick((x) => x + 1);
  const persist = (data: SaveData) => {
    saveRef.current = data;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {}
    refresh();
  };
  const changeSettings = (patch: Partial<SaveData['settings']>) => {
    const data = {
      ...saveRef.current,
      settings: { ...saveRef.current.settings, ...patch },
    };
    persist(data);
    audio.current?.setMuted(data.settings.muted);
    audio.current?.setVolume(data.settings.volume);
    if (patch.quality) renderer.current?.setQuality(patch.quality);
  };
  const chooseModule = (id: UpgradeId | null) => {
    const s = sim.current.state;
    if (room.current?.role === 'guest') room.current.choose(id, s.draftId);
    else { if (id === null) sim.current.reroll(); else sim.current.chooseUpgrade(id); room.current?.broadcast(s, true); }
    refresh();
  };
  const start = () => {
    sim.current = new Simulation(
      saveRef.current.ship,
      saveRef.current.weapon,
      saveRef.current,
      Date.now(),
      difficulty,
      room.current?.options || {mode, difficulty},
    );
    if (room.current?.role === 'guest') return;
    if (room.current?.status === 'connected' && room.current.remoteSave) {
      const remote = room.current.remoteSave;
      sim.current.addPartner(remote.ship, remote.weapon, remote);
      room.current.begin();
    }
    sim.current.start();
    room.current?.broadcast(sim.current.state, true);
    keys.current.clear();
    mouse.current.down = false;
    touch.current = { x: 0, y: 0, active: false };
    setPanel(null);
    setResult({ earned: 0, achievements: [] });
    void audio.current?.unlock();
    audio.current?.setScene('combat');
    refresh();
  };
  const hangar = () => {
    leaveRoom();
    sim.current = new Simulation(
      saveRef.current.ship,
      saveRef.current.weapon,
      saveRef.current,
    );
    setPanel(null);
    keys.current.clear();
    audio.current?.setScene('menu');
    refresh();
  };
  useEffect(() => {
    const code = new URL(location.href).searchParams.get('room');
    if (code) {
      setInviteCode(code);
      setPanel('multiplayer');
    }
    let stopped = false,
      frame = 0;
    try {
      saveRef.current = loadSave(localStorage.getItem(SAVE_KEY));
    } catch {}
    sim.current = new Simulation(
      saveRef.current.ship,
      saveRef.current.weapon,
      saveRef.current,
    );
    const sound = new GameAudio();
    audio.current = sound;
    sound.setVolume(saveRef.current.settings.volume);
    sound.setMuted(saveRef.current.settings.muted);
    import('@/lib/game/renderer')
      .then(({ SpaceRenderer }) => {
        if (stopped || !host.current) return;
        try {
          renderer.current = new SpaceRenderer(
            host.current,
            saveRef.current.settings.quality,
          );
          setReady(true);
        } catch (e) {
          setError(
            'Unable to start WebGL. Enable hardware acceleration in your browser, then reload.',
          );
          console.error(e);
        }
      })
      .catch(() =>
        setError('Unable to load the game graphics. Please reload the page.'),
      );
    const keydown = (e: KeyboardEvent) => {
      if (
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(
          (e.target as HTMLElement)?.tagName,
        )
      )
        return;
      if (
        [
          'Space',
          'Enter',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
        ].includes(e.code) &&
        (e.target as HTMLElement)?.closest('button,[role=slider],[role=tab]')
      )
        return;
      if (
        ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(
          e.code,
        )
      )
        e.preventDefault();
      keys.current.add(e.code);
      if (e.repeat) return;
      if (e.code === 'Escape') {
        if (panelRef.current) {
          setPanel(null);
          return;
        }
        if (sim.current.state.phase === 'playing') pauseGame();
        else if (
          sim.current.state.phase === 'paused' &&
          room.current?.role !== 'guest'
        ) {
          sim.current.resume();
          room.current?.broadcast(sim.current.state, true);
        }
        refresh();
        return;
      }
      if (panelRef.current) return;
      if (e.code === 'Space') actions.current.dash = true;
      if (e.code === 'KeyQ') actions.current.pulse = true;
      if (e.code === 'KeyF') toggleFire();
      if (
        (room.current?.role !== 'guest' || !sim.current.state.sharedUpgrades) &&
        sim.current.state.phase === 'upgrade' &&
        ['Digit1', 'Digit2', 'Digit3'].includes(e.code)
      ) {
        const c = sim.current.state.choices[Number(e.code.slice(-1)) - 1];
        if (c) chooseModule(c.id);
        refresh();
      }
    };
    const keyup = (e: KeyboardEvent) => keys.current.delete(e.code);
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      mouse.current = {
        ...mouse.current,
        x: e.clientX,
        y: e.clientY,
        moved: true,
      };
    };
    const down = (e: PointerEvent) => {
      if (
        (e.target as HTMLElement).closest('button,a,[role="slider"],.overlay')
      )
        return;
      if (e.button === 0) mouse.current.down = true;
    };
    const up = () => {
      mouse.current.down = false;
    };
    const blur = () => {
      keys.current.clear();
      mouse.current.down = false;
      touch.current = { x: 0, y: 0, active: false };
      actions.current = { dash: false, pulse: false };
      room.current?.releaseInput();
      // Visible co-op windows can share a screen without pausing each other.
      if (room.current?.status !== 'connected' || document.hidden) pauseGame();
      sound.setScene('quiet');
      refresh();
    };
    const visibility = () => {
      if (document.hidden) blur();
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    let last = performance.now(),
      ui = 0,
      accumulator = 0,
      lastPhase = 'menu';
    const loop = (now: number) => {
      if (stopped) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const g = sim.current,
        s = g.state;
      let aim = { x: s.player.x, y: s.player.y - 20 };
      if (mouse.current.moved && renderer.current)
        aim = renderer.current.aim(mouse.current.x, mouse.current.y);
      const input: GameInput = {
        x:
          touch.current.x +
          (keys.current.has('KeyD') || keys.current.has('ArrowRight') ? 1 : 0) -
          (keys.current.has('KeyA') || keys.current.has('ArrowLeft') ? 1 : 0),
        y:
          touch.current.y +
          (keys.current.has('KeyS') || keys.current.has('ArrowDown') ? 1 : 0) -
          (keys.current.has('KeyW') || keys.current.has('ArrowUp') ? 1 : 0),
        aimX: aim.x,
        aimY: aim.y,
        firing: mouse.current.down || touch.current.active,
        dash: actions.current.dash,
        pulse: actions.current.pulse,
      };
      accumulator += dt;
      if (room.current?.role === 'guest' && room.current.run) {
        room.current.submit(input, saveRef.current.settings.autoFire);
        actions.current = { dash: false, pulse: false };
        accumulator = 0;
      } else {
        while (accumulator >= 1 / 60) {
          if (room.current?.remoteSave)
            s.partnerAutoFire = room.current.remoteSave.settings.autoFire;
          g.step(1 / 60, input, room.current?.consume());
          input.dash = false;
          input.pulse = false;
          actions.current = { dash: false, pulse: false };
          accumulator -= 1 / 60;
        }
        room.current?.broadcast(s, s.phase !== lastPhase);
      }
      for (const event of g.events) sound.play(event.type, event.value);
      g.events = [];
      if (s.phase !== lastPhase) {
        lastPhase = s.phase;
        sound.setScene(
          s.phase === 'playing'
            ? s.wave === 4
              ? 'boss'
              : 'combat'
            : s.phase === 'menu'
              ? 'menu'
              : 'quiet',
        );
        if (s.phase === 'victory' || s.phase === 'defeat') {
          const ended = g.finish(saveRef.current);
          persist(ended.save);
          setResult({ earned: ended.earned, achievements: ended.achievements });
        }
        refresh();
      }
      if (s.phase === 'playing')
        sound.setScene(s.wave === 4 ? 'boss' : 'combat');
      sound.setIntensity(Math.min(1, s.enemies.length / 25 + s.sector * 0.15));
      sound.update(dt);
      renderer.current?.render(
        s,
        dt,
        saveRef.current.settings.shake,
        room.current?.role === 'guest',
      );
      ui += dt;
      if (ui > 0.1) {
        ui = 0;
        refresh();
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (tool: unknown, options: unknown) => unknown;
        };
      }
    ).modelContext;
    const lifecycle = new AbortController();
    if (context?.registerTool) {
      try {
        Promise.resolve(
          context.registerTool(
            {
              name: 'get_voidbreaker_status',
              description: 'Read current game phase, sector, hull and score.',
              inputSchema: {
                type: 'object',
                properties: {},
                additionalProperties: false,
              },
              annotations: { readOnlyHint: true },
              execute: () => ({
                phase: sim.current.state.phase,
                sector: sectorNumber(sim.current.state),
                mode: sim.current.state.mode,
                difficulty: sim.current.state.difficulty,
                sharedUpgrades: sim.current.state.sharedUpgrades,
                sharedKills: sim.current.state.sharedKills,
                hull: sim.current.state.player.hp,
                score: sim.current.score(),
                time: sim.current.state.totalTime,
                player: { x: sim.current.state.player.x, y: sim.current.state.player.y, dashCooldown: sim.current.state.player.dashCooldown },
                partner: sim.current.state.partner ? { x: sim.current.state.partner.x, y: sim.current.state.partner.y } : null,
                multiplayer: room.current ? { role: room.current.role, status: room.current.status, run: room.current.run } : null,
              }),
            },
            { signal: lifecycle.signal },
          ),
        ).catch(() => {});
      } catch {}
    }
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      lifecycle.abort();
      renderer.current?.dispose();
      renderer.current = null;
      sound.dispose();
      room.current?.dispose();
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  const phase = sim.current.state.phase;
  useEffect(() => {
    const overlay = document.querySelector<HTMLElement>('.overlay');
    if (!overlay) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        overlay.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select:not(:disabled),[tabindex="0"]',
        ),
      );
    focusable()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const all = focusable();
      if (!all.length) return;
      const first = all[0],
        last = all[all.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    overlay.addEventListener('keydown', trap);
    return () => {
      overlay.removeEventListener('keydown', trap);
      previous?.focus();
    };
  }, [panel, phase]);
  const s = sim.current.state,
    p = s.player,
    save = saveRef.current,
    ship = save.ship,
    weapon = save.weapon,
    selected = SHIPS.find((x) => x.id === ship)!;
  const menu = s.phase === 'menu';
  const boss = s.enemies.find((e) => e.kind === 'boss');
  const option = (id: ShipId) => {
    persist({ ...save, ship: id });
    sim.current.state.ship = id;
    room.current?.updateLoadout();
    audio.current?.play('click');
  };
  const icon = (name: string, size = 24) => {
    const Icon = icons[name] || Crosshair;
    return <Icon size={size} />;
  };
  const openPanel = (value: 'settings' | 'archive') => {
    pauseGame();
    setPanel(value);
    refresh();
  };
  const joystick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left - r.width / 2) / 35,
      y = (e.clientY - r.top - r.height / 2) / 35;
    touch.current = {
      x: Math.max(-1, Math.min(1, x)),
      y: Math.max(-1, Math.min(1, y)),
      active: true,
    };
  };
  const flightSetup = (
          <section className="flight-setup">
            {panel === 'mission' && <div className="run-config">
              <label>MISSION<select aria-label="Mission mode" value={mode} onChange={e => setMode(e.target.value as GameMode)}><option value="campaign">Campaign · Three sectors</option><option value="endless">Endless · No final jump</option></select></label>
              <label>DIFFICULTY<select aria-label="Difficulty" value={difficulty} onChange={e => setDifficulty(e.target.value as Difficulty)}>{Object.entries(DIFFICULTIES).map(([id,d]) => <option key={id} value={id}>{d.name}</option>)}</select></label>
              <p>{DIFFICULTIES[difficulty].description} {mode === 'endless' && 'Every circuit brings stronger enemies and a new boss rotation.'}</p>
            </div>
            }
            <div className="loadout-head">
              <span>YOUR SHIP</span>
              <span>HANGAR / 03 SHIPS</span>
            </div>
            <Tabs value={ship} onValueChange={(v) => option(v as ShipId)}>
              <TabsList className="ship-list">
                {SHIPS.map((x) => (
                  <TabsTrigger className="ship-card" value={x.id} key={x.id}>
                    <ShipPreview ship={x.id} />
                    <div>
                      <strong>{x.name}</strong>
                      <small>{x.role}</small>
                    </div>
                    <ChevronRight size={16} />
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <p className="ship-summary"><strong>{selected.name}</strong> · {selected.hp} hull · {selected.shield} shield · {selected.passive}</p>
            <div className="hangar-bottom-row">
              <div className="weapon-select">
                {WEAPONS.map((w) => (
                  <button
                    key={w.id}
                    title={w.description}
                    onClick={() => {
                      persist({ ...save, weapon: w.id });
                      room.current?.updateLoadout();
                    }}
                    className={weapon === w.id ? 'selected' : ''}
                  >
                    <Crosshair size={13} />
                    {w.name}
                  </button>
                ))}
              </div>
              <div className="controls-hint">
                <kbd>W A S D</kbd> MOVE <kbd>MOUSE</kbd> AIM <kbd>SPACE</kbd>{' '}
                DASH
              </div>
            </div>
          </section>
  );
  return (
    <main className={`game-shell ${menu ? '' : 'in-game'}`}>
      <div ref={host} className="space-view" />
      <div className="vignette" />
      <header className="topbar">
        <button
          className="brand"
          aria-label="Hangar"
          onClick={() => {
            if (menu) setPanel(null);
            else {
              pauseGame();
            }
          }}
        >
          <Crosshair size={20} />
          <span>
            VB<span className="brand-dot">/</span>
          </span>
        </button>
        <span className="top-label">
          {menu
            ? 'FLIGHT SYSTEM 02.00'
            : `${s.mode === 'endless' ? 'ENDLESS · ' : ''}SECTOR ${sectorNumber(s)} / ${SECTORS[s.sector].name}`}{' '}
          <i /> {menu ? 'SYSTEMS ONLINE' : clock(s.totalTime)}
        </span>
        <div className="top-actions">
          {!menu && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Pause"
              onClick={() => {
                pauseGame();
              }}
            >
              <Pause />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={save.settings.muted ? 'Unmute sound' : 'Mute sound'}
            onClick={() => {
              void audio.current?.unlock();
              changeSettings({ muted: !save.settings.muted });
            }}
          >
            {save.settings.muted ? <VolumeX /> : <Volume2 />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Settings"
            onClick={() => openPanel('settings')}
          >
            <Settings2 />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Fullscreen"
            onClick={() => {
              if (document.fullscreenElement)
                void document.exitFullscreen?.().catch(() => {});
              else
                void document.documentElement
                  .requestFullscreen?.()
                  .catch(() => {});
            }}
          >
            <Maximize />
          </Button>
        </div>
      </header>
      {error && <div className="error-notice">{error}</div>}
      {menu && (
        <>
          <section className="hangar-copy">
            <div className="eyebrow">
              <span /> ONE SIGNAL. ONE LAST CHANCE.
            </div>
            <h1>
              VOID
              <br />
              <span>BREAKER</span>
              <b>®</b>
            </h1>
            <p className="intro">
              The gates have fallen silent.
              <br />
              Carry the last light through the void.
            </p>
            <Button
              className="launch"
              disabled={!ready}
              onClick={() => {
                leaveRoom();
                setPanel('mission');
              }}
            >
              {ready ? 'LAUNCH SOLO' : 'STARTING SYSTEMS…'}{' '}
              <ArrowUpRight size={22} />
            </Button>
            <Button
              className="coop-launch"
              variant="outline"
              disabled={!ready}
              onClick={() => setPanel('multiplayer')}
            >
              <Users size={18} /> ONLINE CO-OP <span>02 PILOTS</span>
            </Button>
            <div className="launch-note">
              {mode === 'endless' ? 'ENDLESS SECTORS' : '3 SECTORS'} <span>·</span> ONE LIFE <span>·</span> YOUR BUILD
            </div>
            <button
              className="archive-link"
              onClick={() => openPanel('archive')}
            >
              <Trophy size={13} /> FLIGHT ARCHIVE{' '}
              <span>{save.shards} CORE SHARDS</span>
            </button>
          </section>
          <div className="ship-caption">
            <span>
              0{SHIPS.findIndex((x) => x.id === ship) + 1} / FLIGHT READY
            </span>
            <h2>{selected.name}</h2>
            <p>{selected.role}</p>
            <div className="caption-line" />
            <div className="ship-spec">
              <span>HULL {selected.hp}</span>
              <span>SHIELD {selected.shield}</span>
            </div>
          </div>
<<<<<<< HEAD

=======
          <section className="hangar-bottom">
            <div className="run-config">
              <label>MISSION<select aria-label="Mission mode" value={mode} onChange={e => setMode(e.target.value as GameMode)}><option value="campaign">Campaign · Three sectors</option><option value="endless">Endless · No final jump</option></select></label>
              <label>DIFFICULTY<select aria-label="Difficulty" value={difficulty} onChange={e => setDifficulty(e.target.value as Difficulty)}>{Object.entries(DIFFICULTIES).map(([id,d]) => <option key={id} value={id}>{d.name}</option>)}</select></label>
              <p>{DIFFICULTIES[difficulty].description} {mode === 'endless' && 'Every circuit brings stronger enemies and a new boss rotation.'}</p>
            </div>
            <div className="loadout-head">
              <span>YOUR SHIP</span>
              <span>HANGAR / 03 SHIPS</span>
            </div>
            <Tabs value={ship} onValueChange={(v) => option(v as ShipId)}>
              <TabsList className="ship-list">
                {SHIPS.map((x, i) => (
                  <TabsTrigger className="ship-card" value={x.id} key={x.id}>
                    <span className="ship-num">0{i + 1}</span>
                    <div>
                      <strong>{x.name}</strong>
                      <small>{x.role}</small>
                    </div>
                    <ChevronRight size={16} />
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="hangar-bottom-row">
              <div className="weapon-select">
                {WEAPONS.map((w) => (
                  <button
                    key={w.id}
                    title={w.description}
                    onClick={() => {
                      persist({ ...save, weapon: w.id });
                      room.current?.updateLoadout();
                    }}
                    className={weapon === w.id ? 'selected' : ''}
                  >
                    <Crosshair size={13} />
                    {w.name}
                  </button>
                ))}
              </div>
              <div className="controls-hint">
                <kbd>W A S D</kbd> MOVE <kbd>MOUSE</kbd> AIM <kbd>SPACE</kbd>{' '}
                DASH
              </div>
            </div>
          </section>
>>>>>>> b8f51e1edfa8d796a1381972caf7d0705a7aa6bc
        </>
      )}
      {!menu && (
        <>
          <div className="pilot-hud">
            <div className="pilot-name">
              {SHIPS.find((x) => x.id === s.ship)?.name}
              <span>LVL {p.level}</span>
            </div>
            <div className="bar-label">
              <Heart size={13} /> HULL{' '}
              <b>
                {Math.ceil(p.hp)} / {p.maxHp}
              </b>
            </div>
            <Progress
              aria-label="Hull"
              className="hull-bar"
              value={(p.hp / p.maxHp) * 100}
            />
            <div className="bar-label shield-label">
              <Shield size={13} /> SHIELD{' '}
              <b>
                {Math.ceil(p.shield)} / {p.maxShield}
              </b>
            </div>
            <Progress
              aria-label="Shield"
              className="shield-bar"
              value={(p.shield / p.maxShield) * 100}
            />
            <div className="hud-resources">
              <Gem size={13} />
              {s.stats.scrap}
              <span>{s.sharedKills ? s.stats.kills : p.kills} {s.partner && s.sharedKills ? 'TEAM KILLS' : 'KILLS'}</span>
            </div>
          </div>
          <div className="wave-hud">
            <span>{s.wave === 4 ? 'SECTOR BOSS' : `WAVE 0${s.wave} / 03`}</span>
            <strong>
              {s.wave === 4
                ? 'DESTROY THE CORE'
                : s.intermission > 0
                  ? 'SALVAGE ACTIVE'
                  : s.waveTime >= s.waveDuration
                    ? `${s.enemies.length} TARGETS REMAINING`
                    : `${Math.max(0, Math.ceil(s.waveDuration - s.waveTime))}s`}
            </strong>
            <small>
              {s.combo >= 3 ? `${s.combo} × KILL COMBO` : 'KEEP MOVING'}
            </small>
          </div>
          {boss && (
            <div className="boss-hud">
              <div>
                <span>{BOSS_VARIANTS[boss.bossVariant]?.name}</span>
                <small>PHASE {boss.bossPhase}</small>
              </div>
              <Progress
                aria-label="Boss hull"
                value={(boss.hp / boss.maxHp) * 100}
              />
            </div>
          )}
          {s.bannerTime > 0 && s.phase === 'playing' && (
            <div className="game-banner" key={s.banner}>
              <span>{s.bannerSub}</span>
              <h2>{s.banner}</h2>
            </div>
          )}
          <div className="bottom-hud">
            <div className="weapon-hud">
              <Crosshair size={19} />
              <div>
                {WEAPONS.find((w) => w.id === s.weapon)?.name}
                <button
                  onClick={() => {
                    toggleFire();
                  }}
                >
                  AUTO-FIRE {s.autoFire ? 'ON' : 'OFF'} <kbd>F</kbd>
                </button>
              </div>
            </div>
            <div className="abilities">
              <button
                onClick={() => {
                  actions.current.dash = true;
                }}
                className={p.dashCooldown <= 0 ? 'charged' : ''}
              >
                <Wind size={21} />
                <span>DASH</span>
                <kbd>SPACE</kbd>
                <small>
                  {p.dashCooldown <= 0
                    ? 'READY'
                    : `${p.dashCooldown.toFixed(1)}s`}
                </small>
              </button>
              <button
                onClick={() => {
                  actions.current.pulse = true;
                }}
                className={p.pulse >= 100 ? 'charged' : ''}
              >
                <Radio size={21} />
                <span>NULL PULSE</span>
                <kbd>Q</kbd>
                <small>
                  {p.pulse >= 100 ? 'READY' : `${Math.floor(p.pulse)} %`}
                </small>
              </button>
            </div>
            <div className="minimap">
              <svg viewBox="-55 -55 110 110" aria-label="Radar">
                <circle r="51" fill="none" stroke="#456665" strokeWidth=".6" />
                <circle r="26" fill="none" stroke="#254443" strokeWidth=".5" />
                <path
                  d="M-51 0H51M0 -51V51"
                  stroke="#254443"
                  strokeWidth=".5"
                />
                {s.enemies.map((e) => (
                  <circle
                    key={e.id}
                    cx={e.x}
                    cy={e.y}
                    r={e.kind === 'boss' ? 3 : 1.4}
                    fill="#ff946e"
                  />
                ))}
                {s.partner && (
                  <circle
                    cx={s.partner.x}
                    cy={s.partner.y}
                    r="2.6"
                    fill="#bd9fff"
                  />
                )}
                <circle cx={p.x} cy={p.y} r="2.6" fill="#c5ff72" />
              </svg>
            </div>
          </div>
          <div className="xp-strip">
            <Progress aria-label="Experience" value={(p.xp / p.nextXp) * 100} />
          </div>
          <div className="build-strip">
            {Object.entries(s.upgrades)
              .filter(([, n]) => n)
              .map(([id, n]) => (
                <span key={id} title={UPGRADES.find((u) => u.id === id)?.name}>
                  {icon(UPGRADES.find((u) => u.id === id)?.icon || '', 14)}
                  <b>{n}</b>
                </span>
              ))}
          </div>
          {s.phase === 'playing' && (
            <div
              className="touch-stick"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                joystick(e);
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) joystick(e);
              }}
              onPointerUp={() => {
                touch.current = { x: 0, y: 0, active: false };
              }}
              onPointerCancel={() => {
                touch.current = { x: 0, y: 0, active: false };
              }}
            >
              <div />
              MOVE
            </div>
          )}
          {s.totalTime < 12 && s.phase === 'playing' && (
            <div className="tutorial">
              <kbd>WASD</kbd> Move · Mouse to aim · <kbd>SPACE</kbd> Dash to
              evade · <kbd>Q</kbd> EMP at 100%
            </div>
          )}
        </>
      )}
      {s.phase === 'upgrade' && !panel && (!isGuest || !s.sharedUpgrades) && (
        <dialog
          open
          className="overlay"

          aria-modal="true"
          aria-label="Flight controls"
        >
          <div className="dialog-content wide">
            <div className="eyebrow">
              <span /> SYSTEM UPGRADE / LEVEL {p.level}
            </div>
            <h2>BUILT TO GO FURTHER.</h2>
            <p>{s.choices.length ? (s.sharedUpgrades ? 'Choose a module for the squad.' : 'Your ship. Your build. Choose your own module.') : 'Module installed. Waiting for your wingmate to choose.'}</p>
            <div className="upgrade-grid">
              {s.choices.map((u, i) => (
                <button
                  className={`upgrade-card ${u.rarity}`}
                  key={u.id}
                  onClick={() => {
                    chooseModule(u.id);
                    refresh();
                  }}
                >
                  <span className="rarity">
                    {u.rarity === 'epic'
                      ? 'EXOTIC'
                      : u.rarity === 'rare'
                        ? 'RARE'
                        : 'STANDARD'}{' '}
                    <kbd>{i + 1}</kbd>
                  </span>
                  <div className="upgrade-icon">{icon(u.icon, 34)}</div>
                  <small>
                    {u.category.toUpperCase()} · RANK{' '}
                    {(s.upgrades[u.id] || 0) + 1}/{u.max}
                  </small>
                  <h3>{u.name}</h3>
                  <p>{u.description}</p>
                  <span className="install">
                    INSTALL <ArrowUpRight size={18} />
                  </span>
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              onClick={() => {
                chooseModule(null);
                refresh();
              }}
              disabled={s.rerolls <= 0 || !s.choices.length}
            >
              <RotateCcw size={14} /> REROLL ({s.rerolls})
            </Button>
            <small className="pause-note">TIME PAUSED · TAKE YOUR PICK</small>
          </div>
        </dialog>
      )}
      {s.phase === 'station' && !panel && !isGuest && (
        <dialog
          open
          className="overlay"

          aria-modal="true"
          aria-label="Flight controls"
        >
          <div className="dialog-content wide">
            <div className="eyebrow">
              <span /> SECTOR {sectorNumber(s)} SECURED
            </div>
            <h2>A MOMENT OF QUIET.</h2>
            <p>{SECTORS[(s.sector + 1) % 3].narrative}</p>
            <div className="station-balance">
              <Gem size={18} />
              {s.stats.scrap} SCRAP AVAILABLE
            </div>
            <div className="upgrade-grid">
              {(
                [
                  {
                    id: 'repair',
                    name: 'Field Repair',
                    text: 'Fully repairs every ship in your squad.',
                    cost: 40,
                    icon: 'heart',
                  },
                  {
                    id: 'module',
                    name: 'Black Market Module',
                    text: 'Choose one extra upgrade from three modules.',
                    cost: 95,
                    icon: 'zap',
                  },
                  {
                    id: 'charge',
                    name: 'EMP Capacitor',
                    text: 'Charges every squad member to 100%.',
                    cost: 30,
                    icon: 'radio',
                  },
                ] as const
              ).map((item) => (
                <button
                  className="shop-card"
                  key={item.id}
                  disabled={
                    s.stationBought.includes(item.id) ||
                    (item.id === 'module' &&
                      UPGRADES.every(
                        (u) => (s.upgrades[u.id] || 0) >= u.max,
                      )) ||
                    s.stats.scrap < item.cost ||
                    (item.id === 'repair' &&
                      p.hp >= p.maxHp &&
                      (!s.partner || s.partner.hp >= s.partner.maxHp)) ||
                    (item.id === 'charge' &&
                      p.pulse >= 100 &&
                      (!s.partner || s.partner.pulse >= 100))
                  }
                  onClick={() => {
                    sim.current.purchase(item.id);
                    refresh();
                  }}
                >
                  {icon(item.icon, 28)}
                  <h3>{item.name}</h3>
                  <p>{item.text}</p>
                  <strong>
                    {s.stationBought.includes(item.id)
                      ? 'INSTALLED'
                      : `${item.cost} SCRAP`}
                  </strong>
                </button>
              ))}
            </div>
            <Button
              className="launch"
              onClick={() => {
                sim.current.continueSector();
                refresh();
              }}
            >
              JUMP TO SECTOR {sectorNumber(s) + 1}
              <ArrowUpRight />
            </Button>
          </div>
        </dialog>
      )}
      {s.phase === 'paused' && !panel && (
        <dialog
          open
          className="overlay"

          aria-modal="true"
          aria-label="Flight controls"
        >
          <div className="dialog-content">
            <div className="eyebrow">
              <span /> FLIGHT ON HOLD
            </div>
            <h2>TAKE A BREATH.</h2>
            <p>
              {room.current?.message ||
                (isGuest
                  ? 'The commander will resume the shared run.'
                  : 'Your ship will be here.')}
            </p>
            <Button
              className="launch"
              disabled={isGuest}
              onClick={() => {
                sim.current.resume();
                room.current?.broadcast(sim.current.state, true);
                void audio.current?.unlock();
                refresh();
              }}
            >
              {isGuest ? 'COMMANDER RESUMES' : 'RESUME FLIGHT'} <Play />
            </Button>
            <Button variant="outline" onClick={() => setPanel('settings')}>
              <Settings2 /> SETTINGS
            </Button>
            <Button variant="ghost" onClick={hangar}>
              Abandon run · Return to hangar
            </Button>
            <div className="control-guide">
              <p>
                <kbd>WASD / ARROWS</kbd> Move
              </p>
              <p>
                <kbd>MOUSE</kbd> Aim · Left click to fire
              </p>
              <p>
                <kbd>F</kbd> Toggle auto-fire
              </p>
              <p>
                <kbd>SPACE</kbd> Dash with brief invulnerability
              </p>
              <p>
                <kbd>Q</kbd> EMP clears nearby projectiles
              </p>
              <p>
                <kbd>ESC</kbd> Pause / Resume
              </p>
            </div>
          </div>
        </dialog>
      )}
      {(s.phase === 'victory' || s.phase === 'defeat') && !panel && (
        <dialog
          open
          className="overlay"

          aria-modal="true"
          aria-label="Flight controls"
        >
          <div className="dialog-content wide">
            <div className="eyebrow">
              <span />{' '}
              {s.phase === 'victory' ? 'SIGNAL RESTORED' : 'SIGNAL LOST'}
            </div>
            <h2>
              {s.phase === 'victory'
                ? 'THE LAST LIGHT.'
                : 'THIS IS NOT THE END.'}
            </h2>
            <p>
              {s.phase === 'victory'
                ? 'One tone becomes a thousand voices. The gates open. You brought us home.'
                : 'The void forgets. Your hangar remembers. Make the next jump count.'}
            </p>
            <div className="result-score">
              {sim.current.score().toLocaleString('en-US')}
              <span>SCORE</span>
            </div>
            <div className="result-stats">
              <div>
                <b>{s.sharedKills ? s.stats.kills : p.kills}</b>{s.partner && !s.sharedKills ? 'YOUR KILLS' : 'KILLS'}
              </div>
              <div>
                <b>{s.stats.bosses}{s.mode === 'campaign' ? '/3' : ''}</b>BOSSES
              </div>
              <div>
                <b>{clock(s.totalTime)}</b>FLIGHT TIME
              </div>
              <div>
                <b>+{result.earned}</b>CORE SHARDS
              </div>
            </div>
            {s.partner && !s.sharedKills && <p>YOUR KILLS {p.kills} · WINGMATE KILLS {s.partner.kills} · TEAM TOTAL {s.stats.kills}</p>}
            {result.achievements.length > 0 && (
              <p className="achievement-toast">
                <Trophy size={16} />{' '}
                {result.achievements
                  .map((id) => ACHIEVEMENTS.find((a) => a.id === id)?.name)
                  .join(' · ')}
              </p>
            )}
            <div className="result-actions">
              <Button
                className="launch"
                disabled={
                  isGuest ||
                  (!!room.current && room.current.status !== 'connected')
                }
                onClick={start}
              >
                ONE MORE JUMP <RotateCcw />
              </Button>
              <Button variant="outline" onClick={hangar}>
                RETURN TO HANGAR
              </Button>
            </div>
          </div>
        </dialog>
      )}
      {panel && panel !== 'multiplayer' && panel !== 'mission' && (
        <dialog
          open
          className="overlay"

          aria-modal="true"
          aria-label="Flight controls"
        >
          <div className="dialog-content wide">
            <Button
              className="close-panel"
              variant="ghost"
              size="icon"
              aria-label="Close"
              onClick={() => setPanel(null)}
            >
              <X />
            </Button>
            <div className="eyebrow">
              <span /> VOIDBREAKER / SYSTEMS
            </div>
            <h2>
              {panel === 'settings' ? 'YOUR COCKPIT.' : 'THE FLIGHT ARCHIVE.'}
            </h2>
            {panel === 'settings' ? (
              <div className="settings-list">
                <label htmlFor="auto-fire-toggle">
                  Auto-fire
                  <Switch
                    id="auto-fire-toggle"
                    aria-label="Auto-fire"
                    checked={save.settings.autoFire}
                    onCheckedChange={toggleFire}
                  />
                </label>
                <label htmlFor="sound-toggle">
                  Sound
                  <Switch
                    id="sound-toggle"
                    aria-label="Sound"
                    checked={!save.settings.muted}
                    onCheckedChange={(v) => {
                      void audio.current?.unlock();
                      changeSettings({ muted: !v });
                    }}
                  />
                </label>
                <div className="volume-label">
                  Volume <span>{Math.round(save.settings.volume * 100)} %</span>
                </div>
                <Slider
                  aria-label="Volume"
                  value={[save.settings.volume * 100]}
                  min={0}
                  max={100}
                  onValueChange={(v) =>
                    changeSettings({
                      volume: (Array.isArray(v) ? v[0] : v) / 100,
                    })
                  }
                />
                <label htmlFor="shake-toggle">
                  Screen shake
                  <Switch
                    id="shake-toggle"
                    aria-label="Screen shake"
                    checked={save.settings.shake}
                    onCheckedChange={(v) => changeSettings({ shake: v })}
                  />
                </label>
                <label htmlFor="quality-toggle">
                  Bloom & high resolution
                  <Switch
                    id="quality-toggle"
                    aria-label="High graphics quality"
                    checked={save.settings.quality === 'high'}
                    onCheckedChange={(v) =>
                      changeSettings({ quality: v ? 'high' : 'low' })
                    }
                  />
                </label>
                <p>
                  Turn off bloom for smoother performance. Progress saves
                  automatically in this browser.
                </p>
              </div>
            ) : (
              <>
                <div className="result-stats">
                  <div>
                    <b>{save.totalRuns}</b>RUNS
                  </div>
                  <div>
                    <b>{save.wins}</b>WINS
                  </div>
                  <div>
                    <b>{save.bestScore.toLocaleString('en-US')}</b>BEST SCORE
                  </div>
                  <div>
                    <b>{save.shards}</b>CORE SHARDS
                  </div>
                </div>
                <div className="meta-grid">
                  {(['hull', 'damage', 'fortune'] as const).map((id, i) => {
                    const cost = 40 + save.meta[id] * 35;
                    return (
                      <button
                        key={id}
                        disabled={save.meta[id] >= 5 || save.shards < cost}
                        onClick={() => {
                          if (saveRef.current.shards < cost) return;
                          persist({
                            ...save,
                            shards: save.shards - cost,
                            meta: { ...save.meta, [id]: save.meta[id] + 1 },
                          });
                          audio.current?.play('upgrade');
                        }}
                      >
                        <strong>
                          {
                            [
                              'REINFORCED HULL',
                              'WEAPON CALIBRATION',
                              'TACTICAL SCAN',
                            ][i]
                          }
                        </strong>
                        <p>
                          {
                            [
                              '+8 hull per rank',
                              '+4% damage per rank',
                              '+1 reroll per rank',
                            ][i]
                          }
                        </p>
                        <span>
                          {save.meta[id]}/5 ·{' '}
                          {save.meta[id] >= 5 ? 'MAXIMUM' : `${cost} SHARDS`}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="achievements">
                  {ACHIEVEMENTS.map((a) => (
                    <div
                      className={
                        save.achievements.includes(a.id) ? 'unlocked' : ''
                      }
                      key={a.id}
                    >
                      <Trophy size={18} />
                      <div>
                        <strong>{a.name}</strong>
                        <p>{a.description}</p>
                      </div>
                      <span>+{a.reward}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </dialog>
      )}
      {panel === 'mission' && (
        <dialog open className="overlay" aria-modal="true" aria-labelledby="mission-title">
          <div className="dialog-content wide solo-setup">
            <Button className="close-panel" variant="ghost" size="icon" aria-label="Close mission setup" onClick={() => setPanel(null)}><X /></Button>
            <div className="eyebrow"><span /> SOLO FLIGHT PLAN</div>
            <h2 id="mission-title">CHOOSE YOUR FLIGHT.</h2>
            <p>Set your course. Pick your ship. Make the jump.</p>
            {flightSetup}
            <Button className="launch" disabled={!ready} onClick={start}>BEGIN MISSION <ArrowUpRight /></Button>
          </div>
        </dialog>
      )}
      {panel === 'multiplayer' && (
        <CoopLobby
          ready={ready}
          room={room.current}
          save={save}
          initialCode={inviteCode}
          loadout={flightSetup}
          connect={connectRoom}
          leave={leaveRoom}
          close={() => setPanel(null)}
          launch={start}
        />
      )}
      {!menu && s.partner && (
        <div className="wingmate-hud">
          <Users size={15} />
          <div>
            <span>
              {isGuest ? 'COMMANDER' : 'WINGMATE'} ·{' '}
              {s.partnerShip?.toUpperCase()}
            </span>
            <strong>
              {s.partner.hp <= 0
                ? 'DOWN · RETURNS NEXT WAVE'
                : `${Math.ceil(s.partner.hp)} HULL`}
            </strong>
          </div>
          {!s.sharedKills && <b>{s.partner.kills} KILLS</b>}
          <small>{room.current?.latency || 0} ms</small>
        </div>
      )}
      {!menu && p.hp <= 0 && s.phase === 'playing' && (
        <div className="downed-notice">
          SHIP DOWN
          <span>Your wingmate can bring you back by clearing this wave.</span>
        </div>
      )}
      {isGuest &&
        !panel &&
        ((s.phase === 'upgrade' && s.sharedUpgrades) || s.phase === 'station') && (
          <dialog
            open
            className="overlay"

            aria-modal="true"
            aria-label="Squad decision"
          >
            <div className="dialog-content">
              <div className="eyebrow">
                <Users size={16} /> SQUAD LINK ACTIVE
              </div>
              <h2>
                {s.phase === 'upgrade'
                  ? 'BUILDING TOGETHER.'
                  : 'SECTOR SECURED.'}
              </h2>
              <p>
                {s.phase === 'upgrade'
                  ? 'Your commander is choosing an upgrade for both ships.'
                  : 'Your commander is preparing the next jump. Repairs and supplies are shared.'}
              </p>
              <span className="waiting-signal">
                TIME PAUSED · AWAITING COMMANDER
              </span>
              <Button variant="ghost" onClick={hangar}>
                Leave squad · Return to hangar
              </Button>
            </div>
          </dialog>
        )}
      {!menu && room.current?.status === 'error' && (
        <dialog
          open
          className="overlay connection-lost"
          aria-modal="true"
          aria-label="Connection lost"
        >
          <div className="dialog-content">
            <div className="eyebrow">
              <Radio size={16} /> SQUAD LINK LOST
            </div>
            <h2>REGROUP IN THE HANGAR.</h2>
            <p>{room.current.message}</p>
            <Button className="launch" onClick={hangar}>
              RETURN TO HANGAR <ArrowUpRight />
            </Button>
          </div>
        </dialog>
      )}
    </main>
  );
}

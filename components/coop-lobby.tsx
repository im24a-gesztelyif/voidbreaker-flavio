'use client';
import { useState } from 'react';
import { Users, Copy, Check, ArrowUpRight, X, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SHIPS } from '@/lib/game/content';
import { normalizeCode } from '@/lib/game/multiplayer';
import type { Multiplayer } from '@/lib/game/multiplayer';
import type { SaveData } from '@/lib/game/types';

export function CoopLobby({
  room,
  ready,
  save,
  initialCode,
  connect,
  leave,
  close,
  launch,
}: {
  ready: boolean;
  room: Multiplayer | null;
  save: SaveData;
  initialCode: string;
  connect: (role: 'host' | 'guest', code?: string) => void;
  leave: () => void;
  close: () => void;
  launch: () => void;
}) {
  const [code, setCode] = useState(initialCode),
    [copied, setCopied] = useState(false);
  const active = room && ['waiting', 'connected'].includes(room.status);
  const copy = async () => {
    try {
      const url = new URL(location.href);
      url.searchParams.set('room', room!.code);
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <dialog
      open
      className="overlay"

      aria-modal="true"
      aria-labelledby="coop-title"
    >
      <div className="dialog-content wide coop-dialog">
        <Button
          className="close-panel"
          variant="ghost"
          size="icon"
          aria-label="Close multiplayer"
          onClick={close}
        >
          <X />
        </Button>
        <div className="eyebrow">
          <Users size={16} /> TWO PILOTS. ONE MISSION.
        </div>
        <h2 id="coop-title">BRING A WINGMATE.</h2>
        <p>
          Fight through all three sectors together. Independent ships. Shared
          loot and upgrades.
        </p>
        {room?.message && (
          <p className="connection-error" role="alert">
            {room.message}
          </p>
        )}
        {room?.networkNotice && room.status !== 'connected' && (
          <output className="connection-error">{room.networkNotice}</output>
        )}
        {active ? (
          <>
            <div className="room-code">
              <span>ROOM CODE</span>
              <strong>{room.code}</strong>
              <Button variant="outline" onClick={copy}>
                {copied ? <Check size={16} /> : <Copy size={16} />}{' '}
                {copied ? 'LINK COPIED' : 'COPY INVITE'}
              </Button>
            </div>
            <div className="crew-grid">
              <div>
                <span>
                  {room.role === 'host' ? 'COMMANDER' : 'WINGMATE'} / YOU
                </span>
                <strong>{SHIPS.find((s) => s.id === save.ship)?.name}</strong>
                <small>READY TO FLY</small>
              </div>
              <div className={!room.remoteSave ? 'crew-empty' : ''}>
                <span>{room.role === 'host' ? 'WINGMATE' : 'COMMANDER'}</span>
                <strong>
                  {room.remoteSave
                    ? SHIPS.find((s) => s.id === room.remoteSave?.ship)?.name
                    : 'AWAITING SIGNAL'}
                </strong>
                <small>
                  {room.remoteSave
                    ? 'CONNECTED'
                    : 'Share your code or invite link'}
                </small>
              </div>
            </div>
            {room.role === 'host' ? (
              <Button
                className="launch"
                disabled={room.status !== 'connected' || !room.remoteSave}
                onClick={launch}
              >
                LAUNCH TOGETHER <ArrowUpRight />
              </Button>
            ) : (
              <p className="waiting-signal">
                <Radio size={17} /> Waiting for the commander to launch.
              </p>
            )}
            <Button variant="ghost" onClick={leave}>
              Leave room
            </Button>
          </>
        ) : (
          <div className="coop-options">
            <div>
              <h3>COMMAND A SQUAD</h3>
              <p>Create a private room and send the code to a friend.</p>
              <Button
                className="launch"
                disabled={!ready || room?.status === 'connecting'}
                onClick={() => connect('host')}
              >
                CREATE ROOM <ArrowUpRight />
              </Button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                connect('guest', code);
              }}
            >
              <label htmlFor="room-code">JOIN YOUR WINGMATE</label>
              <Input
                id="room-code"
                value={code}
                onChange={(e) => setCode(normalizeCode(e.target.value))}
                maxLength={8}
                placeholder="8-character code"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                type="submit"
                variant="outline"
                disabled={
                  !ready || code.length !== 8 || room?.status === 'connecting'
                }
              >
                JOIN ROOM <ArrowUpRight size={16} />
              </Button>
            </form>
          </div>
        )}
        {room?.status === 'connecting' && (
          <output className="waiting-signal">Establishing connection…</output>
        )}
        <div className="coop-rules">
          <p>
            <b>Stay together.</b> A downed ship returns at the next cleared
            wave. The run ends when both pilots fall.
          </p>
          <p>
            <b>Build as a team.</b> The commander picks upgrades and station
            purchases for both ships. Either pilot can pause.
          </p>
          <p>
            Keep both game tabs open. Online play needs an internet connection;
            some restricted networks may prevent a connection.
          </p>
        </div>
      </div>
    </dialog>
  );
}

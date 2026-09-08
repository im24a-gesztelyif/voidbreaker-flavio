import type { EnemyKind, SectorDef, ShipDef, UpgradeDef, WeaponDef, SaveData } from './types';

export const SHIPS: ShipDef[] = [
  { id: 'kestrel', name: 'KESTREL', role: 'ABFANGJÄGER', description: 'Präzise. Wendige Schubvektoren und ein ausgewogenes Arsenal.', hp: 100, shield: 60, speed: 17, damage: 1, dash: 2.3, color: '#7bf4db', stats: [3, 3, 3], passive: '10 % Chance auf kritische Treffer.' },
  { id: 'wraith', name: 'WRAITH', role: 'PHANTOMKLASSE', description: 'Ein Schatten zwischen den Salven. Schnell, zerbrechlich, tödlich.', hp: 70, shield: 45, speed: 21, damage: 1.15, dash: 1.6, color: '#b09cff', stats: [5, 2, 4], passive: 'Kurzer Dash-Cooldown. +15 % Schaden.' },
  { id: 'bastion', name: 'BASTION', role: 'SCHWERER KREUZER', description: 'Bleibt, wenn andere fliehen. Massive Panzerung. Massive Feuerkraft.', hp: 155, shield: 80, speed: 13.5, damage: 1.12, dash: 3.1, color: '#ffae66', stats: [2, 5, 4], passive: '+55 Hülle und ein verstärkter Schild.' },
];
export const WEAPONS: WeaponDef[] = [
  { id: 'pulse', name: 'PULSLASER', description: 'Schnelle, präzise Salven', damage: 13, rate: 0.16, speed: 69, count: 1, spread: 0.018, pierce: 0, color: '#85ffe5' },
  { id: 'scatter', name: 'STERNENSCHROT', description: 'Fünf Projektile. Nah dran bleiben.', damage: 9, rate: 0.48, speed: 54, count: 5, spread: 0.13, pierce: 0, color: '#ffb573' },
  { id: 'rail', name: 'RAILKANONE', description: 'Durchschlägt bis zu vier Ziele', damage: 55, rate: 0.73, speed: 115, count: 1, spread: 0, pierce: 3, color: '#bea4ff' },
];
export const SECTORS: SectorDef[] = [
  { name: 'DER SCHROTTGÜRTEL', subtitle: 'ORBIT VON KEPLER–9', color: '#ff874f', bossName: 'DER SAMMLER', narrative: 'Hier hat die Flotte ihren letzten Kampf verloren. Finde den Sprungkern.' },
  { name: 'IONENSTURM', subtitle: 'DAS ZERBROCHENE RELAIS', color: '#78dacd', bossName: 'DIE ARCHITEKTIN', narrative: 'Das Relais sendet noch immer. Jemand erwartet dich auf der anderen Seite.' },
  { name: 'DAS LETZTE LICHT', subtitle: 'EREIGNISHORIZONT', color: '#bc92ff', bossName: 'DAS NULLHERZ', narrative: 'Der Ursprung des Signals. Ein letzter Sprung. Bring uns nach Hause.' },
];
export const UPGRADES: UpgradeDef[] = [
  { id: 'damage', name: 'Heißer Kern', description: '+20 % Waffenschaden. Mehr Energie in jedem Schuss.', max: 5, rarity: 'common', category: 'Waffe', icon: 'flame' },
  { id: 'firerate', name: 'Übertaktung', description: '+15 % Feuerrate für deine Hauptwaffe.', max: 5, rarity: 'common', category: 'Waffe', icon: 'zap' },
  { id: 'multishot', name: 'Zwillingslauf', description: '+1 Projektil pro Schuss. Zusätzliche Läufe verursachen 70 % Schaden.', max: 3, rarity: 'epic', category: 'Waffe', icon: 'split' },
  { id: 'pierce', name: 'Phasenmunition', description: 'Projektile durchschlagen ein zusätzliches Ziel.', max: 3, rarity: 'rare', category: 'Waffe', icon: 'arrow' },
  { id: 'crit', name: 'Schwachstellenscan', description: '+10 % Chance auf kritische Treffer mit doppeltem Schaden.', max: 5, rarity: 'common', category: 'Waffe', icon: 'crosshair' },
  { id: 'hull', name: 'Verbundpanzerung', description: '+30 maximale Hülle. Repariert sofort 35 Hülle.', max: 4, rarity: 'common', category: 'System', icon: 'heart' },
  { id: 'shield', name: 'Schildmatrix', description: '+25 Schildkapazität und sofort volle Schilde.', max: 4, rarity: 'common', category: 'System', icon: 'shield' },
  { id: 'regen', name: 'Nanoreparatur', description: 'Repariert alle 8 Sekunden 4 Hülle. Mit weiteren Modulen schneller.', max: 3, rarity: 'rare', category: 'System', icon: 'heart' },
  { id: 'speed', name: 'Ionenantrieb', description: '+12 % Fluggeschwindigkeit und +15 % Sammelradius.', max: 3, rarity: 'common', category: 'System', icon: 'wind' },
  { id: 'dash', name: 'Phasensprung', description: 'Dash lädt 20 % schneller. Hinterlässt eine schädliche Schockwelle.', max: 3, rarity: 'rare', category: 'System', icon: 'wind' },
  { id: 'magnet', name: 'Traktorstrahl', description: '+60 % Sammelradius. +15 % Erfahrung aus Bergungen.', max: 3, rarity: 'common', category: 'Technik', icon: 'magnet' },
  { id: 'salvage', name: 'Bergungsprotokoll', description: '+30 % Schrott aus besiegten Gegnern.', max: 3, rarity: 'common', category: 'Technik', icon: 'gem' },
  { id: 'missiles', name: 'Schwarmlenkwaffen', description: 'Feuert alle 3 Sekunden eine zielsuchende Rakete. Jede Stufe +1 Rakete.', max: 4, rarity: 'rare', category: 'Technik', icon: 'rocket' },
  { id: 'drones', name: 'Flügelmann', description: 'Eine autonome Kampfdrohne begleitet dich und beschießt nahe Ziele.', max: 3, rarity: 'rare', category: 'Technik', icon: 'drone' },
  { id: 'orbitals', name: 'Orbitalklingen', description: 'Zwei rotierende Klingen beschädigen Gegner in deiner Nähe.', max: 3, rarity: 'rare', category: 'Technik', icon: 'orbit' },
  { id: 'chain', name: 'Kettenreaktor', description: '20 % Trefferchance auf einen Energiesprung zu 2 nahen Gegnern.', max: 3, rarity: 'epic', category: 'Waffe', icon: 'zap' },
  { id: 'explode', name: 'Supernova', description: 'Besiegte Gegner explodieren und verursachen 22 Flächenschaden.', max: 3, rarity: 'epic', category: 'Waffe', icon: 'sun' },
  { id: 'freeze', name: 'Kryoplasma', description: 'Treffer verlangsamen Gegner 2 Sekunden lang um 35 %.', max: 2, rarity: 'rare', category: 'Waffe', icon: 'snow' },
  { id: 'lifesteal', name: 'Blutkreislauf', description: 'Jeder 15. Abschuss repariert 5 Hülle. Weitere Stufen reparieren mehr.', max: 3, rarity: 'rare', category: 'System', icon: 'heart' },
  { id: 'pulse', name: 'Ereignishorizont', description: '+35 % EMP-Schaden und 25 % mehr EMP-Energie aus Abschüssen.', max: 3, rarity: 'rare', category: 'System', icon: 'radio' },
  { id: 'overdrive', name: 'Glaskanone', description: '+35 % Schaden, aber −15 maximale Hülle. Risiko wird belohnt.', max: 3, rarity: 'epic', category: 'Waffe', icon: 'flame' },
  { id: 'ricochet', name: 'Querschläger', description: '35 % Chance, nach einem Treffer ein zusätzliches Ziel anzuvisieren.', max: 2, rarity: 'rare', category: 'Waffe', icon: 'split' },
];
export const ENEMY_DATA: Record<EnemyKind, { hp: number; speed: number; damage: number; radius: number; xp: number; color: string; name: string }> = {
  drone: { hp: 30, speed: 8, damage: 12, radius: 1.2, xp: 5, color: '#ff865a', name: 'Suchdrohne' },
  striker: { hp: 55, speed: 6, damage: 18, radius: 1.5, xp: 9, color: '#ff575f', name: 'Rammjäger' },
  gunner: { hp: 46, speed: 4.5, damage: 12, radius: 1.3, xp: 10, color: '#ffba68', name: 'Schütze' },
  bomber: { hp: 75, speed: 3.8, damage: 17, radius: 1.8, xp: 16, color: '#da87ef', name: 'Minenleger' },
  warden: { hp: 165, speed: 3.6, damage: 20, radius: 2.5, xp: 25, color: '#ff7357', name: 'Wächter' },
  swarm: { hp: 13, speed: 12, damage: 7, radius: 0.7, xp: 3, color: '#fba073', name: 'Schwarm' },
  boss: { hp: 2400, speed: 3.5, damage: 20, radius: 5.5, xp: 140, color: '#ff8552', name: 'Sektorkern' },
};
export const ACHIEVEMENTS = [
  { id: 'first', name: 'Erster Kontakt', description: 'Schließe deinen ersten Einsatz ab.', reward: 15 },
  { id: 'hunter', name: 'Kopfgeldjäger', description: '100 Abschüsse insgesamt.', reward: 25 },
  { id: 'ace', name: 'Flottenass', description: '500 Abschüsse insgesamt.', reward: 50 },
  { id: 'boss', name: 'Grenzgänger', description: 'Besiege einen Sektorboss.', reward: 30 },
  { id: 'win', name: 'Das letzte Licht', description: 'Besiege das Nullherz.', reward: 100 },
  { id: 'combo', name: 'Unaufhaltsam', description: 'Erreiche eine 25er-Abschussserie.', reward: 35 },
];
export const freshSave = (): SaveData => ({ version: 1, shards: 0, totalRuns: 0, wins: 0, bestScore: 0, bestSector: 0, totalKills: 0, ship: 'kestrel', weapon: 'pulse', meta: { hull: 0, damage: 0, fortune: 0 }, achievements: [], settings: { volume: 0.45, muted: false, shake: true, quality: 'high', autoFire: true } });

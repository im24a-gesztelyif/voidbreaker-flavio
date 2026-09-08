import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { createAsteroid, createEnemy, createShip, createStation } from './models';
import { SECTORS, SHIPS } from './content';
import type { GameState } from './types';

const TAU = Math.PI * 2;
export class SpaceRenderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(48, 1, .1, 800);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private ships = SHIPS.map(s => createShip(s.id));
  private enemies = new Map<number, THREE.Group>();
  private pickups = new Map<number, THREE.Mesh>();
  private effects = new Map<number, THREE.Mesh | THREE.Line>();
  private labels: HTMLCanvasElement;
  private labelContext: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private target = new THREE.Vector3();
  private temp = new THREE.Vector3();
  private dummy = new THREE.Object3D();
  private bullets: THREE.InstancedMesh;
  private stars: THREE.Points;
  private ring: THREE.Group;
  private debris: THREE.Group;
  private planet: THREE.Mesh;
  private sunMaterial: THREE.ShaderMaterial;
  private satellites: THREE.Group[] = [];
  private orbitals: THREE.Mesh[] = [];
  private shield: THREE.Mesh;
  private cursor: THREE.Mesh;
  private observed: ResizeObserver;
  private quality: 'high' | 'low';
  private scratchColor = new THREE.Color();
  private time = 0;
  private lastMenu = true;
  private geometries = { orb: new THREE.OctahedronGeometry(.42), ring: new THREE.RingGeometry(.9, 1, 48), ball: new THREE.IcosahedronGeometry(1, 1) };

  constructor(private host: HTMLElement, quality: 'high' | 'low' = 'high') {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor('#03080f'); this.renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 1.5 : 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.3;
    this.renderer.domElement.setAttribute('aria-label', '3D-Spielfeld von VOIDBREAKER'); host.appendChild(this.renderer.domElement);
    this.composer = new EffectComposer(this.renderer); this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .6, .55, .8); this.composer.addPass(this.bloom);
    this.scene.add(new THREE.AmbientLight('#91b9ce', 2.1));
    const light = new THREE.DirectionalLight('#fff0d8', 4); light.position.set(-30, 45, -20); this.scene.add(light);
    const rim = new THREE.DirectionalLight('#7cf8e4', 2.5); rim.position.set(30, 10, 10); this.scene.add(rim);
    this.scene.fog = new THREE.FogExp2('#03080f', .0022);
    const positions = new Float32Array(1800 * 3), colors = new Float32Array(1800 * 3);
    let seed = 683; const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 1800; i++) { positions[i * 3] = (random() - .5) * 600; positions[i * 3 + 1] = -35 - random() * 160; positions[i * 3 + 2] = (random() - .5) * 600; const c = new THREE.Color(random() > .8 ? '#ffb98c' : '#abd6ed'); colors.set([c.r, c.g, c.b], i * 3); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(positions, 3)); sg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: .5, vertexColors: true, transparent: true, opacity: .9, sizeAttenuation: true })); this.scene.add(this.stars);
    this.sunMaterial = new THREE.ShaderMaterial({ uniforms: { color: { value: new THREE.Color('#dc622c') }, time: { value: 0 } }, vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){vN=normalize(normalMatrix*normal);vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}', fragmentShader: 'uniform vec3 color; uniform float time; varying vec3 vN; varying vec3 vP; void main(){float bands=sin(vP.y*.3+sin(vP.x*.12)*2.+sin(vP.z*.2+time*.01));float l=pow(max(dot(normalize(vN),normalize(vec3(-.8,.4,.4))),0.),1.6);float edge=pow(1.-abs(vN.z),3.);vec3 c=mix(vec3(.009,.023,.034),color,l*(.65+bands*.09))+color*edge*.8;gl_FragColor=vec4(c,1.);}' });
    this.planet = new THREE.Mesh(new THREE.SphereGeometry(43, 64, 40), this.sunMaterial); this.planet.position.set(45, -58, -88); this.scene.add(this.planet);
    const planetRing = new THREE.Mesh(new THREE.RingGeometry(50, 65, 128), new THREE.MeshBasicMaterial({ color: '#ad613a', transparent: true, opacity: .25, side: THREE.DoubleSide })); planetRing.rotation.x = -.95; this.planet.add(planetRing);
    this.ring = new THREE.Group(); this.scene.add(this.ring);
    for (const radius of [18, 35, 52]) { const r = new THREE.Mesh(new THREE.RingGeometry(radius, radius + .065, 128), new THREE.MeshBasicMaterial({ color: '#426a75', transparent: true, opacity: radius === 52 ? .6 : .19, side: THREE.DoubleSide })); r.rotation.x = -Math.PI / 2; r.position.y = -1; this.ring.add(r); }
    for (let i = 0; i < 64; i++) { const a = i * TAU / 64; const tick = new THREE.Mesh(new THREE.BoxGeometry(.13, .1, i % 8 === 0 ? 2.5 : 1), new THREE.MeshBasicMaterial({ color: i % 8 === 0 ? '#78b4b3' : '#234551' })); tick.position.set(Math.cos(a) * 52, -1, Math.sin(a) * 52); tick.rotation.y = -a + Math.PI / 2; this.ring.add(tick); }
    this.debris = new THREE.Group(); this.scene.add(this.debris);
    for (let i = 0; i < 42; i++) { const a = random() * TAU, r = 58 + random() * 45; const rock = createAsteroid(i + 3); const size = 1 + random() * 3.5; rock.scale.setScalar(size); rock.position.set(Math.cos(a) * r, -5 - random() * 20, Math.sin(a) * r); this.debris.add(rock); }
    const station = createStation(); station.scale.setScalar(2.7); station.position.set(-32, -16, -28); this.debris.add(station);
    this.ships.forEach(s => this.scene.add(s));
    this.bullets = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshBasicMaterial({ color: 'white', toneMapped: false }), 700); this.bullets.count = 0; this.bullets.frustumCulled = false; this.scene.add(this.bullets);
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(2, 20, 12), new THREE.MeshBasicMaterial({ color: '#7dcff1', wireframe: true, transparent: true, opacity: .04 })); this.scene.add(this.shield);
    this.cursor = new THREE.Mesh(new THREE.RingGeometry(.5, .62, 4), new THREE.MeshBasicMaterial({ color: '#adffee', transparent: true, opacity: .75, side: THREE.DoubleSide })); this.cursor.rotation.x = -Math.PI / 2; this.scene.add(this.cursor);
    for (let i = 0; i < 3; i++) { const drone = createShip('wraith'); drone.scale.setScalar(.35); drone.visible = false; this.satellites.push(drone); this.scene.add(drone); }
    for (let i = 0; i < 6; i++) { const o = new THREE.Mesh(new THREE.OctahedronGeometry(.8), new THREE.MeshBasicMaterial({ color: '#a5ffe8', toneMapped: false })); o.visible = false; this.orbitals.push(o); this.scene.add(o); }
    this.labels = document.createElement('canvas'); this.labels.className = 'world-labels'; host.appendChild(this.labels); this.labelContext = this.labels.getContext('2d')!;
    this.observed = new ResizeObserver(() => this.resize()); this.observed.observe(host); this.resize();
  }
  resize() { const { width, height } = this.host.getBoundingClientRect(); this.width = Math.max(1, width); this.height = Math.max(1, height); this.renderer.setSize(this.width, this.height); this.composer.setSize(this.width, this.height); this.camera.aspect = this.width / this.height; this.camera.updateProjectionMatrix(); this.labels.width = this.width; this.labels.height = this.height; }
  aim(clientX: number, clientY: number) { const rect = this.host.getBoundingClientRect(); this.ray.setFromCamera(new THREE.Vector2((clientX - rect.left) / this.width * 2 - 1, -(clientY - rect.top) / this.height * 2 + 1), this.camera); this.ray.ray.intersectPlane(this.plane, this.temp); this.cursor.position.set(this.temp.x, .2, this.temp.z); return { x: this.temp.x, y: this.temp.z }; }
  setQuality(q: 'high' | 'low') { this.quality = q; this.renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'high' ? 1.5 : 1)); this.resize(); }
  render(s: GameState, dt: number, shake = true) {
    this.time += dt; const menu = s.phase === 'menu', p = s.player, index = SHIPS.findIndex(x => x.id === s.ship); const ship = this.ships[index];
    this.ships.forEach((g, i) => { g.visible = i === index && s.phase !== 'defeat'; });
    this.ring.visible = !menu; this.cursor.visible = !menu;
    if (menu) { this.target.set(9, 0, 0); this.camera.position.set(9, 27, 36); this.camera.lookAt(this.target); ship.position.set(16, Math.sin(this.time) * .3, 0); ship.scale.setScalar(4.4); ship.rotation.set(.06, -.55 + Math.sin(this.time * .2) * .2, -.12); }
    else {
      const smooth = this.lastMenu ? 1 : 1 - Math.exp(-dt * 4); this.target.lerp(new THREE.Vector3(p.x * .75, 0, p.y * .75), smooth);
      const h = this.width / this.height < 1 ? 64 : 53; const k = shake ? s.screenShake * .45 : 0;
      this.camera.position.set(this.target.x + (Math.random() - .5) * k, h, this.target.z + h * .62); this.camera.lookAt(this.target);
      ship.position.set(p.x, p.dashTimer > 0 ? .2 : .5 + Math.sin(this.time * 3) * .06, p.y); ship.scale.setScalar(1.25); ship.rotation.set(0, -p.angle - Math.PI / 2, Math.max(-.24, Math.min(.24, p.vx * .008)));
    }
    this.lastMenu = menu;
    ship.traverse(o => { if (o.userData.thruster) { o.scale.y = .7 + Math.random() * .4 + (p.dashTimer > 0 ? 2 : 0); } });
    this.shield.visible = !menu && p.shield > 0; this.shield.position.set(p.x, .5, p.y); (this.shield.material as THREE.MeshBasicMaterial).opacity = p.hitTimer < .3 ? .24 : .025;
    this.sunMaterial.uniforms.time.value = this.time; this.sunMaterial.uniforms.color.value.lerp(this.scratchColor.set(SECTORS[s.sector].color), .02);
    this.stars.rotation.y = this.time * .001; this.debris.rotation.y = Math.sin(this.time * .015) * .05;
    const live = new Set(s.enemies.map(e => e.id));
    this.enemies.forEach((g, id) => { if (!live.has(id)) { this.scene.remove(g); this.enemies.delete(id); } });
    for (const e of s.enemies) {
      let g = this.enemies.get(e.id); if (!g) { g = createEnemy(e.kind, s.sector); this.enemies.set(e.id, g); this.scene.add(g); }
      g.position.set(e.x, .4, e.y); g.rotation.y = -e.angle - Math.PI / 2; const scale = (e.elite ? 1.25 : 1) * Math.min(1, e.age / .65) * (e.hit > 0 ? 1.06 : 1); g.scale.setScalar(scale);
      g.traverse(o => { if (typeof o.userData.spin === 'number' && s.phase === 'playing') o.rotation.y += o.userData.spin * dt; });
    }
    let n = 0; for (const b of s.bullets) { if (n >= 700) break; this.dummy.position.set(b.x, .4, b.y); this.dummy.rotation.set(0, -Math.atan2(b.vy, b.vx) + Math.PI / 2, 0); const length = b.hostile ? .6 : b.type === 'rail' ? 2.8 : b.type === 'missile' ? 1.1 : .9; this.dummy.scale.set(b.radius, b.radius, length); this.dummy.updateMatrix(); this.bullets.setMatrixAt(n, this.dummy.matrix); this.bullets.setColorAt(n, this.scratchColor.set(b.color).multiplyScalar(b.hostile ? 1.5 : 2)); n++; }
    this.bullets.count = n; this.bullets.instanceMatrix.needsUpdate = true; if (this.bullets.instanceColor) this.bullets.instanceColor.needsUpdate = true;
    const pickIds = new Set(s.pickups.map(i => i.id)); this.pickups.forEach((o, id) => { if (!pickIds.has(id)) { this.scene.remove(o); (o.material as THREE.Material).dispose(); this.pickups.delete(id); } });
    for (const i of s.pickups) { let o = this.pickups.get(i.id); if (!o) { o = new THREE.Mesh(this.geometries.orb, new THREE.MeshBasicMaterial({ color: i.kind === 'xp' ? '#74ddfa' : i.kind === 'scrap' ? '#ffb270' : '#9cffbb', toneMapped: false })); this.scene.add(o); this.pickups.set(i.id, o); } o.position.set(i.x, .4 + Math.sin(this.time * 3 + i.id) * .2, i.y); o.rotation.y += dt * 2; }
    const effectIds = new Set(s.effects.map(f => f.id)); this.effects.forEach((o, id) => { if (!effectIds.has(id)) { this.scene.remove(o); (o.material as THREE.Material).dispose(); if (o instanceof THREE.Line) o.geometry.dispose(); this.effects.delete(id); } });
    for (const f of s.effects) { if (f.kind === 'text') continue; let o = this.effects.get(f.id); const progress = 1 - f.life / f.maxLife;
      if (!o) {
        if (f.kind === 'chain') o = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(f.x, .6, f.y), new THREE.Vector3((f.x + f.targetX!) / 2 + 1, 1, (f.y + f.targetY!) / 2 - 1), new THREE.Vector3(f.targetX!, .6, f.targetY!)]), new THREE.LineBasicMaterial({ color: f.color, transparent: true, toneMapped: false }));
        else { o = new THREE.Mesh(f.kind === 'hit' || f.kind === 'explosion' ? this.geometries.ball : this.geometries.ring, new THREE.MeshBasicMaterial({ color: f.color, transparent: true, side: THREE.DoubleSide, wireframe: f.kind === 'explosion', depthWrite: false, toneMapped: false })); o.rotation.x = -Math.PI / 2; }
        this.effects.set(f.id, o); this.scene.add(o);
      }
      if (f.kind !== 'chain') { o.position.set(f.x, .3, f.y); o.scale.setScalar(f.size * (f.kind === 'spawn' ? 1 - progress : .2 + progress)); }
      (o.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * .8;
    }
    const drones = s.upgrades.drones || 0; this.satellites.forEach((g, i) => { g.visible = !menu && i < drones; const a = s.time * .7 + i * TAU / Math.max(1, drones); g.position.set(p.x + Math.cos(a) * 4, .8, p.y + Math.sin(a) * 4); g.rotation.y = -p.angle - Math.PI / 2; });
    const blades = (s.upgrades.orbitals || 0) * 2; this.orbitals.forEach((g, i) => { g.visible = !menu && i < blades; const a = s.time * 2 + i * TAU / Math.max(1, blades); g.position.set(p.x + Math.cos(a) * 5.5, .5, p.y + Math.sin(a) * 5.5); g.rotation.y = a; });
    if (this.quality === 'high') this.composer.render(); else this.renderer.render(this.scene, this.camera);
    this.drawLabels(s);
  }
  private project(x: number, y: number) { this.temp.set(x, 1, y).project(this.camera); return { x: (this.temp.x * .5 + .5) * this.width, y: (-this.temp.y * .5 + .5) * this.height }; }
  private drawLabels(s: GameState) {
    const ctx = this.labelContext; ctx.clearRect(0, 0, this.width, this.height); if (s.phase === 'menu') return;
    for (const e of s.enemies) { if (e.hp >= e.maxHp && !e.elite && e.telegraph <= 0) continue; const pos = this.project(e.x, e.y); if (e.kind !== 'boss') { ctx.fillStyle = '#102330'; ctx.fillRect(pos.x - 17, pos.y - 22, 34, 3); ctx.fillStyle = e.elite ? '#e0a3ff' : '#ff8b71'; ctx.fillRect(pos.x - 17, pos.y - 22, 34 * e.hp / e.maxHp, 3); } if (e.telegraph > 0) { ctx.strokeStyle = '#ff6b6266'; ctx.lineWidth = 2; if (e.kind === 'striker') { const end = this.project(e.x + Math.cos(e.targetX) * 25, e.y + Math.sin(e.targetX) * 25); ctx.beginPath(); ctx.moveTo(pos.x, pos.y); ctx.lineTo(end.x, end.y); ctx.stroke(); } else { ctx.beginPath(); ctx.arc(pos.x, pos.y, 30 + e.telegraph * 25, 0, TAU); ctx.stroke(); } } }
    ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center'; for (const f of s.effects) if (f.text) { const pos = this.project(f.x, f.y); ctx.globalAlpha = f.life / f.maxLife; ctx.fillStyle = f.color; ctx.fillText(f.text, pos.x, pos.y - 20 - (1 - f.life / f.maxLife) * 25); } ctx.globalAlpha = 1;
  }
  dispose() { this.observed.disconnect(); this.scene.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line) { o.geometry.dispose(); const mats = Array.isArray(o.material) ? o.material : [o.material]; mats.forEach(m => m.dispose()); } }); this.composer.dispose(); this.renderer.dispose(); this.renderer.domElement.remove(); this.labels.remove(); }
}

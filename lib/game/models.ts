import * as THREE from 'three';

/** Procedural hard-surface models. Forward is -Z, dorsal/up is +Y. */
export type ShipKind = 'kestrel' | 'wraith' | 'bastion';
import type { EnemyKind } from './types';
export type { EnemyKind } from './types';

const geometries = new Map<string, THREE.BufferGeometry>();
const materials = new Map<string, THREE.MeshStandardMaterial>();
const templates = new Map<string, THREE.Group>();

const C = {
  dark: '#121c27', armor: '#2d3947', edge: '#546575', ivory: '#dfebe9',
  glass: '#0b3448', mint: '#64ffcc', violet: '#b688ff', amber: '#ffc16b',
  hostile: '#ff526a', pink: '#ff65bf', blue: '#60cfff', white: '#eaffff',
};

function material(color: string, emission = 0, metalness = 0.65): THREE.MeshStandardMaterial {
  const key = `${color}:${emission}:${metalness}`;
  let result = materials.get(key);
  if (!result) {
    result = new THREE.MeshStandardMaterial({
      color, metalness, roughness: emission ? 0.35 : 0.56, flatShading: true,
      emissive: emission ? color : '#000000', emissiveIntensity: emission,
      toneMapped: emission === 0,
    });
    materials.set(key, result);
  }
  return result;
}

function geometry(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let result = geometries.get(key);
  if (!result) { result = make(); geometries.set(key, result); }
  return result;
}

function boxGeometry() { return geometry('box', () => new THREE.BoxGeometry(1, 1, 1)); }
function cylinderGeometry() { return geometry('cylinder', () => new THREE.CylinderGeometry(1, 1, 1, 8)); }
function coneGeometry() { return geometry('cone', () => new THREE.ConeGeometry(1, 1, 6)); }
function crystalGeometry() { return geometry('crystal', () => new THREE.OctahedronGeometry(1)); }

function part(
  parent: THREE.Group, name: string, geom: THREE.BufferGeometry, mat: THREE.Material,
  position: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
}

function box(
  parent: THREE.Group, name: string, color: string,
  x: number, y: number, z: number, sx: number, sy: number, sz: number, glow = 0,
) {
  return part(parent, name, boxGeometry(), material(color, glow), [x, y, z], [sx, sy, sz]);
}

/** Shared extruded, bevelled polygon in the XZ plane. */
function plateGeometry(key: string, points: number[][], depth: number) {
  return geometry(`plate:${key}`, () => {
    const shape = new THREE.Shape();
    points.forEach(([x, z], i) => i ? shape.lineTo(x, z) : shape.moveTo(x, z));
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: true, bevelThickness: Math.min(depth * 0.2, 0.035),
      bevelSize: Math.min(depth * 0.22, 0.035), bevelSegments: 1, steps: 1, curveSegments: 1,
    });
    g.rotateX(Math.PI / 2);
    g.translate(0, depth / 2, 0);
    return g;
  });
}

function plate(
  parent: THREE.Group, key: string, points: number[][], depth: number,
  color: string, y = 0, glow = 0,
) {
  return part(parent, key, plateGeometry(key, points, depth), material(color, glow), [0, y, 0]);
}

function barrel(parent: THREE.Group, x: number, y: number, z: number, length: number, radius: number, accent: string) {
  const body = part(parent, 'gun barrel', cylinderGeometry(), material(C.dark), [x, y, z], [radius, length, radius]);
  body.rotation.x = Math.PI / 2;
  const muzzle = part(parent, 'emissive muzzle collar', cylinderGeometry(), material(accent, 1.4),
    [x, y, z - length / 2], [radius * 1.06, 0.045, radius * 1.06]);
  muzzle.rotation.x = Math.PI / 2;
  return body;
}

function engine(parent: THREE.Group, x: number, y: number, z: number, radius: number, accent: string, length = 0.28) {
  const housing = part(parent, 'engine shroud', cylinderGeometry(), material(C.edge),
    [x, y, z], [radius * 1.25, radius * 1.3, radius * 1.25]);
  housing.rotation.x = Math.PI / 2;
  const throat = part(parent, 'engine throat', cylinderGeometry(), material(C.dark),
    [x, y, z + radius * 0.7], [radius, 0.045, radius]);
  throat.rotation.x = Math.PI / 2;
  const flare = part(parent, 'thruster plume', coneGeometry(), material(accent, 3.7, 0.1),
    [x, y, z + radius * 0.8 + length / 2], [radius * 0.7, length, radius * 0.7]);
  flare.rotation.x = Math.PI / 2;
  flare.userData.thruster = true;
  flare.userData.pulsePhase = x * 7 + z * 3;
  const core = part(parent, 'thruster white core', crystalGeometry(), material(C.white, 4, 0.1),
    [x, y, z + radius * 0.85], [radius * 0.48, radius * 0.48, length * 0.42]);
  core.userData.thruster = true;
  core.userData.pulsePhase = flare.userData.pulsePhase;
}

function reactor(parent: THREE.Group, radius: number, y: number, accent: string) {
  part(parent, 'reactor armor collar', cylinderGeometry(), material(C.dark), [0, y, 0], [radius * 1.34, 0.22, radius * 1.34]);
  part(parent, 'reactor bright core', crystalGeometry(), material(accent, 2.6), [0, y + 0.2, 0], [radius, radius * 0.58, radius]);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const clamp = box(parent, 'reactor clamp', C.ivory,
      Math.cos(a) * radius, y + 0.19, Math.sin(a) * radius, radius * 0.32, 0.12, radius * 0.7);
    clamp.rotation.y = -a;
  }
}

/** Ring is horizontal in XZ. Animate its local rotation.y using userData.spin. */
function ring(parent: THREE.Group, radius: number, width: number, accent: string, speed: number, y = 0) {
  const group = new THREE.Group();
  group.name = 'rotating ring machinery';
  group.position.y = y;
  group.userData.spin = speed;
  group.userData.spinAxis = 'y';
  parent.add(group);
  const g = geometry(`torus:${radius}:${width}`, () => new THREE.TorusGeometry(radius, width, 5, 36));
  const rim = part(group, 'structural ring', g, material(C.armor));
  rim.rotation.x = Math.PI / 2;
  const wire = part(group, 'luminous inner ring',
    geometry(`wire:${radius}:${width}`, () => new THREE.TorusGeometry(radius - width * 0.65, width * 0.16, 4, 48)),
    material(accent, 2.5));
  wire.rotation.x = Math.PI / 2;
  wire.position.y = width * 0.7;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const block = box(group, 'ring actuator', i % 2 ? C.armor : C.ivory,
      Math.cos(a) * radius, 0, Math.sin(a) * radius, width * 2.9, width * 2, width * 4.2);
    block.rotation.y = -a;
    if (i % 2 === 0) {
      const lamp = box(group, 'ring actuator indicator', accent,
        Math.cos(a) * radius, width * 1.06, Math.sin(a) * radius, width * 1.6, 0.025, width * 2.8, 2);
      lamp.rotation.y = -a;
    }
  }
  return group;
}

/** Consolidate static parts into one draw call per material; animated parts remain addressable. */
function compact(root: THREE.Group): THREE.Group {
  root.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, { positions: number[]; normals: number[] }>();
  const remove: THREE.Mesh[] = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  function visit(object: THREE.Object3D) {
    if (object.userData.thruster || typeof object.userData.spin === 'number') return;
    if (object instanceof THREE.Mesh && !Array.isArray(object.material)) {
      let bucket = buckets.get(object.material);
      if (!bucket) { bucket = { positions: [], normals: [] }; buckets.set(object.material, bucket); }
      const positions = object.geometry.getAttribute('position');
      const normals = object.geometry.getAttribute('normal');
      const index = object.geometry.getIndex();
      normalMatrix.getNormalMatrix(object.matrixWorld);
      for (let i = 0, count = index ? index.count : positions.count; i < count; i++) {
        const j = index ? index.getX(i) : i;
        p.fromBufferAttribute(positions, j).applyMatrix4(object.matrixWorld);
        n.fromBufferAttribute(normals, j).applyMatrix3(normalMatrix).normalize();
        bucket.positions.push(p.x, p.y, p.z);
        bucket.normals.push(n.x, n.y, n.z);
      }
      remove.push(object);
    }
    object.children.forEach(visit);
  }
  visit(root);
  remove.forEach(mesh => mesh.removeFromParent());
  buckets.forEach((bucket, mat) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.normals, 3));
    g.computeBoundingSphere();
    part(root, 'combined hull plating', g, mat);
  });
  return root;
}

function constrainRadius(root: THREE.Group, radius: number) {
  root.updateMatrixWorld(true);
  const p = new THREE.Vector3();
  let extent = 0;
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = object.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      p.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      extent = Math.max(extent, Math.hypot(p.x, p.z));
    }
  });
  if (extent > radius) {
    const s = radius / extent;
    root.children.forEach(child => { child.position.multiplyScalar(s); child.scale.multiplyScalar(s); });
  }
  root.userData.radius = Math.min(extent, radius);
}

function cached(key: string, make: () => THREE.Group): THREE.Group {
  let template = templates.get(key);
  if (!template) { template = make(); templates.set(key, template); }
  return template.clone(true);
}

function buildShip(kind: ShipKind): THREE.Group {
  const root = new THREE.Group();
  root.name = `player ${kind}`;
  root.userData.kind = kind;
  const accent = kind === 'kestrel' ? C.mint : kind === 'wraith' ? C.violet : C.amber;
  root.userData.accent = accent;

  if (kind === 'kestrel') {
    plate(root, 'kestrel keel', [[0,-1.16],[0.26,-0.66],[0.34,0.59],[0.19,0.85],[-0.19,0.85],[-0.34,0.59],[-0.26,-0.66]], 0.26, C.dark);
    for (const side of [-1, 1]) {
      const wing = plate(root, 'kestrel starboard wing', [[0.19,-0.25],[0.49,-0.02],[1.14,0.53],[1.07,0.71],[0.48,0.55],[0.27,0.73]], 0.13, C.ivory, 0.03);
      wing.scale.x = side;
      const slash = plate(root, 'kestrel wing mint inlay', [[0.43,0.12],[0.54,0.19],[0.95,0.52],[0.82,0.48]], 0.012, accent, 0.123, 1.3);
      slash.scale.x = side;
      box(root, 'exposed wing support', C.edge, side * 0.54, -0.04, 0.43, 0.5, 0.1, 0.12);
      box(root, 'engine pod', C.armor, side * 0.43, 0.01, 0.61, 0.25, 0.27, 0.59);
      box(root, 'pod shoulder armor', C.ivory, side * 0.43, 0.16, 0.59, 0.21, 0.06, 0.38);
      engine(root, side * 0.43, 0.01, 0.89, 0.105, accent, 0.28);
      barrel(root, side * 0.76, 0, -0.01, 0.54, 0.046, accent);
      box(root, 'wingtip navigation light', accent, side * 1.055, 0.105, 0.61, 0.075, 0.027, 0.075, 2.7);
    }
    plate(root, 'kestrel nose armor', [[0,-1.09],[0.2,-0.56],[0.16,-0.22],[-0.16,-0.22],[-0.2,-0.56]], 0.075, C.ivory, 0.18);
    plate(root, 'kestrel canopy', [[0,-0.69],[0.15,-0.37],[0.13,0.08],[-0.13,0.08],[-0.15,-0.37]], 0.11, C.glass, 0.26, 0.4);
    box(root, 'canopy spine', accent, 0, 0.329, -0.24, 0.023, 0.023, 0.38, 1.5);
    box(root, 'dorsal spine', C.ivory, 0, 0.22, 0.43, 0.16, 0.1, 0.52);
    for (let i = 0; i < 3; i++) box(root, 'radiator vent', C.dark, 0, 0.277, 0.3 + i * 0.13, 0.14, 0.017, 0.045);
  } else if (kind === 'wraith') {
    plate(root, 'wraith stealth hull', [[0,-1.17],[0.38,-0.22],[0.92,0.64],[0.62,0.91],[0,0.55],[-0.62,0.91],[-0.92,0.64],[-0.38,-0.22]], 0.2, C.armor);
    for (const side of [-1, 1]) {
      const blade = plate(root, 'wraith scythe wing', [[0.37,-0.29],[0.85,-0.75],[1.04,-0.64],[0.83,0.82],[0.57,0.65]], 0.105, C.dark, 0.07);
      blade.scale.x = side;
      const trim = plate(root, 'wraith violet blade edge', [[0.88,-0.62],[0.95,-0.6],[0.79,0.67],[0.74,0.57]], 0.014, accent, 0.135, 1.8);
      trim.scale.x = side;
      const dorsal = plate(root, 'wraith dorsal armor', [[0.03,-0.84],[0.24,-0.19],[0.44,0.5],[0.14,0.32]], 0.07, C.edge, 0.15);
      dorsal.scale.x = side;
      engine(root, side * 0.55, 0, 0.76, 0.13, accent, 0.34);
      barrel(root, side * 0.84, -0.025, -0.7, 0.34, 0.039, accent);
    }
    plate(root, 'wraith canopy', [[0,-0.76],[0.12,-0.26],[0,0.22],[-0.12,-0.26]], 0.09, '#271f46', 0.265, 0.65);
    box(root, 'wraith canopy seam', accent, 0, 0.322, -0.28, 0.022, 0.02, 0.46, 1.7);
    const fin = plate(root, 'wraith vertical stabilizer', [[0.02,0.1],[0.03,0.66],[-0.03,0.66],[-0.02,0.1]], 0.37, C.dark, 0.3);
    fin.rotation.z = 0.18;
  } else {
    plate(root, 'bastion armored keel', [[-0.31,-1.05],[0.31,-1.05],[0.54,-0.63],[0.54,0.64],[0.3,0.86],[-0.3,0.86],[-0.54,0.64],[-0.54,-0.63]], 0.35, C.dark);
    plate(root, 'bastion upper armor', [[-0.3,-0.94],[0.3,-0.94],[0.43,-0.58],[0.38,0.54],[-0.38,0.54],[-0.43,-0.58]], 0.12, C.ivory, 0.24);
    for (const side of [-1, 1]) {
      box(root, 'bastion armored crossbeam', C.edge, side * 0.6, 0, 0.18, 0.55, 0.18, 0.48);
      const pod = plate(root, 'bastion heavy sponson', [[0.59,-0.72],[0.94,-0.5],[1.03,0.61],[0.77,0.83],[0.6,0.5]], 0.31, C.armor, 0.035);
      pod.scale.x = side;
      box(root, 'bastion shoulder armor', C.ivory, side * 0.8, 0.23, 0.1, 0.26, 0.09, 0.63);
      box(root, 'bastion amber shoulder stripe', accent, side * 0.8, 0.285, 0.03, 0.27, 0.02, 0.095, 1.1);
      barrel(root, side * 0.79, 0.045, -0.7, 0.63, 0.082, accent);
      engine(root, side * 0.78, 0.02, 0.78, 0.13, accent, 0.25);
      for (let i = 0; i < 3; i++) box(root, 'bastion heatsink', C.dark, side * 0.81, 0.29, 0.23 + i * 0.08, 0.24, 0.027, 0.032);
    }
    plate(root, 'bastion armored cockpit', [[-0.18,-0.75],[0.18,-0.75],[0.22,-0.35],[-0.22,-0.35]], 0.09, C.glass, 0.35, 0.45);
    box(root, 'bastion cockpit crossbar', C.armor, 0, 0.411, -0.53, 0.038, 0.034, 0.39);
    reactor(root, 0.17, 0.33, accent);
    engine(root, 0, -0.02, 0.84, 0.17, accent, 0.3);
  }
  constrainRadius(root, 1.4);
  return compact(root);
}

export function createShip(kind: ShipKind): THREE.Group {
  return cached(`ship:${kind}`, () => buildShip(kind));
}

function buildEnemy(kind: Exclude<EnemyKind, 'boss'>, sector: number): THREE.Group {
  const root = new THREE.Group();
  root.name = `enemy ${kind}`;
  root.userData.kind = kind;
  const accent = [C.hostile, C.pink, C.amber, C.violet, C.blue][((sector - 1) % 5 + 5) % 5];
  root.userData.accent = accent;
  if (kind === 'swarm') {
    plate(root, 'swarm arrow hull', [[0,-0.58],[0.26,0.17],[0.12,0.38],[-0.12,0.38],[-0.26,0.17]], 0.13, C.armor);
    for (const s of [-1, 1]) {
      const blade = plate(root, 'swarm barb', [[0.13,-0.05],[0.48,-0.22],[0.36,0.36],[0.14,0.21]], 0.08, C.dark, 0.025);
      blade.scale.x = s;
    }
    part(root, 'swarm sensor', crystalGeometry(), material(accent, 2.3), [0,0.16,-0.12], [0.08,0.07,0.23]);
    engine(root, 0, 0, 0.36, 0.085, accent, 0.19);
  } else if (kind === 'drone') {
    part(root, 'drone central armored diamond', crystalGeometry(), material(C.armor), [0,0,0], [0.43,0.24,0.67]);
    part(root, 'drone dorsal eye', crystalGeometry(), material(accent, 2.4), [0,0.2,-0.16], [0.12,0.1,0.21]);
    for (const s of [-1,1]) {
      box(root, 'drone spar', C.edge, s * 0.35, 0, 0.06, 0.43, 0.09, 0.12);
      const p = plate(root, 'drone pontoon', [[0.42,-0.41],[0.65,-0.19],[0.61,0.44],[0.42,0.36]], 0.18, C.dark);
      p.scale.x = s;
      box(root, 'drone pontoon light', accent, s * 0.535, 0.11, -0.03, 0.055, 0.02, 0.31, 1.4);
      engine(root, s * 0.51, 0, 0.43, 0.065, accent, 0.18);
    }
  } else if (kind === 'striker') {
    plate(root, 'striker needle', [[0,-1.13],[0.22,-0.2],[0.29,0.55],[0,0.76],[-0.29,0.55],[-0.22,-0.2]], 0.2, C.armor);
    for (const s of [-1,1]) {
      const blade = plate(root, 'striker swept wing', [[0.13,-0.11],[0.86,0.42],[0.77,0.67],[0.32,0.39]], 0.13, C.dark);
      blade.scale.x = s;
      box(root, 'striker rail', accent, s * 0.53, 0.092, 0.35, 0.055, 0.028, 0.3, 1.6).rotation.y = s * -0.69;
      barrel(root, s * 0.65, -0.01, 0.14, 0.51, 0.048, accent);
      engine(root, s * 0.19, 0, 0.6, 0.095, accent, 0.28);
    }
    part(root, 'striker sensor canopy', crystalGeometry(), material(accent, 1.2), [0,0.17,-0.34], [0.08,0.085,0.33]);
  } else if (kind === 'gunner') {
    plate(root, 'gunner broad hull', [[-0.43,-0.59],[0.43,-0.59],[0.67,0.31],[0.33,0.68],[-0.33,0.68],[-0.67,0.31]], 0.27, C.armor);
    box(root, 'gunner bridge', C.edge, 0, 0.22, 0.2, 0.48, 0.21, 0.41);
    box(root, 'gunner visor', accent, 0, 0.346, 0.08, 0.32, 0.03, 0.065, 1.8);
    for (const s of [-1,1]) {
      box(root, 'gunner weapon cradle', C.dark, s * 0.66, 0, -0.12, 0.31, 0.3, 0.68);
      barrel(root, s * 0.66, 0.06, -0.62, 0.77, 0.086, accent);
      box(root, 'gunner shoulder plate', C.ivory, s * 0.51, 0.18, 0.03, 0.21, 0.08, 0.48);
      engine(root, s * 0.33, 0, 0.6, 0.12, accent, 0.25);
    }
  } else if (kind === 'bomber') {
    plate(root, 'bomber armored central hull', [[0,-0.81],[0.37,-0.41],[0.49,0.55],[0,0.81],[-0.49,0.55],[-0.37,-0.41]], 0.34, C.dark);
    for (const s of [-1,1]) {
      box(root, 'bomber cross spar', C.edge, s * 0.57, 0, 0.12, 0.61, 0.15, 0.33);
      const pod = part(root, 'bomber ordnance drum', cylinderGeometry(), material(C.armor), [s * 0.76,0,0.06], [0.25,1.04,0.25]);
      pod.rotation.x = Math.PI / 2;
      for (const z of [-0.23,0.18]) {
        const stripe = part(root, 'bomber ordnance warning bands', cylinderGeometry(), material(accent, 0.8), [s * 0.76,0,z], [0.259,0.075,0.259]);
        stripe.rotation.x = Math.PI / 2;
      }
      engine(root, s * 0.76, 0, 0.57, 0.145, accent, 0.23);
    }
    reactor(root, 0.22, 0.25, accent);
    plate(root, 'bomber nose armor', [[0,-0.72],[0.27,-0.35],[0.22,-0.13],[-0.22,-0.13],[-0.27,-0.35]], 0.08, C.ivory, 0.25);
    box(root, 'bomber nose slit', accent, 0, 0.31, -0.33, 0.26, 0.025, 0.065, 1.8);
  } else if (kind === 'lancer') {
    plate(root, 'needle split hull', [[0,-1.5],[.3,-.3],[.7,.8],[.2,.6],[0,.2],[-.2,.6],[-.7,.8],[-.3,-.3]], .22, C.dark);
    for (const side of [-1,1]) barrel(root, side*.23, .1, -.7, 1.7, .07, '#ffe08a');
    reactor(root, .16, .2, '#ffe08a');
    engine(root, 0, 0, .6, .15, '#ffe08a', .4);
  } else if (kind === 'brood') {
    plate(root, 'brood central ark', [[0,-1.9],[.7,-1],[.7,1.3],[0,1.8],[-.7,1.3],[-.7,-1]], .5, C.armor);
    for (const side of [-1,1]) for (let i=0;i<3;i++) {
      part(root, 'glowing brood pod', crystalGeometry(), material('#a5f789',1.3), [side*(1.1-i*.12),.1,-.9+i*.8], [.45,.3,.5]);
      box(root, 'pod strut', C.edge, side*.6, 0, -.9+i*.8, 1.1,.15,.18);
    }
    engine(root, 0, 0, 1.5, .28, '#a5f789', .6);
  } else if (kind === 'manta') {
    plate(root, 'veil crescent', [[0,-.7],[.5,-.4],[1.8,-1],[1.5,.4],[.4,.8],[0,1.4],[-.4,.8],[-1.5,.4],[-1.8,-1],[-.5,-.4]], .16, C.armor);
    for (const side of [-1,1]) { barrel(root,side*1.2,.05,-.2,.7,.08,'#82d8ff'); engine(root,side*.5,0,.7,.11,'#82d8ff',.5); }
    reactor(root,.22,.2,'#82d8ff');
  } else if (kind === 'anchor') {
    ring(root,1.2,.1,'#f795d9',.8,.1);
    for (let i=0;i<4;i++) {
      const arm=new THREE.Group(); arm.rotation.y=i*Math.PI/2; root.add(arm);
      plate(arm,'rift anchor prong',[[-.2,-.4],[-.35,-1.4],[0,-1.7],[.35,-1.4],[.2,-.4]],.3,C.dark);
      box(arm,'anchor glow','#f795d9',0,.2,-1.1,.1,.1,.5,2);
    }
    reactor(root,.4,.35,'#f795d9');
  } else {
    plate(root, 'warden hexagonal hull', [[0,-1.02],[0.78,-0.52],[0.78,0.5],[0,0.93],[-0.78,0.5],[-0.78,-0.52]], 0.28, C.armor);
    for (const s of [-1,1]) {
      const shield = plate(root, 'warden shield vane', [[0.65,-0.66],[1.11,-0.35],[1.12,0.33],[0.69,0.68],[0.85,0.03]], 0.23, C.dark, 0.08);
      shield.scale.x = s;
      box(root, 'warden shield emitter', accent, s * 1.035, 0.235, 0.01, 0.065, 0.024, 0.49, 1.9);
      engine(root, s * 0.39, -0.01, 0.7, 0.13, accent, 0.25);
      barrel(root, s * 0.32, 0, -0.69, 0.5, 0.06, accent);
    }
    reactor(root, 0.29, 0.23, accent);
    ring(root, 0.55, 0.045, accent, -0.45, 0.27);
  }
  root.userData.radius = kind === 'swarm' ? 0.62 : kind === 'drone' ? 0.8 : 1.25;
  return compact(root);
}

function buildBoss(sector: number): THREE.Group {
  const variant = ((sector - 1) % 6 + 6) % 6;
  const root = new THREE.Group();
  const accent = [C.hostile, C.violet, C.amber, C.blue, C.pink, '#b1ff79'][variant];
  root.name = ['HELIX / siege carrier', 'SERAPH / triune hunter', 'MONARCH / dreadnought', 'ORRERY / machine cathedral', 'ECLIPSE / void crown', 'CHRONOVORE / time eater'][variant];
  root.userData.kind = 'boss';
  root.userData.sector = sector;
  root.userData.accent = accent;
  root.userData.bossVariant = variant;

  if (variant === 0) {
    plate(root, 'boss helix fortress spine', [[0,-3.4],[1,-1.7],[1.2,2.3],[0.7,3.3],[-0.7,3.3],[-1.2,2.3],[-1,-1.7]], 0.8, C.armor);
    for (const s of [-1,1]) {
      box(root, 'carrier armored outrigger', C.edge, s * 2.3, -0.05, 0.55, 3.2, 0.36, 0.64);
      const armor = plate(root, 'carrier outer hull', [[2.55,-2.1],[3.52,-1.47],[3.8,1.7],[3.15,2.75],[2.45,1.77]], 0.68, C.dark, 0.2);
      armor.scale.x = s;
      box(root, 'carrier dorsal plating', C.ivory, s * 3.02, 0.65, 0.25, 0.43, 0.15, 2.8);
      barrel(root, s * 3.06, 0.13, -2.1, 2.02, 0.21, accent);
      engine(root, s * 3.01, 0.04, 2.38, 0.34, accent, 0.85);
      engine(root, s * 0.63, 0, 3, 0.31, accent, 0.74);
    }
    ring(root, 2.04, 0.14, accent, 0.27, 0.45);
    reactor(root, 0.79, 0.77, accent);
    plate(root, 'carrier forehead plate', [[0,-3.14],[0.64,-1.67],[0.45,-1.13],[-0.45,-1.13],[-0.64,-1.67]], 0.19, C.ivory, 0.63);
  } else if (variant === 1) {
    part(root, 'seraph central trinity hull', crystalGeometry(), material(C.armor), [0,0,0], [1.85,0.75,1.85]);
    for (let i = 0; i < 3; i++) {
      const arm = new THREE.Group();
      arm.rotation.y = i * Math.PI * 2 / 3;
      root.add(arm);
      plate(arm, 'seraph sweeping scythe', [[0.25,-0.8],[1.0,-2.8],[2.22,-3.31],[2.05,-4.33],[0.67,-3.73],[-0.4,-1.48]], 0.52, C.dark, 0.1);
      plate(arm, 'seraph ivory wing cap', [[0.46,-1.41],[0.99,-2.89],[1.9,-3.34],[1.71,-3.73],[0.79,-3.24]], 0.1, C.ivory, 0.42);
      box(arm, 'seraph energy blade', accent, 0.62, 0.46, -2.43, 0.075, 0.08, 1.73, 1.9).rotation.y = -0.3;
      barrel(arm, 1.87, 0.18, -3.61, 1.37, 0.14, accent);
      engine(arm, 0.55, 0, -0.05, 0.25, accent, 0.68);
    }
    ring(root, 1.92, 0.12, accent, -0.34, 0.77);
    reactor(root, 0.82, 0.74, accent);
  } else if (variant === 2) {
    plate(root, 'monarch vast dreadnought hull', [[0,-4.48],[1.25,-3.05],[1.9,1.95],[1.08,3.89],[-1.08,3.89],[-1.9,1.95],[-1.25,-3.05]], 0.95, C.armor);
    for (const s of [-1,1]) {
      const shield = plate(root, 'monarch heavy shield flank', [[1.13,-2.02],[2.27,-1.39],[3.09,1.3],[2.5,2.8],[1.62,1.9]], 0.62, C.dark, 0.25);
      shield.scale.x = s;
      box(root, 'monarch forward lance armor', C.ivory, s * 0.86, 0.63, -1.71, 0.29, 0.23, 2.4);
      barrel(root, s * 0.86, 0.55, -3.05, 1.52, 0.16, accent);
      for (let i = 0; i < 3; i++) {
        const z = -0.8 + i * 1.04;
        box(root, 'monarch battery turret', C.edge, s * 2.0, 0.75, z, 0.47, 0.37, 0.54);
        barrel(root, s * 2.0, 0.78, z - 0.31, 0.61, 0.09, accent);
      }
      engine(root, s * 0.66, 0.05, 3.7, 0.35, accent, 0.93);
      engine(root, s * 1.24, -0.03, 3.24, 0.27, accent, 0.72);
    }
    const ringPart = ring(root, 1.24, 0.12, accent, 0.25, 1.05);
    ringPart.position.z = 0.65;
    const core = new THREE.Group();
    core.position.z = 0.65;
    root.add(core);
    reactor(core, 0.6, 0.85, accent);
    box(root, 'monarch command bridge', C.dark, 0, 0.83, -1.17, 0.66, 0.7, 0.67);
    box(root, 'monarch command bridge visor', accent, 0, 1.195, -1.31, 0.54, 0.03, 0.09, 2.3);
  } else if (variant === 3) {
    ring(root, 3.45, 0.19, accent, 0.19, 0.2);
    ring(root, 2.04, 0.13, accent, -0.31, 0.9);
    for (let i = 0; i < 5; i++) {
      const arm = new THREE.Group();
      arm.rotation.y = i * Math.PI * 2 / 5;
      root.add(arm);
      box(arm, 'orrery radial truss', C.edge, 0, 0, -2.23, 0.36, 0.38, 3.38);
      plate(arm, 'orrery gothic battlement', [[0,-4.66],[0.47,-3.66],[0.7,-2.89],[0.36,-2.26],[-0.36,-2.26],[-0.7,-2.89],[-0.47,-3.66]], 0.62, C.dark, 0.34);
      plate(arm, 'orrery ivory battlement crown', [[0,-4.37],[0.21,-3.51],[0.27,-2.92],[-0.27,-2.92],[-0.21,-3.51]], 0.1, C.ivory, 0.72);
      box(arm, 'orrery power rail', accent, 0, 0.815, -3.42, 0.078, 0.03, 0.8, 2.2);
      barrel(arm, 0, 0.24, -4.03, 1.2, 0.145, accent);
    }
    reactor(root, 0.99, 0.65, accent);
  } else if (variant === 4) {
    ring(root, 3.67, 0.18, accent, -0.23, 0.17);
    const tilted = ring(root, 2.74, 0.13, accent, 0.34, 0.51);
    tilted.rotation.z = 0.34;
    for (const s of [-1,1]) {
      const claw = plate(root, 'eclipse crescent jaw', [[0.79,-1.14],[1.96,-3.48],[3.49,-3.55],[4.12,-1.62],[3.96,1.75],[2.39,3.6],[1.22,3.04],[2.49,0.97],[2.51,-1.04],[1.72,-1.59]], 0.58, C.dark, 0.23);
      claw.scale.x = s;
      const face = plate(root, 'eclipse crescent ivory ridge', [[2.61,-3.14],[3.24,-3.12],[3.67,-1.44],[3.49,1.17],[2.86,1.88],[3.04,-1.38]], 0.12, C.ivory, 0.62);
      face.scale.x = s;
      barrel(root, s * 2.84, 0.2, -3.1, 1.36, 0.18, accent);
      engine(root, s * 2.11, 0.08, 3, 0.36, accent, 0.88);
      box(root, 'eclipse core suspension', C.edge, s * 1.31, -0.1, 0, 2.6, 0.19, 0.32);
    }
    part(root, 'eclipse floating singularity shell', crystalGeometry(), material(C.dark), [0,0.5,0], [1.36,0.76,1.36]);
    reactor(root, 0.72, 1.12, accent);
    ring(root, 1.47, 0.075, accent, -0.59, 0.83);
  }
  if (variant === 5) {
    for (const side of [-1,1]) {
      const half = new THREE.Group(); half.rotation.y = side === 1 ? 0 : Math.PI; root.add(half);
      plate(half,'hourglass jaw',[[-.4,-.4],[-2.4,-2.9],[-3.8,-3.1],[-3.2,-4.2],[3.2,-4.2],[3.8,-3.1],[2.4,-2.9],[.4,-.4]],.55,C.dark);
      for (const x of [-2,0,2]) barrel(half,x,.3,-3.5,1.5,.12,accent);
      box(half,'time gate',accent,0,.5,-3.7,4.8,.1,.16,2);
    }
    reactor(root,.9,.7,accent);
    ring(root,1.6,.12,accent,1.1,.4);
    ring(root,2.2,.08,accent,-.7,.8);
  }
  constrainRadius(root, 5.5);
  return compact(root);
}

export function createEnemy(kind: EnemyKind, sector = 1): THREE.Group {
  const normalizedSector = Number.isFinite(sector) ? Math.max(1, Math.floor(sector)) : 1;
  const variant = (normalizedSector - 1) % (kind === 'boss' ? 6 : 5) + 1;
  const result = cached(`enemy:${kind}:${variant}`, () => kind === 'boss' ? buildBoss(variant) : buildEnemy(kind, variant));
  result.userData.sector = normalizedSector;
  return result;
}

function seeded(seed: number) {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}

export function createAsteroid(seed: number): THREE.Group {
  // A bounded pool keeps long sessions from retaining an unbounded geometry cache.
  const shapeSeed = ((Math.floor(seed) % 64) + 64) % 64;
  const root = cached(`asteroid:${shapeSeed}`, () => {
    const group = new THREE.Group();
    group.name = 'fractured asteroid';
    const random = seeded(shapeSeed * 1777 + 23);
    const geo = geometry(`asteroid:${shapeSeed}`, () => {
      const g = new THREE.IcosahedronGeometry(1, 1);
      const position = g.getAttribute('position');
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
        // Direction-derived noise gives identical duplicated vertices identical displacement.
        const h = Math.sin(x * 13.171 + y * 43.37 + z * 71.913 + shapeSeed * 17.17) * 43758.5453;
        const scale = 0.76 + (h - Math.floor(h)) * 0.35;
        position.setXYZ(i, x * scale, y * scale * 0.76, z * scale);
      }
      g.computeVertexNormals();
      g.computeBoundingSphere();
      return g;
    });
    part(group, 'asteroid rock', geo, material(shapeSeed % 3 === 0 ? '#353a47' : '#343944', 0, 0.23));
    for (let i = 0; i < 3; i++) {
      const a = random() * Math.PI * 2;
      const shard = part(group, 'exposed mineral facet', crystalGeometry(),
        material(shapeSeed % 7 === 0 ? '#65adba' : '#4b5260', shapeSeed % 7 === 0 ? 0.23 : 0, 0.5),
        [Math.cos(a) * 0.5, 0.43 + random() * 0.18, Math.sin(a) * 0.5],
        [0.12 + random() * 0.16, 0.11, 0.19 + random() * 0.22]);
      shard.rotation.y = a;
    }
    group.userData.radius = 1.1;
    return compact(group);
  });
  const orientation = seeded((seed >>> 0) ^ 0x9e3779b9);
  root.rotation.set(orientation() * 0.5, orientation() * Math.PI * 2, orientation() * 0.5);
  root.userData.seed = seed;
  return root;
}

export function createStation(): THREE.Group {
  return cached('station', () => {
    const root = new THREE.Group();
    root.name = 'WAYPOINT / orbital drydock';
    root.userData.accent = C.mint;
    part(root, 'station central hexagonal habitat',
      geometry('station hex habitat', () => new THREE.CylinderGeometry(1.38, 1.7, 0.9, 6)),
      material(C.armor), [0,0,0]);
    part(root, 'station ivory roof',
      geometry('station hex roof', () => new THREE.CylinderGeometry(1.32, 1.4, 0.2, 6)),
      material(C.ivory), [0,0.54,0]);
    ring(root, 2.48, 0.1, C.mint, 0.1, -0.08);
    reactor(root, 0.43, 0.7, C.mint);
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      arm.rotation.y = i * Math.PI / 2;
      root.add(arm);
      box(arm, 'station connecting truss', C.edge, 0, -0.18, -2.07, 0.34, 0.22, 2.2);
      box(arm, 'station module', C.dark, 0, 0, -3.05, 1.14, 0.67, 0.9);
      box(arm, 'station module roof', C.ivory, 0, 0.39, -3.05, 1.02, 0.13, 0.71);
      box(arm, 'station docking beacon', C.mint, 0, 0.48, -3.05, 0.58, 0.025, 0.07, 2);
      for (const s of [-1,1]) {
        box(arm, 'station panel boom', C.edge, s * 1.08, -0.09, -3.02, 1.18, 0.07, 0.09);
        box(arm, 'station solar wing frame', C.edge, s * 1.3, -0.06, -3.02, 0.91, 0.08, 1.28);
        box(arm, 'station blue solar cells', '#153346', s * 1.3, 0, -3.02, 0.79, 0.033, 1.15, 0.14);
        for (let j = 0; j < 4; j++) box(arm, 'station solar cell divider', C.edge, s * 1.3, 0.022, -3.47 + j * 0.3, 0.79, 0.008, 0.02);
      }
    }
    const antenna = part(root, 'station communications mast', cylinderGeometry(), material(C.edge), [0,1.29,0.76], [0.045,1.25,0.045]);
    antenna.rotation.z = 0.16;
    part(root, 'station mast beacon', crystalGeometry(), material(C.amber, 3), [-0.1,1.98,0.76], [0.08,0.08,0.08]);
    root.userData.radius = 4.65;
    return compact(root);
  });
}

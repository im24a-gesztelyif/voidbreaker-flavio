'use client';
/* oxlint-disable next/no-img-element -- These cached PNG data URLs are generated locally; they require no image download or server optimizer. */
import { useEffect, useState } from 'react';
import type { ShipId } from '@/lib/game/types';

let previews: Promise<Record<ShipId, string>> | undefined;
function loadPreviews() {
  return previews ??= Promise.all([import('three'), import('@/lib/game/models')]).then(([THREE, {createShip}]) => {
    const renderer = new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
    renderer.setSize(240,160);
    renderer.setClearColor(0,0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.5;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#d5f5ff','#334056',3));
    const light = new THREE.DirectionalLight('#ffffff',4);
    light.position.set(-3,6,4); scene.add(light);
    const camera = new THREE.OrthographicCamera(-2.1,2.1,1.4,-1.4,.1,30);
    camera.position.set(3,5,6);camera.lookAt(0,0,0);
    const images = {} as Record<ShipId,string>;
    try {
      for (const id of ['kestrel','wraith','bastion'] as const) {
        const ship = createShip(id); scene.add(ship);
        renderer.render(scene,camera);
        images[id] = renderer.domElement.toDataURL('image/png');
        scene.remove(ship);
      }
      return images;
    } finally {
      // Models share cached geometry/materials with the game; release only this temporary renderer.
      renderer.dispose();renderer.forceContextLoss();
    }
  });
}
export function ShipPreview({ship}: {ship: ShipId}) {
  const [src,setSrc] = useState('');
  useEffect(() => {
    let active = true;
    loadPreviews().then(images => {if(active)setSrc(images[ship]);}).catch(() => {});
    return () => {active=false;};
  },[ship]);
  return <span className="ship-preview" aria-hidden="true">{src && <img src={src} alt="" width={120} height={80} />}</span>;
}

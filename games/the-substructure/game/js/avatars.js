import * as THREE from 'three';

export const AVATAR_COLORS = ['#c0392b', '#2e86c1', '#2ea35b', '#d4a017', '#8e44ad', '#16a2a2'];

/* Human-shaped explorer built from primitives (front of the model is +Z).
   Returns { g, body, legL, legR, armR, lens, tag? }.  g.rotation.y is set by the caller. */
export function makeAvatar(color = '#c0392b') {
  const g = new THREE.Group(), body = new THREE.Group();
  g.add(body);
  const jacket = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1b1a, roughness: 0.9 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.95 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a58a, roughness: 0.8 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.3, roughness: 0.5 });
  const add = (parent, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };

  const torso = add(body, new THREE.CapsuleGeometry(0.2, 0.46, 4, 12), jacket, 0, 1.12, 0); torso.scale.set(1, 1, 0.68);
  add(body, new THREE.BoxGeometry(0.34, 0.42, 0.16), dark, 0, 1.15, -0.2);                       // backpack
  add(body, new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), skin, 0, 1.52, 0);                  // neck
  const head = add(body, new THREE.SphereGeometry(0.14, 18, 14), skin, 0, 1.67, 0.01); head.scale.set(0.92, 1.05, 1);
  const cap = add(body, new THREE.SphereGeometry(0.152, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), jacket, 0, 1.69, 0); cap.rotation.x = -0.12;
  add(body, new THREE.SphereGeometry(0.02, 6, 6), dark, -0.05, 1.68, 0.135);
  add(body, new THREE.SphereGeometry(0.02, 6, 6), dark, 0.05, 1.68, 0.135);

  const leg = (x) => { const p = new THREE.Group(); p.position.set(x, 0.88, 0); body.add(p); add(p, new THREE.CapsuleGeometry(0.075, 0.5, 4, 8), pants, 0, -0.38, 0); add(p, new THREE.BoxGeometry(0.13, 0.08, 0.26), dark, 0, -0.84, 0.05); return p; };
  const legL = leg(-0.1), legR = leg(0.1);

  const arm = (x) => { const p = new THREE.Group(); p.position.set(x, 1.38, 0); body.add(p); add(p, new THREE.CapsuleGeometry(0.058, 0.42, 4, 8), jacket, 0, -0.26, 0); return p; };
  const armL = arm(-0.27); armL.rotation.z = 0.1;
  const armR = arm(0.27); armR.rotation.x = -1.35; armR.rotation.z = -0.08;   // holding the flashlight forward

  const fl = new THREE.Group(); fl.position.set(0, -0.5, 0); armR.add(fl);
  add(fl, new THREE.CylinderGeometry(0.035, 0.045, 0.2, 10), metal, 0, 0, 0);
  const lens = add(fl, new THREE.CylinderGeometry(0.052, 0.052, 0.03, 12), new THREE.MeshBasicMaterial({ color: 0xfff2cf }), 0, -0.11, 0);

  // pool of blood used when this player is a corpse
  const pool = new THREE.Mesh(new THREE.CircleGeometry(0.9, 20), new THREE.MeshBasicMaterial({ color: 0x3a0505, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  pool.rotation.x = -Math.PI / 2; pool.position.y = 0.02; pool.scale.setScalar(0.01); pool.visible = false; g.add(pool);

  return { g, body, legL, legR, armL, armR, lens, pool, dead: 0, walk: 0 };
}

/* Per-frame pose: walk cycle + collapse when dead. speed in units/s. */
export function poseAvatar(av, dt, speed, dead) {
  av.walk += dt * Math.min(speed, 6) * 2.2;
  const s = Math.min(1, speed / 2.5) * 0.7 * (1 - av.dead);
  av.legL.rotation.x = Math.sin(av.walk) * s;
  av.legR.rotation.x = -Math.sin(av.walk) * s;
  av.armL.rotation.x = -Math.sin(av.walk) * s * 0.6;
  av.body.position.y = Math.abs(Math.sin(av.walk)) * 0.03 * Math.min(1, speed / 2.5);
  av.dead += ((dead ? 1 : 0) - av.dead) * Math.min(1, dt * 5);
  if (av.dead > 0.001) {
    av.body.rotation.x = -av.dead * (Math.PI / 2);
    av.body.position.y = av.dead * 0.16;
    av.armR.rotation.x = -1.35 + av.dead * 1.9;
    av.pool.visible = true; av.pool.scale.setScalar(Math.max(0.01, av.dead));
    av.lens.material.color.setHex(av.dead > 0.6 ? 0x332a20 : 0xfff2cf);
  }
}

/* floating name label (a Sprite with a canvas texture) */
export function makeNameTag(name, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 30px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = '#000'; x.shadowBlur = 6; x.fillStyle = color;
  x.fillText(name, 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(1.1, 0.275, 1); s.position.y = 2.0;
  return s;
}

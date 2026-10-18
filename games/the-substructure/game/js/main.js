import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as skClone} from 'three/addons/utils/SkeletonUtils.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {net, sessionPromise} from './net.js';
import {Sound} from './audio.js';
import {makeAvatar, poseAvatar, makeNameTag, AVATAR_COLORS} from './avatars.js';

/* ---------- session (lobby result) ---------- */
const SES = await sessionPromise;            // waits here until you pick Solo or the host starts the party
const MP = SES.mode === 'mp', ME = SES.me.id;
const isHost = () => !MP || net.state.hostId === ME;

const CELL = 4, H = 3.2, N = 25;
const $ = id => document.getElementById(id);
const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerpAng = (a, b, t) => { const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); return a + d * t; };
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

/* Seeded random: every player uses the same seed, so everyone builds the SAME maze, lockers and exit.
   `rand/rnd` = world generation only.  `rr` = normal runtime randomness. */
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = mulberry32(SES.seed);
const rnd = n => Math.floor(rand() * n);
const rr = n => Math.floor(Math.random() * n);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ---------- maze ---------- */
const g = Array.from({length: N}, () => Array(N).fill(1));
(function carve(x, y) { g[y][x] = 0; for (const [dx, dy] of shuffle(D.map(([a, b]) => [a * 2, b * 2]))) { const nx = x + dx, ny = y + dy; if (nx > 0 && ny > 0 && nx < N - 1 && ny < N - 1 && g[ny][nx]) { g[y + dy / 2][x + dx / 2] = 0; carve(nx, ny); } } })(1, 1);
for (let i = 0; i < 70; i++) { const x = 1 + rnd(N - 2), y = 1 + rnd(N - 2); if (g[y][x] && ((!g[y][x - 1] && !g[y][x + 1]) || (!g[y - 1][x] && !g[y + 1][x]))) g[y][x] = 0; }
const open = (x, y) => g[y]?.[x] === 0, cx = v => Math.floor(v / CELL), wp = c => (c + .5) * CELL, solid = (x, z) => g[cx(z)]?.[cx(x)] !== 0;
const hit = (x, z, r) => solid(x + r, z) || solid(x - r, z) || solid(x, z + r) || solid(x, z - r) || solid(x + r, z + r) || solid(x - r, z - r) || solid(x + r, z - r) || solid(x - r, z + r);
const cells = []; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (open(x, y)) cells.push([x, y]);
const far = (px, pz, min, r = rr) => { const c = cells.filter(([x, y]) => Math.hypot(wp(x) - px, wp(y) - pz) >= min), a = c.length ? c : cells; return a[r(a.length)]; };
function nextStep(sx, sy, tx, ty) { const par = new Map([[tx + ',' + ty, null]]), q = [[tx, ty]]; for (let i = 0; i < q.length; i++) { const [x, y] = q[i]; if (x == sx && y == sy) break; for (const [a, b] of D) { const nx = x + a, ny = y + b, k = nx + ',' + ny; if (open(nx, ny) && !par.has(k)) { par.set(k, [x, y]); q.push([nx, ny]); } } } return par.get(sx + ',' + sy) || null; }
const los = (ax, az, bx, bz) => { const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / .5); for (let i = 1; i < n; i++) { const t = i / n; if (solid(ax + (bx - ax) * t, az + (bz - az) * t)) return false; } return true; };

/* ---------- scene ---------- */
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x070403); scene.fog = new THREE.FogExp2(0x100806, .052);
const cam = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, .05, 80); cam.rotation.order = 'YXZ'; scene.add(cam);
const ren = new THREE.WebGLRenderer({antialias: false, powerPreference: 'high-performance'}); ren.setSize(innerWidth, innerHeight); ren.toneMapping = THREE.ACESFilmicToneMapping; ren.shadowMap.enabled = true; ren.shadowMap.type = THREE.PCFSoftShadowMap; ren.toneMappingExposure = 1.2; document.body.prepend(ren.domElement);
addEventListener('resize', () => { cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); ren.setSize(innerWidth, innerHeight); });
const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
const noise = (x, w, h, n, a) => { for (let i = 0; i < n; i++) { const v = rnd(255); x.fillStyle = `rgba(${v},${v},${v},${a})`; x.fillRect(rnd(w), rnd(h), 1 + rnd(3), 1 + rnd(3)); } };
const mk = (c, rx, ry, srgb = true) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
function stains(x, W, Hh, n) { for (let i = 0; i < n; i++) { const sx = rnd(W), gw = 6 + rnd(34), gr = x.createLinearGradient(0, 0, 0, Hh); gr.addColorStop(0, 'rgba(12,8,4,.45)'); gr.addColorStop(1, 'rgba(12,8,4,0)'); x.fillStyle = gr; x.fillRect(sx, 0, gw, 30 + rnd(Hh)); }
 for (let i = 0; i < 7; i++) { const mx = rnd(W), my = rnd(Hh * .6), r = 20 + rnd(60), gr = x.createRadialGradient(mx, my, 2, mx, my, r); gr.addColorStop(0, 'rgba(10,12,6,.5)'); gr.addColorStop(1, 'rgba(10,12,6,0)'); x.fillStyle = gr; x.fillRect(mx - r, my - r, r * 2, r * 2); } }
function wallTex() { const W = 512, Hh = 410, sp = Math.round(Hh * .64), [c, x] = cv(W, Hh); x.fillStyle = '#4d3d2d'; x.fillRect(0, 0, W, sp);
 for (let j = -1; j < sp / 64 + 1; j++) for (let i = -1; i < W / 64 + 2; i++) { const ox = i * 64 + (j % 2 ? 32 : 0), oy = j * 64; x.strokeStyle = '#2c2118'; x.lineWidth = 3; x.beginPath(); x.moveTo(ox, oy - 26); x.lineTo(ox + 26, oy); x.lineTo(ox, oy + 26); x.lineTo(ox - 26, oy); x.closePath(); x.stroke(); x.fillStyle = '#614c36'; x.beginPath(); x.arc(ox, oy, 6, 0, 7); x.fill(); }
 stains(x, W, sp, 9); for (let i = 0; i < 6; i++) { x.fillStyle = 'rgba(125,105,78,.33)'; x.beginPath(); let px = rnd(W), py = rnd(sp - 40); x.moveTo(px, py); for (let k = 0; k < 6; k++) x.lineTo(px + rnd(70) - 10, py + rnd(90)); x.fill(); }
 x.fillStyle = '#2b1a0f'; x.fillRect(0, sp, W, Hh - sp); for (let i = 0; i < W; i += 64) { x.fillStyle = '#150b05'; x.fillRect(i, sp, 3, Hh - sp); x.strokeStyle = '#1c0f07'; x.lineWidth = 2; x.strokeRect(i + 10, sp + 22, 44, Hh - sp - 40); }
 for (let k = 0; k < 160; k++) { x.fillStyle = 'rgba(10,5,2,.3)'; x.fillRect(rnd(W), sp + rnd(Hh - sp), 1, 10 + rnd(50)); }
 x.fillStyle = '#3b2515'; x.fillRect(0, sp - 8, W, 14); x.fillStyle = '#5f3d24'; x.fillRect(0, sp - 8, W, 2); x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(0, sp + 6, W, 6);
 noise(x, W, Hh, 9000, .12); return c; }
function floorTex() { const W = 512, [c, x] = cv(W, W); for (let i = 0; i < 8; i++) { const sh = rnd(30); x.fillStyle = `rgb(${64 + sh},${40 + sh * .6},${24 + sh * .4})`; x.fillRect(i * 64, 0, 64, W); x.fillStyle = '#110905'; x.fillRect(i * 64, 0, 2, W); x.fillRect(i * 64, rnd(W), 64, 2);
 for (let k = 0; k < 40; k++) { x.fillStyle = 'rgba(20,10,4,.25)'; x.fillRect(i * 64 + rnd(60), rnd(W), 1, 20 + rnd(120)); } }
 for (let i = 0; i < 10; i++) { const mx = rnd(W), my = rnd(W), r = 30 + rnd(70), gr = x.createRadialGradient(mx, my, 2, mx, my, r); gr.addColorStop(0, 'rgba(8,5,3,.45)'); gr.addColorStop(1, 'rgba(8,5,3,0)'); x.fillStyle = gr; x.fillRect(mx - r, my - r, r * 2, r * 2); }
 noise(x, W, W, 9000, .1); return c; }
function ceilTex() { const W = 256, [c, x] = cv(W, W); x.fillStyle = '#2b231b'; x.fillRect(0, 0, W, W); stains(x, W, W, 4); noise(x, W, W, 4000, .12); return c; }
const wc = wallTex(), wt = mk(wc, 1, 1), wb = mk(wc, 1, 1, false);
const wl = []; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (g[y][x] && [...D, [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([a, b]) => open(x + a, y + b))) wl.push([x, y]);
const wm = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL, H, CELL), new THREE.MeshStandardMaterial({map: wt, bumpMap: wb, bumpScale: 2.5, roughness: .9}), wl.length), m4 = new THREE.Matrix4();
wl.forEach(([x, y], i) => { m4.setPosition(wp(x), H / 2, wp(y)); wm.setMatrixAt(i, m4); wm.setColorAt(i, new THREE.Color().setScalar(.62 + rand() * .4)); }); wm.instanceColor.needsUpdate = true; wm.castShadow = wm.receiveShadow = true; scene.add(wm);
const S = N * CELL, fc = floorTex(), fl = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshStandardMaterial({map: mk(fc, S / 4, S / 4), bumpMap: mk(fc, S / 4, S / 4, false), bumpScale: 1.5, roughness: .55})); fl.rotation.x = -Math.PI / 2; fl.position.set(S / 2, 0, S / 2); fl.receiveShadow = true; scene.add(fl);
const ce = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshStandardMaterial({map: mk(ceilTex(), S / 6, S / 6), roughness: 1})); ce.rotation.x = Math.PI / 2; ce.position.set(S / 2, H, S / 2); scene.add(ce);
const HEMI = .62, hemi = new THREE.HemisphereLight(0x7a604a, 0x24160d, HEMI); scene.add(hemi);
const fls = new THREE.SpotLight(0xffeccc, 90, 34, .62, .9, 1.5); fls.position.set(0, 0, 0); fls.target.position.set(0, 0, -1); fls.castShadow = true; fls.shadow.mapSize.set(1024, 1024); fls.shadow.bias = -.0004; fls.shadow.normalBias = .03; cam.add(fls, fls.target);
const glow = new THREE.PointLight(0xffd9a8, 4, 10, 1.6); cam.add(glow);
const lamps = [], pool = [], lm = new THREE.MeshBasicMaterial({color: 0xffc890}), sg = new THREE.SphereGeometry(.07, 6, 6);
for (let i = 0; i < 13; i++) { const [x, y] = cells[rnd(cells.length)], m = new THREE.Mesh(sg, lm); m.position.set(wp(x) + (rand() - .5) * 1.5, H - .5, wp(y) + (rand() - .5) * 1.5); scene.add(m); lamps.push({p: m.position, cold: i % 5 == 4}); }
for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffa860, 3.4, 12, 1.8); l.base = 3.4; scene.add(l); pool.push(l); }
/* exit */
const EX = cells.filter(([x, y]) => x + y > N).sort((a, b) => (b[0] + b[1]) - (a[0] + a[1]))[0] || cells[cells.length - 1];
const exitL = new THREE.PointLight(0x40ff80, 14, 14, 2); exitL.position.set(wp(EX[0]), 1.6, wp(EX[1])); scene.add(exitL);
const eb = new THREE.Mesh(new THREE.BoxGeometry(.5, 2.4, .5), new THREE.MeshBasicMaterial({color: 0x40ff80})); eb.position.copy(exitL.position); scene.add(eb);
/* ---------- lockers ---------- */
const lockers = [], dead = shuffle(cells.filter(([x, y]) => D.filter(([a, b]) => open(x + a, y + b)).length == 1));
[...dead.slice(0, 7), ...Array.from({length: 10}, () => cells[rnd(cells.length)])].forEach(([x, y]) => { if (x == 1 && y == 1) return; const w = D.find(([a, b]) => !open(x + a, y + b)); if (!w) return;
 const gr = new THREE.Group(), px = wp(x) + w[0] * (CELL / 2 - .55), pz = wp(y) + w[1] * (CELL / 2 - .55), f = [-w[0], -w[1]];
 const body = new THREE.Mesh(new THREE.BoxGeometry(.9, 2.1, .9), new THREE.MeshStandardMaterial({color: 0x3a4a42, metalness: .5, roughness: .6})); body.position.y = 1.05;
 const door = new THREE.Mesh(new THREE.BoxGeometry(f[0] ? .06 : .8, 1.9, f[1] ? .06 : .8), new THREE.MeshStandardMaterial({color: 0x2b3832, metalness: .6, roughness: .5})); door.position.set(f[0] * .47, 1.05, f[1] * .47);
 gr.add(body, door); gr.position.set(px, 0, pz); scene.add(gr); lockers.push({i: lockers.length, x: px, z: pz, f, door, broken: false}); });
/* ---------- props ---------- */
{ const fm = new THREE.MeshStandardMaterial({color: 0x2a190e, roughness: .7}), [pc, px] = cv(128, 160);
 const gr = px.createRadialGradient(64, 70, 5, 64, 70, 70); gr.addColorStop(0, '#5a4a36'); gr.addColorStop(1, '#120c07'); px.fillStyle = gr; px.fillRect(0, 0, 128, 160); px.fillStyle = 'rgba(8,5,3,.85)'; px.beginPath(); px.ellipse(64, 66, 22, 30, 0, 0, 7); px.fill(); px.fillRect(34, 100, 60, 60); noise(px, 128, 160, 800, .2);
 const [dc, dx] = cv(128, 256); dx.fillStyle = '#3a2616'; dx.fillRect(0, 0, 128, 256); dx.strokeStyle = '#1a0e07'; dx.lineWidth = 4; [[14, 16, 100, 90], [14, 122, 100, 110]].forEach(r => dx.strokeRect(...r)); noise(dx, 128, 256, 1500, .15); dx.fillStyle = '#b89a50'; dx.beginPath(); dx.arc(106, 130, 5, 0, 7); dx.fill();
 const pm = new THREE.MeshStandardMaterial({map: mk(pc, 1, 1), roughness: .9}), dm = new THREE.MeshStandardMaterial({map: mk(dc, 1, 1), roughness: .8});
 const GB = {}, GP = {}, gb = (d, a) => GB[d + '' + !!a] ??= new THREE.BoxGeometry(a ? .06 : (d ? 1.22 : .82), d ? 2.32 : 1.02, a ? (d ? 1.22 : .82) : .06), gp = d => GP[d] ??= new THREE.PlaneGeometry(d ? 1.1 : .7, d ? 2.2 : .9);
 cells.forEach(([x, y]) => { for (const [a, b] of D) { if (open(x + a, y + b)) continue; const r = rand(); if (r > .2) continue; const X = wp(x) + a * (CELL / 2 - .05), Z = wp(y) + b * (CELL / 2 - .05); if (lockers.some(l => Math.hypot(l.x - X, l.z - Z) < 1.6)) continue;
  const door = r < .09, w = door ? 1.1 : .7, h = door ? 2.2 : .9, yy = door ? h / 2 : 1.75, box = new THREE.Mesh(gb(door, a), fm), pl = new THREE.Mesh(gp(door), door ? dm : pm);
  box.position.set(X, yy, Z); pl.position.set(X - a * .035, yy, Z - b * .035); pl.rotation.y = Math.atan2(-a, -b); scene.add(box, pl); } });
 const paper = new THREE.InstancedMesh(new THREE.PlaneGeometry(.26, .34), new THREE.MeshStandardMaterial({color: 0x8a7c62, roughness: 1, side: THREE.DoubleSide}), 70), pk = new THREE.InstancedMesh(new THREE.BoxGeometry(1.3, .05, .13), new THREE.MeshStandardMaterial({color: 0x3a2616, roughness: .9}), 26), o = new THREE.Object3D();
 for (let i = 0; i < 70; i++) { const c = cells[rnd(cells.length)]; o.position.set(wp(c[0]) + (rand() - .5) * 3, .012, wp(c[1]) + (rand() - .5) * 3); o.rotation.set(-Math.PI / 2, 0, rand() * 6); o.updateMatrix(); paper.setMatrixAt(i, o.matrix); }
 for (let i = 0; i < 26; i++) { const c = cells[rnd(cells.length)]; o.position.set(wp(c[0]) + (rand() - .5) * 3, .03, wp(c[1]) + (rand() - .5) * 3); o.rotation.set(0, rand() * 6, 0); o.updateMatrix(); pk.setMatrixAt(i, o.matrix); }
 scene.add(paper, pk); }
/* ---------- horror dressing: blood writing, floor stains, corpses ---------- */
{ const WORDS = ['RUN', 'HE SEES YOU', "DON'T LOOK BACK", 'IT HEARS EVERYTHING', 'NOT ALONE', 'LET ME OUT', 'BEHIND YOU', 'HELP US', 'THEY WATCH', 'TOO LATE', 'HIDE', 'DON\'T BLINK'], texCache = {};
 const writing = (txt) => texCache[txt] ??= (() => { const [c, x] = cv(512, 160); x.font = 'bold 74px "Courier New", monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
   const fs = Math.min(74, 470 / (txt.length * .62)); x.font = `bold ${fs}px "Courier New", monospace`;
   x.shadowColor = '#300'; x.shadowBlur = 8; x.fillStyle = '#8a0c0c'; x.fillText(txt, 256, 62); x.shadowBlur = 0;
   const wd = x.measureText(txt).width; for (let i = 0; i < 14; i++) { const dx2 = 256 - wd / 2 + rnd(Math.max(1, wd | 0)), len = 10 + rnd(70), gr = x.createLinearGradient(0, 70, 0, 70 + len); gr.addColorStop(0, 'rgba(120,8,8,.9)'); gr.addColorStop(1, 'rgba(90,5,5,.0)'); x.fillStyle = gr; x.fillRect(dx2, 70, 2 + rnd(3), len); }
   const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
 const wallSpots = shuffle(cells.filter(([x, y]) => !(x == 1 && y == 1)).flatMap(([x, y]) => D.filter(([a, b]) => !open(x + a, y + b)).map(([a, b]) => [x, y, a, b])));
 const placed = []; for (const [x, y, a, b] of wallSpots) { if (placed.length >= 15) break; const X = wp(x) + a * (CELL / 2 - .03), Z = wp(y) + b * (CELL / 2 - .03);
  if (lockers.some(l => Math.hypot(l.x - X, l.z - Z) < 1.8) || placed.some(p => Math.hypot(p[0] - X, p[1] - Z) < 9)) continue; placed.push([X, Z]);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.3, .72), new THREE.MeshBasicMaterial({map: writing(WORDS[placed.length % WORDS.length]), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, opacity: .85}));
  m.position.set(X, 1.45 + rand() * .55, Z); m.rotation.y = Math.atan2(-a, -b); scene.add(m); }
 const [bc, bx] = cv(128, 128); const bg = bx.createRadialGradient(64, 64, 4, 64, 64, 62); bg.addColorStop(0, 'rgba(70,4,4,.95)'); bg.addColorStop(.6, 'rgba(50,3,3,.7)'); bg.addColorStop(1, 'rgba(40,2,2,0)'); bx.fillStyle = bg; bx.fillRect(0, 0, 128, 128);
 const bt = new THREE.CanvasTexture(bc), bmat = new THREE.MeshBasicMaterial({map: bt, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2});
 for (let i = 0; i < 14; i++) { const c = cells[rnd(cells.length)], m = new THREE.Mesh(new THREE.PlaneGeometry(1 + rand() * 1.8, 1 + rand() * 1.8), bmat); m.rotation.x = -Math.PI / 2; m.rotation.z = rand() * 6; m.position.set(wp(c[0]) + (rand() - .5) * 2.5, .018, wp(c[1]) + (rand() - .5) * 2.5); scene.add(m); }
 const taken = new Set(lockers.map(l => cx(l.x) + ',' + cx(l.z)));
 dead.filter(([x, y]) => !(x == 1 && y == 1) && !(x == EX[0] && y == EX[1]) && !taken.has(x + ',' + y)).slice(0, 4).forEach(([x, y], i) => {
  const av = makeAvatar(['#5b6158', '#6a5a4a', '#4c5666', '#665a5a'][i % 4]); av.g.position.set(wp(x) + (rand() - .5) * 1.2, 0, wp(y) + (rand() - .5) * 1.2); av.g.rotation.y = rand() * 6; poseAvatar(av, 1, 0, true); av.lens.material.color.setHex(0x221a12); scene.add(av.g); }); }
/* ---------- players ---------- */
const P = {x: wp(1), z: wp(1), yaw: 0, pitch: 0, st: 100, tired: false, run: false, hid: null, t: 0};
const players = new Map();
SES.players.forEach((p, i) => {
 const col = AVATAR_COLORS[i % AVATAR_COLORS.length], rec = {id: p.id, name: p.name, color: col, alive: true, esc: false, left: false, hid: -1, run: false, yaw: 0, pitch: 0, vel: 0, me: p.id === ME,
  x: wp(1) + (i % 2 - .5) * .9, z: wp(1) + ((i >> 1) - .5) * .9};
 rec.tx = rec.x; rec.tz = rec.z; rec.tyaw = 0; rec.tpitch = 0;
 if (!rec.me) { rec.av = makeAvatar(col); rec.tag = makeNameTag(p.name, col); rec.av.g.add(rec.tag); scene.add(rec.av.g);
  rec.light = new THREE.PointLight(0xffe8c0, 0, 10, 2); scene.add(rec.light); }
 players.set(p.id, rec); });
const meRec = players.get(ME); P.x = meRec.x; P.z = meRec.z;
const livePlayers = () => [...players.values()].filter(p => p.alive && !p.esc && !p.left);
const syncMe = () => { meRec.x = P.x; meRec.z = P.z; meRec.yaw = P.yaw; meRec.pitch = P.pitch; meRec.hid = P.hid ? P.hid.i : -1; meRec.run = P.run; };

let over = false, playing = false, started = false, ready = false, sentReady = false;
const keys = {}; addEventListener('keydown', e => { keys[e.code] = true; if (e.code == 'KeyE' && playing && canAct()) toggleHide(); if (e.code == 'Space' && playing && spectating()) cycleSpec(); }); addEventListener('keyup', e => keys[e.code] = false);
addEventListener('mousemove', e => { if (document.pointerLockElement && canAct()) { P.yaw -= e.movementX * .0022; P.pitch = Math.max(-1.4, Math.min(1.4, P.pitch - e.movementY * .0022)); } });
addEventListener('mousedown', () => { if (playing && spectating()) cycleSpec(); });
const canAct = () => started && !over && meRec.alive && !meRec.esc && !dying;
const occupied = () => { const s = new Set(); players.forEach(p => { if (!p.me && p.hid >= 0 && p.alive) s.add(p.hid); }); return s; };
const nearLocker = () => { const occ = occupied(); return lockers.filter(l => !l.broken && !occ.has(l.i)).map(l => [l, Math.hypot(l.x - P.x, l.z - P.z)]).filter(a => a[1] < 2).sort((a, b) => a[1] - b[1])[0]?.[0]; };
function toggleHide() { if (P.hid) { const l = P.hid; P.x = l.x + l.f[0] * 1.3; P.z = l.z + l.f[1] * 1.3; P.hid = null; Sound.creak(true); } else { const l = nearLocker(); if (l) { P.hid = l; P.yaw = Math.atan2(-l.f[0], -l.f[1]); P.pitch = 0; Sound.creak(false); } } }
function breakLocker(i) { const l = lockers[i]; if (!l || l.broken) return; l.broken = true; scene.attach(l.door); l.door.position.set(l.x + l.f[0] * 1.6, .3, l.z + l.f[1] * 1.6); l.door.rotation.set(1.4, rnd(3), .4); Sound.bang(l.x, l.z);
 if (P.hid === l) { P.hid = null; P.x = l.x + l.f[0] * 1.3; P.z = l.z + l.f[1] * 1.3; Sound.screech(); kick(.8); } }

/* ---------- monsters ---------- */
const loader = new GLTFLoader(), cache = {}, tmpV = new THREE.Vector3();
let T = 0, capT = 0, cap = '', dying = null, hb = 0, Q = 2, poolT = 0, blackoutT = 0, blackAt = 60 + rr(40), flick = 1, flashV = 0, clk = 0, killerMon = null, specId = null, stepAcc = 0, lockBreath = 3, mT = 0, tenT = 0;
addEventListener('keydown', e => { if (e.code == 'KeyP') { Q = (Q + 1) % 4; applyQ(); say('Quality: ' + ['Potato', 'Low', 'Medium', 'High'][Q] + ' (P to change)', 2.5); } });
const say = (t, s = 3) => { cap = t; capT = s; };
const kick = v => { flashV = Math.max(flashV, v); };
const mons = [
 {k: 'basic', name: 'The Stalker', file: 'basic.glb', h: 2.3, speed: 3.7, sight: 18, hear: 14, yaw: 0, eyes: ['Material.013'], stride: 1.8, w: 1, tip: 'Sprint, break line of sight, or hide in a locker.'},
 {k: 'basic', name: 'The Stalker', file: 'basic.glb', h: 2.3, speed: 3.4, sight: 16, hear: 14, yaw: 0, eyes: ['Material.013'], stride: 1.8, w: 1, tip: 'Sprint, break line of sight, or hide in a locker.'},
 {k: 'spider', name: 'The Spider', file: 'spider.glb', h: 1.4, speed: 7.6, sight: 30, hear: 30, yaw: Math.PI, eyes: ['Eyes'], stride: .6, w: .35, timer: 14, tip: 'When you hear scratching in the walls, get to a locker fast.'}, // the spider model faces -Z, so turn it 180deg
 {k: 'giant', name: 'The Giant', file: 'giant.glb', h: 3.0, speed: 2.3, sight: 22, hear: 20, yaw: 0, eyes: [], stride: 2.6, w: 2.6, tip: 'It is slow, but it rips locker doors off. Keep moving.'},
 {k: 'watcher', name: 'The Watcher', h: 2.7, speed: 5.6, sight: 60, hear: 0, yaw: 0, silent: true, stride: 1, w: .6, tip: 'It only moves when you are not looking at it. Keep it in view.'}];
function buildWatcher() { const gp = new THREE.Group(), sk = new THREE.MeshStandardMaterial({color: 0xcfc6b8, roughness: .95}), bk = new THREE.MeshBasicMaterial({color: 0});
 const add = (geo, mat, x, y, z, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.z = rz; m.castShadow = true; gp.add(m); return m; };
 add(new THREE.CylinderGeometry(.16, .2, 1.3, 8), sk, 0, 1.45, 0); add(new THREE.CylinderGeometry(.06, .08, .5, 6), sk, 0, 2.2, 0);
 add(new THREE.SphereGeometry(.17, 12, 10), sk, 0, 2.55, 0).scale.set(.85, 1.35, .9);
 add(new THREE.SphereGeometry(.035, 6, 6), bk, -.06, 2.6, .14); add(new THREE.SphereGeometry(.035, 6, 6), bk, .06, 2.6, .14); add(new THREE.SphereGeometry(.05, 6, 6), bk, 0, 2.4, .14).scale.y = 2.4;
 [-1, 1].forEach(s => { add(new THREE.CylinderGeometry(.035, .03, 1.9, 5), sk, s * .3, 1.3, .05, s * .12); add(new THREE.CylinderGeometry(.06, .045, 1.1, 6), sk, s * .1, .55, 0); }); return gp; }
mons.forEach((m, i) => { m.i = i; m.g = new THREE.Group(); scene.add(m.g); m.state = 'patrol'; m.wait = 0; m.gone = 0; m.warn = 0; m.emerge = 0; m.active = m.k != 'spider'; m.g.visible = m.active; const c = far(P.x, P.z, 35, rnd); m.x = wp(c[0]); m.z = wp(c[1]);
 m.tx = m.x; m.tz = m.z; m.ry = 0; m.try = 0; m.gry = 0; m.sc = 1; m.px = m.x; m.pz = m.z; m.vel = 0; m.stepT = 0; m.growlT = 6 + Math.random() * 8; m.wasChase = false; m.wasActive = m.active; m.g.position.set(m.x, 0, m.z); });
/* make a loaded model look right: tame Sketchfab metalness (renders black without an env map), glowing eyes, double-sided thin meshes */
function prepModel(o, m) {
 o.traverse(q => { if (!q.isMesh) return; q.castShadow = true; q.receiveShadow = true; q.frustumCulled = false;
  [].concat(q.material).forEach(mt => { if (!mt) return;
   if (mt.metalness !== undefined) mt.metalness = Math.min(mt.metalness, .12);
   if (mt.roughness !== undefined) mt.roughness = Math.max(mt.roughness, .65);
   mt.side = THREE.DoubleSide; if (mt.map) mt.map.anisotropy = 4;
   if (m.eyes && m.eyes.includes(mt.name)) { mt.emissive = new THREE.Color(0xff2410); mt.emissiveIntensity = 3; if (mt.color) mt.color.set(0x220000); }
   mt.needsUpdate = true; }); }); }
Promise.all(mons.map(async m => { if (m.k == 'watcher') { m.g.add(buildWatcher()); m.o = m.g.children[0]; return; }
 try { const gl = await (cache[m.file] ??= loader.loadAsync('assets/models/' + m.file)), o = skClone(gl.scene), b = new THREE.Box3().setFromObject(o), s = b.getSize(new THREE.Vector3()); o.scale.setScalar(m.h / s.y); b.setFromObject(o); const c = b.getCenter(new THREE.Vector3()); o.position.set(-c.x, -b.min.y, -c.z); prepModel(o, m);
  const pivot = new THREE.Group(); pivot.add(o); m.g.add(pivot); m.o = pivot;
  if (gl.animations[0]) { m.mx = new THREE.AnimationMixer(o); m.mx.clipAction(gl.animations[0]).play(); } }
 catch (e) { console.warn('model failed', m.file, e); const b = new THREE.Mesh(new THREE.BoxGeometry(.8, m.h, .8), new THREE.MeshBasicMaterial({color: 0x700000})); b.position.y = m.h / 2; m.g.add(b); } })).then(() => { ready = true; $('sub').textContent = 'Click to begin'; });

/* ----- host-authoritative events (die / locker / scratch / blackout) ----- */
function hostEvent(ev) { if (MP) net.send({t: 'ev', ...ev}); applyEvent(ev); }
function applyEvent(ev) { switch (ev.e) {
 case 'die': onDie(ev.id, ev.mi); break;
 case 'locker': breakLocker(ev.i); break;
 case 'scratch': { say('Something is scratching inside the walls...', 3.2); for (let i = 0; i < 6; i++) setTimeout(() => Sound.scratch(), i * 380); break; }
 case 'blackout': blackoutT = ev.d || 8; say('The lights died.', 3); Sound.bang(P.x + 8, P.z); Sound.groan(P.x - 10, P.z + 6); break; } }
net.on('ev', applyEvent);
function onDie(id, mi) { const p = players.get(id); if (!p || !p.alive) return; p.alive = false; const m = mons[mi] || mons[0];
 if (p.me) { killerMon = m; dying = {m, t: 0}; Sound.screech(); kick(.9); if (P.hid) { P.hid = null; } }
 else { Sound.scream(p.x, p.z); say(`${p.name} was caught by ${m.name}.`, 3.5); if (p.hid >= 0 && lockers[p.hid]) { p.x = p.tx = lockers[p.hid].x + lockers[p.hid].f[0] * 1.2; p.z = p.tz = lockers[p.hid].z + lockers[p.hid].f[1] * 1.2; } p.hid = -1; }
 renderRoster(); checkEnd(); }
function killPlayer(a, m) { if (!a.alive) return; m.state = 'patrol'; m.goal = null; m.wait = 3.5; hostEvent({e: 'die', id: a.id, mi: m.i}); }

/* ----- host runs the monster AI, everyone else just displays it ----- */
const viewing = (a, m) => { const dx = m.x - a.x, dz = m.z - a.z, d = Math.hypot(dx, dz); if (d > 45 || d < .01) return false; if ((dx * -Math.sin(a.yaw) + dz * -Math.cos(a.yaw)) / d < Math.cos(.95)) return false; return los(a.x, a.z, m.x, m.z); };
function updMon(m, dt, acts) {
 const allHid = acts.every(a => a.hid >= 0), nearest = acts.slice().sort((p, q) => Math.hypot(p.x - m.x, p.z - m.z) - Math.hypot(q.x - m.x, q.z - m.z))[0];
 if (!m.active) { // spider: timer -> scratching warning -> emerges from a wall
  if (T < 20) return;
  if (!m.warn) { m.timer -= dt; if (m.timer <= 0 && !allHid) { m.warn = 2.4; hostEvent({e: 'scratch'}); } return; }
  m.warn -= dt;
  if (m.warn <= 0) { m.warn = 0; const vic = acts.filter(a => a.hid < 0), a = vic.length ? vic[rr(vic.length)] : acts[0],
   cs = cells.filter(([x, y]) => { const d = Math.hypot(wp(x) - a.x, wp(y) - a.z); return d > 9 && d < 18 && D.some(([p, q]) => !open(x + p, y + q)); }), c = cs.length ? cs[rr(cs.length)] : far(a.x, a.z, 12);
   m.x = wp(c[0]); m.z = wp(c[1]); m.active = true; m.state = 'chase'; m.goal = [cx(a.x), cx(a.z)]; m.emerge = 1.4; m.gone = 0; m.sc = .05; }
  return; }
 if (m.emerge > 0) { m.emerge -= dt; m.sc = Math.max(.05, 1 - m.emerge / 1.4); m.ry = Math.atan2(nearest.x - m.x, nearest.z - m.z) + m.yaw; return; }
 m.sc = 1; const grace = T < 8;
 let tgt = null, td = 1e9, seen = false;
 for (const a of acts) { if (a.hid >= 0) continue; const d = Math.hypot(a.x - m.x, a.z - m.z), sees = !grace && d < m.sight && los(m.x, m.z, a.x, a.z), hears = !grace && a.run && d < m.hear;
  if ((sees || hears || (m.k == 'watcher' && !grace)) && d < td) { td = d; tgt = a; seen = sees; } }
 if (tgt) { m.state = 'chase'; m.goal = [cx(tgt.x), cx(tgt.z)]; m.wait = 0; m.gone = 0; }
 if (m.k == 'giant' && m.state == 'chase') for (const a of acts) { const l = a.hid >= 0 && lockers[a.hid]; if (l && !l.broken && Math.hypot(l.x - m.x, l.z - m.z) < 3) hostEvent({e: 'locker', i: l.i}); }
 if (m.k == 'watcher') { const v = acts.find(a => a.hid < 0 && viewing(a, m)); if (v) { m.ry = Math.atan2(v.x - m.x, v.z - m.z) + m.yaw; return; } } // frozen while anyone is looking at it
 if (m.wait > 0) { m.wait -= dt; }
 else { const mc = [cx(m.x), cx(m.z)];
  if (!m.goal || (mc[0] == m.goal[0] && mc[1] == m.goal[1] && !tgt)) { if (m.state == 'chase') { m.state = 'patrol'; m.wait = m.k == 'spider' ? 0 : 2.5; } const c = far(m.x, m.z, 12); m.goal = [c[0], c[1]]; }
  const key = mc[0] + ',' + mc[1] + '>' + m.goal[0] + ',' + m.goal[1]; if (m.nk !== key) { m.nk = key; m.ns = nextStep(mc[0], mc[1], m.goal[0], m.goal[1]); } const n = m.ns; let tx, tz; if (n) { tx = wp(n[0]); tz = wp(n[1]); } else if (tgt) { tx = tgt.x; tz = tgt.z; }
  if (tx !== undefined) { const dx = tx - m.x, dz = tz - m.z, l = Math.hypot(dx, dz) || 1, sp = m.speed * (m.state == 'chase' ? 1 : .55) * dt; m.x += dx / l * Math.min(sp, l); m.z += dz / l * Math.min(sp, l); m.ry = Math.atan2(dx, dz) + m.yaw; } }
 if (m.k == 'spider' && m.state == 'patrol' && (m.gone += dt) > 6) { m.active = false; m.timer = 12 + rr(8); return; }
 for (const a of acts) if (a.hid < 0 && Math.hypot(a.x - m.x, a.z - m.z) < .95) { killPlayer(a, m); break; } }
net.on('mons', msg => { if (isHost()) return; msg.m.forEach((a, i) => { const m = mons[i]; if (!m) return; m.tx = a[0]; m.tz = a[1]; m.try = a[2]; m.active = !!a[3]; m.sc = a[4]; m.state = a[5] ? 'chase' : 'patrol'; if (!m.g.visible || Math.hypot(m.tx - m.x, m.tz - m.z) > 6) { m.x = m.tx; m.z = m.tz; } }); });

/* smooth display + procedural animation + monster audio (runs on every client) */
function showMons(dt, sim) {
 const host = isHost();
 mons.forEach(m => {
  if (!host) { const k = Math.min(1, dt * 12); m.x += (m.tx - m.x) * k; m.z += (m.tz - m.z) * k; m.ry = m.try; } else { m.tx = m.x; m.tz = m.z; }
  m.g.visible = m.active; m.gry = lerpAng(m.gry, m.ry, Math.min(1, dt * 10)); m.g.rotation.y = m.gry; m.g.position.set(m.x, 0, m.z); m.g.scale.setScalar(m.sc);
  m.vel += (Math.hypot(m.x - m.px, m.z - m.pz) / Math.max(dt, 1e-3) - m.vel) * Math.min(1, dt * 6); m.px = m.x; m.pz = m.z;
  const d = Math.hypot(P.x - m.x, P.z - m.z), mv = clamp(m.vel / m.speed, 0, 1.6);
  if (m.mx && sim && m.active && d < 30) { m.mx.timeScale = .55 + mv * .9; m.mx.update(dt); }
  if (m.o && m.k == 'basic') { m.o.rotation.z = Math.sin(clk * 2.2 + m.i) * .04 * (1 + mv); m.o.rotation.x = (m.state == 'chase' ? .16 : .05) * mv; m.o.position.y = Math.abs(Math.sin(clk * (3 + mv * 4) + m.i)) * .07 * mv; }
  if (m.o && m.k == 'spider') { m.o.position.y = Math.sin(clk * 42) * .025 * mv; m.o.rotation.z = Math.sin(clk * 30) * .05 * mv; m.o.rotation.x = Math.sin(clk * 3) * .02; }
  if (m.o && m.k == 'watcher') { m.o.rotation.z = Math.sin(clk * .8) * .02; }
  // reactions: spider bursting out of the wall, a monster starting to hunt you
  if (m.active && !m.wasActive && m.k == 'spider') { Sound.screech(); kick(.7); }
  m.wasActive = m.active;
  const chase = m.state == 'chase' && m.active && !m.emerge;
  if (chase && !m.wasChase && d < 32) { Sound.sting(); if (!m.silent) Sound.growl(m.x, m.z, m.k == 'giant' ? 1.8 : m.k == 'spider' ? .55 : 1); if (d < 20) kick(.35); }
  m.wasChase = chase;
  if (m.active && !m.silent && d < 24) { m.stepT -= dt * Math.min(m.vel, 9); if (m.stepT <= 0) { m.stepT = m.stride; Sound.step(m.x, m.z, .06 + .4 * (1 - d / 24), m.w); }
   m.growlT -= dt; if (m.growlT <= 0) { m.growlT = 7 + Math.random() * 9; if (d < 28) Sound.growl(m.x, m.z, m.k == 'giant' ? 1.6 : .9); } } }); }

/* ---------- the shadow figure: appears at the end of a corridor, gone when you look closer ---------- */
const gm = new THREE.MeshBasicMaterial({color: 0x000000, transparent: true, opacity: 0}), ghost = buildWatcher(); ghost.traverse(q => { if (q.isMesh) { q.material = gm; q.castShadow = false; } }); ghost.visible = false; scene.add(ghost);
let ghostT = 45 + rr(45), ghostLife = 0;
function updGhost(dt) {
 if (ghostLife > 0) { ghostLife -= dt; gm.opacity = Math.min(.92, gm.opacity + dt * 1.6); ghost.rotation.y = Math.atan2(P.x - ghost.position.x, P.z - ghost.position.z);
  if (ghostLife <= 0 || Math.hypot(P.x - ghost.position.x, P.z - ghost.position.z) < 8) { ghostLife = 0; ghost.visible = false; gm.opacity = 0; Sound.bang(ghost.position.x, ghost.position.z); Sound.whisper(P.x + 1, P.z - 1); kick(.5); flick = .05; } return; }
 ghostT -= dt; if (ghostT > 0 || P.hid || T < 30 || blackoutT > 0) return;
 const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), cs = cells.filter(([x, y]) => { const dx = wp(x) - P.x, dz = wp(y) - P.z, d = Math.hypot(dx, dz); return d > 12 && d < 22 && (dx * fx + dz * fz) / d > .82 && los(P.x, P.z, wp(x), wp(y)); });
 if (!cs.length) { ghostT = 6; return; } const c = cs[rr(cs.length)]; ghost.position.set(wp(c[0]), 0, wp(c[1])); ghost.visible = true; gm.opacity = 0; ghostLife = 4.5; ghostT = 60 + rr(70); Sound.sting(); }

/* ---------- spectating ---------- */
const spectating = () => (!meRec.alive || meRec.esc) && !dying && !over;
const specList = () => livePlayers().filter(p => !p.me);
function cycleSpec() { const l = specList(); if (!l.length) return; const i = l.findIndex(p => p.id === specId); specId = l[(i + 1) % l.length].id; }
function renderRoster() { $('roster').innerHTML = players.size > 1 ? [...players.values()].map(p => `<span class="${!p.alive || p.left ? 'dead' : p.esc ? 'esc' : ''}" style="color:${p.color}">${p.alive && !p.esc && !p.left ? '●' : p.esc ? '✔' : '✝'} ${escHtml(p.name)}</span>`).join('') : ''; }
function checkEnd() { if (over || livePlayers().length) return; if (dying) return; finish(); }
function finish() { if (over) return; over = true; document.exitPointerLock(); $('slats').style.display = 'none'; $('spec').textContent = '';
 const all = [...players.values()], esc = all.filter(p => p.esc), solo = all.length == 1; let title, msg, tip = '';
 if (meRec.esc) { title = 'YOU ESCAPED'; msg = solo ? 'You found the way out.' : `${esc.length} of ${all.length} made it out.`; }
 else { title = solo ? 'YOU DIED' : esc.length ? 'YOU DIED' : 'NO ONE ESCAPED'; msg = solo ? `${killerMon ? killerMon.name : 'Something'} got you.` : esc.length ? `${esc.map(p => escHtml(p.name)).join(', ')} escaped without you.` : 'The Substructure keeps everyone.'; tip = killerMon ? killerMon.tip : ''; }
 $('ov').innerHTML = `<h1>${title}</h1><p>${msg}</p><p class="k">${tip}</p><p class="k">Click to ${MP ? 'return to the lobby' : 'try again'}</p>`; $('ov').style.display = 'flex'; }
net.on('st', m => { const p = players.get(m.id); if (!p || p.me) return; p.tx = m.x; p.tz = m.z; p.tyaw = m.yaw; p.tpitch = m.pitch; p.hid = m.h; p.run = !!m.r; });
net.on('esc', m => { const p = players.get(m.id); if (!p || p.esc) return; p.esc = true; say(`${p.name} escaped!`, 3.5); renderRoster(); checkEnd(); });
net.on('left', m => { const p = players.get(m.id); if (!p || p.left) return; p.left = true; p.alive = false; if (p.av) p.av.g.visible = false; if (p.light) p.light.intensity = 0; say(`${p.name} left the maze.`, 3); renderRoster(); checkEnd(); });
net.on('go', () => { started = true; T = 0; say('', 0); $('ovmp').textContent = ''; players.forEach(p => { if (!net.state.members.some(x => x.id === p.id) && !p.me) { p.left = true; p.alive = false; if (p.av) p.av.g.visible = false; } }); renderRoster(); });
net.on('ready', m => { if (!started && sentReady) say(`Waiting for the others... (${m.n}/${m.total} ready)`, 99); });
net.on('disconnect', () => { if (over) return; over = true; document.exitPointerLock(); $('ov').innerHTML = '<h1>DISCONNECTED</h1><p>The connection to the server was lost.</p><p class="k">Click to return to the lobby</p>'; $('ov').style.display = 'flex'; });

/* ---------- post fx + dust ---------- */
let comp = null; try { comp = new EffectComposer(ren); comp.setPixelRatio(Math.min(devicePixelRatio, 1.5)); comp.addPass(new RenderPass(scene, cam)); comp.addPass(new GTAOPass(scene, cam, innerWidth, innerHeight)); comp.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .45, .7, .82)); comp.addPass(new OutputPass()); } catch (e) { console.warn('post fx off', e); comp = null; }
addEventListener('resize', () => comp && comp.setSize(innerWidth, innerHeight));
const dp = new Float32Array(900), dg = new THREE.BufferGeometry(); for (let i = 0; i < 900; i += 3) { dp[i] = P.x + (Math.random() - .5) * 14; dp[i + 1] = Math.random() * H; dp[i + 2] = P.z + (Math.random() - .5) * 14; } dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
const dust = new THREE.Points(dg, new THREE.PointsMaterial({color: 0xffe6c0, size: .025, transparent: true, opacity: .45, depthWrite: false, blending: THREE.AdditiveBlending})); scene.add(dust);
/* ---------- overlay / pointer lock ---------- */
$('ov').onclick = () => { Sound.init(); if (over) return location.href = location.pathname; if (!ready) return; ren.domElement.requestPointerLock();
 if (!sentReady) { sentReady = true; if (MP) { net.send({t: 'ready'}); say('Waiting for the others...', 99); } else { started = true; } } };
document.addEventListener('pointerlockchange', () => { playing = !!document.pointerLockElement; if (!over) { $('ov').style.display = playing ? 'none' : 'flex'; if (!playing && started) $('sub').textContent = MP ? 'The maze does not wait for you. Click to resume' : 'Paused. Click to resume'; } });
$('ov').style.display = 'flex';
if (MP) $('ovmp').textContent = `Party ${SES.code} · ${SES.players.length} players. The maze starts when everyone has clicked.`;
renderRoster();
const QL = [{dpr: .6, sh: 0, lamps: 1, dust: 0, bump: 0, glow: 0}, {dpr: .85, sh: 0, lamps: 2, dust: 1, bump: 0, glow: 1}, {dpr: 1, sh: 1, lamps: 3, dust: 1, bump: 1, glow: 1}, {dpr: 1.25, sh: 1, lamps: 3, dust: 1, bump: 1, glow: 1}], wbT = wm.material.bumpMap, fbT = fl.material.bumpMap;
function applyQ() { const q = QL[Q], r = Math.min(devicePixelRatio, q.dpr); ren.setPixelRatio(r); ren.setSize(innerWidth, innerHeight); if (comp) { comp.setPixelRatio(r); comp.setSize(innerWidth, innerHeight); }
 ren.shadowMap.enabled = !!q.sh; fls.castShadow = !!q.sh; if (fls.shadow.map) { fls.shadow.map.dispose(); fls.shadow.map = null; } fls.shadow.mapSize.set(Q >= 3 ? 1024 : 512, Q >= 3 ? 1024 : 512);
 wm.material.bumpMap = q.bump ? wbT : null; fl.material.bumpMap = q.bump ? fbT : null; glow.visible = !!q.glow; dust.visible = !!q.dust; poolT = 0;
 scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); }); }
applyQ(); let fpsA = 0, fpsN = 0, fpsT = 0, sendT = 0, rosterT = 0;
const clock = new THREE.Clock(), vig = $('vig'), glitch = $('glitch'), flashEl = $('flash'), slats = $('slats'), hint = $('hint'), specEl = $('spec'), stBar = $('st').firstElementChild;
/* debug hook: open the game with ?debug to inspect state from the browser console (window.__ss) */
if (new URLSearchParams(location.search).has('debug')) window.__ss = {g, P, players, mons, lockers, EX, ME, scene, get T() { return T; }, get over() { return over; }, get started() { return started; }, get dying() { return dying; }, get blackoutT() { return blackoutT; }, get ghostLife() { return ghostLife; }};
/* ---------- loop ---------- */
(function loop() { requestAnimationFrame(loop); const dt = Math.min(clock.getDelta(), .1); clk += dt;
 const sim = started && !over && (MP || playing);
 syncMe();
 if (sim) { T += dt;
  const alive = meRec.alive && !meRec.esc && !dying;
  /* --- my movement --- */
  if (alive && playing) {
   const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), mv = (f || s) && !P.hid;
   P.run = !!(keys.ShiftLeft || keys.ShiftRight) && mv && !P.tired && P.st > 0;
   P.st = Math.max(0, Math.min(100, P.st + (P.run ? -22 : 14) * dt)); if (P.st <= 0) P.tired = true; if (P.st > 30) P.tired = false;
   if (mv) { const sp = (P.run ? 5.6 : 3) * dt, l = Math.hypot(f, s), sy = Math.sin(P.yaw), cy = Math.cos(P.yaw), vx = (-sy * f + cy * s) / l * sp, vz = (-cy * f - sy * s) / l * sp;
    if (!hit(P.x + vx, P.z, .35)) P.x += vx; if (!hit(P.x, P.z + vz, .35)) P.z += vz; P.t += dt * (P.run ? 11 : 7); stepAcc += dt * (P.run ? 2.9 : 1.9); if (stepAcc >= 1) { stepAcc = 0; Sound.ownStep(P.run); } } }
  else P.run = false;
  syncMe();
  /* --- monsters: the host simulates, others receive --- */
  if (isHost()) { const acts = livePlayers(); if (acts.length) mons.forEach(m => updMon(m, dt, acts));
   if (MP && (mT -= dt) <= 0) { mT = 1 / 12; net.send({t: 'mons', m: mons.map(m => [+m.x.toFixed(2), +m.z.toFixed(2), +m.ry.toFixed(2), m.active ? 1 : 0, +m.sc.toFixed(2), m.state == 'chase' ? 1 : 0])}); }
   if (T > 40 && (blackAt -= dt) <= 0 && acts.length) { blackAt = 70 + rr(60); hostEvent({e: 'blackout', d: 7 + rr(6)}); } }
  /* --- tell the others where I am --- */
  if (MP && (sendT -= dt) <= 0 && alive) { sendT = 1 / 15; net.send({t: 'st', x: +P.x.toFixed(2), z: +P.z.toFixed(2), yaw: +P.yaw.toFixed(3), pitch: +P.pitch.toFixed(3), h: P.hid ? P.hid.i : -1, r: P.run ? 1 : 0}); }
  /* --- exit --- */
  if (alive && Math.hypot(P.x - exitL.position.x, P.z - exitL.position.z) < 1.4) { meRec.esc = true; if (MP) net.send({t: 'esc'}); say('You found the way out.', 3); renderRoster(); checkEnd(); }
  updGhost(dt); }
 /* --- display other players (always, even paused) --- */
 players.forEach(p => { if (p.me || p.left) return; const k = Math.min(1, dt * 14), ox = p.x, oz = p.z; p.x += (p.tx - p.x) * k; p.z += (p.tz - p.z) * k; p.yaw = lerpAng(p.yaw, p.tyaw, k); p.pitch += (p.tpitch - p.pitch) * k; p.vel += (Math.hypot(p.x - ox, p.z - oz) / Math.max(dt, 1e-3) - p.vel) * Math.min(1, dt * 8);
  const av = p.av, d = Math.hypot(P.x - p.x, P.z - p.z), gone = p.esc || (p.hid >= 0 && p.alive);
  av.g.visible = !gone; av.g.position.set(p.x, 0, p.z); av.g.rotation.y = p.yaw + Math.PI; poseAvatar(av, dt, p.vel, !p.alive);
  p.tag.visible = p.alive && !gone; p.tag.material.opacity = clamp(1.4 - d / 9, 0, 1);
  p.light.position.set(p.x - Math.sin(p.yaw) * 1.1, 1.45, p.z - Math.cos(p.yaw) * 1.1); p.light.intensity = p.alive && !gone ? 5 * (blackoutT > 0 ? 1.4 : 1) : 0; });
 /* --- monsters on screen --- */
 if (started) showMons(dt, sim);
 /* --- fear: distance to the nearest active monster drives vignette, heartbeat, shake, glitch, music --- */
 let md = 99, hunted = false; mons.forEach(m => { if (m.active && m.sc > .9) { const d = Math.hypot(P.x - m.x, P.z - m.z); md = Math.min(md, d); if (m.state == 'chase' && d < 30) hunted = true; } });
 const fear = started && !over && meRec.alive && !meRec.esc ? clamp(1 - md / 16, 0, 1) : 0, tension = Math.max(fear, hunted ? .35 : 0);
 if (sim) { capT -= dt; const near = canAct() ? nearLocker() : null; hint.textContent = capT > 0 ? cap : meRec.esc || !meRec.alive ? '' : P.hid ? 'E: leave locker' : near ? 'E: hide' : '';
  hb -= dt; if (hb <= 0 && md < 22 && meRec.alive) { Sound.heart(.45 * (1 - md / 22) + .08); hb = .35 + md / 22 * .9; }
  if (P.hid) { lockBreath -= dt; if (lockBreath <= 0) { lockBreath = md < 10 ? .55 : 1.7; Sound.breathing(md < 10); const near = mons.find(m => m.active && Math.hypot(P.x - m.x, P.z - m.z) < 7); if (near) Sound.breath(near.x, near.z); } } }
 vig.style.opacity = Math.max(0, Math.min(.92, (1 - md / 14) + (P.tired ? .15 : 0) + (hb > .25 ? .05 : 0) * fear)); glitch.style.opacity = clamp((tension - .55) * 2.2, 0, 1);
 if (!sim && !over) hint.textContent = capT > 0 ? cap : '';
 slats.style.display = P.hid && !over ? 'block' : 'none'; flashV = Math.max(0, flashV - dt * 2.2); flashEl.style.opacity = flashV;
 if ((tenT -= dt) <= 0) { tenT = .25; Sound.setTension(tension); } Sound.tick(dt, tension, P.x, P.z);
 /* --- flashlight: dies and flickers when something is near, and during blackouts --- */
 blackoutT = Math.max(0, blackoutT - dt);
 let target = 1; if (tension > .3 && Math.random() < tension * .12) target = Math.random() * .25; if (blackoutT > 0 && Math.random() < .08) target = Math.random() * .3; if (Math.random() < .002) target = .1;
 flick += (target - flick) * Math.min(1, dt * (target < flick ? 40 : 9)); fls.intensity = 90 * flick; glow.intensity = 4 * flick;
 hemi.intensity = HEMI * (blackoutT > 0 ? .12 : 1) * (.85 + .15 * flick);
 /* --- ending: death cam toward the thing killing you --- */
 if (dying) { dying.t += dt; const m = dying.m; let dy = Math.atan2(-(m.x - P.x), -(m.z - P.z)) - P.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); P.yaw += dy * Math.min(1, dt * 10); P.pitch *= .9;
  cam.fov = 75 - Math.min(dying.t, 1.4) * 20; cam.updateProjectionMatrix(); if (dying.t > 1.5) { dying = null; cam.fov = 75; cam.updateProjectionMatrix(); checkEnd(); if (!over) { const l = specList(); specId = l.length ? l[0].id : null; } } }
 /* --- camera --- */
 let lx = P.hid ? P.hid.x : P.x, lz = P.hid ? P.hid.z : P.z, ly = P.hid ? 1.5 : 1.65 + Math.sin(P.t) * .04, yaw = P.yaw, pitch = P.pitch;
 if (spectating()) { let tp = players.get(specId); if (!tp || !tp.alive || tp.esc || tp.left) { const l = specList(); tp = l[0]; specId = tp ? tp.id : null; }
  if (tp) { lx = tp.x; lz = tp.z; yaw = tp.yaw; pitch = tp.pitch; ly = 1.65; specEl.textContent = `${meRec.esc ? 'You escaped' : 'You died'} - watching ${tp.name}  (click / space: next)`; } }
 else specEl.textContent = '';
 const shk = dying ? (Math.random() - .5) * .04 : fear > .6 ? (Math.random() - .5) * .012 * fear : 0;
 cam.position.set(lx + shk, ly + shk, lz); cam.rotation.set(pitch, yaw, P.tired ? Math.sin(clk * 3) * .02 : Math.sin(clk * .6) * .006); cam.updateMatrixWorld();
 if (!dying) { const fv = 75 - fear * 7 + (P.run ? 3 : 0); if (Math.abs(cam.fov - fv) > .05) { cam.fov += (fv - cam.fov) * Math.min(1, dt * 4); cam.updateProjectionMatrix(); } }
 Sound.listener(lx, lz, yaw);
 for (let i = 0; i < 900; i += 3) { dp[i] += Math.sin(T + i) * .002; dp[i + 1] += Math.cos(T * .7 + i) * .0015; if (Math.abs(dp[i] - P.x) > 7 || Math.abs(dp[i + 2] - P.z) > 7) { dp[i] = P.x + (Math.random() - .5) * 12; dp[i + 2] = P.z + (Math.random() - .5) * 12; dp[i + 1] = Math.random() * H; } } dg.attributes.position.needsUpdate = true;
 poolT -= dt; if (poolT <= 0) { poolT = .25; const q = QL[Q], so = lamps.slice().sort((a, b) => ((a.p.x - P.x) ** 2 + (a.p.z - P.z) ** 2) - ((b.p.x - P.x) ** 2 + (b.p.z - P.z) ** 2)); pool.forEach((l, i) => { l.position.copy(so[i].p); l.color.set(so[i].cold ? 0x6f8fb5 : 0xffa860); l.base = so[i].cold ? 2.2 : 3.4; l.visible = i < q.lamps; }); }
 pool.forEach(l => { l.intensity = blackoutT > 0 ? 0 : Math.random() < .02 + tension * .05 ? l.base * Math.random() * .2 : l.base; }); stBar.style.width = P.st + '%';
 if (sim && T > 3) { fpsA += dt; fpsN++; fpsT += dt; if (fpsT > 2.5) { const f = fpsN / fpsA; fpsA = fpsN = 0; fpsT = 0; if (f < 28 && Q > 0) { Q--; applyQ(); fpsT = -2; say('Lowered quality to keep it smooth (P to change)', 3.5); } } }
 if (comp && Q >= 3) { try { comp.render(); } catch (e) { console.warn('post fx failed', e); comp = null; ren.render(scene, cam); } } else ren.render(scene, cam); })();

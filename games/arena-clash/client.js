// ============================================================================
// ARENA CLASH - client
// Handles: rendering (three.js), local first-person movement/camera/weapons,
// remote player interpolation, UI/screen flow, and networking to the
// "/arena" Socket.IO namespace on the Boblox hub server.
//
// LOADOUT: 5 slots, selected with number keys 1-5, used with left click:
//   1 Impulse Rifle (primary)   2 Impulse Sidearm (secondary)
//   3 Fist (melee)              4 Kinetic Boost (movement utility)
//   5 Frag Charge (grenade)
//
// NOTE ON AUTHORITY: this client SIMULATES its own movement locally for
// responsiveness and reports its transform to the server (~15Hz). The
// server sanity-checks reported speed but does not fully re-simulate
// physics yet (see server-side arenaServer.js header comment + chat
// writeup "known limitations"). Health, damage, elimination, wall/cover
// occlusion, and round/match outcomes are decided entirely by the server -
// this client never sets its own health or declares its own kills. The
// Kinetic Boost is the one exception: it's a pure movement ability with no
// combat effect, so it's applied locally with no server round-trip.
// ============================================================================

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // CONFIG (kept here, data-driven, instead of scattered through the code)
  // ---------------------------------------------------------------------
  const MovementConfig = {
    walkSpeed: 6.0,
    sprintSpeed: 9.6,
    crouchSpeed: 3.4,
    slideSpeed: 13.5,
    slideDuration: 0.5,
    slideCooldown: 0.75,
    acceleration: 46,
    deceleration: 58,
    airControl: 0.32,
    jumpPower: 7.4,
    gravity: 20.5,
    eyeHeight: 1.7,
    crouchHeight: 1.15,
    jumpBufferTime: 0.12,
    coyoteTime: 0.1
  };

  const CameraConfig = {
    baseFov: 90,
    sprintFov: 97,
    focusFov: 76,
    sensX: 0.0022,
    sensY: 0.0022,
    bobAmplitude: 0.045,
    bobFrequency: 10
  };

  // slot -> weapon id, matches the server's EquipmentDatabase ids exactly
  // (except kinetic_boost, which is client-only - see header note).
  const SLOT_ORDER = ['impulse_rifle', 'impulse_pistol', 'fist', 'kinetic_boost', 'frag_charge'];

  const WeaponDatabase = {
    impulse_rifle: { id: 'impulse_rifle', name: 'RIFLE', short: '1', kind: 'gun', auto: true, cooldown: 0.11, range: 85, color: 0x9fd0ff },
    impulse_pistol: { id: 'impulse_pistol', name: 'SIDEARM', short: '2', kind: 'gun', auto: false, cooldown: 0.22, range: 60, color: 0x9fd0ff },
    fist: { id: 'fist', name: 'FIST', short: '3', kind: 'melee', cooldown: 0.55, range: 3.2, color: 0xffd27a },
    kinetic_boost: { id: 'kinetic_boost', name: 'BOOST', short: '4', kind: 'boost', cooldown: 8, color: 0x7dffb0 },
    frag_charge: { id: 'frag_charge', name: 'GRENADE', short: '5', kind: 'grenade', cooldown: 5, range: 22, color: 0xff8a4a }
  };

  const TEAM_COLOR = { A: 0x5a9bd6, B: 0xd97a3f };

  // ---------------------------------------------------------------------
  // UI / screen management
  // ---------------------------------------------------------------------
  const screens = {};
  ['menu', 'mode', 'queue', 'loading', 'clicktoplay', 'matchend'].forEach(name => {
    screens[name] = document.getElementById('screen-' + name);
  });
  function showScreen(name) {
    Object.values(screens).forEach(el => el.classList.remove('active'));
    const errEl = document.getElementById('screen-connection-error');
    if (errEl) errEl.classList.remove('active');
    if (name && screens[name]) screens[name].classList.add('active');
  }
  const hud = document.getElementById('hud');
  function setHudActive(active) { hud.classList.toggle('active', active); }

  // ---------------------------------------------------------------------
  // Networking
  // ---------------------------------------------------------------------
  const token = sessionStorage.getItem('boblox_token');
  if (!token) {
    document.body.innerHTML = '<div style="padding:60px;text-align:center;font-family:sans-serif;color:#fff;background:#05060a;height:100vh;">' +
      '<h2>Please launch Arena Clash from the Boblox hub.</h2>' +
      '<a href="/" style="color:#5a9bd6;">Return to hub</a></div>';
    throw new Error('No session token found');
  }
  const socket = io('/arena', { auth: { token } });

  let myKey = null;
  let myTeam = 'A';
  let matchState = 'LOBBY';
  let currentMode = '1v1';

  // myKey must exist from the moment the socket connects, not from whenever
  // 'match:found' happens to arrive - the server's very first spawn message
  // for a match (player:you / player:spawnAll) is actually sent BEFORE
  // match:found, so relying on match:found to set myKey meant the client
  // failed to recognize itself in that first spawnAll and rendered a
  // duplicate "ghost" copy of its own player.
  socket.on('connect', () => { myKey = socket.id; });

  function showConnectionError(message) {
    Object.values(screens).forEach(el => el.classList.remove('active'));
    setHudActive(false);
    let el = document.getElementById('screen-connection-error');
    if (!el) {
      el = document.createElement('div');
      el.id = 'screen-connection-error';
      el.className = 'screen';
      el.innerHTML = '<div class="menu-panel"><h2>Connection problem</h2>' +
        '<p class="tagline" id="connection-error-text"></p>' +
        '<button id="btn-connection-reload" class="btn-primary">Reload</button>' +
        '<a href="/" class="btn-secondary">Return to Hub</a></div>';
      document.body.appendChild(el);
      document.getElementById('btn-connection-reload').onclick = () => window.location.reload();
    }
    document.getElementById('connection-error-text').textContent = message;
    el.classList.add('active');
  }

  socket.on('connect_error', (err) => {
    showConnectionError('Could not reach the match server (' + err.message + '). This usually means your session expired - try reloading, or log back in from the hub.');
  });

  socket.on('disconnect', (reason) => {
    if (reason === 'io client disconnect') return; // we initiated it (e.g. navigating away)
    if (screens.queue.classList.contains('active') || inMatch()) {
      showConnectionError('Lost connection to the match server (' + reason + '). Try reloading.');
    }
  });

  // ---------------------------------------------------------------------
  // Menu wiring
  // ---------------------------------------------------------------------
  document.getElementById('btn-play').onclick = () => showScreen('mode');
  document.getElementById('btn-mode-back').onclick = () => showScreen('menu');
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.onclick = () => {
      currentMode = btn.dataset.mode;
      document.getElementById('queue-mode-label').textContent = currentMode.toUpperCase() + ' DUEL';
      showScreen('queue');
      queueStart = Date.now();
      socket.emit('queue:join', { mode: currentMode });
    };
  });
  document.getElementById('btn-queue-cancel').onclick = () => {
    socket.emit('queue:leave');
    showScreen('mode');
  };
  document.getElementById('btn-play-again').onclick = () => showScreen('mode');

  let queueStart = 0;
  setInterval(() => {
    if (screens.queue.classList.contains('active')) {
      const s = Math.floor((Date.now() - queueStart) / 1000);
      document.getElementById('queue-timer').textContent =
        String(Math.floor(s / 60)) + ':' + String(s % 60).padStart(2, '0');
      document.getElementById('queue-dots').textContent = '.'.repeat((s % 3) + 1);
      // The server always finds you a match (with a bot if needed) within
      // ~11-12 seconds. Taking far longer than that means something is
      // actually wrong (dropped connection, server issue) - say so instead
      // of spinning forever with no explanation.
      if (s >= 25) {
        showConnectionError('Still searching after ' + s + 's - that\'s much longer than normal. Your connection to the match server may have dropped. Try reloading.');
      }
    }
  }, 400);

  // ---------------------------------------------------------------------
  // three.js scene setup - grounded/tactical look: muted concrete-and-steel
  // palette, clear sightlines, minimal clutter, sunlit rather than neon.
  // ---------------------------------------------------------------------
  const wrap = document.getElementById('canvas-wrap');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1e22);
  scene.fog = new THREE.Fog(0x1b1e22, 35, 130);

  const camera = new THREE.PerspectiveCamera(CameraConfig.baseFov, window.innerWidth / window.innerHeight, 0.1, 400);
  scene.add(camera); // required so the camera-attached viewmodel (see below) actually gets rendered
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  wrap.appendChild(renderer.domElement);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  scene.add(new THREE.AmbientLight(0xaab0bb, 0.55));
  scene.add(new THREE.HemisphereLight(0x9fb4c9, 0x2a2620, 0.55));
  const sun = new THREE.DirectionalLight(0xfff2da, 0.85);
  sun.position.set(30, 60, -20);
  scene.add(sun);
  // faint team-tinted wayfinding lights at each spawn only - not blanket neon
  const spawnLightA = new THREE.PointLight(TEAM_COLOR.A, 0.9, 30);
  spawnLightA.position.set(-40, 6, -40);
  scene.add(spawnLightA);
  const spawnLightB = new THREE.PointLight(TEAM_COLOR.B, 0.9, 30);
  spawnLightB.position.set(40, 6, 40);
  scene.add(spawnLightB);

  // ---------------------------------------------------------------------
  // First-person viewmodel (the "gun in your hand"). Reads a shared
  // right/left-hand preference set from the Boblox hub's Settings screen
  // (stored in localStorage under 'boblox_settings' - same origin, so both
  // pages see it). Defaults to right-handed if never set.
  // ---------------------------------------------------------------------
  function getGunHand() {
    try {
      const raw = localStorage.getItem('boblox_settings');
      if (!raw) return 'right';
      const parsed = JSON.parse(raw);
      return (parsed && parsed.gunHand === 'left') ? 'left' : 'right';
    } catch (e) { return 'right'; }
  }
  const gunHand = getGunHand();

  function buildGunMesh(accentColor) {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.4 });
    const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, emissive: accentColor, emissiveIntensity: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.13, 0.5), bodyMat);
    body.position.set(0, 0, -0.1);
    g.add(body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.32), accentMat);
    barrel.position.set(0, 0.015, -0.5);
    g.add(barrel);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.09), bodyMat);
    grip.position.set(0, -0.15, 0.08);
    grip.rotation.x = 0.35;
    g.add(grip);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), bodyMat);
    mag.position.set(0, -0.13, -0.06);
    g.add(mag);
    return g;
  }

  const gunModel = buildGunMesh(WeaponDatabase.impulse_rifle.color);
  const pistolModel = buildGunMesh(WeaponDatabase.impulse_pistol.color);
  pistolModel.scale.setScalar(0.68);
  const grenadeModel = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 10),
    new THREE.MeshStandardMaterial({ color: WeaponDatabase.frag_charge.color, emissive: WeaponDatabase.frag_charge.color, emissiveIntensity: 0.5 })
  );

  const viewmodel = new THREE.Group();
  const viewmodelSide = gunHand === 'left' ? -1 : 1;
  viewmodel.position.set(viewmodelSide * 0.28, -0.26, -0.55);
  viewmodel.scale.x = viewmodelSide; // mirror the model itself for the left hand
  viewmodel.add(gunModel, pistolModel, grenadeModel);
  camera.add(viewmodel);

  function updateViewmodelForSlot() {
    gunModel.visible = player.activeSlot === 1;
    pistolModel.visible = player.activeSlot === 2;
    grenadeModel.visible = player.activeSlot === 5;
    // slots 3 (fist) and 4 (boost) show an empty hand - nothing to attach
  }
  updateViewmodelForSlot();

  function getMuzzleWorldPos() {
    const activeModel = player.activeSlot === 1 ? gunModel : (player.activeSlot === 2 ? pistolModel : null);
    const out = new THREE.Vector3();
    if (activeModel && activeModel.visible) activeModel.getWorldPosition(out);
    else camera.getWorldPosition(out);
    return out;
  }

  // ---- collision colliders (simple AABBs) ----
  const colliders = []; // { minX,maxX,minY,maxY,minZ,maxZ, wall:boolean, top? }

  function addBox(x, y, z, w, h, d, color, opts) {
    opts = opts || {};
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
      color, emissive: opts.emissive || 0x000000, emissiveIntensity: opts.emissiveIntensity || 0,
      roughness: opts.roughness !== undefined ? opts.roughness : 0.85,
      metalness: opts.metalness !== undefined ? opts.metalness : 0.1
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z);
    scene.add(mesh);
    const collider = {
      minX: x - w / 2, maxX: x + w / 2,
      minY: y, maxY: y + h,
      minZ: z - d / 2, maxZ: z + d / 2,
      wall: opts.wall !== false
    };
    if (opts.top !== undefined) collider.top = opts.top;
    colliders.push(collider);
    return mesh;
  }

  // Map layout mirrors ARENA_WALLS in arena-server/arenaServer.js (kept in
  // sync by hand - see that file's header note). Bigger than the original
  // arena: a 100x100 "Outpost" with two sheltered corner spawns, a
  // two-level mid tower fight for high ground, flank cover routes, and
  // scattered crates so there's always somewhere to break line of sight.
  function buildArena() {
    const STEEL = 0x3c4047;
    const STEEL_DARK = 0x2b2e33;
    const CRATE = 0x6b6248;

    // ground
    const groundGeo = new THREE.PlaneGeometry(100, 100);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.95 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    colliders.push({ minX: -50, maxX: 50, minY: -1, maxY: 0, minZ: -50, maxZ: 50, wall: false, top: 0 });

    // boundary walls
    addBox(0, 0, -50, 100, 8, 1.5, STEEL_DARK);
    addBox(0, 0, 50, 100, 8, 1.5, STEEL_DARK);
    addBox(-50, 0, 0, 1.5, 8, 100, STEEL_DARK);
    addBox(50, 0, 0, 1.5, 8, 100, STEEL_DARK);

    // spawn A shelter (blue accent) - open corner facing mid
    addBox(-44, 0, -40, 1.2, 5, 10, STEEL, { emissive: TEAM_COLOR.A, emissiveIntensity: 0.18 });
    addBox(-40, 0, -44, 10, 5, 1.2, STEEL, { emissive: TEAM_COLOR.A, emissiveIntensity: 0.18 });

    // spawn B shelter (amber accent)
    addBox(44, 0, 40, 1.2, 5, 10, STEEL, { emissive: TEAM_COLOR.B, emissiveIntensity: 0.18 });
    addBox(40, 0, 44, 10, 5, 1.2, STEEL, { emissive: TEAM_COLOR.B, emissiveIntensity: 0.18 });

    // mid tower: two walls, walkable roof, ramp up
    addBox(-8, 0, 0, 1.2, 5, 16, STEEL);
    addBox(8, 0, 0, 1.2, 5, 16, STEEL);
    addBox(0, 5, 0, 16, 1, 16, STEEL_DARK, { wall: false, top: 6 });
    addBox(0, 0, 9, 4, 1.7, 2, STEEL, { wall: false, top: 1.7 });
    addBox(0, 0, 11, 4, 3.4, 2, STEEL, { wall: false, top: 3.4 });
    addBox(0, 0, 13, 4, 5, 2, STEEL, { wall: false, top: 5 });

    // flank cover walls
    addBox(-30, 0, 25, 1.2, 4, 8, STEEL);
    addBox(30, 0, -25, 1.2, 4, 8, STEEL);

    // crates (8 mirrored pairs)
    const crateSpots = [
      [-20, -10], [20, 10], [-10, -20], [10, 20], [-20, 10], [20, -10], [-10, 20], [10, -20],
      [-25, 0], [25, 0], [0, -25], [0, 25], [-15, -30], [15, 30], [-30, -15], [30, 15]
    ];
    crateSpots.forEach(([x, z]) => addBox(x, 0, z, 2.4, 1.8, 2.4, CRATE, { roughness: 0.9 }));

    // corner pillars for readability/scale
    [[-48, -48], [48, -48], [-48, 48], [48, 48]].forEach(([x, z]) => {
      addBox(x, 0, z, 1.4, 6, 1.4, STEEL_DARK);
    });
  }
  buildArena();

  function getGroundHeightAt(x, z, currentY) {
    let top = 0;
    for (const c of colliders) {
      if (c.wall) continue;
      if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) {
        const h = (c.top !== undefined) ? c.top : c.maxY;
        // Only accept this platform's top as standable ground if the player
        // is already at or near its own base height (climbing stairs, or
        // falling onto it from above). Without this check, a platform
        // floating overhead (e.g. the tower roof, base height 5) would act
        // as solid floor for someone simply walking underneath it at ground
        // level, teleporting them straight up - that was the "walk into a
        // wall and get teleported up" bug.
        if (h > top && currentY >= c.minY - 0.6) top = h;
      }
    }
    return top;
  }

  function resolveWallCollision(pos, radius) {
    for (const c of colliders) {
      if (!c.wall) continue;
      if (pos.y > c.maxY || pos.y < c.minY - 0.1) continue;
      const closestX = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const closestZ = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      const dx = pos.x - closestX, dz = pos.z - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq < radius * radius) {
        const d = Math.sqrt(distSq) || 0.001;
        const push = (radius - d);
        pos.x += (dx / d) * push;
        pos.z += (dz / d) * push;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Local player state
  // ---------------------------------------------------------------------
  const player = {
    pos: new THREE.Vector3(0, 1, 0),
    vel: new THREE.Vector3(0, 0, 0),
    yaw: 0, pitch: 0,
    grounded: false,
    crouching: false,
    sliding: false,
    slideTimer: 0,
    slideCooldownTimer: 0,
    coyoteTimer: 0,
    jumpBuffer: 0,
    health: 100,
    alive: true,
    eyeOffset: MovementConfig.eyeHeight,
    bobPhase: 0,
    landDip: 0,
    activeSlot: 1,
    cooldownUntil: { impulse_rifle: 0, impulse_pistol: 0, fist: 0, kinetic_boost: 0, frag_charge: 0 }
  };

  const keys = {};
  window.addEventListener('keydown', (e) => { keys[e.code] = true; });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  let pointerLocked = false;

  function requestLockIfInMatch() {
    if (matchState === 'ROUND_ACTIVE' || matchState === 'PRE_MATCH') {
      renderer.domElement.requestPointerLock();
    }
  }
  // The click-to-play overlay sits ON TOP of the canvas (that's the whole point -
  // it needs to be visible), which means it also has to be the thing that
  // requests pointer lock. Binding the listener only to the canvas meant every
  // click was swallowed by the overlay and pointer lock could never engage.
  renderer.domElement.addEventListener('click', requestLockIfInMatch);
  screens.clicktoplay.addEventListener('click', requestLockIfInMatch);

  // Single source of truth for whether the "click to enter" prompt should be
  // showing, called after every event that could change it. Never force-set
  // the overlay directly anywhere else - this avoids it getting stuck on
  // (or stuck off) out of sync with the real lock state.
  function syncClickPrompt() {
    const shouldShow = inMatch() && !pointerLocked && matchState !== 'MATCH_END';
    screens.clicktoplay.classList.toggle('active', shouldShow);
  }

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    syncClickPrompt();
  });
  document.addEventListener('mousemove', (e) => {
    if (!pointerLocked) return;
    player.yaw -= e.movementX * CameraConfig.sensX;
    player.pitch -= e.movementY * CameraConfig.sensY;
    player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch));
  });

  let focusAiming = false;
  let leftMouseDown = false;
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('mousedown', (e) => {
    if (!pointerLocked || !player.alive) return;
    if (e.button === 0) {
      leftMouseDown = true;
      // Auto weapons (the rifle) fire continuously while held - handled in
      // the main loop below. Everything else fires once per click.
      const weaponId = SLOT_ORDER[player.activeSlot - 1];
      if (!WeaponDatabase[weaponId].auto) useActiveSlot();
    }
    if (e.button === 2) focusAiming = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) leftMouseDown = false;
    if (e.button === 2) focusAiming = false;
  });

  function inMatch() {
    return ['LOADING', 'PRE_MATCH', 'ROUND_ACTIVE', 'ROUND_END'].includes(matchState);
  }

  function camDirection() {
    const d = new THREE.Vector3(0, 0, -1);
    d.applyQuaternion(camera.quaternion);
    return d;
  }

  // ---------------------------------------------------------------------
  // Loadout slots: number keys select, left click uses whichever is active
  // ---------------------------------------------------------------------
  const SLOT_KEYS = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5 };
  window.addEventListener('keydown', (e) => {
    if (SLOT_KEYS[e.code]) {
      player.activeSlot = SLOT_KEYS[e.code];
      updateViewmodelForSlot();
    }
    if (e.code === 'Tab') { e.preventDefault(); document.getElementById('scoreboard').classList.add('show'); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Tab') document.getElementById('scoreboard').classList.remove('show');
  });

  function useActiveSlot() {
    if (matchState !== 'ROUND_ACTIVE') return;
    const weaponId = SLOT_ORDER[player.activeSlot - 1];
    const weapon = WeaponDatabase[weaponId];
    const now = performance.now();
    if (now < player.cooldownUntil[weaponId]) return;

    const dir = camDirection();
    // origin sent to the server stays the true eye/camera position - this is
    // what hit detection is based on, and must line up with the crosshair.
    const origin = { x: camera.position.x, y: camera.position.y, z: camera.position.z };

    if (weapon.kind === 'gun') {
      player.cooldownUntil[weaponId] = now + weapon.cooldown * 1000;
      socket.emit('fire', { origin, dir: { x: dir.x, y: dir.y, z: dir.z }, weapon: weaponId });
      // The VISIBLE tracer starts from the viewmodel's muzzle instead of dead
      // center of the screen - a bullet traveling straight down the center of
      // your own view is nearly invisible (foreshortened to a dot), which is
      // why standing still and shooting looked like nothing was happening.
      spawnTracer(getMuzzleWorldPos(), dir, weapon.color, weapon.range * 0.9);
      flashMuzzle();
    } else if (weapon.kind === 'melee') {
      player.cooldownUntil[weaponId] = now + weapon.cooldown * 1000;
      socket.emit('melee', { origin, dir: { x: dir.x, y: dir.y, z: dir.z } });
      // Distinct swing flash, NOT a tracer - fists shouldn't look like they're
      // firing a projectile.
      spawnMeleeSwing(weapon.color);
    } else if (weapon.kind === 'boost') {
      // Pure movement ability - applied locally, no server round-trip (see
      // header note). Gives a forward+upward burst in the look direction.
      player.cooldownUntil[weaponId] = now + weapon.cooldown * 1000;
      player.vel.x += dir.x * 9;
      player.vel.z += dir.z * 9;
      player.vel.y = Math.max(player.vel.y, 0) + 10.5;
      player.grounded = false;
      flashMuzzle();
    } else if (weapon.kind === 'grenade') {
      player.cooldownUntil[weaponId] = now + weapon.cooldown * 1000;
      socket.emit('grenade', { origin, dir: { x: dir.x, y: dir.y, z: dir.z } });
      const landing = {
        x: origin.x + dir.x * weapon.range,
        y: Math.max(0.3, origin.y + dir.y * weapon.range),
        z: origin.z + dir.z * weapon.range
      };
      spawnGrenadeArc(origin, landing, weapon.color);
    }
  }

  // simple tracer VFX pool - a thin glowing cylinder oriented along the shot
  // direction (a flat THREE.Line was nearly invisible when fired straight
  // down the view axis, since it foreshortens to almost a point on screen)
  const tracers = [];
  function spawnTracer(origin, dir, color, length) {
    length = length || 40;
    const radius = 0.035;
    const geo = new THREE.CylinderGeometry(radius, radius, length, 6, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
    const mesh = new THREE.Mesh(geo, mat);
    const start = new THREE.Vector3(origin.x, origin.y, origin.z);
    const dirVec = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
    const end = start.clone().addScaledVector(dirVec, length);
    mesh.position.copy(start).addScaledVector(dirVec, length / 2);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirVec);
    scene.add(mesh);
    tracers.push({ mesh, t: 0 });
  }
  function updateTracers(dt) {
    for (let i = tracers.length - 1; i >= 0; i--) {
      const tr = tracers[i];
      tr.t += dt;
      tr.mesh.material.opacity = Math.max(0, 0.85 - tr.t * 2.4);
      if (tr.t > 0.35) {
        scene.remove(tr.mesh);
        tr.mesh.geometry.dispose(); tr.mesh.material.dispose();
        tracers.splice(i, 1);
      }
    }
  }
  let muzzleFlashT = 0;
  function flashMuzzle() { muzzleFlashT = 0.06; }

  // melee swing flash - attached to the camera (screen-space fixed) rather
  // than traveling through the world, so it reads as an impact/swipe rather
  // than a fired projectile.
  const meleeSwings = [];
  function spawnMeleeSwing(color) {
    const geo = new THREE.RingGeometry(0.05, 0.1, 16);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0.12, -0.12, -0.5);
    camera.add(mesh);
    meleeSwings.push({ mesh, t: 0 });
  }
  function updateMeleeSwings(dt) {
    for (let i = meleeSwings.length - 1; i >= 0; i--) {
      const s = meleeSwings[i];
      s.t += dt;
      s.mesh.scale.setScalar(1 + s.t * 7);
      s.mesh.material.opacity = Math.max(0, 0.9 - s.t * 4.5);
      if (s.t > 0.22) {
        camera.remove(s.mesh);
        s.mesh.geometry.dispose(); s.mesh.material.dispose();
        meleeSwings.splice(i, 1);
      }
    }
  }

  // grenade lob + explosion VFX pool (visual only - the server resolves the
  // actual blast damage instantly on a straight-line landing point; see
  // resolveGrenade() in arenaServer.js for why, and the write-up's "known
  // limitations" for the resulting small visual/authority timing mismatch)
  const grenadeVisuals = [];
  function spawnGrenadeArc(origin, landing, color) {
    const geo = new THREE.SphereGeometry(0.18, 8, 8);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(origin.x, origin.y, origin.z);
    scene.add(mesh);
    grenadeVisuals.push({ mesh, origin: { x: origin.x, y: origin.y, z: origin.z }, landing, t: 0, duration: 0.45, exploded: false });
  }
  function updateGrenadeVisuals(dt) {
    for (let i = grenadeVisuals.length - 1; i >= 0; i--) {
      const g = grenadeVisuals[i];
      g.t += dt;
      if (!g.exploded) {
        const p = Math.min(1, g.t / g.duration);
        const x = g.origin.x + (g.landing.x - g.origin.x) * p;
        const z = g.origin.z + (g.landing.z - g.origin.z) * p;
        const straightY = g.origin.y + (g.landing.y - g.origin.y) * p;
        const arc = Math.sin(p * Math.PI) * 3.2;
        g.mesh.position.set(x, straightY + arc, z);
        if (p >= 1) {
          g.exploded = true;
          g.t = 0;
          g.mesh.position.set(g.landing.x, g.landing.y, g.landing.z);
          g.mesh.material.transparent = true;
        }
      } else {
        g.mesh.scale.setScalar(1 + g.t * 22);
        g.mesh.material.opacity = Math.max(0, 1 - g.t * 2.2);
        if (g.t > 0.5) {
          scene.remove(g.mesh);
          g.mesh.geometry.dispose(); g.mesh.material.dispose();
          grenadeVisuals.splice(i, 1);
        }
      }
    }
  }

  // ---------------------------------------------------------------------
  // Movement update
  // ---------------------------------------------------------------------
  function updateMovement(dt) {
    if (!player.alive || matchState !== 'ROUND_ACTIVE') return;

    const forward = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
    const strafe = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
    const wantSprint = !!keys['ShiftLeft'] && forward > 0 && !player.crouching;
    const wantCrouch = !!keys['ControlLeft'] || !!keys['KeyC'];

    const horizSpeedNow = Math.hypot(player.vel.x, player.vel.z);
    if (keys['ControlLeft'] && player.grounded && !player.sliding && player.slideCooldownTimer <= 0 &&
        (keys['ShiftLeft'] || horizSpeedNow > MovementConfig.walkSpeed * 0.9)) {
      player.sliding = true;
      player.slideTimer = MovementConfig.slideDuration;
      const fdir = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw)).multiplyScalar(-1);
      const moveDir = (horizSpeedNow > 0.5) ? player.vel.clone().setY(0).normalize() : fdir;
      player.vel.x = moveDir.x * MovementConfig.slideSpeed;
      player.vel.z = moveDir.z * MovementConfig.slideSpeed;
    }

    let targetSpeed = MovementConfig.walkSpeed;
    if (player.sliding) targetSpeed = MovementConfig.slideSpeed;
    else if (wantCrouch) { targetSpeed = MovementConfig.crouchSpeed; player.crouching = true; }
    else { player.crouching = false; if (wantSprint) targetSpeed = MovementConfig.sprintSpeed; }

    if (player.sliding) {
      player.slideTimer -= dt;
      const ahead = getGroundHeightAt(player.pos.x + player.vel.x * 0.1, player.pos.z + player.vel.z * 0.1, player.pos.y);
      const here = getGroundHeightAt(player.pos.x, player.pos.z, player.pos.y);
      const decay = (ahead < here) ? 0.85 : 1.35;
      const speed = player.vel.length();
      const newSpeed = Math.max(MovementConfig.crouchSpeed, speed - decay * MovementConfig.deceleration * 0.35 * dt);
      if (speed > 0.01) {
        const s = newSpeed / speed;
        player.vel.x *= s; player.vel.z *= s;
      }
      if (player.slideTimer <= 0) {
        player.sliding = false;
        player.slideCooldownTimer = MovementConfig.slideCooldown;
        player.crouching = true;
      }
    } else {
      const camYaw = player.yaw;
      const fwd = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const wish = new THREE.Vector3();
      wish.addScaledVector(fwd, forward);
      wish.addScaledVector(right, strafe);
      if (wish.lengthSq() > 0) wish.normalize();
      wish.multiplyScalar(targetSpeed);

      const accel = player.grounded ? MovementConfig.acceleration : MovementConfig.acceleration * MovementConfig.airControl;
      const decel = player.grounded ? MovementConfig.deceleration : MovementConfig.deceleration * MovementConfig.airControl;
      const cur = new THREE.Vector2(player.vel.x, player.vel.z);
      const target = new THREE.Vector2(wish.x, wish.z);
      const diff = target.clone().sub(cur);
      const rate = (target.length() > cur.length()) ? accel : decel;
      const step = Math.min(1, rate * dt / Math.max(0.001, diff.length()));
      cur.add(diff.multiplyScalar(step));
      player.vel.x = cur.x; player.vel.z = cur.y;
    }

    if (player.slideCooldownTimer > 0) player.slideCooldownTimer -= dt;

    // jump buffering + coyote time
    if (keys['Space']) player.jumpBuffer = MovementConfig.jumpBufferTime;
    else player.jumpBuffer -= dt;
    if (player.grounded) player.coyoteTimer = MovementConfig.coyoteTime;
    else player.coyoteTimer -= dt;
    if (player.jumpBuffer > 0 && player.coyoteTimer > 0) {
      player.vel.y = MovementConfig.jumpPower;
      player.jumpBuffer = -1; player.coyoteTimer = -1;
      player.grounded = false;
    }

    // gravity
    player.vel.y -= MovementConfig.gravity * dt;

    // integrate + collide
    const wasGrounded = player.grounded;
    const nextPos = player.pos.clone();
    nextPos.x += player.vel.x * dt;
    nextPos.z += player.vel.z * dt;
    resolveWallCollision(nextPos, 0.4);
    nextPos.y += player.vel.y * dt;

    const groundY = getGroundHeightAt(nextPos.x, nextPos.z, nextPos.y);
    if (nextPos.y <= groundY) {
      if (!wasGrounded && player.vel.y < -6) player.landDip = Math.min(0.18, -player.vel.y * 0.02);
      nextPos.y = groundY;
      player.vel.y = 0;
      player.grounded = true;
    } else {
      player.grounded = false;
    }
    player.pos.copy(nextPos);

    // eye height (crouch/slide lower the camera)
    const targetEye = (player.crouching || player.sliding) ? MovementConfig.crouchHeight : MovementConfig.eyeHeight;
    player.eyeOffset += (targetEye - player.eyeOffset) * Math.min(1, dt * 10);

    // camera bob
    const speed = Math.hypot(player.vel.x, player.vel.z);
    if (player.grounded && speed > 0.3) {
      player.bobPhase += dt * CameraConfig.bobFrequency * (speed / MovementConfig.sprintSpeed);
    }
    player.landDip *= Math.max(0, 1 - dt * 8);

    // FOV
    const targetFov = focusAiming ? CameraConfig.focusFov : (wantSprint && !player.sliding ? CameraConfig.sprintFov : CameraConfig.baseFov);
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 8);
    camera.updateProjectionMatrix();
  }

  function applyCamera() {
    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
    const bob = Math.sin(player.bobPhase) * CameraConfig.bobAmplitude;
    camera.position.set(
      player.pos.x,
      player.pos.y + player.eyeOffset + bob - player.landDip,
      player.pos.z
    );
  }

  // ---------------------------------------------------------------------
  // Networking: send input, receive world updates
  // ---------------------------------------------------------------------
  let lastNetSend = 0;
  function sendInput() {
    const now = performance.now();
    if (now - lastNetSend < 66) return; // ~15Hz
    lastNetSend = now;
    if (!inMatch()) return;
    socket.emit('input', {
      pos: { x: player.pos.x, y: player.pos.y, z: player.pos.z },
      yaw: player.yaw,
      moveState: player.sliding ? 'slide' : (player.crouching ? 'crouch' : (Math.hypot(player.vel.x, player.vel.z) > 0.3 ? 'walk' : 'idle'))
    });
  }

  socket.on('player:correction', (data) => {
    player.pos.set(data.pos.x, data.pos.y, data.pos.z);
  });

  // remote avatars
  const remotePlayers = new Map(); // key -> { group, targetPos, targetYaw, team, alive }

  function makeNameSprite(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 34px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(text, 128, 42);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2.2, 0.55, 1);
    sprite.position.y = 2.3;
    return sprite;
  }

  function ensureAvatar(key, username, team) {
    if (remotePlayers.has(key)) return remotePlayers.get(key);
    const group = new THREE.Group();
    const bodyGeo = new THREE.CapsuleGeometry(0.4, 1.1, 4, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: TEAM_COLOR[team] || 0xffffff, emissive: TEAM_COLOR[team] || 0x222222, emissiveIntensity: 0.25 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.95;
    group.add(body);
    const label = makeNameSprite(username || '???');
    group.add(label);
    scene.add(group);
    const entry = { group, targetPos: new THREE.Vector3(), targetYaw: 0, team, alive: true };
    remotePlayers.set(key, entry);
    return entry;
  }
  function removeAvatar(key) {
    const e = remotePlayers.get(key);
    if (e) { scene.remove(e.group); remotePlayers.delete(key); }
  }

  // ---------------------------------------------------------------------
  // Socket event handlers - match lifecycle
  // ---------------------------------------------------------------------
  socket.on('queue:status', (data) => {
    if (data.state === 'idle') showScreen('mode');
  });

  socket.on('match:found', (data) => {
    const me = data.players.find(p => p.key === myKey);
    if (me) myTeam = me.team;
    showScreen('loading');
    let pct = 0;
    const iv = setInterval(() => {
      pct += 14 + Math.random() * 10;
      document.getElementById('loading-fill').style.width = Math.min(100, pct) + '%';
      if (pct >= 100) clearInterval(iv);
    }, 120);
    const loadingWatchdog = setTimeout(() => {
      if (screens.loading.classList.contains('active')) {
        showConnectionError('The match found you but never actually started. Try reloading.');
      }
    }, 8000);
    // Cleared the moment the real match:state handler moves us off this
    // screen (see below) - this is just a safety net for if it never does.
    socket.once('match:state', () => clearTimeout(loadingWatchdog));
  });

  socket.on('player:spawnAll', (list) => {
    const seen = new Set();
    list.forEach(p => {
      seen.add(p.key);
      if (p.key === myKey) {
        player.pos.set(p.pos.x, p.pos.y, p.pos.z);
        player.yaw = p.yaw; player.vel.set(0, 0, 0);
        player.health = p.health; player.alive = p.alive;
        updateHealthUI();
        hideEliminatedBanner();
        return;
      }
      const av = ensureAvatar(p.key, p.username, p.team);
      av.group.visible = p.alive;
      av.group.position.set(p.pos.x, 0, p.pos.z);
      av.targetPos.set(p.pos.x, 0, p.pos.z);
      av.targetYaw = p.yaw;
      av.alive = p.alive;
    });
    for (const key of [...remotePlayers.keys()]) if (!seen.has(key)) removeAvatar(key);
    rebuildScoreboardRoster(list);
  });

  socket.on('player:you', (data) => {
    player.pos.set(data.pos.x, data.pos.y, data.pos.z);
    player.yaw = data.yaw;
    player.health = data.health;
    player.alive = true;
    myTeam = data.team;
    updateHealthUI();
    hideEliminatedBanner();
  });

  socket.on('player:update', (data) => {
    if (data.key === myKey) return;
    const av = remotePlayers.get(data.key);
    if (!av) return;
    av.targetPos.set(data.pos.x, 0, data.pos.z);
    av.targetYaw = data.yaw;
  });

  socket.on('player:left', (data) => { removeAvatar(data.key); });

  socket.on('weapon:fired', (data) => {
    if (data.key && data.key !== myKey) {
      const av = remotePlayers.get(data.key);
      if (av) {
        const dir = new THREE.Vector3(-Math.sin(av.targetYaw), 0, -Math.cos(av.targetYaw));
        spawnTracer({ x: av.group.position.x, y: 1.2, z: av.group.position.z }, dir, WeaponDatabase[data.weapon] ? WeaponDatabase[data.weapon].color : 0xffffff);
      }
    }
  });

  socket.on('grenade:thrown', (data) => {
    if (data.key !== myKey) spawnGrenadeArc(data.origin, data.landing, WeaponDatabase.frag_charge.color);
  });

  socket.on('player:hit', (data) => {
    if (data.targetKey === myKey) {
      player.health = data.health;
      updateHealthUI();
      flashDamage();
    }
    if (data.shooterKey === myKey) showHitMarker();
  });

  socket.on('player:eliminated', (data) => {
    if (data.key === myKey) {
      player.alive = false;
      showEliminatedBanner();
      if (document.pointerLockElement) document.exitPointerLock();
      syncClickPrompt(); // exitPointerLock is async in some browsers - don't wait on its event alone
    } else {
      const av = remotePlayers.get(data.key);
      if (av) { av.alive = false; av.group.visible = false; }
    }
  });

  socket.on('match:state', (data) => {
    matchState = data.state;
    document.getElementById('score-a').textContent = data.scoreA;
    document.getElementById('score-b').textContent = data.scoreB;
    document.getElementById('hud-round').textContent = 'ROUND ' + data.round;
    if (data.state === 'PRE_MATCH') {
      setHudActive(true);
      showScreen(null);
      runCountdown(data.countdown || 3);
    }
    syncClickPrompt();
  });

  function runCountdown(seconds) {
    const banner = document.getElementById('banner-center');
    let n = seconds;
    banner.classList.add('show');
    const tick = () => {
      if (n > 0) { banner.textContent = n; n--; setTimeout(tick, 1000); }
      else { banner.textContent = 'GO!'; setTimeout(() => banner.classList.remove('show'), 500); }
    };
    tick();
  }

  socket.on('round:end', (data) => {
    const banner = document.getElementById('banner-center');
    const won = data.winnerTeam === myTeam;
    banner.textContent = data.winnerTeam ? (won ? 'ROUND WON' : 'ROUND LOST') : 'ROUND DRAW';
    banner.style.color = won ? '#5a9bd6' : '#d97a3f';
    banner.classList.add('show');
    document.getElementById('score-a').textContent = data.scoreA;
    document.getElementById('score-b').textContent = data.scoreB;
    setTimeout(() => banner.classList.remove('show'), 2200);
  });

  socket.on('match:end', (data) => {
    setHudActive(false);
    screens.clicktoplay.classList.remove('active');
    if (document.pointerLockElement) document.exitPointerLock();
    const won = data.winnerTeam === myTeam;
    document.getElementById('matchend-title').textContent = won ? 'VICTORY' : 'DEFEAT';
    document.getElementById('matchend-title').style.color = won ? '#5a9bd6' : '#d97a3f';
    document.getElementById('matchend-score').textContent =
      'Final score ' + data.scoreA + ' — ' + data.scoreB + (data.reason === 'forfeit' ? ' (forfeit)' : '');
    document.getElementById('matchend-mvp').textContent = data.mvp ? ('MVP: ' + data.mvp.username + ' (' + data.mvp.eliminations + ' eliminations)') : '';
    showScreen('matchend');
    matchState = 'LOBBY';
    for (const key of [...remotePlayers.keys()]) removeAvatar(key);
  });

  function rebuildScoreboardRoster(list) {
    const colA = document.getElementById('sb-team-a');
    const colB = document.getElementById('sb-team-b');
    colA.innerHTML = '<h3>TEAM A</h3>';
    colB.innerHTML = '<h3>TEAM B</h3>';
    list.forEach(p => {
      const row = document.createElement('div');
      row.className = 'sb-row';
      row.innerHTML = `<span>${p.username}${p.key === myKey ? ' (you)' : ''}</span><span>${p.alive ? '●' : '☠'}</span>`;
      (p.team === 'A' ? colA : colB).appendChild(row);
    });
  }

  // ---------------------------------------------------------------------
  // HUD helpers
  // ---------------------------------------------------------------------
  function updateHealthUI() {
    document.getElementById('healthbar-fill').style.width = Math.max(0, player.health) + '%';
    document.getElementById('health-num').textContent = Math.max(0, Math.round(player.health));
  }
  function flashDamage() {
    const el = document.getElementById('damage-vignette');
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 180);
  }
  function showHitMarker() {
    const el = document.getElementById('hit-marker');
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  function showEliminatedBanner() { document.getElementById('eliminated-banner').classList.add('show'); }
  function hideEliminatedBanner() { document.getElementById('eliminated-banner').classList.remove('show'); }

  let slotHudAccum = 0;
  function updateSlotHud(dt) {
    slotHudAccum += dt;
    if (slotHudAccum < 0.08) return; // throttle DOM writes to ~12/sec
    slotHudAccum = 0;
    const now = performance.now();
    document.querySelectorAll('#weapon-slots .slot').forEach(el => {
      const slotNum = parseInt(el.dataset.slot, 10);
      const weaponId = SLOT_ORDER[slotNum - 1];
      const weapon = WeaponDatabase[weaponId];
      el.classList.toggle('active', slotNum === player.activeSlot);
      const remain = Math.max(0, player.cooldownUntil[weaponId] - now);
      const total = weapon.cooldown * 1000;
      const frac = total > 0 ? Math.min(1, 1 - remain / total) : 1;
      const fill = el.querySelector('.slot-cd');
      if (fill) fill.style.width = (frac * 100) + '%';
      el.classList.toggle('ready', remain <= 0);
    });
  }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------
  let lastT = performance.now();
  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    updateMovement(dt);
    applyCamera();
    sendInput();

    // Continuous fire for auto weapons (the rifle) while the mouse is held -
    // everything else only fires on the initial click (handled in mousedown).
    if (leftMouseDown && pointerLocked && player.alive && matchState === 'ROUND_ACTIVE') {
      const heldWeaponId = SLOT_ORDER[player.activeSlot - 1];
      if (WeaponDatabase[heldWeaponId].auto) useActiveSlot();
    }

    updateTracers(dt);
    updateGrenadeVisuals(dt);
    updateMeleeSwings(dt);
    updateSlotHud(dt);

    // interpolate remote avatars toward their latest reported transform
    for (const av of remotePlayers.values()) {
      av.group.position.lerp(av.targetPos, Math.min(1, dt * 10));
      const cur = av.group.rotation.y;
      let diff = av.targetYaw - cur;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      av.group.rotation.y = cur + diff * Math.min(1, dt * 10);
    }

    renderer.render(scene, camera);
  }
  animate();
})();

// ============================================================================
// ARENA CLASH - client
// Handles: rendering (three.js), local first-person movement/camera/weapon,
// remote player interpolation, UI/screen flow, and networking to the
// "/arena" Socket.IO namespace on the Boblox hub server.
//
// NOTE ON AUTHORITY: this client SIMULATES its own movement locally for
// responsiveness and reports its transform to the server (~15Hz). The
// server sanity-checks reported speed but does not fully re-simulate
// physics yet (see server-side arenaServer.js header comment + chat
// writeup "known limitations"). Health, damage, elimination, and round/
// match outcomes are decided entirely by the server - this client never
// sets its own health or declares its own kills.
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

  const WeaponDatabase = {
    pulse_blaster: { id: 'pulse_blaster', name: 'PULSE BLASTER', cooldown: 0.28, color: 0x37e6ff },
    energy_blade: { id: 'energy_blade', name: 'ENERGY BLADE', cooldown: 0.6, color: 0xff2e9f }
  };

  const TEAM_COLOR = { A: 0x37e6ff, B: 0xff2e6f };

  // ---------------------------------------------------------------------
  // UI / screen management
  // ---------------------------------------------------------------------
  const screens = {};
  ['menu', 'mode', 'queue', 'loading', 'clicktoplay', 'matchend'].forEach(name => {
    screens[name] = document.getElementById('screen-' + name);
  });
  function showScreen(name) {
    Object.values(screens).forEach(el => el.classList.remove('active'));
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
      '<a href="/" style="color:#37e6ff;">Return to hub</a></div>';
    throw new Error('No session token found');
  }
  const socket = io('/arena', { auth: { token } });

  let myKey = null;
  let myTeam = 'A';
  let matchState = 'LOBBY';
  let currentMode = '1v1';

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
    }
  }, 400);

  // ---------------------------------------------------------------------
  // three.js scene setup
  // ---------------------------------------------------------------------
  const wrap = document.getElementById('canvas-wrap');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d16);
  scene.fog = new THREE.Fog(0x0a0d16, 22, 70);

  const camera = new THREE.PerspectiveCamera(CameraConfig.baseFov, window.innerWidth / window.innerHeight, 0.1, 300);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  wrap.appendChild(renderer.domElement);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  scene.add(new THREE.AmbientLight(0x8899ff, 0.55));
  const hemi = new THREE.HemisphereLight(0x88bbff, 0x201028, 0.6);
  scene.add(hemi);
  const key1 = new THREE.PointLight(0x37e6ff, 1.4, 40);
  key1.position.set(-14, 8, -14);
  scene.add(key1);
  const key2 = new THREE.PointLight(0xff2e9f, 1.4, 40);
  key2.position.set(14, 8, 14);
  scene.add(key2);

  // ---- collision colliders (simple AABBs) ----
  const colliders = []; // { minX,maxX,minY,maxY,minZ,maxZ, wall:boolean }

  function addBox(x, y, z, w, h, d, color, opts) {
    opts = opts || {};
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
      color, emissive: opts.emissive || 0x000000, emissiveIntensity: opts.emissiveIntensity || 0,
      roughness: 0.7, metalness: 0.15
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z);
    scene.add(mesh);
    colliders.push({
      minX: x - w / 2, maxX: x + w / 2,
      minY: y, maxY: y + h,
      minZ: z - d / 2, maxZ: z + d / 2,
      wall: opts.wall !== false
    });
    return mesh;
  }

  function buildArena() {
    // ground
    const groundGeo = new THREE.PlaneGeometry(60, 60);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1b1e2a, roughness: 0.95 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    colliders.push({ minX: -30, maxX: 30, minY: -1, maxY: 0, minZ: -30, maxZ: 30, wall: false, floor: true, top: 0 });

    // boundary walls
    addBox(0, 0, -29, 60, 6, 1, 0x14161f, { emissive: 0x37e6ff, emissiveIntensity: 0.4 });
    addBox(0, 0, 29, 60, 6, 1, 0x14161f, { emissive: 0xff2e9f, emissiveIntensity: 0.4 });
    addBox(-29, 0, 0, 1, 6, 60, 0x14161f, { emissive: 0x37e6ff, emissiveIntensity: 0.25 });
    addBox(29, 0, 0, 1, 6, 60, 0x14161f, { emissive: 0xff2e9f, emissiveIntensity: 0.25 });

    // central dividing cover with two chokepoint gaps
    addBox(0, 0, -4, 10, 1.4, 1.2, 0x22263a, { emissive: 0x5566ff, emissiveIntensity: 0.3 });
    addBox(0, 0, 4, 10, 1.4, 1.2, 0x22263a, { emissive: 0x5566ff, emissiveIntensity: 0.3 });

    // crates / cover scattered symmetrically
    const crateSpots = [
      [-8, 0, -8], [8, 0, 8], [-8, 0, 8], [8, 0, -8],
      [-4, 0, 0], [4, 0, 0]
    ];
    crateSpots.forEach(([x, , z]) => addBox(x, 0, z, 2.2, 1.6, 2.2, 0x2a2e42, { emissive: 0x8844ff, emissiveIntensity: 0.15 }));

    // raised side platforms (team A bottom-left, team B top-right) with ramp-like steps
    function platform(cx, cz, color) {
      addBox(cx, 0, cz, 6, 1.2, 6, 0x1d2030, { top: true, emissive: color, emissiveIntensity: 0.2 });
      colliders[colliders.length - 1].top = 1.2;
      colliders[colliders.length - 1].wall = false;
      // step up to it
      addBox(cx * 0.55, 0, cz * 0.55, 2.2, 0.6, 2.2, 0x1d2030, { emissive: color, emissiveIntensity: 0.15 });
      colliders[colliders.length - 1].top = 0.6;
      colliders[colliders.length - 1].wall = false;
    }
    platform(-14, -14, 0x37e6ff);
    platform(14, 14, 0xff2e9f);

    // corner pillars for verticality/readability
    [[-18, -18], [18, -18], [-18, 18], [18, 18]].forEach(([x, z]) => {
      addBox(x, 0, z, 1.4, 5, 1.4, 0x181b28, { emissive: 0x37e6ff, emissiveIntensity: 0.35 });
    });
  }
  buildArena();

  function getGroundHeightAt(x, z) {
    let top = 0;
    for (const c of colliders) {
      if (c.wall) continue;
      if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) {
        const h = (c.top !== undefined) ? c.top : c.maxY;
        if (h > top) top = h;
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
    weapon: 'pulse_blaster',
    lastFireLocal: 0,
    lastMeleeLocal: 0
  };

  const keys = {};
  window.addEventListener('keydown', (e) => { keys[e.code] = true; });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  let pointerLocked = false;
  renderer.domElement.addEventListener('click', () => {
    if (matchState === 'ROUND_ACTIVE' || matchState === 'PRE_MATCH') {
      renderer.domElement.requestPointerLock();
    }
  });
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    screens.clicktoplay.classList.toggle('active', !pointerLocked && inMatch());
  });
  document.addEventListener('mousemove', (e) => {
    if (!pointerLocked) return;
    player.yaw -= e.movementX * CameraConfig.sensX;
    player.pitch -= e.movementY * CameraConfig.sensY;
    player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch));
  });

  let focusAiming = false;
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('mousedown', (e) => {
    if (!pointerLocked || !player.alive) return;
    if (e.button === 0) tryFire();
    if (e.button === 2) focusAiming = true;
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 2) focusAiming = false; });

  function inMatch() {
    return ['LOADING', 'PRE_MATCH', 'ROUND_ACTIVE', 'ROUND_END'].includes(matchState);
  }

  function tryFire() {
    const now = performance.now();
    const wpn = WeaponDatabase.pulse_blaster;
    if (now - player.lastFireLocal < wpn.cooldown * 1000) return;
    if (matchState !== 'ROUND_ACTIVE') return;
    player.lastFireLocal = now;
    const dir = camDirection();
    const origin = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    socket.emit('fire', { origin, dir: { x: dir.x, y: dir.y, z: dir.z }, weapon: 'pulse_blaster' });
    spawnTracer(origin, dir, wpn.color);
    flashMuzzle();
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyF' && pointerLocked && player.alive && matchState === 'ROUND_ACTIVE') {
      const now = performance.now();
      if (now - player.lastMeleeLocal < WeaponDatabase.energy_blade.cooldown * 1000) return;
      player.lastMeleeLocal = now;
      const dir = camDirection();
      const origin = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
      socket.emit('melee', { origin, dir: { x: dir.x, y: dir.y, z: dir.z } });
      spawnTracer(origin, dir, WeaponDatabase.energy_blade.color, 3.4);
    }
    if (e.code === 'Tab') { e.preventDefault(); document.getElementById('scoreboard').classList.add('show'); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Tab') document.getElementById('scoreboard').classList.remove('show');
  });

  function camDirection() {
    const d = new THREE.Vector3(0, 0, -1);
    d.applyQuaternion(camera.quaternion);
    return d;
  }

  // simple tracer/impact VFX pool
  const tracers = [];
  function spawnTracer(origin, dir, color, length) {
    length = length || 40;
    const points = [
      new THREE.Vector3(origin.x, origin.y, origin.z),
      new THREE.Vector3(origin.x + dir.x * length, origin.y + dir.y * length, origin.z + dir.z * length)
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    tracers.push({ line, t: 0 });
  }
  function updateTracers(dt) {
    for (let i = tracers.length - 1; i >= 0; i--) {
      const tr = tracers[i];
      tr.t += dt;
      tr.line.material.opacity = Math.max(0, 0.9 - tr.t * 4);
      if (tr.t > 0.25) { scene.remove(tr.line); tracers.splice(i, 1); }
    }
  }
  let muzzleFlashT = 0;
  function flashMuzzle() { muzzleFlashT = 0.06; }

  // ---------------------------------------------------------------------
  // Movement update
  // ---------------------------------------------------------------------
  function updateMovement(dt) {
    if (!player.alive || matchState !== 'ROUND_ACTIVE') return;

    const forward = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
    const strafe = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
    const wantSprint = !!keys['ShiftLeft'] && forward > 0 && !player.crouching;
    const wantCrouch = !!keys['ControlLeft'] || !!keys['KeyC'];

    // slide trigger
    if (wantCrouch && wantSprint === false && player.grounded && !player.sliding &&
        player.slideCooldownTimer <= 0 && player.vel.length() > MovementConfig.sprintSpeed * 0.7 &&
        keys['ShiftLeft']) {
      // (kept for completeness; main trigger below handles the common case)
    }
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
      // slope-aware decay: check ground ahead vs current for downhill/uphill feel
      const ahead = getGroundHeightAt(player.pos.x + player.vel.x * 0.1, player.pos.z + player.vel.z * 0.1);
      const here = getGroundHeightAt(player.pos.x, player.pos.z);
      const decay = (ahead < here) ? 0.85 : 1.35; // downhill slower decay, uphill faster decay
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

    const groundY = getGroundHeightAt(nextPos.x, nextPos.z);
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
  const remotePlayers = new Map(); // key -> { mesh, nameSprite, targetPos, targetYaw, team }

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
    myKey = socket.id;
    const me = data.players.find(p => p.key === myKey);
    if (me) myTeam = me.team;
    showScreen('loading');
    let pct = 0;
    const iv = setInterval(() => {
      pct += 14 + Math.random() * 10;
      document.getElementById('loading-fill').style.width = Math.min(100, pct) + '%';
      if (pct >= 100) clearInterval(iv);
    }, 120);
    // build/refresh avatars for roster (mesh transforms come via spawnAll)
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
      screens.clicktoplay.classList.add('active');
      runCountdown(data.countdown || 3);
    } else if (data.state === 'ROUND_ACTIVE') {
      // countdown handles hiding the click-to-play prompt once locked
    }
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
    banner.style.color = won ? '#37e6ff' : '#ff2e6f';
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
    document.getElementById('matchend-title').style.color = won ? '#37e6ff' : '#ff2e6f';
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
    updateTracers(dt);

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

  // spectator fallback camera while eliminated: gently orbit above arena center
  let specAngle = 0;
  setInterval(() => {
    if (!player.alive && inMatch()) {
      specAngle += 0.01;
      // no-op transform hook point (camera driven by applyCamera which is
      // skipped while dead via updateMovement's early-return; provide a
      // simple free-look fallback instead)
    }
  }, 50);
})();

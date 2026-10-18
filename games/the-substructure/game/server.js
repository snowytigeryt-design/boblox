'use strict';
/*
  THE SUBSTRUCTURE - multiplayer server
  - serves the game files (index.html, css/, js/, assets/)
  - WebSocket lobby + relay on /ws
  - NeDB (data/players.db, data/parties.db) stores players (uuid, name, stats) and parties (4-letter codes)

  Run:  npm install   then   npm start     ->  http://localhost:3000
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const Datastore = require('@seald-io/nedb'); // maintained NeDB fork, same API + promise methods

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const MAX_PLAYERS = 4;
const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ'; // no vowels -> codes never spell words
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORLD = 25 * 4 + 4; // maze is 25 cells * 4 units; used to sanity-check positions
const HOST_EVENTS = new Set(['die', 'locker', 'scratch', 'blackout']);

/* ------------------------------------------------------------------ database */
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
const playersDb = new Datastore({ filename: path.join(ROOT, 'data', 'players.db') });
const partiesDb = new Datastore({ filename: path.join(ROOT, 'data', 'parties.db') });

const safe = async (fn) => { try { return await fn(); } catch (e) { console.warn('[db]', e.message); return null; } };

/* ------------------------------------------------------------------ runtime state */
const clients = new Map(); // pid  -> { ws, uuid, pid, name, room }
const rooms = new Map();   // code -> { code, hostId, seed, status, members:[pid], ready:Set, dead:Set, esc:Set, goTimer }

const pidOf = (uuid) => crypto.createHash('sha256').update(uuid).digest('hex').slice(0, 12); // public id (uuid stays private)
const cleanName = (s) => String(s || '').replace(/[^\w .!?\-]/g, '').trim().slice(0, 12);
const num = (v, lo, hi, d = 0) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const send = (c, obj) => { if (c && c.ws.readyState === 1) c.ws.send(JSON.stringify(obj)); };

function genCode() {
  for (let tries = 0; tries < 500; tries++) {
    let s = '';
    for (let i = 0; i < 4; i++) s += CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)];
    if (!rooms.has(s)) return s;
  }
  return null;
}

const roomView = (r) => ({
  code: r.code, hostId: r.hostId, status: r.status, max: MAX_PLAYERS,
  members: r.members.map((pid) => ({ id: pid, name: clients.get(pid)?.name || '???', host: pid === r.hostId })),
});
const bcast = (r, obj, exceptPid) => { for (const pid of r.members) if (pid !== exceptPid) send(clients.get(pid), obj); };
const saveParty = (r) => safe(() => partiesDb.updateAsync({ code: r.code },
  { $set: { code: r.code, hostId: r.hostId, seed: r.seed, status: r.status, members: r.members.slice(), updated: Date.now() } },
  { upsert: true }));
const bump = (c, field) => c && safe(() => playersDb.updateAsync({ uuid: c.uuid }, { $inc: { [field]: 1 } }));

function closeRoom(r) {
  clearTimeout(r.goTimer);
  rooms.delete(r.code);
  safe(() => partiesDb.removeAsync({ code: r.code }, {}));
}

function checkAllDone(r) {
  if (r.status === 'playing' && r.members.length && r.dead.size + r.esc.size >= r.members.length) {
    r.status = 'done';
    saveParty(r);
  }
}

function goNow(r) {
  if (r.went) return;
  r.went = true;
  clearTimeout(r.goTimer);
  bcast(r, { t: 'go' });
}

function maybeGo(r) {
  if (r.status === 'playing' && !r.went && r.members.every((pid) => r.ready.has(pid))) goNow(r);
}

function leaveRoom(c) {
  const r = c && c.room && rooms.get(c.room);
  if (c) c.room = null;
  if (!r) return;
  r.members = r.members.filter((p) => p !== c.pid);
  r.ready.delete(c.pid);
  if (!r.members.length) return closeRoom(r);
  if (r.hostId === c.pid) r.hostId = r.members[0];
  bcast(r, { t: 'left', id: c.pid });
  bcast(r, { t: 'party', party: roomView(r) });
  maybeGo(r);
  checkAllDone(r);
  saveParty(r);
}

/* ------------------------------------------------------------------ message handling */
async function handle(ctx, m) {
  if (!m || typeof m.t !== 'string') return;

  if (m.t === 'hello') {
    let uuid = typeof m.uuid === 'string' && UUID_RE.test(m.uuid) ? m.uuid.toLowerCase() : null;
    let doc = uuid ? await playersDb.findOneAsync({ uuid }) : null;
    const wanted = cleanName(m.name);
    if (!doc) {
      uuid = crypto.randomUUID();
      doc = { uuid, name: wanted || 'Player' + uuid.slice(0, 4).toUpperCase(), created: Date.now(), lastSeen: Date.now(), games: 0, escapes: 0, deaths: 0 };
      await playersDb.insertAsync(doc);
    } else {
      if (wanted) doc.name = wanted;
      await playersDb.updateAsync({ uuid }, { $set: { name: doc.name, lastSeen: Date.now() } });
    }
    const pid = pidOf(uuid);
    const old = clients.get(pid);
    if (old && old.ws !== ctx.ws) { leaveRoom(old); clients.delete(pid); try { old.ws.close(4000, 'Signed in elsewhere'); } catch (e) { /* ignore */ } }
    ctx.c = { ws: ctx.ws, uuid, pid, name: doc.name, room: null };
    clients.set(pid, ctx.c);
    send(ctx.c, { t: 'welcome', uuid, id: pid, name: doc.name, stats: { games: doc.games || 0, escapes: doc.escapes || 0, deaths: doc.deaths || 0 } });
    return;
  }

  const c = ctx.c;
  if (!c) return;
  const r = c.room ? rooms.get(c.room) : null;

  switch (m.t) {
    case 'setname': {
      const n = cleanName(m.name);
      if (!n) return;
      c.name = n;
      await safe(() => playersDb.updateAsync({ uuid: c.uuid }, { $set: { name: n } }));
      if (r) bcast(r, { t: 'party', party: roomView(r) });
      return;
    }
    case 'create': {
      if (r) leaveRoom(c);
      const code = genCode();
      if (!code) return send(c, { t: 'error', msg: 'Server is full, try again.' });
      const room = { code, hostId: c.pid, seed: crypto.randomInt(1, 2 ** 31), status: 'lobby', members: [c.pid], ready: new Set(), dead: new Set(), esc: new Set(), went: false };
      rooms.set(code, room);
      c.room = code;
      await saveParty(room);
      send(c, { t: 'party', party: roomView(room) });
      return;
    }
    case 'join': {
      const code = String(m.code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      const room = rooms.get(code);
      if (!room) return send(c, { t: 'error', msg: `No party "${code}". Check the code.` });
      if (room.members.includes(c.pid)) return send(c, { t: 'party', party: roomView(room) });
      if (room.status !== 'lobby') return send(c, { t: 'error', msg: 'That party already entered the maze.' });
      if (room.members.length >= MAX_PLAYERS) return send(c, { t: 'error', msg: `Party is full (${MAX_PLAYERS} players).` });
      if (r) leaveRoom(c);
      room.members.push(c.pid);
      c.room = code;
      bcast(room, { t: 'party', party: roomView(room) });
      saveParty(room);
      return;
    }
    case 'leave': return leaveRoom(c);
    case 'start': {
      if (!r || r.hostId !== c.pid || r.status !== 'lobby') return;
      r.status = 'playing';
      r.ready.clear(); r.dead.clear(); r.esc.clear(); r.went = false;
      r.goTimer = setTimeout(() => goNow(r), 60000); // don't wait forever for a slow loader
      await saveParty(r);
      for (const pid of r.members) bump(clients.get(pid), 'games');
      bcast(r, { t: 'start', seed: r.seed, code: r.code, hostId: r.hostId, party: roomView(r) });
      return;
    }
    case 'ready': {
      if (!r || r.status !== 'playing') return;
      r.ready.add(c.pid);
      bcast(r, { t: 'ready', n: r.ready.size, total: r.members.length });
      maybeGo(r);
      return;
    }
    case 'st': { // player state, relayed to the rest of the party
      if (!r || r.status !== 'playing') return;
      const now = Date.now();
      if (now - (c.lastSt || 0) < 25) return;
      c.lastSt = now;
      bcast(r, { t: 'st', id: c.pid, x: num(m.x, 0, WORLD), z: num(m.z, 0, WORLD), yaw: num(m.yaw, -100, 100), pitch: num(m.pitch, -2, 2), h: num(typeof m.h === 'number' ? m.h | 0 : -1, -1, 99, -1), r: m.r ? 1 : 0 }, c.pid);
      return;
    }
    case 'mons': { // monster state, only the host may send it
      if (!r || r.status !== 'playing' || r.hostId !== c.pid || !Array.isArray(m.m) || m.m.length > 16) return;
      bcast(r, { t: 'mons', m: m.m }, c.pid);
      return;
    }
    case 'ev': { // host-authoritative events: die / locker / scratch / blackout
      if (!r || r.status !== 'playing' || r.hostId !== c.pid || !HOST_EVENTS.has(m.e)) return;
      if (m.e === 'die' && typeof m.id === 'string' && !r.dead.has(m.id)) {
        r.dead.add(m.id);
        bump(clients.get(m.id), 'deaths');
        checkAllDone(r);
      }
      bcast(r, { t: 'ev', e: m.e, id: m.id, i: m.i, mi: m.mi, d: m.d }, c.pid);
      return;
    }
    case 'esc': {
      if (!r || r.status !== 'playing' || r.esc.has(c.pid) || r.dead.has(c.pid)) return;
      r.esc.add(c.pid);
      bump(c, 'escapes');
      bcast(r, { t: 'esc', id: c.pid }, c.pid);
      checkAllDone(r);
      return;
    }
    case 'ping': return send(c, { t: 'pong' });
    default:
  }
}

/* ------------------------------------------------------------------ http (static files) */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8' };
const PUBLIC = new Set(['css', 'js', 'assets']);

const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  const top = path.relative(ROOT, file).split(path.sep)[0];
  if (!file.startsWith(ROOT + path.sep) || (rel !== '/index.html' && !PUBLIC.has(top))) { res.writeHead(404); return res.end('Not found'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

/* ------------------------------------------------------------------ websocket */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
wss.on('connection', (ws) => {
  const ctx = { ws, c: null };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let chain = Promise.resolve(); // handle one message at a time per socket (hello is async)
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    chain = chain.then(() => handle(ctx, m)).catch((e) => console.warn('[ws]', e.message));
  });
  ws.on('close', () => {
    chain = chain.then(() => {
      const c = ctx.c;
      if (!c) return;
      if (clients.get(c.pid) === c) { leaveRoom(c); clients.delete(c.pid); }
      safe(() => playersDb.updateAsync({ uuid: c.uuid }, { $set: { lastSeen: Date.now() } }));
    });
  });
  ws.on('error', () => {});
});
setInterval(() => { // drop dead connections
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch (e) { /* ignore */ } }
}, 15000);

/* ------------------------------------------------------------------ boot */
(async () => {
  await playersDb.loadDatabaseAsync();
  await partiesDb.loadDatabaseAsync();
  await safe(() => partiesDb.removeAsync({}, { multi: true })); // parties live in memory; clear leftovers from last run
  try { playersDb.setAutocompactionInterval(5 * 60 * 1000); partiesDb.setAutocompactionInterval(5 * 60 * 1000); } catch (e) { /* ignore */ }
  const known = await safe(() => playersDb.countAsync({}));
  server.listen(PORT, () => {
    console.log(`\n  THE SUBSTRUCTURE is running  (${known ?? 0} players known)\n`);
    console.log(`  You:      http://localhost:${PORT}`);
    for (const list of Object.values(os.networkInterfaces()))
      for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log(`  Friends on your wifi/LAN:  http://${i.address}:${PORT}`);
    console.log('');
  });
})();

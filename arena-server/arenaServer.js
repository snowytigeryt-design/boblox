// ============================================================================
// ARENA CLASH - server-authoritative match system
// ----------------------------------------------------------------------------
// Attaches a dedicated Socket.IO namespace ("/arena") to the existing Boblox
// hub server. Reuses the hub's own session tokens for auth (same pattern as
// the root io.use() middleware in server.js) so no separate login is needed.
//
// WHAT THIS FILE OWNS (server-authoritative):
//   - Matchmaking queues (1v1 / 2v2) and bot backfill
//   - Match / round state machine (LOBBY -> PRE_MATCH -> ROUND_ACTIVE ->
//     ROUND_END -> ... -> MATCH_END)
//   - Health, damage, elimination, round wins, match wins
//   - Line-of-sight checks so weapons can't hit through walls/cover
//   - Simple bot players so a solo tester can always find a match
//
// WHAT THE CLIENT OWNS (documented limitation, see chat writeup):
//   - Movement simulation itself (client reports its own transform).
//     The server sanity-clamps reported speed but does not yet re-simulate
//     full physics. Anything that decides who WINS (health/elimination/
//     round/match/currency-later) is server-side.
//
// MAP GEOMETRY NOTE: ARENA_WALLS below is a simplified box list used ONLY to
// check line-of-sight for combat (so shots/grenades can't pass through walls
// or crates). It intentionally mirrors the visual/collision geometry built in
// games/arena-clash/client.js's buildArena() - if you change the map layout
// in one place, update the other to match, or hits and cover will disagree.
// ============================================================================

const MODES = {
    '1v1': { teamSize: 1, playersNeeded: 2 },
    '2v2': { teamSize: 2, playersNeeded: 4 }
};

const ROUND_WIN_TARGET = 5;
const PRE_MATCH_SECONDS = 3;
const ROUND_END_SECONDS = 3;
const BOT_BACKFILL_WAIT_MS = 10000;
const QUEUE_SCAN_INTERVAL_MS = 1500;
const MAX_REPORTED_SPEED = 30; // studs/sec sanity clamp (sprint+slide+kinetic boost burst headroom)
const BOT_TICK_MS = 350;

// Data-driven equipment table - add new items here without touching combat logic.
// Damage values are intentionally low: this is meant to be a sustained
// firefight game, not a one-or-two-shot game.
const EquipmentDatabase = {
    impulse_rifle: { id: 'impulse_rifle', displayName: 'IMPULSE RIFLE', slot: 'PRIMARY', damage: 9, cooldown: 0.11, range: 85, hitCone: 0.085 },
    impulse_pistol: { id: 'impulse_pistol', displayName: 'IMPULSE SIDEARM', slot: 'SECONDARY', damage: 11, cooldown: 0.22, range: 60, hitCone: 0.09 },
    fist: { id: 'fist', displayName: 'FIST', slot: 'MELEE', damage: 22, cooldown: 0.55, range: 3.2, hitCone: 0.5 },
    frag_charge: { id: 'frag_charge', displayName: 'FRAG CHARGE', slot: 'GRENADE', damage: 55, cooldown: 5, range: 22, radius: 6.5 }
    // kinetic_boost (slot 4, jump boost) is a pure movement ability with no
    // damage/combat effect, so it's handled entirely client-side - see
    // client.js's WeaponDatabase.kinetic_boost.
};

const SPAWNS = {
    A: [{ x: -40, y: 1, z: -40 }, { x: -43, y: 1, z: -36 }],
    B: [{ x: 40, y: 1, z: 40 }, { x: 43, y: 1, z: 36 }]
};

// Simplified solid-geometry list for line-of-sight only (see file header note).
// Format: {x,y,z,w,h,d} - a box centered at (x,z), sitting on top of y, with
// width/height/depth w/h/d. Must be kept roughly in sync with client.js.
const ARENA_WALLS = [
    // boundary
    { x: 0, y: 0, z: -50, w: 100, h: 8, d: 1.5 },
    { x: 0, y: 0, z: 50, w: 100, h: 8, d: 1.5 },
    { x: -50, y: 0, z: 0, w: 1.5, h: 8, d: 100 },
    { x: 50, y: 0, z: 0, w: 1.5, h: 8, d: 100 },
    // spawn A shelter (open corner facing mid)
    { x: -44, y: 0, z: -40, w: 1.2, h: 5, d: 10 },
    { x: -40, y: 0, z: -44, w: 10, h: 5, d: 1.2 },
    // spawn B shelter
    { x: 44, y: 0, z: 40, w: 1.2, h: 5, d: 10 },
    { x: 40, y: 0, z: 44, w: 10, h: 5, d: 1.2 },
    // mid tower walls + roof slab + access ramp
    { x: -8, y: 0, z: 0, w: 1.2, h: 5, d: 16 },
    { x: 8, y: 0, z: 0, w: 1.2, h: 5, d: 16 },
    { x: 0, y: 5, z: 0, w: 16, h: 1, d: 16 },
    { x: 0, y: 0, z: 9, w: 4, h: 1.7, d: 2 },
    { x: 0, y: 0, z: 11, w: 4, h: 3.4, d: 2 },
    { x: 0, y: 0, z: 13, w: 4, h: 5, d: 2 },
    // flank cover walls
    { x: -30, y: 0, z: 25, w: 1.2, h: 4, d: 8 },
    { x: 30, y: 0, z: -25, w: 1.2, h: 4, d: 8 },
    // crates (8 mirrored pairs)
    { x: -20, y: 0, z: -10, w: 2.4, h: 1.8, d: 2.4 }, { x: 20, y: 0, z: 10, w: 2.4, h: 1.8, d: 2.4 },
    { x: -10, y: 0, z: -20, w: 2.4, h: 1.8, d: 2.4 }, { x: 10, y: 0, z: 20, w: 2.4, h: 1.8, d: 2.4 },
    { x: -20, y: 0, z: 10, w: 2.4, h: 1.8, d: 2.4 }, { x: 20, y: 0, z: -10, w: 2.4, h: 1.8, d: 2.4 },
    { x: -10, y: 0, z: 20, w: 2.4, h: 1.8, d: 2.4 }, { x: 10, y: 0, z: -20, w: 2.4, h: 1.8, d: 2.4 },
    { x: -25, y: 0, z: 0, w: 2.4, h: 1.8, d: 2.4 }, { x: 25, y: 0, z: 0, w: 2.4, h: 1.8, d: 2.4 },
    { x: 0, y: 0, z: -25, w: 2.4, h: 1.8, d: 2.4 }, { x: 0, y: 0, z: 25, w: 2.4, h: 1.8, d: 2.4 },
    { x: -15, y: 0, z: -30, w: 2.4, h: 1.8, d: 2.4 }, { x: 15, y: 0, z: 30, w: 2.4, h: 1.8, d: 2.4 },
    { x: -30, y: 0, z: -15, w: 2.4, h: 1.8, d: 2.4 }, { x: 30, y: 0, z: 15, w: 2.4, h: 1.8, d: 2.4 },
    // corner pillars
    { x: -48, y: 0, z: -48, w: 1.4, h: 6, d: 1.4 }, { x: 48, y: 0, z: -48, w: 1.4, h: 6, d: 1.4 },
    { x: -48, y: 0, z: 48, w: 1.4, h: 6, d: 1.4 }, { x: 48, y: 0, z: 48, w: 1.4, h: 6, d: 1.4 }
].map(b => ({
    minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
    minY: b.y, maxY: b.y + b.h,
    minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2
}));

// Slab-method ray/segment vs AABB test, clamped to the segment [0,1] range.
// Returns true if the segment from a to b passes through the box at all.
function segmentIntersectsBox(a, b, box) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    let tmin = 0, tmax = 1;
    const axes = [
        [dx, a.x, box.minX, box.maxX],
        [dy, a.y, box.minY, box.maxY],
        [dz, a.z, box.minZ, box.maxZ]
    ];
    for (const [d, o, lo, hi] of axes) {
        if (Math.abs(d) < 1e-9) {
            if (o < lo || o > hi) return false; // parallel and outside slab
            continue;
        }
        let t1 = (lo - o) / d, t2 = (hi - o) / d;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return false;
    }
    return true;
}

function isBlocked(a, b) {
    for (const box of ARENA_WALLS) {
        if (segmentIntersectsBox(a, b, box)) return true;
    }
    return false;
}

let matchCounter = 1;
function nextMatchId() { return 'm' + (matchCounter++); }

function dist(a, b) {
    const dx = a.x - b.x, dy = (a.y || 0) - (b.y || 0), dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

class Match {
    constructor(nsp, mode, entries) {
        this.nsp = nsp;
        this.id = nextMatchId();
        this.mode = mode;
        this.room = 'match:' + this.id;
        this.state = 'LOADING';
        this.round = 1;
        this.scoreA = 0;
        this.scoreB = 0;
        this.players = new Map(); // key -> player state
        this.timers = [];
        this.readyCount = 0;

        let i = 0;
        for (const e of entries) {
            const team = (i % 2 === 0) ? 'A' : 'B';
            const key = e.isBot ? ('bot_' + e.botId) : e.socket.id;
            const p = {
                key,
                isBot: !!e.isBot,
                socket: e.isBot ? null : e.socket,
                userId: e.isBot ? null : e.socket.userId,
                username: e.isBot ? e.username : e.socket.username,
                team,
                health: 100,
                alive: true,
                connected: true,
                eliminations: 0,
                pos: { x: 0, y: 1, z: 0 },
                yaw: 0,
                lastFire: 0,
                lastGrenade: 0,
                lastInputAt: Date.now(),
                botState: e.isBot ? { targetIdx: 0, wanderT: 0 } : null
            };
            this.players.set(key, p);
            if (!e.isBot) {
                e.socket.join(this.room);
                e.socket.currentMatch = this.id;
            }
            i++;
        }

        this.respawnAll();
        this.broadcastRoster();
        this.beginLoading();
    }

    playerList() {
        return [...this.players.values()].map(p => ({
            key: p.key, username: p.username, team: p.team, isBot: p.isBot
        }));
    }

    broadcastRoster() {
        this.nsp.to(this.room).emit('match:found', {
            matchId: this.id,
            mode: this.mode,
            players: this.playerList()
        });
    }

    respawnAll() {
        const counters = { A: 0, B: 0 };
        for (const p of this.players.values()) {
            const pts = SPAWNS[p.team];
            const pt = pts[counters[p.team] % pts.length];
            counters[p.team]++;
            p.pos = { x: pt.x, y: pt.y, z: pt.z };
            p.yaw = p.team === 'A' ? 0.78 : 0.78 + Math.PI;
            p.health = 100;
            p.alive = true;
            this.emitTo(p, 'player:you', { pos: p.pos, yaw: p.yaw, health: 100, team: p.team });
        }
        this.nsp.to(this.room).emit('player:spawnAll', this.players_public());
    }

    players_public() {
        return [...this.players.values()].map(p => ({
            key: p.key, username: p.username, team: p.team, isBot: p.isBot,
            pos: p.pos, yaw: p.yaw, health: p.health, alive: p.alive
        }));
    }

    emitTo(player, evt, payload) {
        if (player.socket) player.socket.emit(evt, payload);
    }

    beginLoading() {
        this.state = 'LOADING';
        this.round = 1;
        this.scoreA = 0;
        this.scoreB = 0;
        this.setTimer(() => this.beginPreMatch(), 500);
    }

    beginPreMatch() {
        this.state = 'PRE_MATCH';
        this.respawnAll();
        this.nsp.to(this.room).emit('match:state', {
            state: 'PRE_MATCH', round: this.round, scoreA: this.scoreA, scoreB: this.scoreB,
            countdown: PRE_MATCH_SECONDS
        });
        this.setTimer(() => this.beginRoundActive(), PRE_MATCH_SECONDS * 1000);
    }

    beginRoundActive() {
        this.state = 'ROUND_ACTIVE';
        this.nsp.to(this.room).emit('match:state', {
            state: 'ROUND_ACTIVE', round: this.round, scoreA: this.scoreA, scoreB: this.scoreB
        });
    }

    aliveCount(team) {
        let n = 0;
        for (const p of this.players.values()) if (p.team === team && p.alive && p.connected) n++;
        return n;
    }

    handleInput(key, data) {
        const p = this.players.get(key);
        if (!p || !p.alive) return;
        const now = Date.now();
        const dt = Math.max(0.001, (now - p.lastInputAt) / 1000);
        if (data.pos) {
            const d = dist(p.pos, data.pos);
            const maxAllowed = MAX_REPORTED_SPEED * dt + 1.5; // + slack for jumps/latency
            if (d <= maxAllowed) {
                p.pos = { x: data.pos.x, y: data.pos.y, z: data.pos.z };
            } else {
                // reject implausible jump, snap client back via correction event
                this.emitTo(p, 'player:correction', { pos: p.pos });
            }
        }
        if (typeof data.yaw === 'number') p.yaw = data.yaw;
        p.lastInputAt = now;
        this.nsp.to(this.room).except(p.socket ? p.socket.id : '__none__').emit('player:update', {
            key: p.key, pos: p.pos, yaw: p.yaw, state: data.moveState || 'idle'
        });
    }

    applyDamage(attacker, target, damage) {
        target.health = Math.max(0, target.health - damage);
        this.nsp.to(this.room).emit('player:hit', {
            targetKey: target.key, shooterKey: attacker.key, damage, health: target.health
        });
        if (target.health <= 0 && target.alive) {
            target.alive = false;
            attacker.eliminations++;
            this.nsp.to(this.room).emit('player:eliminated', { key: target.key, by: attacker.key });
            this.checkRoundEnd();
        }
    }

    resolveAttack(attackerKey, weaponId, origin, dir) {
        if (this.state !== 'ROUND_ACTIVE') return;
        const attacker = this.players.get(attackerKey);
        if (!attacker || !attacker.alive) return;
        const weapon = EquipmentDatabase[weaponId];
        if (!weapon || weapon.slot === 'GRENADE') return; // grenades go through resolveGrenade
        const now = Date.now();
        if (now - attacker.lastFire < weapon.cooldown * 1000 - 30) return; // small grace for jitter
        attacker.lastFire = now;

        const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
        const ndir = { x: dir.x / len, y: dir.y / len, z: dir.z / len };

        // Pick the best (smallest angle) target that is in range, within the
        // weapon's aim cone, AND not blocked by a wall/crate in between -
        // this is the actual "can't shoot through walls" fix.
        let best = null, bestDot = weapon.hitCone;
        for (const target of this.players.values()) {
            if (target.team === attacker.team || !target.alive) continue;
            const targetPos = { x: target.pos.x, y: target.pos.y + 0.9, z: target.pos.z };
            const to = { x: targetPos.x - origin.x, y: targetPos.y - origin.y, z: targetPos.z - origin.z };
            const d = Math.sqrt(to.x * to.x + to.y * to.y + to.z * to.z);
            if (d > weapon.range) continue;
            const ang = 1 - (to.x * ndir.x + to.y * ndir.y + to.z * ndir.z) / (d || 1);
            if (ang >= bestDot) continue;
            if (isBlocked(origin, targetPos)) continue; // wall/cover in the way
            bestDot = ang; best = target;
        }

        this.emitTo(attacker, 'weapon:fired', { weapon: weaponId });
        this.nsp.to(this.room).except(attacker.socket ? attacker.socket.id : '__none__')
            .emit('weapon:fired', { weapon: weaponId, key: attacker.key });

        if (best) this.applyDamage(attacker, best, weapon.damage);
    }

    resolveGrenade(attackerKey, origin, dir) {
        if (this.state !== 'ROUND_ACTIVE') return;
        const attacker = this.players.get(attackerKey);
        if (!attacker || !attacker.alive) return;
        const weapon = EquipmentDatabase.frag_charge;
        const now = Date.now();
        if (now - attacker.lastGrenade < weapon.cooldown * 1000 - 30) return;
        attacker.lastGrenade = now;

        const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
        const ndir = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
        // Simplified: no arc physics server-side (this server doesn't track
        // map geometry beyond the line-of-sight box list), just a straight
        // line projected out to the weapon's range. The client plays a lobbed
        // visual arc that lands at roughly this same point for feel.
        const landing = {
            x: origin.x + ndir.x * weapon.range,
            y: Math.max(0.3, origin.y + ndir.y * weapon.range),
            z: origin.z + ndir.z * weapon.range
        };

        this.nsp.to(this.room).emit('grenade:thrown', { key: attacker.key, origin, landing });

        for (const target of this.players.values()) {
            if (target.team === attacker.team || !target.alive) continue;
            const targetPos = { x: target.pos.x, y: target.pos.y + 0.9, z: target.pos.z };
            const d = dist(landing, targetPos);
            if (d > weapon.radius) continue;
            if (isBlocked(landing, targetPos)) continue; // blast doesn't reach through walls either
            const falloff = 1 - (d / weapon.radius);
            const dmg = Math.round(weapon.damage * falloff);
            if (dmg > 0) this.applyDamage(attacker, target, dmg);
        }
    }

    checkRoundEnd() {
        if (this.state !== 'ROUND_ACTIVE') return;
        const aAlive = this.aliveCount('A');
        const bAlive = this.aliveCount('B');
        if (aAlive === 0 || bAlive === 0) {
            const winner = aAlive === 0 && bAlive === 0 ? null : (aAlive === 0 ? 'B' : 'A');
            this.endRound(winner);
        }
    }

    endRound(winnerTeam) {
        this.state = 'ROUND_END';
        if (winnerTeam === 'A') this.scoreA++;
        else if (winnerTeam === 'B') this.scoreB++;
        this.nsp.to(this.room).emit('round:end', {
            winnerTeam, scoreA: this.scoreA, scoreB: this.scoreB, round: this.round
        });
        this.setTimer(() => {
            if (this.scoreA >= ROUND_WIN_TARGET || this.scoreB >= ROUND_WIN_TARGET) {
                this.endMatch(this.scoreA > this.scoreB ? 'A' : 'B');
            } else {
                this.round++;
                this.beginPreMatch();
            }
        }, ROUND_END_SECONDS * 1000);
    }

    endMatch(winnerTeam, reason) {
        this.state = 'MATCH_END';
        let mvp = null;
        for (const p of this.players.values()) {
            if (!mvp || p.eliminations > mvp.eliminations) mvp = p;
        }
        this.nsp.to(this.room).emit('match:end', {
            winnerTeam,
            scoreA: this.scoreA,
            scoreB: this.scoreB,
            reason: reason || 'complete',
            mvp: mvp ? { username: mvp.username, eliminations: mvp.eliminations, team: mvp.team } : null
        });
        for (const p of this.players.values()) {
            if (p.socket) p.socket.currentMatch = null;
        }
        this.setTimer(() => this.destroy(), 8000);
    }

    forfeit(loserTeam) {
        if (this.state === 'MATCH_END') return;
        this.clearTimers();
        this.endMatch(loserTeam === 'A' ? 'B' : 'A', 'forfeit');
    }

    playerDisconnected(key) {
        const p = this.players.get(key);
        if (!p) return;
        p.connected = false;
        p.alive = false;
        this.nsp.to(this.room).emit('player:left', { key });
        if (this.state === 'ROUND_ACTIVE') this.checkRoundEnd();
        const teamStillHasHumans = [...this.players.values()].some(pl => pl.team === p.team && !pl.isBot && pl.connected);
        if (!teamStillHasHumans && [...this.players.values()].some(pl => pl.team === p.team)) {
            // whole human side of this team is gone -> forfeit
            const anyOtherHuman = [...this.players.values()].some(pl => pl.team !== p.team && !pl.isBot && pl.connected);
            if (anyOtherHuman) this.forfeit(p.team);
        }
    }

    setTimer(fn, ms) {
        const t = setTimeout(fn, ms);
        this.timers.push(t);
        return t;
    }
    clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }
    destroy() {
        this.clearTimers();
        this.nsp.in(this.room).socketsLeave(this.room);
        for (const p of this.players.values()) {
            if (p.socket) p.socket.currentMatch = null;
        }
    }

    // --- very small bot brain: patrol between own spawns, shoot nearest visible enemy ---
    botTick() {
        if (this.state !== 'ROUND_ACTIVE') return;
        for (const p of this.players.values()) {
            if (!p.isBot || !p.alive) continue;
            let nearest = null, nearestD = Infinity;
            for (const t of this.players.values()) {
                if (t.team === p.team || !t.alive) continue;
                const d = dist(p.pos, t.pos);
                if (d < nearestD) { nearestD = d; nearest = t; }
            }
            if (nearest && nearestD < EquipmentDatabase.impulse_rifle.range &&
                !isBlocked({ x: p.pos.x, y: p.pos.y + 0.9, z: p.pos.z }, { x: nearest.pos.x, y: nearest.pos.y + 0.9, z: nearest.pos.z })) {
                const dir = { x: nearest.pos.x - p.pos.x, y: 0, z: nearest.pos.z - p.pos.z };
                const len = Math.sqrt(dir.x * dir.x + dir.z * dir.z) || 1;
                dir.x /= len; dir.z /= len;
                // slight jitter so bots aren't perfectly accurate
                const jitter = 0.06;
                dir.x += (Math.random() - 0.5) * jitter;
                dir.z += (Math.random() - 0.5) * jitter;
                p.yaw = Math.atan2(dir.x, dir.z);
                if (nearestD > 3) {
                    p.pos.x += dir.x * 0.22;
                    p.pos.z += dir.z * 0.22;
                }
                this.resolveAttack(p.key, 'impulse_rifle', { x: p.pos.x, y: p.pos.y + 0.9, z: p.pos.z }, dir);
            } else {
                // idle wander near spawn (or toward mid if it lost sight of its target)
                const pts = SPAWNS[p.team];
                const home = nearest ? { x: 0, y: 1, z: 0 } : pts[0];
                p.pos.x += (home.x - p.pos.x) * 0.02;
                p.pos.z += (home.z - p.pos.z) * 0.02;
            }
            this.nsp.to(this.room).emit('player:update', { key: p.key, pos: p.pos, yaw: p.yaw, state: 'walk' });
        }
    }
}

module.exports = function attachArena(io, db) {
    const nsp = io.of('/arena');

    nsp.use((socket, next) => {
        const token = socket.handshake.auth && socket.handshake.auth.token;
        if (!token) return next(new Error('Authentication required'));
        db.get('SELECT * FROM sessions WHERE token = ?', [token], (err, session) => {
            if (err || !session) return next(new Error('Invalid or expired token'));
            socket.username = session.username;
            socket.userId = session.user_id;
            next();
        });
    });

    const queues = { '1v1': [], '2v2': [] };
    const matches = new Map();
    let botCounter = 1;

    function findMatchByKey(key) {
        for (const m of matches.values()) if (m.players.has(key)) return m;
        return null;
    }

    function removeFromAllQueues(socket) {
        for (const mode of Object.keys(queues)) {
            queues[mode] = queues[mode].filter(e => e.socket.id !== socket.id);
        }
    }

    function tryStartMatch(mode) {
        const cfg = MODES[mode];
        const q = queues[mode];
        if (q.length >= cfg.playersNeeded) {
            const entries = q.splice(0, cfg.playersNeeded).map(e => ({ socket: e.socket }));
            createMatch(mode, entries);
        }
    }

    function createMatch(mode, entries) {
        const match = new Match(nsp, mode, entries);
        matches.set(match.id, match);
    }

    function botBackfillScan() {
        for (const mode of Object.keys(queues)) {
            const q = queues[mode];
            if (q.length === 0) continue;
            const cfg = MODES[mode];
            const oldest = q[0];
            const waited = Date.now() - oldest.joinedAt;
            if (q.length >= cfg.playersNeeded) { tryStartMatch(mode); continue; }
            if (waited >= BOT_BACKFILL_WAIT_MS) {
                const entries = q.splice(0, q.length).map(e => ({ socket: e.socket }));
                while (entries.length < cfg.playersNeeded) {
                    entries.push({ isBot: true, botId: botCounter, username: 'BOT-' + (botCounter++) });
                }
                createMatch(mode, entries);
            }
        }
    }

    setInterval(botBackfillScan, QUEUE_SCAN_INTERVAL_MS);
    setInterval(() => { for (const m of matches.values()) m.botTick(); }, BOT_TICK_MS);
    setInterval(() => {
        for (const [id, m] of matches) if (m.state === 'MATCH_END' && m.timers.length === 0) matches.delete(id);
    }, 5000);

    nsp.on('connection', (socket) => {
        socket.on('queue:join', ({ mode }) => {
            if (!MODES[mode]) return;
            if (socket.currentMatch) return;
            removeFromAllQueues(socket);
            queues[mode].push({ socket, joinedAt: Date.now() });
            socket.emit('queue:status', { state: 'searching', mode });
            tryStartMatch(mode);
        });

        socket.on('queue:leave', () => {
            removeFromAllQueues(socket);
            socket.emit('queue:status', { state: 'idle' });
        });

        socket.on('input', (data) => {
            const match = findMatchByKey(socket.id);
            if (match) match.handleInput(socket.id, data);
        });

        socket.on('fire', ({ origin, dir, weapon }) => {
            const match = findMatchByKey(socket.id);
            if (match && origin && dir) match.resolveAttack(socket.id, weapon || 'impulse_rifle', origin, dir);
        });

        socket.on('melee', ({ origin, dir }) => {
            const match = findMatchByKey(socket.id);
            if (match && origin && dir) match.resolveAttack(socket.id, 'fist', origin, dir);
        });

        socket.on('grenade', ({ origin, dir }) => {
            const match = findMatchByKey(socket.id);
            if (match && origin && dir) match.resolveGrenade(socket.id, origin, dir);
        });

        socket.on('leaveMatch', () => {
            const match = findMatchByKey(socket.id);
            if (match) match.playerDisconnected(socket.id);
        });

        socket.on('disconnect', () => {
            removeFromAllQueues(socket);
            const match = findMatchByKey(socket.id);
            if (match) match.playerDisconnected(socket.id);
        });
    });

    console.log('Arena Clash match system attached at /arena');
};

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
//   - Simple bot players so a solo tester can always find a match
//
// WHAT THE CLIENT OWNS (documented limitation, see chat writeup):
//   - Movement simulation itself (client reports its own transform).
//     The server sanity-clamps reported speed but does not yet re-simulate
//     full physics. This is intentional for this phase - see "Known
//     limitations" in the writeup. Anything that decides who WINS
//     (health/elimination/round/match/currency-later) is server-side.
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
const MAX_REPORTED_SPEED = 16; // studs/sec sanity clamp (sprint+slide burst headroom)
const BOT_TICK_MS = 350;

// Data-driven equipment table - add new items here without touching combat logic.
const EquipmentDatabase = {
    pulse_blaster: { id: 'pulse_blaster', displayName: 'Pulse Blaster', slot: 'PRIMARY', damage: 34, cooldown: 0.28, range: 55, hitCone: 0.10 },
    energy_blade: { id: 'energy_blade', displayName: 'Energy Blade', slot: 'MELEE', damage: 60, cooldown: 0.6, range: 3.4, hitCone: 0.55 }
};

const SPAWNS = {
    A: [{ x: -13, y: 1, z: -13 }, { x: -15, y: 1, z: -9 }],
    B: [{ x: 13, y: 1, z: 13 }, { x: 15, y: 1, z: 9 }]
};

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

    resolveAttack(attackerKey, weaponId, origin, dir) {
        if (this.state !== 'ROUND_ACTIVE') return;
        const attacker = this.players.get(attackerKey);
        if (!attacker || !attacker.alive) return;
        const weapon = EquipmentDatabase[weaponId];
        if (!weapon) return;
        const now = Date.now();
        if (now - attacker.lastFire < weapon.cooldown * 1000 - 30) return; // small grace for jitter
        attacker.lastFire = now;

        const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
        const ndir = { x: dir.x / len, y: dir.y / len, z: dir.z / len };

        let best = null, bestDot = weapon.hitCone;
        for (const target of this.players.values()) {
            if (target.team === attacker.team || !target.alive) continue;
            const to = { x: target.pos.x - origin.x, y: (target.pos.y + 0.9) - origin.y, z: target.pos.z - origin.z };
            const d = Math.sqrt(to.x * to.x + to.y * to.y + to.z * to.z);
            if (d > weapon.range) continue;
            const ang = 1 - (to.x * ndir.x + to.y * ndir.y + to.z * ndir.z) / (d || 1);
            if (ang < bestDot) { bestDot = ang; best = target; }
        }

        this.emitTo(attacker, 'weapon:fired', { weapon: weaponId });
        this.nsp.to(this.room).except(attacker.socket ? attacker.socket.id : '__none__')
            .emit('weapon:fired', { weapon: weaponId, key: attacker.key });

        if (best) {
            best.health = Math.max(0, best.health - weapon.damage);
            this.nsp.to(this.room).emit('player:hit', {
                targetKey: best.key, shooterKey: attacker.key, damage: weapon.damage, health: best.health
            });
            if (best.health <= 0) {
                best.alive = false;
                attacker.eliminations++;
                this.nsp.to(this.room).emit('player:eliminated', { key: best.key, by: attacker.key });
                this.checkRoundEnd();
            }
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
            if (nearest && nearestD < EquipmentDatabase.pulse_blaster.range) {
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
                this.resolveAttack(p.key, 'pulse_blaster', { x: p.pos.x, y: p.pos.y + 0.9, z: p.pos.z }, dir);
            } else {
                // idle wander near spawn
                const pts = SPAWNS[p.team];
                const home = pts[0];
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
            if (match && origin && dir) match.resolveAttack(socket.id, weapon || 'pulse_blaster', origin, dir);
        });

        socket.on('melee', ({ origin, dir }) => {
            const match = findMatchByKey(socket.id);
            if (match && origin && dir) match.resolveAttack(socket.id, 'energy_blade', origin, dir);
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

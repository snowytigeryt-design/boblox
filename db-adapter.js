// ============================================================================
// db-adapter.js
// ----------------------------------------------------------------------------
// Provides the exact same callback-style API the rest of this app already
// uses (db.serialize, db.run, db.get, db.all - identical to the `sqlite3`
// package), but backed by @libsql/client underneath. This means:
//
//   - Every existing query in server.js and arena-server/arenaServer.js
//     works completely unchanged.
//   - When TURSO_DATABASE_URL is set (as an env var, e.g. on Render), data
//     is stored in Turso - a hosted SQLite-compatible database that persists
//     independently of Render's ephemeral filesystem, so it survives
//     restarts/redeploys even on Render's free plan (which cannot attach a
//     persistent disk at all).
//   - When TURSO_DATABASE_URL is NOT set (e.g. running locally on your own
//     machine), it falls back to a plain local .db file, same as before.
//
// Calls are queued and executed strictly in the order they were issued
// (mirroring sqlite3's default "serialized" mode), which matters for schema
// setup where CREATE TABLE statements must finish before later code queries
// those tables.
// ============================================================================

const { createClient } = require('@libsql/client');
const fs = require('fs');
const path = require('path');

module.exports = function createDb(localDbDir) {
    let client;

    if (process.env.TURSO_DATABASE_URL) {
        client = createClient({
            url: process.env.TURSO_DATABASE_URL,
            authToken: process.env.TURSO_AUTH_TOKEN
        });
        console.log('Database: connected to Turso');
    } else {
        if (!fs.existsSync(localDbDir)) {
            fs.mkdirSync(localDbDir, { recursive: true });
        }
        const filePath = path.join(localDbDir, 'boblox.db');
        client = createClient({ url: 'file:' + filePath });
        console.log('Database: using local SQLite file at ' + filePath +
            ' (set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN env vars to persist this on Render\'s free plan)');
    }

    // --- strict FIFO queue so statements run in issue order, like sqlite3's
    //     default serialized mode (important for CREATE TABLE ordering) ---
    let chain = Promise.resolve();
    function enqueue(task) {
        chain = chain.then(task, task);
    }

    function normalizeArgs(params, cb) {
        if (typeof params === 'function') { cb = params; params = []; }
        return { params: params || [], cb: cb || function () {} };
    }

    const db = {};

    db.serialize = function (fn) {
        // Our queue already serializes everything; just run the function so
        // the db.* calls inside it get pushed onto the queue in order.
        fn();
    };

    db.run = function (sql, params, cb) {
        const a = normalizeArgs(params, cb);
        enqueue(async () => {
            try {
                const result = await client.execute({ sql, args: a.params });
                const ctx = {
                    lastID: (result.lastInsertRowid !== undefined && result.lastInsertRowid !== null)
                        ? Number(result.lastInsertRowid) : undefined,
                    changes: result.rowsAffected
                };
                a.cb.call(ctx, null);
            } catch (err) {
                a.cb.call({}, err);
            }
        });
        return db;
    };

    db.get = function (sql, params, cb) {
        const a = normalizeArgs(params, cb);
        enqueue(async () => {
            try {
                const result = await client.execute({ sql, args: a.params });
                a.cb(null, result.rows[0]);
            } catch (err) {
                a.cb(err);
            }
        });
        return db;
    };

    db.all = function (sql, params, cb) {
        const a = normalizeArgs(params, cb);
        enqueue(async () => {
            try {
                const result = await client.execute({ sql, args: a.params });
                a.cb(null, result.rows);
            } catch (err) {
                a.cb(err);
            }
        });
        return db;
    };

    return db;
};

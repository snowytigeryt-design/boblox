const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

// username -> socket.id, for real-time delivery of friend events
const onlineUsers = new Map();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Initialize SQLite database
const dbDir = process.env.RENDER ? '/opt/render/project/data' : path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}
const db = new sqlite3.Database(path.join(dbDir, 'boblox.db'), (err) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Connected to SQLite database');
    }
});

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

// Create database schema
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            avatar_url TEXT DEFAULT NULL,
            bio TEXT DEFAULT NULL,
            privacy_allow_friend_requests BOOLEAN DEFAULT 1,
            privacy_allow_profile_view BOOLEAN DEFAULT 1,
            privacy_allow_game_invites BOOLEAN DEFAULT 1,
            is_creator BOOLEAN DEFAULT 0
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS friends (
            user_id INTEGER NOT NULL,
            friend_id INTEGER NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, friend_id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (friend_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS game_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            game_id TEXT NOT NULL,
            progress_data TEXT NOT NULL,
            playtime_seconds INTEGER DEFAULT 0,
            last_played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, game_id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS games (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            thumbnail_url TEXT,
            folder_path TEXT NOT NULL,
            is_active BOOLEAN DEFAULT 1,
            category TEXT DEFAULT 'casual',
            creator_id INTEGER,
            rating REAL DEFAULT 0,
            total_reviews INTEGER DEFAULT 0,
            total_plays INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (creator_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS game_reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            game_id TEXT NOT NULL,
            rating INTEGER NOT NULL,
            review_text TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (game_id) REFERENCES games(id),
            UNIQUE(user_id, game_id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS achievements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            icon_url TEXT,
            requirement_type TEXT,
            requirement_value INTEGER,
            reward_coins INTEGER DEFAULT 0,
            reward_gems INTEGER DEFAULT 0
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS user_achievements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            achievement_id INTEGER NOT NULL,
            unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (achievement_id) REFERENCES achievements(id),
            UNIQUE(user_id, achievement_id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            is_read BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sender_id) REFERENCES users(id),
            FOREIGN KEY (receiver_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS group_chats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_by INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS group_chat_members (
            group_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (group_id, user_id),
            FOREIGN KEY (group_id) REFERENCES group_chats(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS group_chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            sender_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (group_id) REFERENCES group_chats(id),
            FOREIGN KEY (sender_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS activity_feed (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            activity_type TEXT NOT NULL,
            activity_data TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            owner_id INTEGER NOT NULL,
            member_count INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (owner_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS group_members (
            group_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT DEFAULT 'member',
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (group_id, user_id),
            FOREIGN KEY (group_id) REFERENCES groups(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS game_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id TEXT NOT NULL,
            version_number TEXT NOT NULL,
            changelog TEXT,
            released_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (game_id) REFERENCES games(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS game_analytics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id TEXT NOT NULL,
            date DATE NOT NULL,
            unique_players INTEGER DEFAULT 0,
            total_sessions INTEGER DEFAULT 0,
            total_playtime_seconds INTEGER DEFAULT 0,
            FOREIGN KEY (game_id) REFERENCES games(id),
            UNIQUE(game_id, date)
        )
    `);
});

// Helper function to generate session token
function generateToken() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Authentication middleware
function authenticate(req, res, callback) {
    const token = req.headers.authorization;
    if (!token) {
        res.status(401).json({ error: 'Authorization token required' });
        return callback(null);
    }
    db.get('SELECT * FROM sessions WHERE token = ?', [token], (err, session) => {
        if (err || !session) {
            res.status(401).json({ error: 'Invalid or expired token' });
            return callback(null);
        }
        db.get('SELECT * FROM users WHERE id = ?', [session.user_id], (err, user) => {
            if (err || !user) {
                res.status(404).json({ error: 'User not found' });
                return callback(null);
            }
            callback(user);
        });
    });
}

// API Routes

// Register new user
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        // Check if user already exists
        db.get('SELECT * FROM users WHERE username = ? OR email = ?', [username, email], async (err, existingUser) => {
            if (err) {
                console.error('Register error:', err);
                return res.status(500).json({ error: 'Server error' });
            }

            if (existingUser) {
                if (existingUser.username === username) {
                    return res.status(400).json({ error: 'Username already taken' });
                }
                if (existingUser.email === email) {
                    return res.status(400).json({ error: 'Email already registered' });
                }
            }

            // Hash password
            const hashedPassword = await bcrypt.hash(password, 10);

            // Create new user
            db.run('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)', [username, email, hashedPassword], function(err) {
                if (err) {
                    console.error('Register error:', err);
                    return res.status(500).json({ error: 'Server error' });
                }

                const userId = this.lastID;

                // Generate session token
                const token = generateToken();
                db.run('INSERT INTO sessions (token, user_id, username) VALUES (?, ?, ?)', [token, userId, username], (err) => {
                    if (err) {
                        console.error('Register error:', err);
                        return res.status(500).json({ error: 'Server error' });
                    }

                    res.json({
                        success: true,
                        token,
                        user: {
                            id: userId,
                            username,
                            email
                        }
                    });
                });
            });
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Login user
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
            if (err) {
                console.error('Login error:', err);
                return res.status(500).json({ error: 'Server error' });
            }

            if (!user) {
                return res.status(401).json({ error: 'Invalid username or password' });
            }

            const isMatch = await bcrypt.compare(password, user.password_hash);
            if (!isMatch) {
                return res.status(401).json({ error: 'Invalid username or password' });
            }

            // Generate session token
            const token = generateToken();
            db.run('INSERT INTO sessions (token, user_id, username) VALUES (?, ?, ?)', [token, user.id, user.username], (err) => {
                if (err) {
                    console.error('Login error:', err);
                    return res.status(500).json({ error: 'Server error' });
                }

                res.json({
                    success: true,
                    token,
                    user: {
                        id: user.id,
                        username: user.username,
                        email: user.email
                    }
                });
            });
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Logout user
app.post('/api/logout', (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'Token is required' });
        }

        db.run('DELETE FROM sessions WHERE token = ?', [token], (err) => {
            if (err) {
                console.error('Logout error:', err);
                return res.status(500).json({ error: 'Server error' });
            }
            res.json({ success: true });
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get user data (authenticated)
app.get('/api/user', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        res.json({
            id: user.id,
            username: user.username,
            email: user.email,
            avatar_url: user.avatar_url,
            bio: user.bio,
            created_at: user.created_at
        });
    });
});

// Verify session
app.get('/api/verify', (req, res) => {
    try {
        const token = req.headers.authorization;

        if (!token) {
            return res.status(401).json({ error: 'Authorization token required' });
        }

        db.get('SELECT * FROM sessions WHERE token = ?', [token], (err, session) => {
            if (err || !session) {
                return res.status(401).json({ error: 'Invalid or expired token' });
            }

            res.json({ valid: true, username: session.username });
        });
    } catch (error) {
        console.error('Verify error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- FRIENDS API ---

// Get friends list, incoming requests, and outgoing requests
app.get('/api/friends', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        // Get accepted friends
        db.all(`
            SELECT u.username, u.id 
            FROM friends f
            JOIN users u ON (f.friend_id = u.id)
            WHERE f.user_id = ? AND f.status = 'accepted'
        `, [user.id], (err, friends) => {
            if (err) {
                console.error('Get friends error:', err);
                return res.status(500).json({ error: 'Server error' });
            }

            // Get incoming requests
            db.all(`
                SELECT u.username, u.id
                FROM friends f
                JOIN users u ON (f.user_id = u.id)
                WHERE f.friend_id = ? AND f.status = 'pending'
            `, [user.id], (err, incoming) => {
                if (err) {
                    console.error('Get friends error:', err);
                    return res.status(500).json({ error: 'Server error' });
                }

                // Get outgoing requests
                db.all(`
                    SELECT u.username, u.id
                    FROM friends f
                    JOIN users u ON (f.friend_id = u.id)
                    WHERE f.user_id = ? AND f.status = 'pending'
                `, [user.id], (err, outgoing) => {
                    if (err) {
                        console.error('Get friends error:', err);
                        return res.status(500).json({ error: 'Server error' });
                    }

                    const friendsWithStatus = friends.map(f => ({
                        username: f.username,
                        id: f.id,
                        online: onlineUsers.has(f.username)
                    }));

                    res.json({ friends: friendsWithStatus, incoming, outgoing });
                });
            });
        });
    });
});

// Send a friend request
app.post('/api/friends/request', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const { username } = req.body;

        if (!username) return res.status(400).json({ error: 'Username is required' });
        if (username === user.username) return res.status(400).json({ error: "You can't add yourself" });

        db.get('SELECT * FROM users WHERE username = ?', [username], (err, target) => {
            if (err || !target) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Check privacy settings
            if (!target.privacy_allow_friend_requests) {
                return res.status(403).json({ error: 'This user does not accept friend requests' });
            }

            // Check if already friends
            db.get('SELECT * FROM friends WHERE user_id = ? AND friend_id = ?', [user.id, target.id], (err, existingFriend) => {
                if (err) {
                    console.error('Friend request error:', err);
                    return res.status(500).json({ error: 'Server error' });
                }

                if (existingFriend) {
                    if (existingFriend.status === 'accepted') {
                        return res.status(400).json({ error: 'Already friends' });
                    }
                    if (existingFriend.status === 'pending') {
                        return res.status(400).json({ error: 'Request already sent' });
                    }
                }

                // Check if they already requested us (auto-accept)
                db.get('SELECT * FROM friends WHERE user_id = ? AND friend_id = ? AND status = ?', [target.id, user.id, 'pending'], (err, incomingRequest) => {
                    if (err) {
                        console.error('Friend request error:', err);
                        return res.status(500).json({ error: 'Server error' });
                    }

                    if (incomingRequest) {
                        // Auto-accept: update both to accepted
                        db.run('UPDATE friends SET status = ? WHERE user_id = ? AND friend_id = ?', ['accepted', target.id, user.id], (err) => {
                            if (err) {
                                console.error('Friend request error:', err);
                                return res.status(500).json({ error: 'Server error' });
                            }

                            db.run('INSERT OR REPLACE INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)', [user.id, target.id, 'accepted'], (err) => {
                                if (err) {
                                    console.error('Friend request error:', err);
                                    return res.status(500).json({ error: 'Server error' });
                                }

                                const targetSocketId = onlineUsers.get(username);
                                if (targetSocketId) io.to(targetSocketId).emit('friend:accepted', { from: user.username });

                                return res.json({ success: true, autoAccepted: true });
                            });
                        });
                    } else {
                        // Send new request
                        db.run('INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)', [user.id, target.id, 'pending'], (err) => {
                            if (err) {
                                console.error('Friend request error:', err);
                                return res.status(500).json({ error: 'Server error' });
                            }

                            const targetSocketId = onlineUsers.get(username);
                            if (targetSocketId) io.to(targetSocketId).emit('friend:request', { from: user.username });

                            res.json({ success: true });
                        });
                    }
                });
            });
        });
    });
});

// Accept a friend request
app.post('/api/friends/accept', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const { username } = req.body;

        db.get('SELECT * FROM users WHERE username = ?', [username], (err, target) => {
            if (err || !target) {
                return res.status(404).json({ error: 'User not found' });
            }

            db.get('SELECT * FROM friends WHERE user_id = ? AND friend_id = ? AND status = ?', [target.id, user.id, 'pending'], (err, request) => {
                if (err || !request) {
                    return res.status(400).json({ error: 'No pending request from this user' });
                }

                // Update both to accepted
                db.run('UPDATE friends SET status = ? WHERE user_id = ? AND friend_id = ?', ['accepted', target.id, user.id], (err) => {
                    if (err) {
                        console.error('Friend accept error:', err);
                        return res.status(500).json({ error: 'Server error' });
                    }

                    db.run('INSERT OR REPLACE INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)', [user.id, target.id, 'accepted'], (err) => {
                        if (err) {
                            console.error('Friend accept error:', err);
                            return res.status(500).json({ error: 'Server error' });
                        }

                        const targetSocketId = onlineUsers.get(username);
                        if (targetSocketId) io.to(targetSocketId).emit('friend:accepted', { from: user.username });

                        res.json({ success: true });
                    });
                });
            });
        });
    });
});

// Decline a friend request
app.post('/api/friends/decline', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const { username } = req.body;

        db.get('SELECT * FROM users WHERE username = ?', [username], (err, target) => {
            if (err) {
                console.error('Friend decline error:', err);
                return res.status(500).json({ error: 'Server error' });
            }

            // Delete any pending requests between these users
            db.run('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)', [user.id, target.id, target.id, user.id], (err) => {
                if (err) {
                    console.error('Friend decline error:', err);
                    return res.status(500).json({ error: 'Server error' });
                }
                res.json({ success: true });
            });
        });
    });
});

// Remove an existing friend
app.post('/api/friends/remove', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const { username } = req.body;

        db.get('SELECT * FROM users WHERE username = ?', [username], (err, target) => {
            if (err || !target) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Delete friendship both ways
            db.run('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)', [user.id, target.id, target.id, user.id], (err) => {
                if (err) {
                    console.error('Friend remove error:', err);
                    return res.status(500).json({ error: 'Server error' });
                }

                const targetSocketId = onlineUsers.get(username);
                if (targetSocketId) io.to(targetSocketId).emit('friend:removed', { from: user.username });

                res.json({ success: true });
            });
        });
    });
});

// --- GAMES API ---

// Get all available games
app.get('/api/games', (req, res) => {
    db.all('SELECT * FROM games WHERE is_active = 1', [], (err, games) => {
        if (err) {
            console.error('Get games error:', err);
            return res.status(500).json({ error: 'Server error' });
        }
        res.json(games);
    });
});

// Get user's progress for a specific game
app.get('/api/games/:id/progress', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const gameId = req.params.id;
        db.get('SELECT progress_data FROM game_progress WHERE user_id = ? AND game_id = ?', [user.id, gameId], (err, progress) => {
            if (err) {
                console.error('Get game progress error:', err);
                return res.status(500).json({ error: 'Server error' });
            }

            if (progress) {
                res.json({ progress: JSON.parse(progress.progress_data) });
            } else {
                res.json({ progress: null });
            }
        });
    });
});

// Save user's progress for a specific game
app.post('/api/games/:id/progress', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const gameId = req.params.id;
        const { progress, playtimeSeconds } = req.body;

        if (!progress) {
            return res.status(400).json({ error: 'Progress data is required' });
        }

        db.get('SELECT * FROM game_progress WHERE user_id = ? AND game_id = ?', [user.id, gameId], (err, existing) => {
            if (err) {
                console.error('Save game progress error:', err);
                return res.status(500).json({ error: 'Server error' });
            }

            if (existing) {
                const newPlaytime = (existing.playtime_seconds || 0) + (playtimeSeconds || 0);
                db.run('UPDATE game_progress SET progress_data = ?, playtime_seconds = ?, last_played_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND game_id = ?',
                    [JSON.stringify(progress), newPlaytime, user.id, gameId], (err) => {
                        if (err) {
                            console.error('Save game progress error:', err);
                            return res.status(500).json({ error: 'Server error' });
                        }
                        res.json({ success: true });
                    });
            } else {
                db.run('INSERT INTO game_progress (user_id, game_id, progress_data, playtime_seconds) VALUES (?, ?, ?, ?)',
                    [user.id, gameId, JSON.stringify(progress), playtimeSeconds || 0], (err) => {
                        if (err) {
                            console.error('Save game progress error:', err);
                            return res.status(500).json({ error: 'Server error' });
                        }
                        res.json({ success: true });
                    });
            }
        });
    });
});

// --- USER PROFILE API ---

// Get user profile
app.get('/api/profile/:username', (req, res) => {
    const { username } = req.params;
    
    db.get('SELECT id, username, avatar_url, bio, created_at FROM users WHERE username = ?', [username], (err, profileUser) => {
        if (err || !profileUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check privacy settings
        db.get('SELECT privacy_allow_profile_view FROM users WHERE id = ?', [profileUser.id], (err, privacy) => {
            if (err) {
                return res.status(500).json({ error: 'Server error' });
            }

            // If profile is private, check if requester is the user or a friend
            const token = req.headers.authorization;
            let isFriend = false;
            let isSelf = false;

            if (!privacy.privacy_allow_profile_view && !token) {
                return res.status(403).json({ error: 'Profile is private' });
            }

            if (token) {
                db.get('SELECT * FROM sessions WHERE token = ?', [token], (err, session) => {
                    if (err || !session) {
                        if (!privacy.privacy_allow_profile_view) {
                            return res.status(403).json({ error: 'Profile is private' });
                        }
                        return res.json({ user: profileUser });
                    }

                    isSelf = session.user_id === profileUser.id;

                    if (!isSelf) {
                        db.get('SELECT * FROM friends WHERE user_id = ? AND friend_id = ? AND status = ?', [session.user_id, profileUser.id, 'accepted'], (err, friend) => {
                            isFriend = !!friend;

                            if (!privacy.privacy_allow_profile_view && !isFriend) {
                                return res.status(403).json({ error: 'Profile is private' });
                            }

                            // Get user's achievements
                            db.all(`
                                SELECT a.name, a.description, a.icon_url, ua.unlocked_at
                                FROM user_achievements ua
                                JOIN achievements a ON ua.achievement_id = a.id
                                WHERE ua.user_id = ?
                            `, [profileUser.id], (err, achievements) => {
                                if (err) {
                                    return res.status(500).json({ error: 'Server error' });
                                }

                                res.json({ user: profileUser, achievements: achievements || [] });
                            });
                        });
                    } else {
                        // Get user's achievements
                        db.all(`
                            SELECT a.name, a.description, a.icon_url, ua.unlocked_at
                            FROM user_achievements ua
                            JOIN achievements a ON ua.achievement_id = a.id
                            WHERE ua.user_id = ?
                        `, [profileUser.id], (err, achievements) => {
                            if (err) {
                                return res.status(500).json({ error: 'Server error' });
                            }

                            res.json({ user: profileUser, achievements: achievements || [] });
                        });
                    }
                });
            } else {
                res.json({ user: profileUser, achievements: [] });
            }
        });
    });
});

// Update user profile
app.put('/api/profile', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const { avatar_url, bio, privacy_allow_friend_requests, privacy_allow_profile_view, privacy_allow_game_invites } = req.body;

        db.run(`
            UPDATE users 
            SET avatar_url = COALESCE(?, avatar_url),
                bio = COALESCE(?, bio),
                privacy_allow_friend_requests = COALESCE(?, privacy_allow_friend_requests),
                privacy_allow_profile_view = COALESCE(?, privacy_allow_profile_view),
                privacy_allow_game_invites = COALESCE(?, privacy_allow_game_invites)
            WHERE id = ?
        `, [avatar_url, bio, privacy_allow_friend_requests, privacy_allow_profile_view, privacy_allow_game_invites, user.id], (err) => {
            if (err) {
                console.error('Update profile error:', err);
                return res.status(500).json({ error: 'Server error' });
            }
            res.json({ success: true });
        });
    });
});

// --- GAME DISCOVERY API ---

// Search and filter games
app.get('/api/games/search', (req, res) => {
    const { query, category, minRating, sort } = req.query;

    let sql = 'SELECT * FROM games WHERE is_active = 1';
    const params = [];

    if (query) {
        sql += ' AND (name LIKE ? OR description LIKE ?)';
        params.push(`%${query}%`, `%${query}%`);
    }

    if (category) {
        sql += ' AND category = ?';
        params.push(category);
    }

    if (minRating) {
        sql += ' AND rating >= ?';
        params.push(parseFloat(minRating));
    }

    if (sort === 'rating') {
        sql += ' ORDER BY rating DESC';
    } else if (sort === 'plays') {
        sql += ' ORDER BY total_plays DESC';
    } else if (sort === 'newest') {
        sql += ' ORDER BY created_at DESC';
    } else {
        sql += ' ORDER BY total_plays DESC';
    }

    db.all(sql, params, (err, games) => {
        if (err) {
            console.error('Search games error:', err);
            return res.status(500).json({ error: 'Server error' });
        }
        res.json(games);
    });
});

// Get game reviews
app.get('/api/games/:id/reviews', (req, res) => {
    const gameId = req.params.id;

    db.all(`
        SELECT r.*, u.username
        FROM game_reviews r
        JOIN users u ON r.user_id = u.id
        WHERE r.game_id = ?
        ORDER BY r.created_at DESC
    `, [gameId], (err, reviews) => {
        if (err) {
            console.error('Get reviews error:', err);
            return res.status(500).json({ error: 'Server error' });
        }
        res.json(reviews);
    });
});

// Submit game review
app.post('/api/games/:id/reviews', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const gameId = req.params.id;
        const { rating, review_text } = req.body;

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Rating must be between 1 and 5' });
        }

        db.get('SELECT * FROM game_reviews WHERE user_id = ? AND game_id = ?', [user.id, gameId], (err, existing) => {
            if (err) {
                console.error('Submit review error:', err);
                return res.status(500).json({ error: 'Server error' });
            }

            if (existing) {
                // Update existing review
                db.run('UPDATE game_reviews SET rating = ?, review_text = ? WHERE user_id = ? AND game_id = ?',
                    [rating, review_text, user.id, gameId], (err) => {
                        if (err) {
                            console.error('Submit review error:', err);
                            return res.status(500).json({ error: 'Server error' });
                        }
                        updateGameRating(gameId);
                        res.json({ success: true });
                    });
            } else {
                // Create new review
                db.run('INSERT INTO game_reviews (user_id, game_id, rating, review_text) VALUES (?, ?, ?, ?)',
                    [user.id, gameId, rating, review_text], (err) => {
                        if (err) {
                            console.error('Submit review error:', err);
                            return res.status(500).json({ error: 'Server error' });
                        }
                        updateGameRating(gameId);
                        res.json({ success: true });
                    });
            }
        });
    });
});

function updateGameRating(gameId) {
    db.get('SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM game_reviews WHERE game_id = ?', [gameId], (err, result) => {
        if (err || !result) return;

        db.run('UPDATE games SET rating = ?, total_reviews = ? WHERE id = ?', [result.avg_rating || 0, result.count, gameId]);
    });
}

// --- MESSAGING API ---

// Get conversation with a user
app.get('/api/messages/:userId', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const otherUserId = parseInt(req.params.userId);

        db.all(`
            SELECT m.*, 
                   CASE WHEN m.sender_id = ? THEN 'sent' ELSE 'received' END as direction,
                   u.username as sender_username
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
            ORDER BY m.created_at ASC
        `, [user.id, user.id, otherUserId, otherUserId, user.id], (err, messages) => {
            if (err) {
                console.error('Get messages error:', err);
                return res.status(500).json({ error: 'Server error' });
            }

            // Mark received messages as read
            db.run('UPDATE messages SET is_read = 1 WHERE receiver_id = ? AND sender_id = ?', [user.id, otherUserId]);

            res.json(messages);
        });
    });
});

// Send a message
app.post('/api/messages', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const { receiver_id, content } = req.body;

        if (!receiver_id || !content) {
            return res.status(400).json({ error: 'Receiver ID and content are required' });
        }

        db.run('INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)', [user.id, receiver_id, content], function(err) {
            if (err) {
                console.error('Send message error:', err);
                return res.status(500).json({ error: 'Server error' });
            }

            // Get receiver's socket ID and send real-time notification
            db.get('SELECT username FROM users WHERE id = ?', [receiver_id], (err, receiver) => {
                if (receiver) {
                    const socketId = onlineUsers.get(receiver.username);
                    if (socketId) {
                        io.to(socketId).emit('message:received', {
                            id: this.lastID,
                            sender_id: user.id,
                            sender_username: user.username,
                            content
                        });
                    }
                }
            });

            res.json({ success: true, messageId: this.lastID });
        });
    });
});

// Get unread message count
app.get('/api/messages/unread/count', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        db.get('SELECT COUNT(*) as count FROM messages WHERE receiver_id = ? AND is_read = 0', [user.id], (err, result) => {
            if (err) {
                console.error('Get unread count error:', err);
                return res.status(500).json({ error: 'Server error' });
            }
            res.json({ count: result.count });
        });
    });
});

// --- ACHIEVEMENTS API ---

// Get all achievements
app.get('/api/achievements', (req, res) => {
    db.all('SELECT * FROM achievements', [], (err, achievements) => {
        if (err) {
            console.error('Get achievements error:', err);
            return res.status(500).json({ error: 'Server error' });
        }
        res.json(achievements);
    });
});

// Get user's achievements
app.get('/api/achievements/user', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        db.all(`
            SELECT a.*, ua.unlocked_at
            FROM user_achievements ua
            JOIN achievements a ON ua.achievement_id = a.id
            WHERE ua.user_id = ?
        `, [user.id], (err, achievements) => {
            if (err) {
                console.error('Get user achievements error:', err);
                return res.status(500).json({ error: 'Server error' });
            }
            res.json(achievements);
        });
    });
});

// Unlock achievement
app.post('/api/achievements/:id/unlock', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const achievementId = parseInt(req.params.id);

        db.get('SELECT * FROM user_achievements WHERE user_id = ? AND achievement_id = ?', [user.id, achievementId], (err, existing) => {
            if (err) {
                console.error('Unlock achievement error:', err);
                return res.status(500).json({ error: 'Server error' });
            }

            if (existing) {
                return res.status(400).json({ error: 'Achievement already unlocked' });
            }

            db.run('INSERT INTO user_achievements (user_id, achievement_id) VALUES (?, ?)', [user.id, achievementId], (err) => {
                if (err) {
                    console.error('Unlock achievement error:', err);
                    return res.status(500).json({ error: 'Server error' });
                }

                // Add activity feed entry
                db.run('INSERT INTO activity_feed (user_id, activity_type, activity_data) VALUES (?, ?, ?)',
                    [user.id, 'achievement_unlocked', JSON.stringify({ achievementId })]);

                res.json({ success: true });
            });
        });
    });
});

// --- GROUP CHATS API ---

// Get user's group chats
app.get('/api/group-chats', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        db.all(`
            SELECT gc.*, 
                   (SELECT COUNT(*) FROM group_chat_members WHERE group_id = gc.id) as member_count
            FROM group_chats gc
            JOIN group_chat_members gcm ON gc.id = gcm.group_id
            WHERE gcm.user_id = ?
            ORDER BY gc.created_at DESC
        `, [user.id], (err, groups) => {
            if (err) {
                console.error('Get group chats error:', err);
                return res.status(500).json({ error: 'Server error' });
            }
            res.json(groups);
        });
    });
});

// Create group chat
app.post('/api/group-chats', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const { name } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Group name is required' });
        }

        db.run('INSERT INTO group_chats (name, created_by) VALUES (?, ?)', [name, user.id], function(err) {
            if (err) {
                console.error('Create group chat error:', err);
                return res.status(500).json({ error: 'Server error' });
            }

            const groupId = this.lastID;

            // Add creator as member
            db.run('INSERT INTO group_chat_members (group_id, user_id) VALUES (?, ?)', [groupId, user.id], (err) => {
                if (err) {
                    console.error('Add group member error:', err);
                    return res.status(500).json({ error: 'Server error' });
                }

                res.json({ success: true, groupId });
            });
        });
    });
});

// Add member to group chat
app.post('/api/group-chats/:groupId/members', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const groupId = parseInt(req.params.groupId);
        const { userId } = req.body;

        // Check if user is a member
        db.get('SELECT * FROM group_chat_members WHERE group_id = ? AND user_id = ?', [groupId, user.id], (err, member) => {
            if (err || !member) {
                return res.status(403).json({ error: 'You are not a member of this group' });
            }

            db.run('INSERT INTO group_chat_members (group_id, user_id) VALUES (?, ?)', [groupId, userId], (err) => {
                if (err) {
                    console.error('Add group member error:', err);
                    return res.status(500).json({ error: 'Server error' });
                }

                res.json({ success: true });
            });
        });
    });
});

// Get group chat messages
app.get('/api/group-chats/:groupId/messages', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const groupId = parseInt(req.params.groupId);

        // Check if user is a member
        db.get('SELECT * FROM group_chat_members WHERE group_id = ? AND user_id = ?', [groupId, user.id], (err, member) => {
            if (err || !member) {
                return res.status(403).json({ error: 'You are not a member of this group' });
            }

            db.all(`
                SELECT gcm.*, u.username
                FROM group_chat_messages gcm
                JOIN users u ON gcm.sender_id = u.id
                WHERE gcm.group_id = ?
                ORDER BY gcm.created_at ASC
            `, [groupId], (err, messages) => {
                if (err) {
                    console.error('Get group messages error:', err);
                    return res.status(500).json({ error: 'Server error' });
                }
                res.json(messages);
            });
        });
    });
});

// Send group chat message
app.post('/api/group-chats/:groupId/messages', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const groupId = parseInt(req.params.groupId);
        const { content } = req.body;

        if (!content) {
            return res.status(400).json({ error: 'Content is required' });
        }

        // Check if user is a member
        db.get('SELECT * FROM group_chat_members WHERE group_id = ? AND user_id = ?', [groupId, user.id], (err, member) => {
            if (err || !member) {
                return res.status(403).json({ error: 'You are not a member of this group' });
            }

            db.run('INSERT INTO group_chat_messages (group_id, sender_id, content) VALUES (?, ?, ?)', [groupId, user.id, content], function(err) {
                if (err) {
                    console.error('Send group message error:', err);
                    return res.status(500).json({ error: 'Server error' });
                }

                // Notify all group members
                db.all('SELECT u.username FROM group_chat_members gcm JOIN users u ON gcm.user_id = u.id WHERE gcm.group_id = ?', [groupId], (err, members) => {
                    if (members) {
                        members.forEach(m => {
                            const socketId = onlineUsers.get(m.username);
                            if (socketId && m.username !== user.username) {
                                io.to(socketId).emit('group:message', {
                                    groupId,
                                    sender_id: user.id,
                                    sender_username: user.username,
                                    content
                                });
                            }
                        });
                    }
                });

                res.json({ success: true, messageId: this.lastID });
            });
        });
    });
});

// --- ACTIVITY FEED API ---

// Get user's activity feed
app.get('/api/activity-feed', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        db.all(`
            SELECT af.*, u.username
            FROM activity_feed af
            JOIN users u ON af.user_id = u.id
            WHERE af.user_id = ?
            ORDER BY af.created_at DESC
            LIMIT 50
        `, [user.id], (err, activities) => {
            if (err) {
                console.error('Get activity feed error:', err);
                return res.status(500).json({ error: 'Server error' });
            }
            res.json(activities);
        });
    });
});

// Get friends' activity feed
app.get('/api/activity-feed/friends', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        db.all(`
            SELECT af.*, u.username
            FROM activity_feed af
            JOIN users u ON af.user_id = u.id
            WHERE af.user_id IN (
                SELECT friend_id FROM friends WHERE user_id = ? AND status = 'accepted'
                UNION
                SELECT user_id FROM friends WHERE friend_id = ? AND status = 'accepted'
            )
            ORDER BY af.created_at DESC
            LIMIT 100
        `, [user.id, user.id], (err, activities) => {
            if (err) {
                console.error('Get friends activity feed error:', err);
                return res.status(500).json({ error: 'Server error' });
            }
            res.json(activities);
        });
    });
});

// --- GROUPS/CLANS API ---

// Get all groups
app.get('/api/groups', (req, res) => {
    db.all('SELECT * FROM groups ORDER BY member_count DESC LIMIT 50', [], (err, groups) => {
        if (err) {
            console.error('Get groups error:', err);
            return res.status(500).json({ error: 'Server error' });
        }
        res.json(groups);
    });
});

// Get user's groups
app.get('/api/groups/user', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        db.all(`
            SELECT g.*, gm.role
            FROM groups g
            JOIN group_members gm ON g.id = gm.group_id
            WHERE gm.user_id = ?
        `, [user.id], (err, groups) => {
            if (err) {
                console.error('Get user groups error:', err);
                return res.status(500).json({ error: 'Server error' });
            }
            res.json(groups);
        });
    });
});

// Create group
app.post('/api/groups', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const { name, description } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Group name is required' });
        }

        db.run('INSERT INTO groups (name, description, owner_id) VALUES (?, ?, ?)', [name, description, user.id], function(err) {
            if (err) {
                console.error('Create group error:', err);
                return res.status(500).json({ error: 'Server error' });
            }

            const groupId = this.lastID;

            // Add creator as owner
            db.run('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)', [groupId, user.id, 'owner'], (err) => {
                if (err) {
                    console.error('Add group owner error:', err);
                    return res.status(500).json({ error: 'Server error' });
                }

                res.json({ success: true, groupId });
            });
        });
    });
});

// Join group
app.post('/api/groups/:groupId/join', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const groupId = parseInt(req.params.groupId);

        db.get('SELECT * FROM groups WHERE id = ?', [groupId], (err, group) => {
            if (err || !group) {
                return res.status(404).json({ error: 'Group not found' });
            }

            db.run('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)', [groupId, user.id], (err) => {
                if (err) {
                    console.error('Join group error:', err);
                    return res.status(500).json({ error: 'Server error' });
                }

                // Update member count
                db.run('UPDATE groups SET member_count = member_count + 1 WHERE id = ?', [groupId]);

                res.json({ success: true });
            });
        });
    });
});

// --- GAME CREATOR TOOLS API ---

// Grant creator permission (admin only)
app.post('/api/admin/grant-creator', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const { username } = req.body;

        // Simple admin check (in production, use proper role system)
        if (user.username !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        db.run('UPDATE users SET is_creator = 1 WHERE username = ?', [username], (err) => {
            if (err) {
                console.error('Grant creator error:', err);
                return res.status(500).json({ error: 'Server error' });
            }
            res.json({ success: true });
        });
    });
});

// Publish game
app.post('/api/games/publish', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        if (!user.is_creator) {
            return res.status(403).json({ error: 'Creator permission required' });
        }

        const { id, name, description, thumbnail_url, folder_path, category } = req.body;

        if (!id || !name || !folder_path) {
            return res.status(400).json({ error: 'ID, name, and folder_path are required' });
        }

        db.run(`
            INSERT INTO games (id, name, description, thumbnail_url, folder_path, category, creator_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [id, name, description, thumbnail_url, folder_path, category || 'casual', user.id], (err) => {
            if (err) {
                console.error('Publish game error:', err);
                return res.status(500).json({ error: 'Server error' });
            }

            // Add activity feed entry
            db.run('INSERT INTO activity_feed (user_id, activity_type, activity_data) VALUES (?, ?, ?)',
                [user.id, 'game_published', JSON.stringify({ gameId: id, gameName: name })]);

            res.json({ success: true });
        });
    });
});

// Get game analytics
app.get('/api/games/:id/analytics', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const gameId = req.params.id;

        // Check if user is the creator
        db.get('SELECT * FROM games WHERE id = ? AND creator_id = ?', [gameId, user.id], (err, game) => {
            if (err || !game) {
                return res.status(403).json({ error: 'You are not the creator of this game' });
            }

            db.all('SELECT * FROM game_analytics WHERE game_id = ? ORDER BY date DESC LIMIT 30', [gameId], (err, analytics) => {
                if (err) {
                    console.error('Get analytics error:', err);
                    return res.status(500).json({ error: 'Server error' });
                }
                res.json(analytics);
            });
        });
    });
});

// Track game session (for analytics)
app.post('/api/games/:id/session', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const gameId = req.params.id;
        const { playtimeSeconds } = req.body;

        const today = new Date().toISOString().split('T')[0];

        db.get('SELECT * FROM game_analytics WHERE game_id = ? AND date = ?', [gameId, today], (err, existing) => {
            if (err) {
                console.error('Track session error:', err);
                return res.status(500).json({ error: 'Server error' });
            }

            if (existing) {
                db.run(`
                    UPDATE game_analytics 
                    SET total_sessions = total_sessions + 1,
                        total_playtime_seconds = total_playtime_seconds + ?,
                        unique_players = (SELECT COUNT(DISTINCT user_id) FROM game_progress WHERE game_id = ?)
                    WHERE game_id = ? AND date = ?
                `, [playtimeSeconds || 0, gameId, gameId, today]);
            } else {
                db.run(`
                    INSERT INTO game_analytics (game_id, date, total_sessions, total_playtime_seconds, unique_players)
                    VALUES (?, ?, 1, ?, 1)
                `, [gameId, today, playtimeSeconds || 0]);
            }

            // Update total plays on game
            db.run('UPDATE games SET total_plays = total_plays + 1 WHERE id = ?', [gameId]);

            res.json({ success: true });
        });
    });
});

// Create game version
app.post('/api/games/:id/versions', (req, res) => {
    authenticate(req, res, (user) => {
        if (!user) return;

        const gameId = req.params.id;

        // Check if user is the creator
        db.get('SELECT * FROM games WHERE id = ? AND creator_id = ?', [gameId, user.id], (err, game) => {
            if (err || !game) {
                return res.status(403).json({ error: 'You are not the creator of this game' });
            }

            const { version_number, changelog } = req.body;

            if (!version_number) {
                return res.status(400).json({ error: 'Version number is required' });
            }

            db.run('INSERT INTO game_versions (game_id, version_number, changelog) VALUES (?, ?, ?)',
                [gameId, version_number, changelog], (err) => {
                    if (err) {
                        console.error('Create version error:', err);
                        return res.status(500).json({ error: 'Server error' });
                    }
                    res.json({ success: true });
                });
        });
    });
});

// Get game versions
app.get('/api/games/:id/versions', (req, res) => {
    const gameId = req.params.id;

    db.all('SELECT * FROM game_versions WHERE game_id = ? ORDER BY released_at DESC', [gameId], (err, versions) => {
        if (err) {
            console.error('Get versions error:', err);
            return res.status(500).json({ error: 'Server error' });
        }
        res.json(versions);
    });
});

// --- REAL-TIME (SOCKET.IO) ---

io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));

    db.get('SELECT * FROM sessions WHERE token = ?', [token], (err, session) => {
        if (err || !session) return next(new Error('Invalid or expired token'));

        socket.username = session.username;
        socket.userId = session.user_id;
        next();
    });
});

io.on('connection', (socket) => {
    onlineUsers.set(socket.username, socket.id);
    console.log(`${socket.username} connected`);

    socket.on('disconnect', () => {
        if (onlineUsers.get(socket.username) === socket.id) {
            onlineUsers.delete(socket.username);
        }
        console.log(`${socket.username} disconnected`);
    });
});

// Start server
httpServer.listen(PORT, () => {
    console.log(`Boblox Hub running on http://localhost:${PORT}`);
    
    // Register Tower Defense Simulator if not already registered
    db.get('SELECT * FROM games WHERE id = ?', ['tower-defense-simulator'], (err, existingGame) => {
        if (!existingGame) {
            db.run(`
                INSERT INTO games (id, name, description, thumbnail_url, folder_path, is_active)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                'tower-defense-simulator',
                'Tower Defense Simulator',
                'Defend your base from waves of enemies in this 3D tower defense game!',
                null,
                'games/tower-defense-simulator',
                1
            ], (err) => {
                if (err) {
                    console.error('Error registering game:', err);
                } else {
                    console.log('Registered Tower Defense Simulator game');
                }
            });
        }
    });
});

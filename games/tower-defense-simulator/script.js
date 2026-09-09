// --- API CONFIGURATION ---
const API_BASE = '/api';
let authToken = sessionStorage.getItem('boblox_token') || null;
let gameId = sessionStorage.getItem('boblox_game_id') || 'tower-defense-simulator';
let currentUsername = null;

// API Functions
async function apiRequest(endpoint, method = 'GET', body = null) {
    const headers = {
        'Content-Type': 'application/json'
    };
    
    if (authToken) {
        headers['Authorization'] = authToken;
    }
    
    const options = {
        method,
        headers
    };
    
    if (body) {
        options.body = JSON.stringify(body);
    }
    
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'API request failed');
        }
        
        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// Authentication Functions
async function register(username, email, password) {
    try {
        const data = await apiRequest('/register', 'POST', { username, email, password });
        authToken = data.token;
        currentUsername = data.user.username;
        sessionStorage.setItem('boblox_token', authToken);
        
        // Load game progress from hub
        await loadGameData();
        
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function login(username, password) {
    try {
        const data = await apiRequest('/login', 'POST', { username, password });
        authToken = data.token;
        currentUsername = data.user.username;
        sessionStorage.setItem('boblox_token', authToken);
        
        // Load game progress from hub
        await loadGameData();
        
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function logout() {
    try {
        await apiRequest('/logout', 'POST', { token: authToken });
        authToken = null;
        currentUsername = null;
        sessionStorage.removeItem('boblox_token');
        sessionStorage.removeItem('boblox_game_id');
        // Redirect back to hub
        window.location.href = '/';
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function loadUserData() {
    try {
        const data = await apiRequest('/user');
        currentUsername = data.username;
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function loadGameData() {
    try {
        const data = await apiRequest(`/games/${gameId}/progress`);
        if (data.progress) {
            playerData = data.progress;
        } else {
            // Initialize default game data for new users
            playerData = {
                level: 1,
                xp: 0,
                coins: 0,
                gems: 0,
                ownedTowers: ["scout", "sniper"],
                goldenTowers: [],
                loadout: ["scout", "sniper"],
                dailyRewards: {
                    lastClaimDate: null,
                    streak: 0,
                    claimedToday: false
                },
                quests: {
                    active: [],
                    completed: []
                },
                questProgress: {
                    matchesWon: 0,
                    wavesReached: 0,
                    enemiesDefeated: 0,
                    bossesDefeated: 0,
                    towersPlaced: 0,
                    towersUpgraded: 0
                }
            };
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function saveGameData() {
    try {
        await apiRequest(`/games/${gameId}/progress`, 'POST', { progress: playerData });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function verifySession() {
    try {
        const data = await apiRequest('/verify');
        if (data.valid) {
            currentUsername = data.username;
            await loadGameData();
            return true;
        }
        return false;
    } catch (error) {
        return false;
    }
}

// --- 1. GAME DATA & TOWER SPECIFICATIONS ---
const TOWER_DB = {
    scout: {
        id: "scout", name: "Scout", type: "damage", role: "Early-Game Defense",
        priceCoins: 0, // Free starter
        color: "#3498db", radius: 12,
        levels: [
            { costCash: 250, damage: 10, range: 100, cooldown: 1000 },
            { costCash: 350, damage: 15, range: 120, cooldown: 800 },
            { costCash: 800, damage: 30, range: 140, cooldown: 500 }
        ]
    },
    sniper: {
        id: "sniper", name: "Sniper", type: "damage", role: "Long Range Precision",
        priceCoins: 0, // Free starter
        color: "#9b59b6", radius: 12,
        levels: [
            { costCash: 300, damage: 25, range: 250, cooldown: 2000 },
            { costCash: 500, damage: 40, range: 300, cooldown: 1800 },
            { costCash: 900, damage: 70, range: 350, cooldown: 1500 }
        ]
    },
    soldier: {
        id: "soldier", name: "Soldier", type: "damage", role: "Basic Ranged Damage",
        priceCoins: 100,
        color: "#95a5a6", radius: 12,
        levels: [
            { costCash: 300, damage: 12, range: 110, cooldown: 900 },
            { costCash: 500, damage: 20, range: 130, cooldown: 750 },
            { costCash: 1000, damage: 35, range: 150, cooldown: 600 }
        ]
    },
    militant: {
        id: "militant", name: "Militant", type: "damage", role: "Rapid Fire",
        priceCoins: 200,
        color: "#7f8c8d", radius: 11,
        levels: [
            { costCash: 400, damage: 6, range: 90, cooldown: 400 },
            { costCash: 700, damage: 10, range: 100, cooldown: 300 },
            { costCash: 1400, damage: 18, range: 110, cooldown: 250 }
        ]
    },
    shotgunner: {
        id: "shotgunner", name: "Shotgunner", type: "splash", role: "Spread Damage",
        priceCoins: 350,
        color: "#c0392b", radius: 13,
        levels: [
            { costCash: 500, damage: 8, range: 80, cooldown: 1200, splash: 30, pellets: 5 },
            { costCash: 900, damage: 12, range: 90, cooldown: 1100, splash: 35, pellets: 6 },
            { costCash: 1800, damage: 20, range: 100, cooldown: 1000, splash: 40, pellets: 8 }
        ]
    },
    hunter: {
        id: "hunter", name: "Hunter", type: "damage", role: "Long Range",
        priceCoins: 250,
        color: "#27ae60", radius: 12,
        levels: [
            { costCash: 450, damage: 25, range: 180, cooldown: 1500 },
            { costCash: 800, damage: 50, range: 220, cooldown: 1300 },
            { costCash: 1600, damage: 100, range: 280, cooldown: 1100 }
        ]
    },
    pyromancer: {
        id: "pyromancer", name: "Pyromancer", type: "dot", role: "Burn Damage",
        priceCoins: 400,
        color: "#e74c3c", radius: 13,
        levels: [
            { costCash: 550, damage: 5, range: 85, cooldown: 800, burnDamage: 3, burnDuration: 3000 },
            { costCash: 950, damage: 8, range: 95, cooldown: 700, burnDamage: 5, burnDuration: 4000 },
            { costCash: 1900, damage: 15, range: 105, cooldown: 600, burnDamage: 8, burnDuration: 5000 }
        ]
    },
    freezer: {
        id: "freezer", name: "Freezer", type: "slow", role: "Crowd Control",
        priceCoins: 300,
        color: "#3498db", radius: 13,
        levels: [
            { costCash: 450, damage: 3, range: 90, cooldown: 1000, slowAmount: 0.5, slowDuration: 2000 },
            { costCash: 800, damage: 5, range: 100, cooldown: 900, slowAmount: 0.6, slowDuration: 2500 },
            { costCash: 1600, damage: 8, range: 110, cooldown: 800, slowAmount: 0.7, slowDuration: 3000 }
        ]
    },
    acepilot: {
        id: "acepilot", name: "Ace Pilot", type: "damage", role: "Aerial Attack",
        priceCoins: 500,
        color: "#f39c12", radius: 14,
        levels: [
            { costCash: 700, damage: 20, range: 120, cooldown: 1100 },
            { costCash: 1200, damage: 35, range: 140, cooldown: 950 },
            { costCash: 2400, damage: 60, range: 160, cooldown: 800 }
        ]
    },
    medic: {
        id: "medic", name: "Medic", type: "support", role: "Tower Healing",
        priceCoins: 350,
        color: "#2ecc71", radius: 15,
        levels: [
            { costCash: 500, healAmount: 5, range: 100, cooldown: 3000 },
            { costCash: 900, healAmount: 8, range: 120, cooldown: 2500 },
            { costCash: 1800, healAmount: 15, range: 140, cooldown: 2000 }
        ]
    },
    rocketeer: {
        id: "rocketeer", name: "Rocketeer", type: "splash", role: "Explosive Damage",
        priceCoins: 450,
        color: "#d35400", radius: 14,
        levels: [
            { costCash: 650, damage: 25, range: 100, cooldown: 1800, splash: 50 },
            { costCash: 1100, damage: 45, range: 110, cooldown: 1600, splash: 60 },
            { costCash: 2200, damage: 80, range: 120, cooldown: 1400, splash: 75 }
        ]
    },
    electroshocker: {
        id: "electroshocker", name: "Electroshocker", type: "chain", role: "Chain Lightning",
        priceCoins: 550,
        color: "#9b59b6", radius: 13,
        levels: [
            { costCash: 750, damage: 15, range: 95, cooldown: 1200, chainCount: 2 },
            { costCash: 1300, damage: 25, range: 105, cooldown: 1000, chainCount: 3 },
            { costCash: 2600, damage: 40, range: 115, cooldown: 900, chainCount: 4 }
        ]
    },
    trapper: {
        id: "trapper", name: "Trapper", type: "trap", role: "Proximity Trap",
        priceCoins: 400,
        color: "#8e44ad", radius: 14,
        levels: [
            { costCash: 550, damage: 12, range: 55, cooldown: 1800, slowAmount: 0.4, slowDuration: 3000 },
            { costCash: 950, damage: 24, range: 60, cooldown: 1500, slowAmount: 0.5, slowDuration: 3500 },
            { costCash: 1900, damage: 45, range: 65, cooldown: 1200, slowAmount: 0.6, slowDuration: 4000 }
        ]
    },
    paintballer: {
        id: "paintballer", name: "Paintballer", type: "splash", role: "Paint Splash",
        priceCoins: 200,
        color: "#e91e63", radius: 12,
        levels: [
            { costCash: 350, damage: 8, range: 85, cooldown: 1100, splash: 35 },
            { costCash: 600, damage: 14, range: 95, cooldown: 1000, splash: 45 },
            { costCash: 1200, damage: 25, range: 105, cooldown: 900, splash: 55 }
        ]
    },
    slimetrooper: {
        id: "slimetrooper", name: "Slime Trooper", type: "slow", role: "Slime Slow",
        priceCoins: 250,
        color: "#00bcd4", radius: 13,
        levels: [
            { costCash: 400, damage: 5, range: 80, cooldown: 900, slowAmount: 0.3, slowDuration: 2500 },
            { costCash: 700, damage: 8, range: 90, cooldown: 800, slowAmount: 0.4, slowDuration: 3000 },
            { costCash: 1400, damage: 12, range: 100, cooldown: 700, slowAmount: 0.5, slowDuration: 3500 }
        ]
    },
    boomerang: {
        id: "boomerang", name: "Boomerang", type: "damage", role: "Returning Attack",
        priceCoins: 300,
        color: "#ff9800", radius: 12,
        levels: [
            { costCash: 450, damage: 15, range: 100, cooldown: 1300 },
            { costCash: 800, damage: 25, range: 115, cooldown: 1100 },
            { costCash: 1600, damage: 40, range: 130, cooldown: 900 }
        ]
    },
    assassin: {
        id: "assassin", name: "Assassin", type: "damage", role: "High Burst",
        priceCoins: 600,
        color: "#212121", radius: 11,
        levels: [
            { costCash: 800, damage: 50, range: 90, cooldown: 2000 },
            { costCash: 1400, damage: 100, range: 100, cooldown: 1700 },
            { costCash: 2800, damage: 200, range: 110, cooldown: 1400 }
        ]
    },
    demoman: {
        id: "demoman", name: "Demoman", type: "splash", role: "Area Damage",
        priceCoins: 150,
        color: "#e67e22", radius: 14,
        levels: [
            { costCash: 400, damage: 15, range: 90, cooldown: 1500, splash: 40 },
            { costCash: 700, damage: 30, range: 100, cooldown: 1400, splash: 50 },
            { costCash: 1500, damage: 60, range: 110, cooldown: 1200, splash: 65 }
        ]
    },
    ranger: {
        id: "ranger", name: "Ranger", type: "damage", role: "Long Range DPS",
        priceCoins: 300,
        color: "#9b59b6", radius: 12,
        levels: [
            { costCash: 600, damage: 40, range: 200, cooldown: 2000 },
            { costCash: 1200, damage: 90, range: 250, cooldown: 1800 },
            { costCash: 2500, damage: 200, range: 350, cooldown: 1500 }
        ]
    },
    farm: {
        id: "farm", name: "Farm", type: "economy", role: "Money Generation",
        priceCoins: 250,
        color: "#f1c40f", radius: 16,
        levels: [
            { costCash: 300, income: 50, cooldown: 5000, range: 0 },
            { costCash: 800, income: 150, cooldown: 5000, range: 0 },
            { costCash: 2000, income: 400, cooldown: 5000, range: 0 }
        ]
    },
    accelerator: {
        id: "accelerator", name: "Accelerator", type: "damage", role: "Charging Attack",
        priceCoins: 2000,
        color: "#ff5722", radius: 14,
        levels: [
            { costCash: 1500, damage: 20, range: 100, cooldown: 1000, chargeRate: 0.1 },
            { costCash: 3000, damage: 40, range: 110, cooldown: 900, chargeRate: 0.15 },
            { costCash: 6000, damage: 80, range: 120, cooldown: 800, chargeRate: 0.2 }
        ]
    },
    engineer: {
        id: "engineer", name: "Engineer", type: "support", role: "Deployable Sentry",
        priceCoins: 1500,
        color: "#607d8b", radius: 15,
        levels: [
            { costCash: 1200, damage: 15, range: 90, cooldown: 1500, sentryCount: 1 },
            { costCash: 2500, damage: 25, range: 100, cooldown: 1300, sentryCount: 2 },
            { costCash: 5000, damage: 40, range: 110, cooldown: 1100, sentryCount: 3 }
        ]
    },
    minigunner: {
        id: "minigunner", name: "Minigunner", type: "damage", role: "Sustained DPS",
        priceCoins: 1800,
        color: "#3e2723", radius: 13,
        levels: [
            { costCash: 1400, damage: 8, range: 95, cooldown: 150 },
            { costCash: 2800, damage: 15, range: 105, cooldown: 120 },
            { costCash: 5600, damage: 30, range: 115, cooldown: 100 }
        ]
    },
    hacker: {
        id: "hacker", name: "Hacker", type: "special", role: "Enemy Manipulation",
        priceCoins: 2500,
        color: "#00bcd4", radius: 12,
        levels: [
            { costCash: 2000, damage: 10, range: 120, cooldown: 2000, hackChance: 0.1 },
            { costCash: 4000, damage: 20, range: 140, cooldown: 1800, hackChance: 0.2 },
            { costCash: 8000, damage: 40, range: 160, cooldown: 1600, hackChance: 0.3 }
        ]
    },
    executioner: {
        id: "executioner", name: "Executioner", type: "damage", role: "Execute Low HP",
        priceCoins: 2200,
        color: "#8b0000", radius: 14,
        levels: [
            { costCash: 1800, damage: 30, range: 100, cooldown: 1200, executeThreshold: 0.3 },
            { costCash: 3600, damage: 60, range: 110, cooldown: 1000, executeThreshold: 0.4 },
            { costCash: 7200, damage: 120, range: 120, cooldown: 900, executeThreshold: 0.5 }
        ]
    },
    turret: {
        id: "turret", name: "Turret", type: "damage", role: "Auto Turret",
        priceCoins: 1200,
        color: "#424242", radius: 11,
        levels: [
            { costCash: 1000, damage: 18, range: 110, cooldown: 800 },
            { costCash: 2000, damage: 35, range: 125, cooldown: 700 },
            { costCash: 4000, damage: 70, range: 140, cooldown: 600 }
        ]
    },
    cowboy: {
        id: "cowboy", name: "Cowboy", type: "damage", role: "Lasso Attack",
        priceCoins: 1600,
        color: "#795548", radius: 13,
        levels: [
            { costCash: 1300, damage: 25, range: 130, cooldown: 1400, lassoDuration: 1500 },
            { costCash: 2600, damage: 45, range: 150, cooldown: 1200, lassoDuration: 2000 },
            { costCash: 5200, damage: 85, range: 170, cooldown: 1000, lassoDuration: 2500 }
        ]
    },
    gatlinggun: {
        id: "gatlinggun", name: "Gatling Gun", type: "damage", role: "Extreme Firepower",
        priceCoins: 3000,
        color: "#212121", radius: 15,
        levels: [
            { costCash: 2500, damage: 12, range: 100, cooldown: 80 },
            { costCash: 5000, damage: 25, range: 115, cooldown: 60 },
            { costCash: 10000, damage: 50, range: 130, cooldown: 50 }
        ]
    },
    necromancer: {
        id: "necromancer", name: "Necromancer", type: "special", role: "Summon Minions",
        priceCoins: 2800,
        color: "#4a148c", radius: 14,
        levels: [
            { costCash: 2200, damage: 15, range: 110, cooldown: 3000, minionCount: 2 },
            { costCash: 4400, damage: 30, range: 125, cooldown: 2500, minionCount: 3 },
            { costCash: 8800, damage: 60, range: 140, cooldown: 2000, minionCount: 4 }
        ]
    },
    mercenarybase: {
        id: "mercenarybase", name: "Mercenary Base", type: "support", role: "Spawn Mercenaries",
        priceCoins: 3500,
        color: "#37474f", radius: 18,
        levels: [
            { costCash: 3000, damage: 20, range: 150, cooldown: 4000, mercCount: 1 },
            { costCash: 6000, damage: 40, range: 170, cooldown: 3500, mercCount: 2 },
            { costCash: 12000, damage: 80, range: 190, cooldown: 3000, mercCount: 3 }
        ]
    },
    commander: {
        id: "commander", name: "Commander", type: "support", role: "Attack Speed Buff",
        priceCoins: 4000,
        color: "#1a237e", radius: 16,
        levels: [
            { costCash: 3500, buffAmount: 0.2, range: 120, cooldown: 5000 },
            { costCash: 7000, buffAmount: 0.35, range: 140, cooldown: 4500 },
            { costCash: 14000, buffAmount: 0.5, range: 160, cooldown: 4000 }
        ]
    },
    djbooth: {
        id: "djbooth", name: "DJ Booth", type: "support", role: "Range & Economy Buff",
        priceCoins: 4500,
        color: "#e91e63", radius: 16,
        levels: [
            { costCash: 4000, rangeBuff: 0.15, incomeBuff: 0.1, range: 130, cooldown: 6000 },
            { costCash: 8000, rangeBuff: 0.25, incomeBuff: 0.2, range: 150, cooldown: 5500 },
            { costCash: 16000, rangeBuff: 0.4, incomeBuff: 0.3, range: 170, cooldown: 5000 }
        ]
    },
    crookboss: {
        id: "crookboss", name: "Crook Boss", type: "economy", role: "Coin Steal",
        priceCoins: 700, color: "#4e342e", radius: 13,
        levels: [
            { costCash: 550, damage: 10, range: 90, cooldown: 1300, income: 20 },
            { costCash: 1000, damage: 18, range: 100, cooldown: 1100, income: 40 },
            { costCash: 2000, damage: 32, range: 110, cooldown: 950, income: 80 }
        ]
    },
    militarybase: {
        id: "militarybase", name: "Military Base", type: "support", role: "Spawn Soldiers",
        priceCoins: 2600, color: "#556b2f", radius: 18,
        levels: [
            { costCash: 2200, damage: 18, range: 140, cooldown: 3500, unitCount: 1 },
            { costCash: 4400, damage: 32, range: 155, cooldown: 3000, unitCount: 2 },
            { costCash: 8800, damage: 55, range: 170, cooldown: 2600, unitCount: 3 }
        ]
    },
    mortar: {
        id: "mortar", name: "Mortar", type: "splash", role: "Long Range Bombardment",
        priceCoins: 1900, color: "#5d4037", radius: 15,
        levels: [
            { costCash: 1600, damage: 60, range: 260, cooldown: 2600, splash: 70 },
            { costCash: 3200, damage: 110, range: 300, cooldown: 2300, splash: 85 },
            { costCash: 6400, damage: 200, range: 340, cooldown: 2000, splash: 100 }
        ]
    },
    warden: {
        id: "warden", name: "Warden", type: "slow", role: "Lockdown Control",
        priceCoins: 2400, color: "#263238", radius: 14,
        levels: [
            { costCash: 2000, damage: 20, range: 110, cooldown: 1500, slowAmount: 0.5, slowDuration: 2500 },
            { costCash: 4000, damage: 35, range: 125, cooldown: 1300, slowAmount: 0.6, slowDuration: 3000 },
            { costCash: 8000, damage: 60, range: 140, cooldown: 1100, slowAmount: 0.7, slowDuration: 3500 }
        ]
    },
    tesla: {
        id: "tesla", name: "Tesla", type: "chain", role: "Electric Overload",
        priceCoins: 3200, color: "#00e5ff", radius: 13,
        levels: [
            { costCash: 2600, damage: 22, range: 100, cooldown: 900, chainCount: 3 },
            { costCash: 5200, damage: 38, range: 115, cooldown: 800, chainCount: 4 },
            { costCash: 10400, damage: 65, range: 130, cooldown: 700, chainCount: 5 }
        ]
    },
    pursuit: {
        id: "pursuit", name: "Pursuit", type: "damage", role: "Homing Pursuit",
        priceCoins: 2000, color: "#00695c", radius: 12,
        levels: [
            { costCash: 1600, damage: 30, range: 150, cooldown: 1400 },
            { costCash: 3200, damage: 55, range: 175, cooldown: 1200 },
            { costCash: 6400, damage: 100, range: 200, cooldown: 1000 }
        ]
    },
    brawler: {
        id: "brawler", name: "Brawler", type: "damage", role: "Melee Powerhouse",
        priceCoins: 5000, color: "#bf360c", radius: 14,
        levels: [
            { costCash: 4200, damage: 90, range: 60, cooldown: 700 },
            { costCash: 8500, damage: 160, range: 70, cooldown: 550 },
            { costCash: 17000, damage: 300, range: 80, cooldown: 400 }
        ]
    },
    gladiator: {
        id: "gladiator", name: "Gladiator", type: "damage", role: "Arena Champion",
        priceCoins: 6000, color: "#c62828", radius: 15,
        levels: [
            { costCash: 5000, damage: 100, range: 100, cooldown: 900 },
            { costCash: 10000, damage: 190, range: 115, cooldown: 750 },
            { costCash: 20000, damage: 350, range: 130, cooldown: 600 }
        ]
    },
    commando: {
        id: "commando", name: "Commando", type: "damage", role: "Elite Rifleman",
        priceCoins: 5500, color: "#33691e", radius: 13,
        levels: [
            { costCash: 4600, damage: 45, range: 160, cooldown: 350 },
            { costCash: 9200, damage: 80, range: 180, cooldown: 280 },
            { costCash: 18400, damage: 150, range: 200, cooldown: 220 }
        ]
    },
    slasher: {
        id: "slasher", name: "Slasher", type: "damage", role: "Bleed Melee",
        priceCoins: 4800, color: "#b71c1c", radius: 12,
        levels: [
            { costCash: 4000, damage: 55, range: 65, cooldown: 500, bleedDamage: 5, bleedDuration: 3000 },
            { costCash: 8000, damage: 95, range: 75, cooldown: 400, bleedDamage: 9, bleedDuration: 3500 },
            { costCash: 16000, damage: 170, range: 85, cooldown: 320, bleedDamage: 16, bleedDuration: 4000 }
        ]
    },
    frostblaster: {
        id: "frostblaster", name: "Frost Blaster", type: "slow", role: "Freeze Burst",
        priceCoins: 4200, color: "#4fc3f7", radius: 14,
        levels: [
            { costCash: 3500, damage: 25, range: 120, cooldown: 1600, slowAmount: 0.6, slowDuration: 3000 },
            { costCash: 7000, damage: 45, range: 135, cooldown: 1400, slowAmount: 0.7, slowDuration: 3500 },
            { costCash: 14000, damage: 80, range: 150, cooldown: 1200, slowAmount: 0.8, slowDuration: 4000 }
        ]
    },
    archer: {
        id: "archer", name: "Archer", type: "damage", role: "Piercing Shot",
        priceCoins: 800, color: "#6d4c41", radius: 12,
        levels: [
            { costCash: 500, damage: 18, range: 160, cooldown: 1000, pierce: 2 },
            { costCash: 900, damage: 32, range: 190, cooldown: 850, pierce: 3 },
            { costCash: 1800, damage: 55, range: 220, cooldown: 700, pierce: 4 }
        ]
    },
    swarmer: {
        id: "swarmer", name: "Swarmer", type: "damage", role: "Multi-Target Swarm",
        priceCoins: 3600, color: "#827717", radius: 13,
        levels: [
            { costCash: 3000, damage: 10, range: 110, cooldown: 300, targets: 3 },
            { costCash: 6000, damage: 18, range: 125, cooldown: 250, targets: 4 },
            { costCash: 12000, damage: 30, range: 140, cooldown: 200, targets: 5 }
        ]
    },
    toxicgunner: {
        id: "toxicgunner", name: "Toxic Gunner", type: "dot", role: "Poison Damage",
        priceCoins: 3300, color: "#7cb342", radius: 13,
        levels: [
            { costCash: 2800, damage: 8, range: 100, cooldown: 900, poisonDamage: 6, poisonDuration: 4000 },
            { costCash: 5600, damage: 14, range: 110, cooldown: 800, poisonDamage: 10, poisonDuration: 4500 },
            { costCash: 11200, damage: 24, range: 120, cooldown: 700, poisonDamage: 18, poisonDuration: 5000 }
        ]
    },
    sledger: {
        id: "sledger", name: "Sledger", type: "splash", role: "Ground Slam",
        priceCoins: 4000, color: "#455a64", radius: 15,
        levels: [
            { costCash: 3300, damage: 70, range: 80, cooldown: 1400, splash: 60 },
            { costCash: 6600, damage: 130, range: 90, cooldown: 1200, splash: 70 },
            { costCash: 13200, damage: 240, range: 100, cooldown: 1000, splash: 85 }
        ]
    },
    elfcamp: {
        id: "elfcamp", name: "Elf Camp", type: "support", role: "Ranged Support Unit",
        priceCoins: 2700, color: "#2e7d32", radius: 16,
        levels: [
            { costCash: 2200, damage: 12, range: 130, cooldown: 900, unitCount: 1 },
            { costCash: 4400, damage: 22, range: 145, cooldown: 800, unitCount: 2 },
            { costCash: 8800, damage: 38, range: 160, cooldown: 700, unitCount: 3 }
        ]
    },
    jester: {
        id: "jester", name: "Jester", type: "special", role: "Confuse Enemies",
        priceCoins: 3100, color: "#8e24aa", radius: 12,
        levels: [
            { costCash: 2600, damage: 8, range: 100, cooldown: 1500, confuseChance: 0.15 },
            { costCash: 5200, damage: 15, range: 115, cooldown: 1300, confuseChance: 0.25 },
            { costCash: 10400, damage: 26, range: 130, cooldown: 1100, confuseChance: 0.35 }
        ]
    },
    cryomancer: {
        id: "cryomancer", name: "Cryomancer", type: "slow", role: "Deep Freeze",
        priceCoins: 4600, color: "#26c6da", radius: 14,
        levels: [
            { costCash: 3800, damage: 30, range: 115, cooldown: 1300, slowAmount: 0.65, slowDuration: 3200 },
            { costCash: 7600, damage: 52, range: 130, cooldown: 1100, slowAmount: 0.75, slowDuration: 3700 },
            { costCash: 15200, damage: 90, range: 145, cooldown: 950, slowAmount: 0.85, slowDuration: 4200 }
        ]
    },
    hallowpunk: {
        id: "hallowpunk", name: "Hallow Punk", type: "dot", role: "Spectral Curse",
        priceCoins: 4400, color: "#5e35b1", radius: 13,
        levels: [
            { costCash: 3700, damage: 20, range: 105, cooldown: 1100, burnDamage: 10, burnDuration: 3500 },
            { costCash: 7400, damage: 35, range: 120, cooldown: 950, burnDamage: 16, burnDuration: 4000 },
            { costCash: 14800, damage: 60, range: 135, cooldown: 800, burnDamage: 28, burnDuration: 4500 }
        ]
    },
    harvester: {
        id: "harvester", name: "Harvester", type: "economy", role: "Soul Economy",
        priceCoins: 3000, color: "#4527a0", radius: 16,
        levels: [
            { costCash: 2500, income: 200, cooldown: 5000, range: 0 },
            { costCash: 5000, income: 450, cooldown: 5000, range: 0 },
            { costCash: 10000, income: 900, cooldown: 5000, range: 0 }
        ]
    },
    snowballer: {
        id: "snowballer", name: "Snowballer", type: "splash", role: "Rolling Snowball",
        priceCoins: 2300, color: "#e1f5fe", radius: 13,
        levels: [
            { costCash: 1900, damage: 20, range: 95, cooldown: 1200, splash: 45 },
            { costCash: 3800, damage: 36, range: 105, cooldown: 1050, splash: 55 },
            { costCash: 7600, damage: 65, range: 115, cooldown: 900, splash: 65 }
        ]
    },
    elementalist: {
        id: "elementalist", name: "Elementalist", type: "special", role: "Elemental Barrage",
        priceCoins: 5800, color: "#00838f", radius: 14,
        levels: [
            { costCash: 4800, damage: 50, range: 130, cooldown: 1000, elementCount: 2 },
            { costCash: 9600, damage: 90, range: 145, cooldown: 850, elementCount: 3 },
            { costCash: 19200, damage: 160, range: 160, cooldown: 700, elementCount: 4 }
        ]
    },
    fireworktechnician: {
        id: "fireworktechnician", name: "Firework Technician", type: "splash", role: "Aerial Fireworks",
        priceCoins: 3400, color: "#ff6f00", radius: 14,
        levels: [
            { costCash: 2800, damage: 35, range: 140, cooldown: 1500, splash: 55 },
            { costCash: 5600, damage: 62, range: 155, cooldown: 1300, splash: 65 },
            { costCash: 11200, damage: 110, range: 170, cooldown: 1100, splash: 78 }
        ]
    },
    biologist: {
        id: "biologist", name: "Biologist", type: "support", role: "Mutation Buff",
        priceCoins: 3900, color: "#558b2f", radius: 15,
        levels: [
            { costCash: 3200, buffAmount: 0.15, range: 110, cooldown: 4000 },
            { costCash: 6400, buffAmount: 0.25, range: 125, cooldown: 3500 },
            { costCash: 12800, buffAmount: 0.4, range: 140, cooldown: 3000 }
        ]
    },
    warlock: {
        id: "warlock", name: "Warlock", type: "dot", role: "Dark Curse",
        priceCoins: 5200, color: "#311b92", radius: 14,
        levels: [
            { costCash: 4300, damage: 40, range: 120, cooldown: 1200, burnDamage: 20, burnDuration: 4000 },
            { costCash: 8600, damage: 72, range: 135, cooldown: 1000, burnDamage: 34, burnDuration: 4500 },
            { costCash: 17200, damage: 130, range: 150, cooldown: 850, burnDamage: 60, burnDuration: 5000 }
        ]
    },
    spotlighttech: {
        id: "spotlighttech", name: "Spotlight Tech", type: "support", role: "Reveal & Mark",
        priceCoins: 2900, color: "#fdd835", radius: 16,
        levels: [
            { costCash: 2400, buffAmount: 0.2, range: 160, cooldown: 3000 },
            { costCash: 4800, buffAmount: 0.35, range: 180, cooldown: 2600 },
            { costCash: 9600, buffAmount: 0.5, range: 200, cooldown: 2200 }
        ]
    }
};

// Golden Tower variants with enhanced stats
const GOLDEN_TOWERS = {
    golden_scout: {
        id: "golden_scout", name: "Golden Scout", baseId: "scout",
        priceGems: 500, requiredLevel: 10,
        color: "#ffd700", radius: 13,
        statMultipliers: { damage: 1.5, range: 1.2, cooldown: 0.8 }
    },
    golden_soldier: {
        id: "golden_soldier", name: "Golden Soldier", baseId: "soldier",
        priceGems: 600, requiredLevel: 12,
        color: "#ffd700", radius: 13,
        statMultipliers: { damage: 1.4, range: 1.15, cooldown: 0.85 }
    },
    golden_demoman: {
        id: "golden_demoman", name: "Golden Demoman", baseId: "demoman",
        priceGems: 800, requiredLevel: 15,
        color: "#ffd700", radius: 15,
        statMultipliers: { damage: 1.6, splash: 1.3, cooldown: 0.9 }
    },
    golden_ranger: {
        id: "golden_ranger", name: "Golden Ranger", baseId: "ranger",
        priceGems: 1000, requiredLevel: 18,
        color: "#ffd700", radius: 13,
        statMultipliers: { damage: 1.5, range: 1.3, cooldown: 0.85 }
    },
    golden_farm: {
        id: "golden_farm", name: "Golden Farm", baseId: "farm",
        priceGems: 1200, requiredLevel: 20,
        color: "#ffd700", radius: 17,
        statMultipliers: { income: 2.0, cooldown: 0.8 }
    },
    golden_pyromancer: {
        id: "golden_pyromancer", name: "Golden Pyromancer", baseId: "pyromancer",
        priceGems: 1500, requiredLevel: 22,
        color: "#ffd700", radius: 14,
        statMultipliers: { damage: 1.5, burnDamage: 1.8, burnDuration: 1.3 }
    },
    golden_minigunner: {
        id: "golden_minigunner", name: "Golden Minigunner", baseId: "minigunner",
        priceGems: 2000, requiredLevel: 25,
        color: "#ffd700", radius: 14,
        statMultipliers: { damage: 1.6, cooldown: 0.7, range: 1.1 }
    },
    golden_commander: {
        id: "golden_commander", name: "Golden Commander", baseId: "commander",
        priceGems: 3000, requiredLevel: 30,
        color: "#ffd700", radius: 17,
        statMultipliers: { buffAmount: 1.5, range: 1.2, cooldown: 0.85 }
    },
    golden_crookboss: {
        id: "golden_crookboss", name: "Golden Crook Boss", baseId: "crookboss",
        priceGems: 1800, requiredLevel: 20,
        color: "#ffd700", radius: 15,
        statMultipliers: { damage: 1.5, income: 1.8, cooldown: 0.85 }
    },
    golden_cowboy: {
        id: "golden_cowboy", name: "Golden Cowboy", baseId: "cowboy",
        priceGems: 2200, requiredLevel: 24,
        color: "#ffd700", radius: 15,
        statMultipliers: { damage: 1.5, range: 1.2, cooldown: 0.85 }
    }
};

// --- 2. META PROGRESSION (Local Storage) ---
let playerData = {
    level: 1, xp: 0, coins: 0, gems: 0,
    ownedTowers: ["scout", "sniper"],
    goldenTowers: [],
    loadout: ["scout", "sniper"],
    dailyRewards: {
        lastClaimDate: null,
        streak: 0,
        claimedToday: false
    },
    quests: {
        active: [],
        completed: []
    },
    questProgress: {
        matchesWon: 0,
        wavesReached: 0,
        enemiesDefeated: 0,
        bossesDefeated: 0,
        towersPlaced: 0,
        towersUpgraded: 0
    }
};

// Daily rewards configuration
const DAILY_REWARDS = [
    { day: 1, coins: 50, gems: 0, xp: 20 },
    { day: 2, coins: 75, gems: 0, xp: 30 },
    { day: 3, coins: 100, gems: 5, xp: 40 },
    { day: 4, coins: 125, gems: 0, xp: 50 },
    { day: 5, coins: 150, gems: 10, xp: 60 },
    { day: 6, coins: 175, gems: 0, xp: 70 },
    { day: 7, coins: 200, gems: 25, xp: 100 }, // Weekly bonus
];

// Quest definitions
const QUEST_DEFINITIONS = {
    win_matches: {
        id: "win_matches",
        name: "Victory Hunter",
        description: "Win 5 matches",
        objective: "matchesWon",
        target: 5,
        reward: { coins: 200, gems: 10, xp: 100 }
    },
    reach_wave_10: {
        id: "reach_wave_10",
        name: "Wave Survivor",
        description: "Reach wave 10 in any match",
        objective: "wavesReached",
        target: 10,
        reward: { coins: 150, gems: 5, xp: 75 }
    },
    defeat_enemies: {
        id: "defeat_enemies",
        name: "Enemy Slayer",
        description: "Defeat 100 enemies",
        objective: "enemiesDefeated",
        target: 100,
        reward: { coins: 100, gems: 0, xp: 50 }
    },
    defeat_bosses: {
        id: "defeat_bosses",
        name: "Boss Hunter",
        description: "Defeat 5 bosses",
        objective: "bossesDefeated",
        target: 5,
        reward: { coins: 300, gems: 20, xp: 150 }
    },
    place_towers: {
        id: "place_towers",
        name: "Tower Builder",
        description: "Place 25 towers",
        objective: "towersPlaced",
        target: 25,
        reward: { coins: 120, gems: 5, xp: 60 }
    },
    upgrade_towers: {
        id: "upgrade_towers",
        name: "Upgrade Master",
        description: "Upgrade 15 towers",
        objective: "towersUpgraded",
        target: 15,
        reward: { coins: 180, gems: 8, xp: 90 }
    },
    reach_wave_20: {
        id: "reach_wave_20",
        name: "Endurance",
        description: "Reach wave 20 in any match",
        objective: "wavesReached",
        target: 20,
        reward: { coins: 400, gems: 30, xp: 200 }
    },
    win_hardcore: {
        id: "win_hardcore",
        name: "Hardcore Champion",
        description: "Win a Hardcore match",
        objective: "hardcoreWins",
        target: 1,
        reward: { coins: 500, gems: 50, xp: 300 }
    }
};

async function saveProgress() {
    if (authToken) {
        await saveGameData();
    } else {
        localStorage.setItem("tds_data", JSON.stringify(playerData));
    }
}

async function loadProgress() {
    if (authToken) {
        await loadUserData();
    } else {
        const data = localStorage.getItem("tds_data");
        if (data) playerData = { ...playerData, ...JSON.parse(data) };
    }
    
    // Check daily rewards reset
    const today = new Date().toDateString();
    if (playerData.dailyRewards.lastClaimDate !== today) {
        playerData.dailyRewards.claimedToday = false;
        // Reset streak if missed a day (more than 1 day gap)
        if (playerData.dailyRewards.lastClaimDate) {
            const lastDate = new Date(playerData.dailyRewards.lastClaimDate);
            const currentDate = new Date();
            const diffTime = Math.abs(currentDate - lastDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays > 1) {
                playerData.dailyRewards.streak = 0;
            }
        }
    }
    
    updateMenuStats();
}

function updateMenuStats() {
    document.getElementById("stat-username").innerText = currentUsername || "Player";
    document.getElementById("stat-level").innerText = playerData.level;
    document.getElementById("stat-xp").innerText = playerData.xp;
    document.getElementById("stat-coins").innerText = playerData.coins;
    document.getElementById("stat-gems").innerText = playerData.gems;
    document.getElementById("shop-coins").innerText = playerData.coins;
}

function addXP(amount) {
    playerData.xp += amount;
    const required = playerData.level * 100;
    if (playerData.xp >= required) {
        playerData.xp -= required;
        playerData.level++;
    }
    saveProgress();
}

// --- 3. UI MANAGEMENT (Menus, Shop, Loadout) ---
function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
}

// --- FRIENDS & REAL-TIME MATCHES ---
const SOCKET_BASE = API_BASE.replace(/\/api$/, "");
let socket = null;
let currentMatch = null; // { matchId, opponent, isHost } when in a live shared-board co-op match
let remoteState = null; // guest-only: latest authoritative board snapshot from the host
let guestSelectedTowerToPlace = null; // guest-only: tower the guest wants to place next
let guestSelectedUid = null; // guest-only: uid of the tower currently selected in the upgrade panel
let nextTowerUid = 1; // host/solo: unique id assigned to each placed tower (used for co-op sync)

function connectSocket() {
    if (socket || !authToken || typeof io === "undefined") return;
    socket = io(SOCKET_BASE, { auth: { token: authToken } });

    socket.on("connect_error", (err) => console.warn("Socket connect error:", err.message));

    socket.on("friend:request", ({ from }) => {
        showToast(`${from} sent you a friend request!`);
        if (document.getElementById("friends-screen").classList.contains("active")) loadFriendsScreen();
    });

    socket.on("friend:accepted", ({ from }) => {
        showToast(`${from} accepted your friend request!`);
        if (document.getElementById("friends-screen").classList.contains("active")) loadFriendsScreen();
    });

    socket.on("friend:removed", ({ from }) => {
        if (document.getElementById("friends-screen").classList.contains("active")) loadFriendsScreen();
    });

    socket.on("match:invite", ({ fromUsername }) => {
        const accept = confirm(`${fromUsername} challenged you to a real-time match! Accept?`);
        socket.emit("match:respond", { toUsername: fromUsername, accept });
    });

    socket.on("match:response", ({ fromUsername, accept }) => {
        if (!accept) showToast(`${fromUsername} declined your challenge.`);
    });

    socket.on("match:start", ({ matchId, opponent, isHost }) => {
        currentMatch = { matchId, opponent, isHost };
        remoteState = null;
        document.getElementById("match-feed-panel").classList.remove("hidden");
        document.getElementById("match-feed").innerHTML = "";
        showToast(isHost ? `Match with ${opponent} starting - you host the shared board!` : `Match with ${opponent} starting - joining their board...`);
        if (isHost) {
            buildMapSelection();
            showScreen("map-screen");
        } else {
            buildMapSelection(); // shows a "waiting for host" message for guests
            showScreen("map-screen");
        }
    });

    socket.on("match:event", ({ fromUsername, data }) => {
        if (!currentMatch) return;
        if (data.type === "init" && !currentMatch.isHost) {
            currentMap = MAPS[data.mapId] || MAPS.grasslands;
            path = currentMap.path;
            gameState.gameMode = data.modeId;
            showScreen("game-screen");
            startGuestMatch();
        } else if (data.type === "defeat") {
            addMatchFeed(`${fromUsername} defeated an enemy (+${data.reward})`);
        } else if (data.type === "gameover") {
            addMatchFeed(`Match ended - ${data.wave} waves cleared.`);
            currentMatch = null;
            document.getElementById("match-feed-panel").classList.add("hidden");
        }
    });

    // Guest receives authoritative board snapshots from the host
    socket.on("match:state", ({ state }) => {
        if (currentMatch && !currentMatch.isHost) remoteState = state;
    });

    // Host receives action requests from the guest and applies them to the real, shared gameState
    socket.on("match:action", ({ action }) => {
        if (currentMatch && currentMatch.isHost) applyRemoteAction(action);
    });
}

function disconnectSocket() {
    if (socket) { socket.disconnect(); socket = null; }
    currentMatch = null;
}

function sendMatchEvent(data) {
    if (socket && currentMatch) {
        socket.emit("match:event", { toUsername: currentMatch.opponent, data });
    }
}

function addMatchFeed(text) {
    const feed = document.getElementById("match-feed");
    if (!feed) return;
    const line = document.createElement("div");
    line.innerText = text;
    feed.prepend(line);
}

function showToast(message) {
    let toast = document.getElementById("toast-notice");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toast-notice";
        document.body.appendChild(toast);
    }
    toast.innerText = message;
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("show"), 3500);
}

async function loadFriendsScreen() {
    const listEl = document.getElementById("friends-list");
    const incomingEl = document.getElementById("friend-requests-list");
    const outgoingEl = document.getElementById("friend-outgoing-list");
    listEl.innerHTML = "<p>Loading...</p>";
    try {
        const data = await apiRequest("/friends");

        listEl.innerHTML = "";
        if (data.friends.length === 0) listEl.innerHTML = "<p>No friends yet. Add someone above!</p>";
        data.friends.forEach(f => {
            const div = document.createElement("div");
            div.className = "friend-row";
            div.innerHTML = `
                <span class="friend-status ${f.online ? "online" : "offline"}"></span>
                <span class="friend-name">${f.username}</span>
                <button class="challenge-btn" ${f.online ? "" : "disabled"}>${f.online ? "Challenge" : "Offline"}</button>
                <button class="remove-friend-btn">Remove</button>
            `;
            div.querySelector(".challenge-btn").addEventListener("click", () => {
                if (!socket) connectSocket();
                socket.emit("match:invite", { toUsername: f.username });
                showToast(`Challenge sent to ${f.username}`);
            });
            div.querySelector(".remove-friend-btn").addEventListener("click", async () => {
                await apiRequest("/friends/remove", "POST", { username: f.username });
                loadFriendsScreen();
            });
            listEl.appendChild(div);
        });

        incomingEl.innerHTML = "";
        if (data.incoming.length === 0) incomingEl.innerHTML = "<p>No pending requests.</p>";
        data.incoming.forEach(username => {
            const div = document.createElement("div");
            div.className = "friend-row";
            div.innerHTML = `
                <span class="friend-name">${username}</span>
                <button class="accept-btn">Accept</button>
                <button class="decline-btn">Decline</button>
            `;
            div.querySelector(".accept-btn").addEventListener("click", async () => {
                await apiRequest("/friends/accept", "POST", { username });
                loadFriendsScreen();
            });
            div.querySelector(".decline-btn").addEventListener("click", async () => {
                await apiRequest("/friends/decline", "POST", { username });
                loadFriendsScreen();
            });
            incomingEl.appendChild(div);
        });

        outgoingEl.innerHTML = "";
        if (data.outgoing.length === 0) outgoingEl.innerHTML = "<p>No sent requests.</p>";
        data.outgoing.forEach(username => {
            const div = document.createElement("div");
            div.className = "friend-row";
            div.innerHTML = `<span class="friend-name">${username}</span><span class="pending-text">Pending...</span>`;
            outgoingEl.appendChild(div);
        });
    } catch (error) {
        listEl.innerHTML = `<p class="error-text">${error.message}</p>`;
    }
}

document.getElementById("btn-add-friend").addEventListener("click", async () => {
    const input = document.getElementById("add-friend-input");
    const username = input.value.trim();
    const errorEl = document.getElementById("friend-error");
    errorEl.innerText = "";
    if (!username) return;
    try {
        await apiRequest("/friends/request", "POST", { username });
        input.value = "";
        loadFriendsScreen();
    } catch (error) {
        errorEl.innerText = error.message;
    }
});

// Authentication UI Handlers
document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("login-username").value;
    const password = document.getElementById("login-password").value;
    
    const result = await login(username, password);
    if (result.success) {
        showScreen("main-menu");
        updateMenuStats();
        connectSocket();
    } else {
        document.getElementById("login-error").innerText = result.error;
    }
});

document.getElementById("register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("register-username").value;
    const email = document.getElementById("register-email").value;
    const password = document.getElementById("register-password").value;
    
    const result = await register(username, email, password);
    if (result.success) {
        showScreen("main-menu");
        updateMenuStats();
        connectSocket();
    } else {
        document.getElementById("register-error").innerText = result.error;
    }
});

document.getElementById("btn-show-register").addEventListener("click", () => {
    showScreen("register-screen");
});

document.getElementById("btn-show-login").addEventListener("click", () => {
    showScreen("login-screen");
});

document.getElementById("btn-logout").addEventListener("click", async () => {
    const result = await logout();
    if (result.success) {
        disconnectSocket();
        showScreen("login-screen");
    }
});

document.getElementById("btn-return-hub").addEventListener("click", () => {
    window.location.href = "/";
});

document.getElementById("btn-play").addEventListener("click", () => {
    buildMapSelection();
    showScreen("map-screen");
});
document.getElementById("btn-shop").addEventListener("click", () => {
    buildShop(); showScreen("shop-screen");
});
document.getElementById("btn-loadout").addEventListener("click", () => {
    buildLoadout(); showScreen("loadout-screen");
});
document.getElementById("btn-daily").addEventListener("click", () => {
    buildDailyRewards(); showScreen("daily-screen");
});
document.getElementById("btn-quests").addEventListener("click", () => {
    buildQuests(); showScreen("quests-screen");
});
document.getElementById("btn-friends").addEventListener("click", () => {
    if (!socket) connectSocket();
    loadFriendsScreen(); showScreen("friends-screen");
});
document.querySelectorAll(".back-btn").forEach(btn => btn.addEventListener("click", () => showScreen("main-menu")));

function buildMapSelection() {
    const container = document.getElementById("map-container");
    const modeContainer = document.getElementById("mode-container");
    container.innerHTML = "";
    modeContainer.innerHTML = "";

    // Guests don't pick a map - they join whatever the host chooses on the shared board
    if (currentMatch && !currentMatch.isHost) {
        container.innerHTML = `<p>Waiting for <strong>${currentMatch.opponent}</strong> to choose a map and start the match...</p>`;
        return;
    }
    
    let selectedMap = currentMap;
    let selectedMode = GAME_MODES.normal;
    
    Object.values(MAPS).forEach(map => {
        const div = document.createElement("div");
        div.className = "tower-card";
        div.style.borderColor = map.difficulty === "Easy" ? "#2ecc71" : 
                               map.difficulty === "Medium" ? "#f39c12" : "#e74c3c";
        
        div.innerHTML = `
            <h3>${map.name}</h3>
            <p>${map.description}</p>
            <p>Difficulty: <span style="color: ${map.difficulty === "Easy" ? "#2ecc71" : map.difficulty === "Medium" ? "#f39c12" : "#e74c3c"}">${map.difficulty}</span></p>
            <button id="select-${map.id}">Select</button>
        `;
        container.appendChild(div);
        
        document.getElementById(`select-${map.id}`).addEventListener("click", () => {
            selectedMap = map;
            // Update selection visual
            document.querySelectorAll("#map-container .tower-card").forEach(c => c.style.background = "");
            div.style.background = "#34495e";
        });
    });
    
    Object.values(GAME_MODES).forEach(mode => {
        const div = document.createElement("div");
        div.className = "tower-card";
        div.style.borderColor = mode.id === "normal" ? "#2ecc71" : 
                               mode.id === "hardcore" ? "#e74c3c" : "#f39c12";
        
        div.innerHTML = `
            <h3>${mode.name}</h3>
            <p>${mode.description}</p>
            <p>Rewards: x${mode.xpMult} XP</p>
            <button id="mode-${mode.id}">Select</button>
        `;
        modeContainer.appendChild(div);
        
        document.getElementById(`mode-${mode.id}`).addEventListener("click", () => {
            selectedMode = mode;
            // Update selection visual
            document.querySelectorAll("#mode-container .tower-card").forEach(c => c.style.background = "");
            div.style.background = "#34495e";
        });
    });
    
    // Start button
    const startBtn = document.createElement("button");
    startBtn.className = "primary-btn";
    startBtn.innerText = "START GAME";
    startBtn.style.marginTop = "20px";
    startBtn.onclick = () => {
        currentMap = selectedMap;
        path = selectedMap.path;
        gameState.gameMode = selectedMode.id;
        if (currentMatch && currentMatch.isHost) {
            sendMatchEvent({ type: "init", mapId: selectedMap.id, modeId: selectedMode.id });
        }
        showScreen("game-screen");
        startGame();
    };
    modeContainer.appendChild(startBtn);
}

function buildDailyRewards() {
    const container = document.getElementById("daily-rewards-container");
    container.innerHTML = "";
    
    // Check if can claim today
    const today = new Date().toDateString();
    const canClaim = !playerData.dailyRewards.claimedToday;
    
    document.getElementById("daily-streak").innerText = playerData.dailyRewards.streak;
    
    DAILY_REWARDS.forEach((reward, index) => {
        const dayNum = (playerData.dailyRewards.streak % 7) + 1;
        const isCurrentDay = index + 1 === dayNum;
        const isPastDay = index + 1 < dayNum;
        
        const div = document.createElement("div");
        div.className = "tower-card";
        div.style.borderColor = isCurrentDay ? "#f39c12" : isPastDay ? "#2ecc71" : "#555";
        div.style.opacity = isPastDay ? "0.5" : "1";
        
        div.innerHTML = `
            <h3>Day ${reward.day}</h3>
            <p><span class="coin-text">+${reward.coins} Coins</span></p>
            ${reward.gems > 0 ? `<p><span class="gem-text">+${reward.gems} Gems</span></p>` : ""}
            <p>+${reward.xp} XP</p>
            ${isPastDay ? "<p>Claimed</p>" : isCurrentDay && !canClaim ? "<p>Wait until tomorrow</p>" : ""}
        `;
        container.appendChild(div);
    });
    
    const claimBtn = document.getElementById("btn-claim-daily");
    claimBtn.disabled = !canClaim;
    claimBtn.onclick = () => {
        if (canClaim) {
            const dayNum = (playerData.dailyRewards.streak % 7);
            const reward = DAILY_REWARDS[dayNum];
            
            playerData.coins += reward.coins;
            playerData.gems += reward.gems;
            addXP(reward.xp);
            
            playerData.dailyRewards.streak++;
            playerData.dailyRewards.lastClaimDate = today;
            playerData.dailyRewards.claimedToday = true;
            
            saveProgress();
            updateMenuStats();
            buildDailyRewards();
        }
    };
}

function buildQuests() {
    const activeContainer = document.getElementById("active-quests-container");
    const availableContainer = document.getElementById("available-quests-container");
    activeContainer.innerHTML = "";
    availableContainer.innerHTML = "";
    
    // Display active quests
    playerData.quests.active.forEach(questId => {
        const quest = QUEST_DEFINITIONS[questId];
        if (!quest) return;
        
        const progress = playerData.questProgress[quest.objective] || 0;
        const isComplete = progress >= quest.target;
        
        const div = document.createElement("div");
        div.className = "tower-card";
        div.style.borderColor = isComplete ? "#2ecc71" : "#f39c12";
        
        div.innerHTML = `
            <h3>${quest.name}</h3>
            <p>${quest.description}</p>
            <p>Progress: ${progress}/${quest.target}</p>
            <p>Rewards: <span class="coin-text">+${quest.reward.coins}</span>, <span class="gem-text">+${quest.reward.gems}</span>, +${quest.reward.xp} XP</p>
            ${isComplete ? `<button id="claim-quest-${questId}" class="primary-btn">Claim Reward</button>` : "<p>In Progress</p>"}
        `;
        activeContainer.appendChild(div);
        
        if (isComplete) {
            document.getElementById(`claim-quest-${questId}`).onclick = () => {
                playerData.coins += quest.reward.coins;
                playerData.gems += quest.reward.gems;
                addXP(quest.reward.xp);
                
                playerData.quests.active = playerData.quests.active.filter(id => id !== questId);
                playerData.quests.completed.push(questId);
                
                saveProgress();
                updateMenuStats();
                buildQuests();
            };
        }
    });
    
    // Display available quests
    Object.values(QUEST_DEFINITIONS).forEach(quest => {
        if (playerData.quests.active.includes(quest.id) || playerData.quests.completed.includes(quest.id)) return;
        
        const div = document.createElement("div");
        div.className = "tower-card";
        
        div.innerHTML = `
            <h3>${quest.name}</h3>
            <p>${quest.description}</p>
            <p>Target: ${quest.target}</p>
            <p>Rewards: <span class="coin-text">+${quest.reward.coins}</span>, <span class="gem-text">+${quest.reward.gems}</span>, +${quest.reward.xp} XP</p>
            <button id="start-quest-${quest.id}">Start Quest</button>
        `;
        availableContainer.appendChild(div);
        
        document.getElementById(`start-quest-${quest.id}`).onclick = () => {
            playerData.quests.active.push(quest.id);
            saveProgress();
            buildQuests();
        };
    });
}

// Turns a tower's raw level-1 stats into the kind of plain-English summary a shop
// tooltip should show: damage, fire rate, range, and whatever special ability its
// type grants (splash, chain, slow, burn, heal, income...).
function describeTowerStats(tower) {
    const s = tower.levels[0];
    const lines = [];

    if (s.damage !== undefined) lines.push(`Damage: ${s.damage}`);
    if (s.cooldown !== undefined) lines.push(`Fire Rate: ${(1000 / s.cooldown).toFixed(2)}/sec`);
    if (s.range) lines.push(`Range: ${s.range}`);

    const abilityBits = [];
    if (tower.type === "splash" && s.splash) abilityBits.push(`Splash radius ${s.splash}`);
    if (tower.type === "chain" && s.chainCount) abilityBits.push(`Chains to ${s.chainCount} extra targets`);
    if ((tower.type === "slow" || tower.type === "trap") && s.slowAmount) abilityBits.push(`Slows ${Math.round(s.slowAmount * 100)}% for ${(s.slowDuration / 1000).toFixed(1)}s`);
    if (tower.type === "dot" && s.burnDamage) abilityBits.push(`Burns for ${s.burnDamage}/tick over ${(s.burnDuration / 1000).toFixed(1)}s`);
    if (tower.type === "support" && s.healAmount) abilityBits.push(`Heals nearby towers ${s.healAmount}/tick`);
    if (tower.type === "economy" && s.income) abilityBits.push(`Generates $${s.income} every ${(s.cooldown / 1000).toFixed(0)}s`);
    if (tower.type === "trap") abilityBits.push("Triggers instantly on proximity - no travel time");
    if (tower.type === "damage" && s.chargeRate) abilityBits.push("Charges up the longer it fires without pause");

    lines.push(`Abilities: ${abilityBits.length ? abilityBits.join(", ") : "None"}`);
    lines.push(`(Level 1 stats shown - all stats improve with in-match upgrades)`);
    return lines.join("<br>");
}

function buildShop() {
    const container = document.getElementById("shop-container");
    container.innerHTML = "";
    
    // Regular towers section
    const regularHeader = document.createElement("h3");
    regularHeader.innerText = "Regular Towers";
    regularHeader.style.width = "100%";
    regularHeader.style.textAlign = "center";
    container.appendChild(regularHeader);
    
    Object.values(TOWER_DB).forEach(tower => {
        const div = document.createElement("div");
        div.className = "tower-card";
        const isOwned = playerData.ownedTowers.includes(tower.id);
        div.innerHTML = `
            <div class="tower-card-header">
                <h3>${tower.name}</h3>
                <button class="info-dots-btn" id="info-${tower.id}" title="Tower details">&#8942;</button>
            </div>
            <p>${tower.role}</p>
            <p>Cost: <span class="coin-text">${tower.priceCoins} Coins</span></p>
            <div class="tower-info hidden" id="info-panel-${tower.id}">${describeTowerStats(tower)}</div>
            <button ${isOwned ? "disabled" : ""} id="buy-${tower.id}">
                ${isOwned ? "Owned" : "Purchase"}
            </button>
        `;
        container.appendChild(div);

        document.getElementById(`info-${tower.id}`).addEventListener("click", (e) => {
            e.stopPropagation();
            document.getElementById(`info-panel-${tower.id}`).classList.toggle("hidden");
        });

        if (!isOwned) {
            document.getElementById(`buy-${tower.id}`).addEventListener("click", () => {
                if (playerData.coins >= tower.priceCoins) {
                    playerData.coins -= tower.priceCoins;
                    playerData.ownedTowers.push(tower.id);
                    saveProgress();
                    buildShop();
                    updateMenuStats();
                } else alert("Not enough coins!");
            });
        }
    });
    
    // Golden towers section
    const goldenHeader = document.createElement("h3");
    goldenHeader.innerText = "Golden Towers";
    goldenHeader.style.width = "100%";
    goldenHeader.style.textAlign = "center";
    goldenHeader.style.marginTop = "20px";
    container.appendChild(goldenHeader);
    
    Object.values(GOLDEN_TOWERS).forEach(tower => {
        const div = document.createElement("div");
        div.className = "tower-card";
        div.style.borderColor = "#ffd700";
        const isOwned = playerData.goldenTowers.includes(tower.id);
        const canUnlock = playerData.level >= tower.requiredLevel;
        const base = TOWER_DB[tower.baseId];
        const modifiedStats = { ...base.levels[0] };
        if (tower.statMultipliers) {
            for (let key in tower.statMultipliers) {
                if (modifiedStats[key] !== undefined) modifiedStats[key] *= tower.statMultipliers[key];
            }
        }
        const syntheticTower = { type: base.type, levels: [modifiedStats] };

        div.innerHTML = `
            <div class="tower-card-header">
                <h3 style="color: #ffd700;">${tower.name}</h3>
                <button class="info-dots-btn" id="info-${tower.id}" title="Tower details">&#8942;</button>
            </div>
            <p>${tower.baseId.charAt(0).toUpperCase() + tower.baseId.slice(1)} Variant</p>
            <p>Requires Level: ${tower.requiredLevel}</p>
            <p>Cost: <span class="gem-text">${tower.priceGems} Gems</span></p>
            <div class="tower-info hidden" id="info-panel-${tower.id}">${describeTowerStats(syntheticTower)}</div>
            <button ${isOwned ? "disabled" : !canUnlock ? "disabled" : ""} id="buy-${tower.id}">
                ${isOwned ? "Owned" : !canUnlock ? `Lvl ${tower.requiredLevel} Required` : "Purchase"}
            </button>
        `;
        container.appendChild(div);

        document.getElementById(`info-${tower.id}`).addEventListener("click", (e) => {
            e.stopPropagation();
            document.getElementById(`info-panel-${tower.id}`).classList.toggle("hidden");
        });

        if (!isOwned && canUnlock) {
            document.getElementById(`buy-${tower.id}`).addEventListener("click", () => {
                if (playerData.gems >= tower.priceGems) {
                    playerData.gems -= tower.priceGems;
                    playerData.goldenTowers.push(tower.id);
                    saveProgress();
                    buildShop();
                    updateMenuStats();
                } else alert("Not enough gems!");
            });
        }
    });
}

function buildLoadout() {
    const active = document.getElementById("active-loadout");
    const owned = document.getElementById("owned-towers");
    active.innerHTML = ""; owned.innerHTML = "";

    playerData.loadout.forEach(id => {
        const t = TOWER_DB[id] || GOLDEN_TOWERS[id];
        const div = document.createElement("div");
        div.className = "tower-card equipped";
        if (GOLDEN_TOWERS[id]) {
            div.style.borderColor = "#ffd700";
        }
        div.innerHTML = `<h3>${t.name}</h3><button onclick="unequip('${id}')">Remove</button>`;
        active.appendChild(div);
    });

    // Regular towers
    playerData.ownedTowers.forEach(id => {
        const t = TOWER_DB[id];
        const isEquipped = playerData.loadout.includes(id);
        const div = document.createElement("div");
        div.className = `tower-card ${isEquipped ? "equipped" : ""}`;
        div.innerHTML = `<h3>${t.name}</h3><button onclick="${isEquipped ? '' : `equip('${id}')`}" ${isEquipped ? "disabled" : ""}>Equip</button>`;
        owned.appendChild(div);
    });
    
    // Golden towers
    playerData.goldenTowers.forEach(id => {
        const t = GOLDEN_TOWERS[id];
        const isEquipped = playerData.loadout.includes(id);
        const div = document.createElement("div");
        div.className = `tower-card ${isEquipped ? "equipped" : ""}`;
        div.style.borderColor = "#ffd700";
        div.innerHTML = `<h3 style="color: #ffd700;">${t.name}</h3><button onclick="${isEquipped ? '' : `equip('${id}')`}" ${isEquipped ? "disabled" : ""}>Equip</button>`;
        owned.appendChild(div);
    });
}
window.equip = function(id) {
    if (playerData.loadout.length < 5 && !playerData.loadout.includes(id)) {
        playerData.loadout.push(id);
        saveProgress(); buildLoadout();
    } else if (playerData.loadout.length >= 5) alert("Loadout full (Max 5).");
};
window.unequip = function(id) {
    playerData.loadout = playerData.loadout.filter(t => t !== id);
    saveProgress(); buildLoadout();
};

// --- 4. GAME ENGINE (3D World, Objects, Logic) ---
// COORDINATE NOTE: every gameplay object still lives in the ORIGINAL 2D game-space
// (x, y) exactly like the old canvas version (0-800 x, 0-600 y). All damage, range,
// targeting and movement math below is untouched from the 2D game. The only new thing
// is a translation layer: worldPos(x, y) below maps that same (x, y) onto a 3D X/Z
// plane so it can be rendered with Three.js. Height (world Y) is purely visual.
function worldX(x) { return x - 400; }
function worldZ(y) { return y - 300; }
function toGameX(worldXVal) { return worldXVal + 400; }
function toGameY(worldZVal) { return worldZVal + 300; }

const MAP_BOUND_X = 460; // playable half-width in game-space units, with margin past the 800-wide canvas
const MAP_BOUND_Z = 360; // playable half-depth, with margin past the 600-tall canvas

let gameState = {
    running: false, cash: 500, hp: 100, wave: 1,
    towers: [], enemies: [], projectiles: [],
    selectedTowerToPlace: null,
    selectedPlacedTower: null,
    waveActive: false,
    waveTimer: 0,
    frames: 0,
    gameMode: "normal" // normal, molten, fallen, hardcore, challenge
};

// Map definitions with different paths and terrain (unchanged from the 2D game)
const MAPS = {
    grasslands: {
        id: "grasslands",
        name: "Grasslands",
        description: "Simple curved path for beginners",
        difficulty: "Easy",
        bgColor: "#3a7d3a",
        pathColor: "#c88a4a",
        path: [
            {x: -20, y: 150}, {x: 200, y: 150}, {x: 200, y: 400},
            {x: 600, y: 400}, {x: 600, y: 100}, {x: 820, y: 100}
        ]
    },
    desert: {
        id: "desert",
        name: "Desert",
        description: "Winding path with multiple turns",
        difficulty: "Medium",
        bgColor: "#d2a465",
        pathColor: "#8b5a2b",
        path: [
            {x: -20, y: 300}, {x: 150, y: 300}, {x: 150, y: 100},
            {x: 400, y: 100}, {x: 400, y: 500}, {x: 650, y: 500},
            {x: 650, y: 200}, {x: 820, y: 200}
        ]
    },
    tundra: {
        id: "tundra",
        name: "Tundra",
        description: "Long straight path with strategic corners",
        difficulty: "Medium",
        bgColor: "#a9c9d6",
        pathColor: "#4d7fa3",
        path: [
            {x: -20, y: 50}, {x: 400, y: 50}, {x: 400, y: 300},
            {x: 200, y: 300}, {x: 200, y: 550}, {x: 600, y: 550},
            {x: 600, y: 300}, {x: 820, y: 300}
        ]
    },
    volcanic: {
        id: "volcanic",
        name: "Volcanic",
        description: "Complex path with tight corners",
        difficulty: "Hard",
        bgColor: "#4a2a20",
        pathColor: "#ff4500",
        path: [
            {x: -20, y: 200}, {x: 100, y: 200}, {x: 100, y: 100},
            {x: 300, y: 100}, {x: 300, y: 400}, {x: 150, y: 400},
            {x: 150, y: 500}, {x: 500, y: 500}, {x: 500, y: 200},
            {x: 700, y: 200}, {x: 700, y: 450}, {x: 820, y: 450}
        ]
    },
    forest: {
        id: "forest",
        name: "Forest",
        description: "Zigzag path through dense terrain",
        difficulty: "Hard",
        bgColor: "#1f5c2e",
        pathColor: "#5c3a1e",
        path: [
            {x: -20, y: 300}, {x: 200, y: 300}, {x: 200, y: 150},
            {x: 350, y: 150}, {x: 350, y: 450}, {x: 500, y: 450},
            {x: 500, y: 100}, {x: 650, y: 100}, {x: 650, y: 350},
            {x: 820, y: 350}
        ]
    }
};

let currentMap = MAPS.grasslands;
let path = currentMap.path;

// Game mode definitions with modifiers (unchanged from the 2D game)
const GAME_MODES = {
    normal: {
        id: "normal", name: "Normal", description: "Standard gameplay",
        enemyHpMult: 1.0, enemySpeedMult: 1.0, spawnCountMult: 1.0, bossHpMult: 1.0, cashMult: 1.0, xpMult: 1.0, coinMult: 1.0,
        startingCash: 500, startingHp: 100
    },
    molten: {
        id: "molten", name: "Molten", description: "Enemies are much faster and hit harder for the money",
        enemyHpMult: 1.4, enemySpeedMult: 1.6, spawnCountMult: 1.0, bossHpMult: 1.3, cashMult: 1.1, xpMult: 1.5, coinMult: 1.5,
        startingCash: 550, startingHp: 90
    },
    fallen: {
        id: "fallen", name: "Fallen", description: "More enemies per wave and much stronger bosses",
        enemyHpMult: 1.3, enemySpeedMult: 1.15, spawnCountMult: 1.4, bossHpMult: 1.8, cashMult: 1.15, xpMult: 1.3, coinMult: 1.3,
        startingCash: 520, startingHp: 90
    },
    hardcore: {
        id: "hardcore", name: "Hardcore", description: "One life, tough enemies, and your income doesn't scale up to match",
        enemyHpMult: 2.2, enemySpeedMult: 1.4, spawnCountMult: 1.1, bossHpMult: 1.5, cashMult: 1.0, xpMult: 2.0, coinMult: 2.0,
        startingCash: 600, startingHp: 1
    },
    challenge: {
        id: "challenge", name: "Challenge", description: "Special enemy compositions and a much larger economy squeeze",
        enemyHpMult: 1.6, enemySpeedMult: 1.25, spawnCountMult: 1.5, bossHpMult: 1.4, cashMult: 1.1, xpMult: 1.8, coinMult: 1.8,
        startingCash: 600, startingHp: 75
    }
};

// --- GAMEPLAY CLASSES ---
// These are the exact same simulation classes as the 2D game: same stats, same
// targeting rules, same damage math, same coordinate updates. Only draw() is gone -
// visuals are now handled by the Object3DSync layer further down, which reads these
// objects' plain (x, y) fields every frame and positions 3D meshes to match.

class Enemy {
    constructor(type, waveMult) {
        this.x = path[0].x; this.y = path[0].y;
        this.pathIndex = 0;
        this.type = type;

        const mode = GAME_MODES[gameState.gameMode];

        if(type === "normal") {
            this.hp = 10 * waveMult; this.speed = 1.2 * mode.enemySpeedMult; this.reward = 5 * mode.cashMult;
            this.color = "#e74c3c"; this.radius = 10;
        }
        else if(type === "fast") {
            this.hp = 6 * waveMult; this.speed = 2.0 * mode.enemySpeedMult; this.reward = 5 * mode.cashMult;
            this.color = "#f39c12"; this.radius = 8;
        }
        else if(type === "boss") {
            this.hp = 150 * waveMult; this.speed = 0.7 * mode.enemySpeedMult; this.reward = 100 * mode.cashMult;
            this.color = "#8e44ad"; this.radius = 18;
            this.isBoss = true;
            this.phase = 1;
            this.maxPhases = 2;
            this.abilities = ["rage"];
            this.rageThreshold = 0.5;
            this.raged = false;
        }
        else if(type === "tank") {
            this.hp = 30 * waveMult; this.speed = 0.8 * mode.enemySpeedMult; this.reward = 15 * mode.cashMult;
            this.color = "#2c3e50"; this.radius = 14;
        }
        else if(type === "swarm") {
            this.hp = 3 * waveMult; this.speed = 2.5 * mode.enemySpeedMult; this.reward = 3 * mode.cashMult;
            this.color = "#1abc9c"; this.radius = 6;
        }
        else if(type === "shielded") {
            this.hp = 15 * waveMult; this.speed = 1.0 * mode.enemySpeedMult; this.reward = 12 * mode.cashMult;
            this.color = "#95a5a6"; this.radius = 11; this.shield = 10 * waveMult; this.maxShield = this.shield;
        }
        else if(type === "regen") {
            this.hp = 12 * waveMult; this.speed = 1.1 * mode.enemySpeedMult; this.reward = 10 * mode.cashMult;
            this.color = "#27ae60"; this.radius = 10; this.regenRate = 0.05;
        }
        else if(type === "immune") {
            this.hp = 20 * waveMult; this.speed = 1.0 * mode.enemySpeedMult; this.reward = 18 * mode.cashMult;
            this.color = "#c0392b"; this.radius = 12; this.immuneTo = ["splash"];
        }
        else if(type === "boss2") {
            this.hp = 300 * waveMult; this.speed = 0.5 * mode.enemySpeedMult; this.reward = 200 * mode.cashMult;
            this.color = "#9b59b6"; this.radius = 22;
            this.isBoss = true;
            this.phase = 1;
            this.maxPhases = 3;
            this.abilities = ["rage", "summon", "shield"];
            this.rageThreshold = 0.6;
            this.shieldThreshold = 0.3;
            this.raged = false;
            this.shielded = false;
            this.shieldAmount = 50 * waveMult;
        }

        // Co-op matches are tougher: double enemy health when playing with a friend on a shared board
        if (currentMatch) {
            this.hp *= 2;
        }

        // Harder modes hit bosses with extra HP on top of the normal wave scaling, so a
        // boss on Hardcore/Fallen is a genuinely different fight, not just a bigger number
        // that your existing income scales past.
        if (this.isBoss) {
            const mode = GAME_MODES[gameState.gameMode];
            this.hp *= (mode.bossHpMult || 1);
        }

        this.maxHp = this.hp;
        this.currentSpeed = this.speed;
        this.slowTimer = 0;
        this.burnTimer = 0;
        this.burnDamage = 0;
    }

    update() {
        if (this.isBoss) {
            const hpPercent = this.hp / this.maxHp;

            if (this.abilities.includes("rage") && !this.raged && hpPercent < this.rageThreshold) {
                this.raged = true;
                this.speed *= 1.5;
                this.color = "#e74c3c";
                this.phase++;
            }

            if (this.abilities.includes("shield") && !this.shielded && hpPercent < this.shieldThreshold) {
                this.shielded = true;
                this.shield = this.shieldAmount;
                this.phase++;
                this.color = "#3498db";
            }

            if (this.abilities.includes("summon") && this.phase === 2 && !this.summoned) {
                this.summoned = true;
                for (let i = 0; i < 3; i++) {
                    const minion = new Enemy("swarm", 1);
                    minion.x = this.x + (Math.random() - 0.5) * 30;
                    minion.y = this.y + (Math.random() - 0.5) * 30;
                    minion.pathIndex = this.pathIndex;
                    gameState.enemies.push(minion);
                }
            }
        }

        if (this.regenRate && this.hp < this.maxHp) {
            this.hp = Math.min(this.maxHp, this.hp + this.regenRate);
        }

        if (this.burnTimer > 0) {
            this.hp -= this.burnDamage;
            this.burnTimer--;
        }

        if (this.slowTimer > 0) {
            this.currentSpeed = this.speed * 0.5;
            this.slowTimer--;
        } else {
            this.currentSpeed = this.speed;
        }

        const target = path[this.pathIndex + 1];
        if (!target) return true;

        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const dist = Math.hypot(dx, dy);

        if (dist < this.currentSpeed) {
            this.x = target.x; this.y = target.y;
            this.pathIndex++;
            if (this.pathIndex >= path.length - 1) {
                gameState.hp -= 10;
                return true;
            }
        } else {
            this.x += (dx / dist) * this.currentSpeed;
            this.y += (dy / dist) * this.currentSpeed;
        }
        return false;
    }

    takeDamage(damage, type) {
        if (this.immuneTo && this.immuneTo.includes(type)) {
            return;
        }

        if (this.shield > 0) {
            if (this.shield >= damage) {
                this.shield -= damage;
                return;
            } else {
                damage -= this.shield;
                this.shield = 0;
            }
        }

        this.hp -= damage;
    }

    applySlow(amount, duration) {
        this.slowTimer = duration;
    }

    applyBurn(damage, duration) {
        this.burnDamage = damage;
        this.burnTimer = duration;
    }
}

// --- Per-player wallets (co-op: each player has their own money, not a shared pot) ---
function ensureWallet(username) {
    if (!gameState.playerCash) gameState.playerCash = {};
    if (gameState.playerCash[username] === undefined) gameState.playerCash[username] = 0;
    return gameState.playerCash[username];
}
function walletOf(username) { return (gameState.playerCash && gameState.playerCash[username]) || 0; }
function addToWallet(username, amount) { ensureWallet(username); gameState.playerCash[username] += amount; }
function spendFromWallet(username, amount) { ensureWallet(username); gameState.playerCash[username] -= amount; }
function myCash() { return walletOf(currentUsername); }

class Tower {
    constructor(typeId, x, y, owner) {
        this.typeId = typeId;
        this.uid = nextTowerUid++;
        this.owner = owner || currentUsername;
        this.isGolden = GOLDEN_TOWERS[typeId] !== undefined;

        if (this.isGolden) {
            this.goldenData = GOLDEN_TOWERS[typeId];
            this.baseData = TOWER_DB[this.goldenData.baseId];
        } else {
            this.baseData = TOWER_DB[typeId];
        }

        this.x = x; this.y = y;
        this.level = 0;
        this.lastAttack = 0;
        this.targetingMode = "first";
        this.charge = 0;
        this.facingAngle = 0; // radians, visual-only: which way the turret is currently facing
        this.rotationY = 0; // radians, visual-only: the yaw the player chose while placing it

        this.stats = this.applyGoldenMultipliers(this.baseData.levels[0]);
    }

    applyGoldenMultipliers(stats) {
        if (!this.isGolden || !this.goldenData.statMultipliers) return stats;

        const multipliers = this.goldenData.statMultipliers;
        const modifiedStats = { ...stats };

        for (let key in multipliers) {
            if (modifiedStats[key] !== undefined) {
                modifiedStats[key] = modifiedStats[key] * multipliers[key];
            }
        }

        return modifiedStats;
    }

    update() {
        if (this.baseData.type === "economy") {
            if (gameState.frames - this.lastAttack > (this.stats.cooldown / 16.66)) {
                addToWallet(this.owner, this.stats.income);
                if (this.owner === currentUsername) updateGameUI();
                this.lastAttack = gameState.frames;
                gameState.projectiles.push(new FloatText("+$" + this.stats.income, this.x, this.y - 20));
            }
            return;
        }

        if (this.baseData.type === "trap") {
            // Traps don't shoot - they instantly spring on whatever wanders into range,
            // on a per-trap reset cooldown. No projectile travel time.
            if (gameState.frames - this.lastAttack > (this.stats.cooldown / 16.66)) {
                let target = this.findTarget();
                if (target) {
                    target.takeDamage(this.stats.damage, "trap");
                    target.lastDamagedBy = this.owner;
                    if (this.stats.slowAmount && this.stats.slowDuration) {
                        target.applySlow(this.stats.slowAmount, this.stats.slowDuration);
                    }
                    this.lastAttack = gameState.frames;
                }
            }
            return;
        }

        if (this.baseData.type === "damage" && this.stats.chargeRate) {
            this.charge = Math.min(1, this.charge + this.stats.chargeRate);
        }

        const effectiveCooldown = this.stats.cooldown / (1 + (this.charge * 0.5));
        if (gameState.frames - this.lastAttack > (effectiveCooldown / 16.66)) {
            let target = this.findTarget();

            if (target) {
                gameState.projectiles.push(new Projectile(this.x, this.y, target, this.stats, this.baseData.type, this));
                this.lastAttack = gameState.frames;
                this.charge = 0;
            }
        }
    }

    findTarget() {
        let target = null;
        let bestValue = -1;

        for (let enemy of gameState.enemies) {
            const dist = Math.hypot(enemy.x - this.x, enemy.y - this.y);
            if (dist <= this.stats.range) {
                let currentValue = 0;

                switch(this.targetingMode) {
                    case "first":
                        currentValue = enemy.pathIndex * 1000 + dist;
                        break;
                    case "last":
                        currentValue = -(enemy.pathIndex * 1000 + dist);
                        break;
                    case "strongest":
                        currentValue = enemy.hp;
                        break;
                    case "weakest":
                        currentValue = -enemy.hp;
                        break;
                }

                if (currentValue > bestValue) {
                    bestValue = currentValue;
                    target = enemy;
                }
            }
        }

        return target;
    }

    upgrade() {
        if (this.level < this.baseData.levels.length - 1) {
            const nextLevel = this.baseData.levels[this.level + 1];
            if (walletOf(this.owner) >= nextLevel.costCash) {
                spendFromWallet(this.owner, nextLevel.costCash);
                this.level++;
                this.stats = this.applyGoldenMultipliers(nextLevel);
                playerData.questProgress.towersUpgraded = (playerData.questProgress.towersUpgraded || 0) + 1;
                if (this.owner === currentUsername) updateGameUI();
                return true;
            }
        }
        return false;
    }

    cycleTargeting() {
        const modes = ["first", "last", "strongest", "weakest"];
        const currentIndex = modes.indexOf(this.targetingMode);
        this.targetingMode = modes[(currentIndex + 1) % modes.length];
    }
}

class Projectile {
    constructor(x, y, target, stats, type, tower) {
        this.x = x; this.y = y; this.target = target;
        this.stats = stats; this.type = type;
        this.tower = tower;
        this.speed = 8; this.active = true;
        this.chainedEnemies = [];
        this.impactX = null; this.impactY = null; // visual-only: filled in when it hits
    }
    update() {
        if (!this.target || this.target.hp <= 0) { this.active = false; return; }

        const dx = this.target.x - this.x;
        const dy = this.target.y - this.y;
        const dist = Math.hypot(dx, dy);

        if (dist < this.speed) {
            if (this.type === "splash") {
                gameState.enemies.forEach(e => {
                    if (Math.hypot(e.x - this.target.x, e.y - this.target.y) <= this.stats.splash) {
                        e.takeDamage(this.stats.damage, "splash");
                        e.lastDamagedBy = this.tower.owner;
                    }
                });
            } else if (this.type === "chain") {
                this.target.takeDamage(this.stats.damage, "chain");
                this.target.lastDamagedBy = this.tower.owner;
                this.chainedEnemies.push(this.target);

                let remainingChains = (this.stats.chainCount || 0) - this.chainedEnemies.length;
                if (remainingChains > 0) {
                    let nextTarget = null;
                    let minDist = 100;

                    for (let e of gameState.enemies) {
                        if (!this.chainedEnemies.includes(e) && e.hp > 0) {
                            const d = Math.hypot(e.x - this.target.x, e.y - this.target.y);
                            if (d < minDist) {
                                minDist = d;
                                nextTarget = e;
                            }
                        }
                    }

                    if (nextTarget) {
                        this.target = nextTarget;
                        this.x = this.target.x;
                        this.y = this.target.y;
                        return;
                    }
                }
            } else if (this.type === "slow") {
                this.target.takeDamage(this.stats.damage || 0, "slow");
                this.target.lastDamagedBy = this.tower.owner;
                if (this.stats.slowAmount && this.stats.slowDuration) {
                    this.target.applySlow(this.stats.slowAmount, this.stats.slowDuration);
                }
            } else if (this.type === "dot") {
                this.target.takeDamage(this.stats.damage || 0, "dot");
                this.target.lastDamagedBy = this.tower.owner;
                if (this.stats.burnDamage && this.stats.burnDuration) {
                    this.target.applyBurn(this.stats.burnDamage, this.stats.burnDuration);
                }
            } else {
                this.target.takeDamage(this.stats.damage, "damage");
                this.target.lastDamagedBy = this.tower.owner;
            }

            this.impactX = this.target.x; this.impactY = this.target.y;
            this.active = false;
        } else {
            this.x += (dx / dist) * this.speed;
            this.y += (dy / dist) * this.speed;
        }
    }
}

class FloatText {
    constructor(text, x, y) { this.text = text; this.x = x; this.y = y; this.life = 60; this.active = true; }
    update() { this.y -= 0.5; this.life--; if(this.life <= 0) this.active = false; }
}

// --- 5. GAME LOOP & WAVE MANAGEMENT (unchanged from the 2D game) ---
let spawnQueue = [];
let spawnTimer = 0;

function generateWave() {
    const mode = GAME_MODES[gameState.gameMode];
    const waveMult = 1 + (gameState.wave * 0.2) * mode.enemyHpMult;
    let count = 5 + gameState.wave * 2;
    count = Math.floor(count * (mode.spawnCountMult || 1));

    spawnQueue = [];

    for (let i = 0; i < count; i++) {
        let type = "normal";

        if (gameState.wave > 2 && i % 3 === 0) type = "fast";
        if (gameState.wave > 6 && i % 5 === 0) type = "tank";
        if (gameState.wave > 8 && i % 6 === 0) type = "swarm";
        if (gameState.wave > 10 && i % 7 === 0) type = "shielded";
        if (gameState.wave > 12 && i % 8 === 0) type = "regen";
        if (gameState.wave > 15 && i % 9 === 0) type = "immune";

        if (gameState.wave % 5 === 0 && i === count - 1) type = "boss";
        if (gameState.wave % 10 === 0 && i === count - 1) type = "boss2";

        if (gameState.gameMode === "challenge" && gameState.wave % 3 === 0 && i % 2 === 0) {
            type = "immune";
        }

        spawnQueue.push({ type, waveMult });
    }
    gameState.waveActive = true;
    gameState.waveTimer = 180;
    // Reset the spawn clock relative to THIS match's frame counter - previously this was
    // never reset between matches, so a leftover value from a prior game could make the
    // "> 60 frames since last spawn" check stay false for a long time, silently stalling
    // the wave (looked like "Start Wave doesn't work").
    spawnTimer = gameState.frames;
}

// ============================================================================
// 3D PRESENTATION LAYER (new). Everything below reads the plain-data gameplay
// objects above (Tower/Enemy/Projectile x,y,stats,hp...) and keeps a parallel set
// of Three.js meshes in sync with them each frame. Nothing in this section ever
// changes gameState, damage, cost or targeting - it only look at it.
// ============================================================================

let renderer, scene, camera, clock;
let mapGroup = null;          // ground/road/props for the current map, rebuilt on map change
let playerRig = null;         // { mesh, x, z, yaw, vy, onGround }
let cameraRig = { pitch: 0.18, distance: 70 };
const keysDown = new Set();
let mouseNDC = { x: 0, y: 0 }; // current cursor position in normalized device coords, used for raycasting
let mouseSensitivity = 0.0024;
let raycaster = null;
const groundPlaneMath = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const towerMeshes = new Map();   // tower.uid -> { group, turretPivot, level, isGolden, rangeRing }
const enemyMeshes = new Map();   // enemy instance -> { group, healthBar, lastHp }
const projectileMeshes = new Map(); // projectile instance -> mesh
const floatTextMeshes = new Map();  // FloatText instance -> sprite
const impactEffects = []; // transient { mesh, life, maxLife, expandTo }
let selectionRing = null; // ring shown under the currently-selected placed tower
let placement = { active: false, towerId: null, rotationY: 0, group: null, valid: false };

// r128 has no THREE.CapsuleGeometry (that landed in r142+), so build a stand-in
// out of a cylinder body + two hemisphere caps, grouped so it behaves like one mesh.
function makeCapsuleGroup(radius, length, material) {
    const group = new THREE.Group();
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12, 1, true), material);
    group.add(cyl);
    const topCap = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), material);
    topCap.position.y = length / 2;
    group.add(topCap);
    const botCap = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), material);
    botCap.position.y = -length / 2;
    group.add(botCap);
    group.userData.bodyMaterial = material;
    return group;
}

function makeCanvasTextSprite(text, opts = {}) {
    const size = opts.size || 128;
    const cnv = document.createElement("canvas");
    cnv.width = size; cnv.height = size / 2;
    const c2 = cnv.getContext("2d");
    c2.fillStyle = opts.bg || "rgba(0,0,0,0)";
    c2.fillRect(0, 0, cnv.width, cnv.height);
    c2.font = `bold ${opts.fontSize || 40}px sans-serif`;
    c2.fillStyle = opts.color || "#ffffff";
    c2.textAlign = "center"; c2.textBaseline = "middle";
    c2.fillText(text, cnv.width / 2, cnv.height / 2);
    const tex = new THREE.CanvasTexture(cnv);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: opts.depthTest !== false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(opts.scaleX || 14, (opts.scaleX || 14) / 2, 1);
    return sprite;
}

function makeHealthBarSprite() {
    const cnv = document.createElement("canvas");
    cnv.width = 64; cnv.height = 16;
    const tex = new THREE.CanvasTexture(cnv);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(10, 2.5, 1);
    sprite.renderOrder = 999;
    sprite.userData.canvas = cnv;
    sprite.userData.ctx = cnv.getContext("2d");
    sprite.userData.texture = tex;
    return sprite;
}

function updateHealthBarSprite(sprite, ratio, shieldRatio, tint) {
    const ctx2 = sprite.userData.ctx;
    const cnv = sprite.userData.canvas;
    ctx2.clearRect(0, 0, cnv.width, cnv.height);
    ctx2.fillStyle = "#222";
    ctx2.fillRect(0, 6, cnv.width, 6);
    ctx2.fillStyle = tint || "#2ecc71";
    ctx2.fillRect(0, 6, cnv.width * Math.max(0, Math.min(1, ratio)), 6);
    if (shieldRatio > 0) {
        ctx2.fillStyle = "#3498db";
        ctx2.fillRect(0, 0, cnv.width * Math.max(0, Math.min(1, shieldRatio)), 4);
    }
    sprite.userData.texture.needsUpdate = true;
}

// --- Map/world construction ---
function clearGroup(group) {
    if (!group) return;
    while (group.children.length) {
        const child = group.children.pop();
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
        }
    }
}

function seededRandom(seed) {
    let s = seed;
    return function() {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
    };
}

function distanceToPathSegments(gx, gy) {
    let min = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1];
        const abx = b.x - a.x, aby = b.y - a.y;
        const lenSq = abx * abx + aby * aby || 1;
        let t = ((gx - a.x) * abx + (gy - a.y) * aby) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const px = a.x + abx * t, py = a.y + aby * t;
        const d = Math.hypot(gx - px, gy - py);
        if (d < min) min = d;
    }
    return min;
}

function buildMapWorld(map) {
    if (!mapGroup) { mapGroup = new THREE.Group(); scene.add(mapGroup); }
    clearGroup(mapGroup);

    // Ground
    const groundGeo = new THREE.PlaneGeometry(MAP_BOUND_X * 2 + 80, MAP_BOUND_Z * 2 + 80);
    const groundMat = new THREE.MeshStandardMaterial({ color: map.bgColor, roughness: 1.0 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.userData.isGround = true;
    mapGroup.add(ground);

    // Road (a strip of segments following the path, plus rounded joints at corners)
    const roadMat = new THREE.MeshStandardMaterial({ color: map.pathColor, roughness: 0.9 });
    const roadWidth = 40;
    for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1];
        const ax = worldX(a.x), az = worldZ(a.y), bx = worldX(b.x), bz = worldZ(b.y);
        const len = Math.hypot(bx - ax, bz - az);
        const segGeo = new THREE.BoxGeometry(roadWidth, 0.4, len);
        const seg = new THREE.Mesh(segGeo, roadMat);
        seg.position.set((ax + bx) / 2, 0.2, (az + bz) / 2);
        seg.rotation.y = Math.atan2(bx - ax, bz - az);
        seg.receiveShadow = true;
        mapGroup.add(seg);

        const jointGeo = new THREE.CylinderGeometry(roadWidth / 2, roadWidth / 2, 0.4, 16);
        const joint = new THREE.Mesh(jointGeo, roadMat);
        joint.position.set(ax, 0.2, az);
        joint.receiveShadow = true;
        mapGroup.add(joint);
    }
    const lastPt = path[path.length - 1];
    const lastJointGeo = new THREE.CylinderGeometry(roadWidth / 2, roadWidth / 2, 0.4, 16);
    const lastJoint = new THREE.Mesh(lastJointGeo, roadMat);
    lastJoint.position.set(worldX(lastPt.x), 0.2, worldZ(lastPt.y));
    mapGroup.add(lastJoint);

    // Spawn marker
    const spawnGeo = new THREE.ConeGeometry(14, 20, 4);
    const spawnMat = new THREE.MeshStandardMaterial({ color: "#e74c3c", emissive: "#5a0000", emissiveIntensity: 0.4 });
    const spawnMarker = new THREE.Mesh(spawnGeo, spawnMat);
    spawnMarker.position.set(worldX(path[0].x), 10, worldZ(path[0].y));
    mapGroup.add(spawnMarker);

    // Base marker (flag)
    const poleGeo = new THREE.CylinderGeometry(1, 1, 26, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: "#dddddd" });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(worldX(lastPt.x), 13, worldZ(lastPt.y));
    pole.castShadow = true;
    mapGroup.add(pole);
    const flagGeo = new THREE.PlaneGeometry(14, 9);
    const flagMat = new THREE.MeshStandardMaterial({ color: "#3498db", side: THREE.DoubleSide });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(worldX(lastPt.x) + 7, 22, worldZ(lastPt.y));
    mapGroup.add(flag);

    // Decorative props scattered off the road (deterministic per map so it doesn't jump around)
    const rand = seededRandom(map.id.length * 977 + 13);
    const propColor = map.id === "volcanic" ? "#5a2a1a" : map.id === "desert" ? "#a67c52" : "#2e5c2e";
    for (let i = 0; i < 60; i++) {
        const gx = (rand() - 0.5) * MAP_BOUND_X * 1.9;
        const gy = (rand() - 0.5) * MAP_BOUND_Z * 1.9;
        if (distanceToPathSegments(toGameX(gx), toGameY(gy)) < 45) continue; // keep clear of the road
        const kind = rand();
        let prop;
        if (kind < 0.5) {
            const s = 6 + rand() * 8;
            prop = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), new THREE.MeshStandardMaterial({ color: "#6b6b6b", flatShading: true }));
            prop.position.y = s * 0.4;
        } else {
            const h = 20 + rand() * 24;
            const trunk = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.5, h * 0.4, 6), new THREE.MeshStandardMaterial({ color: "#5a3a20" }));
            trunk.position.y = h * 0.2;
            const leaves = new THREE.Mesh(new THREE.ConeGeometry(h * 0.35, h * 0.7, 8), new THREE.MeshStandardMaterial({ color: propColor, flatShading: true }));
            leaves.position.y = h * 0.4 + h * 0.35;
            prop = new THREE.Group();
            prop.add(trunk); prop.add(leaves);
        }
        prop.position.x = gx; prop.position.z = gy;
        prop.castShadow = true; prop.receiveShadow = true;
        prop.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        mapGroup.add(prop);
    }

    scene.fog = new THREE.Fog(map.bgColor, 260, 900);
    renderer.setClearColor(new THREE.Color(map.bgColor).lerp(new THREE.Color("#000000"), 0.15));
}

// --- Scene / lighting / camera setup ---
function initThreeScene() {
    const container = document.getElementById("game3d-container");
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(65, container.clientWidth / container.clientHeight, 0.1, 3000);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x33361f, 0.7);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(180, 260, 120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -520; sun.shadow.camera.right = 520;
    sun.shadow.camera.top = 420; sun.shadow.camera.bottom = -420;
    sun.shadow.camera.far = 900;
    scene.add(sun);
    // Soft cool fill light from the opposite side, no shadows - takes the flat, single-source
    // look off the models without doubling the shadow cost.
    const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
    fill.position.set(-160, 140, -140);
    scene.add(fill);

    raycaster = new THREE.Raycaster();
    clock = new THREE.Clock();

    // Player rig: a small stylized capsule character
    const body = new THREE.Group();
    const torso = makeCapsuleGroup(7, 14, new THREE.MeshStandardMaterial({ color: "#3498db" }));
    torso.position.y = 16;
    torso.traverse(o => { if (o.isMesh) o.castShadow = true; });
    const head = new THREE.Mesh(new THREE.SphereGeometry(5.5, 12, 12), new THREE.MeshStandardMaterial({ color: "#f1c27d" }));
    head.position.y = 27; head.castShadow = true;
    const visor = new THREE.Mesh(new THREE.ConeGeometry(6, 6, 4), new THREE.MeshStandardMaterial({ color: "#2c3e50" }));
    visor.position.y = 27; visor.rotation.x = Math.PI / 2; visor.rotation.z = Math.PI / 4;
    body.add(torso); body.add(head);
    scene.add(body);

    playerRig = { mesh: body, x: worldX(-20) + 60, z: worldZ(300), yaw: Math.PI, vy: 0, onGround: true };

    window.addEventListener("resize", onWindowResize);
    onWindowResize();

    document.addEventListener("keydown", (e) => {
        keysDown.add(e.code);
        if (e.code === "ControlLeft" || e.code === "ControlRight") {
            e.preventDefault();
            if (document.pointerLockElement === renderer.domElement) {
                document.exitPointerLock();
            } else {
                renderer.domElement.requestPointerLock();
            }
        }
        if (placement.active) {
            if (e.code === "KeyR") {
                placement.rotationY += e.shiftKey ? -Math.PI / 8 : Math.PI / 8;
            } else if (e.code === "Escape") {
                exitPlacementMode();
            }
        }
    });
    document.addEventListener("keyup", (e) => keysDown.delete(e.code));

    // Look control: press Ctrl to lock the mouse and look around by moving it; press
    // Ctrl again to unlock and get the free cursor back for clicking UI/towers.
    renderer.domElement.addEventListener("mousemove", (e) => {
        const rect = renderer.domElement.getBoundingClientRect();
        mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouseNDC.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    });
    document.addEventListener("mousemove", (e) => {
        if (document.pointerLockElement !== renderer.domElement) return;
        playerRig.yaw -= e.movementX * mouseSensitivity;
        cameraRig.pitch -= e.movementY * mouseSensitivity;
        cameraRig.pitch = Math.max(-0.5, Math.min(1.1, cameraRig.pitch));
    });
    document.addEventListener("pointerlockchange", () => {
        const crosshair = document.getElementById("crosshair");
        if (crosshair) crosshair.style.display = document.pointerLockElement === renderer.domElement ? "block" : "none";
    });

    renderer.domElement.addEventListener("click", (e) => handlePrimaryAction(e));

    renderer.domElement.addEventListener("wheel", (e) => {
        cameraRig.distance = Math.max(30, Math.min(160, cameraRig.distance + e.deltaY * 0.08));
    });
    renderer.domElement.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (placement.active) exitPlacementMode();
    });
}

// While the mouse is locked, aim from the screen center (crosshair); otherwise use
// wherever the free cursor actually is.
function currentRaycastNDC() {
    if (document.pointerLockElement === renderer.domElement) return { x: 0, y: 0 };
    return mouseNDC;
}

function onWindowResize() {
    const container = document.getElementById("game3d-container");
    if (!container || !renderer) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

// --- Player movement & third-person camera ---
function updatePlayer(dt) {
    const forward = new THREE.Vector3(-Math.sin(playerRig.yaw), 0, -Math.cos(playerRig.yaw));
    const right = new THREE.Vector3(Math.cos(playerRig.yaw), 0, -Math.sin(playerRig.yaw));
    const sprint = keysDown.has("ShiftLeft") || keysDown.has("ShiftRight");
    const speed = (sprint ? 130 : 78) * dt;

    let move = new THREE.Vector3();
    if (keysDown.has("KeyW") || keysDown.has("ArrowUp")) move.add(forward);
    if (keysDown.has("KeyS") || keysDown.has("ArrowDown")) move.sub(forward);
    if (keysDown.has("KeyD") || keysDown.has("ArrowRight")) move.add(right);
    if (keysDown.has("KeyA") || keysDown.has("ArrowLeft")) move.sub(right);
    if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(speed);
        playerRig.x += move.x;
        playerRig.z += move.z;
    }

    // Jump / gravity (purely cosmetic hop, no gameplay effect)
    if (keysDown.has("Space") && playerRig.onGround) {
        playerRig.vy = 62;
        playerRig.onGround = false;
    }
    playerRig.vy -= 180 * dt;
    playerRig.groundY = (playerRig.groundY || 0) + playerRig.vy * dt;
    if (playerRig.groundY <= 0) { playerRig.groundY = 0; playerRig.vy = 0; playerRig.onGround = true; }

    // Keep inside the map
    playerRig.x = Math.max(-MAP_BOUND_X, Math.min(MAP_BOUND_X, playerRig.x));
    playerRig.z = Math.max(-MAP_BOUND_Z, Math.min(MAP_BOUND_Z, playerRig.z));

    // Push out of towers so the player can't stand inside them
    for (const t of gameState.towers) {
        const tx = worldX(t.x), tz = worldZ(t.y);
        const minDist = (t.baseData.radius || 12) + 9;
        const dx = playerRig.x - tx, dz = playerRig.z - tz;
        const d = Math.hypot(dx, dz);
        if (d < minDist && d > 0.001) {
            const push = (minDist - d);
            playerRig.x += (dx / d) * push;
            playerRig.z += (dz / d) * push;
        }
    }

    playerRig.mesh.position.set(playerRig.x, playerRig.groundY, playerRig.z);
    playerRig.mesh.rotation.y = playerRig.yaw;
}

function updateCamera() {
    const target = new THREE.Vector3(playerRig.x, (playerRig.groundY || 0) + 20, playerRig.z);
    const offset = new THREE.Vector3(0, 0, cameraRig.distance);
    offset.applyAxisAngle(new THREE.Vector3(1, 0, 0), -cameraRig.pitch);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), playerRig.yaw);
    let desired = target.clone().add(offset);

    // Avoid clipping through the ground
    if (desired.y < 6) desired.y = 6;

    camera.position.copy(desired);
    camera.lookAt(target);
}

// --- Tower 3D models (primitive-built, tiered by level, distinguished by type/color) ---
function buildTowerGroup(baseData, level, isGolden) {
    const group = new THREE.Group();
    const tier = level; // 0,1,2
    const color = new THREE.Color(baseData.color);
    const baseR = 9 + tier * 2.5;
    const baseH = 5 + tier * 2;

    const baseMat = new THREE.MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.65 });
    const baseMesh = new THREE.Mesh(new THREE.CylinderGeometry(baseR, baseR * 1.15, baseH, 14), baseMat);
    baseMesh.position.y = baseH / 2;
    baseMesh.castShadow = true; baseMesh.receiveShadow = true;
    group.add(baseMesh);

    const turretPivot = new THREE.Group();
    turretPivot.position.y = baseH;
    group.add(turretPivot);

    const turretMat = new THREE.MeshStandardMaterial({
        color: isGolden ? new THREE.Color("#ffd700") : color.clone().offsetHSL(0, 0, 0.08),
        metalness: 0.4, roughness: 0.4,
        emissive: isGolden ? new THREE.Color("#8a6d00") : new THREE.Color(0, 0, 0),
        emissiveIntensity: isGolden ? 0.5 : 0
    });

    const type = baseData.type;
    let barrelLength = 14 + tier * 5;
    if (type === "splash" || type === "dot") {
        const turretBody = new THREE.Mesh(new THREE.SphereGeometry(6 + tier * 1.5, 10, 10), turretMat);
        turretBody.position.y = 5;
        turretPivot.add(turretBody);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(2 + tier * 0.6, 2.6 + tier * 0.8, barrelLength, 8), turretMat);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 5, barrelLength / 2);
        turretPivot.add(barrel);
    } else if (type === "chain") {
        const turretBody = new THREE.Mesh(new THREE.IcosahedronGeometry(6 + tier * 1.5, 0), turretMat);
        turretBody.position.y = 6; turretBody.rotation.y = 0.4;
        turretPivot.add(turretBody);
        for (let i = 0; i < 3; i++) {
            const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 10 + tier * 3, 6), turretMat);
            rod.position.set(0, 6, 0);
            rod.rotation.z = (i / 3) * Math.PI * 2;
            rod.rotation.x = Math.PI / 2;
            turretPivot.add(rod);
        }
    } else if (type === "slow") {
        const turretBody = new THREE.Mesh(new THREE.CylinderGeometry(5 + tier, 6 + tier, 8, 10), turretMat);
        turretBody.position.y = 5;
        turretPivot.add(turretBody);
        const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(4 + tier * 1.3, 0), new THREE.MeshStandardMaterial({ color: "#a8e0ff", transparent: true, opacity: 0.85, emissive: "#3498db", emissiveIntensity: 0.3 }));
        crystal.position.set(0, 12, barrelLength * 0.4);
        turretPivot.add(crystal);
    } else if (type === "trap") {
        // Traps don't aim and have no barrel - a low spiked plate set into the ground.
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(8 + tier * 1.5, 8 + tier * 1.5, 2, 12), turretMat);
        plate.position.y = 1;
        turretPivot.add(plate);
        const spikeCount = 5 + tier * 2;
        for (let i = 0; i < spikeCount; i++) {
            const spikeH = 5 + tier * 1.5;
            const spike = new THREE.Mesh(new THREE.ConeGeometry(1 + tier * 0.2, spikeH, 6), turretMat);
            const angle = (i / spikeCount) * Math.PI * 2;
            const r = 5 + tier;
            spike.position.set(Math.cos(angle) * r, 2 + spikeH / 2, Math.sin(angle) * r);
            turretPivot.add(spike);
        }
    } else if (type === "economy") {
        const chest = new THREE.Mesh(new THREE.BoxGeometry(11, 8, 9), turretMat);
        chest.position.y = 4;
        turretPivot.add(chest);
        const lid = new THREE.Mesh(new THREE.BoxGeometry(11.4, 2, 9.4), new THREE.MeshStandardMaterial({ color: "#ffd700", metalness: 0.6, roughness: 0.3 }));
        lid.position.y = 8.5;
        turretPivot.add(lid);
    } else {
        // damage / support / special / chain-adjacent default: gun turret + barrel
        const turretBody = new THREE.Mesh(new THREE.BoxGeometry(9 + tier * 2, 7 + tier, 10 + tier * 2), turretMat);
        turretBody.position.y = 5;
        turretPivot.add(turretBody);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1.6 + tier * 0.5, 1.6 + tier * 0.5, barrelLength, 8), turretMat);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 5, barrelLength / 2 + 4);
        turretPivot.add(barrel);
    }
    turretPivot.traverse(o => { if (o.isMesh) { o.castShadow = true; } });

    // Level rings around the base - more rings = higher level
    for (let i = 0; i <= tier; i++) {
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(baseR + 1.5, 0.5, 6, 20),
            new THREE.MeshStandardMaterial({ color: isGolden ? "#ffd700" : "#ffffff", emissive: isGolden ? "#ffd700" : "#888888", emissiveIntensity: 0.4 })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.6 + i * 1.6;
        group.add(ring);
    }

    // Small floating level-number label
    const label = makeCanvasTextSprite(String(level + 1), { color: "#ffffff", scaleX: 9 });
    label.position.y = baseH + 18 + tier * 4;
    group.add(label);
    group.userData.levelLabel = label;

    group.userData.turretPivot = turretPivot;
    group.userData.barrelTip = new THREE.Vector3(0, baseH + 5, barrelLength);
    return group;
}

function ensureTowerMesh(tower) {
    let entry = towerMeshes.get(tower.uid);
    if (!entry || entry.level !== tower.level || entry.isGolden !== tower.isGolden) {
        if (entry) { mapGroup.remove(entry.group); disposeObject3D(entry.group); }
        const group = buildTowerGroup(tower.baseData, tower.level, tower.isGolden);
        group.position.set(worldX(tower.x), 0, worldZ(tower.y));
        group.rotation.y = tower.rotationY || 0;
        group.castShadow = true;
        scene.add(group);
        entry = { group, turretPivot: group.userData.turretPivot, level: tower.level, isGolden: tower.isGolden };
        towerMeshes.set(tower.uid, entry);
    }
    return entry;
}

function disposeObject3D(obj) {
    obj.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
            else o.material.dispose();
        }
    });
}

function syncTowers() {
    const seen = new Set();
    for (const tower of gameState.towers) {
        seen.add(tower.uid);
        const entry = ensureTowerMesh(tower);
        // Aim the turret at whatever the tower would currently target (visual only - reuses
        // the tower's own real targeting rule, does not affect gameplay).
        const target = tower.findTarget();
        if (target) {
            const dx = worldX(target.x) - entry.group.position.x;
            const dz = worldZ(target.y) - entry.group.position.z;
            const desiredYaw = Math.atan2(dx, dz) - tower.rotationY;
            entry.turretPivot.rotation.y = desiredYaw;
        }
        if (tower.baseData.type === "trap") {
            if (entry.lastAttackSeen === undefined) entry.lastAttackSeen = tower.lastAttack;
            if (tower.lastAttack !== entry.lastAttackSeen) {
                entry.lastAttackSeen = tower.lastAttack;
                spawnImpactEffect(tower.x, tower.y, (tower.stats.range || 40) * 0.5, "#8e44ad");
            }
        }
    }
    for (const [uid, entry] of towerMeshes) {
        if (!seen.has(uid)) {
            scene.remove(entry.group);
            disposeObject3D(entry.group);
            towerMeshes.delete(uid);
        }
    }

    // Selection range ring
    if (gameState.selectedPlacedTower) {
        const t = gameState.selectedPlacedTower;
        if (!selectionRing) {
            selectionRing = new THREE.Mesh(new THREE.RingGeometry(1, 1.6, 48), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
            selectionRing.rotation.x = -Math.PI / 2;
            scene.add(selectionRing);
        }
        const r = t.stats.range || 1;
        selectionRing.scale.set(r, r, r);
        selectionRing.position.set(worldX(t.x), 0.5, worldZ(t.y));
        selectionRing.visible = true;
    } else if (selectionRing) {
        selectionRing.visible = false;
    }
}

// --- Enemy 3D models ---
function buildEnemyGroup(type, color, radius, isBoss) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color });
    const body = makeCapsuleGroup(radius * 0.7, radius * 1.1, mat);
    body.position.y = radius * 1.2;
    body.traverse(o => { if (o.isMesh) o.castShadow = true; });
    group.add(body);
    group.userData.bodyMaterial = mat;
    if (isBoss) {
        const crown = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.6, radius * 0.8, 6), new THREE.MeshStandardMaterial({ color: "#f1c40f", emissive: "#886500", emissiveIntensity: 0.4 }));
        crown.position.y = radius * 2.3;
        group.add(crown);
    }
    const shieldRing = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.15, 0.5, 6, 16), new THREE.MeshStandardMaterial({ color: "#3498db", emissive: "#3498db", emissiveIntensity: 0.5, transparent: true, opacity: 0.7 }));
    shieldRing.rotation.x = Math.PI / 2;
    shieldRing.position.y = radius * 1.2;
    shieldRing.visible = false;
    group.add(shieldRing);
    group.userData.shieldRing = shieldRing;

    const healthBar = makeHealthBarSprite();
    healthBar.position.y = radius * 2.6 + (isBoss ? 6 : 0);
    group.add(healthBar);
    group.userData.healthBar = healthBar;

    if (isBoss) {
        const phaseLabel = makeCanvasTextSprite("P1", { color: "#ffffff", scaleX: 10 });
        phaseLabel.position.y = radius * 2.6 + 12;
        group.add(phaseLabel);
        group.userData.phaseLabel = phaseLabel;
    }
    return group;
}

function syncEnemies() {
    const seen = new Set();
    for (const enemy of gameState.enemies) {
        seen.add(enemy);
        let entry = enemyMeshes.get(enemy);
        if (!entry) {
            const group = buildEnemyGroup(enemy.type, enemy.color, enemy.radius, !!enemy.isBoss);
            scene.add(group);
            entry = { group, lastX: worldX(enemy.x), lastZ: worldZ(enemy.y) };
            enemyMeshes.set(enemy, entry);
        }
        const nx = worldX(enemy.x), nz = worldZ(enemy.y);
        const dx = nx - entry.lastX, dz = nz - entry.lastZ;
        if (Math.hypot(dx, dz) > 0.01) {
            entry.group.rotation.y = Math.atan2(dx, dz);
        }
        entry.group.position.set(nx, 0, nz);
        entry.lastX = nx; entry.lastZ = nz;

        entry.group.userData.shieldRing.visible = enemy.shield > 0;
        updateHealthBarSprite(entry.group.userData.healthBar, enemy.hp / enemy.maxHp, enemy.shield > 0 ? enemy.shield / (enemy.maxShield || enemy.shieldAmount || 1) : 0, "#2ecc71");
        if (entry.group.userData.phaseLabel && entry.group.userData.phaseLabel.userData.lastPhase !== enemy.phase) {
            entry.group.remove(entry.group.userData.phaseLabel);
            const newLabel = makeCanvasTextSprite("P" + enemy.phase, { color: "#ffffff", scaleX: 10 });
            newLabel.position.y = entry.group.userData.healthBar.position.y + 6;
            newLabel.userData.lastPhase = enemy.phase;
            entry.group.add(newLabel);
            entry.group.userData.phaseLabel = newLabel;
        }
        // Recolor the body if the underlying enemy color changed (e.g. boss rage/shield)
        entry.group.userData.bodyMaterial.color.set(enemy.color);
    }
    for (const [enemy, entry] of enemyMeshes) {
        if (!seen.has(enemy)) {
            scene.remove(entry.group);
            disposeObject3D(entry.group);
            enemyMeshes.delete(enemy);
        }
    }
}

// --- Projectiles & impact effects ---
function projectileColor(type) {
    return type === "chain" ? "#9b59b6" : type === "slow" ? "#3498db" : type === "dot" ? "#e74c3c" : "#ffffff";
}

function spawnImpactEffect(gx, gy, radius, color) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 10), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }));
    mesh.position.set(worldX(gx), 8, worldZ(gy));
    scene.add(mesh);
    impactEffects.push({ mesh, life: 0, maxLife: 0.25, expandTo: Math.max(4, radius || 6) });
}

function syncProjectiles() {
    const seen = new Set();
    for (const p of gameState.projectiles) {
        seen.add(p);
        let mesh = projectileMeshes.get(p);
        if (!mesh) {
            mesh = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 8), new THREE.MeshStandardMaterial({ color: projectileColor(p.type), emissive: projectileColor(p.type), emissiveIntensity: 0.6 }));
            scene.add(mesh);
            projectileMeshes.set(p, mesh);
        }
        mesh.position.set(worldX(p.x), 10, worldZ(p.y));
        if (!p.active) {
            scene.remove(mesh);
            disposeObject3D(mesh);
            projectileMeshes.delete(p);
            if (p.impactX !== null) {
                spawnImpactEffect(p.impactX, p.impactY, p.stats.splash, projectileColor(p.type));
            }
        }
    }
    for (const [p, mesh] of projectileMeshes) {
        if (!seen.has(p)) {
            scene.remove(mesh);
            disposeObject3D(mesh);
            projectileMeshes.delete(p);
        }
    }

    for (let i = impactEffects.length - 1; i >= 0; i--) {
        const fx = impactEffects[i];
        fx.life += clock.getDelta ? 0 : 0; // no-op, dt applied by caller below
    }
}

function updateImpactEffects(dt) {
    for (let i = impactEffects.length - 1; i >= 0; i--) {
        const fx = impactEffects[i];
        fx.life += dt;
        const t = Math.min(1, fx.life / fx.maxLife);
        const scale = 1 + t * fx.expandTo;
        fx.mesh.scale.set(scale, scale, scale);
        fx.mesh.material.opacity = 0.8 * (1 - t);
        if (t >= 1) {
            scene.remove(fx.mesh);
            disposeObject3D(fx.mesh);
            impactEffects.splice(i, 1);
        }
    }
}

function syncFloatTexts() {
    const seen = new Set();
    for (const ft of gameState.projectiles) {
        if (!(ft instanceof FloatText)) continue;
        seen.add(ft);
        let sprite = floatTextMeshes.get(ft);
        if (!sprite) {
            sprite = makeCanvasTextSprite(ft.text, { color: "#2ecc71", scaleX: 12 });
            scene.add(sprite);
            floatTextMeshes.set(ft, sprite);
        }
        sprite.position.set(worldX(ft.x), 22 + (60 - ft.life) * 0.4, worldZ(ft.y));
        sprite.material.opacity = Math.max(0, ft.life / 60);
    }
    for (const [ft, sprite] of floatTextMeshes) {
        if (!seen.has(ft)) {
            scene.remove(sprite);
            disposeObject3D(sprite);
            floatTextMeshes.delete(ft);
        }
    }
}

// --- Tower placement (3D raycast-based) ---
function enterPlacementMode(id) {
    if (placement.active && placement.towerId === id) { exitPlacementMode(); return; }
    if (placement.active) exitPlacementMode();

    const base = TOWER_DB[id] || (GOLDEN_TOWERS[id] ? TOWER_DB[GOLDEN_TOWERS[id].baseId] : null);
    if (!base) return;
    const isGolden = !!GOLDEN_TOWERS[id];
    placement.active = true;
    placement.towerId = id;
    placement.rotationY = 0;
    placement.valid = false;

    const group = buildTowerGroup(base, 0, isGolden);
    group.traverse(o => {
        if (o.isMesh) {
            o.material = o.material.clone();
            o.material.transparent = true;
            o.material.opacity = 0.55;
        }
    });
    const rangeGeo = new THREE.RingGeometry(1, 1.6, 48);
    const rangeRing = new THREE.Mesh(rangeGeo, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    rangeRing.rotation.x = -Math.PI / 2;
    const r = base.levels[0].range || 1;
    rangeRing.scale.set(r, r, r);
    rangeRing.position.y = 0.4;
    group.add(rangeRing);
    group.userData.rangeRing = rangeRing;

    scene.add(group);
    placement.group = group;
    gameState.selectedTowerToPlace = id;
}

function exitPlacementMode() {
    if (placement.group) {
        scene.remove(placement.group);
        disposeObject3D(placement.group);
    }
    placement = { active: false, towerId: null, rotationY: 0, group: null, valid: false };
    gameState.selectedTowerToPlace = null;
    buildMatchLoadout();
}

function updatePlacementPreview() {
    if (!placement.active) return;
    raycaster.setFromCamera(currentRaycastNDC(), camera);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(groundPlaneMath, hit)) return;

    const gx = toGameX(hit.x), gy = toGameY(hit.z);
    let valid = gx > 10 && gx < 790 && gy > 10 && gy < 590;
    if (valid && distanceToPathSegments(gx, gy) < 28) valid = false;
    if (valid) {
        for (const t of gameState.towers) {
            if (Math.hypot(t.x - gx, t.y - gy) < (t.baseData.radius || 12) + 16) { valid = false; break; }
        }
    }

    placement.group.position.set(hit.x, 0, hit.z);
    placement.group.rotation.y = placement.rotationY;
    placement.valid = valid;
    placement.lastGameX = gx;
    placement.lastGameY = gy;
    placement.group.traverse(o => {
        if (o.isMesh && o !== placement.group.userData.rangeRing) {
            o.material.color.set(valid ? o.material.color : o.material.color);
        }
    });
    // Tint the whole preview red/green by adjusting the range ring + a simple emissive pulse on base
    placement.group.userData.rangeRing.material.color.set(valid ? "#2ecc71" : "#e74c3c");
}

function confirmPlacement() {
    if (!placement.active || !placement.valid) return;
    const id = placement.towerId;
    const base = TOWER_DB[id] || TOWER_DB[GOLDEN_TOWERS[id].baseId];
    const cost = base.levels[0].costCash;
    if (myCash() < cost) return;

    spendFromWallet(currentUsername, cost);
    const tower = new Tower(id, placement.lastGameX, placement.lastGameY, currentUsername);
    tower.rotationY = placement.rotationY;
    gameState.towers.push(tower);
    playerData.questProgress.towersPlaced = (playerData.questProgress.towersPlaced || 0) + 1;
    exitPlacementMode();
    updateGameUI();
}

// --- Interaction: click a placed tower (host/solo) to open its upgrade panel ---
function tryInteractClick() {
    raycaster.setFromCamera(currentRaycastNDC(), camera);
    let closest = null, closestDist = Infinity;
    for (const t of gameState.towers) {
        const entry = towerMeshes.get(t.uid);
        if (!entry) continue;
        const hits = raycaster.intersectObject(entry.group, true);
        if (hits.length > 0 && hits[0].distance < closestDist) {
            closestDist = hits[0].distance;
            closest = t;
        }
    }
    if (closest && closestDist < 260) {
        gameState.selectedPlacedTower = closest;
        showUpgradePanel(closest);
    } else {
        gameState.selectedPlacedTower = null;
        document.getElementById("upgrade-panel").classList.add("hidden");
    }
}

function handlePrimaryAction(e) {
    // Always sync to the exact click position first (unless the mouse is pointer-locked,
    // in which case we always aim from the crosshair at screen center). Previously this
    // relied entirely on whatever the last "mousemove" event had recorded, which could be
    // stale right after switching focus from a UI button to the 3D view - that's why
    // placing a tower sometimes took several clicks before one "took".
    if (e && document.pointerLockElement !== renderer.domElement) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouseNDC.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    }
    if (placement.active) updatePlacementPreview();

    if (currentMatch && !currentMatch.isHost) {
        handleGuestPrimaryAction();
        return;
    }
    if (placement.active) {
        confirmPlacement();
    } else {
        tryInteractClick();
    }
}

// --- 6. IN-GAME UI ---
function buildMatchLoadout() {
    const bar = document.getElementById("match-loadout");
    bar.innerHTML = "";
    playerData.loadout.forEach(id => {
        const t = TOWER_DB[id] || GOLDEN_TOWERS[id];
        let cost;
        if (GOLDEN_TOWERS[id]) {
            const baseTower = TOWER_DB[t.baseId];
            cost = baseTower.levels[0].costCash;
        } else {
            cost = t.levels[0].costCash;
        }

        const btn = document.createElement("div");
        btn.className = `match-tower-btn ${myCash() < cost ? "disabled" : ""}`;
        if (gameState.selectedTowerToPlace === id) btn.classList.add("selected");
        if (GOLDEN_TOWERS[id]) btn.style.borderColor = "#ffd700";

        btn.innerHTML = `<strong>${t.name}</strong><span>$${cost}</span>`;
        btn.onclick = () => {
            if (myCash() >= cost) enterPlacementMode(id);
        };
        bar.appendChild(btn);
    });
}

function updateGameUI() {
    document.getElementById("game-hp").innerText = gameState.hp;
    document.getElementById("game-wave").innerText = gameState.wave;
    document.getElementById("game-cash").innerText = myCash();

    const timerEl = document.getElementById("wave-timer-ui");
    const startBtn = document.getElementById("btn-start-wave");
    if (gameState.waveActive) {
        timerEl.innerText = "Wave in progress";
        startBtn.disabled = true;
    } else {
        timerEl.innerText = "Ready for next wave";
        startBtn.disabled = false;
    }

    buildMatchLoadout();
}

function showUpgradePanel(tower) {
    const p = document.getElementById("upgrade-panel");
    const isOwner = tower.owner === currentUsername;
    p.classList.remove("hidden");
    document.getElementById("upg-title").innerText = tower.baseData.name + (isOwner ? "" : ` (${tower.owner})`);
    document.getElementById("upg-level").innerText = tower.level + 1;
    document.getElementById("upg-dmg").innerText = tower.stats.damage || tower.stats.income;
    document.getElementById("upg-range").innerText = tower.stats.range || 0;
    document.getElementById("upg-targeting").innerText = tower.targetingMode.charAt(0).toUpperCase() + tower.targetingMode.slice(1);

    document.getElementById("btn-targeting").onclick = () => {
        tower.cycleTargeting();
        showUpgradePanel(tower);
    };

    const upgBtn = document.getElementById("btn-upgrade");
    if (!isOwner) {
        document.getElementById("upg-cost").innerText = "-";
        upgBtn.disabled = true;
    } else if (tower.level < tower.baseData.levels.length - 1) {
        const next = tower.baseData.levels[tower.level + 1];
        document.getElementById("upg-cost").innerText = next.costCash;
        upgBtn.disabled = myCash() < next.costCash;
        upgBtn.onclick = () => {
            if(tower.upgrade()) showUpgradePanel(tower);
        };
    } else {
        document.getElementById("upg-cost").innerText = "MAX";
        upgBtn.disabled = true;
    }

    const sellBtn = document.getElementById("btn-sell");
    document.getElementById("upg-sell").innerText = isOwner ? Math.floor(tower.stats.costCash * 0.5) : "-";
    sellBtn.disabled = !isOwner;
    sellBtn.onclick = () => {
        if (!isOwner) return;
        addToWallet(currentUsername, Math.floor(tower.stats.costCash * 0.5));
        gameState.towers = gameState.towers.filter(t => t !== tower);
        gameState.selectedPlacedTower = null;
        p.classList.add("hidden");
        updateGameUI();
    };
}
document.getElementById("btn-close-panel").onclick = () => {
    gameState.selectedPlacedTower = null;
    guestSelectedUid = null;
    document.getElementById("upgrade-panel").classList.add("hidden");
};

function startGame() {
    const mode = GAME_MODES[gameState.gameMode];
    nextTowerUid = 1;
    spawnQueue = [];
    spawnTimer = 0;
    gameState = {
        running: true,
        playerCash: {}, // per-player wallets - co-op does NOT share a cash pool
        hp: mode.startingHp,
        wave: 1,
        towers: [], enemies: [], projectiles: [],
        selectedTowerToPlace: null, selectedPlacedTower: null,
        waveActive: false,
        waveTimer: 0,
        frames: 0,
        gameMode: gameState.gameMode
    };
    gameState.playerCash[currentUsername] = mode.startingCash;
    if (currentMatch) gameState.playerCash[currentMatch.opponent] = mode.startingCash;
    document.getElementById("game-over-overlay").classList.add("hidden");
    document.getElementById("upgrade-panel").classList.add("hidden");

    if (!renderer) initThreeScene();
    buildMapWorld(currentMap);
    playerRig.x = worldX(path[0].x) + 60;
    playerRig.z = worldZ(path[0].y);
    playerRig.yaw = Math.PI;

    updateGameUI();
    if (!gameLoopStarted) { gameLoopStarted = true; requestAnimationFrame(gameLoop); }
}

function startNextWave() {
    if (!gameState.running || gameState.waveActive || gameState.wave > 30) return;
    generateWave();
    updateGameUI();
    if (currentMatch) sendMatchEvent({ type: "wave", wave: gameState.wave });
}

let gameLoopStarted = false;

function gameLoop() {
    requestAnimationFrame(gameLoop);
    const dt = Math.min(0.05, clock.getDelta());

    updatePlayer(dt);
    updateCamera();
    updatePlacementPreview();
    updateImpactEffects(dt);

    const screenEl = document.getElementById("game-screen");
    if (!screenEl.classList.contains("active")) { renderer.render(scene, camera); return; }

    if (currentMatch && !currentMatch.isHost) {
        guestFrame(dt);
        renderer.render(scene, camera);
        return;
    }

    if (!gameState.running) { renderer.render(scene, camera); return; }
    gameState.frames++;

    if (gameState.waveActive && spawnQueue.length > 0) {
        if (gameState.frames - spawnTimer > 60) {
            const next = spawnQueue.shift();
            gameState.enemies.push(new Enemy(next.type, next.waveMult));
            spawnTimer = gameState.frames;
        }
    } else if (gameState.waveActive && gameState.enemies.length === 0) {
        gameState.waveActive = false;
        if (gameState.wave >= 30) {
            gameState.wave++; // so the "waves cleared" stat (wave - 1) correctly reads 30
            endGame(true);
        } else {
            gameState.wave++;
            const bonus = 100 + (gameState.wave * 20);
            addToWallet(currentUsername, bonus);
            if (currentMatch) addToWallet(currentMatch.opponent, bonus); // both players get the full bonus - separate economies, not a split pot
            updateGameUI();
        }
    }

    gameState.towers.forEach(t => t.update());
    for (let i = gameState.enemies.length - 1; i >= 0; i--) {
        const e = gameState.enemies[i];
        if (e.hp <= 0) {
            addToWallet(e.lastDamagedBy || currentUsername, e.reward);
            playerData.questProgress.enemiesDefeated = (playerData.questProgress.enemiesDefeated || 0) + 1;
            if (e.type === "boss" || e.type === "boss2") {
                playerData.questProgress.bossesDefeated = (playerData.questProgress.bossesDefeated || 0) + 1;
            }
            spawnImpactEffect(e.x, e.y, e.radius, e.color);
            gameState.enemies.splice(i, 1);
            enemyMeshes.has(e); // (mesh removed in syncEnemies via seen-set diff)
            updateGameUI();
        } else {
            if (e.update()) gameState.enemies.splice(i, 1);
        }
    }

    for (let i = gameState.projectiles.length - 1; i >= 0; i--) {
        const p = gameState.projectiles[i];
        if (p instanceof FloatText) { p.update(); if (!p.active) gameState.projectiles.splice(i, 1); continue; }
        p.update();
        if (!p.active) { /* removed from scene in syncProjectiles */ }
    }
    syncProjectiles();
    gameState.projectiles = gameState.projectiles.filter(p => p.active !== false);

    syncTowers();
    syncEnemies();
    syncFloatTexts();

    if (gameState.hp <= 0) {
        endGame(false);
        renderer.render(scene, camera);
        return;
    }

    if (currentMatch && currentMatch.isHost && gameState.frames % 3 === 0) {
        broadcastCoopState();
    }

    renderer.render(scene, camera);
}

// --- SHARED-BOARD CO-OP: HOST SIDE ---
function broadcastCoopState() {
    if (!socket || !currentMatch || !currentMatch.isHost) return;
    const state = {
        playerCash: gameState.playerCash, hp: gameState.hp, wave: gameState.wave,
        waveActive: gameState.waveActive, waveTimer: gameState.waveTimer,
        gameMode: gameState.gameMode, mapId: currentMap.id,
        towers: gameState.towers.map(t => ({
            uid: t.uid, typeId: t.typeId, isGolden: t.isGolden, owner: t.owner,
            x: t.x, y: t.y, level: t.level, targetingMode: t.targetingMode,
            color: t.baseData.color, radius: t.baseData.radius, rotationY: t.rotationY
        })),
        enemies: gameState.enemies.map(e => ({
            x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, color: e.color, radius: e.radius,
            isBoss: e.isBoss, phase: e.phase,
            shield: e.shield || 0, maxShield: e.maxShield || e.shieldAmount || 0,
            slowTimer: e.slowTimer, burnTimer: e.burnTimer
        })),
        projectiles: gameState.projectiles.filter(p => !(p instanceof FloatText)).map(p => ({ x: p.x, y: p.y, type: p.type }))
    };
    socket.emit("match:state", { toUsername: currentMatch.opponent, state });
}

function applyRemoteAction(action) {
    if (!action || !currentMatch) return;
    const guestName = currentMatch.opponent; // the only other participant on a 2-player shared board
    if (action.type === "placeTower") {
        const base = TOWER_DB[action.towerId];
        if (!base) return;
        const cost = base.levels[0].costCash;
        if (walletOf(guestName) >= cost) {
            spendFromWallet(guestName, cost);
            const tower = new Tower(action.towerId, action.x, action.y, guestName);
            tower.rotationY = action.rotationY || 0;
            gameState.towers.push(tower);
            updateGameUI();
        }
    } else if (action.type === "upgradeTower") {
        const t = gameState.towers.find(tw => tw.uid === action.uid);
        if (t && t.owner === guestName) t.upgrade(); // only the tower's own owner can spend on it
    } else if (action.type === "sellTower") {
        const t = gameState.towers.find(tw => tw.uid === action.uid);
        if (t && t.owner === guestName) {
            addToWallet(guestName, Math.floor(t.stats.costCash * 0.5));
            gameState.towers = gameState.towers.filter(tw => tw !== t);
            if (gameState.selectedPlacedTower === t) gameState.selectedPlacedTower = null;
            document.getElementById("upgrade-panel").classList.add("hidden");
            updateGameUI();
        }
    } else if (action.type === "cycleTargeting") {
        const t = gameState.towers.find(tw => tw.uid === action.uid);
        if (t) t.cycleTargeting();
    } else if (action.type === "startWave") {
        startNextWave();
    }
}

// --- SHARED-BOARD CO-OP: GUEST SIDE ---
// NOTE: the guest doesn't run the real simulation - it renders whatever snapshot the
// host last sent. Since remoteState objects are plain data (not Tower/Enemy instances),
// the guest reuses the same 3D model builders but keys its mesh pools by array index
// instead of object identity. Turret aim is a simple "nearest enemy in range" approximation
// since the guest doesn't have access to the host's real targeting-mode logic.
let guestTowerMeshes = new Map(); // index -> entry
let guestEnemyMeshes = new Map(); // index -> entry

function startGuestMatch() {
    document.getElementById("game-over-overlay").classList.add("hidden");
    document.getElementById("upgrade-panel").classList.add("hidden");
    remoteState = null;
    guestSelectedTowerToPlace = null;
    guestSelectedUid = null;

    if (!renderer) initThreeScene();
    buildMapWorld(currentMap);
    playerRig.x = worldX(path[0].x) + 60;
    playerRig.z = worldZ(path[0].y);
    playerRig.yaw = Math.PI;

    buildGuestMatchLoadout();
    if (!gameLoopStarted) { gameLoopStarted = true; requestAnimationFrame(gameLoop); }
}

function guestFrame() {
    if (!currentMatch || currentMatch.isHost) return;
    if (!remoteState) return;

    document.getElementById("game-hp").innerText = remoteState.hp;
    document.getElementById("game-wave").innerText = remoteState.wave;
    document.getElementById("game-cash").innerText = (remoteState.playerCash && remoteState.playerCash[currentUsername]) || 0;
    document.getElementById("wave-timer-ui").innerText = remoteState.waveActive ? "Wave in progress" : "Ready for next wave";
    document.getElementById("btn-start-wave").disabled = remoteState.waveActive;
    refreshGuestLoadoutVisuals();

    const seenT = new Set();
    remoteState.towers.forEach((t, i) => {
        seenT.add(i);
        let entry = guestTowerMeshes.get(i);
        if (!entry || entry.level !== t.level) {
            if (entry) { scene.remove(entry.group); disposeObject3D(entry.group); }
            const base = TOWER_DB[t.typeId];
            const group = buildTowerGroup(base, t.level, t.isGolden);
            group.position.set(worldX(t.x), 0, worldZ(t.y));
            group.rotation.y = t.rotationY || 0;
            scene.add(group);
            entry = { group, turretPivot: group.userData.turretPivot, level: t.level };
            guestTowerMeshes.set(i, entry);
        }
        // Approximate aim: face nearest enemy in range
        let nearest = null, nearestD = Infinity;
        for (const e of remoteState.enemies) {
            const d = Math.hypot(e.x - t.x, e.y - t.y);
            if (d < nearestD) { nearestD = d; nearest = e; }
        }
        if (nearest) {
            const dx = worldX(nearest.x) - entry.group.position.x;
            const dz = worldZ(nearest.y) - entry.group.position.z;
            entry.turretPivot.rotation.y = Math.atan2(dx, dz) - (t.rotationY || 0);
        }
    });
    for (const [i, entry] of guestTowerMeshes) {
        if (!seenT.has(i)) { scene.remove(entry.group); disposeObject3D(entry.group); guestTowerMeshes.delete(i); }
    }

    const seenE = new Set();
    remoteState.enemies.forEach((e, i) => {
        seenE.add(i);
        let entry = guestEnemyMeshes.get(i);
        if (!entry) {
            const group = buildEnemyGroup(null, e.color, e.radius, !!e.isBoss);
            scene.add(group);
            entry = { group };
            guestEnemyMeshes.set(i, entry);
        }
        entry.group.position.set(worldX(e.x), 0, worldZ(e.y));
        entry.group.userData.shieldRing.visible = e.shield > 0;
        updateHealthBarSprite(entry.group.userData.healthBar, e.hp / e.maxHp, e.shield > 0 ? e.shield / (e.maxShield || 1) : 0, "#2ecc71");
    });
    for (const [i, entry] of guestEnemyMeshes) {
        if (!seenE.has(i)) { scene.remove(entry.group); disposeObject3D(entry.group); guestEnemyMeshes.delete(i); }
    }

    if (remoteState.hp <= 0) {
        document.getElementById("game-over-overlay").classList.remove("hidden");
        document.getElementById("end-title").innerText = "MATCH OVER";
        document.getElementById("end-stats").innerHTML = `Waves Cleared: ${Math.max(0, remoteState.wave - 1)}`;
    }
}

// Live wallet lookup for the guest - always reads the latest synced state,
// never a value captured earlier. This is what the placement UI checks against.
function guestCash() {
    return (remoteState && remoteState.playerCash) ? (remoteState.playerCash[currentUsername] || 0) : 0;
}

// Built ONCE per match (see startGuestMatch) - the buttons themselves never get
// torn down and recreated while a match is running. Only their visual state
// (disabled/selected classes) is refreshed reactively, every frame, from live data.
function buildGuestMatchLoadout() {
    const bar = document.getElementById("match-loadout");
    bar.innerHTML = "";
    playerData.loadout.forEach(id => {
        const t = TOWER_DB[id] || GOLDEN_TOWERS[id];
        const cost = GOLDEN_TOWERS[id] ? TOWER_DB[GOLDEN_TOWERS[id].baseId].levels[0].costCash : t.levels[0].costCash;

        const btn = document.createElement("div");
        btn.className = "match-tower-btn";
        btn.dataset.towerId = id;
        if (GOLDEN_TOWERS[id]) btn.style.borderColor = "#ffd700";
        btn.innerHTML = `<strong>${t.name}</strong><span>$${cost}</span>`;

        // Cash is checked live, right here, at the moment of the click - never from
        // a value that was frozen when the button was drawn.
        btn.addEventListener("click", () => {
            if (guestCash() < cost) return;
            if (guestSelectedTowerToPlace === id) { guestSelectedTowerToPlace = null; exitPlacementMode(); }
            else { guestSelectedTowerToPlace = id; enterPlacementMode(id); }
            refreshGuestLoadoutVisuals();
        });

        bar.appendChild(btn);
    });
    refreshGuestLoadoutVisuals();
}

// Cheap per-frame visual refresh - toggles classes on the existing buttons instead
// of destroying and recreating them, so a click can never land on a stale/removed node.
function refreshGuestLoadoutVisuals() {
    const bar = document.getElementById("match-loadout");
    const cash = guestCash();
    bar.querySelectorAll(".match-tower-btn").forEach(btn => {
        const id = btn.dataset.towerId;
        const t = TOWER_DB[id] || GOLDEN_TOWERS[id];
        const cost = GOLDEN_TOWERS[id] ? TOWER_DB[GOLDEN_TOWERS[id].baseId].levels[0].costCash : t.levels[0].costCash;
        btn.classList.toggle("disabled", cash < cost);
        btn.classList.toggle("selected", guestSelectedTowerToPlace === id);
    });
}

function handleGuestPrimaryAction() {
    if (!socket || !currentMatch) return;

    if (placement.active) {
        if (!placement.valid) return;
        socket.emit("match:action", {
            toUsername: currentMatch.opponent,
            action: { type: "placeTower", towerId: placement.towerId, x: placement.lastGameX, y: placement.lastGameY, rotationY: placement.rotationY }
        });
        guestSelectedTowerToPlace = null;
        exitPlacementMode();
        refreshGuestLoadoutVisuals();
        return;
    }

    raycaster.setFromCamera(currentRaycastNDC(), camera);
    guestSelectedUid = null;
    if (remoteState) {
        let closest = null, closestDist = Infinity, closestIdx = -1;
        remoteState.towers.forEach((t, i) => {
            const entry = guestTowerMeshes.get(i);
            if (!entry) return;
            const hits = raycaster.intersectObject(entry.group, true);
            if (hits.length > 0 && hits[0].distance < closestDist) {
                closestDist = hits[0].distance; closest = t; closestIdx = i;
            }
        });
        if (closest && closestDist < 260) {
            guestSelectedUid = closest.uid;
            showGuestUpgradePanel(closest);
            return;
        }
    }
    document.getElementById("upgrade-panel").classList.add("hidden");
}

function showGuestUpgradePanel(t) {
    const base = TOWER_DB[t.typeId];
    const p = document.getElementById("upgrade-panel");
    const isOwner = t.owner === currentUsername;
    const myWallet = (remoteState && remoteState.playerCash) ? (remoteState.playerCash[currentUsername] || 0) : 0;
    p.classList.remove("hidden");
    document.getElementById("upg-title").innerText = base.name + (isOwner ? "" : ` (${t.owner})`);
    document.getElementById("upg-level").innerText = t.level + 1;
    document.getElementById("upg-dmg").innerText = base.levels[t.level].damage ?? base.levels[t.level].income ?? "-";
    document.getElementById("upg-range").innerText = base.levels[t.level].range || 0;
    document.getElementById("upg-targeting").innerText = (t.targetingMode || "first").charAt(0).toUpperCase() + (t.targetingMode || "first").slice(1);

    document.getElementById("btn-targeting").onclick = () => {
        socket.emit("match:action", { toUsername: currentMatch.opponent, action: { type: "cycleTargeting", uid: t.uid } });
    };

    const upgBtn = document.getElementById("btn-upgrade");
    if (!isOwner) {
        document.getElementById("upg-cost").innerText = "-";
        upgBtn.disabled = true;
    } else if (t.level < base.levels.length - 1) {
        const next = base.levels[t.level + 1];
        document.getElementById("upg-cost").innerText = next.costCash;
        upgBtn.disabled = myWallet < next.costCash;
        upgBtn.onclick = () => {
            socket.emit("match:action", { toUsername: currentMatch.opponent, action: { type: "upgradeTower", uid: t.uid } });
        };
    } else {
        document.getElementById("upg-cost").innerText = "MAX";
        upgBtn.disabled = true;
    }

    const sellBtn = document.getElementById("btn-sell");
    document.getElementById("upg-sell").innerText = isOwner ? Math.floor(base.levels[t.level].costCash * 0.5) : "-";
    sellBtn.disabled = !isOwner;
    sellBtn.onclick = () => {
        if (!isOwner) return;
        socket.emit("match:action", { toUsername: currentMatch.opponent, action: { type: "sellTower", uid: t.uid } });
        p.classList.add("hidden");
        guestSelectedUid = null;
    };
}

function endGame(victory) {
    gameState.running = false;
    const mode = GAME_MODES[gameState.gameMode];
    const coinsEarned = Math.floor(gameState.wave * 15 * mode.coinMult);
    const xpEarned = Math.floor(gameState.wave * 25 * mode.xpMult);

    if (victory) {
        playerData.questProgress.matchesWon = (playerData.questProgress.matchesWon || 0) + 1;
        if (gameState.gameMode === "hardcore") {
            playerData.questProgress.hardcoreWins = (playerData.questProgress.hardcoreWins || 0) + 1;
        }
    }
    playerData.questProgress.wavesReached = Math.max(playerData.questProgress.wavesReached || 0, gameState.wave - 1);

    document.getElementById("game-over-overlay").classList.remove("hidden");
    const fullClear = victory && gameState.wave - 1 >= 30;
    document.getElementById("end-title").innerText = fullClear ? "YOU WIN!" : (victory ? "VICTORY!" : "GAME OVER");
    document.getElementById("end-stats").innerHTML = fullClear
        ? `All 30 waves cleared - you beat the game!<br>Coins Earned: <span class="coin-text">+${coinsEarned}</span><br>XP Earned: +${xpEarned}`
        : `Waves Cleared: ${gameState.wave - 1}<br>Coins Earned: <span class="coin-text">+${coinsEarned}</span><br>XP Earned: +${xpEarned}`;

    playerData.coins += coinsEarned;
    addXP(xpEarned);
    saveProgress();
    updateMenuStats();

    if (currentMatch) {
        sendMatchEvent({ type: "gameover", wave: gameState.wave - 1, victory });
        currentMatch = null;
        document.getElementById("match-feed-panel").classList.add("hidden");
    }
}

document.getElementById("btn-return-menu").addEventListener("click", () => {
    if (document.pointerLockElement) document.exitPointerLock();
    showScreen("main-menu");
});

document.getElementById("btn-start-wave").addEventListener("click", () => {
    if (currentMatch && !currentMatch.isHost) {
        if (!socket || !currentMatch) return;
        socket.emit("match:action", { toUsername: currentMatch.opponent, action: { type: "startWave" } });
    } else {
        startNextWave();
    }
});

// --- Initialize ---
async function initializeApp() {
    const isValidSession = await verifySession();

    if (isValidSession) {
        showScreen("main-menu");
        updateMenuStats();
        connectSocket();
    } else {
        showScreen("login-screen");
    }
}

initializeApp();

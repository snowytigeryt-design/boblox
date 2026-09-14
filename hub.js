// State
let authToken = localStorage.getItem('boblox_token');
let currentUser = null;
let socket = null;
let currentChatUserId = null;

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const registerScreen = document.getElementById('register-screen');
const hubScreen = document.getElementById('hub-screen');
const profileScreen = document.getElementById('profile-screen');
const discoveryScreen = document.getElementById('discovery-screen');
const chatScreen = document.getElementById('chat-screen');
const groupsScreen = document.getElementById('groups-screen');
const settingsScreen = document.getElementById('settings-screen');
const friendsModal = document.getElementById('friends-modal');
const createGroupModal = document.getElementById('create-group-modal');

// Initialize
function init() {
    setupEventListeners();
    
    if (authToken) {
        verifyToken();
    } else {
        showScreen('login');
    }
}

// Screen Management
function showScreen(screenName) {
    loginScreen.classList.remove('active');
    registerScreen.classList.remove('active');
    hubScreen.classList.remove('active');
    profileScreen.classList.remove('active');
    discoveryScreen.classList.remove('active');
    chatScreen.classList.remove('active');
    groupsScreen.classList.remove('active');
    settingsScreen.classList.remove('active');
    
    if (screenName === 'login') {
        loginScreen.classList.add('active');
    } else if (screenName === 'register') {
        registerScreen.classList.add('active');
    } else if (screenName === 'hub') {
        hubScreen.classList.add('active');
        loadGames();
        connectSocket();
    } else if (screenName === 'profile') {
        profileScreen.classList.add('active');
        loadProfile();
    } else if (screenName === 'discovery') {
        discoveryScreen.classList.add('active');
        searchGames();
    } else if (screenName === 'chat') {
        chatScreen.classList.add('active');
        loadConversations();
    } else if (screenName === 'groups') {
        groupsScreen.classList.add('active');
        loadGroups();
    } else if (screenName === 'settings') {
        settingsScreen.classList.add('active');
        loadSettings();
    }
}

// Event Listeners
function setupEventListeners() {
    // Auth forms
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('register-form').addEventListener('submit', handleRegister);
    document.getElementById('btn-show-register').addEventListener('click', () => showScreen('register'));
    document.getElementById('btn-show-login').addEventListener('click', () => showScreen('login'));
    document.getElementById('btn-logout').addEventListener('click', handleLogout);
    
    // Navigation
    document.getElementById('btn-profile-nav').addEventListener('click', () => showScreen('profile'));
    document.getElementById('btn-discovery-nav').addEventListener('click', () => showScreen('discovery'));
    document.getElementById('btn-chat-nav').addEventListener('click', () => showScreen('chat'));
    document.getElementById('btn-friends-nav').addEventListener('click', () => {
        friendsModal.classList.add('active');
        loadFriends();
    });
    document.getElementById('btn-groups-nav').addEventListener('click', () => showScreen('groups'));
    document.getElementById('btn-settings-nav').addEventListener('click', () => showScreen('settings'));
    
    // Back buttons
    document.getElementById('btn-profile-back').addEventListener('click', () => showScreen('hub'));
    document.getElementById('btn-discovery-back').addEventListener('click', () => showScreen('hub'));
    document.getElementById('btn-chat-back').addEventListener('click', () => showScreen('hub'));
    document.getElementById('btn-groups-back').addEventListener('click', () => showScreen('hub'));
    document.getElementById('btn-settings-back').addEventListener('click', () => showScreen('hub'));
    
    // Logout buttons on other screens
    document.getElementById('btn-logout-profile').addEventListener('click', handleLogout);
    document.getElementById('btn-logout-discovery').addEventListener('click', handleLogout);
    document.getElementById('btn-logout-chat').addEventListener('click', handleLogout);
    document.getElementById('btn-logout-groups').addEventListener('click', handleLogout);
    document.getElementById('btn-logout-settings').addEventListener('click', handleLogout);

    // Settings
    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
    
    // Friends modal
    document.getElementById('btn-close-friends').addEventListener('click', () => {
        friendsModal.classList.remove('active');
    });
    document.getElementById('btn-add-friend').addEventListener('click', handleAddFriend);
    
    // Profile
    document.getElementById('btn-save-profile').addEventListener('click', handleSaveProfile);
    
    // Discovery
    document.getElementById('btn-search').addEventListener('click', searchGames);
    
    // Chat
    document.getElementById('btn-send-message').addEventListener('click', handleSendMessage);
    document.getElementById('chat-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSendMessage();
    });
    
    // Groups
    document.getElementById('btn-create-group').addEventListener('click', () => {
        createGroupModal.classList.add('active');
    });
    document.getElementById('btn-close-create-group').addEventListener('click', () => {
        createGroupModal.classList.remove('active');
    });
    document.getElementById('create-group-form').addEventListener('submit', handleCreateGroup);
}

// Authentication
async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem('boblox_token', authToken);
            document.getElementById('nav-username').textContent = currentUser.username;
            document.getElementById('profile-nav-username').textContent = currentUser.username;
            document.getElementById('discovery-nav-username').textContent = currentUser.username;
            document.getElementById('chat-nav-username').textContent = currentUser.username;
            document.getElementById('groups-nav-username').textContent = currentUser.username;
            document.getElementById('settings-nav-username').textContent = currentUser.username;
            showScreen('hub');
            errorEl.textContent = '';
        } else {
            errorEl.textContent = data.error;
        }
    } catch (error) {
        errorEl.textContent = 'Connection error';
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const errorEl = document.getElementById('register-error');
    
    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem('boblox_token', authToken);
            document.getElementById('nav-username').textContent = currentUser.username;
            document.getElementById('profile-nav-username').textContent = currentUser.username;
            document.getElementById('discovery-nav-username').textContent = currentUser.username;
            document.getElementById('chat-nav-username').textContent = currentUser.username;
            document.getElementById('groups-nav-username').textContent = currentUser.username;
            document.getElementById('settings-nav-username').textContent = currentUser.username;
            showScreen('hub');
            errorEl.textContent = '';
        } else {
            errorEl.textContent = data.error;
        }
    } catch (error) {
        errorEl.textContent = 'Connection error';
    }
}

async function verifyToken() {
    try {
        const response = await fetch('/api/verify', {
            headers: { 'Authorization': authToken }
        });
        
        const data = await response.json();
        
        if (data.valid) {
            currentUser = { username: data.username };
            document.getElementById('nav-username').textContent = currentUser.username;
            document.getElementById('profile-nav-username').textContent = currentUser.username;
            document.getElementById('discovery-nav-username').textContent = currentUser.username;
            document.getElementById('chat-nav-username').textContent = currentUser.username;
            document.getElementById('groups-nav-username').textContent = currentUser.username;
            document.getElementById('settings-nav-username').textContent = currentUser.username;
            showScreen('hub');
        } else {
            localStorage.removeItem('boblox_token');
            authToken = null;
            showScreen('login');
        }
    } catch (error) {
        localStorage.removeItem('boblox_token');
        authToken = null;
        showScreen('login');
    }
}

function handleLogout() {
    fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: authToken })
    });
    
    localStorage.removeItem('boblox_token');
    authToken = null;
    currentUser = null;
    
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    
    showScreen('login');
}

// Games
async function loadGames() {
    try {
        const response = await fetch('/api/games');
        const games = await response.json();
        
        const gamesGrid = document.getElementById('games-grid');
        gamesGrid.innerHTML = '';
        
        games.forEach(game => {
            const gameCard = document.createElement('div');
            gameCard.className = 'game-card';
            gameCard.innerHTML = `
                <div class="game-thumbnail">
                    <span>🎮</span>
                </div>
                <div class="game-info">
                    <h3>${game.name}</h3>
                    <p>${game.description || 'No description available'}</p>
                    <button class="play-btn" onclick="launchGame('${game.id}', '${game.folder_path}')">Play</button>
                </div>
            `;
            gamesGrid.appendChild(gameCard);
        });
    } catch (error) {
        console.error('Failed to load games:', error);
    }
}

function launchGame(gameId, folderPath) {
    // Store token for the game to use
    sessionStorage.setItem('boblox_token', authToken);
    sessionStorage.setItem('boblox_game_id', gameId);
    
    // Navigate to the game
    window.location.href = `/${folderPath}/`;
}

// Friends
async function loadFriends() {
    try {
        const response = await fetch('/api/friends', {
            headers: { 'Authorization': authToken }
        });
        
        const data = await response.json();
        
        renderFriendRequests(data.incoming);
        renderOutgoingRequests(data.outgoing);
        renderFriends(data.friends);
    } catch (error) {
        console.error('Failed to load friends:', error);
    }
}

function renderFriendRequests(requests) {
    const container = document.getElementById('friend-requests-list');
    
    if (requests.length === 0) {
        container.innerHTML = '<div class="empty-state">No pending requests</div>';
        return;
    }
    
    container.innerHTML = requests.map(request => `
        <div class="friend-item">
            <div class="friend-info">
                <div class="friend-avatar">${request.username.charAt(0).toUpperCase()}</div>
                <div>
                    <div class="friend-name">${request.username}</div>
                    <div class="friend-status">Wants to be friends</div>
                </div>
            </div>
            <div class="friend-actions">
                <button class="friend-btn accept-btn" onclick="acceptFriend('${request.username}')">Accept</button>
                <button class="friend-btn decline-btn" onclick="declineFriend('${request.username}')">Decline</button>
            </div>
        </div>
    `).join('');
}

function renderOutgoingRequests(requests) {
    const container = document.getElementById('friend-outgoing-list');
    
    if (requests.length === 0) {
        container.innerHTML = '<div class="empty-state">No sent requests</div>';
        return;
    }
    
    container.innerHTML = requests.map(request => `
        <div class="friend-item">
            <div class="friend-info">
                <div class="friend-avatar">${request.username.charAt(0).toUpperCase()}</div>
                <div>
                    <div class="friend-name">${request.username}</div>
                    <div class="friend-status">Request sent</div>
                </div>
            </div>
            <div class="friend-actions">
                <button class="friend-btn decline-btn" onclick="declineFriend('${request.username}')">Cancel</button>
            </div>
        </div>
    `).join('');
}

function renderFriends(friends) {
    const container = document.getElementById('friends-list');
    
    if (friends.length === 0) {
        container.innerHTML = '<div class="empty-state">No friends yet</div>';
        return;
    }
    
    container.innerHTML = friends.map(friend => `
        <div class="friend-item">
            <div class="friend-info">
                <div class="friend-avatar">${friend.username.charAt(0).toUpperCase()}</div>
                <div>
                    <div class="friend-name">${friend.username}</div>
                    <div class="friend-status ${friend.online ? 'online' : ''}">${friend.online ? 'Online' : 'Offline'}</div>
                </div>
            </div>
            <div class="friend-actions">
                <button class="friend-btn remove-btn" onclick="removeFriend('${friend.username}')">Remove</button>
            </div>
        </div>
    `).join('');
}

async function handleAddFriend() {
    const username = document.getElementById('add-friend-input').value.trim();
    const errorEl = document.getElementById('friend-error');
    
    if (!username) return;
    
    try {
        const response = await fetch('/api/friends/request', {
            method: 'POST',
            headers: {
                'Authorization': authToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username })
        });
        
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('add-friend-input').value = '';
            errorEl.textContent = '';
            loadFriends();
            
            if (data.autoAccepted) {
                errorEl.textContent = `${username} was already requesting you! You're now friends.`;
                errorEl.style.color = '#4ade80';
            }
        } else {
            errorEl.textContent = data.error;
            errorEl.style.color = '#ff6b6b';
        }
    } catch (error) {
        errorEl.textContent = 'Connection error';
    }
}

async function acceptFriend(username) {
    try {
        const response = await fetch('/api/friends/accept', {
            method: 'POST',
            headers: {
                'Authorization': authToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username })
        });
        
        if (response.ok) {
            loadFriends();
        }
    } catch (error) {
        console.error('Failed to accept friend:', error);
    }
}

async function declineFriend(username) {
    try {
        const response = await fetch('/api/friends/decline', {
            method: 'POST',
            headers: {
                'Authorization': authToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username })
        });
        
        if (response.ok) {
            loadFriends();
        }
    } catch (error) {
        console.error('Failed to decline friend:', error);
    }
}

async function removeFriend(username) {
    try {
        const response = await fetch('/api/friends/remove', {
            method: 'POST',
            headers: {
                'Authorization': authToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username })
        });
        
        if (response.ok) {
            loadFriends();
        }
    } catch (error) {
        console.error('Failed to remove friend:', error);
    }
}

// Socket.io
function connectSocket() {
    if (socket) return;
    
    socket = io({
        auth: { token: authToken }
    });
    
    socket.on('connect', () => {
        console.log('Connected to real-time server');
    });
    
    socket.on('friend:request', (data) => {
        alert(`${data.from} sent you a friend request!`);
        if (friendsModal.classList.contains('active')) {
            loadFriends();
        }
    });
    
    socket.on('friend:accepted', (data) => {
        alert(`${data.from} accepted your friend request!`);
        if (friendsModal.classList.contains('active')) {
            loadFriends();
        }
    });
    
    socket.on('friend:removed', (data) => {
        alert(`${data.from} removed you from their friends list.`);
        if (friendsModal.classList.contains('active')) {
            loadFriends();
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from real-time server');
    });
    
    socket.on('message:received', (data) => {
        if (currentChatUserId === data.sender_id) {
            loadMessages(currentChatUserId);
        }
    });
}

// Settings Functions
// Stored in localStorage (not the account DB) - same-origin pages like
// games/arena-clash read this directly under the same key, no API needed.
function loadSettings() {
    let settings = {};
    try { settings = JSON.parse(localStorage.getItem('boblox_settings')) || {}; } catch (e) { settings = {}; }
    const hand = settings.gunHand === 'left' ? 'left' : 'right';
    document.getElementById('setting-hand-right').checked = (hand === 'right');
    document.getElementById('setting-hand-left').checked = (hand === 'left');
    document.getElementById('settings-saved-msg').style.display = 'none';
}

function saveSettings() {
    let settings = {};
    try { settings = JSON.parse(localStorage.getItem('boblox_settings')) || {}; } catch (e) { settings = {}; }
    settings.gunHand = document.getElementById('setting-hand-left').checked ? 'left' : 'right';
    localStorage.setItem('boblox_settings', JSON.stringify(settings));
    const msg = document.getElementById('settings-saved-msg');
    msg.style.display = 'block';
    setTimeout(() => { msg.style.display = 'none'; }, 2500);
}

// Profile Functions
async function loadProfile() {
    try {
        const response = await fetch('/api/user', {
            headers: { 'Authorization': authToken }
        });
        const user = await response.json();
        
        document.getElementById('profile-username').textContent = user.username;
        document.getElementById('profile-bio').textContent = user.bio || 'No bio yet';
        document.getElementById('bio-input').value = user.bio || '';
        document.getElementById('avatar-url-input').value = user.avatar_url || '';
        
        if (user.avatar_url) {
            document.getElementById('profile-avatar').src = user.avatar_url;
        }
        
        document.getElementById('privacy-friend-requests').checked = user.privacy_allow_friend_requests;
        document.getElementById('privacy-profile-view').checked = user.privacy_allow_profile_view;
        document.getElementById('privacy-game-invites').checked = user.privacy_allow_game_invites;
        
        // Load achievements
        const achievementsResponse = await fetch('/api/achievements/user', {
            headers: { 'Authorization': authToken }
        });
        const achievements = await achievementsResponse.json();
        renderAchievements(achievements);
    } catch (error) {
        console.error('Failed to load profile:', error);
    }
}

function renderAchievements(achievements) {
    const container = document.getElementById('achievements-grid');
    
    if (achievements.length === 0) {
        container.innerHTML = '<div class="empty-state">No achievements yet</div>';
        return;
    }
    
    container.innerHTML = achievements.map(achievement => `
        <div class="achievement-card">
            <div class="achievement-icon">🏆</div>
            <h4>${achievement.name}</h4>
            <p>${achievement.description}</p>
        </div>
    `).join('');
}

async function handleSaveProfile() {
    const avatarUrl = document.getElementById('avatar-url-input').value;
    const bio = document.getElementById('bio-input').value;
    const privacyFriendRequests = document.getElementById('privacy-friend-requests').checked;
    const privacyProfileView = document.getElementById('privacy-profile-view').checked;
    const privacyGameInvites = document.getElementById('privacy-game-invites').checked;
    
    try {
        const response = await fetch('/api/profile', {
            method: 'PUT',
            headers: {
                'Authorization': authToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                avatar_url: avatarUrl,
                bio,
                privacy_allow_friend_requests: privacyFriendRequests,
                privacy_allow_profile_view: privacyProfileView,
                privacy_allow_game_invites: privacyGameInvites
            })
        });
        
        if (response.ok) {
            alert('Profile saved successfully!');
            loadProfile();
        }
    } catch (error) {
        console.error('Failed to save profile:', error);
    }
}

// Discovery Functions
async function searchGames() {
    const query = document.getElementById('search-input').value;
    const category = document.getElementById('category-filter').value;
    const sort = document.getElementById('sort-filter').value;
    
    try {
        const params = new URLSearchParams();
        if (query) params.append('query', query);
        if (category) params.append('category', category);
        if (sort) params.append('sort', sort);
        
        const response = await fetch(`/api/games/search?${params}`);
        const games = await response.json();
        
        const grid = document.getElementById('discovery-grid');
        grid.innerHTML = '';
        
        games.forEach(game => {
            const gameCard = document.createElement('div');
            gameCard.className = 'game-card';
            gameCard.innerHTML = `
                <div class="game-thumbnail">
                    <span>🎮</span>
                </div>
                <div class="game-info">
                    <h3>${game.name}</h3>
                    <p>${game.description || 'No description available'}</p>
                    <div class="game-rating">
                        <span class="stars">${'★'.repeat(Math.round(game.rating || 0))}</span>
                        <span class="rating-text">${(game.rating || 0).toFixed(1)} (${game.total_reviews || 0} reviews)</span>
                    </div>
                    <button class="play-btn" onclick="launchGame('${game.id}', '${game.folder_path}')">Play</button>
                </div>
            `;
            grid.appendChild(gameCard);
        });
    } catch (error) {
        console.error('Failed to search games:', error);
    }
}

// Chat Functions
async function loadConversations() {
    // For now, just show friends as potential conversations
    try {
        const response = await fetch('/api/friends', {
            headers: { 'Authorization': authToken }
        });
        const data = await response.json();
        
        const container = document.getElementById('conversations-list');
        container.innerHTML = '';
        
        data.friends.forEach(friend => {
            const item = document.createElement('div');
            item.className = 'conversation-item';
            item.innerHTML = `
                <h4>${friend.username}</h4>
                <p>${friend.online ? 'Online' : 'Offline'}</p>
            `;
            item.addEventListener('click', () => {
                currentChatUserId = friend.id;
                document.getElementById('chat-recipient').textContent = friend.username;
                loadMessages(friend.id);
                
                // Update active state
                document.querySelectorAll('.conversation-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
            });
            container.appendChild(item);
        });
    } catch (error) {
        console.error('Failed to load conversations:', error);
    }
}

async function loadMessages(userId) {
    try {
        const response = await fetch(`/api/messages/${userId}`, {
            headers: { 'Authorization': authToken }
        });
        const messages = await response.json();
        
        const container = document.getElementById('chat-messages');
        container.innerHTML = '';
        
        messages.forEach(msg => {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${msg.direction}`;
            messageDiv.innerHTML = `
                <div class="message-sender">${msg.sender_username}</div>
                <div>${msg.content}</div>
                <div class="message-time">${new Date(msg.created_at).toLocaleTimeString()}</div>
            `;
            container.appendChild(messageDiv);
        });
        
        container.scrollTop = container.scrollHeight;
    } catch (error) {
        console.error('Failed to load messages:', error);
    }
}

async function handleSendMessage() {
    const content = document.getElementById('chat-input').value.trim();
    
    if (!content || !currentChatUserId) return;
    
    try {
        const response = await fetch('/api/messages', {
            method: 'POST',
            headers: {
                'Authorization': authToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                receiver_id: currentChatUserId,
                content
            })
        });
        
        if (response.ok) {
            document.getElementById('chat-input').value = '';
            loadMessages(currentChatUserId);
        }
    } catch (error) {
        console.error('Failed to send message:', error);
    }
}

// Groups Functions
async function loadGroups() {
    try {
        // Load user's groups
        const userGroupsResponse = await fetch('/api/groups/user', {
            headers: { 'Authorization': authToken }
        });
        const userGroups = await userGroupsResponse.json();
        
        const userContainer = document.getElementById('user-groups-list');
        userContainer.innerHTML = '';
        
        userGroups.forEach(group => {
            const card = document.createElement('div');
            card.className = 'group-card';
            card.innerHTML = `
                <h3>${group.name}</h3>
                <p>${group.description || 'No description'}</p>
                <div class="group-stats">
                    <span>Members: ${group.member_count}</span>
                    <span>Role: ${group.role}</span>
                </div>
            `;
            userContainer.appendChild(card);
        });
        
        // Load all groups
        const allGroupsResponse = await fetch('/api/groups');
        const allGroups = await allGroupsResponse.json();
        
        const allContainer = document.getElementById('all-groups-list');
        allContainer.innerHTML = '';
        
        allGroups.forEach(group => {
            const card = document.createElement('div');
            card.className = 'group-card';
            card.innerHTML = `
                <h3>${group.name}</h3>
                <p>${group.description || 'No description'}</p>
                <div class="group-stats">
                    <span>Members: ${group.member_count}</span>
                </div>
                <button class="primary-btn" onclick="joinGroup(${group.id})">Join</button>
            `;
            allContainer.appendChild(card);
        });
    } catch (error) {
        console.error('Failed to load groups:', error);
    }
}

async function handleCreateGroup(e) {
    e.preventDefault();
    const name = document.getElementById('group-name').value;
    const description = document.getElementById('group-description').value;
    
    try {
        const response = await fetch('/api/groups', {
            method: 'POST',
            headers: {
                'Authorization': authToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, description })
        });
        
        if (response.ok) {
            createGroupModal.classList.remove('active');
            document.getElementById('group-name').value = '';
            document.getElementById('group-description').value = '';
            loadGroups();
        }
    } catch (error) {
        console.error('Failed to create group:', error);
    }
}

async function joinGroup(groupId) {
    try {
        const response = await fetch(`/api/groups/${groupId}/join`, {
            method: 'POST',
            headers: { 'Authorization': authToken }
        });
        
        if (response.ok) {
            loadGroups();
        }
    } catch (error) {
        console.error('Failed to join group:', error);
    }
}

// Start the app
init();

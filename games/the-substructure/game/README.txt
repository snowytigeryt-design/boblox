THE SUBSTRUCTURE  -  co-op horror maze (v2)

PLAY
 1. Install Node.js (v18+) from nodejs.org
 2. In this folder run:   npm install
 3. Then run:            npm start
 4. Open http://localhost:3000

MULTIPLAYER
 - Every player gets a UUID (saved in your browser + in NeDB: data/players.db). Your name, runs, escapes and deaths are remembered.
 - "Create party" gives a 4-letter code. Friends type it under "Join party" (or use "Copy invite link").
 - The host presses "Enter the maze". Everyone gets the same maze (shared seed). The game starts when everyone has clicked "Click to begin".
 - Max 4 players (MAX_PLAYERS in server.js). Parties are listed in data/parties.db while the server runs.
 - Friends on the same wifi: give them the "Friends on your wifi/LAN" address the server prints. Over the internet: use a tunnel
   (e.g. cloudflared / ngrok pointing at port 3000) or host the folder on any Node host (set PORT).
 - The host's browser runs the monsters; if the host leaves, the next player takes over automatically.
 - Dead or escaped players spectate teammates (click / Space to switch).
 - "Play solo" works too. Solo also works with just VS Code Live Server (no npm) - but multiplayer needs npm start.
 - ?debug on the URL exposes window.__ss for debugging.

CONTROLS
 WASD move, Shift sprint, E hide / leave locker, P change quality, mouse look.

WHAT'S NEW (scarier)
 darker maze + denser fog, flickering/dying flashlight, blackouts, positional 3D audio (growls, footsteps, whispers, knocks, distant screams),
 chase stingers, glitch/shake/zoom when hunted, locker slats + breathing, blood writing on walls, bloodstains, corpses, shadow figure at corridor ends,
 teammates have flashlights and leave bodies when they die.

MODELS (assets/models)
 basic.glb / giant.glb / spider.glb - loaded, auto-sized, metalness tamed (Sketchfab models render black otherwise), glowing eyes, procedural walk/skitter for the unanimated ones.
 spider.glb faces -Z, so it now has yaw: Math.PI (it used to walk backwards).
 Tune monsters in js/main.js: mons[] -> h (height), speed, sight, hear, yaw (turn model if it walks sideways).

FILES
 server.js (static files + WebSocket lobby + NeDB)   package.json
 index.html  css/style.css  js/main.js (game)  js/net.js (lobby/network)  js/audio.js (sound)  js/avatars.js (player models)

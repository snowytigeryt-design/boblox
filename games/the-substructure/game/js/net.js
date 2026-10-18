/* Lobby + networking.  Loaded straight from index.html so the lobby appears instantly,
   and imported by main.js (same module instance) which awaits `sessionPromise`. */
const $ = (id) => document.getElementById(id);
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } return null; };
const uuid4 = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

export const net = {
  ws: null,
  handlers: {},
  state: { online: false, id: null, uuid: null, name: '', stats: null, party: null, members: [], hostId: null, code: '' },
  on(type, fn) { (this.handlers[type] ??= []).push(fn); },
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); },
};

let resolveSession;
export const sessionPromise = new Promise((r) => { resolveSession = r; });

const S = net.state;
let screen = 'home';
let busy = false;

function serverUrl() {
  const q = new URLSearchParams(location.search).get('server'); // ?server=myhost:3000 if the game is hosted elsewhere
  const host = q || location.host;
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + host + '/ws';
}

function setMsg(t, bad) { const m = $('lmsg'); m.textContent = t || ''; m.className = bad ? 'bad' : ''; }

function render() {
  const inParty = !!S.party;
  $('lhome').style.display = inParty ? 'none' : 'block';
  $('lparty').style.display = inParty ? 'block' : 'none';
  $('lcreate').disabled = $('ljoin').disabled = !S.online || busy;
  $('lid').textContent = S.uuid ? 'Your player ID: ' + S.uuid : '';
  $('lstats').textContent = S.stats && S.stats.games ? `Record: ${S.stats.games} runs · ${S.stats.escapes} escapes · ${S.stats.deaths} deaths` : '';
  if (inParty) {
    const p = S.party, host = p.hostId === S.id;
    $('lcode').textContent = p.code;
    $('lmembers').innerHTML = p.members.map((m) => `<li>${m.host ? '<b title="host">♛</b> ' : ''}${esc(m.name)}${m.id === S.id ? ' <i>(you)</i>' : ''}</li>`).join('') +
      Array.from({ length: Math.max(0, p.max - p.members.length) }, () => '<li class="empty">waiting for player…</li>').join('');
    $('lstart').style.display = host ? 'inline-block' : 'none';
    $('lwait').style.display = host ? 'none' : 'block';
    $('lstart').textContent = p.members.length > 1 ? `Enter the maze (${p.members.length} players)` : 'Enter the maze (alone)';
  }
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function dispatch(m) {
  switch (m.t) {
    case 'welcome':
      Object.assign(S, { online: true, id: m.id, uuid: m.uuid, name: m.name, stats: m.stats });
      store('ss_uuid', m.uuid); store('ss_name', m.name);
      $('lname').value = m.name;
      setMsg('Connected.');
      { const j = new URLSearchParams(location.search).get('join'); if (j && !S.party && !S.autoJoined) { S.autoJoined = true; net.send({ t: 'join', code: j }); } }
      render();
      break;
    case 'party':
      S.party = m.party; S.members = m.party.members; S.hostId = m.party.hostId; S.code = m.party.code; busy = false;
      setMsg('');
      render();
      break;
    case 'error': busy = false; setMsg(m.msg, true); render(); break;
    case 'start':
      S.started = true;
      S.party = m.party; S.members = m.party.members; S.hostId = m.party.hostId; S.code = m.party.code;
      $('lobby').style.display = 'none';
      resolveSession({ mode: 'mp', seed: m.seed, code: m.code, me: { id: S.id, name: S.name }, players: m.party.members.map((x) => ({ id: x.id, name: x.name })), hostId: m.hostId });
      break;
    case 'left':
      break;
    default:
  }
  (net.handlers[m.t] || []).forEach((fn) => fn(m));
}

function connect() {
  setMsg('Connecting to server…');
  let ws;
  try { ws = new WebSocket(serverUrl()); } catch (e) { return offline(); }
  net.ws = ws;
  let opened = false;
  ws.onopen = () => { opened = true; ws.send(JSON.stringify({ t: 'hello', uuid: store('ss_uuid') || undefined, name: store('ss_name') || '' })); };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } dispatch(m); };
  ws.onclose = () => {
    S.online = false;
    if (S.started) { (net.handlers.disconnect || []).forEach((fn) => fn()); return; }
    if (!opened) return offline();
    S.party = null; render(); setMsg('Disconnected from server.', true);
    setTimeout(connect, 2000);
  };
  setInterval(() => net.send({ t: 'ping' }), 20000);
}

function offline() {
  S.online = false;
  setMsg('Multiplayer server not found. Run  npm start  and open http://localhost:3000  to play together. Solo works without it.', true);
  $('lretry').style.display = 'inline-block';
  render();
}

/* ------------- UI wiring ------------- */
const nameVal = () => ($('lname').value || '').replace(/[^\w .!?\-]/g, '').trim().slice(0, 12);
$('lname').value = store('ss_name') || '';
$('lname').onchange = () => { const n = nameVal(); if (n) { store('ss_name', n); net.send({ t: 'setname', name: n }); } };
$('lcreate').onclick = () => { busy = true; render(); $('lname').onchange(); net.send({ t: 'create' }); };
const doJoin = () => {
  const code = $('lcodein').value.toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 4) return setMsg('Enter the 4-letter code.', true);
  $('lname').onchange(); busy = true; render(); net.send({ t: 'join', code });
};
$('ljoin').onclick = doJoin;
$('lcodein').oninput = (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); };
$('lcodein').onkeydown = (e) => { if (e.key === 'Enter') doJoin(); };
$('lleave').onclick = () => { net.send({ t: 'leave' }); S.party = null; render(); };
$('lstart').onclick = () => net.send({ t: 'start' });
$('lcopy').onclick = () => {
  const link = `${location.origin}${location.pathname}?join=${S.code}`;
  (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => setMsg('Invite link copied. Send it to your friends!'), () => setMsg('Share this code: ' + S.code));
};
$('lretry').onclick = () => { $('lretry').style.display = 'none'; connect(); };
$('lsolo').onclick = () => {
  if (net.ws) { S.started = false; try { net.ws.onclose = null; net.ws.close(); } catch (e) { /* ignore */ } }
  $('lobby').style.display = 'none';
  let id = store('ss_solo'); if (!id) { id = uuid4(); store('ss_solo', id); }
  const name = nameVal() || 'You';
  resolveSession({ mode: 'solo', seed: (Math.random() * 2 ** 31) | 0 || 1, code: '', me: { id, name }, players: [{ id, name }], hostId: id });
};

render();
connect();

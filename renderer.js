const $ = (id) => document.getElementById(id);

let games = [];
let filter = 'Tous';
let selectedId = null;
let pendingExe = null;
let token = 0;

// ---------- fond gaming par défaut (synthwave + manette) ----------
function buildDefaultBg() {
  let stars = '';
  for (let i = 0; i < 70; i++) {
    const x = (i * 977) % 1600, y = (i * 389) % 520, r = (i % 3) + 0.8;
    stars += `<circle cx="${x}" cy="${y}" r="${r}" opacity="${0.3 + (i % 5) * 0.12}"/>`;
  }
  let buildings = '';
  for (let x = 0; x < 1600; x += 56) {
    const h = 40 + ((x * 7) % 9) * 24;
    buildings += `<rect x="${x}" y="${560 - h}" width="46" height="${h}"/>`;
  }
  let vlines = '';
  for (let x = -2400; x <= 4000; x += 200) {
    vlines += `<line x1="${800 + (x - 800) * 0.08}" y1="560" x2="${x}" y2="900"/>`;
  }
  let hlines = '';
  for (let i = 0; i < 9; i++) {
    const y = 560 + Math.pow(i / 8, 2.2) * 340;
    hlines += `<line x1="0" y1="${y}" x2="1600" y2="${y}"/>`;
  }
  let stripes = '';
  for (let i = 0; i < 7; i++) {
    stripes += `<rect x="800" y="${360 + i * 26}" width="500" height="${4 + i * 2.6}" fill="#2a0a52"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#090320"/><stop offset=".55" stop-color="#3a1275"/><stop offset="1" stop-color="#ff4f9a"/></linearGradient>
<linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd36b"/><stop offset="1" stop-color="#ff3d8b"/></linearGradient>
<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b0638"/><stop offset="1" stop-color="#04010d"/></linearGradient>
<clipPath id="c"><circle cx="1050" cy="320" r="210"/></clipPath>
</defs>
<rect width="1600" height="900" fill="url(#sky)"/>
<g fill="#fff">${stars}</g>
<circle cx="1050" cy="320" r="210" fill="url(#sun)"/>
<g clip-path="url(#c)">${stripes}</g>
<g fill="#12042b" opacity=".92">${buildings}</g>
<rect y="560" width="1600" height="340" fill="url(#floor)"/>
<g stroke="#ff4fd8" stroke-width="2" opacity=".55">${vlines}${hlines}</g>
<g transform="translate(765 150) scale(.95)">
<path d="M180 40C90 40 40 90 20 190C5 260 30 300 70 300C110 300 130 260 160 220L440 220C470 260 490 300 530 300C570 300 595 260 580 190C560 90 510 40 420 40Z" fill="#0a0420" fill-opacity=".82" stroke="#ff7ad9" stroke-width="4"/>
<path d="M125 90h30v20h20v30h-20v20h-30v-20h-20v-30h20z" fill="#ff7ad9" opacity=".85"/>
<circle cx="470" cy="100" r="17" fill="#7cf7ff"/><circle cx="510" cy="140" r="17" fill="#7cf7ff"/>
<circle cx="430" cy="140" r="17" fill="#7cf7ff"/><circle cx="470" cy="180" r="17" fill="#7cf7ff"/>
<circle cx="235" cy="185" r="30" fill="none" stroke="#ff7ad9" stroke-width="4"/>
<circle cx="365" cy="185" r="30" fill="none" stroke="#ff7ad9" stroke-width="4"/>
</g>
</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
const DEFAULT_BG = buildDefaultBg();
const HUES = [0, 25, -30, 55, -60];

// ---------- utilitaires ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function hue(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 2600);
}

const persist = () => window.api.saveGames(games);
const current = () => games.find((g) => g.id === selectedId);

function steamId(g) {
  const m = /^steam:\/\/rungameid\/(\d+)/.exec(g.target || '');
  return m ? m[1] : null;
}
const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps/';
const heroUrl = (g) => g.hero || (steamId(g) ? `${CDN}${steamId(g)}/library_hero.jpg` : null);
const logoUrl = (g) => (steamId(g) ? `${CDN}${steamId(g)}/library_logo.png` : null);
const iconUrl = (g) => g.customIcon || g.icon || (steamId(g) ? `${CDN}${steamId(g)}/library_600x900.jpg` : null);

function formatDate(iso) {
  if (!iso) return 'Jamais';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Aujourd'hui";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR');
}

// ---------- ajout / fusion ----------
function addGames(list) {
  const byName = new Map(games.map((g) => [g.name.toLowerCase(), g]));
  let added = 0;
  for (const n of list) {
    const key = n.name.toLowerCase();
    const ex = byName.get(key);
    if (ex) {
      for (const k of ['icon', 'exe']) if (!ex[k] && n[k]) ex[k] = n[k];
      continue;
    }
    const g = { ...n, id: uid() };
    games.push(g);
    byName.set(key, g);
    added++;
    if (!selectedId) selectedId = g.id;
  }
  persist();
  render();
  return added;
}

// ---------- affichage ----------
function visibleGames() {
  const term = $('search').value.trim().toLowerCase();
  return games
    .filter((g) => filter === 'Tous' || (g.type || 'Autre') === filter)
    .filter((g) => g.name.toLowerCase().includes(term))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function makeIcon(g) {
  const ico = document.createElement('div');
  ico.className = 'ico';
  ico.style.setProperty('--h', hue(g.name));
  ico.textContent = (g.name.trim()[0] || '?').toUpperCase();
  const url = iconUrl(g);
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    if (url.startsWith('data:')) img.className = 'exe';
    img.onerror = () => img.remove();
    ico.appendChild(img);
  }
  return ico;
}

function renderList() {
  const list = $('list');
  list.innerHTML = '';
  const shown = visibleGames();

  if (!shown.length) {
    const p = document.createElement('p');
    p.className = 'nothing';
    p.textContent = games.length ? 'Aucun résultat.' : 'Aucun jeu.';
    list.appendChild(p);
    return shown;
  }

  const frag = document.createDocumentFragment();
  for (const g of shown) {
    const el = document.createElement('div');
    el.className = 'item' + (g.id === selectedId ? ' active' : '');
    el.dataset.id = g.id;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = g.name;
    name.title = g.name;
    el.append(makeIcon(g), name);
    el.onclick = () => select(g.id);
    el.ondblclick = () => play(g);
    frag.appendChild(el);
  }
  list.appendChild(frag);
  return shown;
}

function setBackground(g) {
  const layer = $('bgImg');
  const my = ++token;
  const apply = (url, isDefault) => {
    if (my !== token) return;
    layer.style.backgroundImage = `url("${url}")`;
    layer.style.setProperty('--hue', isDefault ? `${HUES[hue(g ? g.name : 'x') % HUES.length]}deg` : '0deg');
    layer.classList.remove('fade');
    void layer.offsetWidth;
    layer.classList.add('fade');
  };
  const url = g ? heroUrl(g) : null;
  if (!url) return apply(DEFAULT_BG, true);
  const im = new Image();
  im.onload = () => apply(url, false);
  im.onerror = () => apply(DEFAULT_BG, true);
  im.src = url;
}

function setLogo(g) {
  const logo = $('gLogo');
  const title = $('gTitle');
  title.textContent = g.name;
  title.classList.remove('hidden');
  logo.classList.add('hidden');
  const url = logoUrl(g);
  if (!url) return;
  const my = token;
  const im = new Image();
  im.onload = () => {
    if (current() !== g) return;
    logo.src = url;
    logo.alt = g.name;
    logo.classList.remove('hidden');
    title.classList.add('hidden');
  };
  im.src = url;
}

function row(table, label, value, link) {
  if (!value) return;
  const tr = document.createElement('tr');
  const k = document.createElement('td');
  k.className = 'k';
  k.textContent = label;
  const v = document.createElement('td');
  v.className = 'v' + (link ? ' link' : '');
  v.textContent = value;
  tr.append(k, v);
  table.appendChild(tr);
}

function renderDetails(g, meta) {
  const t = $('details');
  t.innerHTML = '';
  row(t, 'Bibliothèque', g.type || 'Autre', true);
  row(t, 'Plateforme', 'PC', true);
  if (meta) {
    row(t, 'Genre', (meta.genres || []).join(', '), true);
    row(t, 'Développeur', (meta.developers || []).join(', '), true);
    row(t, 'Éditeur', (meta.publishers || []).join(', '), true);
    row(t, 'Date de sortie', meta.release, true);
  }
  row(t, 'Dernier lancement', formatDate(g.lastPlayed));
  row(t, 'Lancements', String(g.launches || 0));

  const desc = $('gDesc');
  if (meta && meta.description) {
    desc.textContent = meta.description;
    desc.classList.remove('muted');
  } else {
    desc.textContent = 'Aucune description disponible.';
    desc.classList.add('muted');
  }
}

async function showGame(g) {
  $('emptyState').classList.add('hidden');
  $('info').classList.remove('hidden');
  setBackground(g);
  setLogo(g);
  renderDetails(g, null);
  const id = steamId(g);
  if (id) {
    const meta = await window.api.getMeta(id);
    if (current() === g && meta) renderDetails(g, meta);
  }
}

function showEmpty() {
  $('info').classList.add('hidden');
  $('emptyState').classList.remove('hidden');
  setBackground(null);
}

function select(id) {
  if (selectedId === id) return;
  selectedId = id;
  localStorage.setItem('selected', id);
  document.querySelectorAll('.item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === id);
    if (el.dataset.id === id) el.scrollIntoView({ block: 'nearest' });
  });
  const g = current();
  if (g) showGame(g);
}

function render() {
  renderFilterMenu();
  const shown = renderList();
  $('main').scrollTop = 0;
  if (!games.length) return showEmpty();
  if (!shown.some((g) => g.id === selectedId)) {
    selectedId = shown.length ? shown[0].id : null;
    renderList();
  }
  const g = current();
  if (g) showGame(g);
}

function renderFilterMenu() {
  const types = ['Tous', ...new Set(games.map((g) => g.type || 'Autre'))];
  if (!types.includes(filter)) filter = 'Tous';
  const m = $('filterMenu');
  m.innerHTML = '';
  for (const t of types) {
    const b = document.createElement('button');
    const c = document.createElement('span');
    c.className = 'check';
    c.textContent = t === filter ? '✓' : '';
    b.append(c, document.createTextNode(t));
    b.onclick = () => { filter = t; closeMenus(); render(); };
    m.appendChild(b);
  }
}

// ---------- actions ----------
async function play(g) {
  const ok = await window.api.launch(g);
  if (ok) {
    g.lastPlayed = new Date().toISOString();
    g.launches = (g.launches || 0) + 1;
    persist();
    if (current() === g) renderDetails(g, null);
    toast(`Lancement de ${g.name}…`);
    const id = steamId(g);
    if (id) window.api.getMeta(id).then((m) => { if (m && current() === g) renderDetails(g, m); });
  } else {
    toast(`Impossible de lancer ${g.name}`);
  }
}

async function importAll() {
  closeMenus();
  const found = await window.api.scanAll();
  const n = addGames(found);
  toast(n ? `${n} jeu${n > 1 ? 'x' : ''} ajouté${n > 1 ? 's' : ''}` : 'Icônes mises à jour, aucun nouveau jeu');
}

async function addValorant() {
  closeMenus();
  const v = await window.api.addValorant();
  if (!v) return;
  const n = addGames([v]);
  toast(n ? 'Valorant ajouté' : 'Valorant est déjà dans la liste');
}

async function addExe() {
  closeMenus();
  const r = await window.api.pickExe();
  if (!r) return;
  pendingExe = r;
  $('nameInput').value = r.name;
  $('modal').classList.remove('hidden');
  $('nameInput').focus();
  $('nameInput').select();
}

function confirmName() {
  const name = $('nameInput').value.trim();
  if (name && pendingExe) {
    addGames([{ name, target: pendingExe.path, exe: pendingExe.path, icon: pendingExe.icon, type: 'Autre' }]);
    toast(`${name} ajouté`);
  }
  closeModal();
}

function closeModal() {
  pendingExe = null;
  $('modal').classList.add('hidden');
}

async function changeBg() {
  closeMenus();
  const g = current();
  const url = g && (await window.api.pickImage());
  if (!url) return;
  g.hero = url;
  persist();
  setBackground(g);
}

async function changeIcon() {
  closeMenus();
  const g = current();
  const url = g && (await window.api.pickImage());
  if (!url) return;
  g.customIcon = url;
  persist();
  renderList();
}

function resetImages() {
  closeMenus();
  const g = current();
  if (!g) return;
  delete g.hero;
  delete g.customIcon;
  persist();
  renderList();
  setBackground(g);
}

function deleteGame() {
  closeMenus();
  const g = current();
  if (!g || !confirm(`Retirer ${g.name} de la bibliothèque ?`)) return;
  games = games.filter((x) => x !== g);
  selectedId = null;
  persist();
  render();
}

// ---------- menus ----------
function closeMenus() {
  ['menu', 'filterMenu', 'moreMenu'].forEach((id) => $(id).classList.add('hidden'));
}
function toggleMenu(id, e) {
  e.stopPropagation();
  const open = !$(id).classList.contains('hidden');
  closeMenus();
  if (!open) $(id).classList.remove('hidden');
}

// ---------- événements ----------
$('addBtn').onclick = (e) => toggleMenu('menu', e);
$('filterBtn').onclick = (e) => toggleMenu('filterMenu', e);
$('moreBtn').onclick = (e) => toggleMenu('moreMenu', e);
document.addEventListener('click', closeMenus);

$('miImport').onclick = importAll;
$('emptyImport').onclick = importAll;
$('miValorant').onclick = addValorant;
$('miExe').onclick = addExe;
$('miBg').onclick = changeBg;
$('miIcon').onclick = changeIcon;
$('miReset').onclick = resetImages;
$('miDelete').onclick = deleteGame;
$('playBtn').onclick = () => { const g = current(); if (g) play(g); };

$('search').addEventListener('input', render);
$('nameOk').onclick = confirmName;
$('nameCancel').onclick = closeModal;
$('nameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmName();
  if (e.key === 'Escape') closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
  const shown = visibleGames();
  const i = shown.findIndex((g) => g.id === selectedId);
  if (e.key === 'Enter') { const g = current(); if (g) play(g); return; }
  const next = shown[Math.max(0, Math.min(shown.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
  if (next) { e.preventDefault(); select(next.id); }
});

// ---------- démarrage ----------
(async () => {
  const saved = await window.api.getGames();
  const seen = new Set();
  games = saved.filter((g) => {
    const k = g.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  games.forEach((g) => { if (!g.id) g.id = uid(); });
  if (games.length !== saved.length || saved.some((g) => !g.id)) persist();
  selectedId = localStorage.getItem('selected');
  render();
})();

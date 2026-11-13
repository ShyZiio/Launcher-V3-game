const $ = (id) => document.getElementById(id);

let games = [];
let filter = 'Tous';
let pendingExe = null;

// ---------- utilitaires ----------
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

async function persist() {
  await window.api.saveGames(games);
}

function addGames(list) {
  const known = new Set(games.map((g) => g.name.toLowerCase()));
  const fresh = list.filter((g) => !known.has(g.name.toLowerCase()));
  games.push(...fresh);
  persist();
  render();
  return fresh.length;
}

// ---------- affichage ----------
function renderFilters() {
  const types = ['Tous', ...new Set(games.map((g) => g.type || 'Autre'))];
  if (!types.includes(filter)) filter = 'Tous';
  const nav = $('filters');
  nav.innerHTML = '';
  if (types.length <= 2) return;
  for (const t of types) {
    const b = document.createElement('button');
    b.className = 'chip' + (t === filter ? ' active' : '');
    b.textContent = t;
    b.onclick = () => { filter = t; render(); };
    nav.appendChild(b);
  }
}

function makeCard(g) {
  const card = document.createElement('article');
  card.className = 'card';

  const art = document.createElement('div');
  art.className = 'art';
  art.style.setProperty('--h', hue(g.name));

  const letter = document.createElement('span');
  letter.className = 'letter';
  letter.textContent = (g.name.trim()[0] || '?').toUpperCase();
  art.appendChild(letter);

  if (g.cover) {
    const img = document.createElement('img');
    img.src = g.cover;
    img.loading = 'lazy';
    img.alt = '';
    img.onerror = () => img.remove();
    art.appendChild(img);
  }

  const del = document.createElement('button');
  del.className = 'del';
  del.textContent = '✕';
  del.title = 'Retirer';
  del.onclick = (e) => {
    e.stopPropagation();
    if (confirm(`Retirer ${g.name} du launcher ?`)) {
      games = games.filter((x) => x !== g);
      persist();
      render();
    }
  };
  art.appendChild(del);

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const play = document.createElement('button');
  play.className = 'play';
  play.textContent = '▶  Jouer';
  play.onclick = async () => {
    const ok = await window.api.launch(g);
    toast(ok ? `Lancement de ${g.name}…` : `Impossible de lancer ${g.name}`);
  };
  overlay.appendChild(play);
  art.appendChild(overlay);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const h3 = document.createElement('h3');
  h3.textContent = g.name;
  h3.title = g.name;
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = g.type || 'Autre';
  meta.append(h3, badge);

  card.append(art, meta);
  return card;
}

function render() {
  renderFilters();
  const term = $('search').value.trim().toLowerCase();
  const shown = games
    .filter((g) => (filter === 'Tous' || (g.type || 'Autre') === filter))
    .filter((g) => g.name.toLowerCase().includes(term))
    .sort((a, b) => a.name.localeCompare(b.name));

  $('count').textContent = `${games.length} jeu${games.length > 1 ? 'x' : ''}`;

  const grid = $('grid');
  const empty = $('empty');
  grid.innerHTML = '';

  if (!shown.length) {
    empty.classList.remove('hidden');
    empty.innerHTML = '';
    const h = document.createElement('h2');
    const p = document.createElement('p');
    if (games.length) {
      h.textContent = 'Aucun résultat';
      p.textContent = 'Essaie une autre recherche.';
      empty.append(h, p);
    } else {
      h.textContent = 'Ta bibliothèque est vide';
      p.textContent = 'Importe tes jeux Steam et Epic en un clic.';
      const b = document.createElement('button');
      b.className = 'btn primary';
      b.textContent = 'Importer Steam et Epic';
      b.onclick = importAll;
      empty.append(h, p, b);
    }
    return;
  }

  empty.classList.add('hidden');
  const frag = document.createDocumentFragment();
  shown.forEach((g) => frag.appendChild(makeCard(g)));
  grid.appendChild(frag);
}

// ---------- actions ----------
async function importAll() {
  closeMenu();
  const found = await window.api.scanAll();
  const n = addGames(found);
  toast(n ? `${n} jeu${n > 1 ? 'x' : ''} ajouté${n > 1 ? 's' : ''}` : 'Aucun nouveau jeu trouvé');
}

async function addValorant() {
  closeMenu();
  const v = await window.api.addValorant();
  if (v) {
    const n = addGames([v]);
    toast(n ? 'Valorant ajouté' : 'Valorant est déjà dans la liste');
  }
}

async function addExe() {
  closeMenu();
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
    addGames([{ name, target: pendingExe.path, type: 'Autre' }]);
    toast(`${name} ajouté`);
  }
  closeModal();
}

function closeModal() {
  pendingExe = null;
  $('modal').classList.add('hidden');
}

function closeMenu() { $('menu').classList.add('hidden'); }

// ---------- événements ----------
$('addBtn').onclick = (e) => {
  e.stopPropagation();
  $('menu').classList.toggle('hidden');
};
document.addEventListener('click', closeMenu);
$('miImport').onclick = importAll;
$('miValorant').onclick = addValorant;
$('miExe').onclick = addExe;
$('search').addEventListener('input', render);
$('nameOk').onclick = confirmName;
$('nameCancel').onclick = closeModal;
$('nameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmName();
  if (e.key === 'Escape') closeModal();
});

(async () => {
  games = await window.api.getGames();
  render();
})();

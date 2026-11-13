const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { spawn, execFileSync } = require('child_process');

let win;
const dataFile = () => path.join(app.getPath('userData'), 'games.json');
const metaFile = () => path.join(app.getPath('userData'), 'meta.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

async function fileIcon(p) {
  try {
    const img = await app.getFileIcon(p, { size: 'large' });
    return img.toDataURL();
  } catch { return null; }
}

// ---------- Steam ----------
function steamRoot() {
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8' });
    const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/);
    if (m) return m[1].trim().replace(/\//g, '\\');
  } catch {}
  return 'C:\\Program Files (x86)\\Steam';
}

function scanSteam() {
  const root = steamRoot();
  const libs = new Set([path.join(root, 'steamapps')]);
  try {
    const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
      libs.add(path.join(m[1].replace(/\\\\/g, '\\'), 'steamapps'));
    }
  } catch {}
  const byId = new Map();
  for (const lib of libs) {
    let files = [];
    try { files = fs.readdirSync(lib); } catch { continue; }
    for (const f of files) {
      if (!/^appmanifest_\d+\.acf$/.test(f)) continue;
      try {
        const t = fs.readFileSync(path.join(lib, f), 'utf8');
        const id = t.match(/"appid"\s+"(\d+)"/)[1];
        const name = t.match(/"name"\s+"([^"]+)"/)[1];
        if (/Steamworks|Proton|Steam Linux Runtime/.test(name)) continue;
        if (!byId.has(id)) byId.set(id, { name, target: `steam://rungameid/${id}`, type: 'Steam' });
      } catch {}
    }
  }
  return [...byId.values()];
}

// ---------- Epic ----------
async function scanEpic() {
  const dir = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';
  const out = [];
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return out; }
  for (const f of files) {
    if (!f.endsWith('.item')) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const exe = d.InstallLocation && d.LaunchExecutable ? path.join(d.InstallLocation, d.LaunchExecutable) : null;
      const icon = exe && fs.existsSync(exe) ? await fileIcon(exe) : null;
      out.push({
        name: d.DisplayName,
        target: `com.epicgames.launcher://apps/${d.CatalogNamespace}%3A${d.CatalogItemId}%3A${d.AppName}?action=launch&silent=true`,
        type: 'Epic',
        exe,
        icon
      });
    } catch {}
  }
  return out;
}

// ---------- outils de détection ----------
function regDump(key) {
  try {
    const out = execFileSync('reg', ['query', key, '/s'], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore']
    });
    const blocks = [];
    let cur = null;
    for (const raw of out.split(/\r?\n/)) {
      if (!raw.trim()) continue;
      if (/^HKEY/i.test(raw)) { cur = { key: raw.trim(), vals: {} }; blocks.push(cur); continue; }
      const m = raw.match(/^\s+(.+?)\s+REG_\w+\s*(.*)$/);
      if (m && cur) cur.vals[m[1]] = m[2];
    }
    return blocks;
  } catch { return []; }
}
const lastSeg = (k) => k.split('\\').pop();
const clean = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '');

const BAD_EXE = /unins|setup|crash|redist|vcredist|dxsetup|installer|cleanup|activation|touchup|eadesktop|eabackground|origin|easyanticheat|battleye|helper|updater|report|dotnet|vc_|prereq|support|uplay/i;
const BAD_DIR = /redist|_commonredist|directx|support|anticheat|__installer/i;

function findMainExe(dir) {
  let best = null, size = 0;
  const walk = (d, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isFile() && /\.exe$/i.test(e.name) && !BAD_EXE.test(e.name)) {
        try { const sz = fs.statSync(p).size; if (sz > size) { size = sz; best = p; } } catch {}
      } else if (e.isDirectory() && depth < 2 && !BAD_DIR.test(e.name)) {
        walk(p, depth + 1);
      }
    }
  };
  walk(dir, 0);
  return best;
}

function driveLetters() {
  const out = [];
  for (let c = 67; c <= 90; c++) {
    const d = String.fromCharCode(c) + ':\\';
    if (fs.existsSync(d)) out.push(d);
  }
  return out;
}

async function exeEntry(name, exe, type, extra = {}) {
  return { name, target: exe, exe, type, icon: await fileIcon(exe), ...extra };
}

// ---------- Riot (Valorant, LoL...) ----------
async function scanRiot() {
  let rc = null;
  try {
    const j = JSON.parse(fs.readFileSync('C:\\ProgramData\\Riot Games\\RiotClientInstalls.json', 'utf8'));
    rc = j.rc_live || j.rc_default || j.rc_beta;
  } catch {}
  if (!rc || !fs.existsSync(rc)) {
    const d = 'C:\\Riot Games\\Riot Client\\RiotClientServices.exe';
    if (!fs.existsSync(d)) return [];
    rc = d;
  }
  const names = { valorant: 'Valorant', league_of_legends: 'League of Legends', bacon: 'Legends of Runeterra', lion: '2XKO' };
  const meta = 'C:\\ProgramData\\Riot Games\\Metadata';
  let dirs = [];
  try { dirs = fs.readdirSync(meta); } catch { return []; }
  const out = [];
  for (const d of dirs) {
    const [id, line] = d.split('.');
    if (!names[id] || (line && line !== 'live')) continue;
    let iconSrc = rc;
    try {
      for (const f of fs.readdirSync(path.join(meta, d))) {
        if (!/\.ya?ml$/i.test(f)) continue;
        const m = fs.readFileSync(path.join(meta, d, f), 'utf8').match(/product_install_full_path:\s*"?([^"\r\n]+)"?/);
        if (m) { const e = findMainExe(clean(m[1])); if (e) iconSrc = e; }
      }
    } catch {}
    out.push({
      name: names[id],
      target: rc,
      type: 'Riot',
      args: `--launch-product=${id} --launch-patchline=live`,
      icon: await fileIcon(iconSrc)
    });
  }
  return out;
}

// ---------- Ubisoft Connect ----------
async function scanUbisoft() {
  const out = [];
  for (const b of regDump('HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs')) {
    const dir = clean(b.vals.InstallDir);
    if (!dir) continue;
    const id = lastSeg(b.key);
    const exe = findMainExe(dir);
    out.push({
      name: path.basename(dir),
      target: `uplay://launch/${id}/0`,
      type: 'Ubisoft',
      exe,
      icon: exe ? await fileIcon(exe) : null
    });
  }
  return out;
}

// ---------- GOG ----------
async function scanGog() {
  const out = [];
  for (const b of regDump('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games')) {
    if (!b.vals.gameName || !b.vals.exe) continue;
    const exe = clean(b.vals.exe);
    if (!fs.existsSync(exe)) continue;
    out.push(await exeEntry(b.vals.gameName, exe, 'GOG', b.vals.launchParam ? { args: b.vals.launchParam } : {}));
  }
  return out;
}

// ---------- EA app / Origin ----------
async function scanEA() {
  const found = new Map();
  const add = async (name, dir) => {
    const key = name.toLowerCase();
    if (found.has(key)) return;
    const exe = findMainExe(dir);
    if (exe) found.set(key, await exeEntry(name, exe, 'EA'));
  };
  const roots = [];
  for (const d of driveLetters()) {
    roots.push(
      d + 'Program Files\\EA Games', d + 'Program Files (x86)\\EA Games', d + 'EA Games',
      d + 'Games\\EA Games', d + 'Program Files\\Electronic Arts', d + 'Program Files (x86)\\Origin Games',
      d + 'Origin Games'
    );
  }
  for (const r of roots) {
    let ents = [];
    try { ents = fs.readdirSync(r, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) if (e.isDirectory()) await add(e.name, path.join(r, e.name));
  }
  for (const root of ['HKLM\\SOFTWARE\\WOW6432Node\\EA Games', 'HKLM\\SOFTWARE\\EA Games', 'HKLM\\SOFTWARE\\WOW6432Node\\Electronic Arts']) {
    for (const b of regDump(root)) {
      const dir = clean(b.vals['Install Dir'] || b.vals.InstallDir);
      const name = lastSeg(b.key);
      if (dir && !/^(EA Games|Electronic Arts)$/i.test(name)) await add(name, dir);
    }
  }
  return [...found.values()];
}

// ---------- Rockstar ----------
async function scanRockstar() {
  const out = [];
  for (const b of regDump('HKLM\\SOFTWARE\\WOW6432Node\\Rockstar Games')) {
    const dir = clean(b.vals.InstallFolder);
    const name = lastSeg(b.key);
    if (!dir || /^Rockstar Games$/i.test(name) || /launcher/i.test(name)) continue;
    const exe = findMainExe(dir);
    if (exe) out.push(await exeEntry(name, exe, 'Rockstar'));
  }
  return out;
}

// ---------- Blizzard / Battle.net ----------
async function scanBlizzard() {
  const out = [];
  for (const b of regDump('HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall')) {
    if (!/Blizzard Entertainment/i.test(b.vals.Publisher || '')) continue;
    const name = b.vals.DisplayName;
    const dir = clean(b.vals.InstallLocation);
    if (!name || !dir || /battle\.net/i.test(name)) continue;
    const exe = findMainExe(dir);
    if (exe) out.push(await exeEntry(name, exe, 'Battle.net'));
  }
  return out;
}

// ---------- IPC ----------
ipcMain.handle('games:get', () => readJson(dataFile(), []));
ipcMain.handle('games:save', (_, games) => { writeJson(dataFile(), games); return true; });
ipcMain.handle('scan:all', async () => {
  const jobs = [
    async () => scanSteam(), scanEpic, scanRiot, scanUbisoft, scanGog, scanEA, scanRockstar, scanBlizzard
  ];
  const all = [];
  for (const job of jobs) {
    try { all.push(...(await job())); } catch {}
  }
  const seen = new Set();
  return all.filter((g) => {
    const k = g.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
});

ipcMain.handle('game:launch', (_, g) => {
  try {
    if (g.target.includes('://')) {
      shell.openExternal(g.target);
    } else {
      const args = g.args ? g.args.split(/\s+/) : [];
      const p = spawn(g.target, args, { cwd: path.dirname(g.target), detached: true, stdio: 'ignore' });
      p.on('error', () => {});
      p.unref();
    }
    return true;
  } catch { return false; }
});

ipcMain.handle('pick:exe', async () => {
  const r = await dialog.showOpenDialog(win, {
    filters: [{ name: 'Exécutable', extensions: ['exe'] }],
    properties: ['openFile']
  });
  if (r.canceled) return null;
  const p = r.filePaths[0];
  return { path: p, name: path.basename(p, path.extname(p)), icon: await fileIcon(p) };
});

ipcMain.handle('pick:image', async () => {
  const r = await dialog.showOpenDialog(win, {
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
    properties: ['openFile']
  });
  if (r.canceled) return null;
  return pathToFileURL(r.filePaths[0]).href;
});

ipcMain.handle('add:valorant', async () => {
  let p = 'C:\\Riot Games\\Riot Client\\RiotClientServices.exe';
  if (!fs.existsSync(p)) {
    const r = await dialog.showOpenDialog(win, {
      title: 'Trouve RiotClientServices.exe',
      filters: [{ name: 'Exécutable', extensions: ['exe'] }],
      properties: ['openFile']
    });
    if (r.canceled) return null;
    p = r.filePaths[0];
  }
  return {
    name: 'Valorant',
    target: p,
    type: 'Riot',
    args: '--launch-product=valorant --launch-patchline=live',
    icon: await fileIcon(p)
  };
});

// Infos Steam (description, genre, développeur...) avec cache local
ipcMain.handle('meta:get', async (_, appid) => {
  const cache = readJson(metaFile(), {});
  if (cache[appid]) return cache[appid];
  try {
    const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=french`);
    const j = await r.json();
    const d = j[appid];
    if (!d || !d.success) return null;
    const x = d.data;
    const meta = {
      description: x.short_description || '',
      genres: (x.genres || []).map((g) => g.description),
      developers: x.developers || [],
      publishers: x.publishers || [],
      release: (x.release_date && x.release_date.date) || ''
    };
    cache[appid] = meta;
    writeJson(metaFile(), cache);
    return meta;
  } catch { return null; }
});

// ---------- images automatiques ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'game';

ipcMain.handle('settings:get', () => ({ hasKey: !!readJson(settingsFile(), {}).sgdbKey }));
ipcMain.handle('settings:setKey', (_, k) => {
  const s = readJson(settingsFile(), {});
  s.sgdbKey = String(k || '').trim();
  writeJson(settingsFile(), s);
  return !!s.sgdbKey;
});

async function download(url, base) {
  const mt = url.split('?')[0].match(/\.(png|jpe?g|webp|gif|ico)$/i);
  const ext = mt ? mt[1].toLowerCase() : 'png';
  const dir = path.join(app.getPath('userData'), 'images');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${base}.${ext}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error('download');
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return pathToFileURL(file).href;
}

async function sgdb(key, apiPath) {
  const r = await fetch('https://www.steamgriddb.com/api/v2' + apiPath, { headers: { Authorization: 'Bearer ' + key } });
  if (!r.ok) throw new Error('sgdb ' + r.status);
  const j = await r.json();
  return j.success ? j.data : [];
}

ipcMain.handle('art:fetch', async (_, name) => {
  const res = { found: false, usedKey: false, keyError: false, hero: null, logo: null, icon: null, steamAppId: null };
  const key = readJson(settingsFile(), {}).sgdbKey;
  const base = slug(name);

  if (key) {
    try {
      const games = await sgdb(key, '/search/autocomplete/' + encodeURIComponent(name));
      res.usedKey = true;
      if (games.length) {
        const id = games[0].id;
        const [heroes, logos, icons] = await Promise.all([
          sgdb(key, `/heroes/game/${id}?types=static&nsfw=false`).catch(() => []),
          sgdb(key, `/logos/game/${id}?types=static&nsfw=false`).catch(() => []),
          sgdb(key, `/icons/game/${id}?types=static&nsfw=false`).catch(() => [])
        ]);
        if (heroes[0]) res.hero = await download(heroes[0].url, base + '-hero').catch(() => null);
        if (logos[0]) res.logo = await download(logos[0].url, base + '-logo').catch(() => null);
        if (icons[0]) res.icon = await download(icons[0].url, base + '-icon').catch(() => null);
      }
    } catch (e) {
      res.keyError = /40[13]/.test(String(e.message));
    }
  }

  // Sans clé (ou rien trouvé) : on cherche le même jeu sur Steam par son nom exact
  if (!res.hero) {
    try {
      const r = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&l=french&cc=fr`);
      const j = await r.json();
      const low = name.toLowerCase();
      const hit = (j.items || []).find((i) => i.name && i.name.toLowerCase() === low);
      if (hit) res.steamAppId = String(hit.id);
    } catch {}
  }

  res.found = !!(res.hero || res.logo || res.icon || res.steamAppId);
  return res;
});

// ---------- fenêtre ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 860,
    minHeight: 520,
    backgroundColor: '#0b0d13',
    title: 'Mon Launcher',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0d13', symbolColor: '#ffffff', height: 52 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});
app.on('window-all-closed', () => app.quit());

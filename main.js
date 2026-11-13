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

// ---------- IPC ----------
ipcMain.handle('games:get', () => readJson(dataFile(), []));
ipcMain.handle('games:save', (_, games) => { writeJson(dataFile(), games); return true; });
ipcMain.handle('scan:all', async () => [...scanSteam(), ...(await scanEpic())]);

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

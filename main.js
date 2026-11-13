const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');

let win;
const dataFile = () => path.join(app.getPath('userData'), 'games.json');

function loadGames() {
  try { return JSON.parse(fs.readFileSync(dataFile(), 'utf8')); } catch { return []; }
}
function saveGames(games) {
  fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify(games, null, 2));
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
  const out = [];
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
        out.push({
          name,
          target: `steam://rungameid/${id}`,
          type: 'Steam',
          cover: `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`
        });
      } catch {}
    }
  }
  return out;
}

// ---------- Epic ----------
function scanEpic() {
  const dir = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';
  const out = [];
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return out; }
  for (const f of files) {
    if (!f.endsWith('.item')) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      out.push({
        name: d.DisplayName,
        target: `com.epicgames.launcher://apps/${d.CatalogNamespace}%3A${d.CatalogItemId}%3A${d.AppName}?action=launch&silent=true`,
        type: 'Epic'
      });
    } catch {}
  }
  return out;
}

// ---------- IPC ----------
ipcMain.handle('games:get', () => loadGames());
ipcMain.handle('games:save', (_, games) => { saveGames(games); return true; });
ipcMain.handle('scan:all', () => [...scanSteam(), ...scanEpic()]);

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
  return { path: p, name: path.basename(p, path.extname(p)) };
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
  return { name: 'Valorant', target: p, type: 'Riot', args: '--launch-product=valorant --launch-patchline=live' };
});

// ---------- fenêtre ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#0b0d13',
    title: 'Mon Launcher',
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

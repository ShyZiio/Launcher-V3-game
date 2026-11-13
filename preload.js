const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getGames: () => ipcRenderer.invoke('games:get'),
  saveGames: (games) => ipcRenderer.invoke('games:save', games),
  launch: (game) => ipcRenderer.invoke('game:launch', game),
  scanAll: () => ipcRenderer.invoke('scan:all'),
  pickExe: () => ipcRenderer.invoke('pick:exe'),
  pickImage: () => ipcRenderer.invoke('pick:image'),
  addValorant: () => ipcRenderer.invoke('add:valorant'),
  getMeta: (appid) => ipcRenderer.invoke('meta:get', appid)
});

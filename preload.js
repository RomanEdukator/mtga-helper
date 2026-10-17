const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('helper', {
  onPack: (cb) => ipcRenderer.on('pack', (_e, data) => cb(data)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, msg) => cb(msg)),
  onPool: (cb) => ipcRenderer.on('pool', (_e, data) => cb(data)),
  onView: (cb) => ipcRenderer.on('view', (_e, view) => cb(view)),
  onDecks: (cb) => ipcRenderer.on('decks', (_e, data) => cb(data)),
  copyDeck: (text) => ipcRenderer.invoke('copy-deck', text),
});

'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lesacaDesktop', {
  setServer: (url) => ipcRenderer.invoke('set-server', url),
  resetServer: () => ipcRenderer.invoke('reset-server'),
});

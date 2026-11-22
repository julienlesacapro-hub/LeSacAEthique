'use strict';
/**
 * Application de bureau : fenêtre dédiée qui ouvre le serveur du comité.
 * L'adresse du serveur est demandée au premier lancement puis mémorisée.
 * Toute la logique et les données restent sur le serveur de l'association :
 * rien n'est stocké en clair sur l'ordinateur (pas de cache des documents).
 */
const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const fs = require('fs');
const path = require('path');

const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return {}; } };
const writeCfg = (c) => fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 2));

let win;
function open() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 600, title: 'LeSacAEthique', icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  const { serverUrl } = readCfg();
  if (serverUrl) win.loadURL(serverUrl + '/#/dossiers'); else win.loadFile(path.join(__dirname, 'setup.html'));
  // Liens externes (mailto, sites) : navigateur du système ; navigation limitée au serveur du comité
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    const s = readCfg().serverUrl;
    if (url.startsWith('file:') || (s && url.startsWith(s))) return;
    e.preventDefault(); shell.openExternal(url);
  });
}

ipcMain.handle('set-server', async (_e, url) => {
  url = String(url || '').trim().replace(/\/$/, '');
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) return 'L’adresse doit commencer par https://';
  try { const r = await fetch(url + '/api/health'); if (!r.ok) throw new Error(); } catch { return 'Serveur injoignable à cette adresse'; }
  writeCfg({ ...readCfg(), serverUrl: url });
  win.loadURL(url + '/#/connexion');
  return null;
});
ipcMain.handle('reset-server', () => { writeCfg({}); win.loadFile(path.join(__dirname, 'setup.html')); });

app.whenReady().then(async () => {
  // Pas de cache disque des réponses (documents confidentiels)
  await session.defaultSession.clearCache();
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'notifications' || perm === 'clipboard-sanitized-write'));
  open();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) open(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

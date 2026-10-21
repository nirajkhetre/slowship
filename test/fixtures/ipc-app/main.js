// INERT TEST FIXTURE: an Electron app with one checked and one unchecked IPC handler. Never run.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

function createWindow() {
  const win = new BrowserWindow({ webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  win.loadFile('index.html');
}

ipcMain.handle('open-link', (event, url) => shell.openExternal(url));

ipcMain.handle('read-note', (event, name) => {
  if (!event.senderFrame.url.startsWith('file://')) throw new Error('not ours');
  return readFile(path.join(app.getPath('userData'), 'notes', path.basename(name)), 'utf8');
});

ipcMain.on('log', (event, line) => console.log(line));

app.whenReady().then(createWindow);

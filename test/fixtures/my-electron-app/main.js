// INERT TEST FIXTURE: an app built with risky choices on purpose. Never run.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const OPENAI_KEY = 'sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIj';
function createWindow() {
  const win = new BrowserWindow({ webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false } });
  win.webContents.openDevTools();
  ipcMain.handle('open', (e, url) => shell.openExternal(url));
  win.loadURL('https://example.invalid');
}
app.whenReady().then(createWindow);

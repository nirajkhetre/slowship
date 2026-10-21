// INERT TEST FIXTURE. Never run.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notes', {
  openLink: url => ipcRenderer.invoke('open-link', url),
  read: name => ipcRenderer.invoke('read-note', name),
  log: line => ipcRenderer.send('log', line),
});

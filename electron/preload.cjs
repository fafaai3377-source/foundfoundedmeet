const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ffm', {
  getEnv: () => ipcRenderer.invoke('env:get'),
  setEnv: (next) => ipcRenderer.invoke('env:set', next),
  close: () => ipcRenderer.invoke('settings:close'),
});

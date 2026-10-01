'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('notenpult', {
  loadDb: () => ipcRenderer.invoke('db:load'),
  saveDb: (text) => ipcRenderer.invoke('db:save', text),

  loadAnnotations: (id) => ipcRenderer.invoke('ann:load', id),
  saveAnnotations: (id, text) => ipcRenderer.invoke('ann:save', id, text),
  deleteAnnotations: (id) => ipcRenderer.invoke('ann:delete', id),

  pickFiles: (opts) => ipcRenderer.invoke('files:pick', opts),
  importFiles: (paths) => ipcRenderer.invoke('files:import', paths),
  deleteFiles: (names) => ipcRenderer.invoke('files:delete', names),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },

  pickFolder: (opts) => ipcRenderer.invoke('dialog:pickFolder', opts),
  poolScan: (folder) => ipcRenderer.invoke('pool:scan', folder),
  detectGoogleDrive: () => ipcRenderer.invoke('pool:detectDrive'),

  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  info: () => ipcRenderer.invoke('app:info'),

  setFullscreen: (on) => ipcRenderer.invoke('win:setFullscreen', on),
  isFullscreen: () => ipcRenderer.invoke('win:isFullscreen'),
  onFullscreenChange: (cb) => ipcRenderer.on('win:fullscreen', (_e, on) => cb(on)),
  keepAwake: (on) => ipcRenderer.invoke('power:keepAwake', on),
  setTheme: (mode) => ipcRenderer.invoke('theme:set', mode),

  test: {
    capture: (name) => ipcRenderer.invoke('test:capture', name),
    resize: (w, h) => ipcRenderer.invoke('test:resize', w, h),
    copyFile: (src, dst) => ipcRenderer.invoke('test:copyFile', src, dst),
    done: () => ipcRenderer.invoke('test:done'),
  },
});

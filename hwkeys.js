'use strict';

// Volume and media keys for remotes (renderer/js/remote.js): selfie shutters and scroll rings send
// "Volume up" and the like, which Windows handles itself. While the viewer asks for them (and the
// window has the focus) Notenpult takes them as global shortcuts and passes them on as 'hw:key' –
// the volume does not change meanwhile. Android: MainActivity.dispatchKeyEvent.

const { app, globalShortcut, ipcMain } = require('electron');

/** Electron accelerator → key name as in a keydown event. */
const KEYS = {
  VolumeUp: 'AudioVolumeUp',
  VolumeDown: 'AudioVolumeDown',
  MediaNextTrack: 'MediaTrackNext',
  MediaPreviousTrack: 'MediaTrackPrevious',
  MediaPlayPause: 'MediaPlayPause',
};

function registerHardwareKeys(getWin, { test = false } = {}) {
  let wanted = false;
  let active = false;
  const send = (key) => {
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send('hw:key', key);
  };
  const apply = () => {
    const win = getWin();
    const on = wanted && !!win && !win.isDestroyed() && win.isFocused();
    if (on === active) return;
    active = on;
    for (const [accelerator, key] of Object.entries(KEYS)) {
      if (!on) globalShortcut.unregister(accelerator);
      else {
        try {
          globalShortcut.register(accelerator, () => send(key));
        } catch { /* taken by another program: that key just doesn't turn pages */ }
      }
    }
  };
  ipcMain.handle('hw:capture', (_e, on) => {
    wanted = !!on;
    apply();
    return true;
  });
  app.on('browser-window-focus', apply);
  app.on('browser-window-blur', apply);
  app.on('will-quit', () => globalShortcut.unregisterAll());
  if (test) {
    // The test window never has the focus: it presses the keys itself.
    ipcMain.handle('test:hwKey', (_e, key) => {
      send(key);
      return true;
    });
    ipcMain.handle('test:hwCapture', () => wanted);
  }
}

module.exports = { registerHardwareKeys, KEYS };

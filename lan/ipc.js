'use strict';

// IPC for "Im WLAN teilen" / "Aus dem WLAN holen" (renderer/js/lan.js ↔ lan/*).
// Events for the page go out as 'lan:event'.
// Tests: NOTENPULT_LAN_BIND=127.0.0.1 keeps everything on this machine (no firewall prompt),
// NOTENPULT_LAN_TARGETS lists where discovery asks instead of the broadcast addresses.

const { ipcMain, app } = require('electron');
const os = require('os');
const { startHost } = require('./host');
const { discover, connect } = require('./client');
const { applyReceive, localFiles } = require('./apply');

const deviceName = () => os.hostname() || 'Windows-PC';
const failure = (err) => ({ ok: false, error: err.code || 'error', message: err.message });

function registerLan(getWin, paths) {
  const send = (e) => {
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send('lan:event', e);
  };
  const bind = process.env.NOTENPULT_LAN_BIND || '0.0.0.0';
  let host = null;
  let session = null;

  ipcMain.handle('lan:hostStart', async () => {
    if (host) host.stop();
    try {
      host = await startHost({
        paths, name: deviceName(), app: app.getVersion(), bind, onEvent: send,
      });
      return {
        ok: true, code: host.code, port: host.port, addresses: host.addresses, name: host.name,
      };
    } catch (err) {
      host = null;
      return failure(err);
    }
  });
  ipcMain.handle('lan:hostStop', () => {
    if (host) host.stop();
    host = null;
    return true;
  });

  ipcMain.handle('lan:discover', () => discover(process.env.NOTENPULT_LAN_TARGETS
    ? { targets: process.env.NOTENPULT_LAN_TARGETS.split(','), timeoutMs: 1200 }
    : {}));

  ipcMain.handle('lan:connect', async (_e, { address, port, code }) => {
    if (session) session.abort();
    session = null;
    try {
      session = await connect({
        address, port, code, name: deviceName(),
      });
      return { ok: true, manifest: await session.manifest() };
    } catch (err) {
      if (session) session.abort();
      session = null;
      return failure(err);
    }
  });
  ipcMain.handle('lan:localFiles', () => localFiles(paths.filesDir));
  ipcMain.handle('lan:download', async (_e, names) => {
    if (!session) return { ok: false, error: 'closed' };
    try {
      await session.download(names, paths.filesDir, (p) => send({ type: 'download', ...p }));
      return { ok: true };
    } catch (err) {
      session.abort();
      session = null;
      return failure(err);
    }
  });
  ipcMain.handle('lan:finish', async (_e, payload) => {
    try {
      await applyReceive(paths, payload);
      if (session) await session.close(true);
      session = null;
      return { ok: true };
    } catch (err) {
      return failure(err);
    }
  });
  ipcMain.handle('lan:cancel', async () => {
    if (session) await session.close(false);
    session = null;
    return true;
  });
}

module.exports = { registerLan };

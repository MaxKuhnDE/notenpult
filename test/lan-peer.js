// The Windows side of "Im WLAN teilen" as a counterpart for the Java tests (LanTest.java):
//   node test/lan-peer.js host <dataDir> <code>          prints "READY <port>", then "DONE <files>"
//   node test/lan-peer.js client <port> <code> <outDir>  prints "OK <pieces> <files>" or "ERROR <code>"
'use strict';

const path = require('node:path');
const { startHost } = require('../lan/host');
const { connect } = require('../lan/client');

const [mode, ...args] = process.argv.slice(2);

(async () => {
  if (mode === 'host') {
    const [dir, code] = args;
    const host = await startHost({
      paths: {
        dataDir: dir, dbFile: path.join(dir, 'notenpult.json'), filesDir: path.join(dir, 'Noten'), annDir: path.join(dir, 'Anmerkungen'),
      },
      name: 'Node-Host',
      app: 'peer',
      bind: '127.0.0.1',
      port: 0,
      discoveryPort: 0,
      codes: [code],
      onEvent: (e) => {
        if (e.type === 'wrongCode') console.log('WRONG');
        if (e.type === 'done') {
          console.log(`DONE ${e.files}`);
          host.stop();
          process.exit(0);
        }
      },
    });
    console.log(`READY ${host.port}`);
    setTimeout(() => process.exit(1), 60000);
  } else if (mode === 'client') {
    const [port, code, out] = args;
    try {
      const s = await connect({
        address: '127.0.0.1', port: Number(port), code, name: 'Node-Empfänger',
      });
      const m = await s.manifest();
      await s.download(m.files.map(([n]) => n), out);
      await s.close(true);
      console.log(`OK ${JSON.parse(m.db).pieces.length} ${m.files.length} ${s.hostName}`);
    } catch (err) {
      console.log(`ERROR ${err.code || err.message}`);
    }
    process.exit(0);
  }
})();

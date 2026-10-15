// "Aus dem WLAN holen": which library this device ends up with and which sheet files have
// to come over the network. No DOM – test/lan.node.js uses it directly.
//
//   mirror  this device becomes like the host (as with "Alles importieren")
//   add     the host's pieces join this library; same id = the host's version wins;
//           setlists likewise, genres merged by name; settings stay

const filesOf = (piece) => (Array.isArray(piece.parts) ? piece.parts : [{ pages: piece.pages || [] }])
  .flatMap((part) => (part.pages || []).map((pg) => pg.file));

/**
 * local: this device's library (the saved object); host: the manifest { db: text, ann, files };
 * localFiles: { name: size } of sheet files here.
 */
export function planReceive({
  local, host, mode, localFiles,
}) {
  const hostDb = JSON.parse(host.db);
  const hostAnn = host.ann || {};
  hostDb.pieces = hostDb.pieces || [];
  hostDb.setlists = hostDb.setlists || [];
  hostDb.genres = hostDb.genres || [];
  let db;
  let ann;
  if (mode === 'mirror') {
    db = hostDb;
    ann = { ...hostAnn };
  } else {
    db = JSON.parse(JSON.stringify(local));
    db.pieces = db.pieces || [];
    db.setlists = db.setlists || [];
    db.genres = db.genres || [];
    const pieceIds = new Set(hostDb.pieces.map((p) => p.id));
    db.pieces = db.pieces.filter((p) => !pieceIds.has(p.id)).concat(hostDb.pieces);
    const setIds = new Set(hostDb.setlists.map((s) => s.id));
    db.setlists = db.setlists.filter((s) => !setIds.has(s.id)).concat(hostDb.setlists);
    const genreNames = new Set(db.genres.map((g) => g.name.toLowerCase()));
    for (const g of hostDb.genres) {
      if (!genreNames.has(g.name.toLowerCase())) {
        db.genres.push(g);
        genreNames.add(g.name.toLowerCase());
      }
    }
    ann = {};
    for (const p of hostDb.pieces) if (hostAnn[p.id] != null) ann[p.id] = hostAnn[p.id];
  }

  const hostSizes = new Map(host.files || []);
  const needed = [...new Set(db.pieces.flatMap(filesOf))];
  // Files nobody has stay missing (the piece shows "Datei fehlt" here as there).
  const missing = needed.filter((f) => !hostSizes.has(f) && localFiles[f] === undefined);
  const keep = needed.filter((f) => !missing.includes(f));
  const download = keep.filter((f) => hostSizes.has(f) && localFiles[f] !== hostSizes.get(f));
  return {
    mode,
    db,
    ann,
    keep,
    download,
    missing,
    bytes: download.reduce((n, f) => n + hostSizes.get(f), 0),
    pieces: hostDb.pieces.length,
    setlists: hostDb.setlists.length,
  };
}

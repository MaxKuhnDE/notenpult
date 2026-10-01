import {
  backend, addPiece, commit, cleanTitle, placeImported, importOrder,
} from './store.js';
import { countPages, isPdf } from './render.js';
import { toast, choiceDialog, plural } from './ui.js';

export async function importFromPicker({ folder = false } = {}) {
  const records = await backend.pick({ folder });
  return processRecords(records);
}

export async function importDropped(files) {
  const records = await backend.importDropped(files);
  return processRecords(records);
}

/** Turns "Marsch_Seite_2" / "Marsch-p2" / "Marsch 2" into "Marsch". */
function commonTitle(records) {
  const base = records[0].name.replace(/[\s_.-]*(seite|page|s|p)?[\s_.-]*\d+$/i, '');
  return cleanTitle(base || records[0].name);
}

/** Validates freshly copied files, asks how to group images, creates pieces. Returns new piece ids. */
export async function processRecords(records) {
  if (!records?.length) return [];
  const ok = records.filter((r) => !r.error);
  const failed = records.filter((r) => r.error).map((r) => r.name);
  const pdfs = ok.filter((r) => isPdf(r.file));
  const images = ok.filter((r) => !isPdf(r.file));

  let combine = false;
  if (images.length > 1) {
    const choice = await choiceDialog({
      title: `${images.length} Bilder importieren`,
      message: 'Sind das die Seiten eines einzigen Stücks oder einzelne Stücke?',
      choices: [
        { label: 'Einzelne Stücke', value: 'single' },
        { label: 'Ein Stück (mehrseitig)', value: 'combine', kind: 'primary' },
      ],
    });
    if (choice === null) {
      await backend.deleteFiles(ok.map((r) => r.file));
      return [];
    }
    combine = choice === 'combine';
  }

  if (ok.length > 3) toast(`Importiere ${plural(ok.length, 'Datei', 'Dateien')} …`, { ms: 1800 });
  const created = []; // pieces touched (new or with a newly linked part)
  let fresh = 0;
  const linked = [];
  const place = (name, pages) => {
    const res = placeImported(name, pages);
    if (res.linked) linked.push(`„${res.part.name}“ zu ${res.piece.title}`);
    else fresh += 1;
    if (!created.includes(res.piece)) created.push(res.piece);
  };

  for (const r of pdfs.sort((a, b) => importOrder(a.name, b.name))) {
    try {
      const n = await countPages(r.file);
      if (!n) throw new Error('leer');
      place(r.name, Array.from({ length: n }, (_, i) => ({ file: r.file, page: i + 1 })));
    } catch (err) {
      console.error('Import fehlgeschlagen', r.name, err);
      failed.push(r.name);
      backend.deleteFiles([r.file]);
    }
  }

  const goodImages = [];
  for (const r of images) {
    try {
      await countPages(r.file);
      goodImages.push(r);
    } catch (err) {
      console.error('Import fehlgeschlagen', r.name, err);
      failed.push(r.name);
      backend.deleteFiles([r.file]);
    }
  }
  if (combine && goodImages.length) {
    created.push(addPiece({ title: commonTitle(goodImages), pages: goodImages.map((r) => ({ file: r.file, page: 0 })) }));
    fresh += 1;
  } else {
    for (const r of goodImages.sort((a, b) => importOrder(a.name, b.name))) place(r.name, [{ file: r.file, page: 0 }]);
  }

  if (created.length) {
    commit();
    const parts = [];
    if (fresh) parts.push(`${plural(fresh, 'Stück', 'Stücke')} importiert`);
    if (linked.length) parts.push(`${plural(linked.length, 'Stimme', 'Stimmen')} verknüpft: ${linked.slice(0, 2).join(', ')}${linked.length > 2 ? ' …' : ''}`);
    toast(parts.join(' · '), { kind: 'success', ms: linked.length ? 4500 : 2600 });
  }
  if (failed.length) {
    toast(`Nicht lesbar: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ' …' : ''}`, { kind: 'error', ms: 5000 });
  }
  return created.map((p) => p.id);
}

/** Imports files and returns page refs (for appending pages to an existing piece). */
export async function pickPages() {
  const records = (await backend.pick({ folder: false })).filter((r) => !r.error);
  const pages = [];
  const files = [];
  const names = [];
  for (const r of records) {
    try {
      const n = await countPages(r.file);
      files.push(r.file);
      names.push(r.name);
      if (isPdf(r.file)) for (let i = 1; i <= n; i++) pages.push({ file: r.file, page: i });
      else pages.push({ file: r.file, page: 0 });
    } catch {
      backend.deleteFiles([r.file]);
      toast(`Nicht lesbar: ${r.name}`, { kind: 'error' });
    }
  }
  return { pages, files, names };
}

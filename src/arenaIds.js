// Tłumaczenie numerów kart z MTG Arena (GrpId) na nazwy kart.
// Źródła: lista kart 17Lands (cards.csv) oraz lokalna baza kart zainstalowanej Areny.

const fs = require('fs');
const os = require('os');
const path = require('path');

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
const front = (s) => String(s).split(' // ')[0];

// Indeks nazw ocenianych kart. Karty dwustronne mają w 17Lands nazwę "Przód // Tył",
// a Arena podaje często samą nazwę przodu, więc indeksujemy obie postaci.
function makeNameIndex(names) {
  const idx = new Map();
  for (const n of names) idx.set(norm(n), n);
  for (const n of names) {
    const f = norm(front(n));
    if (!idx.has(f)) idx.set(f, n);
  }
  return idx;
}

function canonical(raw, idx) {
  return idx.get(norm(raw)) || idx.get(norm(front(raw))) || null;
}

// Prosty parser CSV z obsługą pól w cudzysłowach (nazwy kart zawierają przecinki).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// cards.csv z 17Lands: kolumny id (to jest GrpId z Areny), expansion, name, ...
function rowsFromCardsCsv(text) {
  const rows = parseCsv(text);
  const head = rows.shift() || [];
  const iId = head.indexOf('id');
  const iExp = head.indexOf('expansion');
  const iName = head.indexOf('name');
  const iColors = head.indexOf('color_identity');
  const iCmc = head.indexOf('mana_value');
  const iTypes = head.indexOf('types');
  if (iId < 0 || iName < 0) {
    throw new Error(`Nieoczekiwany format cards.csv, nagłówek: ${head.join(',')}`);
  }
  const get = (r, i) => (i >= 0 && r[i] != null ? r[i] : '');
  return rows
    .filter((r) => r.length > Math.max(iId, iName))
    .map((r) => ({
      id: r[iId],
      expansion: get(r, iExp),
      name: r[iName],
      colors: get(r, iColors), // np. "WU" (pusty = bezbarwna)
      cmc: Number(get(r, iCmc)) || 0,
      types: get(r, iTypes), // np. "Creature - Human Wizard"
    }));
}

// Szuka pliku z bazą kart zainstalowanej Areny (Raw_CardDatabase_*.mtga).
function findCardDb(extra) {
  const bases = [];
  if (extra) bases.push(extra);
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  bases.push(
    path.join(pf, 'Wizards of the Coast', 'MTGA'),
    path.join(pf86, 'Wizards of the Coast', 'MTGA'),
    path.join(pf86, 'Steam', 'steamapps', 'common', 'MTGA'),
    path.join(pf, 'Steam', 'steamapps', 'common', 'MTGA')
  );
  const found = [];
  for (const b of bases) {
    if (/\.mtga$/i.test(b) && fs.existsSync(b)) {
      found.push(b);
      continue;
    }
    for (const d of [b, path.join(b, 'Downloads', 'Raw'), path.join(b, 'MTGA_Data', 'Downloads', 'Raw')]) {
      try {
        for (const f of fs.readdirSync(d)) {
          if (/^Raw_CardDatabase_.*\.mtga$/i.test(f)) found.push(path.join(d, f));
        }
      } catch {
        // folder nie istnieje, idziemy dalej
      }
    }
  }
  found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return found[0] || null;
}

const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const pick = (cols, options) => options.find((o) => cols.includes(o)) || null;

// Czyta z bazy Areny wszystkie karty: [{ id, name, expansion }].
// Struktura bazy bywa zmieniana, więc nazwy tabel i kolumn są wykrywane, a przy
// niepowodzeniu błąd zawiera opis tego, co znaleziono.
function readCardDb(file) {
  let sqlite;
  try {
    sqlite = require('node:sqlite');
  } catch {
    throw new Error('Ta wersja Node nie ma modułu node:sqlite (potrzebny Node 22.13+ lub 24).');
  }
  const tmp = path.join(os.tmpdir(), `mtga-carddb-${process.pid}-${Date.now()}.sqlite`);
  fs.copyFileSync(file, tmp); // kopia, żeby nie ruszać pliku używanego przez grę
  let db;
  try {
    db = new sqlite.DatabaseSync(tmp, { readOnly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    const colsOf = (t) => db.prepare(`PRAGMA table_info(${q(t)})`).all().map((r) => r.name);

    const cardsTable = tables.find((t) => t === 'Cards');
    const locTable =
      tables.find((t) => t === 'Localizations_enUS') ||
      tables.find((t) => /^Localizations.*en/i.test(t)) ||
      tables.find((t) => t === 'Localizations');
    const cardCols = cardsTable ? colsOf(cardsTable) : [];
    const locCols = locTable ? colsOf(locTable) : [];

    const idCol = pick(cardCols, ['GrpId', 'GrpID', 'grpId', 'Id']);
    const titleCol = pick(cardCols, ['TitleId', 'TitleID']);
    const expCol = pick(cardCols, ['ExpansionCode', 'Expansion']);
    const locIdCol = pick(locCols, ['LocId', 'LocID', 'Id']);
    const textCol = pick(locCols, ['Loc', 'enUS', 'Text', 'Value']);
    const langCol = pick(locCols, ['Language', 'Lang']);

    if (!cardsTable || !locTable || !idCol || !titleCol || !locIdCol || !textCol) {
      throw new Error(
        'Nie rozpoznano struktury bazy kart Areny. ' +
          `Tabele: ${tables.join(', ')}. Cards: ${cardCols.join(', ')}. Localizations: ${locCols.join(', ')}.`
      );
    }

    const sql =
      `SELECT c.${q(idCol)} AS id, l.${q(textCol)} AS name` +
      (expCol ? `, c.${q(expCol)} AS expansion` : '') +
      ` FROM ${q(cardsTable)} c JOIN ${q(locTable)} l ON l.${q(locIdCol)} = c.${q(titleCol)}` +
      (langCol ? ` WHERE l.${q(langCol)} = 'enUS'` : '');
    return db
      .prepare(sql)
      .all()
      .filter((r) => r.name)
      .map((r) => ({
        id: String(r.id),
        name: String(r.name).replace(/<[^>]*>/g, '').trim(),
        expansion: r.expansion ? String(r.expansion) : '',
      }));
  } finally {
    try {
      if (db) db.close();
    } catch {
      // ignorujemy
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignorujemy
    }
  }
}

module.exports = { makeNameIndex, canonical, parseCsv, rowsFromCardsCsv, findCardDb, readCardDb };

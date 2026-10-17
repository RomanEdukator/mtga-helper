// Użycie:  node scripts/build-ratings.js <KOD_SETU> [format] [folder_MTGA]
// np.:     node scripts/build-ratings.js FRA QuickDraft
//
// Pobiera oceny kart z 17Lands, a numery kart z Areny zamienia na nazwy z kilku źródeł
// (po kolei, aż większość kart będzie rozpoznana):
//   1) lista kart 17Lands (cards.csv),
//   2) baza kart zainstalowanej MTG Areny (folder można podać jako 3. argument),
//   3) Scryfall.
// Wynik trafia do data/<SET>.json. Wymaga Node 18+ (wbudowany fetch).
//
// UWAGA: adresy 17Lands nie są oficjalnym API i mogą się zmienić.
// Dane 17Lands mają własne warunki użycia (m.in. wymóg podania źródła), sprawdź je.

const fs = require('fs');
const path = require('path');
const { buildScores } = require('../src/scoring');
const { makeNameIndex, canonical, rowsFromCardsCsv, findCardDb, readCardDb } = require('../src/arenaIds');

const set = (process.argv[2] || '').toUpperCase();
const format = process.argv[3] || 'PremierDraft';
const mtgaDirArg = process.argv[4];
if (!set) {
  console.error('Podaj kod setu, np.: node scripts/build-ratings.js FRA QuickDraft');
  process.exit(1);
}

const HEADERS = { 'User-Agent': 'mtga-helper/0.1', Accept: '*/*' };

async function get(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} dla ${url}`);
  return res;
}
const getJson = async (url) => (await get(url)).json();
const getText = async (url) => (await get(url)).text();

async function fetchScryfallCards(setCode) {
  const out = [];
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`e:${setCode} game:arena`)}&unique=cards`;
  while (url) {
    const page = await getJson(url);
    for (const card of page.data) if (card.arena_id) out.push({ id: card.arena_id, name: card.name });
    url = page.has_more ? page.next_page : null;
    await new Promise((r) => setTimeout(r, 120)); // grzecznie wobec Scryfall
  }
  return out;
}

async function main() {
  console.log(`Pobieram oceny 17Lands dla ${set} (${format})...`);
  const ratings = await getJson(`https://www.17lands.com/card_ratings/data?expansion=${set}&format=${format}`);
  const cards = ratings
    .map((r) => ({ name: r.name, gih: r.ever_drawn_win_rate, alsa: r.avg_seen }))
    .filter((c) => typeof c.gih === 'number');
  if (cards.length === 0) {
    console.error('17Lands nie zwróciło ocen dla tego setu i formatu. Spróbuj innego formatu (np. PremierDraft).');
    process.exit(2);
  }
  console.log(`Ocenionych kart: ${cards.length}`);

  const names = cards.map((c) => c.name);
  const idx = makeNameIndex(names);
  const arena = {};
  const meta = {}; // nazwa karty -> { colors, cmc, types }
  const covered = new Set();
  const coverage = () => covered.size / names.length;
  const enough = () => coverage() >= 0.95;

  // Dodaje numer -> nazwa. Karty z ocenami dostają nazwę z 17Lands (żeby pasowała do ocen).
  // Karty z naszego setu bez ocen (np. ziemie podstawowe) dostają nazwę źródłową, więc
  // panel pokaże je z nazwą i bez oceny.
  function add(id, rawName, inSet) {
    const key = String(id);
    if (!/^\d+$/.test(key)) return 0;
    const canon = canonical(rawName, idx);
    if (canon) {
      arena[key] = canon;
      covered.add(canon);
      return 1;
    }
    if (inSet) {
      arena[key] = rawName;
      return 1;
    }
    return 0;
  }

  // 1) Lista kart 17Lands
  try {
    console.log('Źródło 1: lista kart 17Lands...');
    const text = await getText('https://17lands-public.s3.amazonaws.com/analysis_data/cards/cards.csv');
    let n = 0;
    for (const r of rowsFromCardsCsv(text)) {
      n += add(r.id, r.name, r.expansion.toUpperCase() === set);
      // Kolory, koszt i typ potrzebne później do budowy talii (tylko karty z ocenami).
      // Zapisujemy też karty z naszego setu bez oceny (pod nazwą z Areny), bo mogą być w puli.
      const key = canonical(r.name, idx) || (r.expansion.toUpperCase() === set ? r.name : null);
      if (key && !meta[key]) {
        meta[key] = { colors: r.colors.replace(/[^WUBRG]/g, ''), cmc: r.cmc, types: r.types };
      }
    }
    console.log(`  dodano numerów: ${n}`);
  } catch (e) {
    console.log(`  pominięto: ${e.message}`);
  }

  // 2) Baza kart zainstalowanej Areny
  if (!enough()) {
    try {
      console.log('Źródło 2: baza kart zainstalowanej MTG Areny...');
      const file = findCardDb(mtgaDirArg);
      if (!file) {
        throw new Error('nie znaleziono pliku Raw_CardDatabase_*.mtga (podaj folder MTGA jako 3. argument)');
      }
      console.log(`  plik: ${file}`);
      let n = 0;
      for (const r of readCardDb(file)) n += add(r.id, r.name, r.expansion.toUpperCase() === set);
      console.log(`  dodano numerów: ${n}`);
    } catch (e) {
      console.log(`  pominięto: ${e.message}`);
    }
  }

  // 3) Scryfall
  if (!enough()) {
    try {
      console.log('Źródło 3: Scryfall...');
      let n = 0;
      for (const r of await fetchScryfallCards(set)) n += add(r.id, r.name, true);
      console.log(`  dodano numerów: ${n}`);
    } catch (e) {
      console.log(`  pominięto: ${e.message}`);
    }
  }

  console.log(`\nKart z ocenami, którym przypisano numer Areny: ${covered.size} z ${names.length}`);
  console.log(`Wszystkich numerów w pliku: ${Object.keys(arena).length}`);
  if (Object.keys(arena).length === 0) {
    console.error('\nNie udało się ustalić numerów kart z żadnego źródła, więc nie zapisuję pliku.');
    console.error('Skopiuj cały ten wynik i wklej go do rozmowy.');
    process.exit(3);
  }
  if (covered.size === 0) {
    console.error('\nUWAGA: żadna karta z ocenami nie została dopasowana. Panel pokaże nazwy bez ocen.');
  }
  const metaCount = names.filter((n) => meta[n]).length;
  console.log(`Kart z kolorami i kosztem (do budowy talii): ${metaCount} z ${names.length}`);
  if (metaCount < names.length) {
    console.log('  UWAGA: dla części kart brakuje kolorów i kosztu, więc talie będą mniej dokładne.');
  }

  const out = {
    set,
    format,
    generatedAt: new Date().toISOString(),
    source: 'Dane: 17Lands (17lands.com); numery kart: 17Lands, MTG Arena, Scryfall',
    cards: buildScores(cards),
    arena,
    meta,
  };

  const dir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${set}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`Zapisano ${Object.keys(out.cards).length} ocen i ${Object.keys(arena).length} numerów kart do ${file}`);
}

main().catch((e) => {
  console.error('Błąd:', e.message);
  process.exit(1);
});

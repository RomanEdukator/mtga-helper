// Użycie:  node scripts/build-decks.js
//
// Czyta Twoją pulę (data/pool.json) i oceny (data/<SET>.json, set z config.json),
// buduje trzy warianty talii z szacunkiem win rate, wypisuje je w terminalu
// i zapisuje listy do wklejenia w Arenie w folderze data/decks/.
//
// Szacunek win rate jest ORIENTACYJNY (heurystyka na podstawie ocen kart), zob. src/deckBuilder.js.

const fs = require('fs');
const path = require('path');
const { rescore } = require('../src/scoring');
const { buildVariants } = require('../src/deckBuilder');

const ROOT = path.join(__dirname, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

let config = {};
try {
  config = readJson(path.join(ROOT, 'config.json'));
} catch {
  // brak config.json: komunikat niżej
}
const set = config.set;
if (!set) {
  console.error('Ustaw "set" w config.json (np. {"set":"FRA"}).');
  process.exit(1);
}

let ratings;
try {
  ratings = readJson(path.join(ROOT, 'data', `${set}.json`));
  ratings.cards = rescore(ratings.cards);
} catch {
  console.error(`Brak pliku data\\${set}.json. Uruchom: npm run ratings -- ${set} PremierDraft`);
  process.exit(1);
}
if (!ratings.meta || Object.keys(ratings.meta).length === 0) {
  console.error('W pliku z ocenami brakuje kolorów i kosztów kart. Uruchom ponownie: npm run ratings -- ' + set + ' PremierDraft');
  process.exit(1);
}

let pool;
try {
  pool = readJson(path.join(ROOT, 'data', 'pool.json'));
} catch {
  console.error('Brak pliku data\\pool.json. Zrób kilka picków w drafcie z włączoną nakładką.');
  process.exit(1);
}
if (pool.set && pool.set !== set) {
  console.log(`UWAGA: pula jest z setu ${pool.set}, a w config.json ustawiono ${set}.`);
}

const names = [];
let noName = 0;
for (const id of pool.cards || []) {
  const n = ratings.arena[id];
  if (n) names.push(n);
  else noName++;
}
console.log(`Pula: ${(pool.cards || []).length} kart (${names.length} rozpoznanych${noName ? `, ${noName} bez nazwy` : ''}).`);
if (names.length < 23) {
  console.log('Pula jest jeszcze mała (mniej niż 23 karty). Talie będą niepełne.');
}
if (names.length === 0) process.exit(0);

const pct = (x) => `${(x * 100).toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const num1 = (x) => x.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const variants = buildVariants(names, ratings);
const outDir = path.join(ROOT, 'data', 'decks');
fs.mkdirSync(outDir, { recursive: true });

variants.forEach((v, i) => {
  const d = v.deck;
  console.log(`\n=== Talia ${i + 1}: ${v.label} (${v.colorsPl}, ${v.pair}) ===`);
  if (v.estimate) {
    const e = v.estimate;
    console.log(
      `Szacowany win rate: ok. ${pct(e.winRate)} (±${e.uncertaintyPp} pp, orientacyjnie; wiarygodność: ${e.reliability})`
    );
    console.log(`  przewaga kart nad przeciętną w secie: ${e.deltaPp >= 0 ? '+' : ''}${num1(e.deltaPp)} pp`);
  } else {
    console.log('Szacowany win rate: brak (talia niepełna).');
  }
  const basics = Object.entries(d.basics).map(([c, n]) => `${c} ${n}`).join(', ');
  console.log(`Styl: ${v.style} (średni koszt ${num1(v.avgCmc)})`);
  console.log(
    `Stworzeń: ${d.totals.creatures}, czarów: ${d.totals.spells}, ziem: ${d.totals.lands} (podstawowe: ${basics}` +
      `${d.nonbasicLands.length ? `; nie-podstawowe: ${d.nonbasicLands.join(', ')}` : ''})`
  );
  console.log(`Krzywa many (0,1,2,3,4,5,6+): ${d.curve.join(' / ')}`);
  const sorted = [...d.spells].sort((a, b) => a.cmc - b.cmc || b.score - a.score);
  for (const c of sorted) {
    console.log(`  ${String(c.cmc).padStart(2)}  ${num1(c.score).padStart(4)}  ${c.name}${c.unrated ? '  (bez oceny)' : ''}`);
  }
  for (const w of d.warnings) console.log(`  ! ${w}`);
  const file = path.join(outDir, `talia-${i + 1}-${v.pair}.txt`);
  fs.writeFileSync(file, v.arenaText + '\n');
  console.log(`Lista do Areny (Import): ${file}`);
});

if (variants.length === 0) console.log('Nie udało się zbudować żadnej talii.');
else {
  console.log(
    '\nSzacunek win rate to heurystyka z ocen kart (nie uwzględnia synergii ani krzywej) i zakłada, że typowy gracz wygrywa ok. 54%.'
  );
}

// Budowanie talii (40 kart) z puli draftu.
//
// Dane wejściowe: nazwy kart z puli (z powtórzeniami) oraz plik ocen data/<SET>.json
// z polami `cards` (oceny) i `meta` (kolory, koszt many, typ).
//
// UWAGA: to prosty algorytm zachłanny, a nie wynik symulacji gier. Wybiera najlepiej
// oceniane karty w danej parze kolorów i pilnuje podstawowej struktury talii
// (liczba stworzeń, tanie karty, ograniczona liczba drogich kart).

const COLORS = 'WUBRG';
const BASIC_NAME = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

const DEFAULTS = {
  size: 40, // rozmiar talii
  lands: 17, // liczba ziem (razem z ziemiami nie-podstawowymi)
  minCreatures: 13, // minimum stworzeń
  minCheap: 5, // minimum kart o koszcie 2 lub mniej
  maxTop: 4, // maksimum kart o koszcie 5 lub więcej
  maxNonbasic: 3, // maksimum ziem nie-podstawowych z puli
  unratedScore: 3, // ocena karty bez danych z 17Lands (średnia)
};

const isLand = (t) => /\bLand\b/.test(t || '');
const isCreature = (t) => /\bCreature\b/.test(t || '');
const isBasic = (t) => /\bBasic\b/.test(t || '');

// Informacje o karcie albo null, jeśli nie znamy jej kolorów i typu.
function infoFor(name, data, o) {
  const meta = data.meta && data.meta[name];
  if (!meta) return null;
  const r = data.cards && data.cards[name];
  const types = meta.types || '';
  return {
    name,
    colors: meta.colors || '',
    cmc: Number(meta.cmc) || 0,
    types,
    land: isLand(types),
    creature: isCreature(types),
    basic: isBasic(types) || Object.values(BASIC_NAME).includes(name),
    score: r && typeof r.score === 'number' ? r.score : o.unratedScore,
    gih: r && typeof r.gih === 'number' ? r.gih : null,
    unrated: !r,
  };
}

// Karta pasuje do pary kolorów, jeśli wszystkie jej kolory są w parze (bezbarwne pasują zawsze).
const fits = (info, pair) => [...info.colors].every((c) => pair.includes(c));

// Rozdziela `total` podstawowych ziem według wag kolorów (metoda największych reszt).
function splitBasics(total, weights, pair) {
  const colors = [...pair];
  const out = Object.fromEntries(colors.map((c) => [c, 0]));
  if (total <= 0 || colors.length === 0) return out;
  const sum = colors.reduce((s, c) => s + (weights[c] || 0), 0);
  const w = colors.map((c) => (sum > 0 ? (weights[c] || 0) / sum : 1 / colors.length));
  const raw = w.map((x) => x * total);
  colors.forEach((c, i) => (out[c] = Math.floor(raw[i])));
  let left = total - colors.reduce((s, c) => s + out[c], 0);
  const order = colors.map((c, i) => [c, raw[i] - Math.floor(raw[i])]).sort((a, b) => b[1] - a[1]);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) out[order[i][0]]++;
  // Przy dwóch kolorach, które mają karty, każdy dostaje co najmniej 5 ziem (jeśli starcza).
  const active = colors.filter((c) => (weights[c] || 0) > 0);
  if (active.length === 2 && total >= 10) {
    for (const c of active) {
      while (out[c] < 5) {
        const other = active.find((x) => x !== c);
        out[other]--;
        out[c]++;
      }
    }
  }
  return out;
}

// Buduje jedną talię w danej parze kolorów (np. "WU"). Zwraca obiekt z opisem talii.
function buildDeck(poolNames, data, pair, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const warnings = [];
  let unknown = 0;
  const infos = [];
  for (const name of poolNames) {
    const info = infoFor(name, data, o);
    if (!info) {
      unknown++;
      continue;
    }
    if (!info.basic) infos.push(info);
  }

  const byQuality = (a, b) => b.score - a.score || (b.gih ?? 0) - (a.gih ?? 0) || a.name.localeCompare(b.name);
  const rest = infos.filter((i) => !i.land && fits(i, pair)).sort(byQuality);
  const nonbasic = infos
    .filter((i) => i.land && i.colors && fits(i, pair))
    .sort(byQuality)
    .slice(0, o.maxNonbasic);

  const spellSlots = o.size - o.lands;
  const chosen = [];
  const reqs = [
    { test: (i) => i.creature, min: o.minCreatures },
    { test: (i) => i.cmc <= 2, min: o.minCheap },
  ];
  const topCount = () => chosen.filter((i) => i.cmc >= 5).length;

  while (chosen.length < spellSlots && rest.length) {
    const remaining = spellSlots - chosen.length;
    let pool = rest;
    // Jeśli brakuje już tylko tylu miejsc, ile potrzeba do spełnienia wymogu, wybieramy z jego puli.
    for (const rq of reqs) {
      const need = Math.max(0, rq.min - chosen.filter(rq.test).length);
      if (need >= remaining) {
        const forced = rest.filter(rq.test);
        if (forced.length) {
          pool = forced;
          break;
        }
      }
    }
    let cand = pool.filter((i) => !(i.cmc >= 5 && topCount() >= o.maxTop));
    if (cand.length === 0) cand = pool;
    const pick = cand[0];
    chosen.push(pick);
    rest.splice(rest.indexOf(pick), 1);
  }

  const short = spellSlots - chosen.length;
  if (short > 0) {
    warnings.push(`Za mało kart w tych kolorach: brakuje ${short} do pełnych ${o.size} (dobierz dowolne karty albo zmień kolory).`);
  }
  const creatures = chosen.filter((i) => i.creature).length;
  if (creatures < o.minCreatures) warnings.push(`Tylko ${creatures} stworzeń w talii (zalecane ${o.minCreatures}+).`);

  // Wagi kolorów: każda karta wnosi 1, dzielone między jej kolory.
  const weights = {};
  for (const c of chosen) {
    const cs = [...c.colors].filter((x) => pair.includes(x));
    for (const col of cs) weights[col] = (weights[col] || 0) + 1 / cs.length;
  }
  const basicsCount = Math.max(0, o.lands - nonbasic.length);
  const basics = splitBasics(basicsCount, weights, pair);

  const curve = Array(7).fill(0); // 0..5 oraz 6+
  for (const c of chosen) curve[Math.min(6, c.cmc)]++;
  const rated = chosen.filter((c) => c.gih != null);
  const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const unrated = chosen.filter((c) => c.unrated).length;
  if (unrated > 0) warnings.push(`${unrated} kart bez oceny z 17Lands (liczone jako średnie, ${o.unratedScore}).`);
  if (unknown > 0) warnings.push(`${unknown} kart z puli bez danych o kolorach (pominięte).`);

  return {
    pair,
    spells: chosen.map((c) => ({
      name: c.name,
      score: c.score,
      gih: c.gih,
      cmc: c.cmc,
      colors: c.colors,
      creature: c.creature,
      unrated: c.unrated,
    })),
    nonbasicLands: nonbasic.map((l) => l.name),
    basics,
    totals: {
      spells: chosen.length,
      lands: basicsCount + nonbasic.length,
      creatures,
      deckSize: chosen.length + basicsCount + nonbasic.length,
      short: Math.max(0, short),
    },
    curve,
    avgScore: avg(chosen.map((c) => c.score)),
    avgGih: avg(rated.map((c) => c.gih)),
    unratedCount: unrated,
    unknownCount: unknown,
    warnings,
  };
}

// Wszystkie 10 par kolorów, od najsilniejszej. Siła = średnia ocena kart w talii,
// a brakujące karty liczą się jako 1,5, więc pary z małą liczbą kart przegrywają.
const PAIRS = [];
for (let i = 0; i < COLORS.length; i++) for (let j = i + 1; j < COLORS.length; j++) PAIRS.push(COLORS[i] + COLORS[j]);

function bestPairs(poolNames, data, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const spellSlots = o.size - o.lands;
  return PAIRS.map((pair) => {
    const deck = buildDeck(poolNames, data, pair, opts);
    const total = deck.spells.reduce((s, c) => s + c.score, 0) + deck.totals.short * 1.5;
    return { pair, strength: total / spellSlots, deck };
  }).sort((a, b) => b.strength - a.strength);
}

// Lista do wklejenia w Arenie (Import): "4 Nazwa karty" w każdej linii.
function toArenaText(deck) {
  const counts = new Map();
  for (const c of deck.spells) counts.set(c.name, (counts.get(c.name) || 0) + 1);
  for (const n of deck.nonbasicLands) counts.set(n, (counts.get(n) || 0) + 1);
  for (const [col, n] of Object.entries(deck.basics)) if (n > 0) counts.set(BASIC_NAME[col], n);
  return [...counts.entries()].map(([n, k]) => `${k} ${n}`).join('\n');
}

// --- Szacunek win rate i warianty talii ---

const COLOR_PL = { W: 'Biała', U: 'Niebieska', B: 'Czarna', R: 'Czerwona', G: 'Zielona' };
const colorNamesPl = (pair) => [...pair].map((c) => COLOR_PL[c]).join('-');

function setMeanGih(data) {
  const v = Object.values(data.cards || {})
    .map((c) => c.gih)
    .filter((x) => typeof x === 'number');
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

// Orientacyjny szacunek win rate talii z win rate kart (GIH WR z 17Lands).
//   szacunek = baseline + shrink * (średni GIH kart w talii - średni GIH w secie)
// To heurystyka, a nie model skalibrowany na prawdziwych grach:
//  - baseline (domyślnie 54%) to ZAŁOŻENIE o typowym graczu 17Lands, nie zmierzona wartość,
//  - shrink (0,6) osłabia różnice, bo GIH WR karty jest częściowo zawyżony przez to, że
//    karty trafiają do mocnych talii,
//  - nie uwzględnia synergii, krzywej many ani umiejętności gracza.
// Karty bez oceny liczą się jako średnia setu (nie zmieniają wyniku).
function estimateWinRate(deck, data, opts = {}) {
  const baseline = opts.baseline ?? 0.54;
  const shrink = opts.shrink ?? 0.6;
  const mean = setMeanGih(data);
  if (mean == null || deck.totals.short > 0 || deck.spells.length === 0) return null;
  const avg = deck.spells.reduce((s, c) => s + (c.gih ?? mean), 0) / deck.spells.length;
  const delta = avg - mean;
  const winRate = Math.min(0.75, Math.max(0.4, baseline + shrink * delta));
  const unratedShare = deck.unratedCount / deck.spells.length;
  return {
    winRate,
    deltaPp: delta * 100, // przewaga nad przeciętną kartą w secie, w punktach procentowych
    setMean: mean,
    baseline,
    shrink,
    uncertaintyPp: 3, // orientacyjny margines, nie przedział ufności
    reliability: unratedShare > 0.25 ? 'niska' : unratedShare > 0.1 ? 'średnia' : 'przyzwoita',
  };
}

function describeStyle(avgCmc) {
  if (avgCmc <= 2.6) return 'szybka, niska krzywa';
  if (avgCmc <= 3.2) return 'zrównoważona';
  return 'powolna, droższe karty';
}

// Trzy warianty: trzy najsilniejsze różne pary kolorów (preferujemy pełne talie).
function buildVariants(poolNames, data, opts = {}) {
  const ranked = bestPairs(poolNames, data, opts);
  const complete = ranked.filter((r) => r.deck.totals.short === 0);
  const picked = (complete.length >= 3 ? complete : ranked).slice(0, 3);
  const labels = ['Najsilniejsza', 'Alternatywa', 'Trzecia opcja'];
  return picked.map((r, i) => {
    const deck = r.deck;
    const avgCmc = deck.spells.length ? deck.spells.reduce((s, c) => s + c.cmc, 0) / deck.spells.length : 0;
    return {
      label: labels[i],
      pair: r.pair,
      colorsPl: colorNamesPl(r.pair),
      strength: r.strength,
      avgCmc,
      style: describeStyle(avgCmc),
      estimate: estimateWinRate(deck, data, opts),
      deck,
      arenaText: toArenaText(deck),
    };
  });
}

module.exports = {
  buildDeck,
  bestPairs,
  buildVariants,
  estimateWinRate,
  colorNamesPl,
  toArenaText,
  splitBasics,
  PAIRS,
  DEFAULTS,
};

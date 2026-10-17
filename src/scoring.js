// Zamiana win rate (GIH WR z 17Lands) na ciągłą skalę ocen 1,00-5,00.
//
// 3,0 odpowiada średniej karcie w secie, a każde odchylenie standardowe win rate
// to 1 punkt oceny. Wyniki są obcinane do zakresu 1-5, więc 5,0 dostają karty
// o co najmniej dwa odchylenia lepsze od średniej, a 1,0 te o dwa gorsze.
// W przeciwieństwie do poprzedniej skali (całkowite 1-5 według percentyli) różnica
// między kartą 60% a 62% jest widoczna, a nie spłaszczona do jednej oceny.

const CENTER = 3;
const PER_SD = 1;

function toScore(gih, mean, sd) {
  if (!sd) return CENTER;
  const raw = CENTER + (PER_SD * (gih - mean)) / sd;
  return Math.min(5, Math.max(1, raw));
}

const round2 = (x) => Math.round(x * 100) / 100;

// cards: [{ name, gih, alsa }] gdzie gih to ułamek (np. 0.58).
// Zwraca mapę name -> { score, gih, alsa }.
function buildScores(cards) {
  const rated = cards.filter((c) => typeof c.gih === 'number' && !Number.isNaN(c.gih));
  const n = rated.length;
  const out = {};
  if (n === 0) return out;
  const mean = rated.reduce((s, c) => s + c.gih, 0) / n;
  const variance = rated.reduce((s, c) => s + (c.gih - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  for (const c of rated) {
    out[c.name] = { score: round2(toScore(c.gih, mean, sd)), gih: c.gih, alsa: c.alsa ?? null };
  }
  return out;
}

// Przelicza oceny od nowa z samych win rate (gih) w mapie name -> { gih, alsa, ... }.
// Dzięki temu starsze pliki data/<SET>.json (z ocenami całkowitymi 1-5) też dają oceny
// ułamkowe i nie trzeba ich pobierać ponownie.
function rescore(cardsMap) {
  const list = Object.entries(cardsMap).map(([name, c]) => ({ name, gih: c.gih, alsa: c.alsa }));
  const fresh = buildScores(list);
  const out = {};
  for (const [name, c] of Object.entries(cardsMap)) {
    out[name] = fresh[name] ? { ...c, score: fresh[name].score } : c;
  }
  return out;
}

module.exports = { buildScores, toScore, rescore };

// Wyciąganie aktualnego packa z linii Player.log.
// UWAGA: formaty zdarzeń draftu bywają zmieniane przez Wizards. Poniższe wzorce
// obejmują dwa znane warianty i trzeba je zweryfikować na prawdziwym logu.
//  - Premier/Traditional draft:  "PackCards":"91234,91235,..."  (zdarzenie Draft.Notify)
//  - Quick draft (boty):         "DraftPack":["91234","91235",...]  (BotDraft_DraftStatus)

const RE_PACK_CARDS = /"PackCards"\s*:\s*"([\d,]+)"/;
const RE_DRAFT_PACK = /"DraftPack"\s*:\s*\[([^\]]*)\]/;
const RE_SELF_PICK = /"SelfPick"\s*:\s*(\d+)/;
const RE_SELF_PACK = /"SelfPack"\s*:\s*(\d+)/;
const RE_PICK_NUMBER = /"PickNumber"\s*:\s*(\d+)/;
const RE_PACK_NUMBER = /"PackNumber"\s*:\s*(\d+)/;

function num(re, line) {
  const m = line.match(re);
  return m ? Number(m[1]) : null;
}

// W Quick Draftach dane packa bywają zapisane jako tekst wewnątrz tekstu (JSON w JSON),
// czyli z cudzysłowami zapisanymi jako \" (czasem nawet \\\"). Zamieniamy je na zwykłe ".
function unescapeQuotes(line) {
  return line.replace(/\\+"/g, '"');
}

// Czy linia wygląda na zdarzenie draftu z packiem (nawet jeśli nie umiemy jej odczytać).
const RE_LOOKS_LIKE_PACK = /(PackCards|DraftPack|BotDraft_DraftStatus|Draft\.Notify)/;
function looksLikePackEvent(line) {
  return RE_LOOKS_LIKE_PACK.test(line);
}

// Zwraca { pack: [arenaId,...], pick, packNumber } albo null.
function parsePackLine(rawLine) {
  const line = unescapeQuotes(rawLine);
  let ids = null;
  let m = line.match(RE_PACK_CARDS);
  if (m) {
    ids = m[1].split(',').filter(Boolean).map(Number);
  } else {
    m = line.match(RE_DRAFT_PACK);
    if (m) {
      ids = m[1].split(',').map((s) => s.replace(/["\s]/g, '')).filter(Boolean).map(Number);
    }
  }
  if (!ids || ids.length === 0) return null;
  const pick = num(RE_SELF_PICK, line) ?? num(RE_PICK_NUMBER, line);
  const packNumber = num(RE_SELF_PACK, line) ?? num(RE_PACK_NUMBER, line);
  return { pack: ids, pick, packNumber };
}

// Przechodzi po tekście i zwraca ostatni znaleziony pak (albo null).
function lastPackInText(text) {
  let last = null;
  for (const line of text.split(/\r?\n/)) {
    const p = parsePackLine(line);
    if (p) last = p;
  }
  return last;
}

// --- Wybory kart (pula) ---
// UWAGA: formaty poniżej pochodzą z mojej pamięci i nie były sprawdzone na prawdziwym logu.
//  1) Status draftu zawiera pełną listę dotychczasowych wyborów:  "PickedCards":["106411",...]
//     To źródło jest najpewniejsze: samo się naprawia po restarcie nakładki.
//  2) Zdarzenie wyboru (Quick Draft: BotDraft_DraftPick, Premier: MakeHumanDraftPick / MakePick)
//     z numerem karty w polu "CardId", "CardIds":[...] albo "GrpId".
const RE_PICKED = /"PickedCards"\s*:\s*\[([^\]]*)\]/;
const RE_PICK_EVENT = /(MakeHumanDraftPick|DraftMakePick|BotDraft_DraftPick|MakePick)/;
const RE_CARD_IDS = /"CardIds"\s*:\s*\[\s*"?(\d+)"?/;
const RE_CARD_ID = /"(?:GrpId|CardId)"\s*:\s*"?(\d+)"?/;
const RE_PICK_NUM = /"(?:PickNumber|Pick)"\s*:\s*(\d+)/;
const RE_PACK_NUM = /"(?:PackNumber|Pack)"\s*:\s*(\d+)/;

function idsFromList(s) {
  return s
    .split(',')
    .map((x) => x.replace(/["\s]/g, ''))
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
}

// Zwraca:
//   { type: 'picked', cards: [id,...], packNumber, pickNumber }   pełna lista wyborów
//   { type: 'pick', card: id, pack, pick }                         pojedynczy wybór
//   null
function parsePickLine(rawLine) {
  const line = unescapeQuotes(rawLine);
  const m = line.match(RE_PICKED);
  if (m && /(DraftPack|DraftStatus)/.test(line)) {
    return {
      type: 'picked',
      cards: idsFromList(m[1]),
      packNumber: num(RE_PACK_NUM, line),
      pickNumber: num(RE_PICK_NUM, line),
    };
  }
  if (!m && RE_PICK_EVENT.test(line)) {
    const card = num(RE_CARD_IDS, line) ?? num(RE_CARD_ID, line);
    if (card) return { type: 'pick', card, pack: num(RE_PACK_NUM, line), pick: num(RE_PICK_NUM, line) };
  }
  return null;
}

// Ostatnia pełna lista wyborów w tekście (albo null).
function lastPicksInText(text) {
  let last = null;
  for (const line of text.split(/\r?\n/)) {
    const p = parsePickLine(line);
    if (p && p.type === 'picked') last = p;
  }
  return last;
}

module.exports = { parsePackLine, lastPackInText, looksLikePackEvent, parsePickLine, lastPicksInText };

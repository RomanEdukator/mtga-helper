// Diagnostyka logu MTG Arena.
// Użycie:  node scripts/scan-log.js            (domyślna ścieżka do Player.log)
//          node scripts/scan-log.js "C:\\ścieżka\\do\\Player.log"
//
// Skrypt przeszukuje log pod kątem zdarzeń draftu i zapisuje krótki, ocenzurowany
// fragment do pliku log-sample.txt w folderze projektu. Ten plik można wkleić do rozmowy.
// Nic nie jest wysyłane nigdzie automatycznie.

const fs = require('fs');
const path = require('path');
const { defaultLogPath } = require('../src/logWatcher');
const { parsePackLine, parsePickLine } = require('../src/logParser');

const logPath = process.argv[2] || defaultLogPath();
const MAX_SAMPLES = 12;
const MAX_LINE = 700;

// Pola, które mogą zawierać dane konta. Wartości są zamazywane.
const SENSITIVE_KEYS =
  /"(playerId|player_id|playerName|screenName|userId|accountId|displayName|clientId|sessionId|token|accessToken|refreshToken|email|userName|username|requestId|transactionId)"\s*:\s*"[^"]*"/gi;
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
// Nazwa gracza w formacie Nazwa#12345 gdziekolwiek w linii.
// Nazwa może zawierać spacje, więc zamazujemy też do dwóch słów przed znakiem #.
const PLAYER_TAG = /(?:[^\s"\\,:{}[\]]+ ){0,2}[^\s"\\,:{}[\]]+#\d{3,6}/g;

function sanitize(line) {
  // Dane packa i statusu bywają zapisane jako tekst wewnątrz tekstu (\"klucz\":\"wartość\").
  // Najpierw zamieniamy \" na ", żeby zamazywanie działało tak samo w obu zapisach.
  const plain = line.replace(/\\+"/g, '"');
  let out = plain
    .replace(SENSITIVE_KEYS, (m) => m.replace(/:\s*"[^"]*"/, ':"<usunięto>"'))
    .replace(PLAYER_TAG, '<gracz>')
    .replace(EMAIL, '<email>')
    .replace(GUID, '<guid>');
  if (out.length > MAX_LINE) out = out.slice(0, MAX_LINE) + ' ...[ucięto]';
  return out;
}

if (!fs.existsSync(logPath)) {
  console.error(`Nie znaleziono pliku: ${logPath}`);
  console.error('Sprawdź, czy MTG Arena była uruchomiona i czy ścieżka jest poprawna.');
  process.exit(1);
}

const text = fs.readFileSync(logPath, 'utf8');
const lines = text.split(/\r?\n/);
console.log(`Log: ${logPath}`);
console.log(`Linii w logu: ${lines.length}`);

const EVENT_NAME = /(Draft\.[A-Za-z]+|BotDraft_[A-Za-z]+|Event_[A-Za-z]*Draft[A-Za-z]*|[A-Za-z]*Draft[A-Za-z]*Status)/g;
const eventCounts = {};
const recognized = [];
const draftish = [];
const pickRecognized = []; // wybory kart (do puli) rozpoznane przez parser
const pickUnrecognized = []; // linie wyglądające na wybór karty, których parser nie rozumie

lines.forEach((line, i) => {
  const found = line.match(EVENT_NAME);
  if (found) {
    for (const name of found) eventCounts[name] = (eventCounts[name] || 0) + 1;
  }
  if (parsePickLine(line)) {
    pickRecognized.push({ n: i + 1, line });
  } else if (/MakeHumanDraftPick|BotDraft_DraftPick|MakePick|PickedCards/.test(line)) {
    pickUnrecognized.push({ n: i + 1, line });
  }
  if (parsePackLine(line)) {
    recognized.push({ n: i + 1, line });
  } else if (/draft/i.test(line) && /[{[]/.test(line)) {
    draftish.push({ n: i + 1, line });
  }
});

console.log(`Linie rozpoznane przez parser jako pak: ${recognized.length}`);
console.log(`Inne linie z JSON i słowem "draft": ${draftish.length}`);
console.log(`Wybory kart rozpoznane przez parser (do puli): ${pickRecognized.length}`);
console.log(`Linie podobne do wyboru karty, ale nierozpoznane: ${pickUnrecognized.length}`);

const names = Object.entries(eventCounts).sort((a, b) => b[1] - a[1]).slice(0, 25);
if (names.length) {
  console.log('\nNazwy zdarzeń związanych z draftem (liczba wystąpień):');
  for (const [name, count] of names) console.log(`  ${name}: ${count}`);
}

const out = [];
out.push(`# Fragment logu do diagnozy (ocenzurowany)`);
out.push(`# Linii w logu: ${lines.length}`);
out.push(`# Rozpoznane jako pak: ${recognized.length}, inne linie draftowe: ${draftish.length}`);
out.push('');
out.push('## Nazwy zdarzeń');
for (const [name, count] of names) out.push(`${name}: ${count}`);
out.push('');
out.push(`## Rozpoznane linie z pakiem (ostatnie ${Math.min(3, recognized.length)})`);
for (const r of recognized.slice(-3)) out.push(`[linia ${r.n}] ${sanitize(r.line)}`);
out.push('');
out.push(`## Wybory kart (pula): rozpoznane ${pickRecognized.length}, nierozpoznane ${pickUnrecognized.length}`);
for (const r of pickRecognized.slice(-2)) out.push(`[rozpoznana, linia ${r.n}] ${sanitize(r.line)}`);
for (const r of pickUnrecognized.slice(-4)) out.push(`[nierozpoznana, linia ${r.n}] ${sanitize(r.line)}`);
out.push('');
out.push(`## Inne linie draftowe (ostatnie ${Math.min(MAX_SAMPLES, draftish.length)})`);
for (const r of draftish.slice(-MAX_SAMPLES)) out.push(`[linia ${r.n}] ${sanitize(r.line)}`);

const file = path.join(__dirname, '..', 'log-sample.txt');
fs.writeFileSync(file, out.join('\n') + '\n');
console.log(`\nZapisano ocenzurowany fragment do: ${file}`);
console.log('Otwórz go w Notatniku, przejrzyj i dopiero wtedy wklej do rozmowy.');

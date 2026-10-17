const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  parsePackLine,
  lastPackInText,
  looksLikePackEvent,
  parsePickLine,
  lastPicksInText,
} = require('./logParser');

function defaultLogPath() {
  // C:\Users\<user>\AppData\LocalLow\Wizards Of The Coast\MTGA\Player.log
  return path.join(os.homedir(), 'AppData', 'LocalLow', 'Wizards Of The Coast', 'MTGA', 'Player.log');
}

// Co sekundę sprawdza, czy log urósł, i woła onPack dla każdego nowego packa,
// a onPick dla każdego rozpoznanego wyboru karty (zob. parsePickLine).
function watchLog(logPath, onPack, onStatus = () => {}, onPick = () => {}) {
  let offset = 0;
  let started = false;
  let leftover = '';

  function readRange(start, end) {
    const fd = fs.openSync(logPath, 'r');
    try {
      const buf = Buffer.alloc(end - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  }

  function tick() {
    let stat;
    try {
      stat = fs.statSync(logPath);
    } catch {
      onStatus(`Nie znaleziono logu: ${logPath}`);
      return;
    }
    if (!started) {
      // Na starcie przeczytaj końcówkę logu (ostatnie ~1 MB), żeby złapać aktualny pak.
      const from = Math.max(0, stat.size - 1024 * 1024);
      const tail = readRange(from, stat.size);
      const lastPicks = lastPicksInText(tail);
      if (lastPicks) onPick(lastPicks);
      const last = lastPackInText(tail);
      if (last) onPack(last);
      offset = stat.size;
      started = true;
      // Nie nadpisuj widoku, jeśli pak z końcówki logu już został pokazany.
      if (!last) onStatus('Czekam na draft...');
      return;
    }
    if (stat.size < offset) {
      // Gra została uruchomiona od nowa, log został obcięty.
      offset = 0;
      leftover = '';
    }
    if (stat.size === offset) return;
    const chunk = leftover + readRange(offset, stat.size);
    offset = stat.size;
    const lines = chunk.split(/\r?\n/);
    leftover = lines.pop() ?? '';
    for (const line of lines) {
      const pk = parsePickLine(line);
      if (pk) onPick(pk);
      const p = parsePackLine(line);
      if (p) {
        onPack(p);
      } else if (looksLikePackEvent(line) && /DraftPack|PackCards/.test(line)) {
        // Draft jest, ale nie umiemy odczytać packa: powiedz to wprost zamiast milczeć.
        onStatus('Wykryto draft, ale nie rozpoznano formatu packa. Uruchom: node scripts/scan-log.js');
      }
    }
  }

  tick();
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}

module.exports = { watchLog, defaultLogPath };

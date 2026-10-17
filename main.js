const { app, BrowserWindow, globalShortcut, screen, ipcMain, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const { watchLog, defaultLogPath } = require('./src/logWatcher');
const { rescore } = require('./src/scoring');
const { Pool } = require('./src/pool');
const { buildVariants } = require('./src/deckBuilder');

// config.json (opcjonalny): { "set": "FRA", "logPath": "C:\\...\\Player.log" }
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

function loadRatings(set) {
  if (!set) return null;
  try {
    const ratings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', `${set}.json`), 'utf8'));
    // Oceny ułamkowe liczymy od nowa z win rate, więc działają też ze starszymi plikami.
    ratings.cards = rescore(ratings.cards);
    return ratings;
  } catch {
    return null;
  }
}

const config = loadConfig();
const ratings = loadRatings(config.set);
// Pula zapisuje się w data\pool.json i przetrwa restart nakładki.
const pool = new Pool(path.join(__dirname, 'data'), config.set || 'UNKNOWN');

// Komunikat, gdy brakuje ocen.
const noRatingsMsg = config.set
  ? `Brak pliku data\\${config.set}.json. Uruchom: npm run ratings -- ${config.set} QuickDraft`
  : 'Ustaw "set" w config.json (np. {"set":"FRA"}) i zbuduj oceny: npm run ratings -- FRA QuickDraft';

let win = null;
let poolOpen = false;
let stopWatching = () => {};

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

// Pula w postaci do wyświetlenia: nazwy, liczba kopii i ocena, od najlepszych.
function poolPayload() {
  const byName = new Map();
  for (const id of pool.cards) {
    const known = ratings && ratings.arena[id];
    const name = known || `Nieznana karta (${id})`;
    const r = known ? ratings.cards[name] : null;
    const entry = byName.get(name) || { name, count: 0, score: r ? r.score : null };
    entry.count++;
    byName.set(name, entry);
  }
  const cards = [...byName.values()].sort(
    (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name)
  );
  return { count: pool.size, cards };
}

// --- Okno z propozycjami talii (Ctrl+Shift+D) ---
let decksWin = null;
let lastDecks = null;

// Przelicza trzy warianty talii z aktualnej puli.
function computeDecks() {
  if (!ratings) return { ok: false, reason: noRatingsMsg };
  if (!ratings.meta || Object.keys(ratings.meta).length === 0) {
    return {
      ok: false,
      reason: `W pliku z ocenami brakuje kolorów i kosztów kart. Uruchom ponownie: npm run ratings -- ${config.set} PremierDraft`,
    };
  }
  const names = [];
  let noName = 0;
  for (const id of pool.cards) {
    const n = ratings.arena[id];
    if (n) names.push(n);
    else noName++;
  }
  if (names.length === 0) return { ok: false, reason: 'Pula jest jeszcze pusta. Zrób kilka picków w drafcie.' };
  try {
    return { ok: true, poolCount: pool.size, noNameCount: noName, variants: buildVariants(names, ratings) };
  } catch (e) {
    return { ok: false, reason: `Błąd przy budowaniu talii: ${e.message}` };
  }
}

function refreshDecks() {
  if (!decksWin || decksWin.isDestroyed() || !decksWin.isVisible()) return; // liczymy tylko, gdy okno jest otwarte
  lastDecks = computeDecks();
  decksWin.webContents.send('decks', lastDecks);
}

function toggleDecksWindow() {
  if (decksWin && !decksWin.isDestroyed()) {
    if (decksWin.isVisible()) {
      decksWin.hide();
    } else {
      decksWin.show();
      decksWin.focus();
      refreshDecks();
    }
    return;
  }
  decksWin = new BrowserWindow({
    width: 860,
    height: 780,
    title: 'Talie z puli',
    autoHideMenuBar: true,
    backgroundColor: '#14141a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  decksWin.loadFile(path.join('renderer', 'decks.html'));
  decksWin.webContents.on('did-finish-load', () => {
    lastDecks = computeDecks();
    decksWin.webContents.send('decks', lastDecks);
  });
  decksWin.on('closed', () => {
    decksWin = null;
  });
}

// Kopiowanie listy talii do schowka (do importu w Arenie).
ipcMain.handle('copy-deck', (_e, text) => {
  if (typeof text !== 'string' || text.length === 0 || text.length > 20000) return false;
  clipboard.writeText(text);
  return true;
});

const sendPool = () => {
  send('pool', poolPayload());
  refreshDecks();
};

// Ctrl+Shift+P: przełącza panel między listą packa a pulą (w widoku puli okno jest większe).
function setPoolView(open) {
  poolOpen = open;
  if (!win || win.isDestroyed()) return;
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const w = open ? 520 : 340;
  const h = open ? 640 : 560;
  win.setBounds({ x: width - w - 20, y: 80, width: w, height: h });
  send('view', open ? 'pool' : 'pack');
}

function createWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: 340,
    height: 560,
    x: width - 360,
    y: 80,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false, // nie kradnij fokusu grze
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Nad oknem gry w trybie okienkowym / okienkowym bez ramek.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join('renderer', 'index.html'));

  win.webContents.on('did-finish-load', () => {
    if (!ratings) send('status', noRatingsMsg);
    sendPool();
    stopWatching = watchLog(
      config.logPath || defaultLogPath(),
      (p) => {
        // Pak 1, pick 1 przy niepustej puli oznacza początek nowego draftu: stara pula idzie do archiwum.
        if (pool.onNewPack(p)) sendPool();
        if (!ratings) {
          send('status', noRatingsMsg);
          return;
        }
        const cards = p.pack.map((id) => {
          const name = ratings.arena[id] || `Nieznana karta (${id})`;
          const r = ratings.cards[name];
          return { name, score: r ? r.score : null, gih: r ? r.gih : null, alsa: r ? r.alsa : null };
        });
        cards.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.gih ?? 0) - (a.gih ?? 0));
        send('pack', { cards, pick: p.pick, packNumber: p.packNumber });
        // Jeśli większość kart jest nieznana, oceny są prawie na pewno z innego setu.
        const unknown = p.pack.filter((id) => !ratings.arena[id]).length;
        if (unknown * 2 >= p.pack.length) {
          send(
            'status',
            `Wczytano oceny dla setu ${ratings.set} (${ratings.format}), ale ${unknown} z ${p.pack.length} kart nie pasuje. ` +
              `Zmień "set" w config.json na kod setu z draftu i uruchom: npm run ratings -- KOD QuickDraft`
          );
        }
      },
      (msg) => send('status', ratings ? msg : noRatingsMsg),
      (ev) => {
        // Wybór karty z logu: pojedynczy ('pick') albo pełna lista z statusu draftu ('picked').
        const changed = ev.type === 'picked' ? pool.onPicked(ev) : pool.onPick(ev);
        if (changed) sendPool();
      }
    );
  });
}

app.whenReady().then(() => {
  createWindow();
  // Ctrl+Shift+O: pokaż/ukryj nakładkę
  globalShortcut.register('CommandOrControl+Shift+O', () => {
    if (!win) return;
    win.isVisible() ? win.hide() : win.showInactive();
  });
  // Ctrl+Shift+P: pak / pula
  globalShortcut.register('CommandOrControl+Shift+P', () => setPoolView(!poolOpen));
  // Ctrl+Shift+D: okno z propozycjami talii
  globalShortcut.register('CommandOrControl+Shift+D', toggleDecksWindow);
});

app.on('will-quit', () => {
  stopWatching();
  globalShortcut.unregisterAll();
});
app.on('window-all-closed', () => app.quit());

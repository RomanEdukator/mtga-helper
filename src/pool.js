// Pula wybranych kart z aktualnego draftu, zapisywana na dysku.
//
// Pliki w folderze data:
//   pool.json                      bieżąca pula (przetrwa restart nakładki)
//   pools/pool-<data>-<SET>.json   archiwum zakończonych draftów
//
// Karty są przechowywane jako numery Arena (GrpId), nazwy dopasowuje main.js.

const fs = require('fs');
const path = require('path');

class Pool {
  constructor(dir, set) {
    this.dir = dir;
    this.set = set;
    this.file = path.join(dir, 'pool.json');
    this.cards = []; // numery kart w kolejności wyborów
    this.picks = {}; // "pack-pick" -> numer karty (do pomijania powtórzeń zdarzeń)
    this.startedAt = null;
    this._lastSaved = '';
    this._load();
  }

  _load() {
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return; // brak pliku albo uszkodzony: zaczynamy od pustej puli
    }
    if (!saved || !Array.isArray(saved.cards)) return;
    if (saved.set && this.set && saved.set !== this.set) {
      // Pula z innego setu: odkładamy do archiwum i zaczynamy od nowa.
      this._archiveData(saved);
      return;
    }
    this.cards = saved.cards.map(Number).filter(Boolean);
    this.picks = saved.picks && typeof saved.picks === 'object' ? saved.picks : {};
    this.startedAt = saved.startedAt || null;
    this._lastSaved = JSON.stringify(this._data(saved.updatedAt));
  }

  _data(updatedAt) {
    return {
      set: this.set,
      startedAt: this.startedAt,
      updatedAt: updatedAt || new Date().toISOString(),
      cards: this.cards,
      picks: this.picks,
    };
  }

  _archiveData(data) {
    if (!data || !Array.isArray(data.cards) || data.cards.length === 0) return;
    try {
      const dir = path.join(this.dir, 'pools');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = (data.startedAt || data.updatedAt || new Date().toISOString()).replace(/[:.]/g, '-');
      fs.writeFileSync(path.join(dir, `pool-${stamp}-${data.set || 'UNKNOWN'}.json`), JSON.stringify(data, null, 2));
    } catch {
      // archiwum jest dodatkiem, błąd zapisu nie może zatrzymać nakładki
    }
  }

  _save() {
    const json = JSON.stringify(this._data());
    // Porównujemy bez znacznika czasu, żeby nie zapisywać bez zmian.
    const strip = (s) => s.replace(/"updatedAt":"[^"]*",?/, '');
    if (strip(json) === strip(this._lastSaved)) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.file, json);
      this._lastSaved = json;
    } catch {
      // brak możliwości zapisu nie przerywa pracy
    }
  }

  _start() {
    if (!this.startedAt) this.startedAt = new Date().toISOString();
  }

  // Zaczyna nowy draft: stara pula trafia do archiwum.
  reset() {
    if (this.cards.length > 0) this._archiveData(this._data());
    this.cards = [];
    this.picks = {};
    this.startedAt = null;
    this._save();
  }

  get size() {
    return this.cards.length;
  }

  // Nowy pak. Pak 1, pick 1 przy niepustej puli oznacza początek nowego draftu.
  // Zwraca true, jeśli pula się zmieniła.
  onNewPack(pack) {
    if (pack && pack.packNumber === 0 && pack.pick === 0 && this.cards.length > 0) {
      this.reset();
      return true;
    }
    return false;
  }

  // Pełna lista wyborów ze statusu draftu (najpewniejsze źródło).
  onPicked(ev) {
    const cards = (ev.cards || []).map(Number).filter(Boolean);
    if (cards.length === 0) {
      // Pusta lista na początku draftu (pak 1, pick 1) oznacza nowy draft.
      const atStart = ev.packNumber == null || (ev.packNumber === 0 && ev.pickNumber === 0);
      if (atStart && this.cards.length > 0) {
        this.reset();
        return true;
      }
      return false;
    }
    if (cards.length === this.cards.length && cards.every((c, i) => c === this.cards[i])) return false;
    this._start();
    this.cards = cards;
    this.picks = {};
    this._save();
    return true;
  }

  // Pojedynczy wybór ze zdarzenia w logu.
  onPick(ev) {
    const card = Number(ev.card);
    if (!card) return false;
    const key = ev.pack != null && ev.pick != null ? `${ev.pack}-${ev.pick}` : null;
    if (key && this.picks[key] !== undefined) {
      if (this.picks[key] === card) return false; // to samo zdarzenie widziane ponownie
      const i = this.cards.indexOf(this.picks[key]);
      if (i >= 0) this.cards[i] = card; // poprawiony wybór
      this.picks[key] = card;
      this._save();
      return true;
    }
    this._start();
    this.cards.push(card);
    if (key) this.picks[key] = card;
    this._save();
    return true;
  }
}

module.exports = { Pool };

const statusEl = document.getElementById('status');
const cardsEl = document.getElementById('cards');
const pickEl = document.getElementById('pickinfo');
const poolCountEl = document.getElementById('pool');
const packViewEl = document.getElementById('packview');
const poolViewEl = document.getElementById('poolview');
const poolTitleEl = document.getElementById('pooltitle');
const poolListEl = document.getElementById('poollist');

// Ocena z jednym miejscem po przecinku, polski zapis (np. 3,5).
const fmtScore = (s) => s.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtPct = (x) => `${(x * 100).toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

// 1 karta, 2-4 karty, 5+ kart (z wyjątkiem 12-14).
function cardsWord(n) {
  if (n === 1) return 'karta';
  const last = n % 10;
  const last2 = n % 100;
  return last >= 2 && last <= 4 && !(last2 >= 12 && last2 <= 14) ? 'karty' : 'kart';
}

// Kolor plakietki płynnie od czerwonego (1,0) przez żółty (3,0) do zielonego (5,0).
function scoreColor(score) {
  const s = Math.min(5, Math.max(1, score));
  const hue = Math.round(((s - 1) / 4) * 120);
  return `hsl(${hue}, 70%, 55%)`;
}

function makeBadge(score) {
  const badge = document.createElement('span');
  badge.className = 'badge';
  if (score != null) {
    badge.textContent = fmtScore(score);
    badge.style.background = scoreColor(score);
  } else {
    badge.textContent = '?';
    badge.style.background = '#888';
  }
  return badge;
}

window.helper.onStatus((msg) => {
  statusEl.textContent = msg;
  statusEl.style.display = msg ? 'block' : 'none';
});

// Przełączenie między listą packa a pulą.
window.helper.onView((view) => {
  const pool = view === 'pool';
  packViewEl.hidden = pool;
  poolViewEl.hidden = !pool;
});

window.helper.onPool(({ count, cards }) => {
  poolCountEl.textContent = `Pula: ${count} ${cardsWord(count)}`;
  poolTitleEl.textContent = count ? `Twoja pula (${count} ${cardsWord(count)}), od najlepszych:` : 'Pula jest jeszcze pusta.';
  poolListEl.innerHTML = '';
  for (const c of cards) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = c.count > 1 ? `${c.name} ×${c.count}` : c.name;
    li.append(makeBadge(c.score), name);
    poolListEl.appendChild(li);
  }
});

window.helper.onPack(({ cards, pick, packNumber }) => {
  statusEl.style.display = 'none';
  pickEl.textContent =
    packNumber != null && pick != null ? `Pak ${packNumber + 1} · Pick ${pick + 1}` : '';
  cardsEl.innerHTML = '';
  for (const c of cards) {
    const li = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = c.name;

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = c.gih != null ? fmtPct(c.gih) : '';

    li.append(makeBadge(c.score), name, meta);
    cardsEl.appendChild(li);
  }
});

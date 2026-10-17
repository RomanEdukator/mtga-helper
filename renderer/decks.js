const $ = (id) => document.getElementById(id);
const el = {
  poolinfo: $('poolinfo'),
  message: $('message'),
  tabs: $('tabs'),
  deck: $('deck'),
  estimate: $('estimate'),
  facts: $('facts'),
  curve: $('curve'),
  cards: $('cards'),
  lands: $('lands'),
  warnings: $('warnings'),
  copy: $('copy'),
  copyinfo: $('copyinfo'),
};

let variants = [];
let selectedPair = null;
let copyTimer = null;

const nf1 = (x) => x.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (x) => `${nf1(x * 100)}%`;

function cardsWord(n) {
  if (n === 1) return 'karta';
  const last = n % 10;
  const last2 = n % 100;
  return last >= 2 && last <= 4 && !(last2 >= 12 && last2 <= 14) ? 'karty' : 'kart';
}

// Kolor plakietki od czerwonego (1,0) przez żółty (3,0) do zielonego (5,0).
function scoreColor(score) {
  const s = Math.min(5, Math.max(1, score));
  return `hsl(${Math.round(((s - 1) / 4) * 120)}, 70%, 55%)`;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function text(tag, cls, content) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  n.textContent = content;
  return n;
}

function showMessage(msg) {
  el.message.textContent = msg;
  el.message.hidden = false;
  el.tabs.hidden = true;
  el.deck.hidden = true;
}

function renderTabs() {
  clear(el.tabs);
  variants.forEach((v) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = v.pair === selectedPair ? 'active' : '';
    b.appendChild(text('span', 'tabtitle', `${v.label}: ${v.colorsPl}`));
    const sub = v.estimate ? `ok. ${pct(v.estimate.winRate)} · ${v.style}` : `niepełna · ${v.style}`;
    b.appendChild(text('span', 'tabsub', sub));
    b.addEventListener('click', () => {
      selectedPair = v.pair;
      renderTabs();
      renderDeck(v);
    });
    el.tabs.appendChild(b);
  });
}

function renderDeck(v) {
  const d = v.deck;
  el.deck.hidden = false;
  el.copyinfo.textContent = '';

  clear(el.estimate);
  if (v.estimate) {
    const e = v.estimate;
    el.estimate.appendChild(text('div', 'big', `ok. ${pct(e.winRate)}`));
    el.estimate.appendChild(
      text('div', 'note', `±${e.uncertaintyPp} pp (orientacyjnie) · wiarygodność: ${e.reliability}`)
    );
    el.estimate.appendChild(
      text('div', 'note', `karty ${e.deltaPp >= 0 ? '+' : ''}${nf1(e.deltaPp)} pp względem przeciętnej w secie`)
    );
  } else {
    el.estimate.appendChild(text('div', 'big', 'brak szacunku'));
    el.estimate.appendChild(text('div', 'note', 'talia niepełna, za mało kart w tych kolorach'));
  }

  clear(el.facts);
  const lines = [
    `Styl: ${v.style} (średni koszt ${nf1(v.avgCmc)})`,
    `Stworzeń: ${d.totals.creatures} · czarów: ${d.totals.spells} · ziem: ${d.totals.lands}`,
  ];
  for (const l of lines) el.facts.appendChild(text('div', '', l));

  // Krzywa many: słupki 0..6+
  clear(el.curve);
  const max = Math.max(1, ...d.curve);
  d.curve.forEach((n, i) => {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.appendChild(text('span', 'n', String(n)));
    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.height = `${Math.round((n / max) * 70)}px`;
    bar.appendChild(fill);
    bar.appendChild(text('span', '', i === 6 ? '6+' : String(i)));
    el.curve.appendChild(bar);
  });

  // Karty od najtańszych, w obrębie kosztu od najlepszych.
  clear(el.cards);
  const sorted = [...d.spells].sort((a, b) => a.cmc - b.cmc || b.score - a.score || a.name.localeCompare(b.name));
  for (const c of sorted) {
    const li = document.createElement('li');
    li.appendChild(text('span', 'cmc', String(c.cmc)));
    const badge = text('span', 'badge', nf1(c.score));
    badge.style.background = scoreColor(c.score);
    li.appendChild(badge);
    li.appendChild(text('span', 'name', c.name));
    if (c.unrated) li.appendChild(text('span', 'unrated', 'bez oceny'));
    el.cards.appendChild(li);
  }

  const basics = Object.entries(d.basics)
    .filter(([, n]) => n > 0)
    .map(([c, n]) => `${c}: ${n}`)
    .join(', ');
  el.lands.textContent =
    `Podstawowe: ${basics || 'brak'}` + (d.nonbasicLands.length ? ` · nie-podstawowe: ${d.nonbasicLands.join(', ')}` : '');

  clear(el.warnings);
  for (const w of d.warnings) el.warnings.appendChild(text('li', '', w));
}

function renderAll(data) {
  if (!data || !data.ok) {
    el.poolinfo.textContent = '';
    showMessage((data && data.reason) || 'Brak danych.');
    variants = [];
    return;
  }
  el.poolinfo.textContent =
    `Pula: ${data.poolCount} ${cardsWord(data.poolCount)}` + (data.noNameCount ? ` (${data.noNameCount} bez nazwy)` : '');
  variants = data.variants || [];
  if (variants.length === 0) {
    showMessage('Nie udało się zbudować żadnej talii z tej puli.');
    return;
  }
  el.message.hidden = true;
  el.tabs.hidden = false;
  // Zachowaj wybraną zakładkę po odświeżeniu, o ile ta para nadal istnieje.
  if (!variants.some((v) => v.pair === selectedPair)) selectedPair = variants[0].pair;
  renderTabs();
  renderDeck(variants.find((v) => v.pair === selectedPair));
}

el.copy.addEventListener('click', async () => {
  const v = variants.find((x) => x.pair === selectedPair);
  if (!v) return;
  let ok = false;
  try {
    ok = await window.helper.copyDeck(v.arenaText);
  } catch {
    ok = false;
  }
  el.copyinfo.textContent = ok
    ? 'Skopiowano. W Arenie: Talie → Importuj z schowka.'
    : 'Nie udało się skopiować do schowka.';
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    el.copyinfo.textContent = '';
  }, 6000);
});

window.helper.onDecks(renderAll);

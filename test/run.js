const assert = require('assert');
const { parsePackLine, lastPackInText } = require('../src/logParser');
const { buildScores } = require('../src/scoring');

// Parser: Premier draft
const l1 = '{"draftId":"x","SelfPick":3,"SelfPack":1,"PackCards":"91234,91235,91236"}';
assert.deepStrictEqual(parsePackLine(l1), { pack: [91234, 91235, 91236], pick: 3, packNumber: 1 });

// Parser: Quick draft
const l2 = '{"DraftStatus":"PickNext","PackNumber":0,"PickNumber":0,"DraftPack":["80001","80002","80003"]}';
assert.deepStrictEqual(parsePackLine(l2), { pack: [80001, 80002, 80003], pick: 0, packNumber: 0 });

// Brak packa
assert.strictEqual(parsePackLine('[UnityCrossThreadLogger]nic ciekawego'), null);

// Ostatni pak z tekstu
const text = ['coś', l1, 'coś innego', l2, 'koniec'].join('\n');
assert.strictEqual(lastPackInText(text).pack[0], 80001);

// Skala 1-5
const cards = Array.from({ length: 100 }, (_, i) => ({ name: `K${i}`, gih: 0.45 + i * 0.001 }));
const scores = buildScores(cards);
assert.strictEqual(scores.K99.score, 5);
assert.strictEqual(scores.K0.score, 1);
assert.strictEqual(scores.K50.score, 3);
const counts = [0, 0, 0, 0, 0, 0];
Object.values(scores).forEach((s) => counts[s.score]++);
console.log('Rozkład ocen 1..5:', counts.slice(1).join(', '));

console.log('Wszystkie testy przeszły.');

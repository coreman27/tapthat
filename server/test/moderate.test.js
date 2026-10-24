'use strict';
/* The moderation CLI against the exact items the real DynamoDB store writes. A fake `aws`
   command operates on the same in-memory table, so the tool and the store cannot drift apart. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDynamoStore } = require('../src/store-dynamo');
const { createFakeDynamo } = require('./fake-dynamo');
const { main, unmarshal } = require('../tools/moderate');

const W = '2026-W40';
const toDdb = (item) => Object.fromEntries(Object.entries(item).map(([k, v]) =>
  [k, typeof v === 'number' ? { N: String(v) } : typeof v === 'boolean' ? { BOOL: v } : { S: String(v) }]));

function world() {
  const fake = createFakeDynamo('tapthat-leaderboard');
  const store = createDynamoStore({ doc: fake.doc, cmd: fake.cmd, table: 'tapthat-leaderboard', now: () => 1000, sleep: async () => {} });
  const calls = [];
  const run = (args) => {
    calls.push(args.slice(1));
    const [, command] = args;
    const flag = (name) => (args.indexOf(name) === -1 ? undefined : args[args.indexOf(name) + 1]);
    const vals = flag('--expression-attribute-values') ? JSON.parse(flag('--expression-attribute-values')) : {};
    const out = (obj) => JSON.stringify(obj);
    if (command === 'scan') {
      assert.equal(flag('--filter-expression'), 'begins_with(pk, :p)');
      return out({ Items: [...fake.items.values()].filter((i) => i.pk.startsWith(vals[':p'].S)).map(toDdb) });
    }
    if (command === 'get-item') {
      const key = JSON.parse(flag('--key'));
      const it = fake.items.get(key.pk.S + '|' + key.sk.S);
      return out(it ? { Item: toDdb(it) } : {});
    }
    if (command === 'query') {
      assert.equal(flag('--index-name'), 'byDevice');
      const rows = [...fake.items.values()].filter((i) => i.gsi2pk === vals[':d'].S && (i.gsi2sk || '').startsWith(vals[':s'].S));
      return out({ Items: rows.map(toDdb) });
    }
    if (command === 'update-item') {
      const key = JSON.parse(flag('--key'));
      const it = fake.items.get(key.pk.S + '|' + key.sk.S) || { pk: key.pk.S, sk: key.sk.S };
      fake.items.set(it.pk + '|' + it.sk, it);
      const expr = flag('--update-expression');
      const field = expr.split(/[ =]/)[1];
      if (expr.startsWith('SET')) it[field] = true; else delete it[field];
      return '';
    }
    throw new Error('unexpected aws command ' + command);
  };
  const cli = (...argv) => { const lines = []; const result = main(argv, { run, log: (l) => lines.push(l) }); return { result, lines }; };
  return { fake, store, calls, cli };
}

async function seed(w) {
  const { store } = w;
  await store.putScore({ weekId: W, deviceId: 'dev-rude', name: 'Rude', score: 50, ts: 1, ref: 'aaaaaaaaaaaa' });
  await store.putScore({ weekId: '2026-W41', deviceId: 'dev-rude', name: 'Rude', score: 40, ts: 2, ref: 'aaaaaaaaaaaa' });
  await store.putScore({ weekId: W, deviceId: 'dev-fine', name: 'Fine', score: 20, ts: 3, ref: 'bbbbbbbbbbbb' });
  for (const r of ['r1', 'r2']) await store.addReport({ ref: 'aaaaaaaaaaaa', reporterRef: 'rr-' + r, reporterDevice: r, reason: 'name', weekId: W, ts: 5 });
  await store.addReport({ ref: 'bbbbbbbbbbbb', reporterRef: 'rr-r1', reporterDevice: 'r1', reason: 'other', weekId: W, ts: 6 });
}

test('unmarshal reads the types this table uses', () => {
  assert.deepEqual(unmarshal({ a: { S: 'x' }, b: { N: '7' }, c: { BOOL: true } }), { a: 'x', b: 7, c: true });
});

test('reports: aggregates by player, most reported first, with names and hidden status', async () => {
  const w = world(); await seed(w);
  const { result, lines } = w.cli('reports');
  assert.deepEqual(result.map((r) => [r.ref, r.name, r.reports, r.hidden]), [
    ['aaaaaaaaaaaa', 'Rude', 2, false], ['bbbbbbbbbbbb', 'Fine', 1, false]
  ]);
  assert.match(lines.join('\n'), /Rude/);
  assert.equal(w.cli('--table', 'x', 'reports').result.length, 2, 'options parse anywhere');
});

test('reports on an empty table says so', () => {
  const { lines } = world().cli('reports');
  assert.deepEqual(lines, ['No reports.']);
});

test('remove hides the player in every week on the real boards; --ban also blocks posting', async () => {
  const w = world(); await seed(w);
  assert.equal((await w.store.topScores(W, 5)).length, 2);
  const { result } = w.cli('remove', 'aaaaaaaaaaaa', '--ban');
  assert.deepEqual(result, { hiddenScores: 2, banned: true });
  assert.deepEqual((await w.store.topScores(W, 5)).map((e) => e.name), ['Fine']);
  assert.equal((await w.store.topScores('2026-W41', 5)).length, 0, 'hidden in the other week too');
  assert.equal(await w.store.isBanned('dev-rude'), true);
  assert.equal(await w.store.isBanned('dev-fine'), false);
  assert.equal(w.cli('reports').result[0].hidden, true, 'reports show it as hidden');
});

test('remove without --ban hides but does not ban; restore undoes both', async () => {
  const w = world(); await seed(w);
  assert.deepEqual(w.cli('remove', 'aaaaaaaaaaaa').result, { hiddenScores: 2, banned: false });
  assert.equal(await w.store.isBanned('dev-rude'), false);
  w.cli('remove', 'aaaaaaaaaaaa', '--ban');
  assert.equal(await w.store.isBanned('dev-rude'), true);
  assert.deepEqual(w.cli('restore', 'aaaaaaaaaaaa', '--unban').result, { restoredScores: 2, unbanned: true });
  assert.deepEqual((await w.store.topScores(W, 5)).map((e) => e.name), ['Rude', 'Fine']);
  assert.equal(await w.store.isBanned('dev-rude'), false);
});

test('bad input is rejected before touching anything', async () => {
  const w = world(); await seed(w);
  const before = w.calls.length;
  assert.throws(() => w.cli('remove', 'nope'), /12 lowercase hex/);
  assert.throws(() => w.cli('remove', 'AAAAAAAAAAAA'), /12 lowercase hex/);
  assert.equal(w.calls.length, before, 'no AWS calls were made');
  assert.throws(() => w.cli('remove', 'cccccccccccc'), /No player with that ref/);
  assert.equal((await w.store.topScores(W, 5)).length, 2, 'nothing was changed');
});

test('usage is printed for unknown commands', () => {
  const { lines, result } = world().cli('frobnicate');
  assert.equal(result, null);
  assert.match(lines[0], /Usage/);
});

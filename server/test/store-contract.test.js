'use strict';
/* The same behavior tests run against every store implementation. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStore } = require('../src/store-memory');
const { createDynamoStore } = require('../src/store-dynamo');
const { createFakeDynamo } = require('./fake-dynamo');

const impls = {
  memory: () => ({ store: createMemoryStore() }),
  dynamo: () => {
    const fake = createFakeDynamo('tbl');
    return { store: createDynamoStore({ doc: fake.doc, cmd: fake.cmd, table: 'tbl', now: () => 1000, sleep: async () => {} }), fake };
  }
};

for (const [label, make] of Object.entries(impls)) {
  const t = (name, fn) => test(`[${label}] ${name}`, () => fn(make()));
  const W = '2026-W40';

  t('device auth is trust-on-first-use', async ({ store }) => {
    assert.equal(await store.authDevice('d1', 'hashA'), true);
    assert.equal(await store.authDevice('d1', 'hashA'), true);
    assert.equal(await store.authDevice('d1', 'hashB'), false);
    assert.equal(await store.authDevice('d2', 'hashB'), true);
  });

  t('keeps only the best score per device; lower scores never replace it', async ({ store }) => {
    assert.deepEqual(await store.putScore({ weekId: W, deviceId: 'a', name: 'A', score: 10, ts: 1 }), { improved: true, best: 10 });
    assert.deepEqual(await store.putScore({ weekId: W, deviceId: 'a', name: 'A', score: 7, ts: 2 }), { improved: false, best: 10 });
    assert.deepEqual(await store.putScore({ weekId: W, deviceId: 'a', name: 'A', score: 10, ts: 3 }), { improved: false, best: 10 });
    assert.deepEqual(await store.putScore({ weekId: W, deviceId: 'a', name: 'A', score: 12, ts: 4 }), { improved: true, best: 12 });
    assert.deepEqual(await store.getScore(W, 'a'), { name: 'A', score: 12 });
    assert.equal(await store.getScore(W, 'nobody'), null);
    assert.equal(await store.countScores(W), 1);
  });

  t('a renamed device keeps its score but shows the new name', async ({ store }) => {
    await store.putScore({ weekId: W, deviceId: 'a', name: 'Old', score: 10, ts: 1 });
    await store.putScore({ weekId: W, deviceId: 'a', name: 'New', score: 5, ts: 2 });
    assert.deepEqual(await store.getScore(W, 'a'), { name: 'New', score: 10 });
  });

  t('top scores: best first, earlier submission wins ties, limit respected', async ({ store }) => {
    await store.putScore({ weekId: W, deviceId: 'a', name: 'A', score: 20, ts: 5 });
    await store.putScore({ weekId: W, deviceId: 'b', name: 'B', score: 30, ts: 9 });
    await store.putScore({ weekId: W, deviceId: 'c', name: 'C', score: 20, ts: 3 });
    await store.putScore({ weekId: W, deviceId: 'd', name: 'D', score: 5, ts: 1 });
    await store.putScore({ weekId: '2026-W41', deviceId: 'e', name: 'E', score: 99, ts: 1 });
    assert.deepEqual((await store.topScores(W, 10)).map((e) => e.name), ['B', 'C', 'A', 'D']);
    assert.deepEqual((await store.topScores(W, 2)).map((e) => e.name), ['B', 'C']);
    assert.equal(await store.countScores(W), 4);
    assert.equal(await store.countScores('2026-W41'), 1);
  });

  t('rank counts strictly higher scores, so ties share a rank (across pages)', async ({ store }) => {
    const scores = [50, 40, 40, 40, 30, 20, 10];
    for (let i = 0; i < scores.length; i++) await store.putScore({ weekId: W, deviceId: 'p' + i, name: 'P' + i, score: scores[i], ts: i });
    assert.equal(await store.rankOf(W, 50), 1);
    assert.equal(await store.rankOf(W, 40), 2);
    assert.equal(await store.rankOf(W, 30), 5);
    assert.equal(await store.rankOf(W, 10), 7);
    assert.equal(await store.rankOf(W, 60), 1, 'a score above everyone ranks first');
    assert.equal(await store.rankOf(W, 5), 8, 'a score below everyone ranks last');
  });

  t('rank comparison is numeric, not lexical (9 vs 10 vs 100)', async ({ store }) => {
    for (const [i, s] of [100, 10, 9].entries()) await store.putScore({ weekId: W, deviceId: 'n' + i, name: 'N' + i, score: s, ts: i });
    assert.equal(await store.rankOf(W, 9), 3);
    assert.equal(await store.rankOf(W, 10), 2);
    assert.deepEqual((await store.topScores(W, 5)).map((e) => e.score), [100, 10, 9]);
  });

  t('groups: unique codes, membership, and group-only scores', async ({ store }) => {
    assert.equal(await store.createGroup({ code: 'ABC234', owner: 'h', createdAt: 1 }), true);
    assert.equal(await store.createGroup({ code: 'ABC234', owner: 'x', createdAt: 2 }), false);
    assert.ok(await store.getGroup('ABC234'));
    assert.equal(await store.getGroup('NOPE22'), null);
    for (const [id, name] of [['h', 'Host'], ['g1', 'G1'], ['g2', 'G2'], ['g3', 'G3']]) {
      await store.addMember({ code: 'ABC234', deviceId: id, name, joinedAt: 1 });
    }
    await store.addMember({ code: 'ABC234', deviceId: 'g1', name: 'G1', joinedAt: 2 }); // idempotent
    assert.equal((await store.listMembers('ABC234')).length, 4);
    await store.putScore({ weekId: W, deviceId: 'h', name: 'Host', score: 12, ts: 1 });
    await store.putScore({ weekId: W, deviceId: 'g1', name: 'G1', score: 18, ts: 2 });
    await store.putScore({ weekId: W, deviceId: 'g2', name: 'G2', score: 18, ts: 1 });
    await store.putScore({ weekId: W, deviceId: 'outsider', name: 'Out', score: 99, ts: 1 });
    // g3 has no score; four members spans multiple batches/pages in the dynamo fake
    assert.deepEqual(await store.groupScores('ABC234', W), [
      { name: 'G2', score: 18 }, { name: 'G1', score: 18 }, { name: 'Host', score: 12 }
    ]);
  });

  t('delete removes a device\'s scores, memberships and key — and nobody else\'s', async ({ store }) => {
    await store.authDevice('gone', 'k');
    await store.authDevice('stay', 'k2');
    await store.createGroup({ code: 'GRP222', owner: 'gone', createdAt: 1 });
    for (const id of ['gone', 'stay']) await store.addMember({ code: 'GRP222', deviceId: id, name: id, joinedAt: 1 });
    for (let i = 0; i < 6; i++) await store.putScore({ weekId: '2026-W' + String(30 + i), deviceId: 'gone', name: 'g', score: 5 + i, ts: i });
    await store.putScore({ weekId: W, deviceId: 'stay', name: 'stay', score: 9, ts: 1 });

    await store.deleteDevice('gone');
    for (let i = 0; i < 6; i++) assert.equal(await store.getScore('2026-W' + String(30 + i), 'gone'), null);
    assert.deepEqual((await store.listMembers('GRP222')).map((m) => m.deviceId), ['stay']);
    assert.deepEqual(await store.getScore(W, 'stay'), { name: 'stay', score: 9 });
    assert.equal(await store.authDevice('gone', 'a-new-key'), true, 'device id is free again after deletion');
    assert.equal(await store.authDevice('stay', 'k2'), true);
  });
}

test('[dynamo] batch retries actually happened and nothing was dropped', async () => {
  const fake = createFakeDynamo('tbl');
  const store = createDynamoStore({ doc: fake.doc, cmd: fake.cmd, table: 'tbl', now: () => 1000, sleep: async () => {} });
  await store.createGroup({ code: 'BIG222', owner: 'o', createdAt: 1 });
  for (let i = 0; i < 9; i++) {
    await store.addMember({ code: 'BIG222', deviceId: 'm' + i, name: 'M' + i, joinedAt: 1 });
    await store.putScore({ weekId: '2026-W40', deviceId: 'm' + i, name: 'M' + i, score: i + 1, ts: i });
  }
  assert.equal((await store.groupScores('BIG222', '2026-W40')).length, 9);
  await store.deleteDevice('m0');
  assert.ok(fake.calls.unprocessed > 0, 'the fake returned unprocessed items that the store retried');
  assert.equal([...fake.items.values()].some((i) => i.gsi2pk === 'D#m0' || i.pk === 'D#m0'), false);
});

test('[dynamo] items get a ttl so old data expires', async () => {
  const fake = createFakeDynamo('tbl');
  const store = createDynamoStore({ doc: fake.doc, cmd: fake.cmd, table: 'tbl', now: () => 1000, sleep: async () => {} });
  await store.putScore({ weekId: '2026-W40', deviceId: 'a', name: 'A', score: 3, ts: 1000 });
  await store.createGroup({ code: 'TTL222', owner: 'a', createdAt: 1000 });
  const rows = [...fake.items.values()];
  assert.ok(rows.find((r) => r.sk === 'S#a').ttl > 1 + 60 * 24 * 3600);
  const meta = rows.find((r) => r.sk === 'META');
  assert.ok(meta.ttl > 300 * 24 * 3600);
  assert.equal('owner' in meta, false, 'no device id is stored on the group record');
});

test('[dynamo] a batch that never completes fails loudly instead of returning partial data', async () => {
  const fake = createFakeDynamo('tbl');
  const store = createDynamoStore({ doc: fake.doc, cmd: fake.cmd, table: 'tbl', now: () => 1000, sleep: async () => {} });
  await store.createGroup({ code: 'STUCK2', owner: 'o', createdAt: 1 });
  for (let i = 0; i < 5; i++) await store.addMember({ code: 'STUCK2', deviceId: 'm' + i, name: 'M' + i, joinedAt: 1 });
  const realSend = fake.doc.send.bind(fake.doc);
  fake.doc.send = async (command) => (command instanceof fake.cmd.BatchGetCommand
    ? { Responses: { tbl: [] }, UnprocessedKeys: { tbl: { Keys: command.input.RequestItems.tbl.Keys } } }
    : realSend(command));
  await assert.rejects(() => store.groupScores('STUCK2', '2026-W40'), /unprocessed/);
});

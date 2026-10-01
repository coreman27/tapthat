'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../src/validate');

test('names: allowed characters only, trimmed, max 14', () => {
  assert.equal(v.sanitizeName('  Corey  Hall  ', 'x'), 'Corey Hall');
  assert.equal(v.sanitizeName('Ace_of-Spades', 'x'), 'Ace_of-Spades');
  assert.equal(v.sanitizeName('A'.repeat(40), 'x'), 'A'.repeat(14));
  assert.equal(v.sanitizeName('<script>alert(1)</script>', 'x').includes('<'), false);
  assert.equal(v.sanitizeName('Bob😀Smith', 'x'), 'BobSmith');
});

test('names: empty or filtered names fall back to a stable PlayerNNNN', () => {
  const a = v.sanitizeName('', 'device-1');
  assert.match(a, /^Player\d{4}$/);
  assert.equal(v.sanitizeName(null, 'device-1'), a, 'stable per device');
  assert.equal(v.sanitizeName('!!!', 'device-1'), a);
  assert.notEqual(v.fallbackName('device-1'), v.fallbackName('device-2'));
});

test('names: profanity is caught through leetspeak, spacing and repeats', () => {
  ['fuck', 'F U C K', 'sh1t', 'b!tch', 'fuuuuck', 'f.u.c.k', 'N4zi'].forEach((bad) => {
    assert.match(v.sanitizeName(bad, 'dev'), /^Player\d{4}$/, bad);
  });
  ['Corey', 'Speedy', 'Taps McGee', 'Player 7', 'Sam'].forEach((ok) => {
    assert.equal(v.sanitizeName(ok, 'dev'), ok, ok);
  });
});

test('identity and id validators', () => {
  assert.ok(v.isDeviceId('3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e'));
  assert.equal(v.isDeviceId('not-a-uuid'), false);
  assert.ok(v.isDeviceKey('A'.repeat(43)));
  assert.equal(v.isDeviceKey('short'), false);
  assert.equal(v.isDeviceKey('has spaces and is long enough to pass length check!!'), false);
  assert.ok(v.isGroupCode('ABC234'));
  ['abc234', 'ABC23', 'ABC2345', 'ABO234', 'AB1234'].forEach((c) => assert.equal(v.isGroupCode(c), false, c));
  assert.ok(v.isWeekId('2026-W40'));
  assert.equal(v.isWeekId('2026-W54'), false);
  assert.ok(v.isScore(1) && v.isScore(500));
  [0, 501, 1.5, '5', NaN, null].forEach((s) => assert.equal(v.isScore(s), false, String(s)));
});

test('group codes use the unambiguous alphabet', () => {
  let n = 0;
  const code = v.randomGroupCode(() => n++ % v.GROUP_CODE_ALPHABET.length);
  assert.ok(v.isGroupCode(code));
  assert.equal(/[01OI]/.test(v.GROUP_CODE_ALPHABET), false);
});

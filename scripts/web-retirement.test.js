/* web-retirement.test.js — the redirect function, the kill-switch service worker, and the safety of
 * scripts/retire-web.sh (run against stub curl/aws, so nothing real is touched).
 * Run: node --test scripts/web-retirement.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const dir = path.join(__dirname, 'web-retirement');
const NEW = 'https://hallsoftwaresolutions.com/dont-tap-that/';

// The function runs in CloudFront's sandbox: no require, fetch, timers or other globals.
function loadFunction() {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(dir, 'redirect.cf.js'), 'utf8'), ctx);
  return (uri) => ctx.handler({ request: { uri, method: 'GET', headers: {}, querystring: {} } });
}

test('every old URL forwards to the company pages with a permanent redirect', () => {
  const go = loadFunction();
  for (const uri of ['/', '/index.html', '/js/main.js', '/css/styles.css', '/icons/icon.svg', '/anything/else', '/app-ads.txt', '/manifest.webmanifest']) {
    const r = go(uri);
    assert.equal(r.statusCode, 301, uri);
    assert.equal(r.statusDescription, 'Moved Permanently');
    assert.equal(r.headers.location.value, NEW, uri);
    assert.match(r.headers['cache-control'].value, /max-age=\d+/);
  }
});

test('the old privacy URL (still in the live App Store listing) goes to the new privacy page', () => {
  const go = loadFunction();
  for (const uri of ['/privacy.html', '/privacy', '/privacy/']) assert.equal(go(uri).headers.location.value, NEW + 'privacy/', uri);
  for (const uri of ['/support', '/support/']) assert.equal(go(uri).headers.location.value, NEW + 'support/', uri);
});

test('only the service worker is let through to the bucket (so installed copies get the kill-switch)', () => {
  const go = loadFunction();
  const passthrough = go('/sw.js');
  assert.equal(passthrough.uri, '/sw.js');
  assert.equal(passthrough.statusCode, undefined, 'not a redirect');
  assert.equal(go('/sw.js.map').statusCode, 301, 'nothing else slips through');
  assert.equal(go('/SW.js').statusCode, 301);
});

test('the function stays within CloudFront Function limits and uses no outside globals', () => {
  const code = fs.readFileSync(path.join(dir, 'redirect.cf.js'), 'utf8');
  assert.ok(Buffer.byteLength(code) < 10000, 'CloudFront Functions are limited to 10 KB');
  assert.doesNotMatch(code, /\b(require|import|fetch|setTimeout|XMLHttpRequest)\b/);
  assert.match(code, /^function handler\(event\)/m);
});

// ---- the kill-switch service worker ----
function runKillSwitch({ cacheNames = ['dtt-v4', 'other'], windows = [{ url: 'https://donttapthat.com/' }] } = {}) {
  const listeners = {};
  const log = { deleted: [], unregistered: 0, navigated: [], skipWaiting: 0 };
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => { log.skipWaiting++; },
    registration: { unregister: async () => { log.unregistered++; return true; } },
    clients: { matchAll: async () => windows.map((w) => ({ url: w.url, navigate: (u) => log.navigated.push(u) })) }
  };
  const caches = { keys: async () => cacheNames, delete: async (k) => { log.deleted.push(k); return true; } };
  vm.runInContext(fs.readFileSync(path.join(dir, 'sw-kill-switch.js'), 'utf8'), vm.createContext({ self, caches }));
  return { listeners, log };
}

test('the kill-switch clears every cache, unregisters, and reloads open pages', async () => {
  const { listeners, log } = runKillSwitch();
  assert.deepEqual(Object.keys(listeners).sort(), ['activate', 'install'], 'no fetch handler: nothing is served from here');
  listeners.install();
  assert.equal(log.skipWaiting, 1, 'takes over immediately');
  let waiting;
  listeners.activate({ waitUntil: (p) => { waiting = p; } });
  await waiting;
  assert.deepEqual(log.deleted, ['dtt-v4', 'other']);
  assert.equal(log.unregistered, 1);
  assert.deepEqual(log.navigated, ['https://donttapthat.com/']);
});

test('the kill-switch copes with no caches and no open pages', async () => {
  const { listeners, log } = runKillSwitch({ cacheNames: [], windows: [] });
  let waiting;
  listeners.activate({ waitUntil: (p) => { waiting = p; } });
  await waiting;
  assert.equal(log.unregistered, 1);
  assert.deepEqual(log.deleted, []);
});

// ---- the script: ordering and safety ----
const script = fs.readFileSync(path.join(__dirname, 'retire-web.sh'), 'utf8');

test('the script does the steps in the safe order, deleting files last', () => {
  const at = (needle) => { const i = script.indexOf(needle); assert.ok(i >= 0, 'missing: ' + needle); return i; };
  const order = [at('Step 1'), at('Step 2'), at('Step 3'), at('Step 4'), at('Step 5')];
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(at('check_redirect "https://$host/privacy.html"') < at('aws s3 rm'), 'files are deleted only after the redirects are verified');
  assert.match(script, /aws s3 rm "s3:\/\/\$BUCKET\/" --recursive --exclude "sw.js"/, 'the kill-switch is never deleted');
  assert.match(script, /set -euo pipefail/, 'stops at the first failure');
  assert.match(script, /BUCKET="tapthat-game-1788042934"/);
  assert.match(script, /DIST_ID="E2XJJ61LKTCHVW"/);
});

function runScript(args, { curlCode }) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-'));
  const awsLog = path.join(bin, 'aws.log');
  fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/sh\nprintf '${curlCode}'\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'aws'), `#!/bin/sh\necho "$@" >> '${awsLog}'\nexit 1\n`, { mode: 0o755 });
  const result = spawnSync('bash', [path.join(__dirname, 'retire-web.sh'), ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH, AWS_PROFILE: 'stub' }
  });
  const calls = fs.existsSync(awsLog) ? fs.readFileSync(awsLog, 'utf8').trim() : '';
  fs.rmSync(bin, { recursive: true, force: true });
  return { ...result, calls };
}

test('a dry run prints the plan and makes no AWS calls at all', () => {
  const r = runScript(['--dry-run'], { curlCode: '200' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.calls, '', 'not a single aws command was run');
  assert.match(r.stdout, /\(dry run\)/);
  assert.match(r.stdout, /Step 5/);
});

test('it refuses to touch anything when the new company pages are not live', () => {
  const r = runScript([], { curlCode: '404' });
  assert.notEqual(r.status, 0);
  assert.equal(r.calls, '', 'no aws command ran before the safety check');
  assert.match(r.stdout, /Deploy the company site first/);
});

#!/usr/bin/env node
'use strict';
/* moderate.js — review reports and remove players from the weekly leaderboard.
 *
 * Runs on YOUR machine with your own AWS credentials (it shells out to the AWS CLI), so there is
 * no admin endpoint on the internet. Examples (AWS_PROFILE selects your credentials):
 *
 *   AWS_PROFILE=corey node tools/moderate.js reports
 *   AWS_PROFILE=corey node tools/moderate.js remove 1a2b3c4d5e6f          hide everywhere
 *   AWS_PROFILE=corey node tools/moderate.js remove 1a2b3c4d5e6f --ban    also stop that device posting
 *   AWS_PROFILE=corey node tools/moderate.js restore 1a2b3c4d5e6f [--unban]
 *
 * Options: --table <name> (default tapthat-leaderboard), --region <r> (default us-east-1).
 * Entries are also hidden automatically when three different players report them; this tool is
 * for reviewing what was reported and for acting sooner, or on a single report.
 */
const { execFileSync } = require('child_process');

const DEFAULT_TABLE = 'tapthat-leaderboard';
const REF_RE = /^[0-9a-f]{12}$/;

/* DynamoDB JSON -> plain object (only the types this table uses). */
function unmarshal(item) {
  const out = {};
  for (const [k, v] of Object.entries(item || {})) {
    if ('S' in v) out[k] = v.S;
    else if ('N' in v) out[k] = Number(v.N);
    else if ('BOOL' in v) out[k] = v.BOOL;
  }
  return out;
}

function makeClient({ table, region, run }) {
  const runner = run || ((args) => execFileSync('aws', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  const aws = (args) => {
    const out = runner(['dynamodb', ...args, '--table-name', table, '--region', region, '--output', 'json']);
    return out && out.trim() ? JSON.parse(out) : {};
  };
  const key = (pk, sk) => JSON.stringify({ pk: { S: pk }, sk: { S: sk } });
  return {
    scanReports() {
      const out = aws(['scan', '--filter-expression', 'begins_with(pk, :p)',
        '--expression-attribute-values', JSON.stringify({ ':p': { S: 'R#' } })]);
      return (out.Items || []).map(unmarshal);
    },
    getRef(ref) {
      const out = aws(['get-item', '--key', key('RF#' + ref, 'DEV')]);
      return out.Item ? unmarshal(out.Item) : null;
    },
    scoreItemsFor(deviceId) {
      const out = aws(['query', '--index-name', 'byDevice',
        '--key-condition-expression', 'gsi2pk = :d AND begins_with(gsi2sk, :s)',
        '--expression-attribute-values', JSON.stringify({ ':d': { S: 'D#' + deviceId }, ':s': { S: 'S#' } })]);
      return (out.Items || []).map(unmarshal);
    },
    setHidden(pk, sk, hidden) {
      aws(['update-item', '--key', key(pk, sk),
        ...(hidden
          ? ['--update-expression', 'SET hidden = :t', '--expression-attribute-values', JSON.stringify({ ':t': { BOOL: true } })]
          : ['--update-expression', 'REMOVE hidden'])]);
    },
    setBanned(deviceId, banned) {
      aws(['update-item', '--key', key('D#' + deviceId, 'KEY'),
        ...(banned
          ? ['--update-expression', 'SET banned = :t', '--expression-attribute-values', JSON.stringify({ ':t': { BOOL: true } })]
          : ['--update-expression', 'REMOVE banned'])]);
    }
  };
}

function reports(client, log) {
  const byRef = new Map();
  for (const r of client.scanReports()) {
    const ref = r.pk.slice(2);
    const entry = byRef.get(ref) || { ref, count: 0, reasons: new Set(), last: 0 };
    entry.count += 1;
    entry.reasons.add(r.reason);
    entry.last = Math.max(entry.last, r.ts || 0);
    byRef.set(ref, entry);
  }
  const rows = [...byRef.values()].sort((a, b) => b.count - a.count || b.last - a.last).map((e) => {
    const info = client.getRef(e.ref);
    return { ref: e.ref, name: info ? info.name : '(expired)', reports: e.count,
      reasons: [...e.reasons].join('/'), hidden: info ? !!info.hidden : false,
      last: e.last ? new Date(e.last).toISOString().slice(0, 16) : '' };
  });
  if (!rows.length) log('No reports.');
  else {
    log('REF           REPORTS  HIDDEN  REASONS         LAST SEEN         NAME');
    for (const r of rows) {
      log([r.ref.padEnd(13), String(r.reports).padEnd(8), (r.hidden ? 'yes' : 'no').padEnd(7), r.reasons.padEnd(15), r.last.padEnd(17), r.name].join(' '));
    }
  }
  return rows;
}

function remove(client, ref, { ban }, log) {
  if (!REF_RE.test(ref)) throw new Error('ref must be 12 lowercase hex characters (see the "reports" command)');
  const info = client.getRef(ref);
  if (!info || !info.deviceId) throw new Error('No player with that ref (their data may have expired or been deleted).');
  client.setHidden('RF#' + ref, 'DEV', true);
  const items = client.scoreItemsFor(info.deviceId);
  for (const item of items) client.setHidden(item.pk, item.sk, true);
  if (ban) client.setBanned(info.deviceId, true);
  log('Hid ' + info.name + ' (' + ref + '): ' + items.length + ' weekly score(s)' + (ban ? '; device banned from posting.' : '.'));
  return { hiddenScores: items.length, banned: !!ban };
}

function restore(client, ref, { unban }, log) {
  if (!REF_RE.test(ref)) throw new Error('ref must be 12 lowercase hex characters');
  const info = client.getRef(ref);
  if (!info || !info.deviceId) throw new Error('No player with that ref.');
  client.setHidden('RF#' + ref, 'DEV', false);
  const items = client.scoreItemsFor(info.deviceId);
  for (const item of items) client.setHidden(item.pk, item.sk, false);
  if (unban) client.setBanned(info.deviceId, false);
  log('Restored ' + info.name + ' (' + ref + '): ' + items.length + ' weekly score(s)' + (unban ? '; ban lifted.' : '.'));
  return { restoredScores: items.length, unbanned: !!unban };
}

function main(argv, deps) {
  const log = (deps && deps.log) || console.log;
  const args = argv.slice();
  const flag = (name, fallback) => {
    const i = args.indexOf(name);
    if (i === -1) return fallback;
    const value = args[i + 1];
    args.splice(i, 2);
    return value;
  };
  const has = (name) => { const i = args.indexOf(name); if (i === -1) return false; args.splice(i, 1); return true; };
  const table = flag('--table', DEFAULT_TABLE);
  const region = flag('--region', 'us-east-1');
  const ban = has('--ban');
  const unban = has('--unban');
  const [command, ref] = args;
  const client = makeClient({ table, region, run: deps && deps.run });
  if (command === 'reports') return reports(client, log);
  if (command === 'remove') return remove(client, ref, { ban }, log);
  if (command === 'restore') return restore(client, ref, { unban }, log);
  log('Usage: moderate.js reports | remove <ref> [--ban] | restore <ref> [--unban]   [--table T] [--region R]');
  return null;
}

module.exports = { main, makeClient, reports, remove, restore, unmarshal };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (e) { console.error('Error: ' + e.message); process.exit(1); }
}

'use strict';
/* store-dynamo.js — DynamoDB implementation of the store contract (see store-memory.js).
 *
 * Single table, on-demand billing:
 *   pk / sk                       primary key
 *   gsi1pk / gsi1sk  (byScore)    weekly leaderboard order and rank counting
 *   gsi2pk / gsi2sk  (byDevice)   everything a device owns, for "delete my data"
 *   ttl                           DynamoDB TTL (epoch seconds) so old data expires
 *
 *   Device   D#<deviceId>  / KEY            keyHash                  (trust on first use)
 *   Score    W#<weekId>    / S#<deviceId>   name, score, ts          gsi1: score order, gsi2: device
 *   Group    G#<code>      / META           createdAt                (no owner id is stored)
 *   Member   G#<code>      / M#<deviceId>   name, joinedAt           gsi2: device
 *   Ref      RF#<ref>      / DEV            deviceId, name, hidden   public opaque id -> device (moderation)
 *   Report   R#<ref>       / <reporterRef>  reason, weekId, ts       gsi2: reporting device (so delete removes it)
 *
 * `doc` is a DynamoDBDocumentClient and `cmd` the lib-dynamodb command classes; both are
 * injected so the same code runs against the real SDK (Lambda) and the test fake.
 */

const DAY_S = 24 * 60 * 60;
const SCORE_TTL_DAYS = 70;
const GROUP_TTL_DAYS = 365;
const REPORT_TTL_DAYS = 180;
const MAX_TS = 9999999999999;
// DynamoDB reserved words (hidden, name, ttl, ...) are rejected when used bare in an expression,
// so every non-key attribute in an expression goes through an alias.
const HIDDEN_NAME = { '#h': 'hidden' };

const pad = (n, width) => String(n).padStart(width, '0');
// Descending index order = higher score first, then earlier submission first.
const scoreSortKey = (score, ts) => pad(score, 4) + '#' + pad(MAX_TS - ts, 13);
const ttlFrom = (ms, days) => Math.floor(ms / 1000) + days * DAY_S;

const MAX_BATCH_ATTEMPTS = 8;
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createDynamoStore({ doc, cmd, table, now, sleep }) {
  const clock = now || Date.now;
  const wait = sleep || defaultSleep;

  /* Sends a batch request and retries whatever DynamoDB left unprocessed, with
     exponential backoff. Throws rather than returning partial results. */
  async function sendBatch(makeCommand, request, unprocessedField) {
    const responses = [];
    for (let attempt = 0; request; attempt++) {
      if (attempt >= MAX_BATCH_ATTEMPTS) throw new Error('DynamoDB batch left items unprocessed after retries');
      if (attempt > 0) await wait(Math.min(25 * 2 ** attempt, 1000));
      const out = await doc.send(makeCommand(request));
      responses.push(out);
      const left = out[unprocessedField] && out[unprocessedField][table];
      const remaining = Array.isArray(left) ? left : left && left.Keys;
      request = remaining && remaining.length ? out[unprocessedField] : null;
    }
    return responses;
  }

  async function queryAll(input) {
    const items = [];
    let key;
    do {
      const out = await doc.send(new cmd.QueryCommand({ TableName: table, ...input, ExclusiveStartKey: key }));
      items.push(...(out.Items || []));
      key = out.LastEvaluatedKey;
    } while (key);
    return items;
  }

  async function countAll(input) {
    let count = 0;
    let key;
    do {
      const out = await doc.send(new cmd.QueryCommand({ TableName: table, ...input, Select: 'COUNT', ExclusiveStartKey: key }));
      count += out.Count || 0;
      key = out.LastEvaluatedKey;
    } while (key);
    return count;
  }

  const isConditionFailure = (e) => e && e.name === 'ConditionalCheckFailedException';

  return {
    async authDevice(deviceId, keyHash) {
      const pk = 'D#' + deviceId;
      try {
        await doc.send(new cmd.PutCommand({
          TableName: table,
          Item: { pk, sk: 'KEY', keyHash },
          ConditionExpression: 'attribute_not_exists(pk)'
        }));
        return true; // first time this device id is seen
      } catch (e) {
        if (!isConditionFailure(e)) throw e;
      }
      const out = await doc.send(new cmd.GetCommand({ TableName: table, Key: { pk, sk: 'KEY' } }));
      return !!out.Item && out.Item.keyHash === keyHash;
    },

    async putScore({ weekId, deviceId, name, score, ts, ref }) {
      const pk = 'W#' + weekId;
      const sk = 'S#' + deviceId;
      // Remember which device owns this public ref (for moderation) and whether it is hidden.
      const known = await doc.send(new cmd.UpdateCommand({
        TableName: table, Key: { pk: 'RF#' + ref, sk: 'DEV' },
        UpdateExpression: 'SET #d = :d, #n = :n, gsi2pk = :g, gsi2sk = :gs, #t = :t',
        ExpressionAttributeNames: { '#d': 'deviceId', '#n': 'name', '#t': 'ttl' },
        ExpressionAttributeValues: { ':d': deviceId, ':n': name, ':g': 'D#' + deviceId, ':gs': 'RF#' + ref, ':t': ttlFrom(ts, SCORE_TTL_DAYS) },
        ReturnValues: 'ALL_NEW'
      }));
      const hidden = !!(known.Attributes && known.Attributes.hidden);
      try {
        const item = {
          pk, sk, name, score, ts, ref,
          gsi1pk: pk, gsi1sk: scoreSortKey(score, ts),
          gsi2pk: 'D#' + deviceId, gsi2sk: 'S#' + weekId,
          ttl: ttlFrom(ts, SCORE_TTL_DAYS)
        };
        if (hidden) item.hidden = true;
        await doc.send(new cmd.PutCommand({
          TableName: table,
          Item: item,
          ConditionExpression: 'attribute_not_exists(pk) OR #s < :score',
          ExpressionAttributeNames: { '#s': 'score' },
          ExpressionAttributeValues: { ':score': score }
        }));
        return { improved: true, best: score };
      } catch (e) {
        if (!isConditionFailure(e)) throw e;
      }
      const existing = await doc.send(new cmd.GetCommand({ TableName: table, Key: { pk, sk } }));
      const best = existing.Item ? existing.Item.score : score;
      if (existing.Item && existing.Item.name !== name) {
        await doc.send(new cmd.UpdateCommand({
          TableName: table, Key: { pk, sk },
          UpdateExpression: 'SET #n = :n',
          ExpressionAttributeNames: { '#n': 'name' },
          ExpressionAttributeValues: { ':n': name }
        }));
      }
      return { improved: false, best };
    },

    async getScore(weekId, deviceId) {
      const out = await doc.send(new cmd.GetCommand({ TableName: table, Key: { pk: 'W#' + weekId, sk: 'S#' + deviceId } }));
      return out.Item ? { name: out.Item.name, score: out.Item.score, ref: out.Item.ref } : null;
    },

    // Hidden (reported/removed) entries are filtered out. DynamoDB applies Limit before the
    // filter, so keep paging until enough visible entries are found.
    async topScores(weekId, limit) {
      const found = [];
      let key;
      do {
        const out = await doc.send(new cmd.QueryCommand({
          TableName: table, IndexName: 'byScore',
          KeyConditionExpression: 'gsi1pk = :p',
          FilterExpression: 'attribute_not_exists(#h)',
        ExpressionAttributeNames: HIDDEN_NAME,
          ExpressionAttributeValues: { ':p': 'W#' + weekId },
          ScanIndexForward: false, Limit: limit + 10, ExclusiveStartKey: key
        }));
        found.push(...(out.Items || []));
        key = out.LastEvaluatedKey;
      } while (key && found.length < limit);
      return found.slice(0, limit).map((i) => ({ name: i.name, score: i.score, ref: i.ref }));
    },

    async countScores(weekId) {
      return countAll({
        KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
        FilterExpression: 'attribute_not_exists(#h)',
        ExpressionAttributeNames: HIDDEN_NAME,
        ExpressionAttributeValues: { ':p': 'W#' + weekId, ':s': 'S#' }
      });
    },

    async rankOf(weekId, score) {
      // strictly higher scores sort at or above "<score+1>#"
      const higher = await countAll({
        IndexName: 'byScore',
        KeyConditionExpression: 'gsi1pk = :p AND gsi1sk >= :s',
        FilterExpression: 'attribute_not_exists(#h)',
        ExpressionAttributeNames: HIDDEN_NAME,
        ExpressionAttributeValues: { ':p': 'W#' + weekId, ':s': pad(score + 1, 4) + '#' }
      });
      return 1 + higher;
    },

    async createGroup({ code, createdAt }) {
      try {
        await doc.send(new cmd.PutCommand({
          TableName: table,
          Item: { pk: 'G#' + code, sk: 'META', createdAt, ttl: ttlFrom(createdAt, GROUP_TTL_DAYS) },
          ConditionExpression: 'attribute_not_exists(pk)'
        }));
        return true;
      } catch (e) {
        if (isConditionFailure(e)) return false;
        throw e;
      }
    },

    async getGroup(code) {
      const out = await doc.send(new cmd.GetCommand({ TableName: table, Key: { pk: 'G#' + code, sk: 'META' } }));
      return out.Item ? { code, createdAt: out.Item.createdAt } : null;
    },

    async addMember({ code, deviceId, name, joinedAt }) {
      await doc.send(new cmd.PutCommand({
        TableName: table,
        Item: {
          pk: 'G#' + code, sk: 'M#' + deviceId, name, joinedAt,
          gsi2pk: 'D#' + deviceId, gsi2sk: 'M#' + code,
          ttl: ttlFrom(joinedAt, GROUP_TTL_DAYS)
        }
      }));
    },

    async listMembers(code) {
      const items = await queryAll({
        KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
        ExpressionAttributeValues: { ':p': 'G#' + code, ':s': 'M#' }
      });
      return items.map((i) => ({ deviceId: i.sk.slice(2), name: i.name }));
    },

    async groupScores(code, weekId) {
      const members = await this.listMembers(code);
      const found = [];
      for (let i = 0; i < members.length; i += 100) {
        const request = { [table]: { Keys: members.slice(i, i + 100).map((m) => ({ pk: 'W#' + weekId, sk: 'S#' + m.deviceId })) } };
        // DynamoDB may return unprocessed keys under load; sendBatch retries them.
        const outs = await sendBatch((req) => new cmd.BatchGetCommand({ RequestItems: req }), request, 'UnprocessedKeys');
        outs.forEach((out) => found.push(...((out.Responses && out.Responses[table]) || [])));
      }
      return found
        .filter((i) => !i.hidden)
        .sort((a, b) => b.score - a.score || a.ts - b.ts)
        .map((i) => ({ name: i.name, score: i.score, ref: i.ref }));
    },

    /* ---- user-generated-content safety ---- */
    async getRefInfo(ref) {
      const out = await doc.send(new cmd.GetCommand({ TableName: table, Key: { pk: 'RF#' + ref, sk: 'DEV' } }));
      return out.Item ? { name: out.Item.name, hidden: !!out.Item.hidden } : null;
    },

    async addReport({ ref, reporterRef, reporterDevice, reason, weekId, ts }) {
      let added = true;
      try {
        await doc.send(new cmd.PutCommand({
          TableName: table,
          Item: {
            pk: 'R#' + ref, sk: reporterRef, reason, weekId: weekId || '-', ts,
            gsi2pk: 'D#' + reporterDevice, gsi2sk: 'R#' + ref,
            ttl: ttlFrom(ts, REPORT_TTL_DAYS)
          },
          ConditionExpression: 'attribute_not_exists(pk)'
        }));
      } catch (e) {
        if (!isConditionFailure(e)) throw e;
        added = false;
      }
      const count = await countAll({
        KeyConditionExpression: 'pk = :p',
        ExpressionAttributeValues: { ':p': 'R#' + ref }
      });
      return { added, count };
    },

    // Hides the entry in every week it appears (found through the owning device's index).
    async hideRef(ref) {
      const info = await doc.send(new cmd.GetCommand({ TableName: table, Key: { pk: 'RF#' + ref, sk: 'DEV' } }));
      if (!info.Item) return false;
      await doc.send(new cmd.UpdateCommand({
        TableName: table, Key: { pk: 'RF#' + ref, sk: 'DEV' },
        UpdateExpression: 'SET #h = :t', ExpressionAttributeNames: HIDDEN_NAME, ExpressionAttributeValues: { ':t': true }
      }));
      const owned = await queryAll({
        IndexName: 'byDevice',
        KeyConditionExpression: 'gsi2pk = :d AND begins_with(gsi2sk, :s)',
        ExpressionAttributeValues: { ':d': 'D#' + info.Item.deviceId, ':s': 'S#' }
      });
      for (const item of owned) {
        await doc.send(new cmd.UpdateCommand({
          TableName: table, Key: { pk: item.pk, sk: item.sk },
          UpdateExpression: 'SET #h = :t', ExpressionAttributeNames: HIDDEN_NAME, ExpressionAttributeValues: { ':t': true }
        }));
      }
      return true;
    },

    async banDevice(deviceId) {
      await doc.send(new cmd.UpdateCommand({
        TableName: table, Key: { pk: 'D#' + deviceId, sk: 'KEY' },
        UpdateExpression: 'SET #b = :t', ExpressionAttributeNames: { '#b': 'banned' }, ExpressionAttributeValues: { ':t': true }
      }));
    },

    async isBanned(deviceId) {
      const out = await doc.send(new cmd.GetCommand({ TableName: table, Key: { pk: 'D#' + deviceId, sk: 'KEY' } }));
      return !!(out.Item && out.Item.banned);
    },

    async deleteDevice(deviceId) {
      const owned = await queryAll({
        IndexName: 'byDevice',
        KeyConditionExpression: 'gsi2pk = :d',
        ExpressionAttributeValues: { ':d': 'D#' + deviceId }
      });
      const keys = owned.map((i) => ({ pk: i.pk, sk: i.sk }));
      keys.push({ pk: 'D#' + deviceId, sk: 'KEY' });
      for (let i = 0; i < keys.length; i += 25) {
        const request = { [table]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })) };
        await sendBatch((req) => new cmd.BatchWriteCommand({ RequestItems: req }), request, 'UnprocessedItems');
      }
      return keys.length;
    }
  };
}

module.exports = { createDynamoStore, scoreSortKey, SCORE_TTL_DAYS, GROUP_TTL_DAYS, REPORT_TTL_DAYS };

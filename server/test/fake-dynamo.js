'use strict';
/* fake-dynamo.js — a minimal DynamoDB document-client fake for testing store-dynamo.js.
 * It understands only the expressions the store uses, and it deliberately paginates
 * (2 items per page) and returns unprocessed batch items so retry/paging code is exercised. */

const PAGE = 2;
const BATCH_GET_OK = 2;
const BATCH_WRITE_OK = 3;

class Command { constructor(input) { this.input = input; } }
const cmd = {
  PutCommand: class PutCommand extends Command {},
  GetCommand: class GetCommand extends Command {},
  UpdateCommand: class UpdateCommand extends Command {},
  QueryCommand: class QueryCommand extends Command {},
  BatchGetCommand: class BatchGetCommand extends Command {},
  BatchWriteCommand: class BatchWriteCommand extends Command {}
};

function conditionError() {
  const e = new Error('The conditional request failed');
  e.name = 'ConditionalCheckFailedException';
  return e;
}

function createFakeDynamo(table) {
  const items = new Map();
  const k = (key) => key.pk + '|' + key.sk;
  const calls = { send: 0, unprocessed: 0 };

  function put(input) {
    const existing = items.get(k(input.Item));
    const cond = input.ConditionExpression;
    if (cond === 'attribute_not_exists(pk)') {
      if (existing) throw conditionError();
    } else if (cond === 'attribute_not_exists(pk) OR score < :score') {
      if (existing && !(existing.score < input.ExpressionAttributeValues[':score'])) throw conditionError();
    } else if (cond) {
      throw new Error('fake does not support condition: ' + cond);
    }
    items.set(k(input.Item), { ...input.Item });
    return {};
  }

  function query(input) {
    const v = input.ExpressionAttributeValues || {};
    const expr = input.KeyConditionExpression;
    let rows;
    let sortAttr;
    if (!input.IndexName) {
      sortAttr = 'sk';
      if (expr === 'pk = :p AND begins_with(sk, :s)') rows = [...items.values()].filter((i) => i.pk === v[':p'] && i.sk.startsWith(v[':s']));
      else if (expr === 'pk = :p') rows = [...items.values()].filter((i) => i.pk === v[':p']);
      else throw new Error('fake does not support key condition: ' + expr);
    } else if (input.IndexName === 'byScore') {
      sortAttr = 'gsi1sk';
      rows = [...items.values()].filter((i) => i.gsi1pk === v[':p']);
      if (expr === 'gsi1pk = :p AND gsi1sk >= :s') rows = rows.filter((i) => i.gsi1sk >= v[':s']);
      else assertExpr(expr, 'gsi1pk = :p');
    } else if (input.IndexName === 'byDevice') {
      sortAttr = 'gsi2sk';
      rows = [...items.values()].filter((i) => i.gsi2pk === v[':d']);
      if (expr === 'gsi2pk = :d AND begins_with(gsi2sk, :s)') rows = rows.filter((i) => i.gsi2sk.startsWith(v[':s']));
      else assertExpr(expr, 'gsi2pk = :d');
    } else {
      throw new Error('unknown index ' + input.IndexName);
    }
    rows.sort((a, b) => (a[sortAttr] < b[sortAttr] ? -1 : a[sortAttr] > b[sortAttr] ? 1 : 0));
    if (input.ScanIndexForward === false) rows.reverse();

    // Like DynamoDB: a page reads `size` items FIRST, then the filter drops some of them.
    const size = input.Limit || PAGE;
    const start = input.ExclusiveStartKey || 0; // simple offset paging
    const read = rows.slice(start, start + size);
    const next = start + size < rows.length ? start + size : undefined;
    let page = read;
    if (input.FilterExpression) {
      assertExpr(input.FilterExpression, 'attribute_not_exists(hidden)');
      page = read.filter((i) => i.hidden === undefined);
    }
    return input.Select === 'COUNT'
      ? { Count: page.length, LastEvaluatedKey: next }
      : { Items: page.map((r) => ({ ...r })), Count: page.length, LastEvaluatedKey: next };
  }

  function assertExpr(actual, expected) {
    if (actual !== expected) throw new Error('fake does not support key condition: ' + actual);
  }

  const doc = {
    async send(command) {
      calls.send++;
      const input = command.input;
      if (input.TableName && input.TableName !== table) throw new Error('wrong table');
      if (command instanceof cmd.PutCommand) return put(input);
      if (command instanceof cmd.GetCommand) { const it = items.get(k(input.Key)); return it ? { Item: { ...it } } : {}; }
      if (command instanceof cmd.UpdateCommand) {
        // supports: SET a = :x, #n = :y, ...  (upserts, like DynamoDB's UpdateItem)
        const m = input.UpdateExpression.match(/^SET (.+)$/);
        if (!m) throw new Error('fake does not support update: ' + input.UpdateExpression);
        const names = input.ExpressionAttributeNames || {};
        const vals = input.ExpressionAttributeValues || {};
        let it = items.get(k(input.Key));
        if (!it) { it = { ...input.Key }; items.set(k(input.Key), it); }
        for (const part of m[1].split(',')) {
          const [lhs, rhs] = part.split('=').map((x) => x.trim());
          it[names[lhs] || lhs] = vals[rhs];
        }
        return input.ReturnValues === 'ALL_NEW' ? { Attributes: { ...it } } : {};
      }
      if (command instanceof cmd.QueryCommand) return query(input);
      if (command instanceof cmd.BatchGetCommand) {
        const keys = input.RequestItems[table].Keys;
        const done = keys.slice(0, BATCH_GET_OK);
        const left = keys.slice(BATCH_GET_OK);
        if (left.length) calls.unprocessed++;
        return {
          Responses: { [table]: done.map((key) => items.get(k(key))).filter(Boolean).map((r) => ({ ...r })) },
          UnprocessedKeys: left.length ? { [table]: { Keys: left } } : {}
        };
      }
      if (command instanceof cmd.BatchWriteCommand) {
        const reqs = input.RequestItems[table];
        reqs.slice(0, BATCH_WRITE_OK).forEach((r) => items.delete(k(r.DeleteRequest.Key)));
        const left = reqs.slice(BATCH_WRITE_OK);
        if (left.length) calls.unprocessed++;
        return { UnprocessedItems: left.length ? { [table]: left } : {} };
      }
      throw new Error('fake does not support command ' + command.constructor.name);
    }
  };

  return { doc, cmd, table, items, calls };
}

module.exports = { createFakeDynamo };

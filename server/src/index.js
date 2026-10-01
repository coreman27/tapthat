'use strict';
/* index.js — AWS Lambda entry point (Node runtime provides AWS SDK v3, so no dependencies). */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const lib = require('@aws-sdk/lib-dynamodb');
const { createHandler } = require('./handler');
const { createDynamoStore } = require('./store-dynamo');

const table = process.env.TABLE_NAME;
if (!table) throw new Error('TABLE_NAME is not set');

const doc = lib.DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

exports.handler = createHandler({ store: createDynamoStore({ doc, cmd: lib, table }) });

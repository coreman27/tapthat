'use strict';
/* store-memory.js — in-memory implementation of the store contract (tests, local dev).
 * store-dynamo.js implements the same async interface; test/store-contract.test.js
 * runs one set of behavior tests against this implementation.
 */

function createMemoryStore() {
  const devices = new Map();    // deviceId -> keyHash
  const scores = new Map();     // `${weekId}|${deviceId}` -> { weekId, deviceId, name, score, ts }
  const groups = new Map();     // code -> { code, owner, createdAt }
  const members = new Map();    // `${code}|${deviceId}` -> { code, deviceId, name, joinedAt }

  const scoresForWeek = (weekId) => [...scores.values()].filter((s) => s.weekId === weekId);

  return {
    /* Trust-on-first-use: the first key seen for a device id is remembered; later
       calls must present the same key. Returns true when the key is accepted. */
    async authDevice(deviceId, keyHash) {
      if (!devices.has(deviceId)) { devices.set(deviceId, keyHash); return true; }
      return devices.get(deviceId) === keyHash;
    },

    /* Keeps only the best score per device per week. */
    async putScore({ weekId, deviceId, name, score, ts }) {
      const key = weekId + '|' + deviceId;
      const existing = scores.get(key);
      if (existing && existing.score >= score) {
        if (existing.name !== name) existing.name = name; // allow a renamed display name
        return { improved: false, best: existing.score };
      }
      scores.set(key, { weekId, deviceId, name, score, ts });
      return { improved: true, best: score };
    },

    async getScore(weekId, deviceId) {
      const s = scores.get(weekId + '|' + deviceId);
      return s ? { name: s.name, score: s.score } : null;
    },

    /* Top entries, best first; ties broken by who got there first. No device ids leave the store. */
    async topScores(weekId, limit) {
      return scoresForWeek(weekId)
        .sort((a, b) => b.score - a.score || a.ts - b.ts)
        .slice(0, limit)
        .map((s) => ({ name: s.name, score: s.score }));
    },

    async countScores(weekId) { return scoresForWeek(weekId).length; },

    /* Competition rank: 1 + number of strictly higher scores (ties share a rank). */
    async rankOf(weekId, score) {
      return 1 + scoresForWeek(weekId).filter((s) => s.score > score).length;
    },

    async createGroup({ code, owner, createdAt }) {
      if (groups.has(code)) return false;
      groups.set(code, { code, owner, createdAt });
      return true;
    },
    async getGroup(code) { return groups.get(code) || null; },

    async addMember({ code, deviceId, name, joinedAt }) {
      members.set(code + '|' + deviceId, { code, deviceId, name, joinedAt });
    },
    async listMembers(code) {
      return [...members.values()].filter((m) => m.code === code)
        .map((m) => ({ deviceId: m.deviceId, name: m.name }));
    },

    /* Everyone in the group with a score this week, best first. */
    async groupScores(code, weekId) {
      const out = [];
      for (const m of await this.listMembers(code)) {
        const s = scores.get(weekId + '|' + m.deviceId);
        if (s) out.push({ name: s.name, score: s.score, ts: s.ts });
      }
      return out.sort((a, b) => b.score - a.score || a.ts - b.ts).map(({ name, score }) => ({ name, score }));
    },

    /* Removes everything tied to a device (privacy: right to delete). */
    async deleteDevice(deviceId) {
      let removed = 0;
      for (const [k, s] of [...scores]) if (s.deviceId === deviceId) { scores.delete(k); removed++; }
      for (const [k, m] of [...members]) if (m.deviceId === deviceId) { members.delete(k); removed++; }
      for (const [code, g] of [...groups]) {
        if (g.owner === deviceId) {
          // an owner leaving does not destroy the group for others
          g.owner = null;
        }
      }
      if (devices.delete(deviceId)) removed++;
      return removed;
    }
  };
}

module.exports = { createMemoryStore };

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
  const refs = new Map();       // ref -> { deviceId, name, hidden }  (opaque public id -> device, for moderation)
  const reports = new Map();    // `${ref}|${reporterRef}` -> { ref, reporterRef, reporterDevice, reason, weekId, ts }
  const bans = new Set();       // device ids that may not post

  // Hidden entries (reported or removed) never appear on boards or in counts and ranks.
  const scoresForWeek = (weekId) => [...scores.values()].filter((s) => s.weekId === weekId && !s.hidden);

  return {
    /* Trust-on-first-use: the first key seen for a device id is remembered; later
       calls must present the same key. Returns true when the key is accepted. */
    async authDevice(deviceId, keyHash) {
      if (!devices.has(deviceId)) { devices.set(deviceId, keyHash); return true; }
      return devices.get(deviceId) === keyHash;
    },

    /* Keeps only the best score per device per week. */
    async putScore({ weekId, deviceId, name, score, ts, ref }) {
      const key = weekId + '|' + deviceId;
      const known = refs.get(ref);
      const hidden = !!(known && known.hidden);
      refs.set(ref, { deviceId, name, hidden });
      const existing = scores.get(key);
      if (existing && existing.score >= score) {
        if (existing.name !== name) existing.name = name; // allow a renamed display name
        return { improved: false, best: existing.score };
      }
      scores.set(key, { weekId, deviceId, name, score, ts, ref, hidden });
      return { improved: true, best: score };
    },

    async getScore(weekId, deviceId) {
      const s = scores.get(weekId + '|' + deviceId);
      return s ? { name: s.name, score: s.score, ref: s.ref } : null;
    },

    /* Top entries, best first; ties broken by who got there first. No device ids leave the store. */
    async topScores(weekId, limit) {
      return scoresForWeek(weekId)
        .sort((a, b) => b.score - a.score || a.ts - b.ts)
        .slice(0, limit)
        .map((s) => ({ name: s.name, score: s.score, ref: s.ref }));
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
        if (s && !s.hidden) out.push({ name: s.name, score: s.score, ts: s.ts, ref: s.ref });
      }
      return out.sort((a, b) => b.score - a.score || a.ts - b.ts).map(({ name, score, ref }) => ({ name, score, ref }));
    },

    /* ---- user-generated-content safety ---- */
    async getRefInfo(ref) {
      const r = refs.get(ref);
      return r ? { name: r.name, hidden: r.hidden } : null;
    },

    /* One report per reporter per target. Returns how many distinct reporters there are now. */
    async addReport({ ref, reporterRef, reporterDevice, reason, weekId, ts }) {
      const key = ref + '|' + reporterRef;
      const added = !reports.has(key);
      if (added) reports.set(key, { ref, reporterRef, reporterDevice, reason, weekId, ts });
      const count = [...reports.values()].filter((r) => r.ref === ref).length;
      return { added, count };
    },

    /* Hides every entry for this ref now and for as long as the data exists. */
    async hideRef(ref) {
      const r = refs.get(ref);
      if (!r) return false;
      r.hidden = true;
      for (const s of scores.values()) if (s.ref === ref) s.hidden = true;
      return true;
    },

    async banDevice(deviceId) { bans.add(deviceId); },
    async isBanned(deviceId) { return bans.has(deviceId); },

    /* Removes everything tied to a device (privacy: right to delete). */
    async deleteDevice(deviceId) {
      let removed = 0;
      for (const [k, s] of [...scores]) if (s.deviceId === deviceId) { scores.delete(k); removed++; }
      for (const [k, m] of [...members]) if (m.deviceId === deviceId) { members.delete(k); removed++; }
      for (const [ref, r] of [...refs]) if (r.deviceId === deviceId) { refs.delete(ref); removed++; }
      for (const [k, r] of [...reports]) if (r.reporterDevice === deviceId) { reports.delete(k); removed++; }
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

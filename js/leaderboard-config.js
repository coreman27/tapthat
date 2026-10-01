/* leaderboard-config.js — set apiBase to the deployed leaderboard API URL
 * (Terraform output "api_url", e.g. "https://abc123.execute-api.us-east-1.amazonaws.com").
 * While empty, the online leaderboard is completely disabled: no menu entries, no network
 * calls, no identifiers. Enabling it also requires updating privacy.html and the App Store
 * privacy answers (see server/README.md). */
(function (global) {
  'use strict';
  global.LeaderboardConfig = { apiBase: '' };
})(window);

/* release.test.js — build and upload rules (same as Tableside): the build number goes up on every upload,
 * uploads come from scripts/testflight.sh, and App Store Connect never asks the encryption question.
 * Run: node --test scripts/release.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('Info.plist declares no non-exempt encryption (no "Missing Compliance" on uploads)', () => {
  assert.match(read('ios/App/App/Info.plist'), /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
});

test('one build number for Debug and Release, at or above the last upload (1.1.0 build 15)', () => {
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  const builds = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1]));
  const versions = [...pbx.matchAll(/MARKETING_VERSION = ([0-9.]+);/g)].map((m) => m[1]);
  assert.equal(builds.length, 2);
  assert.equal(new Set(builds).size, 1, 'Debug and Release match');
  assert.ok(builds[0] >= 15, 'never below what App Store Connect already has');
  assert.equal(new Set(versions).size, 1);
});

test('the upload script bumps the build every time, from a clean pushed main, and is valid bash', () => {
  const script = read('scripts/testflight.sh');
  execFileSync('bash', ['-n', path.join(root, 'scripts/testflight.sh')]);
  assert.ok(fs.statSync(path.join(root, 'scripts/testflight.sh')).mode & 0o100, 'executable');
  assert.match(script, /if \[\[ -z "\$build" \]\]; then build=\$\(\(current \+ 1\)\); fi/);
  assert.match(script, /die "build \$build is not above the current \$current"/);
  assert.match(script, /builds come from pushed main commits/);
  assert.match(script, /npm test/, 'tests run before anything is archived');
  assert.match(script, /npx cap sync ios/, 'the latest web code goes into the build');
  assert.match(read('ios/App/ExportOptions.plist'), /<key>manageAppVersionAndBuildNumber<\/key>\s*<false\/>/,
    'the project, not Xcode, decides the build number');
});

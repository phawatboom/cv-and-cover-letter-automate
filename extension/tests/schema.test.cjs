const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
const hostPermissions = manifest.host_permissions.filter((value) => value.startsWith('https:'));
const matches = manifest.content_scripts[0].matches;
assert.deepEqual(hostPermissions.filter((value) => !matches.includes(value)), [], 'Every declared ATS host should auto-load');
assert.equal(new Set(matches).size, matches.length, 'Content-script host matches should be unique');

const optionsJs = fs.readFileSync(path.join(extensionRoot, 'options', 'options.js'), 'utf8');
const optionsHtml = fs.readFileSync(path.join(extensionRoot, 'options', 'options.html'), 'utf8');
const fieldBlock = optionsJs.match(/const PROFILE_FIELDS = \[([\s\S]*?)\];/);
assert.ok(fieldBlock, 'PROFILE_FIELDS should exist');
const fields = Array.from(fieldBlock[1].matchAll(/'([^']+)'/g), (match) => match[1]);
const ids = Array.from(optionsHtml.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
assert.deepEqual(fields.filter((field) => !ids.includes(field)), [], 'Every profile key should have a settings control');
assert.equal(new Set(ids).size, ids.length, 'Settings ids should be unique');

console.log(`extension schema: ok (${fields.length} profile fields, ${matches.length} automatic hosts)`);

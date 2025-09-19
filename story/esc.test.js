#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const start = source.indexOf('const esc =');
if (start === -1) {
  throw new Error('esc helper not found in app.js');
}
const sectionMarker = '  /* ======================';
const after = source.indexOf(sectionMarker, start);
const declaration = source.slice(start, after === -1 ? undefined : after).trim();
const expression = declaration.replace(/^const esc = /, '').trim().replace(/;$/, '');
const esc = eval(expression);

const sample = "Rock & Roll < 50% > \"Quotes\" 'Single'";
const expected = 'Rock &amp; Roll &lt; 50% &gt; &quot;Quotes&quot; &#39;Single&#39;';
const actual = esc(sample);
assert.strictEqual(actual, expected);
assert.strictEqual(esc(null), '');
assert.strictEqual(esc(undefined), '');

console.log('esc helper properly escapes HTML entities');

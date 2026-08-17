#!/usr/bin/env node
/**
 * Regenerates register.json from the DOCS array hardcoded in index.html.
 *
 * The tracker is a single-file React app; its Documented Information Register
 * lives in a JS array inside index.html, which is too large to fetch and parse
 * remotely. This script publishes that array as a small standalone artifact so
 * external consumers (the weekly change detector, the local PowerShell filer)
 * can read the register without parsing a 700 KB document.
 *
 * Output is a bare JSON array, key order fixed, 2-space indent, trailing
 * newline. That makes the file byte-stable: if register.json changes, the
 * register genuinely changed. Do not add a generation timestamp here — it
 * would churn the file on every run and destroy that property.
 *
 * Usage: node tools/extract-register.js [--check]
 *   --check  exit 1 if register.json is out of date, write nothing
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'index.html');
const TARGET = path.join(ROOT, 'register.json');

// Register phase -> on-disk folder. Anything unmapped passes through unchanged.
const FOLDER_ALIAS = {
  'Gap assessment': 'Gap Assessment',
  'SoA and support': 'SoA and Support',
  'Operation': 'Operations',
};

// Must stay byte-identical to the tracker's own download filename rule,
// otherwise filed documents get renamed on every sync run.
const stemOf = (id, name) => id + '_' + name.replace(/[^a-z0-9]+/gi, '-').slice(0, 52);

function findArrayLiteral(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`marker not found: ${marker}`);
  const start = at + marker.length - 1; // position of the opening [
  let depth = 0, inStr = false, quote = '', esc = false;
  for (let p = start; p < src.length; p++) {
    const c = src[p];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = true; quote = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { if (--depth === 0) return src.slice(start, p + 1); }
  }
  throw new Error('unbalanced brackets while scanning ' + marker);
}

function main() {
  if (!fs.existsSync(SOURCE)) {
    // index.html is deleted and re-uploaded as two separate commits by the
    // GitHub web UI. Do not clobber register.json on the intermediate state.
    console.log('index.html absent — leaving register.json untouched');
    return 0;
  }

  const literal = findArrayLiteral(fs.readFileSync(SOURCE, 'utf8'), 'const DOCS = [');
  const docs = new Function('return (' + literal + ');')();

  if (!Array.isArray(docs) || docs.length === 0) throw new Error('DOCS parsed but empty');
  for (const d of docs) {
    for (const k of ['id', 'name', 'ph', 'ob', 'ref']) {
      if (typeof d[k] !== 'string' || !d[k]) throw new Error(`${d.id || '?'}: missing field "${k}"`);
    }
  }
  const ids = docs.map(d => d.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error('duplicate ids: ' + [...new Set(dupes)].join(', '));

  const register = docs.map(d => ({
    id: d.id,
    name: d.name,
    phase: d.ph,
    folder: FOLDER_ALIAS[d.ph] || d.ph,
    obligation: d.ob,
    ref: d.ref,
    stem: stemOf(d.id, d.name),
  }));

  const next = JSON.stringify(register, null, 2) + '\n';
  const prev = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : null;

  if (process.argv.includes('--check')) {
    if (prev === next) { console.log(`register.json up to date (${register.length} documents)`); return 0; }
    console.error('register.json is STALE — run: node tools/extract-register.js');
    return 1;
  }

  if (prev === next) { console.log(`register.json unchanged (${register.length} documents)`); return 0; }
  fs.writeFileSync(TARGET, next);
  console.log(`register.json written — ${register.length} documents, ${new Set(register.map(r => r.phase)).size} phases`);
  return 0;
}

try { process.exit(main()); }
catch (err) { console.error('extract-register failed:', err.message); process.exit(2); }

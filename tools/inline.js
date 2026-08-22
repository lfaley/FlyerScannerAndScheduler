/**
 * tools/inline.js — sync the css/ source files into index.html's <style> block.
 *
 *   node tools/inline.js          # rewrite index.html from css/*.css
 *   node tools/inline.js --check  # exit 1 if the inlined copy has drifted
 *
 * Why inlining exists at all: index.html ships as ONE self-contained file.
 * Real <link>/<script type=module> loading broke the installed iOS PWA in
 * production (v8.1–v8.5 blank-screen incident) — a failed subresource kills
 * the app with no visible error. So source lives in small files (css/, js/),
 * and the shipped file carries inlined copies. This script does the CSS side
 * mechanically so nobody ever hand-syncs; tests-modules.js fails the build if
 * the copies drift anyway (belt and braces).
 *
 * The js/ side predates this script and is still inlined by hand; extending
 * this script to cover js/ too is welcome future work. Whatever it covers,
 * the output must stay INLINE -- never emit a <link> or a module import.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
const files = ['tokens.css', 'components.css']; // order matters: tokens first

const stripHeader = (s) => s.replace(/^\/\*[\s\S]*?\*\/\n/, ''); // file-top comment stays in source only
const css = files
  .map(f => stripHeader(fs.readFileSync(path.join(root, 'css', f), 'utf8')).trim())
  .join('\n');

const html = fs.readFileSync(htmlPath, 'utf8');
const before = html.split('<style>')[0];
const after = html.split('</style>').slice(1).join('</style>');
const current = html.split('<style>')[1].split('</style>')[0];

const wanted = '\n  ' + css.replace(/\n/g, '\n') + '\n';
const norm = s => s.replace(/\s+/g, ' ').trim();

if (process.argv.includes('--check')) {
  if (norm(current) === norm(css)) { console.log('inline check: in sync'); process.exit(0); }
  console.error('inline check: index.html <style> has drifted from css/ — run: node tools/inline.js');
  process.exit(1);
}

fs.writeFileSync(htmlPath, before + '<style>' + wanted + '</style>' + after);
console.log('synced', files.join(' + '), '->', 'index.html <style> (' + css.length + ' bytes)');

/**
 * P6 — One-way doors.  CODE-REVIEW-PLAN.md phase 6.
 *
 *   node tools/p6-oneway.js
 *
 * Question: what can the user do that they cannot undo, see, or reverse?
 *
 * The trigger for this whole review belongs to this class. Logan asked how to
 * dismiss a clash warning; he already could, from two different controls, and
 * once dismissed there was no way back at all.
 *
 * THE STANDARD, taken from a case in the app that gets it RIGHT:
 * `settings.seenMsgs` is the same SHAPE as the defects -- a growing list that
 * suppresses things -- and it is not a defect, because forgetImportedEmails()
 * clears it and the count is shown on the button. So:
 *
 *     suppression is fine; suppression with no way back is the bug.
 *
 * Three questions per key:
 *   UNDO     -- can the user reverse it immediately after doing it?
 *   VISIBLE  -- can they see what they have suppressed?
 *   CLEAR    -- is there any path that empties it?
 * Three "no"s is a finding.
 *
 * A. Every S.settings.* key.
 * B. Every boolean the app sets on a record (deleted, handled, exported, ...).
 */
'use strict';
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const openTag = html.includes('<script type="module">') ? '<script type="module">' : '<script>';
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const raw = html.split(openTag)[1].split('</script>')[0];
const code = strip(raw);
const at = (needle) => { const i = raw.indexOf(needle); return i < 0 ? '?' : raw.slice(0, i).split('\n').length + html.split(openTag)[0].split('\n').length - 1; };

console.log('== A. every S.settings key: written, read, cleared? ==');
const keys = new Set([...code.matchAll(/S\.settings\.(\w+)/g)].map(m => m[1]));
const rows = [];
for (const k of [...keys].sort()) {
  const w = [...code.matchAll(new RegExp('S\\.settings\\.' + k + '\\s*(?:=[^=]|\\.push\\()', 'g'))].length;
  const r = [...code.matchAll(new RegExp('S\\.settings\\.' + k + '\\b', 'g'))].length - w;
  // A "clear" is an assignment of an empty value, or a delete.
  // CORRECTION #1: the emptiness test ended in \b. For `= []`, `= {}`, `= ''`
  // the last character is not a word character and the next is `;`, so \b could
  // never match and EVERY list key -- including seenMsgs, which
  // forgetImportedEmails() plainly empties -- was reported as never cleared.
  //
  // CORRECTION #2, caught because the fixed version disagreed with two findings
  // already confirmed by hand: an empty assignment is NOT a clear when it is a
  // LAZY INITIALISER. `if(!S.settings.notDuplicates) S.settings.notDuplicates = []`
  // and `S.settings.dismissedConflicts || (S.settings.dismissedConflicts = [])`
  // both assign `[]`, and both mean "create it", not "empty it". Counting them
  // as clears would have overturned P6-01 and P6-02 -- the two findings this
  // whole phase was seeded with. An empty write is only a CLEAR when nothing
  // immediately before it tests the same key for absence.
  const empties = [...code.matchAll(new RegExp(
    'S\\.settings\\.' + k + '\\s*=\\s*(?:\\[\\s*\\]|\\{\\s*\\}|\'\'|""|null|false|0)\\s*[;,)\\n]', 'g'))];
  const isLazyInit = (m) => {
    const before = code.slice(Math.max(0, m.index - 90), m.index);
    return new RegExp('!\\s*S\\.settings\\.' + k + '\\b').test(before)
        || new RegExp('S\\.settings\\.' + k + '\\s*\\|\\|').test(before);
  };
  const cleared = empties.some(m => !isLazyInit(m))
               || new RegExp('delete\\s+S\\.settings\\.' + k).test(code);
  rows.push({ k, w, r, cleared });
}
// A scalar preference (theme, provider, model) always holds a value and can
// always be set to another one -- it is not a door. The question only bites on
// keys that ACCUMULATE suppression: arrays that grow, and off-switches.
const ACCUM = new Set(['dismissedConflicts','notDuplicates','seenMsgs','senderTags',
                       'exportQueue','starCarry','errorReportsOff','nudgeSnooze']);
console.log('\n   -- the keys that can actually be one-way doors --');
rows.filter(x => ACCUM.has(x.k)).forEach(x => console.log(
  `   ${x.k.padEnd(20)} ${x.cleared ? 'CLEARABLE' : 'NO WAY BACK IN CODE'}`));
rows.forEach(x => console.log(
  `   ${x.k.padEnd(20)} writes ${String(x.w).padStart(2)}  reads ${String(x.r).padStart(2)}  ` +
  `${x.cleared ? 'has a clearing write' : 'NO CLEARING WRITE ANYWHERE'}`));
console.log(`   ${rows.length} keys; ${rows.filter(x => !x.cleared).length} with no clearing write.`);

console.log('\n== B. record flags the app sets, and whether anything unsets them ==');
const flags = ['deleted', 'handled', 'exported', 'done', 'dirty', 'unread', 'checked', 'pinned', 'resolved'];
flags.forEach(f => {
  const on  = [...code.matchAll(new RegExp('\\.' + f + '\\s*=\\s*true', 'g'))].length;
  const off = [...code.matchAll(new RegExp('\\.' + f + '\\s*=\\s*false', 'g'))].length;
  const tog = [...code.matchAll(new RegExp('\\.' + f + '\\s*=\\s*![^=]', 'g'))].length;
  const del = [...code.matchAll(new RegExp('delete\\s+\\w+\\.' + f, 'g'))].length;
  console.log(`   ${f.padEnd(10)} set true ${String(on).padStart(2)}   set false ${String(off).padStart(2)}   ` +
              `toggled ${String(tog).padStart(2)}   deleted ${String(del).padStart(2)}` +
              `${on && !off && !tog && !del ? '   <-- ONE WAY' : ''}`);
});

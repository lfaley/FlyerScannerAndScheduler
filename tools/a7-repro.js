// A7 reproduction, kept because three code comments cite it.
//
// Runs the OLD matchListItems (pasted verbatim, frozen) and the CURRENT one
// side by side on the same list, and prints what each does. No assertions --
// the tests in tests-cases.js do that. This is the measurement they were
// written from, and re-running it is how you check the claim rather than
// trusting the comment.
//
//   node tools/a7-repro.js
const fs = require('fs');
const path = require('path');

// --- resolveEntity, lifted out of js/intents.js so this needs no bundler -----
const intents = fs.readFileSync(path.join(__dirname, '..', 'js', 'intents.js'), 'utf8');
const shim = intents.slice(intents.indexOf('const norm = (s)')).replace(/export function/g, 'function');
const resolveEntity = new Function(shim + '\nreturn resolveEntity;')();

// --- the OLD one, frozen. This is what shipped up to v9.97. -----------------
function oldMatch(spoken, items){
  const live = (items || []).filter(i => i && !i.deleted);
  const matched = [];
  const missing = [];
  for(const word of (Array.isArray(spoken) ? spoken : [])){
    const res = resolveEntity(word, live, 'text');
    if(res.status === 'ok' && !matched.some(m => m.id === res.match.id)) matched.push(res.match);
    else if(res.status === 'ambiguous'){
      const first = res.matches.find(m => !matched.some(x => x.id === m.id));
      if(first) matched.push(first); else missing.push(String(word));
    }
    else missing.push(String(word));
  }
  return { matched, missing, ambiguous:null };
}

// --- the CURRENT one, read from the module rather than copied ---------------
const mod = fs.readFileSync(path.join(__dirname, '..', 'js', 'assistant-actions.js'), 'utf8');
const from = mod.indexOf('export function matchListItems');
const to = mod.indexOf('\n}', mod.indexOf('return { matched, missing, ambiguous:null, rest:[] };', from)) + 2;
const newMatch = new Function('resolveEntity',
  mod.slice(from, to).replace('export function', 'function') + '\nreturn matchListItems;')(resolveEntity);

const it = (id, text) => ({ id, text, checked:false, deleted:false });
const LIST = [it('m1','Whole milk'), it('m2','Almond milk'), it('b1','Bread'), it('e1','Eggs')];

const line = (fn, spoken) => {
  const r = fn(spoken, LIST);
  const ticks = r.matched.map(m => m.text);
  const ask = r.ambiguous ? `ASKS which "${r.ambiguous.word}" (${r.ambiguous.matches.map(m => m.text).join(' / ')})` : '';
  return [
    'ticks ' + JSON.stringify(ticks),
    r.missing.length ? 'missing ' + JSON.stringify(r.missing) : '',
    ask,
  ].filter(Boolean).join('; ');
};

console.log('list: ' + LIST.map(i => i.text).join(' | ') + '\n');
[
  ['(a) one ambiguous word',           ['milk']],
  ['(c) the same word twice',          ['milk', 'milk']],
  ['(b) two words, one row',           ['bread', 'Bread']],
  ['    a word that is not there',     ['milk', 'cheese']],
  ['    one milk named, then "milk"',  ['whole milk', 'milk']],
].forEach(([label, spoken]) => {
  console.log(label + '  ' + JSON.stringify(spoken));
  console.log('  before: ' + line(oldMatch, spoken));
  console.log('  now:    ' + line(newMatch, spoken) + '\n');
});

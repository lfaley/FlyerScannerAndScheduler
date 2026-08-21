/**
 * Declaration extractor: moves top-level declarations out of a script into a
 * module. This is a REFACTORING ENGINE, and the literature is unambiguous that
 * such engines are buggy in practice -- Soares et al. analysed 153,444
 * transformations across Eclipse JDT, NetBeans and JastAdd and found 57
 * compilation-error bugs and 63 behavioural-change bugs.
 *
 * The two classical failure modes, both of which this tool has already
 * exhibited:
 *
 *   OVERLY WEAK PRECONDITIONS  - the tool applies a transformation it should
 *                                have refused. Ours swallowed 3,010 lines
 *                                because a naive brace counter was defeated by
 *                                '{' inside a string literal.
 *
 *   OVERLY STRONG PRECONDITIONS - the tool refuses a transformation that is
 *                                perfectly valid. Ours rejects any declaration
 *                                over a line cap, which would refuse a long but
 *                                well-formed function.
 *
 * Every precondition below is therefore paired with a test that it is neither
 * too weak nor too strong.
 */
'use strict';

/** Result shape. `ok:false` must ALWAYS leave the input untouched. */
function fail(reason){ return { ok:false, reason }; }

/**
 * Find the end of a braced body starting at `open`, respecting the contexts in
 * which a brace is not a brace: strings, template literals, regex literals and
 * comments. A counter that ignores these is the single most common cause of
 * over-grabbing.
 */
function endOfBody(src, open){
  let depth = 0, i = open;
  const n = src.length;
  while(i < n){
    const c = src[i];

    if(c === '"' || c === "'"){
      const q = c; i++;
      while(i < n && src[i] !== q){ if(src[i] === '\\') i++; i++; }
      if(i >= n) return fail('unterminated string');
    }
    else if(c === '`'){
      i++;
      while(i < n && src[i] !== '`'){
        if(src[i] === '\\'){ i += 2; continue; }
        // ${ ... } inside a template can itself contain braces and strings
        if(src[i] === '$' && src[i+1] === '{'){
          const inner = endOfBody(src, i + 1);
          if(!inner.ok) return inner;
          i = inner.end; continue;
        }
        i++;
      }
      if(i >= n) return fail('unterminated template literal');
    }
    else if(c === '/' && src[i+1] === '/'){
      while(i < n && src[i] !== '\n') i++;
    }
    else if(c === '/' && src[i+1] === '*'){
      const close = src.indexOf('*/', i);
      if(close < 0) return fail('unterminated block comment');
      i = close + 1;
    }
    else if(c === '/' && isRegexPosition(src, i)){
      i++;
      let inClass = false;
      while(i < n){
        if(src[i] === '\\'){ i += 2; continue; }
        if(src[i] === '[') inClass = true;
        else if(src[i] === ']') inClass = false;
        else if(src[i] === '/' && !inClass) break;
        else if(src[i] === '\n') return fail('unterminated regex');
        i++;
      }
      if(i >= n) return fail('unterminated regex');
    }
    else if(c === '{') depth++;
    else if(c === '}'){
      depth--;
      if(depth === 0) return { ok:true, end: i + 1 };
    }
    i++;
  }
  return fail('unbalanced braces');
}

/** A '/' starts a regex only where a value is expected, not after one. */
function isRegexPosition(src, i){
  let j = i - 1;
  while(j >= 0 && /\s/.test(src[j])) j--;
  if(j < 0) return true;
  return '(,=:[!&|?{};+-*%~^'.includes(src[j]) ||
         /\b(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield)$/
           .test(src.slice(Math.max(0, j - 10), j + 1));
}

/** Locate one top-level declaration, including any comments directly above it. */
function locate(src, name){
  const re = new RegExp(
    '(^|\\n)(function\\s+' + name + '\\s*\\(|(?:const|let|var)\\s+' + name + '\\s*=)');
  const m = re.exec(src);
  if(!m) return fail('not found: ' + name);

  const declStart = m.index + (m[1] ? m[1].length : 0);

  // Only take comments that sit immediately above with no blank line between,
  // otherwise an unrelated section header is dragged along.
  const before = src.slice(0, declStart).split('\n');
  let k = before.length - 1;
  while(k > 0 && before[k - 1].trim().startsWith('//')) k--;
  const start = before.slice(0, k).join('\n').length + (k > 0 ? 1 : 0);

  const afterDecl = src.slice(declStart);
  const isTemplateConst = /^(?:const|let|var)\s+[\w$]+\s*=\s*`/.test(afterDecl);

  // A value declaration with no braced body ends at its semicolon. Without
  // this, the code hunts for the next '{' ANYWHERE later in the file and takes
  // everything up to its match -- which is how `let S = load();` was dragged
  // along with `const SCHEMA_VERSION = 4;`.
  const simpleValue = /^(?:const|let|var)\s+[\w$]+\s*=\s*[^{`]/.test(afterDecl);
  if(simpleValue && !/^(?:const|let|var)\s+[\w$]+\s*=\s*(?:function|\([^)]*\)\s*=>|[\w$]+\s*=>)/.test(afterDecl)){
    const semi = src.indexOf(';', declStart);
    if(semi < 0) return fail('no terminator for ' + name);
    return { ok:true, start, end: semi + 1, text: src.slice(start, semi + 1) };
  }

  let end;
  if(isTemplateConst){
    const tick = src.indexOf('`', declStart);
    const body = endOfTemplate(src, tick);
    if(!body.ok) return body;
    const semi = src.indexOf(';', body.end);
    end = semi >= 0 && semi < body.end + 3 ? semi + 1 : body.end;
  } else {
    const brace = src.indexOf('{', declStart);
    if(brace < 0) return fail('no body found for ' + name);
    const body = endOfBody(src, brace);
    if(!body.ok) return body;
    end = body.end;
  }
  return { ok:true, start, end, text: src.slice(start, end) };
}

function endOfTemplate(src, tick){
  let i = tick + 1;
  while(i < src.length){
    if(src[i] === '\\'){ i += 2; continue; }
    if(src[i] === '`') return { ok:true, end: i + 1 };
    if(src[i] === '$' && src[i+1] === '{'){
      const inner = endOfBody(src, i + 1);
      if(!inner.ok) return inner;
      i = inner.end; continue;
    }
    i++;
  }
  return fail('unterminated template literal');
}

/**
 * Extract several declarations at once.
 *
 * ATOMIC: if any single name cannot be located, NOTHING is moved. The empirical
 * study of refactoring-engine bugs names "Failed Refactoring" -- the engine
 * "either makes no change to the original program or only partially completes
 * the refactoring" -- as a distinct bug class with 23 instances. A partially
 * applied extraction leaves the codebase in a state neither the tool nor the
 * developer intended, which is worse than refusing outright.
 */
function extract(src, names){
  if(!Array.isArray(names) || !names.length) return fail('no names given');

  const found = [];
  for(const name of names){
    const hit = locate(src, name);
    if(!hit.ok) return fail(hit.reason);          // atomic: give up entirely
    found.push({ name, ...hit });
  }

  // Overlapping ranges mean a nested or duplicated match; refuse rather than
  // corrupt. (A duplicate declaration is itself a bug worth surfacing.)
  // Compare every pair, not just neighbours: a nested declaration is fully
  // CONTAINED in its parent, and containment is not caught by only checking
  // whether each range starts before the previous one ended.
  for(let i = 0; i < found.length; i++){
    for(let j = i + 1; j < found.length; j++){
      const a = found[i], b = found[j];
      const overlap = a.start < b.end && b.start < a.end;
      if(overlap) return fail('overlapping declarations: ' + a.name + ' and ' + b.name);
    }
  }
  const sorted = [...found].sort((a, b) => a.start - b.start);

  // Remove back-to-front so earlier offsets stay valid.
  let remainder = src;
  for(let i = sorted.length - 1; i >= 0; i--){
    remainder = remainder.slice(0, sorted[i].start) + remainder.slice(sorted[i].end);
  }

  return {
    ok: true,
    moved: found.map(f => f.text),
    remainder,
    movedLines: found.reduce((n, f) => n + f.text.split('\n').length, 0)
  };
}

module.exports = { extract, locate, endOfBody, isRegexPosition };

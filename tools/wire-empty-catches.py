#!/usr/bin/env python3
"""v9.74 - every empty catch states why it is empty, and one of them was wrong.

The Aug 2026 review wanted this rule and could not add it: the guard fails until
the catches are annotated, so the annotation had to come first. Seventeen of
them, read one at a time.

THE POINT IS NOT TIDINESS. The Gmail watcher swallowing every email began as a
line nobody had to justify. An empty catch is a decision -- "this failure does
not matter" -- and a decision with no reason written next to it is one nobody can
check later. Fifteen of these turned out to be right. One was defensible but
under-stated. ONE WAS WRONG:

  startFresh() (:4051) swallows a failure from localStorage.removeItem and
  then renders an empty app. In private mode, or with storage access denied,
  the removals throw, every `flyersnap*` key survives -- SNAPSHOTS AND THE
  GORDON SESSION TOKEN INCLUDED -- and the user, who has just confirmed twice
  that they want everything erased, is shown a blank app as if it had worked.
  Exactly the shape of P4-01, where sign-out reported a security outcome it had
  never checked. It now verifies and says so when it could not.

The other sixteen keep their behaviour and gain their reason. Three kinds:

  * CARET RESTORE (5x) -- setSelectionRange throws on an input type that has no
    selection API. Losing the caret is worse than nothing but is not a failure
    worth reporting.
  * BEST-EFFORT PARSE (4x) -- the very next line checks the result for null and
    handles it. The catch is the null path, not a swallow.
  * STORAGE ENUMERATION (3x) -- diagnostics that must never be the reason the
    app cannot show a diagnostic screen.
"""
import sys

fail = []
buf = {}

def _get(path):
    if path not in buf:
        buf[path] = open(path).read()
    return buf[path]

def rep(path, o, n, c=1):
    src = _get(path)
    got = src.count(o)
    if got != c:
        fail.append(f'{path}: expected {c}x {o[:90]!r}, found {got}')
        return
    buf[path] = src.replace(o, n)

p = 'index.html'

# ---------------------------------------------------------------- caret restore
rep(p, """setSelectionRange(caret, caret); }catch(e){}""",
    """setSelectionRange(caret, caret); }catch(e){ /* no selection API on this input type; losing the caret beats throwing */ }""", 4)
rep(p, """try{ box.setSelectionRange(box.value.length, box.value.length); }catch(e){}""",
    """try{ box.setSelectionRange(box.value.length, box.value.length); }catch(e){ /* no selection API on this input type; the text is in, only the caret moved */ }""")
rep(p, """try{ b.setSelectionRange(b.value.length, b.value.length); }catch(e){}""",
    """try{ b.setSelectionRange(b.value.length, b.value.length); }catch(e){ /* no selection API on this input type; the line is added either way */ }""")

# ---------------------------------------------------------------- best-effort parse
rep(p, """    try{ env = JSON.parse(raw); }catch(e){}""",
    """    try{ env = JSON.parse(raw); }catch(e){ /* `if(!env)` below IS the failure path: it prints the unparseable text */ }""")
rep(p, """    try{ parsed = JSON.parse(out); }catch(e){}""",
    """    try{ parsed = JSON.parse(out); }catch(e){ /* a non-JSON reply is a FAILED self-test, reported by `gotOne` below, not an error here */ }""")
rep(p, """    let host = url; try{ host = new URL(url).hostname.replace(/^www\\./,''); }catch(e){}""",
    """    let host = url; try{ host = new URL(url).hostname.replace(/^www\\./,''); }catch(e){ /* not a URL: `host` keeps the raw string, which is what we wanted to show */ }""")
rep(p, """    try{ watchedSenders = await fetchSenders(); render(); }catch(e){}""",
    """    try{ watchedSenders = await fetchSenders(); render(); }catch(e){ /* already inside the failure path: the alert above told the user. A second failure here leaves the stale list, which is the honest thing to show */ }""")

# ---------------------------------------------------------------- storage writes
rep(p, """function saveGordonSession(s){ try{ localStorage.setItem(GORDON_SESSION_KEY, JSON.stringify(s)); }catch(e){} }""",
"""// Storage refusing this is not silent in effect: the NEXT gordonAuthToken()
// finds no session and the user is asked to sign in again. Reporting it here
// would fire mid-sign-in, before the app knows whether it matters.
function saveGordonSession(s){ try{ localStorage.setItem(GORDON_SESSION_KEY, JSON.stringify(s)); }catch(e){ /* see above: the next token read surfaces it */ } }""")

rep(p, """  try{ localStorage.setItem(ERROR_OUTBOX_LS, JSON.stringify(list.slice(-ERROR_OUTBOX_MAX))); }catch(e){}""",
    """  try{ localStorage.setItem(ERROR_OUTBOX_LS, JSON.stringify(list.slice(-ERROR_OUTBOX_MAX))); }catch(e){ /* THE ERROR REPORTER MUST NOT THROW. A failure here would be reported through the thing that just failed (CLAUDE.md rule 28) */ }""")
rep(p, """try{ if(errorOutboxRead().length) setTimeout(() => { flushErrorReports(); }, 8000); }catch(e){}""",
    """try{ if(errorOutboxRead().length) setTimeout(() => { flushErrorReports(); }, 8000); }catch(e){ /* runs at BOOT. Nothing here may stop the app starting -- the v8.1-v8.5 blank screen began as a boot-time throw */ }""")

# ---------------------------------------------------------------- diagnostics
rep(p, """      if(k && k.indexOf(SNAP_PREFIX) === 0) out.push(k);
    }
  }catch(e){}""",
"""      if(k && k.indexOf(SNAP_PREFIX) === 0) out.push(k);
    }
  }catch(e){ /* enumeration can throw where storage is partitioned. An empty list means "no snapshots found", which is the safe reading -- it can only cause the app to keep MORE than it needed */ }""")

rep(p, """      n += k.length + (localStorage.getItem(k)||'').length;
    }
  }catch(e){}""",
"""      n += k.length + (localStorage.getItem(k)||'').length;
    }
  }catch(e){ /* a size READING. An under-count shows a smaller bar on the storage screen; it changes nothing the app does */ }""")

rep(p, """      if(k && k.indexOf('flyersnap') === 0) dump[k] = localStorage.getItem(k);
    }
  }catch(e){}""",
"""      if(k && k.indexOf('flyersnap') === 0) dump[k] = localStorage.getItem(k);
    }
  }catch(e){ /* the rescue download is a LAST RESORT, reached when things are already broken. A partial dump is worth more than a thrown one */ }""")

# ---------------------------------------------------------------- the wrong one
rep(p, """  try{
    const keys = [];
    for(let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if(k && k.indexOf('flyersnap') === 0) keys.push(k);
    }
    keys.forEach(k=>localStorage.removeItem(k));
  }catch(e){}
  S = blank();
  loadError = null;
  view = {tab:'events', sub:null, data:null};
  save(); render();
}""",
"""  // THE ONE EMPTY CATCH THAT WAS WRONG (v9.74).
  //
  // This used to swallow the failure and render a blank app regardless. In
  // private mode, or with storage access denied, every removeItem throws: the
  // snapshots survive, the GORDON SESSION TOKEN survives, and the user -- who
  // has just confirmed twice that they want everything erased -- is shown an
  // empty app as proof that it worked. That is P4-01 exactly: asserting an
  // outcome nobody checked, about the one thing where being wrong matters.
  //
  // Verify, then say what is actually true.
  let left = [];
  try{
    const keys = [];
    for(let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if(k && k.indexOf('flyersnap') === 0) keys.push(k);
    }
    keys.forEach(k => { try{ localStorage.removeItem(k); }catch(e){ left.push(k); } });
    // Read back rather than trusting the writes: removeItem can resolve without
    // removing where storage is partitioned.
    for(let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if(k && k.indexOf('flyersnap') === 0 && left.indexOf(k) < 0) left.push(k);
    }
  }catch(e){
    left = ['(storage could not be read)'];
  }
  S = blank();
  loadError = null;
  view = {tab:'events', sub:null, data:null};
  save(); render();
  if(left.length){
    logProblem('Storage', 'Erase everything did not remove all data',
      left.length + ' key(s) survived: ' + left.slice(0, 8).join(', '));
    alert('Not everything could be erased.\\n\\nThis browser refused to remove '
      + left.length + ' item' + (left.length === 1 ? '' : 's')
      + ', which may include a saved sign-in. Clear this site\\u2019s data in your '
      + 'browser settings to finish.');
  }
}""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
for path, text in buf.items():
    open(path, 'w').write(text)
print('empty catches annotated ->', ', '.join(sorted(buf)))

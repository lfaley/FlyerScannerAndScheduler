#!/usr/bin/env python3
"""CLAUDE.md rules 29-33, and the test-count line brought back to the truth.

Five things bit during v9.68-v9.75 that the file has no record of. Every one of
them cost real time, and three of them are repeats of rules that already exist --
which is the argument for writing down the SHAPE rather than the instance.
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

p = 'CLAUDE.md'

RULES = """29. AN EMPTY COLLECTION IS TRUTHY, AND A QUESTION WITH NO ANSWERS IS NOT A
   QUESTION. `askWhich('lists', liveLists())` with no lists rendered "Which one
   did you mean?", zero buttons and a "Neither" link -- because `[]` passed the
   `t.choices &&` gate. The same shape shipped twice more: a clash banner whose
   only "choice" was to destroy three events, and a notes filter bar drawn over
   an empty vocabulary. Before rendering a chooser, check `.length`, not
   truthiness, and have a sentence ready for the case where there is nothing to
   choose between.
30. A GUARD THAT PASSES FOR THE WRONG REASON IS WORSE THAN NO GUARD, AND YOU
   ONLY FIND OUT BY MUTATING IT. Four times in this stretch: a key-pinning test
   that passed because `removeFromClash` filters by membership anyway, so
   deleting the pin killed nothing; a `clarifyChoices` test that called the
   helper directly and never checked the app used it, so reverting the call
   site was invisible; a `deploy.ps1` guard that matched its own comment
   ("clasp pushes a DIRECTORY") rather than the call; and a probe whose "no
   AbortController" setup failure read as the finding it was aimed at. EVERY
   new guard gets its mutation run, and the mutation must be a real revert of
   the fix -- not a variant that happens to trip something else.
31. ASYNC TESTS INTERLEAVE WITH SYNC ONES, SO NOTHING GLOBAL SURVIVES AN
   `await`. The harness registers async tests in `pendingTests` and carries on
   running the sync ones, so `boot(null)` in a later test replaces `S` while an
   earlier async test is suspended. A probe that set `S.settings.localModel`,
   awaited, and read it back got the DEFAULT and "failed" for a reason that had
   nothing to do with the app. Two consequences: write tests that read no
   global state after an await, and treat "the value is the default" in an
   async test as a harness question before it is a product one. The app fix
   that fell out of this is real and general -- `probeLocalContext` now reads
   its inputs once, up front, because the user can change the settings while a
   request is in flight.
32. `Test-Path` FINDS HIDDEN FILES; `Get-Item` WITHOUT `-Force` DOES NOT. The
   freshness gate in `deploy.ps1` guarded with `Test-Path` and then called
   `Get-Item`, which returned nothing for Visual Studio's hidden `.wsuo` -- and
   the next line called a method on that null. It ran on Logan's machine, not
   here, and broke his only deploy path. Any `deploy.ps1` change is parse-
   checked with `[Parser]::ParseFile` AND exercised on its failure paths with
   stubs, because the container has no Windows and "it looks right" has already
   been wrong.
33. WHAT DOES NOT SHIP WITH THE PUSH IS WHERE THE ROT SETS IN. `gmail-watcher.gs`
   deploys by hand (rule 27), and rule 27 was not enough: on 29 Aug Logan asked
   "i thought we automated pushing the watcher code???" and the honest answer
   was that only the DETECTION was automated. Step 5 of `deploy.ps1` now really
   deploys it via clasp, and every trap on the way there was a silent one --
   pushing under the wrong filename would duplicate every function, pushing a
   hand-written manifest would rewrite the project's OAuth scopes, and
   `clasp deploy` without `-i` mints a NEW /exec URL while the app keeps
   calling the old one. A deployment that can half-succeed must verify itself
   afterwards and fall back to the manual step, never continue on the
   assumption that it worked.

"""

rep(p, """## Verification tooling""", RULES + """## Verification tooling""")

# The count has been wrong for a while, and a stale number in the one file that
# tells the next session what "green" looks like is its own small trap.
rep(p, """- `node tests.js` — 562 tests: data safety, migrations, inline-handler""",
    """- `node tests.js` — 749 tests: data safety, migrations, inline-handler""")
rep(p, """- `node tools/a11y-audit.js` — ALL 39 screens in the RENDERED DOM:""",
    """- `node tools/a11y-audit.js` — ALL 46 screens in the RENDERED DOM:""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
for path, text in buf.items():
    open(path, 'w').write(text)
print('CLAUDE.md rules 29-33 added ->', ', '.join(sorted(buf)))

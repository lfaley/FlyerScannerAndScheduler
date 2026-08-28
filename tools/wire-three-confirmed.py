#!/usr/bin/env python3
"""v9.67 - the three findings the review confirmed but left listed.

  A. citedEvents capped citations at 99, silently.
  B. a PROGRESS note was filed as a failure and as a Problem Log entry.
  C. the "Read by Anthropic" toast and its log line fired BEFORE Anthropic
     answered.

B and C are the same mistake in two places, and it is the one P4-01 was about:
telling the user something happened before checking that it did.
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
        fail.append(f'{path}: expected {c}x {o[:80]!r}, found {got}')
        return
    buf[path] = src.replace(o, n)

p = 'index.html'

# ========================================================================== A
# \d{1,2} caps at 99. Verified by execution: a "next 3 months" scope with 140
# events in window emits 140 refs numbered to 140, and citedEvents('[140]')
# returned 0 -- so the answer showed no source for anything past the 99th.
rep(p, """  for(const m of String(answer || '').matchAll(/\\[(\\d{1,2})\\]/g)) nums.add(Number(m[1]));""",
"""  // \\d{1,2} capped this at 99. A wide scope really can emit more than that --
  // measured: 140 refs for "the next 3 months" on a busy calendar -- and every
  // citation above the 99th was silently dropped, so the answer displayed no
  // source for it (code review, verified by execution 28 Aug).
  for(const m of String(answer || '').matchAll(/\\[(\\d{1,3})\\]/g)) nums.add(Number(m[1]));""")

# ========================================================================== B
# The two "trying each part separately" pushes are PROGRESS, not failure. The
# caller turned every entry in `problems` into a review-box failure AND a
# logProblem() row, so an email whose per-part passes then SUCCEEDED still left
# a "couldn't be read" trace behind -- the same symptom migration v7 was written
# to clean up.
rep(p, """      if(events.length) return { events, problems };
      problems.push('combined read found nothing; trying each part separately');
    }catch(err){
      problems.push('combined read failed (' + err.message + '); trying each part separately');
    }""",
"""      if(events.length) return { events, problems, notes };
      notes.push('combined read found nothing; trying each part separately');
    }catch(err){
      notes.push('combined read failed (' + err.message + '); trying each part separately');
    }""")

rep(p, """  const found = [];
  const problems = [];""",
"""  const found = [];
  const problems = [];
  // PROGRESS, not failure. "The combined read found nothing, so I am trying
  // each part" is worth keeping for diagnosis, but filing it as a problem made
  // the Problem Log accuse the app of failing at something it then did.
  const notes = [];""")

rep(p, """  return { events: merged, problems };""",
    """  return { events: merged, problems, notes };""")

rep(p, """      const { events, problems } = await extractFromEmailPayload(payload);""",
    """      const { events, problems, notes } = await extractFromEmailPayload(payload);""")

rep(p, """      if(!events.length && !problems.length){
        failures.push({ subject: label, reason: 'No dates found', msgId: it.msgId, retriable: false });
        logProblem('Email: ' + (payload.from || it.from || 'unknown'),
          'No dates found in this email', label);
      }""",
"""      if(!events.length && !problems.length){
        // Nothing was extracted and nothing errored. The progress notes are
        // worth showing HERE, where they explain what was tried -- and only
        // here. When events did come back, the same notes are just noise.
        const why = (notes || []).length ? notes.join('; ') : 'No dates found';
        failures.push({ subject: label, reason: why, msgId: it.msgId, retriable: false });
        logProblem('Email: ' + (payload.from || it.from || 'unknown'),
          'No dates found in this email', label);
      }""")

# ========================================================================== C
# The toast and the fellBackTo log line ran before `return await callClaude(...)`.
# If Anthropic then failed, the user had already been told it had answered.
rep(p, """      if(aiFallbackOn()){
        recordAiCall(Object.assign({}, localFail, { fellBackTo:'anthropic' }));""",
"""      if(aiFallbackOn()){""")

rep(p, """        // A successful fallback RECOVERED -- the user got an answer -- so it is
        // NOT a "problem to look at." It is already in the AI call log above
        // (fellBackTo), which Diagnostics summarises as "fell back N×". Logging
        // it as a Problem too made the "N problems to look at" count never drop
        // even though nothing was actually broken.
        return await callClaude(contentBlocks, maxTokens, system);""",
"""        // A successful fallback RECOVERED -- the user got an answer -- so it is
        // NOT a "problem to look at." It is recorded in the AI call log with
        // fellBackTo, which Diagnostics summarises as "fell back N×". Logging it
        // as a Problem too made the "N problems to look at" count never drop
        // even though nothing was actually broken.
        //
        // ORDER MATTERS. Until v9.67 the toast and the fellBackTo entry were
        // emitted BEFORE this call, so a failing Anthropic left the user having
        // been told it answered and the log claiming a recovery that never
        // happened. Announce the outcome after there IS one -- the same mistake
        // P4-01 fixed in sign-out.
        const answer = await callClaude(contentBlocks, maxTokens, system);
        recordAiCall(Object.assign({}, localFail, { fellBackTo:'anthropic' }));
        toast(needAuth ? 'Read by Anthropic — sign in (Settings) to use Gordon'
                       : rateLimited ? 'Read by Anthropic — Gordon is busy (rate limited); try again shortly'
                       : (unsupported ? 'Read by Anthropic instead — PDFs need it'
                          : 'Read by Anthropic instead — your local model did not answer'));
        return answer;""")

# The old, premature toast goes; its wording moved above unchanged.
rep(p, """        // WORDING MATTERS. This used to read "Local model unavailable — using
        // Anthropic", which on a phone toast reads as "...unavailable ...
        // Anthropic" -- Logan reported repeated "Anthropic couldn't be
        // reached" alerts when the log showed Anthropic succeeding every time.
        // Lead with the outcome, name the thing that failed second.
        toast(needAuth ? 'Read by Anthropic — sign in (Settings) to use Gordon'
                       : rateLimited ? 'Read by Anthropic — Gordon is busy (rate limited); try again shortly'
                       : (unsupported ? 'Read by Anthropic instead — PDFs need it'
                          : 'Read by Anthropic instead — your local model did not answer'));
""",
"""        // WORDING MATTERS. This used to read "Local model unavailable — using
        // Anthropic", which on a phone toast reads as "...unavailable ...
        // Anthropic" -- Logan reported repeated "Anthropic couldn't be
        // reached" alerts when the log showed Anthropic succeeding every time.
        // Lead with the outcome, name the thing that failed second. The toast
        // itself now fires below, once there is an outcome to report.
""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
for path, text in buf.items():
    open(path, 'w').write(text)
print('three confirmed findings fixed')

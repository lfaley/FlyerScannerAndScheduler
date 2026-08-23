#!/usr/bin/env python3
"""v9.25 - the app finds out whether the local model's window fits the job.

Logan's two 48-second failures were never a model choice. Ollama defaults to a
4,096-token context on any machine under 24 GiB of VRAM; his prompts measured
2,327 and 2,346 tokens; the app asked for 4,000 tokens of answer. Prompt plus
requested answer was roughly double the window, so the calls were doomed before
they were sent -- and nothing anywhere noticed.

Three changes, in order of how much they matter:

1. `reasoning_effort: 'none'`. The existing `think: false` was silently
   IGNORED: Ollama's OpenAI-compatibility docs list the supported fields and
   `think` is not among them (it works only on the native /api/chat). So
   thinking was never actually off, on any call, since the local provider
   shipped. `reasoning_effort` IS on that list, with 'none' among its values.

2. Measure the window and plan the budget against it (js/local-limits.js).

3. Say so, in the self-test and in the diagnostics file.

`num_ctx` is deliberately NOT sent: the same docs say "the OpenAI API does not
have a way of setting context size". The window is the server's to set, so the
app's job is to detect and explain, never to pretend it can fix it.
"""
import sys, re

p = 'index.html'
src = open(p).read()
fail = []

def rep(o, n, c=1):
    global src
    got = src.count(o)
    if got != c:
        fail.append(f'expected {c}x {o[:90]!r}, found {got}')
        return
    src = src.replace(o, n)

def inline(path):
    body = open(path).read()
    body = re.sub(r'^import\s[^;]*;\s*$', '', body, flags=re.M)
    body = re.sub(r'^export\s+', '', body, flags=re.M)
    return body.strip()

# ---------------------------------------------------------------- 1. inline
rep("\n// ---------- State & storage ----------",
    "\n" + inline('js/local-limits.js') + "\n\n// ---------- State & storage ----------")

# ------------------------------------------------- 2. the probe (impure half)
rep("""async function callLocalModel(contentBlocks, maxTokens, system){""",
"""// The measured context window of the loaded local model, or null while
// unknown. Cached for the session: asking costs a round trip, and the answer
// only changes when Ollama is restarted -- at which point the app is reloaded
// too, more often than not.
let localCtx = null;
let localCtxAsked = false;

/**
 * Ask the server how big a window it actually allocated.
 *
 * Best effort by design. Older Ollama builds do not report it, /api/ps may be
 * blocked where /v1 is not, and no model may be loaded yet. Every one of those
 * returns null, and null means "carry on unchanged" -- a detection failure
 * must never be able to stop a call that would have worked.
 */
async function probeLocalContext(){
  if(localCtxAsked) return localCtx;
  localCtxAsked = true;
  const url = psUrlFrom(S.settings.localBaseUrl || '');
  if(!url) return null;
  try{
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { headers:{ 'Authorization':'Bearer local' }, signal: ctrl.signal });
    clearTimeout(t);
    if(!res.ok) return null;
    localCtx = contextFromPs(await res.json(), (S.settings.localModel || '').trim());
  }catch(e){
    localCtx = null;
  }
  return localCtx;
}

async function callLocalModel(contentBlocks, maxTokens, system){""")

# ------------------------------------------------------- 3. plan the budget
rep("""  // Local models are more verbose than Claude for the same task, so give the
  // budget extra room rather than risk a truncated, unparseable response.
  maxTokens = Math.max(maxTokens || 2000, 4000);
""",
"""  // Local models are more verbose than Claude for the same task, so give the
  // budget extra room rather than risk a truncated, unparseable response.
  maxTokens = Math.max(maxTokens || 2000, 4000);

  // ...but only as much room as there is. Asking for 4,000 tokens of answer
  // inside a 4,096-token window cannot work however good the model is, and
  // that is exactly what this app did until v9.25. Both numbers are measured:
  // the window from the server, the prompt size from previous calls in the AI
  // log. When either is unknown the plan is "carry on unchanged".
  const ctx = await probeLocalContext();
  const seen = observedPromptTokens(S.aiLog || [], aiOp, 'local');
  const plan = planBudget({ ctx, promptTokens: seen && seen.tokens, want: maxTokens });
  if(!plan.ok){
    // Fail in a second rather than burning three minutes on a request whose
    // arithmetic already says no.
    throw new Error('CONTEXT_TOO_SMALL: ' + contextAdvice(plan));
  }
  if(plan.clamped) console.log('local budget clamped to', plan.maxTokens, 'to fit', ctx);
  maxTokens = plan.maxTokens;
""")

# ---------------------------------------- 4. reasoning_effort, the real fix
rep("""      // `think` is Ollama's documented field; `chat_template_kwargs` is what
      // other OpenAI-compatible runtimes accept. Sending both is harmless --
      // unknown fields are ignored -- and covers either backend.""",
"""      // `reasoning_effort:'none'` is the one that WORKS here. Ollama's
      // OpenAI-compatibility docs list the accepted fields for
      // /v1/chat/completions, and `think` is not among them -- it is a native
      // /api/chat field, so it was silently ignored on every call this app has
      // ever made. `reasoning_effort` IS on that list, 'none' among its
      // values. That is why a thinking model kept thinking with `think:false`
      // sitting right there in the request.
      //
      // The other two stay: they are free, and they cover proxies that speak
      // the native shape instead.""")

rep("""        think: false,
        chat_template_kwargs: { enable_thinking: false }""",
"""        reasoning_effort: 'none',
        think: false,
        chat_template_kwargs: { enable_thinking: false }""")

# ------------------------------------- 5. record what the call actually cost
# Without this the log has no inTokens for local calls, so the next call has
# nothing to plan against and the whole feature never gets off the ground.
rep("""  const json = await res.json();
  const choice = (json.choices && json.choices[0]) || {};
  const msg = choice.message || {};""",
"""  const json = await res.json();
  const choice = (json.choices && json.choices[0]) || {};
  const msg = choice.message || {};
  // Remember what this cost. Every later call plans its budget from these
  // numbers, so a log without them leaves the fit check permanently blind.
  lastLocalUsage = {
    inTokens: (json.usage && json.usage.prompt_tokens) || null,
    outTokens: (json.usage && json.usage.completion_tokens) || null,
    finish: choice.finish_reason || null,
  };""")

rep("""async function callLocalModel(contentBlocks, maxTokens, system){""",
"""// Usage from the most recent local call, so the success path can log tokens
// the way the Anthropic path already does.
let lastLocalUsage = { inTokens:null, outTokens:null, finish:null };

async function callLocalModel(contentBlocks, maxTokens, system){""")

rep("""      recordAiCall({ op: aiOp, provider:'local', reqModel: S.settings.localModel || null,
        ok:true, ms: Date.now() - started });""",
"""      recordAiCall({ op: aiOp, provider:'local', reqModel: S.settings.localModel || null,
        ok:true, ms: Date.now() - started,
        inTokens: lastLocalUsage.inTokens, outTokens: lastLocalUsage.outTokens,
        finish: lastLocalUsage.finish });""")

# ------------------------------------- 6. the no-fallback message keeps detail
rep("""      throw new Error(explainError(localFail.errorType, 'local'));""",
"""      throw new Error(explainError(localFail.errorType, 'local', localFail.detail));""")

# ------------------------------------------------- 7. a self-test stage for it
rep("""  // Stage 5 -- vision. The whole scanner depends on this.""",
"""  // Stage 4b -- the window. This is the check that would have saved Logan two
  // 48-second failures and an afternoon: the arithmetic was already decided
  // before either request left the phone.
  const ctx = await probeLocalContext();
  const seen = observedPromptTokens(S.aiLog || [], 'extract.image', 'local');
  if(ctx === null){
    add('Context window big enough', true,
      'the server does not report it — cannot check, so nothing is clamped');
  }else{
    const need = (seen && seen.tokens) || 2400;   // a measured flyer, or a typical one
    const plan = planBudget({ ctx, promptTokens: need, want: 4000 });
    add('Context window big enough', plan.ok,
      plan.ok
        ? `${ctx} tokens; a flyer costs about ${need}, leaving ${plan.room} for the answer`
          + (plan.clamped ? ' (answers will be clamped to fit)' : '')
        : `${ctx} tokens is not enough — ${plan.detail} Set OLLAMA_CONTEXT_LENGTH=16384 and restart Ollama.`);
  }

  // Stage 5 -- vision. The whole scanner depends on this.""")

# ---------------------------------------------- 8. put it in the shared file
rep("""      localBaseUrl: m.includeLocalUrl ? redact((s.settings || {}).localBaseUrl || '') : null,""",
"""      localBaseUrl: m.includeLocalUrl ? redact((s.settings || {}).localBaseUrl || '') : null,
      localContext: m.localContext == null ? null : m.localContext,""")

rep("""    provider: aiProvider(), model: aiModelName(),
    includeLocalUrl: true,
    userAgent: navigator.userAgent,
  });""",
"""    provider: aiProvider(), model: aiModelName(),
    includeLocalUrl: true,
    // Null until something has asked. Worth having in the file either way:
    // "we never found out" and "it is 4096" are different problems.
    localContext: typeof localCtx === 'undefined' ? null : localCtx,
    userAgent: navigator.userAgent,
  });""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
open(p, 'w').write(src)
print('context-fit wired')

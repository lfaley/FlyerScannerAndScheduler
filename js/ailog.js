/**
 * AI call logging.
 *
 * Modelled on the OpenTelemetry GenAI semantic conventions, which are the
 * vendor-neutral standard for what to record around a model call. Field names
 * mirror the `gen_ai.*` namespace so the log means the same thing an engineer
 * would expect it to mean:
 *
 *   op            gen_ai.operation.name   what was being done
 *   provider      gen_ai.provider.name    anthropic | local
 *   reqModel      gen_ai.request.model    what we asked for
 *   resModel      gen_ai.response.model   what actually answered (can differ)
 *   inTokens/out  gen_ai.usage.*_tokens
 *   finish        gen_ai.response.finish_reasons
 *   ms            gen_ai.client.operation.duration
 *   errorType     error.type
 *
 * WHAT IS DELIBERATELY NOT LOGGED
 *
 * The conventions exclude prompt and completion bodies from standard
 * attributes because they "routinely contain names, emails, account numbers,
 * or proprietary business logic". That warning lands harder here than in most
 * apps: the prompts ARE children's names, schools, addresses and schedules.
 * So no prompt text, no answer text, and never the API key. `redact()` below
 * is the last line of defence for error strings, which are the one place a
 * provider can hand back something sensitive without being asked.
 *
 * Pure: no DOM, no app state, no clock of its own.
 */

export const AI_LOG_MAX = 200;          // rolling window; oldest dropped first

// Anything shaped like a key must never reach storage, a file, or a screen.
const KEYISH = [
  /sk-ant-[A-Za-z0-9_\-]+/g,            // Anthropic
  /\bsk-[A-Za-z0-9]{20,}/g,             // OpenAI-style
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,   // addresses in errors
];

/** Strip credentials and addresses out of any string before it is stored. */
export function redact(text){
  let s = String(text == null ? '' : text);
  for(const re of KEYISH) s = s.replace(re, '[redacted]');
  return s.slice(0, 400);
}

/**
 * Classify a failure into a small, stable set.
 *
 * Free-text messages vary between providers and versions; a class does not.
 * This is what makes "how often does the local model time out?" answerable.
 */
export function classifyError(err, status){
  const msg = String((err && err.message) || err || '').toLowerCase();
  if(status === 401 || status === 403 || /unauthor|forbidden|invalid.*key|api key/.test(msg)) return 'auth';
  if(status === 429 || /rate.?limit|too many requests|overloaded/.test(msg))                  return 'rate_limit';
  if(status && status >= 500)                                                                 return 'provider_error';
  if(/abort|timeout|timed out/.test(msg))                                                     return 'timeout';
  // A "thinking" model that spent its whole token budget reasoning and emitted
  // no answer. Logan hit this twice with qwen3-vl:8b and it logged as
  // "unknown", which is the least useful thing a classifier can say about a
  // failure it can name exactly. The app already asks for think:false; some
  // builds ignore it.
  if(/only reasoning|produced only reasoning|no answer/.test(msg))                            return 'thinking_only';
  // Raised by the app itself, before any request goes out: the prompt plus a
  // usable answer will not fit the window the server allocated.
  if(/^CONTEXT_TOO_SMALL/.test(String(err && err.message || ''))
     || /context_too_small/.test(msg))                                                       return 'context_too_small';
  if(/failed to fetch|networkerror|load failed|connection|unreachable|econnrefused/.test(msg))return 'network';
  if(/no_api_key/.test(msg))                                                                  return 'no_api_key';
  // Raised by the app itself, before any request goes out (v10.5). It must be
  // told apart from Anthropic's OWN spend limit below: nothing failed here and
  // the fix is in Settings, not in the console.
  if(/^SPEND_CAP/.test(String(err && err.message || '')))                                     return 'spend_cap';
  if(/could not read|unexpected token|json/.test(msg))                                        return 'bad_response';
  if(/unsupported_block/.test(msg))                                                           return 'unsupported_input';
  // The spend cap, before the generic 400. Anthropic returns 400
  // invalid_request_error "when usage reaches an organization or workspace
  // spend limit you set", and 400 credit_balance_too_low when the account is
  // out of credit. Both landed in `request_rejected` -> "Something went wrong
  // talking to Anthropic", which is useless advice for the one failure whose
  // fix is a number on a web page.
  //
  // callClaude puts the response body in the thrown message and in `detail`,
  // so the body text is what is matched here. `credit_balance_too_low` is a
  // confirmed error-type string; the exact spend-limit WORDING is not, so the
  // phrase match is deliberately loose. A miss just falls through to the old
  // generic class -- never to a wrong one.
  if(/spend limit|credit balance|credit_balance_too_low|quota exceeded/.test(msg))            return 'spend_limit';
  if(status && status >= 400)                                                                 return 'request_rejected';
  return 'unknown';
}

/**
 * Turn an error class into something a parent can act on.
 *
 * v9.23. The app already classified every failure correctly and then told the
 * user "Extraction failed: Load failed", which names the symptom in the
 * browser's words and says nothing about what to do. Logan hit this with two
 * pages that appeared to be read and then failed repeatedly, and could not
 * tell from the alert whether it was his connection, his key, or the service.
 *
 * `detail` is deliberately NOT included: it is the provider's raw string and
 * belongs in the diagnostics file, not in an alert.
 */
export function explainError(errorType, provider, detail){
  const who = provider === 'local' ? 'your local model' : 'Anthropic';
  switch(errorType){
    case 'network':
      return `Could not reach ${who}.\n\nCheck your connection`
        + (provider === 'local' ? ' and that the desktop is awake with Tailscale connected.' : ' and try again.');
    case 'timeout':
      return `${who === 'Anthropic' ? 'Anthropic' : 'Your local model'} took too long to answer.\n\n`
        + (provider === 'local'
            ? 'A big photo on a slow machine can exceed three minutes. Try one page at a time.'
            : 'Try again, or try one page at a time.');
    case 'rate_limit':
      return `${who} is busy or you have hit a rate limit.\n\nWait a moment and try again — nothing was lost.`;
    case 'auth':
      return `${who} rejected the API key.\n\nCheck it in Settings → ${'Gordon'} and AI. A key can be revoked or expire.`;
    case 'provider_error':
      return `${who} had a problem on their side.\n\nThis is not something you did. Try again shortly.`;
    case 'no_api_key':
      return 'Add your Anthropic API key in Settings first.';
    case 'unsupported_input':
      return 'Your local model cannot read PDFs or fetched links — only photos and text.\n\n'
        + 'Photograph the page instead, or turn on "Fall back to Anthropic" in Settings.';
    case 'thinking_only':
      // Named precisely on purpose. In Ollama the bare `qwen3-vl:8b` tag IS the
      // Thinking edition -- Logan's own server log says
      // `renderer=qwen3-vl-thinking parser=qwen3-vl-thinking` -- so "switch to
      // another model" is wrong advice. It is the same model, one tag over.
      return 'Your local model spent its whole answer thinking and never replied.\n\n'
        + 'Plain qwen3-vl:8b is the Thinking edition. Pull the Instruct one instead:\n'
        + 'ollama pull qwen3-vl:8b-instruct-q4_K_M\n\n'
        + 'Also check its context length — Ollama defaults to 4096 tokens, and a '
        + 'photo prompt fills most of that before the answer even starts.';
    case 'spend_limit':
      // The one failure whose fix is entirely outside the app -- so the message
      // is the instructions. It also has to say what STILL works: since v9.30
      // Anthropic is the fallback, not the main path, so a capped key means
      // "the safety net is out", not "the app is down".
      // URL corrected v10.5: the console moved to platform.claude.com. The old
      // console.anthropic.com came from the launch blog and is what this message
      // had been telling people to visit.
      return 'Anthropic has hit the spending limit on your account.\n\n'
        + 'This is a cap set at Anthropic, not a fault, and not the one in this app. '
        + 'Raise it at platform.claude.com under the workspace this key belongs to, '
        + 'or wait for it to reset on the 1st of the month.\n\n'
        + 'Your own model is unaffected — scanning still works whenever the desktop is awake.';
    case 'spend_cap':
      // THIS app's own limit, not Anthropic's -- and the difference is the whole
      // point of the message. Nothing failed; FlyerSnap stopped itself.
      return detail || 'FlyerSnap has reached the monthly Anthropic limit you set in Settings.\n\n'
        + 'Nothing is broken and nothing was lost. Raise the limit in '
        + 'Settings → Gordon and AI, or leave it — your own model is unaffected, '
        + 'so scanning still works whenever the desktop is awake.';
    case 'context_too_small':
      // The detail carries the three numbers that decide this, and without
      // them the reader cannot tell which one to change.
      return detail || 'The local model\'s context window is too small for this job.';
    case 'bad_response':
      return `${who} replied with something this app could not read.\n\n`
        + 'Often a clearer photo fixes it. If it keeps happening, export diagnostics from Settings.';
    default:
      return `Something went wrong talking to ${who}.\n\n`
        + 'Settings → When something goes wrong has the details, and can export them.';
  }
}

/** Build one log entry. Everything optional; nothing here can throw. */
export function makeEntry(e){
  const v = e || {};
  const entry = {
    at: v.at || null,                     // ISO, injected so this stays pure
    op: String(v.op || 'unknown'),
    provider: String(v.provider || 'unknown'),
    reqModel: v.reqModel ? String(v.reqModel) : null,
    resModel: v.resModel ? String(v.resModel) : null,
    ms: typeof v.ms === 'number' && isFinite(v.ms) ? Math.round(v.ms) : null,
    ok: !!v.ok,
    inTokens: typeof v.inTokens === 'number' ? v.inTokens : null,
    outTokens: typeof v.outTokens === 'number' ? v.outTokens : null,
    finish: v.finish ? String(v.finish).slice(0, 40) : null,
    status: typeof v.status === 'number' ? v.status : null,
    errorType: v.ok ? null : (v.errorType || 'unknown'),
    // Redacted, and short. Enough to recognise a failure, never enough to
    // leak a key or a child's name.
    detail: v.ok ? null : redact(v.detail || ''),
    fellBackTo: v.fellBackTo ? String(v.fellBackTo) : null,
  };
  return entry;
}

/** Append with a rolling cap. Returns a NEW array; never mutates the input. */
export function appendEntry(log, entry){
  const next = (Array.isArray(log) ? log : []).concat([entry]);
  return next.length > AI_LOG_MAX ? next.slice(next.length - AI_LOG_MAX) : next;
}

/**
 * A short health summary — the thing worth reading first.
 * Counts, failure rate, median latency, and which errors dominate.
 */
export function summarize(log){
  const rows = Array.isArray(log) ? log : [];
  const ok = rows.filter(r => r.ok);
  const bad = rows.filter(r => !r.ok);
  // A call that fell back to Anthropic is NOT a user-facing failure -- the user
  // got an answer. Counting those as "failed" made the Diagnostics line read
  // "74 failed" when every one of them had actually been answered by the
  // fallback (and grouped into a single Problem Log entry). "Failed" now means
  // no answer at all; fell-backs are reported separately as `fellBack`.
  const trueFail = bad.filter(r => !r.fellBackTo);
  const byType = {};
  bad.forEach(r => { byType[r.errorType || 'unknown'] = (byType[r.errorType || 'unknown'] || 0) + 1; });
  const fellBack = rows.filter(r => r.fellBackTo).length;
  const times = ok.map(r => r.ms).filter(n => typeof n === 'number').sort((a, b) => a - b);
  const median = times.length ? times[Math.floor(times.length / 2)] : null;
  const slowest = times.length ? times[times.length - 1] : null;
  // OPERATIONS, NOT ROWS, IN THE DENOMINATOR (v10.6).
  //
  // A rescued operation logs TWO rows -- the local attempt that failed with
  // `fellBackTo`, and the Anthropic call that answered -- for one thing the
  // user asked for. `failed` already counts operations (a fell-back row is
  // excluded), so dividing it by rows mixed two units and quietly understated
  // the rate. Measured: 12 operations, one of them rescued, one failed outright
  // -> 0.0769 reported against a true 0.0833, understated by 7.7%. The error
  // scales with how often the desktop is asleep, so it is worst exactly when
  // someone is looking at this number to find out why.
  //
  // `calls` still counts ROWS, because two API calls really were made and that
  // is what the word says. `operations` is the new one, and it is what the rate
  // divides by.
  //
  // Only a SUCCESSFUL fallback carries `fellBackTo` (callAI sets it after the
  // Anthropic call resolves), so a fallback that also failed logs two plain
  // failures and is not double-counted here.
  const operations = rows.length - fellBack;
  return {
    calls: rows.length,
    operations,
    ok: ok.length,
    failed: trueFail.length,
    failureRate: operations > 0 ? trueFail.length / operations : 0,
    medianMs: median,
    slowestMs: slowest,
    byErrorType: byType,
    fellBack,
    inTokens: ok.reduce((n, r) => n + (r.inTokens || 0), 0),
    outTokens: ok.reduce((n, r) => n + (r.outTokens || 0), 0),
  };
}

/**
 * The file that leaves the phone.
 *
 * Contains the AI call log, the manually-reported problem log, and enough
 * version context to interpret them. Deliberately does NOT contain events,
 * chores, lists, notes or the API key -- a diagnostics file gets emailed and
 * AirDropped around, and it should be safe to do that.
 */
export function buildDiagnostics(state, meta){
  const s = state || {};
  const m = meta || {};
  return {
    kind: 'flyersnap-diagnostics',
    version: 1,
    generatedAt: m.now || null,
    app: {
      version: m.appVersion || null,
      provider: m.provider || null,
      model: m.model || null,
      hasApiKey: !!(s.settings && s.settings.apiKey),   // whether, never what
      // Did the browser agree to keep this origin's data? MDN: Safari and the
      // Chromium browsers decide this silently from the user's interaction
      // history, so it can change over time and is worth reading, not assuming.
      persisted: m.persisted === undefined ? null : !!m.persisted,
      aiEnabled: !(s.settings && s.settings.aiEnabled === false),
      localBaseUrl: m.includeLocalUrl ? redact((s.settings || {}).localBaseUrl || '') : null,
      // The context window the local server actually allocated, when the app
      // managed to ask. Null covers both "not a local setup" and "asked and
      // could not find out" -- different problems, but neither is a number.
      localContext: m.localContext == null ? null : m.localContext,
      userAgent: m.userAgent ? String(m.userAgent).slice(0, 200) : null,
    },
    counts: {
      events: (s.events || []).length,
      chores: (s.chores || []).length,
      lists: (s.lists || []).length,
    },
    aiSummary: summarize(s.aiLog || []),
    aiLog: (s.aiLog || []).slice(-AI_LOG_MAX),
    // The manual side: problems reported by the app's own logProblem().
    problems: (s.problems || []).map(p => ({
      where: redact(p.where), message: redact(p.message), detail: p.detail ? redact(p.detail) : null,
      first: p.first, last: p.last, count: p.count, resolved: !!p.done,
    })),
  };
}

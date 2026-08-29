/**
 * Does the local model's context window actually fit the job?
 *
 * v9.25. Logan's two 48-second failures were not a model choice. Ollama's
 * default context is 4,096 tokens on any machine with under 24 GiB of VRAM
 * (his RTX 5060 Ti has 15.9 GiB), his flyer prompts measured 2,327 and 2,346
 * tokens, and FlyerSnap asked for up to 4,000 tokens of answer. Prompt plus
 * requested answer was roughly double the window. Those calls could not have
 * succeeded from any model.
 *
 * The app could not see this, and still cannot ask for more: Ollama's own
 * OpenAI-compatibility docs say "the OpenAI API does not have a way of setting
 * context size", so `num_ctx` is not ours to send. The window is fixed
 * server-side by OLLAMA_CONTEXT_LENGTH. All the app can do is FIND OUT and say
 * so -- which is the whole of this module.
 *
 * Pure. No DOM, no network, no app state. The caller does the fetching.
 */

/** Leave the runtime a little headroom rather than filling the window exactly. */
export const CTX_MARGIN = 128;

/**
 * Below this many tokens an extraction answer is not worth attempting: a single
 * event in this app's JSON shape runs roughly 120 tokens, so under ~600 even a
 * short flyer gets truncated mid-object and fails to parse.
 */
export const MIN_ANSWER = 600;

/**
 * Ollama's OpenAI-compatible base is `.../v1`; the native API sits beside it at
 * `.../api`. `ollama ps` is the only place the LOADED model's real window is
 * reported -- /api/show returns the model's TRAINING context (262,144 for
 * qwen3-vl) which is not what the server allocated.
 */
export function psUrlFrom(base){
  const clean = String(base || '').trim().replace(/\/+$/, '');
  if(!clean) return '';
  return clean.replace(/\/v\d+$/, '') + '/api/ps';
}

/**
 * Pull the loaded model's context window out of an /api/ps response.
 *
 * Returns null rather than a guess when the field is absent -- older Ollama
 * builds do not report it, and a made-up number here would produce confident
 * wrong advice, which is worse than none.
 */
export function contextFromPs(json, model){
  const models = (json && (json.models || json.data)) || [];
  if(!Array.isArray(models) || !models.length) return null;
  const want = String(model || '').trim();
  const named = want
    ? models.find(m => m && (m.model === want || m.name === want ||
        String(m.model || m.name || '').split(':')[0] === want.split(':')[0]))
    : null;
  // NO FALLBACK TO models[0]. Until v9.73 an unloaded model returned whatever
  // the first loaded one happened to be -- measured at 8192 (llama3:70b) while
  // the caller was asking about a 32k model. That is precisely the "confident
  // wrong advice" the docblock above promises not to give, and it is worse than
  // silence because the advice it feeds is about whether a prompt will FIT.
  // When no name was asked for at all, the single loaded model is still the
  // only sensible answer (code review P5, reproduced by execution 29 Aug).
  const hit = want ? named : models[0];
  if(!hit) return null;
  const n = hit.context_length != null ? hit.context_length : hit.contextLength;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * How big is a prompt for this job, measured rather than estimated?
 *
 * The AI log already records `inTokens` for every successful call, so previous
 * runs of the SAME operation are real evidence. The maximum is used, not the
 * mean: the question is whether the window fits the worst flyer, not the
 * typical one.
 *
 * A photo sent to the local model costs about what it costs Anthropic -- both
 * tile the image -- so an Anthropic run of the same operation is a usable
 * stand-in when the local side has never succeeded. That is an approximation,
 * and it is flagged as one.
 */
export function observedPromptTokens(log, op, provider){
  const rows = (log || []).filter(e => e && e.op === op && Number.isFinite(e.inTokens));
  const mine = rows.filter(e => e.provider === provider);
  const use = mine.length ? mine : rows;
  if(!use.length) return null;
  return {
    tokens: use.reduce((n, e) => Math.max(n, e.inTokens), 0),
    exact: mine.length > 0,
    samples: use.length,
  };
}

/**
 * Decide what to ask for, given a window that cannot be widened from here.
 *
 * Three outcomes, and the middle one matters most: when the window is tight but
 * usable, ASK FOR LESS rather than failing. A request for 4,000 tokens inside a
 * 4,096-token window is refused or truncated; the same call asking for 1,600
 * may well succeed. Clamping is not a workaround, it is the correct request.
 */
export function planBudget(opts){
  const o = opts || {};
  const want = Math.max(1, Math.floor(o.want || 0));
  const ctx = Number.isFinite(o.ctx) && o.ctx > 0 ? Math.floor(o.ctx) : null;
  const prompt = Number.isFinite(o.promptTokens) && o.promptTokens > 0
    ? Math.floor(o.promptTokens) : null;
  const margin = Number.isFinite(o.margin) ? o.margin : CTX_MARGIN;
  const floor = Number.isFinite(o.floor) ? o.floor : MIN_ANSWER;

  // Nothing measured: proceed unchanged. Refusing on an unknown would ground
  // the local model on every server that does not report its window.
  if(ctx === null || prompt === null){
    return { ok:true, maxTokens:want, clamped:false, room:null, ctx, prompt, reason:'unknown' };
  }

  const room = ctx - prompt - margin;
  if(room < floor){
    return { ok:false, maxTokens:0, clamped:false, room, ctx, prompt,
      reason:'too_small',
      // The numbers are the message. "Context too small" alone leaves the user
      // guessing which of the three quantities to change.
      detail: `The prompt is about ${prompt} tokens and the model's window is `
        + `${ctx}, leaving ${Math.max(0, room)} for an answer.` };
  }
  if(room < want){
    return { ok:true, maxTokens:room, clamped:true, room, ctx, prompt, reason:'clamped' };
  }
  return { ok:true, maxTokens:want, clamped:false, room, ctx, prompt, reason:'fits' };
}

/**
 * What to tell someone whose window is too small. Ollama's default really is
 * 4,096 under 24 GiB of VRAM, so most people hitting this have never set it.
 */
export function contextAdvice(plan){
  const p = plan || {};
  const need = Math.max(8192, ((p.prompt || 0) + 2000));
  const rounded = need <= 8192 ? 8192 : (need <= 16384 ? 16384 : 32768);
  return `${p.detail || 'The context window is too small for this job.'}\n\n`
    + `Ollama defaults to 4096 tokens on a machine with under 24GB of VRAM. `
    + `Raise it on the desktop and restart Ollama:\n`
    + `OLLAMA_CONTEXT_LENGTH=${rounded}\n\n`
    + `It cannot be set from here — the OpenAI-compatible API has no field for it.`;
}

/**
 * Schema migration. Pure: takes a saved object, returns it upgraded.
 *
 * This is the most consequential code in the app. Every existing install runs
 * it on load, and a mistake here does not fail loudly -- it silently damages
 * data people cannot get back. It lives on its own so it can be read, reasoned
 * about and tested in isolation.
 *
 * Rules:
 *  - Migrations only ever ADD or TRANSFORM. Never delete a field you do not
 *    fully understand; an unknown field may belong to a newer version.
 *  - Each step is guarded by `from < N` and must be safe to run once, in order.
 *  - Bumping SCHEMA_VERSION without adding the matching block means old saves
 *    are stamped as current without being upgraded.
 */

// Bump when the saved shape changes, and add a migration step below.
// v1 = everything up to and including v2.1 (implicit; no version field was stored).
// v2 = meal planner / recipe box retired; recipes+meals now live in the recipe app.
// NOTE: declared before load() runs, since blank() reads it at startup.
export const SCHEMA_VERSION = 10;

export function migrate(s, fromVersion){
  const from = Number(fromVersion) || 1;
  if(from >= SCHEMA_VERSION){ s.schemaVersion = SCHEMA_VERSION; return s; }

  if(from < 2){
    // FlyerSnap no longer owns recipes or meal plans — the recipe app does.
    // Keep the rows (harmless, and a user may want them exported) but stop
    // treating them as live data. Nothing is deleted here on purpose: a
    // migration that destroys data is the thing we most want to avoid.
    s.legacyRecipes = Array.isArray(s.recipes) ? s.recipes : [];
    s.legacyMeals   = Array.isArray(s.meals)   ? s.meals   : [];
    delete s.recipes;
    delete s.meals;
  }

  if(from < 3){
    // People can now be adults, and events can be tagged to several people.
    // Existing kids become type 'kid'; existing single kidId becomes a
    // one-entry personIds list. kidId is preserved so the star/chore system,
    // which is deliberately kids-only, keeps working untouched.
    (s.kids || []).forEach(k => { if(!k.type) k.type = 'kid'; });
    (s.events || []).forEach(e => {
      if(!Array.isArray(e.personIds)){
        e.personIds = e.kidId ? [e.kidId] : [];
      }
    });
  }

  if(from < 4){
    // Events can now be flagged unread. Everything already in the app counts as
    // seen, so nobody opens the app to a wall of "new" items.
    (s.events || []).forEach(e => { if(e.unread === undefined) e.unread = false; });
  }

  if(from < 5){
    // Gordon-by-default: make the self-hosted model (via the auth-checking proxy)
    // the PRIMARY provider on existing installs. The Anthropic fallback is left
    // untouched — it stays as the safety net for when the desktop is off. The saved
    // endpoint falls through to the app's GORDON_BASE_URL, so clear any stale direct
    // endpoint; move the old text-only default model onto the shared vision model.
    if(s.settings){
      s.settings.aiProvider = 'local';
      s.settings.localBaseUrl = '';
      // ...to the INSTRUCT tag. Earlier builds migrated onto `qwen3-vl:8b`
      // (the Thinking edition, which reasons until it runs out of budget) and
      // then onto the q8_0 (9.8 GB, the slowest 8B) -- rewrite both to the
      // shared fast tag. Also catches anyone still on the text-only 14B.
      //
      // The tag is a LITERAL here, not index.html's GORDON_MODEL: this module is
      // imported and unit-tested on its own, and referencing a constant that only
      // exists in the shipped file would throw ReferenceError the first time a
      // test exercised this branch. A guard test pins the two together instead.
      if(!s.settings.localModel
         || s.settings.localModel === 'qwen2.5:14b-instruct'
         || s.settings.localModel === 'qwen3-vl:8b'
         || s.settings.localModel === 'qwen3-vl:8b-instruct-q8_0'){
        s.settings.localModel = 'qwen3-vl:8b-instruct-q4_K_M';
      }
    }
  }

  if(from < 6){
    // The from<5 rewrite above was ADDED LATER than the v9.32 migration that
    // first wrote a model tag. v9.32 set `qwen3-vl:8b` (the Thinking edition --
    // reasons to budget, never answers) AND stamped schemaVersion 5, so on those
    // installs `from < 5` can never run again: they are permanently stuck asking
    // for the wrong model. Confirmed live via an error report (description
    // `qwen3-vl:8b` on v9.38, model error 429 then Anthropic). Force the shared
    // instruct tag now -- the same one-time repair the recipe app does with
    // migrateModelTag(). LITERAL tag, per the note in the from<5 block.
    const bad = new Set(['qwen2.5:14b-instruct', 'qwen3-vl:8b',
      'qwen3-vl:8b-thinking', 'qwen3-vl:8b-thinking-bf16', 'qwen3-vl:8b-instruct-q8_0']);
    if(s.settings && bad.has(s.settings.localModel)){
      s.settings.localModel = 'qwen3-vl:8b-instruct-q4_K_M';
    }
  }

  if(from < 7){
    // Recovered fallbacks to Anthropic used to be logged as Problems, so the
    // "N problems to look at" count never dropped even though every one had been
    // answered (e.g. 74 rate-limited calls that all fell back). They live in the
    // AI call log, not here -- drop the stale entries. New ones are no longer
    // logged as problems (see callAI). Only removes recovered-fallback rows.
    if(Array.isArray(s.problems)){
      s.problems = s.problems.filter(p => !/^Fell back to Anthropic/.test(String(p && p.message || '')));
    }
  }

  if(from < 8){
    // Notes arrived in v9.60. blank() already provides `notes: []` and load()
    // merges onto blank(), so an old save gets the empty array for free -- this
    // block exists for the case blank() cannot cover: a save whose `notes` key
    // exists but is not an array (hand-edited file, a truncated import, a
    // restore from a future version). Coercing here is cheaper than making
    // every reader defensive, and it destroys nothing that was ever usable.
    if(!Array.isArray(s.notes)) s.notes = [];
  }

  if(from < 9){
    // Notes gained folders and labels (v9.71). Apple's model: one folder says
    // WHERE a note lives, any number of labels say WHAT IT IS ABOUT.
    //
    // This block invents nothing. It creates no folders and no labels, so every
    // existing note lands as Unfiled with none -- which is precisely what it is
    // today. All it does is guarantee the shapes every reader now assumes, so
    // that a hand-edited file or a restore from an older export cannot reach
    // the render path with `labelIds` as a string.
    if(!Array.isArray(s.noteFolders)) s.noteFolders = [];
    if(!Array.isArray(s.noteLabels)) s.noteLabels = [];
    (s.notes || []).forEach(n => {
      if(!n) return;
      if(typeof n.folderId !== 'string') n.folderId = null;
      if(!Array.isArray(n.labelIds)) n.labelIds = [];
      if(typeof n.color !== 'string') n.color = '';
      if(typeof n.archived !== 'boolean') n.archived = false;
    });
  }

  if(from < 10){
    // Soft deletes gained a timestamp (v9.82). An existing tombstone cannot say
    // when it was deleted -- that was never recorded -- so it is stamped NOW.
    //
    // That is a CHOSEN value, not a recovered one, and it is chosen to be
    // generous: every existing tombstone gets a full retention window from the
    // day of the upgrade rather than being destroyed by the next prune. The
    // alternative, leaving them unstamped, keeps them for ever, which at a
    // 5 MiB ceiling is a leak with no bound.
    const stamp = new Date().toISOString();
    // Array.isArray, not `|| []`: adoptParsed coerces a junk collection AFTER
    // migrate runs, so a save carrying notes:'not an array' reaches this block
    // as a STRING and 'x'.forEach is not a function. Caught by the v9.80 test
    // on the first run -- the same shape migrate's own from<8 block guards.
    ['events','kids','chores','rewards','lists','listItems','notes','noteFolders','noteLabels']
      .forEach(coll => {
        const rows = s[coll];
        if(!Array.isArray(rows)) return;
        rows.forEach(row => { if(row && row.deleted && !row.deletedAt) row.deletedAt = stamp; });
      });
  }

  s.schemaVersion = SCHEMA_VERSION;
  return s;
}

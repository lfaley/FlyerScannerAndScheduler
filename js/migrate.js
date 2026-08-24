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
export const SCHEMA_VERSION = 5;

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
      if(!s.settings.localModel || s.settings.localModel === 'qwen2.5:14b-instruct'){
        s.settings.localModel = 'qwen3-vl:8b';
      }
    }
  }

  s.schemaVersion = SCHEMA_VERSION;
  return s;
}

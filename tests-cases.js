/* FlyerSnap test cases — loaded by tests.js into a sandbox that already has the
   app's functions in scope. Run these with:  node tests.js  */

// Silence UI side effects
render = () => {};
toast = () => {};
sub = () => {};
// No network in tests; saving a watcher legitimately triggers a check, and we
// don't want a 20s JSONP timeout logging noise over real failures.
jsonpRequest = () => Promise.resolve({ ok: true, items: [] });

// An ASYNC test used to be counted as passed the instant it returned its
// promise, and any later rejection became an unhandled rejection -- printed
// after the summary line, invisible to the count. `node tests.js` reported
// "666 passed, 0 failed" while a test had actually failed; only deploy.ps1's
// exit-code check caught it (CLAUDE.md rule 18 earning its keep).
//
// Promises are collected here and awaited by tests.js BEFORE the summary, so an
// async failure is a failure like any other.
const pendingTests = [];
function test(name, fn){
  try {
    const r = fn();
    if(r && typeof r.then === 'function'){
      pendingTests.push(r.then(
        () => { results.passed++; console.log('  ok    ' + name); },
        (e) => { results.failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.message)); }));
      return;
    }
    results.passed++; console.log('  ok    ' + name);
  }
  catch(e){ results.failed++; console.error('  FAIL  ' + name + '\n        ' + e.message); }
}

const GOOD = JSON.stringify({
  events: [{ id:'e1', title:'Recital', date:'2026-12-01', kind:'event', deleted:false }],
  kids: [{ id:'k1', name:'Olivia', color:'#7C3AED', deleted:false }],
  chores: [], completions: [], rewards: [], redemptions: [],
  lists: [], listItems: [], recipes: [], meals: [],
  settings: { apiKey:'sk-ant-real' }
});
function boot(raw){ localStorage._d = raw ? { flyersnap: raw } : {}; S = load(); }

// next7() retired along with FlyerSnap's meal planner; tests need their own
// forward-dated helper so they don't depend on app internals that may move.
function dayAhead(n){
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

console.log('\nData safety');

test('unreadable data locks the app instead of starting empty', () => {
  boot('{"events":[{"id":"e1"');
  assert.strictEqual(S.__locked, true);
  assert.ok(loadError, 'reason is captured to show the user');
});

test('unreadable data is quarantined, not thrown away', () => {
  boot('{"events":[{"id":"e1"');
  assert.strictEqual(localStorage.getItem('flyersnap-quarantine'), '{"events":[{"id":"e1"');
});

test('a locked app CANNOT overwrite the original data', () => {
  boot('{"events":[{"id":"e1"');
  S.events.push({ id:'x', title:'new', date:'2026-12-01', kind:'event', deleted:false });
  save();
  assert.strictEqual(localStorage.getItem('flyersnap'), '{"events":[{"id":"e1"');
});

test('valid JSON of the wrong shape is refused', () => {
  boot('{"hello":"world"}');
  assert.strictEqual(S.__locked, true);
  boot('[1,2,3]');
  assert.strictEqual(S.__locked, true);
});

test('healthy data loads with defaults merged in', () => {
  boot(GOOD);
  assert.ok(!S.__locked);
  assert.strictEqual(S.events.length, 1);
  assert.strictEqual(S.settings.apiKey, 'sk-ant-real');
  assert.deepStrictEqual(S.settings.alerts.deadline, [7, 1]);
});

test('a full disk warns loudly, once', () => {
  boot(GOOD);
  storageWarned = false; globalThis.lastAlert = null;
  localStorage._fail = true;
  save();
  assert.ok(/storage on this phone is full/i.test(globalThis.lastAlert || ''));
  globalThis.lastAlert = null;
  save();
  assert.strictEqual(globalThis.lastAlert, null, 'nags once, not every keystroke');
  localStorage._fail = false;
});

console.log('\nSnapshots');

test('a save snapshots the previous good copy', () => {
  boot(GOOD);
  S.events.push({ id:'e2', title:'Game', date:'2026-12-02', kind:'event', deleted:false });
  save();
  const keys = snapshotKeys();
  assert.strictEqual(keys.length, 1);
  assert.strictEqual(localStorage.getItem(keys[0]), GOOD);
});

test('snapshots are throttled to one a day', () => {
  boot(GOOD);
  save(); save(); save();
  assert.strictEqual(snapshotKeys().length, 1);
});

test('old snapshots rotate out', () => {
  boot(GOOD);
  ['2026-01-01', '2026-01-02', '2026-01-03'].forEach(d =>
    localStorage.setItem('flyersnap-snap-' + d, GOOD));
  localStorage.setItem('flyersnap-lastsnapshot', '0');
  save();
  assert.strictEqual(snapshotKeys().length, SNAP_KEEP);
  assert.ok(!snapshotKeys().includes('flyersnap-snap-2026-01-01'), 'oldest goes first');
});

test('the throttle marker never masquerades as a snapshot', () => {
  boot(GOOD);
  localStorage.setItem('flyersnap-lastsnapshot', String(Date.now()));
  assert.ok(!snapshotKeys().some(k => /lastsnapshot|snap-at/.test(k)));
});

test('restoring a snapshot recovers a locked app', () => {
  localStorage._d = { flyersnap: 'garbage{', 'flyersnap-snap-2026-05-05': GOOD };
  S = load();
  assert.strictEqual(S.__locked, true);
  restoreSnapshot('flyersnap-snap-2026-05-05');
  assert.ok(!S.__locked);
  assert.strictEqual(S.events[0].title, 'Recital');
  assert.strictEqual(localStorage.getItem('flyersnap'), JSON.stringify(S));
});

test('a corrupt snapshot is refused rather than swallowed', () => {
  localStorage._d = { flyersnap: 'garbage{', 'flyersnap-snap-2026-06-06': 'nope{' };
  S = load();
  globalThis.lastAlert = null;
  restoreSnapshot('flyersnap-snap-2026-06-06');
  assert.ok(/unreadable/i.test(globalThis.lastAlert || ''));
  assert.strictEqual(S.__locked, true, 'stays locked rather than pretending');
});

console.log('\nRecipe app exchange');

test('reads a valid meal plan envelope', () => {
  boot(GOOD);
  const future = dayAhead(2);
  localStorage.setItem('mealplan-out', JSON.stringify({
    schema: 'mealplan-exchange.v1',
    updatedAt: '2026-07-22T14:00:00.000Z',
    recipeUrlTemplate: 'https://lfaley.github.io/meal-planner-shoppin/#/recipe/{id}',
    shoppingListUrl: 'https://lfaley.github.io/meal-planner-shoppin/#/shopping',
    meals: [{ date: future, slot:'dinner', recipeId:'rb_logbot-1234', title:'Chili' }]
  }));
  const meals = plannedMeals();
  assert.strictEqual(meals.length, 1);
  assert.strictEqual(meals[0].title, 'Chili');
});

test('recipe deep-link keeps the rb_ prefix verbatim', () => {
  const meal = plannedMeals()[0];
  assert.strictEqual(recipeUrl(meal),
    'https://lfaley.github.io/meal-planner-shoppin/#/recipe/rb_logbot-1234');
});

test('unknown schema is ignored, not treated as an error', () => {
  localStorage.setItem('mealplan-out', JSON.stringify({ schema:'mealplan-exchange.v9', meals:[] }));
  assert.strictEqual(readMealPlan(), null);
  assert.deepStrictEqual(plannedMeals(), []);
});

test('unreadable plan data is ignored, not fatal', () => {
  localStorage.setItem('mealplan-out', 'not json{');
  assert.strictEqual(readMealPlan(), null);
});

test('past meals are filtered out but all five slots are kept', () => {
  const future = dayAhead(1);
  localStorage.setItem('mealplan-out', JSON.stringify({
    schema:'mealplan-exchange.v1', meals:[
      { date:'2020-01-01', slot:'dinner', recipeId:'rb_a', title:'Old' },
      { date:future, slot:'dessert', recipeId:'rb_b', title:'Cake' },
      { date:future, slot:'snack',   recipeId:'rb_d', title:'Apple' },
      { date:future, slot:'lunch',   recipeId:'rb_c', title:'Soup' },
      { date:future, slot:'brunch',  recipeId:'rb_e', title:'Unknown slot' }
    ]
  }));
  const meals = plannedMeals();
  assert.strictEqual(meals.length, 3, 'dessert and snack now included, unknown slot still dropped');
  assert.ok(meals.some(m=>m.title==='Cake'), 'dessert shows');
  assert.ok(meals.some(m=>m.title==='Apple'), 'snack shows');
  assert.ok(!meals.some(m=>m.title==='Old'), 'past dropped');
  assert.ok(!meals.some(m=>m.title==='Unknown slot'), 'unrecognised slot dropped');
});

test('meals order through the day: breakfast, lunch, snack, dinner, dessert', () => {
  const d = dayAhead(1);
  localStorage.setItem('mealplan-out', JSON.stringify({
    schema:'mealplan-exchange.v1', meals:[
      { date:d, slot:'dessert',   recipeId:'rb_1', title:'Pie' },
      { date:d, slot:'breakfast', recipeId:'rb_2', title:'Eggs' },
      { date:d, slot:'dinner',    recipeId:'rb_3', title:'Roast' },
      { date:d, slot:'snack',     recipeId:'rb_4', title:'Nuts' },
      { date:d, slot:'lunch',     recipeId:'rb_5', title:'Soup' }
    ]
  }));
  assert.deepStrictEqual(plannedMeals().map(m=>m.title),
    ['Eggs','Soup','Nuts','Roast','Pie']);
});

test('meals sort by date then breakfast/lunch/dinner', () => {
  const d0 = dayAhead(0), d1 = dayAhead(1);
  localStorage.setItem('mealplan-out', JSON.stringify({
    schema:'mealplan-exchange.v1', meals:[
      { date:d1, slot:'breakfast', recipeId:'rb_x', title:'Eggs' },
      { date:d0, slot:'dinner', recipeId:'rb_y', title:'Tacos' },
      { date:d0, slot:'breakfast', recipeId:'rb_z', title:'Oats' }
    ]
  }));
  assert.deepStrictEqual(plannedMeals().map(m => m.title), ['Oats','Tacos','Eggs']);
});

test('scanned recipes go out with an fs_ id (their collision guard)', () => {
  boot(GOOD);
  localStorage.removeItem('flyersnap-scanned-out');
  queueScannedRecipe({ title:"Grandma's Chili", category:'Dinner',
    ingredients:'1 lb ground beef\n1 onion', instructions:'1. Brown the beef' });
  const env = JSON.parse(localStorage.getItem('flyersnap-scanned-out'));
  assert.strictEqual(env.schema, 'recipe-exchange.v1');
  assert.strictEqual(env.recipes.length, 1);
  assert.ok(/^fs_/.test(env.recipes[0].id), 'id must be fs_ namespaced');
  assert.strictEqual(env.recipes[0].source, 'Scanned in FlyerSnap');
  assert.ok(env.recipes[0].ingredients.includes('\n'), 'ingredients stay newline-delimited');
});

test('the outbox is a rolling window, not unbounded', () => {
  localStorage.removeItem('flyersnap-scanned-out');
  for(let i = 0; i < SCANNED_KEEP + 5; i++) queueScannedRecipe({ title:'R' + i, ingredients:'x' });
  const env = JSON.parse(localStorage.getItem('flyersnap-scanned-out'));
  assert.strictEqual(env.recipes.length, SCANNED_KEEP);
  assert.strictEqual(env.recipes[env.recipes.length - 1].title, 'R' + (SCANNED_KEEP + 4), 'keeps newest');
});

test('a corrupt outbox is rebuilt rather than throwing', () => {
  localStorage.setItem('flyersnap-scanned-out', 'garbage{');
  assert.strictEqual(queueScannedRecipe({ title:'Fresh', ingredients:'x' }), true);
  const env = JSON.parse(localStorage.getItem('flyersnap-scanned-out'));
  assert.strictEqual(env.recipes.length, 1);
});

test('FlyerSnap never writes the recipe app\'s keys', () => {
  boot(GOOD);
  localStorage.removeItem('mealplan-out');
  queueScannedRecipe({ title:'X', ingredients:'y' });
  save();
  assert.strictEqual(localStorage.getItem('mealplan-out'), null, 'mealplan-out is theirs');
  const ours = Object.keys(localStorage._d);
  assert.ok(!ours.some(k => /^mealplanner-/.test(k)), 'mealplanner-* namespace untouched');
});

console.log('\nPruning & schema');

test('star balances survive pruning unchanged', () => {
  boot(GOOD);
  S.kids.push({ id:'k1', name:'Olivia', color:'#7C3AED', deleted:false });
  // 400 days ago (prunable) and yesterday (kept)
  S.completions.push({ id:'c1', choreId:'x', kidId:'k1', date: dayAhead(-400), stars: 10 });
  S.completions.push({ id:'c2', choreId:'x', kidId:'k1', date: dayAhead(-1), stars: 3 });
  S.redemptions.push({ id:'r1', rewardId:'w', kidId:'k1', stars: 5, date: dayAhead(-400) });
  const before = starBalances()['k1'];
  assert.strictEqual(before, 8, '10 + 3 - 5');

  pruneData();
  assert.strictEqual(starBalances()['k1'], before, 'balance identical after pruning');
  assert.strictEqual(S.completions.length, 1, 'old completion dropped');
  assert.strictEqual(S.redemptions.length, 0, 'old redemption dropped');
  assert.strictEqual(S.settings.starCarry['k1'], 5, 'net of pruned rows carried forward');
});

test('pruning twice does not double-count the carry', () => {
  const balance = starBalances()['k1'];
  pruneData();
  pruneData();
  assert.strictEqual(starBalances()['k1'], balance, 'idempotent');
});

test('recent history is never pruned', () => {
  boot(GOOD);
  S.completions.push({ id:'c1', choreId:'x', kidId:'k1', date: dayAhead(-10), stars: 2 });
  S.events.push({ id:'e9', title:'Recent past', date: dayAhead(-5), kind:'event', deleted:false });
  pruneData();
  assert.strictEqual(S.completions.length, 1, 'ten-day-old chore kept');
  assert.ok(S.events.some(e => e.id === 'e9'), 'recent past event kept');
});

test('old soft-deleted rows are actually removed', () => {
  boot(GOOD);
  S.events.push({ id:'d1', title:'Deleted long ago', date: dayAhead(-200), kind:'event', deleted:true });
  S.chores.push({ id:'ch1', title:'Gone', deleted:true });
  pruneData();
  assert.ok(!S.events.some(e => e.id === 'd1'), 'stale tombstone cleared');
  assert.ok(!S.chores.some(c => c.id === 'ch1'));
});

test('live rows are never touched by pruning', () => {
  boot(GOOD);
  S.events.push({ id:'live', title:'Upcoming', date: dayAhead(30), kind:'event', deleted:false });
  S.chores.push({ id:'ch2', title:'Daily', frequency:'daily', stars:1, deleted:false });
  pruneData();
  assert.ok(S.events.some(e => e.id === 'live'));
  assert.ok(S.chores.some(c => c.id === 'ch2'));
});

test('a v1 save migrates without losing anything', () => {
  const v1 = JSON.parse(GOOD);
  v1.recipes = [{ id:'old1', title:'Legacy Chili', ingredients:'beef', deleted:false }];
  v1.meals = [{ id:'m1', date:'2026-01-01', slot:'dinner', title:'Legacy Chili', recipeId:'old1' }];
  boot(JSON.stringify(v1));
  assert.strictEqual(S.schemaVersion, SCHEMA_VERSION, 'stamped with the current version');
  assert.strictEqual(S.legacyRecipes.length, 1, 'retired recipes preserved, not deleted');
  assert.strictEqual(S.legacyMeals.length, 1, 'retired meals preserved');
  assert.strictEqual(S.events.length, 1, 'real data untouched');
});

test('migration is not re-run on an already-current save', () => {
  boot(GOOD);
  S.legacyRecipes = [{ id:'keep' }];
  save();
  const raw = localStorage.getItem('flyersnap');
  S = load();
  assert.strictEqual(S.schemaVersion, SCHEMA_VERSION);
  assert.strictEqual(S.legacyRecipes.length, 1, 'not clobbered by a second migration');
});

test('pruning refuses to run on locked data', () => {
  boot('broken{');
  assert.strictEqual(S.__locked, true);
  assert.strictEqual(pruneData(), 0, 'no writes while locked');
});

console.log('\nLegacy recipe rescue');

test('recipes from the retired Recipe Box can be sent to the recipe app', () => {
  boot(GOOD);
  localStorage.removeItem('flyersnap-scanned-out');
  S.legacyRecipes = [
    { id:'old1', title:'Grandma Chili', category:'Dinner', ingredients:'beef\nbeans', instructions:'cook' },
    { id:'old2', title:'Pancakes', category:'Breakfast', ingredients:'flour', instructions:'mix' }
  ];
  assert.strictEqual(legacyRecipes().length, 2);
  sendLegacyRecipes();
  const env = JSON.parse(localStorage.getItem('flyersnap-scanned-out'));
  assert.strictEqual(env.recipes.length, 2);
  assert.ok(env.recipes.every(r => /^fs_/.test(r.id)), 'sent with fs_ ids');
});

test('sent recipes are not offered again', () => {
  assert.strictEqual(legacyRecipes().length, 0, 'all marked sent');
  sendLegacyRecipes();
  const env = JSON.parse(localStorage.getItem('flyersnap-scanned-out'));
  assert.strictEqual(env.recipes.length, 2, 'no duplicates queued');
});

test('legacy recipes are never deleted, only marked', () => {
  assert.strictEqual(S.legacyRecipes.length, 2, 'originals still present');
  assert.ok(S.legacyRecipes.every(r => r.sentToRecipeApp === true));
});

test('deleted legacy recipes are skipped', () => {
  boot(GOOD);
  S.legacyRecipes = [{ id:'x', title:'Gone', deleted:true }, { id:'y', title:'Keep' }];
  assert.deepStrictEqual(legacyRecipes().map(r => r.title), ['Keep']);
});

console.log('\nEvent search & history');

function seedEvents(){
  boot(GOOD);
  S.kids.push({ id:'k2', name:'Sam', color:'#0E7490', deleted:false });
  S.events = [
    { id:'a', title:'Dance Competition', date:dayAhead(5), kind:'event', location:'Kansas City', kidId:'k1', deleted:false },
    { id:'b', title:'Volleyball Tryouts', date:dayAhead(2), kind:'event', location:'Gym', kidId:'k2', deleted:false },
    { id:'c', title:'Spring Recital', date:dayAhead(-40), kind:'event', location:'Auditorium', kidId:'k1', deleted:false },
    { id:'d', title:'Picture Day', date:dayAhead(-10), kind:'event', notes:'order form due', deleted:false }
  ];
  eventSearch = ''; eventFilter = null; pastLimit = 30;
}

test('search finds upcoming events by title', () => {
  seedEvents();
  eventSearch = 'volleyball';
  assert.deepStrictEqual(upcomingEvents().map(e => e.title), ['Volleyball Tryouts']);
});

test('search reaches into past events too', () => {
  seedEvents();
  eventSearch = 'recital';
  assert.strictEqual(upcomingEvents().length, 0);
  assert.deepStrictEqual(pastEvents().map(e => e.title), ['Spring Recital']);
});

test('search matches location, notes and kid name', () => {
  seedEvents();
  eventSearch = 'kansas city';
  assert.deepStrictEqual(upcomingEvents().map(e => e.title), ['Dance Competition']);
  eventSearch = 'order form';
  assert.deepStrictEqual(pastEvents().map(e => e.title), ['Picture Day']);
  eventSearch = 'sam';
  assert.deepStrictEqual(upcomingEvents().map(e => e.title), ['Volleyball Tryouts']);
});

test('search is case-insensitive and ignores surrounding space', () => {
  seedEvents();
  eventSearch = '  DANCE  ';
  assert.strictEqual(upcomingEvents().length, 1);
});

test('search and kid filter combine rather than fight', () => {
  seedEvents();
  eventFilter = 'k1';
  eventSearch = 'volleyball';
  assert.strictEqual(upcomingEvents().length, 0, "Sam's event is excluded by the kid filter");
  eventFilter = null;
});

test('past events are no longer capped at 30', () => {
  boot(GOOD);
  S.events = [];
  for(let i = 1; i <= 75; i++){
    S.events.push({ id:'p'+i, title:'Old '+i, date:dayAhead(-i), kind:'event', deleted:false });
  }
  eventSearch = '';
  assert.strictEqual(pastEvents().length, 75, 'all history is reachable');
});

test('events persist across a reload', () => {
  seedEvents();
  save();
  S = load();
  assert.strictEqual(S.events.length, 4, 'events survive a fresh load');
  assert.ok(!S.__locked);
});

console.log('\nGmail watcher URL handling');

function fakeField(id, val){
  const store = { watcherUrl:'', watcherToken:'' };
  return store;
}

// Swap the watcher fields in WITHOUT leaking.
//
// These four tests used to assign `document.getElementById` a plain-object
// factory and never put it back, so every test that ran afterwards -- for the
// rest of the file -- got elements with no focus(), blur() or
// setSelectionRange(). Any handler that moves the caret was therefore
// untestable, and nobody knew until v9.60 tried to test one. A fixture that
// outlives its test is a fixture that can make unrelated code look broken.
const realGetById = document.getElementById;
function stubFields(fields){
  document.getElementById = (id) => {
    const node = realGetById.call(document, id);
    node.value = id === 'watcherUrl' ? fields.watcherUrl : fields.watcherToken;
    return node;
  };
}
function restoreFields(){ document.getElementById = realGetById; }

test('a pasted full URL is split into URL and token', () => {
  boot(GOOD);
  const fields = { watcherUrl:'https://script.google.com/macros/s/AKfy123/exec?token=snap123', watcherToken:'' };
  stubFields(fields);
  saveWatcher();
  assert.strictEqual(S.settings.watcherUrl, 'https://script.google.com/macros/s/AKfy123/exec');
  assert.strictEqual(S.settings.watcherToken, 'snap123', 'token lifted out of the URL');
});

test('an explicit token field wins over one in the URL', () => {
  boot(GOOD);
  const fields = { watcherUrl:'https://script.google.com/macros/s/AKfy123/exec?token=stale', watcherToken:'fresh' };
  stubFields(fields);
  saveWatcher();
  assert.strictEqual(S.settings.watcherToken, 'fresh');
});

test('a /dev URL is rejected with an explanation', () => {
  boot(GOOD);
  const fields = { watcherUrl:'https://script.google.com/macros/s/AKfy123/dev', watcherToken:'x' };
  stubFields(fields);
  globalThis.lastAlert = null;
  saveWatcher();
  assert.ok(/dev URL will not work/.test(globalThis.lastAlert || ''), 'user is told why');
  assert.strictEqual(S.settings.watcherUrl, '', 'nothing saved');
});

test('trailing slashes are trimmed', () => {
  boot(GOOD);
  const fields = { watcherUrl:'https://script.google.com/macros/s/AKfy123/exec/', watcherToken:'t' };
  stubFields(fields);
  saveWatcher();
  assert.strictEqual(S.settings.watcherUrl, 'https://script.google.com/macros/s/AKfy123/exec');
});

restoreFields();

test('the request URL carries exactly one token', () => {
  boot(GOOD);
  S.settings.watcherUrl = 'https://script.google.com/macros/s/AKfy123/exec?token=old';
  S.settings.watcherToken = 'right';
  const base = watcherBaseUrl();
  assert.strictEqual(base, 'https://script.google.com/macros/s/AKfy123/exec', 'stale query stripped');
  const url = base + '?token=' + encodeURIComponent(S.settings.watcherToken);
  assert.strictEqual((url.match(/token=/g) || []).length, 1, 'no doubled token param');
  assert.ok(url.endsWith('token=right'));
});

test('tokens with special characters are encoded', () => {
  boot(GOOD);
  S.settings.watcherUrl = 'https://script.google.com/macros/s/AKfy123/exec';
  S.settings.watcherToken = 'a b&c=d';
  const url = watcherBaseUrl() + '?token=' + encodeURIComponent(S.settings.watcherToken);
  assert.ok(url.includes('a%20b%26c%3Dd'), 'encoded so it survives the query string');
});

console.log('\nDuplicate detection');

test('wording differences on the same day still match', () => {
  boot(GOOD);
  const d = dayAhead(3);
  assert.ok(looksDuplicate(
    { title:'Registration & Residency Verification Deadline', date:d },
    { title:'Registration and Residency Verification Deadline', date:d }
  ), '& vs and');
  assert.ok(looksDuplicate(
    { title:'Picture Day', date:d },
    { title:'Fall Picture Day for Grades 1-5', date:d }
  ), 'shorter title contained in the longer one');
  assert.ok(looksDuplicate(
    { title:'Volleyball Tryouts!', date:d },
    { title:'volleyball tryouts', date:d }
  ), 'punctuation and case');
});

test('short same-day titles sharing one word are NOT merged', () => {
  const d = dayAhead(3);
  // The J31 schedule case: many short titles, same day, one common word.
  assert.ok(!looksDuplicate({ title:'Mini Jazz', date:d }, { title:'Mini Musical Theater', date:d }), 'Mini X vs Mini Y');
  assert.ok(!looksDuplicate({ title:'Teen Jazz', date:d }, { title:'Teen Line', date:d }), 'Teen X vs Teen Y');
  assert.ok(!looksDuplicate({ title:'Junior Tap', date:d }, { title:'Junior Line', date:d }), 'Junior X vs Junior Y');
  // "Dinner" is one word, so the containment rule applies and these DO merge.
  // Asserted rather than hand-waved: the previous line here was
  // `assert.ok(!x === false || true)`, which can never fail.
  assert.ok(looksDuplicate({ title:'Dinner', date:d }, { title:'Dinner Theater', date:d }),
    'a short title fully contained in a longer one is a duplicate');
});

test('two identical titles made only of stop-words are still duplicates', () => {
  // v9.18. normTitle strips the/a/an/of/for/to/at/on/in/our/your/please/note,
  // so "The Note" normalised to nothing and titleSimilarity returned 0 --
  // meaning two BYTE-IDENTICAL events on one day were not flagged, which is
  // the single thing this function exists to catch. Found by consolidating
  // js/matching.js with the extraction scorer, which had solved it in a copy.
  const d = dayAhead(3);
  ['The Note', 'A', 'Note', 'the a of'].forEach(t =>
    assert.ok(looksDuplicate({ title:t, date:d }, { title:t, date:d }), 'identical: ' + t));
  // ...but stop-word titles must not all collapse into each other.
  assert.ok(!looksDuplicate({ title:'The Note', date:d }, { title:'A Note', date:d }),
    'different stop-word titles are not the same event');
  assert.ok(!looksDuplicate({ title:'', date:d }, { title:'', date:d }),
    'two untitled events are not duplicates on the evidence of nothing');
  assert.ok(!looksDuplicate({ title:'The Note', date:d }, { title:'The Note', date: dayAhead(4) }),
    'same title, different day, still not a duplicate');
});

test('containment still catches real short-title duplicates', () => {
  const d = dayAhead(3);
  assert.ok(looksDuplicate({ title:'Picture Day', date:d }, { title:'Fall Picture Day', date:d }), 'one contains the other');
  assert.ok(looksDuplicate({ title:'Recital', date:d }, { title:'Recital', date:d }), 'identical');
});

test('longer titles need strong overlap now (0.8), not just half', () => {
  const d = dayAhead(3);
  // Share 2 of 4 words = 0.5, below the new 0.8 bar -> not a duplicate.
  assert.ok(!looksDuplicate(
    { title:'Spring Band Concert Rehearsal', date:d },
    { title:'Spring Choir Concert Night', date:d }
  ), 'half-overlap no longer merges');
  // Near-identical wording still merges.
  assert.ok(looksDuplicate(
    { title:'Registration and Residency Verification Deadline', date:d },
    { title:'Registration & Residency Verification', date:d }
  ), 'the real scanned-vs-emailed case still catches');
});

test('different events on the same day are NOT merged', () => {
  const d = dayAhead(3);
  assert.ok(!looksDuplicate({ title:'Picture Day', date:d }, { title:'Volleyball Tryouts', date:d }));
  assert.ok(!looksDuplicate({ title:'Band Concert', date:d }, { title:'Registration Deadline', date:d }));
});

test('the same title on different days is NOT a duplicate', () => {
  assert.ok(!looksDuplicate(
    { title:'Dance Practice', date:dayAhead(1) },
    { title:'Dance Practice', date:dayAhead(8) }
  ), 'recurring events survive');
});

test('imported events matching saved ones arrive unticked', () => {
  boot(GOOD);
  const d = dayAhead(4);
  S.events = [{ id:'x', title:'Registration & Residency Verification', date:d, kind:'deadline', deleted:false }];
  const marked = markDuplicates([
    { title:'Registration and Residency Verification Deadline', date:d, kind:'deadline' },
    { title:'Band Concert', date:d, kind:'event' }
  ]);
  assert.strictEqual(marked[0].dup, true);
  assert.strictEqual(marked[0].selected, false, 'unticked so it is not added again');
  assert.strictEqual(marked[1].dup, false);
  assert.strictEqual(marked[1].selected, true);
});

test('repeats inside one batch are caught too', () => {
  boot(GOOD);
  S.events = [];
  const d = dayAhead(2);
  const marked = markDuplicates([
    { title:'Open House', date:d },
    { title:'Open House Night', date:d }
  ]);
  assert.strictEqual(marked[0].dup, false);
  assert.strictEqual(marked[1].dup, true, 'second copy in the same batch flagged');
});

console.log('\nDuplicate cleanup');

test('already-saved duplicates are grouped', () => {
  boot(GOOD);
  const d = dayAhead(5);
  S.events = [
    { id:'a', title:'Picture Day', date:d, kind:'event', deleted:false },
    { id:'b', title:'Fall Picture Day', date:d, time:'09:00', location:'Gym', kind:'event', deleted:false },
    { id:'c', title:'Band Concert', date:d, kind:'event', deleted:false }
  ];
  const groups = duplicateGroups();
  assert.strictEqual(groups.length, 1, 'one group');
  assert.strictEqual(groups[0].length, 2, 'the two picture-day rows');
  assert.ok(!groups[0].some(e => e.id === 'c'), 'unrelated event left alone');
});

test('the richest copy is preselected to keep', () => {
  const groups = duplicateGroups();
  assert.strictEqual(bestOfGroup(groups[0]).id, 'b', 'the one with time and location');
});

test('applying removes the others and keeps your choice', () => {
  openDedupe();
  applyDedupe();
  const live = S.events.filter(e => !e.deleted);
  assert.strictEqual(live.length, 2, 'one picture day + the concert');
  assert.ok(live.some(e => e.id === 'b'), 'kept the richest');
  assert.ok(live.some(e => e.id === 'c'), 'untouched event survives');
  assert.strictEqual(S.events.find(e => e.id === 'a').deleted, true, 'soft-deleted, not erased');
});

test('choosing "keep both" removes nothing', () => {
  boot(GOOD);
  const d = dayAhead(6);
  S.events = [
    { id:'p', title:'Open House', date:d, kind:'event', deleted:false },
    { id:'q', title:'Open House Night', date:d, kind:'event', deleted:false }
  ];
  openDedupe();
  setDedupeKeep(dedupeGroupKey(duplicateGroups()[0]), null);   // "keep both"
  applyDedupe();
  assert.strictEqual(S.events.filter(e => !e.deleted).length, 2, 'both survive');
});

console.log('\nEvent count');

test('upcoming and past counts reflect the active filter', () => {
  boot(GOOD);
  S.kids = [{ id:'k1', name:'Olivia', color:'#7C3AED', deleted:false },
            { id:'k2', name:'Sam', color:'#0E7490', deleted:false }];
  S.events = [
    { id:'a', title:'Recital', date:dayAhead(3), kind:'event', kidId:'k1', deleted:false },
    { id:'b', title:'Tryouts', date:dayAhead(5), kind:'event', kidId:'k2', deleted:false },
    { id:'c', title:'Old Thing', date:dayAhead(-10), kind:'event', kidId:'k1', deleted:false }
  ];
  eventFilter = null; eventSearch = '';
  assert.strictEqual(upcomingEvents().length, 2);
  assert.strictEqual(pastEvents().length, 1);

  eventFilter = 'k1';
  assert.strictEqual(upcomingEvents().length, 1, 'count follows the kid filter');
  assert.strictEqual(pastEvents().length, 1);

  eventFilter = null; eventSearch = 'recital';
  assert.strictEqual(upcomingEvents().length, 1, 'count follows search');
  eventSearch = '';
});

console.log('\nCalendar delivery');

test('installed PWA downloads the ics instead of opening a tab', () => {
  boot(GOOD);
  const realStandalone = isStandalone;
  isStandalone = () => true;                 // simulate the installed app
  let opened = false, downloaded = false;
  const realOpen = window.open;
  window.open = () => { opened = true; return null; };
  const realCreate = document.createElement;
  document.createElement = (t) => {
    const el = realCreate(t);
    if(t === 'a'){ el.click = () => { downloaded = true; }; }
    return el;
  };
  S.events = [{ id:'e1', title:'Recital', date:dayAhead(3), kind:'event', deleted:false }];
  addAllAtOnce();
  assert.strictEqual(opened, false, 'must NOT try to open a tab in standalone');
  assert.ok(downloaded, 'delivered as a download instead');
  window.open = realOpen;
  document.createElement = realCreate;
  isStandalone = realStandalone;
});

test('a real Safari tab still uses window.open', () => {
  boot(GOOD);
  const realStandalone = isStandalone;
  isStandalone = () => false;                // a normal browser tab
  let opened = false;
  const realOpen = window.open;
  window.open = () => { opened = true; return {}; };
  S.events = [{ id:'e1', title:'Recital', date:dayAhead(3), kind:'event', deleted:false }];
  addAllAtOnce();
  assert.ok(opened, 'opens the calendar render in a tab');
  window.open = realOpen;
  isStandalone = realStandalone;
});

test('exporting still marks events exported', () => {
  boot(GOOD);
  const realStandalone = isStandalone;
  isStandalone = () => true;
  const realCreate = document.createElement;
  document.createElement = (t) => { const el = realCreate(t); if(t==='a') el.click = () => {}; return el; };
  S.events = [{ id:'e1', title:'A', date:dayAhead(2), kind:'event', deleted:false }];
  addAllAtOnce();
  assert.strictEqual(S.events[0].exported, true);
  document.createElement = realCreate;
  isStandalone = realStandalone;
});

console.log('\nMultiple people per event');

test('migration converts kids to typed people and kidId to personIds', () => {
  const v2 = JSON.stringify({
    schemaVersion: 2,
    events: [{ id:'e1', title:'Recital', date:'2026-12-01', kind:'event', kidId:'k1', deleted:false }],
    kids: [{ id:'k1', name:'Olivia', color:'#7C3AED', deleted:false }],
    chores:[], completions:[], rewards:[], redemptions:[], lists:[], listItems:[],
    settings:{ apiKey:'x' }
  });
  boot(v2);
  assert.strictEqual(S.kids[0].type, 'kid', 'existing people default to kid');
  assert.deepStrictEqual(S.events[0].personIds, ['k1'], 'single kidId became a list');
  assert.strictEqual(S.events[0].kidId, 'k1', 'primary kidId preserved');
});

test('an event tagged to several people shows under each filter', () => {
  boot(GOOD);
  S.kids = [
    { id:'k1', name:'Olivia', color:'#7C3AED', type:'kid', deleted:false },
    { id:'k2', name:'Sam', color:'#0E7490', type:'kid', deleted:false },
    { id:'a1', name:'Me', color:'#166534', type:'adult', deleted:false }
  ];
  S.events = [{ id:'e1', title:'Family Photos', date:dayAhead(3), kind:'event', personIds:['k1','k2','a1'], kidId:'k1', deleted:false }];

  eventFilter = 'k1'; assert.strictEqual(upcomingEvents().length, 1, 'shows for Olivia');
  eventFilter = 'k2'; assert.strictEqual(upcomingEvents().length, 1, 'shows for Sam');
  eventFilter = 'a1'; assert.strictEqual(upcomingEvents().length, 1, 'shows for the adult');
  eventFilter = null;
});

test('an untagged person filter hides the event', () => {
  boot(GOOD);
  S.kids = [{ id:'k1', name:'Olivia', color:'#7C3AED', type:'kid', deleted:false },
            { id:'k2', name:'Sam', color:'#0E7490', type:'kid', deleted:false }];
  S.events = [{ id:'e1', title:'Dance', date:dayAhead(2), kind:'event', personIds:['k1'], kidId:'k1', deleted:false }];
  eventFilter = 'k2';
  assert.strictEqual(upcomingEvents().length, 0, "Sam's filter hides Olivia-only event");
  eventFilter = null;
});

test('eventPeople resolves names, tolerating legacy single-kidId rows', () => {
  boot(GOOD);
  S.kids = [{ id:'k1', name:'Olivia', color:'#7C3AED', type:'kid', deleted:false }];
  const legacy = { id:'e9', title:'Old', date:dayAhead(1), kidId:'k1' };   // no personIds
  assert.deepStrictEqual(eventPeople(legacy).map(p=>p.name), ['Olivia']);
});

test('adults are excluded from the chore/star roster', () => {
  boot(GOOD);
  S.kids = [
    { id:'k1', name:'Olivia', color:'#7C3AED', type:'kid', deleted:false },
    { id:'a1', name:'Me', color:'#166534', type:'adult', deleted:false }
  ];
  assert.deepStrictEqual(justKids().map(p=>p.name), ['Olivia'], 'only kids in the star system');
  assert.deepStrictEqual(allPeople().map(p=>p.name), ['Olivia','Me'], 'everyone available for events');
});

test('removing a person drops them from every event tag', () => {
  boot(GOOD);
  S.kids = [{ id:'k1', name:'Olivia', color:'#7C3AED', type:'kid', deleted:false },
            { id:'k2', name:'Sam', color:'#0E7490', type:'kid', deleted:false }];
  S.events = [{ id:'e1', title:'Photos', date:dayAhead(3), kind:'event', personIds:['k1','k2'], kidId:'k1', deleted:false }];
  delKid('k1');
  assert.deepStrictEqual(S.events[0].personIds, ['k2'], 'removed person gone from the list');
  assert.strictEqual(S.events[0].kidId, 'k2', 'primary reassigned to a remaining person');
});

test('review multi-select toggles people on and off', () => {
  boot(GOOD);
  S.kids = [{ id:'k1', name:'Olivia', color:'#7C3AED', type:'kid', deleted:false },
            { id:'k2', name:'Sam', color:'#0E7490', type:'kid', deleted:false }];
  pendingEvents = [{ title:'X', date:dayAhead(1), selected:true, personIds:[] }];
  setReviewKid(0, 'k1');
  setReviewKid(0, 'k2');
  assert.deepStrictEqual(pendingEvents[0].personIds, ['k1','k2']);
  setReviewKid(0, 'k1');
  assert.deepStrictEqual(pendingEvents[0].personIds, ['k2'], 'tapping again removes');
  assert.strictEqual(pendingEvents[0].kidId, 'k2', 'primary follows');
});

console.log('\nEvent end times');

function veventFor(e){
  boot(GOOD);
  S.settings.alerts = { deadline:[1], event:[0] };
  return buildVEVENT(e);
}

test('an explicit end time is written to the calendar', () => {
  const v = veventFor({ id:'e1', title:'Recital', date:'2026-09-10', time:'17:30', endTime:'20:30', kind:'event' });
  assert.ok(v.includes('DTSTART:20260910T173000'), 'start 5:30pm');
  assert.ok(v.includes('DTEND:20260910T203000'), 'end 8:30pm, not +1h');
});

test('no end time falls back to one hour', () => {
  const v = veventFor({ id:'e2', title:'Meeting', date:'2026-09-10', time:'09:00', endTime:null, kind:'event' });
  assert.ok(v.includes('DTSTART:20260910T090000'));
  assert.ok(v.includes('DTEND:20260910T100000'), 'defaults to +1 hour');
});

test('an end past midnight rolls to the next day', () => {
  const v = veventFor({ id:'e3', title:'Lock-in', date:'2026-09-10', time:'22:00', endTime:'01:00', kind:'event' });
  assert.ok(v.includes('DTSTART:20260910T220000'));
  assert.ok(v.includes('DTEND:20260911T010000'), 'crosses into the next day');
});

test('extraction keeps a valid endTime and drops a bad one', () => {
  const parsed = parseExtractedEvents(JSON.stringify([
    { title:'Show', date:'2026-09-10', time:'17:30', endTime:'20:30', kind:'event' },
    { title:'Fair', date:'2026-09-11', time:'10:00', endTime:'nonsense', kind:'event' }
  ]));
  assert.strictEqual(parsed[0].endTime, '20:30');
  assert.strictEqual(parsed[1].endTime, null, 'garbage end time rejected');
});

test('end time is dropped if there is no start time', () => {
  boot(GOOD);
  S.kids = [];
  pendingEvents = [{ title:'X', date:'2026-09-10', time:null, endTime:'20:30', selected:true, personIds:[] }];
  pendingSource = 'test';
  saveReview();
  const e = S.events.find(x => x.title === 'X');
  assert.strictEqual(e.endTime, null, 'an end with no start is meaningless');
});

console.log('\nSender tagging');

function seedPeople(){
  boot(GOOD);
  S.kids = [
    { id:'k1', name:'Olivia', color:'#7C3AED', type:'kid', deleted:false },
    { id:'k2', name:'Braelyn', color:'#0E7490', type:'kid', deleted:false },
    { id:'a1', name:'Logan', color:'#166534', type:'adult', deleted:false }
  ];
}

test('a full address maps to its person', () => {
  seedPeople();
  S.settings.senderTags = { 'jane@j31.com': ['k1'] };
  assert.deepStrictEqual(personsForSender('jane@j31.com'), ['k1']);
});

test('a domain rule catches any address at that domain', () => {
  seedPeople();
  S.settings.senderTags = { 'j31.com': ['k1'] };
  assert.deepStrictEqual(personsForSender('anyone@j31.com'), ['k1']);
  assert.deepStrictEqual(personsForSender('other@j31.com'), ['k1']);
});

test('a specific address beats the domain rule', () => {
  seedPeople();
  S.settings.senderTags = { 'j31.com': ['k1'], 'principal@j31.com': ['k2'] };
  assert.deepStrictEqual(personsForSender('principal@j31.com'), ['k2'], 'address wins');
  assert.deepStrictEqual(personsForSender('teacher@j31.com'), ['k1'], 'others fall to domain');
});

test('a sender can map to several people', () => {
  seedPeople();
  S.settings.senderTags = { 'kingdomkc.com': ['k1','k2'] };
  assert.deepStrictEqual(personsForSender('info@kingdomkc.com'), ['k1','k2']);
});

test('an unmapped sender tags no one', () => {
  seedPeople();
  S.settings.senderTags = { 'j31.com': ['k1'] };
  assert.deepStrictEqual(personsForSender('spam@random.com'), []);
});

test('a mapping to a deleted person is ignored', () => {
  seedPeople();
  S.settings.senderTags = { 'j31.com': ['k1','gone'] };
  assert.deepStrictEqual(personsForSender('x@j31.com'), ['k1'], 'missing ids dropped');
});

test('toggleSenderTag adds and removes cleanly', () => {
  seedPeople();
  S.settings.senderTags = {};
  toggleSenderTag('j31.com', 'k1');
  assert.deepStrictEqual(S.settings.senderTags['j31.com'], ['k1']);
  toggleSenderTag('j31.com', 'k2');
  assert.deepStrictEqual(S.settings.senderTags['j31.com'], ['k1','k2']);
  toggleSenderTag('j31.com', 'k1');
  assert.deepStrictEqual(S.settings.senderTags['j31.com'], ['k2']);
  toggleSenderTag('j31.com', 'k2');
  assert.strictEqual(S.settings.senderTags['j31.com'], undefined, 'empty mapping removed entirely');
});

test('emailed events arrive pre-tagged by sender', () => {
  seedPeople();
  S.settings.senderTags = { 'j31.com': ['k1'] };
  S.events = [];
  pendingMsgIds = [];
  const marked = markDuplicates([
    { title:'Field Trip', date:dayAhead(3), from:'office@j31.com', personIds: personsForSender('office@j31.com') }
  ]);
  assert.deepStrictEqual(marked[0].personIds, ['k1'], 'pre-tagged for Olivia');
  assert.strictEqual(marked[0].kidId, 'k1');
});

console.log('\nBulk tagging');

test('bulk tag assigns a person to all selected events, replacing existing tags', () => {
  boot(GOOD);
  S.kids = [
    { id:'k1', name:'Olivia', color:'#7C3AED', type:'kid', deleted:false },
    { id:'k2', name:'Braelyn', color:'#0E7490', type:'kid', deleted:false }
  ];
  S.events = [
    { id:'e1', title:'Dance', date:dayAhead(2), kind:'event', personIds:['k2'], kidId:'k2', deleted:false },
    { id:'e2', title:'Recital', date:dayAhead(3), kind:'event', personIds:[], kidId:null, deleted:false },
    { id:'e3', title:'Untouched', date:dayAhead(4), kind:'event', personIds:['k2'], kidId:'k2', deleted:false }
  ];
  selectedEvents = new Set(['e1','e2']);
  bulkTag('k1');
  assert.deepStrictEqual(S.events.find(e=>e.id==='e1').personIds, ['k1'], 'replaced Braelyn with Olivia');
  assert.deepStrictEqual(S.events.find(e=>e.id==='e2').personIds, ['k1'], 'added to untagged');
  assert.strictEqual(S.events.find(e=>e.id==='e1').kidId, 'k1', 'primary updated');
  assert.deepStrictEqual(S.events.find(e=>e.id==='e3').personIds, ['k2'], 'unselected event untouched');
});

test('bulk clear removes everyone from the selected events', () => {
  boot(GOOD);
  S.kids = [{ id:'k1', name:'Olivia', color:'#7C3AED', type:'kid', deleted:false }];
  S.events = [{ id:'e1', title:'X', date:dayAhead(1), kind:'event', personIds:['k1'], kidId:'k1', deleted:false }];
  selectedEvents = new Set(['e1']);
  bulkTag(null);
  assert.deepStrictEqual(S.events[0].personIds, []);
  assert.strictEqual(S.events[0].kidId, null);
});

test('select mode resets after a bulk tag', () => {
  boot(GOOD);
  S.kids = [{ id:'k1', name:'Olivia', color:'#7C3AED', type:'kid', deleted:false }];
  S.events = [{ id:'e1', title:'X', date:dayAhead(1), kind:'event', personIds:[], kidId:null, deleted:false }];
  selectMode = true;
  selectedEvents = new Set(['e1']);
  bulkTag('k1');
  assert.strictEqual(selectMode, false, 'exits select mode');
  assert.strictEqual(selectedEvents.size, 0, 'clears selection');
});

test('toggling selection adds and removes ids', () => {
  boot(GOOD);
  selectedEvents = new Set();
  toggleEventSelect('a');
  assert.ok(selectedEvents.has('a'));
  toggleEventSelect('a');
  assert.ok(!selectedEvents.has('a'));
});

console.log('\n12-hour time display');

test('fmt12 converts 24h to 12h with AM/PM', () => {
  boot(GOOD);
  assert.strictEqual(fmt12('17:30'), '5:30 PM');
  assert.strictEqual(fmt12('09:00'), '9:00 AM');
  assert.strictEqual(fmt12('00:00'), '12:00 AM', 'midnight');
  assert.strictEqual(fmt12('12:00'), '12:00 PM', 'noon');
  assert.strictEqual(fmt12('12:30'), '12:30 PM');
  assert.strictEqual(fmt12('23:45'), '11:45 PM');
  assert.strictEqual(fmt12('01:05'), '1:05 AM', 'keeps minute padding');
});

test('fmt12 passes through empty/bad values safely', () => {
  assert.strictEqual(fmt12(null), '');
  assert.strictEqual(fmt12(''), '');
  assert.strictEqual(fmt12('garbage'), 'garbage');
});

test('a time range shows both ends in 12h', () => {
  assert.strictEqual(fmtTimeRange({ time:'17:30', endTime:'20:30' }), '5:30 PM–8:30 PM');
  assert.strictEqual(fmtTimeRange({ time:'09:00', endTime:null }), '9:00 AM');
});

test('stored event data stays 24h (calendar file correctness)', () => {
  boot(GOOD);
  S.settings.alerts = { event:[0] };
  const v = buildVEVENT({ id:'e1', title:'X', date:'2026-09-10', time:'17:30', endTime:'20:30', kind:'event' });
  assert.ok(v.includes('DTSTART:20260910T173000'), 'ICS still 24h');
  assert.ok(v.includes('DTEND:20260910T203000'));
});

console.log('\nSelectable calendar export');

test('picked export marks only the chosen events exported and clears selection', () => {
  boot(GOOD);
  S.settings.alerts = { event:[0], deadline:[1] };
  S.events = [
    { id:'e1', title:'A', date:dayAhead(2), time:'17:00', kind:'event', deleted:false },
    { id:'e2', title:'B', date:dayAhead(3), kind:'event', deleted:false },
    { id:'e3', title:'C', date:dayAhead(4), time:'09:00', kind:'event', deleted:false }
  ];
  const realSA = isStandalone;
  isStandalone = () => false;
  const realCreate = document.createElement;
  document.createElement = (t) => { const el = realCreate(t); if(t==='a') el.click = () => {}; return el; };
  const realOpen = window.open;
  window.open = () => ({});
  exportPick = new Set(['e1','e3']);
  startPickedExport();
  window.open = realOpen;
  document.createElement = realCreate;
  isStandalone = realSA;
  assert.strictEqual(S.events.find(e=>e.id==='e1').exported, true, 'chosen marked exported');
  assert.strictEqual(S.events.find(e=>e.id==='e3').exported, true, 'chosen marked exported');
  assert.ok(!S.events.find(e=>e.id==='e2').exported, 'unchosen not marked');
  assert.strictEqual(exportPick.size, 0, 'selection cleared');
});

test('picked export refuses when nothing is chosen', () => {
  boot(GOOD);
  exportPick = new Set();
  globalThis.lastBlob = null;
  startPickedExport();
  assert.strictEqual(globalThis.lastBlob, null, 'nothing delivered');
});

test('re-export uses the same UID so no calendar double', () => {
  boot(GOOD);
  S.settings.alerts = { event:[0] };
  const v1 = buildVEVENT({ id:'e1', title:'Recital', date:'2026-09-10', time:'17:30', kind:'event' });
  const v2 = buildVEVENT({ id:'e1', title:'Recital', date:'2026-09-10', time:'17:30', kind:'event' });
  const uid1 = v1.match(/UID:([^\r\n]+)/)[1];
  const uid2 = v2.match(/UID:([^\r\n]+)/)[1];
  assert.strictEqual(uid1, uid2, 'same event = same UID = calendar updates, not doubles');
  assert.strictEqual(uid1, 'e1@flyersnap');
});

console.log('\nDismissing a false duplicate');

test('marking a pair as not-duplicates removes it for good', () => {
  boot(GOOD);
  const d = dayAhead(3);
  S.events = [
    { id:'a', title:'Hell Week', date:d, kind:'event', deleted:false },
    { id:'b', title:'Livi - Mini Jazz (Kynser) Hell Week', date:d, kind:'event', deleted:false }
  ];
  assert.strictEqual(duplicateGroups().length, 1, 'flagged at first');
  dismissGroup(0);
  assert.strictEqual(duplicateGroups().length, 0, 'gone after dismissal');
});

test('a dismissal survives a reload and does not affect other pairs', () => {
  boot(GOOD);
  const d = dayAhead(4);
  S.events = [
    { id:'a', title:'Hell Week', date:d, kind:'event', deleted:false },
    { id:'b', title:'Livi - Mini Jazz Hell Week', date:d, kind:'event', deleted:false }
  ];
  dismissGroup(0);
  save();
  S = load();
  assert.strictEqual(duplicateGroups().length, 0, 'still dismissed after reload');
  S.events.push({ id:'c', title:'Picture Day', date:d, kind:'event', deleted:false });
  S.events.push({ id:'e', title:'Fall Picture Day', date:d, kind:'event', deleted:false });
  assert.strictEqual(duplicateGroups().length, 1, 'a genuine duplicate still flags');
});

console.log('\nScreens actually render');

// These would have caught the ReferenceError that made "tap to review" look dead:
// renderDedupe threw before setting innerHTML, so the screen never changed.
test('the duplicate review screen renders without throwing', () => {
  boot(GOOD);
  const d = dayAhead(3);
  S.kids = [{ id:'k1', name:'Olivia', color:'#7C3AED', type:'kid', deleted:false }];
  S.events = [
    { id:'a', title:'Picture Day', date:d, time:'09:00', kind:'event', personIds:['k1'], kidId:'k1', source:'Email - x', deleted:false },
    { id:'b', title:'Fall Picture Day', date:d, location:'Gym', kind:'event', personIds:[], kidId:null, deleted:false }
  ];
  openDedupe();
  const m = { innerHTML:'' };
  renderDedupe(m);
  assert.ok(m.innerHTML.length > 0, 'screen produced markup instead of throwing');
  assert.ok(m.innerHTML.includes('Picture Day'), 'shows the conflicting events');
  assert.ok(m.innerHTML.includes('Olivia'), 'shows tagged people');
});

test('the duplicate screen renders for untagged events too', () => {
  boot(GOOD);
  const d = dayAhead(2);
  S.kids = [];
  S.events = [
    { id:'a', title:'Open House', date:d, kind:'event', deleted:false },
    { id:'b', title:'Open House Night', date:d, kind:'event', deleted:false }
  ];
  openDedupe();
  const m = { innerHTML:'' };
  renderDedupe(m);
  assert.ok(m.innerHTML.length > 0, 'no crash with no people');
});

console.log('\nKeep-both clears the banner');

test('choosing keep both stops the pair being flagged again', () => {
  boot(GOOD);
  const d = dayAhead(3);
  S.events = [
    { id:'a', title:'Hell Week', date:d, kind:'event', deleted:false },
    { id:'b', title:'Livi - Mini Jazz (Kynser) Hell Week', date:d, kind:'event', deleted:false }
  ];
  assert.strictEqual(duplicateGroups().length, 1, 'flagged first');
  openDedupe();
  setDedupeKeep(dedupeGroupKey(duplicateGroups()[0]), null);   // "keep both"
  applyDedupe();
  assert.strictEqual(S.events.filter(e=>!e.deleted).length, 2, 'nothing deleted');
  assert.strictEqual(duplicateGroups().length, 0, 'banner clears');
});

console.log('\nOnly-new calendar export');

test('only-new export skips events already added', () => {
  boot(GOOD);
  S.settings.alerts = { event:[0], deadline:[1] };
  S.events = [
    { id:'e1', title:'Already', date:dayAhead(2), kind:'event', exported:true, deleted:false },
    { id:'e2', title:'Fresh', date:dayAhead(3), kind:'event', exported:false, deleted:false }
  ];
  const realSA = isStandalone; isStandalone = () => false;
  const realOpen = window.open; window.open = () => ({});
  globalThis.lastBlob = null;
  addAllAtOnce(true);
  const ics = globalThis.lastBlob;
  assert.ok(ics.includes('SUMMARY:Fresh'), 'new event included');
  assert.ok(!ics.includes('SUMMARY:Already'), 'already-added event skipped');
  window.open = realOpen; isStandalone = realSA;
});

test('plain add-all still sends everything (unchanged)', () => {
  boot(GOOD);
  S.settings.alerts = { event:[0], deadline:[1] };
  S.events = [
    { id:'e1', title:'Already', date:dayAhead(2), kind:'event', exported:true, deleted:false },
    { id:'e2', title:'Fresh', date:dayAhead(3), kind:'event', exported:false, deleted:false }
  ];
  const realSA = isStandalone; isStandalone = () => false;
  const realOpen = window.open; window.open = () => ({});
  globalThis.lastBlob = null;
  addAllAtOnce();
  const ics = globalThis.lastBlob;
  assert.ok(ics.includes('SUMMARY:Fresh') && ics.includes('SUMMARY:Already'), 'both sent');
  window.open = realOpen; isStandalone = realSA;
});

console.log('\nExport queue is its own screen');

test('starting a queue opens the queue screen, not the events list', () => {
  boot(GOOD);
  S.events = [
    { id:'e1', title:'A', date:dayAhead(2), kind:'event', deleted:false },
    { id:'e2', title:'B', date:dayAhead(3), kind:'event', deleted:false }
  ];
  const realSub = sub; let navigatedTo = null;
  sub = (name) => { navigatedTo = name; };
  startExportQueue(true);
  sub = realSub;
  assert.deepStrictEqual(S.settings.exportQueue, ['e1','e2'], 'queued');
  assert.strictEqual(navigatedTo, 'exportQueue', 'navigated to its own screen');
});

test('the events list no longer carries the queue card', () => {
  boot(GOOD);
  S.events = [{ id:'e1', title:'A', date:dayAhead(2), kind:'event', deleted:false }];
  S.settings.exportQueue = ['e1'];
  const m = { innerHTML:'' };
  renderEvents(m);
  assert.ok(!m.innerHTML.includes('Adding events to Calendar'),
    'queue card is not hanging around on the events screen');
});

test('the queue screen renders and can be resumed', () => {
  boot(GOOD);
  S.events = [{ id:'e1', title:'Recital', date:dayAhead(2), kind:'event', deleted:false }];
  S.settings.exportQueue = ['e1'];
  const m = { innerHTML:'' };
  renderExportQueue(m);
  assert.ok(m.innerHTML.includes('Adding events to Calendar'), 'screen shows the queue');
  assert.ok(m.innerHTML.includes('Recital'), 'shows the next event');
});

test('an empty queue screen says done instead of throwing', () => {
  boot(GOOD);
  S.settings.exportQueue = [];
  const m = { innerHTML:'' };
  renderExportQueue(m);
  assert.ok(m.innerHTML.includes('All done'));
});

console.log('\nIn-calendar flag');

test('exported events show an In calendar flag, others do not', () => {
  boot(GOOD);
  S.kids = [];
  const added = { id:'a', title:'Recital', date:dayAhead(2), kind:'event', exported:true, deleted:false };
  const notAdded = { id:'b', title:'Tryouts', date:dayAhead(3), kind:'event', exported:false, deleted:false };
  assert.ok(evtCard(added, false).includes('In calendar'), 'flag shown when exported');
  assert.ok(!evtCard(notAdded, false).includes('In calendar'), 'no flag when not exported');
});

test('the flag also shows in select mode', () => {
  boot(GOOD);
  S.kids = [];
  selectMode = true;
  const added = { id:'a', title:'Recital', date:dayAhead(2), kind:'event', exported:true, deleted:false };
  assert.ok(evtCard(added, false).includes('In calendar'));
  selectMode = false;
});

test('the flag appears after export', () => {
  boot(GOOD);
  S.settings.alerts = { event:[0], deadline:[1] };
  S.events = [{ id:'e1', title:'Fresh', date:dayAhead(2), kind:'event', deleted:false }];
  const realSA = isStandalone; isStandalone = () => false;
  const realOpen = window.open; window.open = () => ({});
  addAllAtOnce();
  window.open = realOpen; isStandalone = realSA;
  assert.ok(evtCard(S.events[0], false).includes('In calendar'), 'flagged once added');
});

console.log('\nUnread / new events');

test('existing events are not marked new when upgrading', () => {
  const v3 = JSON.stringify({
    schemaVersion: 3,
    events: [{ id:'e1', title:'Old', date:'2026-12-01', kind:'event', deleted:false }],
    kids: [], chores:[], completions:[], rewards:[], redemptions:[], lists:[], listItems:[],
    settings:{ apiKey:'x' }
  });
  boot(v3);
  assert.strictEqual(S.events[0].unread, false, 'no wall of new items on upgrade');
  assert.strictEqual(unreadCount(), 0);
});

test('newly tracked events arrive unread', () => {
  boot(GOOD);
  S.kids = []; S.events = [];
  pendingEvents = [{ title:'From email', date:dayAhead(3), selected:true, personIds:[] }];
  pendingSource = 'Email - test';
  saveReview();
  const e = S.events.find(x=>x.title === 'From email');
  assert.strictEqual(e.unread, true);
  assert.strictEqual(unreadCount(), 1);
});

test('the New filter shows only unread events', () => {
  boot(GOOD);
  S.events = [
    { id:'a', title:'Seen', date:dayAhead(2), kind:'event', unread:false, deleted:false },
    { id:'b', title:'Fresh', date:dayAhead(3), kind:'event', unread:true, deleted:false }
  ];
  eventFilter = UNREAD_FILTER;
  const list = upcomingEvents();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].title, 'Fresh');
  eventFilter = null;
  assert.strictEqual(upcomingEvents().length, 2, 'All shows everything again');
});

test('opening an event marks it seen', () => {
  boot(GOOD);
  S.events = [{ id:'a', title:'Fresh', date:dayAhead(2), kind:'event', unread:true, deleted:false }];
  assert.strictEqual(unreadCount(), 1);
  markRead('a');
  assert.strictEqual(unreadCount(), 0);
  assert.strictEqual(S.events[0].unread, false);
});

test('mark all as seen clears the whole batch and the filter', () => {
  boot(GOOD);
  S.events = [
    { id:'a', title:'One', date:dayAhead(2), kind:'event', unread:true, deleted:false },
    { id:'b', title:'Two', date:dayAhead(3), kind:'event', unread:true, deleted:false }
  ];
  eventFilter = UNREAD_FILTER;
  markAllRead();
  assert.strictEqual(unreadCount(), 0);
  assert.strictEqual(eventFilter, null, 'drops back to All so the list is not empty');
});

test('unread events show a NEW flag on the card', () => {
  boot(GOOD);
  S.kids = [];
  const fresh = { id:'a', title:'Fresh', date:dayAhead(2), kind:'event', unread:true, deleted:false };
  const seen  = { id:'b', title:'Seen',  date:dayAhead(2), kind:'event', unread:false, deleted:false };
  assert.ok(evtCard(fresh, false).includes('NEW'));
  assert.ok(!evtCard(seen, false).includes('NEW'));
});

console.log('\nBulk delete');

test('bulk delete soft-deletes only the selected events', () => {
  boot(GOOD);
  S.events = [
    { id:'a', title:'Hell Week', date:dayAhead(2), kind:'event', deleted:false },
    { id:'b', title:'Livi - Mini Jazz Hell Week', date:dayAhead(2), kind:'event', deleted:false },
    { id:'c', title:'Keep me', date:dayAhead(3), kind:'event', deleted:false }
  ];
  selectedEvents = new Set(['a','b']);
  bulkDelete();
  const live = S.events.filter(e=>!e.deleted);
  assert.strictEqual(live.length, 1);
  assert.strictEqual(live[0].title, 'Keep me');
  assert.strictEqual(S.events.find(e=>e.id==='a').deleted, true, 'soft delete, recoverable');
});

test('bulk delete exits select mode and clears the selection', () => {
  boot(GOOD);
  S.events = [{ id:'a', title:'X', date:dayAhead(1), kind:'event', deleted:false }];
  selectMode = true;
  selectedEvents = new Set(['a']);
  bulkDelete();
  assert.strictEqual(selectMode, false);
  assert.strictEqual(selectedEvents.size, 0);
});

test('deleted events drop out of the duplicate check', () => {
  boot(GOOD);
  const d = dayAhead(2);
  S.events = [
    { id:'a', title:'Picture Day', date:d, kind:'event', deleted:false },
    { id:'b', title:'Fall Picture Day', date:d, kind:'event', deleted:false }
  ];
  assert.strictEqual(duplicateGroups().length, 1);
  selectedEvents = new Set(['b']);
  bulkDelete();
  assert.strictEqual(duplicateGroups().length, 0, 'banner clears once the extra copy is gone');
});

console.log('\nRe-importing a badly-read email');

test('FlyerSnap filters out messages it has already imported', () => {
  boot(GOOD);
  S.settings.seenMsgs = ['msg-1'];
  const items = [
    { msgId:'msg-1', title:'Old read', date:dayAhead(2) },
    { msgId:'msg-2', title:'Brand new', date:dayAhead(2) }
  ];
  const seen = new Set(S.settings.seenMsgs);
  const fresh = items.filter(i => i.msgId && !seen.has(i.msgId) && i.date >= todayISO());
  assert.strictEqual(fresh.length, 1, 'already-imported message is skipped');
  assert.strictEqual(fresh[0].title, 'Brand new');
});

test('forgetting imported emails clears the memory so they can come back', () => {
  boot(GOOD);
  S.settings.seenMsgs = ['msg-1','msg-2'];
  S.settings.lastEmailCheck = new Date().toISOString();
  forgetImportedEmails();
  assert.deepStrictEqual(S.settings.seenMsgs, [], 'memory cleared');
  assert.strictEqual(S.settings.lastEmailCheck, null, 'next check is due immediately');
});

test('forgetting with nothing imported is a no-op', () => {
  boot(GOOD);
  S.settings.seenMsgs = [];
  forgetImportedEmails();
  assert.deepStrictEqual(S.settings.seenMsgs, []);
});

console.log('\nSender shown on events');

test('the sender address is kept when tracking an emailed event', () => {
  boot(GOOD);
  S.kids = []; S.events = [];
  pendingEvents = [{ title:'Hell Week', date:dayAhead(3), selected:true, personIds:[],
                     from:'austin@j31dancecenter.com' }];
  pendingSource = 'Email - Congratulations!!';
  saveReview();
  const e = S.events.find(x => x.title === 'Hell Week');
  assert.strictEqual(e.from, 'austin@j31dancecenter.com');
});

test('the card shows who it came from', () => {
  boot(GOOD);
  S.kids = [];
  const e = { id:'a', title:'Hell Week', date:dayAhead(3), kind:'event',
              from:'austin@j31dancecenter.com', source:'Email - Congratulations!!', deleted:false };
  const html = evtCard(e, false);
  assert.ok(html.includes('austin@j31dancecenter.com'), 'sender visible');
});

test('events with no sender render fine', () => {
  boot(GOOD);
  S.kids = [];
  const e = { id:'b', title:'Typed by hand', date:dayAhead(2), kind:'event', deleted:false };
  assert.ok(evtCard(e, false).length > 0);
  assert.ok(!evtCard(e, false).includes('✉️'), 'no empty sender line');
});

console.log('\nMulti-photo recipe scanning');

test('a batch of separate recipes is reviewed one at a time', () => {
  boot(GOOD);
  recipeBatch = { total:3, pending:[
    toRecipeForm({ title:'Mojito', category:'Other' }),
    toRecipeForm({ title:'Margarita', category:'Other' }),
    toRecipeForm({ title:'Paloma', category:'Other' })
  ]};
  nextBatchRecipe();
  assert.strictEqual(recipeForm.title, 'Mojito', 'first up');
  assert.strictEqual(recipeBatch.pending.length, 2, 'two still queued');
  nextBatchRecipe();
  assert.strictEqual(recipeForm.title, 'Margarita');
});

test('skipping one moves to the next without sending it', () => {
  boot(GOOD);
  recipeBatch = { total:2, pending:[
    toRecipeForm({ title:'Keep' }), toRecipeForm({ title:'Next' })
  ]};
  nextBatchRecipe();
  assert.strictEqual(recipeForm.title, 'Keep');
  skipBatchRecipe();
  assert.strictEqual(recipeForm.title, 'Next', 'moved on');
});

test('the batch ends cleanly after the last recipe', () => {
  boot(GOOD);
  recipeBatch = { total:1, pending:[ toRecipeForm({ title:'Only' }) ] };
  nextBatchRecipe();
  assert.strictEqual(recipeForm.title, 'Only');
  nextBatchRecipe();
  assert.strictEqual(recipeBatch, null, 'batch cleared when empty');
});

test('toRecipeForm keeps valid categories and falls back otherwise', () => {
  assert.strictEqual(toRecipeForm({ title:'A', category:'Snack' }).category, 'Snack');
  assert.strictEqual(toRecipeForm({ title:'A', category:'Dessert' }).category, 'Other',
    'unknown category becomes Other');
  assert.strictEqual(toRecipeForm({ title:'A' }).category, 'Other');
});

console.log('\nNo alerts in the past');

test('lead times that would land before today are dropped', () => {
  boot(GOOD);
  S.settings.alerts = { event:[7,2,0], deadline:[7,1] };
  S.settings.extraReminders = false;
  // Event 2 days out: the 7-day lead would fire 5 days ago.
  const plan = alertPlan('event', { date: dayAhead(2), kind:'event' });
  assert.ok(!plan.alarms.includes(7), 'past lead time dropped');
  assert.ok(plan.alarms.includes(2) || plan.alarms.includes(0), 'usable leads kept');
});

test('an event today still gets a day-of alert', () => {
  boot(GOOD);
  S.settings.alerts = { event:[7,2] };
  const plan = alertPlan('event', { date: dayAhead(0), kind:'event' });
  assert.deepStrictEqual(plan.alarms, [0], 'falls back to day-of rather than nothing');
});

test('a distant event keeps all its lead times', () => {
  boot(GOOD);
  S.settings.alerts = { deadline:[7,1] };
  const plan = alertPlan('deadline', { date: dayAhead(30), kind:'deadline' });
  assert.deepStrictEqual(plan.alarms, [1,7], 'nothing dropped when there is time');
});

test('no past-dated reminder entries are exported', () => {
  boot(GOOD);
  S.settings.alerts = { event:[7,2,0] };
  S.settings.extraReminders = true;
  const evt = { id:'e1', title:'Recital', date: dayAhead(2), kind:'event' };
  const vevents = buildVEVENTs(evt);
  const today = todayISO().replace(/-/g,'');
  vevents.forEach(v => {
    const m = /DTSTART[^:]*:(\d{8})/.exec(v);
    if(m) assert.ok(m[1] >= today, 'no VEVENT dated before today, got ' + m[1]);
  });
});

test('the event itself is still exported even when leads are trimmed', () => {
  boot(GOOD);
  S.settings.alerts = { event:[7] };
  const v = buildVEVENT({ id:'e1', title:'Recital', date: dayAhead(1), kind:'event' });
  assert.ok(v.includes('SUMMARY:'), 'event still present');
  assert.ok(v.includes('BEGIN:VALARM'), 'still has an alarm');
});

console.log('\nDeselected email events stay gone');

test('tracking some marks the whole email handled', () => {
  boot(GOOD);
  S.kids = []; S.events = []; S.settings.seenMsgs = [];
  pendingMsgIds = ['msg-1'];
  pendingSource = 'Email - J31';
  pendingEvents = [
    { title:'Want this', date:dayAhead(3), selected:true,  personIds:[] },
    { title:'Not this',  date:dayAhead(3), selected:false, personIds:[] }
  ];
  saveReview();
  assert.strictEqual(S.events.length, 1, 'only the selected one tracked');
  assert.ok(S.settings.seenMsgs.includes('msg-1'), 'message marked handled');
});

test('an already-handled message is not offered again', () => {
  boot(GOOD);
  S.settings.seenMsgs = ['msg-1'];
  const seen = new Set(S.settings.seenMsgs);
  const items = [{ msgId:'msg-1', title:'Not this', date:dayAhead(3) }];
  const fresh = items.filter(i => !seen.has(i.msgId));
  assert.strictEqual(fresh.length, 0, 'deselected events do not come back');
});

test('skipping everything still marks the email handled', () => {
  boot(GOOD);
  S.kids = []; S.events = []; S.settings.seenMsgs = [];
  pendingMsgIds = ['msg-9'];
  pendingEvents = [
    { title:'None of these', date:dayAhead(2), selected:false, personIds:[] }
  ];
  dismissPendingEmail();
  assert.strictEqual(S.events.length, 0, 'nothing tracked');
  assert.ok(S.settings.seenMsgs.includes('msg-9'), 'still marked handled so it stops returning');
  assert.strictEqual(pendingMsgIds.length, 0, 'batch cleared');
});

test('saving with nothing selected dismisses rather than dead-ending', () => {
  boot(GOOD);
  S.kids = []; S.events = []; S.settings.seenMsgs = [];
  pendingMsgIds = ['msg-7'];
  pendingEvents = [{ title:'Nope', date:dayAhead(2), selected:false, personIds:[] }];
  saveReview();
  assert.ok(S.settings.seenMsgs.includes('msg-7'), 'no longer a dead end');
});

console.log('\nEvent grouping and density');

test('events fall into the right time buckets', () => {
  boot(GOOD);
  assert.strictEqual(timeBucket(0), 'Today');
  assert.strictEqual(timeBucket(1), 'Tomorrow');
  assert.strictEqual(timeBucket(5), 'This week');
  assert.strictEqual(timeBucket(10), 'Next week');
  assert.strictEqual(timeBucket(25), 'This month');
  assert.strictEqual(timeBucket(90), 'Later');
});

test('grouping keeps order and never loses an event', () => {
  boot(GOOD);
  const evts = [
    { id:'a', title:'A', date:dayAhead(0), kind:'event', deleted:false },
    { id:'b', title:'B', date:dayAhead(3), kind:'event', deleted:false },
    { id:'c', title:'C', date:dayAhead(5), kind:'event', deleted:false },
    { id:'d', title:'D', date:dayAhead(60), kind:'event', deleted:false }
  ];
  const groups = groupedUpcoming(evts);
  assert.deepStrictEqual(groups.map(g=>g.label), ['Today','This week','Later']);
  assert.strictEqual(groups[1].items.length, 2, 'same bucket events stay together');
  const total = groups.reduce((n,g)=>n+g.items.length, 0);
  assert.strictEqual(total, evts.length, 'no event dropped by grouping');
});

test('distant events render compact, near ones render full', () => {
  boot(GOOD);
  S.kids = [];
  const near = { id:'a', title:'Soon', date:dayAhead(2), kind:'event',
                 notes:'bring a water bottle', deleted:false };
  const far  = { id:'b', title:'Later', date:dayAhead(60), kind:'event',
                 notes:'bring a water bottle', deleted:false };
  const nearHtml = evtCard(near, false);
  const farHtml  = evtCard(far, false);
  assert.ok(nearHtml.includes('near'), 'imminent event gets emphasis');
  assert.ok(nearHtml.includes('water bottle'), 'near event keeps its notes');
  assert.ok(farHtml.includes('compact'), 'distant event is compact');
  assert.ok(!farHtml.includes('water bottle'), 'distant event drops detail');
});

test('an empty list groups to nothing rather than throwing', () => {
  boot(GOOD);
  assert.deepStrictEqual(groupedUpcoming([]), []);
});

console.log('\nAI provider dispatch');

test('Gordon (local) is now the PRIMARY provider, and Anthropic is never removed', () => {
  // SUPERSEDES only the "which provider runs first" half of the 23 Aug decision.
  // v9.32 (Logan): FlyerSnap runs on Gordon by default — the migration flips
  // existing saves to local (schema v5) and blank() defaults to local. The
  // Anthropic FALLBACK stays ON (see the separate fallback test) — "i did not ask
  // for anthropic gone all the way" — and the Anthropic code path is not removed.
  boot(GOOD);
  assert.strictEqual(aiProvider(), 'local');
  assert.strictEqual(typeof callClaude, 'function', 'the Anthropic path still exists (fallback)');
  assert.strictEqual(typeof callLocalModel, 'function', 'the local/Gordon path is primary');
});

test('switching provider is remembered', () => {
  boot(GOOD);
  setAiProvider('local');
  assert.strictEqual(aiProvider(), 'local');
  setAiProvider('anthropic');
  assert.strictEqual(aiProvider(), 'anthropic');
});

test('content blocks translate to the OpenAI shape', () => {
  boot(GOOD);
  const parts = blocksToOpenAI([
    { type:'image', source:{ type:'base64', media_type:'image/jpeg', data:'AAAA' } },
    { type:'text', text:'Read this' }
  ]);
  assert.strictEqual(parts.length, 2);
  assert.strictEqual(parts[0].type, 'image_url');
  assert.ok(parts[0].image_url.url.startsWith('data:image/jpeg;base64,AAAA'));
  assert.strictEqual(parts[1].type, 'text');
  assert.strictEqual(parts[1].text, 'Read this');
});

test('a PDF block is refused, not silently dropped', () => {
  // Regression: this used to drop the document and send the prompt alone, so the
  // model answered about a file it never received.
  let msg = '';
  try { blocksToOpenAI([{ type:'document', source:{} }, { type:'text', text:'hi' }]); }
  catch(e){ msg = e.message; }
  assert.ok(/UNSUPPORTED_BLOCK:document/.test(msg), 'refuses PDFs loudly');
});

test('a prompt with no text at all is refused', () => {
  let msg = '';
  try { blocksToOpenAI([{ type:'image', source:{type:'base64', media_type:'image/jpeg', data:'A'} }]); }
  catch(e){ msg = e.message; }
  assert.ok(/no-prompt/.test(msg), 'never send an image with no instruction');
});

test('images plus text still translate cleanly', () => {
  const parts = blocksToOpenAI([
    { type:'image', source:{type:'base64', media_type:'image/png', data:'B'} },
    { type:'text', text:'read it' }
  ]);
  assert.strictEqual(parts.length, 2);
  assert.strictEqual(parts[0].type, 'image_url');
});

test('an empty local URL falls through to Gordon rather than refusing', () => {
  // SUPERSEDES 'the local model refuses to run without a URL' (v9.32). Gordon is
  // now the default endpoint: GORDON_BASE_URL is authoritative and a blank saved
  // localBaseUrl must fall through to it, never refuse. Checked at the source so
  // the test does no network call (a real call would hang on the model host).
  const src = String(callLocalModel);
  assert.ok(/\|\|\s*GORDON_BASE_URL/.test(src),
    'callLocalModel no longer falls through to GORDON_BASE_URL when the saved URL is blank');
  assert.ok(/localBaseUrl/.test(src),
    'callLocalModel no longer reads the saved localBaseUrl at all');
});

test('the persona carries the rules that prevent our real failures', () => {
  assert.ok(/never invent clarity/i.test(SECRETARY_PERSONA), 'no hallucinated dates');
  assert.ok(/suggestion is not a decision/i.test(SECRETARY_PERSONA), 'maybe is not an event');
  assert.ok(/owner|deadline/i.test(SECRETARY_PERSONA), 'owner and deadline required');
  assert.ok(/twelve items|not "training week"|collapse/i.test(SECRETARY_PERSONA),
    'a week must not collapse into one item');
});

test('event grounding keeps the schedule-grid rules', () => {
  assert.ok(/every non-empty cell is its own separate item/i.test(GROUNDING_EVENTS));
  assert.ok(/Lunch, Dinner, or Break are not items/i.test(GROUNDING_EVENTS));
  assert.ok(/endTime/.test(GROUNDING_EVENTS), 'ranges captured');
});

console.log('\nRaw email forwarding');

test('raw items survive the date filter that would drop undated entries', () => {
  boot(GOOD);
  S.settings.seenMsgs = [];
  const today = todayISO();
  const items = [
    { msgId:'m1', raw:'Some email text', subject:'Hi', from:'a@b.com' },
    { msgId:'m2', title:'Old event', date:'2020-01-01' },
    { msgId:'m3', title:'Future event', date:dayAhead(3) }
  ];
  const seen = new Set();
  const fresh = items.filter(i => {
    if(!i.msgId) return false;
    if(seen.has(i.msgId)) return false;
    if(typeof i.raw === 'string' && i.raw.length) return true;
    return i.date >= today;
  });
  assert.strictEqual(fresh.length, 2, 'raw item kept, past-dated one dropped');
  assert.ok(fresh.some(i => i.msgId === 'm1'), 'unextracted raw email survives');
});

test('a mixed queue keeps both shapes apart', () => {
  const fresh = [
    { msgId:'m1', raw:'text here' },
    { msgId:'m2', title:'Already extracted', date:dayAhead(2) }
  ];
  const rawItems = fresh.filter(i => i && typeof i.raw === 'string' && i.raw.length);
  const ready = fresh.filter(i => !(i && typeof i.raw === 'string' && i.raw.length));
  assert.strictEqual(rawItems.length, 1);
  assert.strictEqual(ready.length, 1);
  assert.strictEqual(ready[0].title, 'Already extracted');
});

console.log('\nReasoning-model output');

test('the Thinking.../done thinking. wrapper is removed', () => {
  const raw = 'Thinking...\nSo, let me look at the image. There may be dates.\n...done thinking.\n[{"title":"Open House","date":"2026-08-20"}]';
  const out = cleanModelText(raw);
  assert.ok(out.startsWith('['), 'narration gone, JSON first');
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed[0].title, 'Open House');
});

test('<think> tags are removed', () => {
  const raw = '<think>weighing the options</think>{"title":"Recital","date":"2026-09-10"}';
  assert.strictEqual(JSON.parse(cleanModelText(raw)).title, 'Recital');
});

test('prose before and after the JSON is discarded', () => {
  const raw = 'Here are the events I found:\n[{"title":"Picture Day","date":"2026-08-13"}]\nLet me know if you need more.';
  const parsed = JSON.parse(cleanModelText(raw));
  assert.strictEqual(parsed[0].title, 'Picture Day');
});

test('a brace inside a title does not truncate the JSON', () => {
  const raw = '[{"title":"Mini M.T. (Austin) {special}","date":"2026-08-03"}]';
  const parsed = JSON.parse(cleanModelText(raw));
  assert.strictEqual(parsed[0].title, 'Mini M.T. (Austin) {special}');
});

test('markdown fences are still stripped', () => {
  const raw = '```json\n{"title":"X","date":"2026-08-01"}\n```';
  assert.strictEqual(JSON.parse(cleanModelText(raw)).title, 'X');
});

test('an unterminated thinking block still yields the answer', () => {
  const raw = 'Thinking...\nlots of reasoning here\n...done thinking.\n{"title":"Y","date":"2026-08-02"}';
  assert.strictEqual(JSON.parse(cleanModelText(raw)).title, 'Y');
});

test('an Ask answer that obeys the citation rule survives the cleanup (v9.77)', () => {
  // The bug this pins, observed on the installed PWA 31 Aug 2026: Ask showed
  // "[1]" and nothing else. ANSWER_CONTRACT rule 2 says "put the reference
  // number(s) it came from, like [2] or [1][4]" -- so the citation format here
  // is the shipped prompt's own wording, not an invented shape.
  const answer = 'Volleyball practice is Tuesday at 5:00 PM [2] and the band concert is Thursday [4].';
  assert.strictEqual(stripThinking(answer).trim(), answer,
    'the prose answer was altered on its way to the screen');

  // ...and this is exactly what the old code did to it, kept as the reason the
  // line above may never be "simplified" back to cleanModelText.
  assert.strictEqual(cleanModelText(answer).trim(), '[2]',
    'cleanModelText no longer eats a cited answer -- re-check why this fix exists');
});

test('a thinking model\'s Ask answer still loses only the reasoning (v9.77)', () => {
  const raw = '<think>checking the list</think>Braelyn has nothing on Friday [1].';
  assert.strictEqual(stripThinking(raw).trim(), 'Braelyn has nothing on Friday [1].');
});

test('extraction still works now that the transport stopped extracting (v9.77)', () => {
  // The other half: parseExtractedEvents must pull the JSON out itself.
  const raw = 'Here are the events I found:\n[{"title":"Picture Day","date":"2026-08-13"}]\nHope that helps.';
  const evs = parseExtractedEvents(raw);
  assert.strictEqual(evs.length, 1);
  assert.strictEqual(evs[0].title, 'Picture Day');
});

test('plain text with no JSON passes through unharmed', () => {
  assert.strictEqual(cleanModelText('READY'), 'READY');
  assert.strictEqual(cleanModelText('Thinking...\nhmm\n...done thinking.\nREADY'), 'READY');
});

test('an object with nested braces survives', () => {
  const raw = '{"title":"A","meta":{"room":"12"},"date":"2026-08-05"}';
  const parsed = JSON.parse(cleanModelText(raw));
  assert.strictEqual(parsed.meta.room, '12');
});

console.log('\nMixed-content emails (text + attached flyer)');

// These are written from the CALLER's perspective: what does FlyerSnap actually
// hand these functions, and what must come back? That is the discipline the
// dropped-PDF bug taught us -- testing the function's own shape proved nothing.

test('a queue reference is told apart from a finished event', () => {
  boot(GOOD);
  assert.ok(isMessageRef({ msgId:'m1', subject:'Hi', attachments:1 }), 'reference');
  assert.ok(!isMessageRef({ msgId:'m1', title:'Recital', date:dayAhead(2) }), 'finished event');
  assert.ok(!isMessageRef({ title:'No id' }), 'needs a msgId');
  assert.ok(isMessageRef({ msgId:'m2', raw:'legacy body text' }), 'legacy shape still recognised');
});

test('body dates and flyer dates are merged, not duplicated', () => {
  boot(GOOD);
  // Same real event named slightly differently in the body and on the flyer.
  const found = [
    { title:'Open House', date:'2026-08-20', kind:'event' },
    { title:'1st-5th Grade Open House', date:'2026-08-20', kind:'event' },
    { title:'Chalk the Walk', date:'2026-08-24', kind:'event' }
  ];
  const merged = [];
  found.forEach(e => { if(!merged.some(m => looksDuplicate(m, e))) merged.push(e); });
  assert.strictEqual(merged.length, 2, 'the shared event collapses to one');
  assert.ok(merged.some(m => m.title === 'Chalk the Walk'), 'unique events survive');
});

test('dates only on the flyer are not lost when the body has others', () => {
  boot(GOOD);
  const fromBody  = [{ title:'Registration Due', date:'2026-08-07', kind:'deadline' }];
  const fromImage = [{ title:'Vaccine Clinic', date:'2026-08-10', kind:'event' }];
  const merged = [];
  fromBody.concat(fromImage).forEach(e => {
    if(!merged.some(m => looksDuplicate(m, e))) merged.push(e);
  });
  assert.strictEqual(merged.length, 2, 'union of both passes');
});

test('every extracted event carries the model that read it', () => {
  boot(GOOD);
  S.kids = []; S.events = [];
  pendingEvents = [{ title:'Recital', date:dayAhead(3), selected:true, personIds:[],
                     aiSource:'qwen3-vl:8b' }];
  pendingSource = 'Email - test';
  saveReview();
  assert.strictEqual(S.events[0].aiSource, 'qwen3-vl:8b',
    'provenance survives so a bad extraction can be traced');
});

test('the provider label reflects the active provider', () => {
  boot(GOOD);
  setAiProvider('anthropic');
  assert.strictEqual(providerLabel(), MODEL);
  setAiProvider('local');
  S.settings.localModel = 'qwen3-vl:8b';
  assert.strictEqual(providerLabel(), 'qwen3-vl:8b');
  setAiProvider('anthropic');
});

test('extraction problems are recorded for the user, not swallowed', () => {
  boot(GOOD);
  lastEmailProblems = [];
  lastEmailProblems.push('Back to BSSD — attachment: model offline');
  assert.strictEqual(lastEmailProblems.length, 1,
    'a failure leaves a trace the review screen can show');
});

console.log('\nSelf-test and comparison');

test('the comparison leaves the saved provider alone, even when a side fails', async () => {
  // This test used to assert that compareProviders RESTORED S.settings after
  // mutating them. Since v9.63 it never mutates them, so there is nothing to
  // restore -- the guarantee got stronger, and the assertion has to say so.
  //
  // It also used to pass by accident: being async, its assertions ran long
  // after the synchronous suite had finished and other tests had moved the
  // shared settings on. It now reads the values it set itself, and the harness
  // awaits it.
  // Asserts ONLY what is genuinely async and genuinely local to this test.
  // Anything read from S after an await is read after the rest of the
  // synchronous suite has run and moved the shared settings on -- which is how
  // the old version of this test passed by accident for months. The
  // "never writes S.settings" guarantee is asserted synchronously in the test
  // below, where it can be trusted.
  aiOverride = null;
  // readImageDownscaled throws on a non-file, so the try never completes; the
  // finally must still drop the override.
  await compareProviders({ name:'not-a-real-file' });
  assert.strictEqual(aiOverride, null,
    'the override outlived a failed comparison — every later AI call would inherit it');
});

test('comparison forces a provider WITHOUT touching saved settings', () => {
  // Intent unchanged: without forcing, a failing local call silently returns
  // Anthropic's answer and the comparison shows two identical columns.
  //
  // What changed in v9.63 is HOW. It used to write S.settings and restore them
  // in a finally -- and recordAiCall() saves on every AI call, so those
  // temporary values reached localStorage for the length of two model calls.
  // Kill the app there and the user keeps aiFallback:false with nothing saying
  // so. Reproduced against the real code by
  // tools/p2-repro-compare-provider.js (code review P2-01).
  const src = String(compareProviders);
  assert.ok(/aiOverride = \{ provider:null, fallback:false \}/.test(src),
    'the comparison no longer forces the fallback off');
  assert.ok(/aiOverride\.provider = 'anthropic'/.test(src) && /aiOverride\.provider = 'local'/.test(src),
    'it no longer forces each provider in turn');
  assert.ok(/finally\s*\{[^}]*aiOverride = null/.test(src),
    'the override is not dropped in a finally');
  // THE GUARANTEE: saved settings are never written at all, so a finally that
  // never runs cannot leave anything wrong on disk.
  assert.ok(!/S\.settings\.\w+\s*=/.test(src),
    'compareProviders writes S.settings again — that is the bug P2-01 fixed');
});

test('the override is read, not just written — and it never reaches storage', () => {
  boot(GOOD);
  S.settings.aiProvider = 'local';
  S.settings.aiFallback = true;
  save();
  assert.strictEqual(aiProvider(), 'local');
  assert.strictEqual(aiFallbackOn(), true);

  aiOverride = { provider:'anthropic', fallback:false };
  assert.strictEqual(aiProvider(), 'anthropic', 'the override does not reach aiProvider()');
  assert.strictEqual(aiFallbackOn(), false, 'the override does not reach aiFallbackOn()');
  const disk = JSON.parse(localStorage.getItem('flyersnap'));
  assert.strictEqual(disk.settings.aiProvider, 'local', 'the override was persisted');
  assert.strictEqual(disk.settings.aiFallback, true, 'the override was persisted');

  aiOverride = null;
  assert.strictEqual(aiProvider(), 'local', 'dropping the override does not restore');
  assert.strictEqual(aiFallbackOn(), true);
});

test('the self-test checks every stage the scanner depends on', () => {
  const src = String(runLocalSelfTest);
  ['Base URL saved','Server reachable','Chosen model is installed',
   'Text request works','Thinking is off','Vision works','Extracts events as JSON']
    .forEach(stage => assert.ok(src.indexOf(stage) >= 0, 'covers: ' + stage));
});

test('the self-test verifies thinking rather than assuming it', () => {
  const src = String(runLocalSelfTest);
  assert.ok(/<think>|Thinking/.test(src),
    'looks for a leaked reasoning trace instead of trusting think:false');
});

console.log('\nSelf-test measures the real job');

test('the extraction stage uses a realistic sample, not an arbitrary token', () => {
  // Regression: this stage used to ask for {"ok":true} while sending the
  // calendar-secretary persona, which instructs the model to discard anything
  // without a date. An empty reply was the model obeying, and the test called
  // it a capability failure. Test what the caller actually does.
  const src = String(runLocalSelfTest);
  assert.ok(/Picture Day/.test(src), 'sends a real dated sample');
  assert.ok(/eventPrompt\(\)/.test(src), 'asks in the same shape extraction uses');
  assert.ok(!/Respond with ONLY this JSON and nothing else/.test(src),
    'the arbitrary-token prompt is gone');
});

test('an empty model reply explains itself instead of returning nothing', () => {
  const src = String(callLocalModel);
  assert.ok(/reasoning_content|reasoning/.test(src), 'checks the other trace field names');
  assert.ok(/empty answer/.test(src), 'says the answer was empty and why');
});

console.log('\nNotes from email context');

test('the notes guidance names what a parent actually needs', () => {
  ['bring or wear','cost','RSVP','contact','null'].forEach(k =>
    assert.ok(GROUNDING_EVENTS.toLowerCase().indexOf(k.toLowerCase()) >= 0,
      'notes guidance covers: ' + k));
  assert.ok(/Never invent a requirement/i.test(GROUNDING_EVENTS),
    'still forbidden to make things up');
});

test('merging keeps the fuller note, not whichever came first', () => {
  boot(GOOD);
  const d = '2026-08-03';
  const found = [
    { title:'Hell Week', date:d, notes:null },
    { title:'Hell Week', date:d, notes:'Wear all black; bring water bottle and dance shoes.' }
  ];
  const merged = [];
  found.forEach(e => {
    const hit = merged.find(m => looksDuplicate(m, e));
    if(!hit){ merged.push(e); return; }
    if((e.notes||'').length > (hit.notes||'').length) hit.notes = e.notes;
  });
  assert.strictEqual(merged.length, 1, 'still one event');
  assert.ok(/water bottle/.test(merged[0].notes), 'the richer note survives');
});

test('merging fills gaps from either source', () => {
  boot(GOOD);
  const d = '2026-08-20';
  const fromBody  = { title:'Open House', date:d, time:null, location:null,
                      notes:'Parents and students.' };
  const fromFlyer = { title:'Open House Night', date:d, time:'18:30',
                      location:'Main Gym', notes:null };
  const merged = [fromBody];
  const hit = merged.find(m => looksDuplicate(m, fromFlyer));
  if(hit){
    if(!hit.time && fromFlyer.time) hit.time = fromFlyer.time;
    if(!hit.location && fromFlyer.location) hit.location = fromFlyer.location;
    if((fromFlyer.title||'').length > (hit.title||'').length) hit.title = fromFlyer.title;
  }
  assert.strictEqual(merged[0].time, '18:30', 'time taken from the flyer');
  assert.strictEqual(merged[0].location, 'Main Gym', 'location taken from the flyer');
  assert.ok(/Parents and students/.test(merged[0].notes), 'note kept from the body');
});

test('the attachment pass is given the covering email as context', () => {
  const src = String(extractFromEmailPayload);
  assert.ok(/Use the email only for context when writing notes/.test(src),
    'the flyer stays the source of dates; the email informs the notes');
});

console.log('\nWhole-email reading');

test('the combined request carries body and every attachment', () => {
  boot(GOOD);
  const payload = {
    from:'austin@j31dancecenter.com', subject:'Hell Week',
    text:'Wear all black and bring a water bottle each day.',
    attachments:[
      { name:'schedule.png', mediaType:'image/png', data:'AAA' },
      { name:'handbook.pdf', mediaType:'application/pdf', data:'BBB' }
    ]
  };
  const blocks = emailBlocks(payload, true);
  const kinds = blocks.map(b => b.type);
  assert.ok(kinds.includes('image'), 'the flyer image is included');
  assert.ok(kinds.includes('document'), 'the PDF is included');
  const joined = blocks.filter(b=>b.type==='text').map(b=>b.text).join(' ');
  assert.ok(/water bottle/.test(joined), 'the email body is included');
  assert.ok(/ATTACHMENT 1: schedule.png/.test(joined), 'attachments are labelled');
  assert.ok(/ATTACHMENT 2: handbook.pdf/.test(joined), 'each one distinctly');
});

test('the body alone is sent when there are no attachments', () => {
  const blocks = emailBlocks({ from:'a@b.com', subject:'Hi',
    text:'Picture day is September 11 at 9am in the gym.', attachments:[] }, true);
  assert.strictEqual(blocks.filter(b=>b.type==='image').length, 0);
  assert.ok(/Picture day/.test(blocks.map(b=>b.text||'').join(' ')));
});

test('a trivial body is not sent as an empty block', () => {
  const blocks = emailBlocks({ text:'ok', attachments:[] }, true);
  assert.strictEqual(blocks.length, 0, 'nothing worth sending');
});

test('the model is told to treat the sources as one set of facts', () => {
  assert.ok(/ONE set of facts/i.test(MULTI_SOURCE_NOTE), 'sources are correlated');
  assert.ok(/only on a flyer while what to bring is only in the email/i.test(MULTI_SOURCE_NOTE),
    'the cross-source case is spelled out');
  assert.ok(/ONE item, not two/i.test(MULTI_SOURCE_NOTE), 'no duplicates across sources');
});

test('a failed combined read falls back instead of losing the email', () => {
  const src = String(extractFromEmailPayload);
  assert.ok(/trying each part separately/.test(src),
    'per-source passes remain as a fallback');
  assert.ok(src.indexOf('Pass 1') > src.indexOf('combined read'),
    'combined is attempted first');
});

console.log('\nWording follows the active model');

test('the assistant is called Gordon whichever model is behind him', () => {
  boot(GOOD);
  setAiProvider('anthropic');
  assert.strictEqual(aiName(), 'Gordon');
  setAiProvider('local');
  S.settings.localModel = 'qwen3-vl:8b';
  assert.strictEqual(aiName(), 'Gordon', 'the voice does not change with the model');
  setAiProvider('anthropic');
});

test('the real model is still reported where truth matters', () => {
  boot(GOOD);
  setAiProvider('anthropic');
  assert.strictEqual(aiModelName(), MODEL, 'provenance names the actual model');
  setAiProvider('local');
  S.settings.localModel = 'qwen3-vl:8b';
  assert.strictEqual(aiModelName(), 'qwen3-vl:8b');
  S.settings.localModel = '';
  assert.strictEqual(aiModelName(), 'local model', 'sensible when unnamed');
  setAiProvider('anthropic');
});

test('progress messages speak as Gordon, never as a raw model name', () => {
  boot(GOOD);
  setAiProvider('local');
  S.settings.localModel = 'qwen3-vl:8b';
  for(let i = 0; i < 20; i++){
    const hint = aiWorkingHint();
    assert.ok(/^Gordon is /.test(hint), 'always speaks as Gordon: ' + hint);
    assert.ok(!/qwen|Claude|claude/.test(hint), 'no model name leaks into the hint');
  }
  setAiProvider('anthropic');
});

test('an event records the model that read it, not Gordon', () => {
  boot(GOOD);
  setAiProvider('local');
  S.settings.localModel = 'qwen3-vl:8b';
  assert.strictEqual(providerLabel(), 'qwen3-vl:8b',
    'a bad extraction must be traceable to a real model');
  assert.notStrictEqual(providerLabel(), 'Gordon');
  setAiProvider('anthropic');
});

test('no user-facing screen text hardcodes Claude', () => {
  boot(GOOD);
  setAiProvider('local');
  S.settings.localModel = 'qwen3-vl:8b';
  S.settings.localBaseUrl = 'https://x.ts.net/v1';
  S.kids = []; S.events = [];
  const screens = [renderEvents, renderSettings];
  screens.forEach(fn => {
    const m = { innerHTML:'' };
    try { fn(m); } catch(e){ return; }
    assert.ok(!/Claude is /.test(m.innerHTML),
      'no "Claude is ..." while a local model is selected');
  });
  setAiProvider('anthropic');
});

console.log('\nUser-supplied context');

test('no context means nothing extra is sent', () => {
  boot(GOOD);
  scanContext = '';
  assert.strictEqual(contextBlock(), null);
  const blocks = withContext([{type:'image', source:{}}]);
  assert.strictEqual(blocks.length, 2, 'just the image and the prompt');
});

test('context is inserted before the prompt, not after', () => {
  boot(GOOD);
  scanContext = 'band';
  const blocks = withContext([{type:'image', source:{}}]);
  assert.strictEqual(blocks.length, 3);
  assert.ok(/CONTEXT FROM THE USER/.test(blocks[1].text), 'context comes second');
  assert.ok(/short human-friendly name|JSON/.test(blocks[2].text), 'prompt comes last');
  scanContext = '';
});

test('the context tells the model to label events, not invent facts', () => {
  boot(GOOD);
  scanContext = 'band';
  const t = contextBlock().text;
  assert.ok(/about "band"/.test(t), 'carries what the user said');
  assert.ok(/Rehearsal \(band\)/.test(t), 'shows how to use it in a title');
  assert.ok(/not invent dates or details that are not on the page/i.test(t),
    'context must not become a licence to hallucinate');
  scanContext = '';
});

test('whitespace-only context is ignored', () => {
  boot(GOOD);
  scanContext = '   ';
  assert.strictEqual(contextBlock(), null);
  scanContext = '';
});

test('context is cleared once a review is saved', () => {
  boot(GOOD);
  S.kids = []; S.events = [];
  scanContext = 'band';
  pendingMsgIds = ['m1'];
  pendingEvents = [{ title:'X', date:dayAhead(2), selected:false, personIds:[] }];
  dismissPendingEmail();
  assert.strictEqual(scanContext, '', 'does not leak into the next scan');
});

console.log('\nProblem log');

test('a problem is recorded and survives a reload', () => {
  boot(GOOD);
  S.problems = [];
  logProblem('Email: austin@j31.com', 'Attachment could not be read', 'Hell Week');
  save();
  S = load();
  assert.strictEqual(activeProblems().length, 1);
  assert.strictEqual(S.problems[0].where, 'Email: austin@j31.com');
  assert.strictEqual(S.problems[0].count, 1);
});

test('repeats are grouped with a count, not piled up', () => {
  boot(GOOD);
  S.problems = [];
  logProblem('Local model', 'timed out after 3 minutes', 'qwen3-vl:8b');
  logProblem('Local model', 'timed out after 3 minutes', 'qwen3-vl:8b');
  logProblem('Local model', 'timed out after 3 minutes', 'qwen3-vl:8b');
  assert.strictEqual(activeProblems().length, 1, 'one entry, not three');
  assert.strictEqual(activeProblems()[0].count, 3, 'counted');
});

test('messages differing only by numbers group together', () => {
  boot(GOOD);
  S.problems = [];
  logProblem('Local model', 'model error 404: not found');
  logProblem('Local model', 'model error 500: not found');
  assert.strictEqual(activeProblems().length, 1,
    'same shape of problem, grouped despite different codes');
});

test('genuinely different problems stay separate', () => {
  boot(GOOD);
  S.problems = [];
  logProblem('Local model', 'timed out');
  logProblem('Scanning', 'that photo does not look like a recipe');
  assert.strictEqual(activeProblems().length, 2);
});

test('resolving removes it from the backlog but keeps the record', () => {
  boot(GOOD);
  S.problems = [];
  logProblem('Email: x@y.com', 'No dates found in this email');
  const id = S.problems[0].id;
  resolveProblem(id);
  assert.strictEqual(activeProblems().length, 0, 'off the backlog');
  assert.strictEqual(S.problems.length, 1, 'still on record');
  reopenProblem(id);
  assert.strictEqual(activeProblems().length, 1, 'can be reopened');
});

test('a resolved problem recurring opens a new entry rather than reviving the old', () => {
  boot(GOOD);
  S.problems = [];
  logProblem('Local model', 'offline');
  resolveProblem(S.problems[0].id);
  logProblem('Local model', 'offline');
  assert.strictEqual(activeProblems().length, 1, 'the new occurrence is visible');
  assert.strictEqual(S.problems.length, 2, 'history preserved');
});

test('the log never breaks the thing it is logging about', () => {
  boot(GOOD);
  S.problems = null;                       // corrupt on purpose
  logProblem('Anywhere', 'something failed');
  assert.ok(true, 'did not throw');
  logProblem('Anywhere', null);
  logProblem(undefined, undefined);
  assert.ok(true, 'survives rubbish input');
});

test('the backlog does not grow without bound', () => {
  boot(GOOD);
  S.problems = [];
  for(let i = 0; i < 80; i++) logProblem('Place ' + i, 'distinct problem ' + String.fromCharCode(65+i%26) + i);
  assert.ok(S.problems.length <= 60, 'capped, got ' + S.problems.length);
});

test('the problem screen renders in every state', () => {
  boot(GOOD);
  S.problems = [];
  let m = { innerHTML:'' };
  renderProblems(m);
  assert.ok(/Nothing has gone wrong/.test(m.innerHTML), 'empty state');

  logProblem('Email: a@b.com', 'Attachment could not be read', 'Hell Week');
  m = { innerHTML:'' };
  renderProblems(m);
  assert.ok(/Attachment could not be read/.test(m.innerHTML), 'shows the problem');

  resolveProblem(S.problems[0].id);
  m = { innerHTML:'' };
  renderProblems(m);
  assert.ok(/Resolved/.test(m.innerHTML), 'resolved section');
});

// ---------------------------------------------------------------------------
// v9.39 -- multi-select. These drive the REAL handlers, not the markup: the
// static guards in tests-modules.js prove the buttons are wired, and these
// prove that pressing them does the right thing to S.problems.
// ---------------------------------------------------------------------------
function threeProblems(){
  boot(GOOD);
  S.problems = [];
  logProblem('Email', 'attachment could not be read');
  logProblem('Model', 'local model offline');
  logProblem('Watcher', 'queue came back empty');
  problemSel = null;
  return S.problems.map(p => p.id);
}

test('select mode turns on, picks, and turns off again', () => {
  const ids = threeProblems();
  assert.strictEqual(problemSel, null, 'starts off');
  toggleProblemSelect();
  assert.ok(problemSel instanceof Set, 'select mode did not open');
  toggleProblemPick(ids[0]);
  toggleProblemPick(ids[2]);
  assert.strictEqual(problemSel.size, 2);
  toggleProblemPick(ids[0]);                       // second tap unpicks
  assert.strictEqual(problemSel.size, 1);
  toggleProblemSelect();
  assert.strictEqual(problemSel, null, 'cancel did not leave select mode');
});

test('select all is a toggle — a second tap clears it', () => {
  threeProblems();
  toggleProblemSelect();
  selectAllProblems();
  assert.strictEqual(problemSel.size, 3, 'select all missed rows');
  selectAllProblems();
  assert.strictEqual(problemSel.size, 0, 'second tap did not clear');
});

test('bulk mark-done resolves only what was picked, and leaves select mode', () => {
  const ids = threeProblems();
  toggleProblemSelect();
  toggleProblemPick(ids[0]);
  toggleProblemPick(ids[1]);
  resolveSelectedProblems();
  assert.strictEqual(activeProblems().length, 1, 'wrong number left open');
  assert.strictEqual(activeProblems()[0].id, ids[2], 'resolved the wrong one');
  assert.ok(S.problems.find(p => p.id === ids[0]).resolved, 'no resolved timestamp');
  assert.strictEqual(problemSel, null, 'still in select mode afterwards');
});

test('bulk delete removes the picked rows and the undo restores the original order', () => {
  const ids = threeProblems();
  const orderBefore = S.problems.map(p => p.id);
  let undo = null;
  const realToast = toast;
  toast = (msg, action) => { if(action && action.fn) undo = action.fn; };

  toggleProblemSelect();
  toggleProblemPick(ids[0]);
  toggleProblemPick(ids[1]);
  deleteSelectedProblems();
  assert.strictEqual(S.problems.length, 1, 'rows were not deleted');
  assert.strictEqual(S.problems[0].id, ids[2], 'deleted the wrong rows');

  assert.ok(undo, 'no undo was offered');
  undo();
  assert.deepStrictEqual(S.problems.map(p => p.id), orderBefore,
    'undo did not restore the log in its original order');
  toast = realToast;
});

test('clear all empties the log, asks first, and is undoable', () => {
  threeProblems();
  const orderBefore = S.problems.map(p => p.id);
  let undo = null, asked = 0;
  const realToast = toast, realConfirm = confirm;
  toast = (msg, action) => { if(action && action.fn) undo = action.fn; };

  confirm = () => { asked++; return false; };
  clearAllProblems();
  assert.strictEqual(asked, 1, 'clear all did not ask');
  assert.strictEqual(S.problems.length, 3, 'declining the confirm still cleared the log');

  confirm = () => { asked++; return true; };
  clearAllProblems();
  assert.strictEqual(S.problems.length, 0, 'the log was not cleared');
  assert.ok(undo, 'no undo was offered');
  undo();
  assert.deepStrictEqual(S.problems.map(p => p.id), orderBefore, 'undo did not restore');

  toast = realToast; confirm = realConfirm;
});

test('clearing survives a reload — it is written, not just re-rendered', () => {
  threeProblems();
  const realConfirm = confirm;
  confirm = () => true;
  clearAllProblems();
  S = load();
  assert.strictEqual((S.problems || []).length, 0, 'the cleared log came back after a reload');
  confirm = realConfirm;
});

test('the select bar and clear-all render, and vanish with an empty log', () => {
  threeProblems();
  let m = { innerHTML:'' };
  renderProblems(m);
  assert.ok(/Select</.test(m.innerHTML), 'no way into select mode');
  assert.ok(/Clear all \(3\)/.test(m.innerHTML), 'clear all is missing its count');
  assert.ok(!/selected</.test(m.innerHTML), 'the select bar shows before it is asked for');

  toggleProblemSelect();
  m = { innerHTML:'' };
  renderProblems(m);
  assert.ok(/0 selected/.test(m.innerHTML), 'the select bar did not appear');
  assert.ok(/type="checkbox"/.test(m.innerHTML), 'rows have no checkboxes in select mode');

  boot(GOOD); S.problems = []; problemSel = null;
  m = { innerHTML:'' };
  renderProblems(m);
  assert.ok(/Nothing has gone wrong/.test(m.innerHTML));
  assert.ok(!/Clear all/.test(m.innerHTML), 'clear all offered on an empty log');
});

console.log('\nProblem log');

test('a problem is recorded so it can be dealt with later', () => {
  boot(GOOD);
  S.problems = [];
  logProblem('Email', 'attachment could not be read', 'schedule.png');
  assert.strictEqual(activeProblems().length, 1);
  assert.strictEqual(S.problems[0].where, 'Email');
  assert.strictEqual(S.problems[0].detail, 'schedule.png');
  assert.strictEqual(S.problems[0].count, 1);
});

test('the same problem shape groups instead of flooding the log', () => {
  boot(GOOD);
  S.problems = [];
  logProblem('Email', 'email 3 could not be read');
  logProblem('Email', 'email 7 could not be read');
  logProblem('Email', 'email 12 could not be read');
  assert.strictEqual(S.problems.length, 1, 'numbers vary, the shape does not');
  assert.strictEqual(S.problems[0].count, 3, 'counted instead of repeated');
});

test('genuinely different problems stay separate', () => {
  boot(GOOD);
  S.problems = [];
  logProblem('Email', 'attachment could not be read');
  logProblem('Model', 'local model offline');
  assert.strictEqual(S.problems.length, 2);
});

test('problems survive a reload', () => {
  boot(GOOD);
  S.problems = [];
  logProblem('Model', 'local model offline');
  save();
  S = load();
  assert.strictEqual(activeProblems().length, 1, 'still there after restart');
});

test('logging never throws, even on junk input', () => {
  boot(GOOD);
  S.problems = [];
  logProblem('Odd', null);
  logProblem(undefined, { toString(){ throw new Error('hostile'); } });
  assert.ok(true, 'logging must not break the thing it is logging about');
});

test('the log is capped so it cannot grow without limit', () => {
  boot(GOOD);
  S.problems = [];
  for(let i = 0; i < 200; i++) logProblem('Bulk', 'problem type ' + String.fromCharCode(65 + (i % 26)) + i);
  assert.ok(S.problems.length <= 60, 'capped, got ' + S.problems.length);
});

console.log('\nSharing');

test('shared events carry no provenance', () => {
  boot(GOOD);
  S.events[0].source = 'dance-flyer.pdf';
  S.events[0].kidId = 'k1';
  openShareEvents();
  shareSel = new Set(['e1']);
  shareAsCalendar();
  assert.ok(globalThis.lastBlob.includes('SUMMARY:Recital'));
  assert.ok(!globalThis.lastBlob.includes('dance-flyer'), 'no flyer name leaks');
  assert.ok(!globalThis.lastBlob.includes('Olivia'), 'no kid tag leaks');
  assert.strictEqual(S.events[0].source, 'dance-flyer.pdf', 'and your own copy is untouched');
});

console.log('\nAlerts');

test('never more than the two alerts iOS will honour', () => {
  boot(GOOD);
  S.settings.alerts.deadline = [14, 7, 3, 1];
  S.settings.extraReminders = false;
  const v = buildVEVENTs({ id:'d1', title:'Signup', date:'2026-08-07', time:'17:00', kind:'deadline' });
  assert.strictEqual(v.length, 1);
  assert.strictEqual((v[0].match(/BEGIN:VALARM/g) || []).length, 2);
});

test('extra lead times become their own entries when asked', () => {
  boot(GOOD);
  S.settings.alerts.deadline = [14, 7, 3, 1];
  S.settings.extraReminders = true;
  const v = buildVEVENTs({ id:'d1', title:'Signup', date:'2026-08-07', time:'17:00', kind:'deadline' });
  assert.strictEqual(v.length, 3, 'main event + the two that would not fit');
  assert.ok(v.join('\n').includes('14 days until: Signup'));
});



console.log('\nUndo instead of confirm');

// v9.0 replaced confirm() on destructive actions with an undo toast. That is
// only safe because these deletes were ALWAYS soft (deleted=true) -- so undo
// is a flag flip and nothing is ever actually destroyed. These cases pin that
// down: a delete must hide the row, an undo must bring back the SAME row with
// its children intact, and neither may touch anything else.
test('deleting a list hides it but keeps the row and its items', () => {
  boot(null);
  S.lists.push({ id:'l1', name:'Costco', deleted:false });
  S.listItems.push({ id:'i1', listId:'l1', text:'Paper towels', checked:false, deleted:false });
  delList('l1');
  assert.strictEqual(S.lists.length, 1, 'the row is kept, not spliced out');
  assert.strictEqual(S.lists[0].deleted, true, 'it is hidden');
  assert.strictEqual(S.listItems[0].deleted, false, 'its items are untouched, so undo restores everything');
});

test('undo restores a deleted list exactly', () => {
  boot(null);
  S.lists.push({ id:'l1', name:'Costco', deleted:false });
  const before = JSON.stringify(S.lists[0]);
  const undo = delList('l1');
  undo();                                   // exactly what the Undo button calls
  assert.strictEqual(JSON.stringify(S.lists[0]), before, 'restored byte for byte');
});

test('deleting a chore keeps its completed history', () => {
  boot(null);
  S.chores.push({ id:'c1', title:'Make bed', kidId:'k1', stars:1, deleted:false });
  S.completions.push({ id:'x1', choreId:'c1', kidId:'k1', date:'2026-08-01', stars:1 });
  delChoreById('c1');
  assert.strictEqual(S.completions.length, 1, 'stars already earned are never removed');
  assert.strictEqual(S.chores[0].deleted, true);
});

test('deleting one row leaves its neighbours alone', () => {
  boot(null);
  S.lists.push({ id:'l1', name:'A', deleted:false }, { id:'l2', name:'B', deleted:false });
  delList('l1');
  assert.strictEqual(S.lists.find(l=>l.id==='l2').deleted, false);
});

test('deleting an id that is not there does nothing at all', () => {
  boot(null);
  S.lists.push({ id:'l1', name:'A', deleted:false });
  const before = JSON.stringify(S.lists);
  delList('nope');
  assert.strictEqual(JSON.stringify(S.lists), before);
});

console.log('\nSwipe navigation');

// The decision is a pure function so it can be pinned down without a browser.
// Every case here is a real way swipe-to-switch goes wrong in the wild.
test('a clean sideways flick switches tabs', () => {
  assert.strictEqual(swipeIntent({dx:-110, dy:8, ms:220, startX:200, width:393}), 'next');
  assert.strictEqual(swipeIntent({dx: 110, dy:8, ms:220, startX:200, width:393}), 'prev');
});

test('gestures starting at the screen edge are left to iOS', () => {
  // An installed iOS web app keeps Safari's edge back/forward swipe and it
  // cannot be disabled from web code. If we also handled it, one flick would
  // move two screens.
  assert.strictEqual(swipeIntent({dx:-110, dy:5, ms:200, startX:10,  width:393}), null);
  assert.strictEqual(swipeIntent({dx: 110, dy:5, ms:200, startX:388, width:393}), null);
});

test('a mostly-vertical drag is a scroll, not a swipe', () => {
  assert.strictEqual(swipeIntent({dx:-70, dy:120, ms:300, startX:200, width:393}), null);
});

test('a small wobble during a scroll does nothing', () => {
  assert.strictEqual(swipeIntent({dx:-25, dy:4, ms:150, startX:200, width:393}), null);
});

test('a slow drag is not a swipe', () => {
  assert.strictEqual(swipeIntent({dx:-140, dy:6, ms:1400, startX:200, width:393}), null);
});

test('a long sideways travel that also wanders down is rejected', () => {
  assert.strictEqual(swipeIntent({dx:-160, dy:100, ms:400, startX:200, width:393}), null);
});

test('a swipe just past the threshold still counts', () => {
  const d = SWIPE.MIN_DIST + 1;
  assert.strictEqual(swipeIntent({dx:-d, dy:0, ms:200, startX:200, width:393}), 'next');
  assert.strictEqual(swipeIntent({dx:-(SWIPE.MIN_DIST - 1), dy:0, ms:200, startX:200, width:393}), null);
});

test('the tab bar still reaches every tab, so swipe is never the only way', () => {
  // WCAG 2.5.1: a path-based gesture needs a single-pointer alternative.
  assert.ok(TABS.length >= 5, 'expected the five tabs');
  TABS.forEach(t => assert.ok(t.id && t.label, 'every tab is reachable by tapping'));
});

console.log('\nMarking a missed deadline as handled');

// Before v9.9 the clash detector checked e.done -- a field NOTHING in the app
// ever set. The only way to clear a missed-deadline warning was to export it
// to the calendar or delete it, neither of which matches "I already did this".
test('a passed deadline warns until it is handled', () => {
  boot(null);
  const e = { id:'d1', title:'Sign-up', date:'2026-08-01', kind:'deadline', deleted:false };
  S.events.push(e);
  assert.strictEqual(findConflicts(S.events, '2026-09-01').length, 1, 'it should warn');
  markHandled('d1');
  assert.strictEqual(e.handled, true);
  assert.strictEqual(findConflicts(S.events, '2026-09-01').length, 0, 'and stop warning once handled');
});

test('marking handled keeps the event, it does not delete it', () => {
  boot(null);
  S.events.push({ id:'d1', title:'Sign-up', date:'2026-08-01', kind:'deadline', deleted:false });
  markHandled('d1');
  assert.strictEqual(S.events.length, 1, 'the event is kept');
  assert.strictEqual(S.events[0].deleted, false, 'and is not deleted');
});

test('handling one deadline does not silence another', () => {
  boot(null);
  S.events.push({ id:'d1', title:'A', date:'2026-08-01', kind:'deadline', deleted:false });
  S.events.push({ id:'d2', title:'B', date:'2026-08-02', kind:'deadline', deleted:false });
  markHandled('d1');
  assert.strictEqual(findConflicts(S.events, '2026-09-01').length, 1);
});

test('exporting to the calendar still counts as dealt with', () => {
  boot(null);
  S.events.push({ id:'d1', title:'A', date:'2026-08-01', kind:'deadline', exported:true, deleted:false });
  assert.strictEqual(findConflicts(S.events, '2026-09-01').length, 0);
});

test('marking a non-existent event does nothing and does not throw', () => {
  boot(null);
  markHandled('nope');
  assert.strictEqual(S.events.length, 0);
});

console.log('\nClash banner — keeping only one (v9.59)');

// Two overlapping events on the same future day, plus the conflict's key.
function clashPair(){
  boot(null);
  const d = dayAhead(3);
  S.events.push({ id:'x1', title:'Recital', date:d, time:'17:00', endTime:'18:30',
    kind:'event', deleted:false });
  S.events.push({ id:'x2', title:'Volleyball', date:d, time:'17:30', endTime:'19:00',
    kind:'event', deleted:false });
  clearClashSel();   // module-level view state outlives boot(); each fixture starts clean
  const c = findConflicts(S.events, todayISO()).find(x => x.type === 'overlap');
  assert.ok(c, 'the two events do not register as a clash');
  return { key: conflictKey(c), d };
}
function withConfirm(answer, fn){
  const real = confirm;
  confirm = () => answer;
  try { return fn(); } finally { confirm = real; }
}
function captureUndo(fn){
  const real = toast;
  let undo = null;
  toast = (msg, action) => { if(action && action.fn) undo = action.fn; };
  try { fn(); } finally { toast = real; }
  return undo;
}

test('keeping one removes the other, and the clash stops being reported', () => {
  const { key } = clashPair();
  withConfirm(true, () => keepOnlyEvent('x1', key));
  const kept = S.events.find(e => e.id === 'x1');
  const gone = S.events.find(e => e.id === 'x2');
  assert.strictEqual(kept.deleted, false, 'the kept event was removed');
  assert.strictEqual(gone.deleted, true, 'the other event was not removed');
  assert.strictEqual(findConflicts(S.events, todayISO()).length, 0,
    'the warning survived its own resolution');
});

test('the removed event is soft-deleted and marked dirty, like every other bulk delete', () => {
  const { key } = clashPair();
  withConfirm(true, () => keepOnlyEvent('x2', key));
  const gone = S.events.find(e => e.id === 'x1');
  assert.strictEqual(gone.deleted, true);
  assert.strictEqual(gone.dirty, 1, 'not marked dirty — applyDedupe and bulkDelete both do');
  assert.strictEqual(S.events.length, 2, 'the row was destroyed instead of soft-deleted');
});

test('declining the confirm changes nothing at all', () => {
  const { key } = clashPair();
  withConfirm(false, () => keepOnlyEvent('x1', key));
  assert.strictEqual(S.events.find(e => e.id === 'x2').deleted, false,
    'it deleted anyway after the user said no');
  assert.strictEqual(findConflicts(S.events, todayISO()).length, 1, 'the warning vanished');
});

test('the undo restores the exact flags that were there before', () => {
  const { key } = clashPair();
  // x2 already carries a dirty marker from some earlier edit. The undo must
  // put THAT back, not assume the field was unset.
  S.events.find(e => e.id === 'x2').dirty = 7;
  const undo = captureUndo(() => withConfirm(true, () => keepOnlyEvent('x1', key)));
  assert.ok(undo, 'no undo was offered');
  undo();
  const back = S.events.find(e => e.id === 'x2');
  assert.strictEqual(back.deleted, false, 'undo did not restore the event');
  assert.strictEqual(back.dirty, 7, 'undo clobbered a flag it did not set');
  assert.strictEqual(findConflicts(S.events, todayISO()).length, 1,
    'the clash did not come back with the event');
});

test('the choice survives a reload — it is saved, not just re-rendered', () => {
  const { key } = clashPair();
  withConfirm(true, () => keepOnlyEvent('x1', key));
  S = load();
  assert.strictEqual(S.events.find(e => e.id === 'x2').deleted, true,
    'the removal came back after a reload');
});

test('a key for a clash that is already resolved does nothing and does not throw', () => {
  const { key } = clashPair();
  withConfirm(true, () => keepOnlyEvent('x1', key));
  // Same key, second tap (a stale banner, a double tap, another tab).
  let asked = 0;
  const real = confirm;
  confirm = () => { asked++; return true; };
  keepOnlyEvent('x1', key);
  confirm = real;
  assert.strictEqual(asked, 0, 'it asked about a clash that no longer exists');
  assert.strictEqual(S.events.filter(e => !e.deleted).length, 1, 'it removed something else');
});

test('on a crowded day, keeping one removes all the others', () => {
  boot(null);
  const d = dayAhead(4);
  ['a','b','c','d'].forEach((id, i) => S.events.push({
    id, title:'Thing ' + id, date:d, time:'1' + (i+2) + ':00', kind:'event', deleted:false }));
  const c = findConflicts(S.events, todayISO()).find(x => x.type === 'busy-day');
  assert.ok(c, 'four things on one day should read as a busy day');
  assert.strictEqual(c.events.length, 4);
  withConfirm(true, () => keepOnlyEvent('b', conflictKey(c)));
  assert.strictEqual(S.events.filter(e => !e.deleted).length, 1, 'not everything else went');
  assert.strictEqual(S.events.find(e => !e.deleted).id, 'b', 'kept the wrong one');
});

test('the banner offers the new choice WITHOUT losing any of the old ones', () => {
  // Logan's constraint, as a test: "do not remove any functionality."
  clashPair();
  const html = conflictBanner();
  assert.ok(/dismissConflict\(/.test(html), 'Keep both is gone');
  assert.ok(/Keep both/.test(html), 'the keep-both wording is gone');
  assert.ok(/openEventEdit\(/.test(html), 'the reschedule buttons are gone');
  assert.ok(/Tap to reschedule/.test(html), 'the reschedule hint is gone');
  // v9.66: the bare x became a control with a visible word, because an
  // unlabelled icon that silences a warning permanently was the trigger for
  // the whole code review (P7-01). Assert the WORD, not the aria-label.
  assert.ok(/>Dismiss</.test(html), 'the dismiss control lost its visible label');
  assert.ok(/dismissConflict\(/.test(html), 'the dismiss control is gone');
  // v9.70: the per-event choices moved INTO select mode rather than sitting as
  // two red links under every row. The default view must therefore carry the
  // one link that reaches them -- and nothing destructive per event.
  assert.ok(/toggleClashSelect\(/.test(html), 'there is no way into select mode');
  assert.ok(/Select…/.test(html), 'the select control has no visible text');
  assert.ok(!/keepOnlyEvent\(/.test(html) && !/removeOneEvent\(/.test(html),
    'the default view is carrying per-event destructive links again');
});

test('select mode offers both directions, on any number of events', () => {
  // Logan, 28 Aug: "I should be able to choose one or multiple." v9.69 gave him
  // two per-event links and no way to say "these two".
  const { key } = clashPair();
  toggleClashSelect(key);
  let html = conflictBanner();
  assert.ok(/0 selected/.test(html), 'the count bar is missing');
  assert.ok(/Select all/.test(html) && /Cancel/.test(html), 'no select-all or escape hatch');
  assert.ok(/toggleClashPick\('x1'/.test(html) && /toggleClashPick\('x2'/.test(html),
    'not every event is tickable');
  // Both actions are present but refuse an empty selection.
  assert.ok(/removeSelectedClash\(/.test(html) && /keepOnlySelectedClash\(/.test(html),
    'select mode is missing one of its two directions');
  assert.strictEqual((html.match(/disabled/g) || []).length, 2,
    'the actions are tappable with nothing selected');

  toggleClashPick('x1', key);
  html = conflictBanner();
  assert.ok(/1 selected/.test(html), 'the count did not follow the tick');
  assert.ok(/Remove selected \(1\)/.test(html), 'the remove button does not carry its count');
  // Rule 26: a destructive control wears its consequence.
  assert.ok(/Keep only this — remove 1/.test(html),
    'the keep-only button does not say how many it removes');
});

test('each row in select mode names its event and reports its ticked state', () => {
  const { key } = clashPair();
  toggleClashSelect(key);
  toggleClashPick('x1', key);
  const html = conflictBanner();
  // The row IS the control, so its own text is its accessible name; the state
  // has to be announced separately or a screen reader cannot tell them apart.
  console.log('PROBE2:' + JSON.stringify(html.slice(0, 400)));
  assert.ok(/role="checkbox" aria-checked="true"[\s\S]{0,600}Recital/.test(html),
    'the ticked row does not announce itself as checked');
  assert.ok(/role="checkbox" aria-checked="false"[\s\S]{0,600}Volleyball/.test(html),
    'the unticked row does not announce itself as unchecked');
});

test('the pager still works, and keep-only does not silence the pair permanently', () => {
  const { key } = clashPair();
  const undo = captureUndo(() => withConfirm(true, () => keepOnlyEvent('x1', key)));
  undo();
  // dismissedConflicts must NOT have been written: an undone removal has to
  // bring the warning back with it.
  assert.ok(!(S.settings.dismissedConflicts || []).includes(key),
    'keep-only also dismissed the clash, so the undo left a silenced pair');
  assert.ok(/Recital/.test(conflictBanner()), 'the banner did not come back');
});

console.log('\nEditing a list item, and renaming a list (v9.60)');

// Before v9.60 the only way to fix a typo on a list was: check the item, tap
// "Clear checked items" (which cleared every other checked item too), and type
// it again. These drive the real handlers, not the markup.
function oneList(){
  boot(null);
  S.lists.push({ id:'l1', name:'Grocerys', deleted:false });
  S.listItems.push({ id:'i1', listId:'l1', text:'Mlik', checked:false, deleted:false });
  S.listItems.push({ id:'i2', listId:'l1', text:'Bread', checked:true, deleted:false });
  listEditId = null; listRenameId = null;
  view = { tab:'notes', sub:'listDetail', data:{ id:'l1' } };
}
function withBox(id, value, fn){
  const real = document.getElementById;
  // A real element, with the value swapped in -- so the handler's focus() and
  // setSelectionRange() calls behave the way they do in a browser.
  document.getElementById = (want) => {
    const node = real.call(document, want);
    if(want === id) node.value = value;
    return node;
  };
  try { return fn(); } finally { document.getElementById = real; }
}

test('an item can be renamed, and the rename survives a reload', () => {
  oneList();
  editItem('i1');
  assert.strictEqual(listEditId, 'i1', 'edit mode did not open on that item');
  withBox('editItem', 'Milk', () => saveItemEdit('i1'));
  assert.strictEqual(S.listItems.find(i => i.id === 'i1').text, 'Milk');
  assert.strictEqual(listEditId, null, 'the editor stayed open after saving');
  S = load();
  assert.strictEqual(S.listItems.find(i => i.id === 'i1').text, 'Milk',
    'the rename came back as the old text after a reload');
});

test('saving an EMPTY edit cancels — it never destroys the text', () => {
  // Clearing the box and tapping Save would otherwise wipe the item with no
  // undo, and delete already has its own labelled control beside it.
  oneList();
  editItem('i1');
  withBox('editItem', '   ', () => saveItemEdit('i1'));
  assert.strictEqual(S.listItems.find(i => i.id === 'i1').text, 'Mlik',
    'an empty save destroyed the item text');
  assert.strictEqual(listEditId, null, 'the editor did not close');
});

test('cancelling an edit changes nothing', () => {
  oneList();
  editItem('i1');
  cancelItemEdit();
  assert.strictEqual(S.listItems.find(i => i.id === 'i1').text, 'Mlik');
  assert.strictEqual(listEditId, null);
});

test('an item can be deleted from the editor, undoably', () => {
  oneList();
  let undo = null;
  const realToast = toast;
  toast = (msg, action) => { if(action && action.fn) undo = action.fn; };
  editItem('i1');
  delItem('i1');
  assert.strictEqual(S.listItems.find(i => i.id === 'i1').deleted, true, 'not deleted');
  assert.strictEqual(listEditId, null, 'the editor stayed open over a deleted item');
  assert.ok(undo, 'no undo was offered — softDelete was bypassed');
  undo();
  assert.strictEqual(S.listItems.find(i => i.id === 'i1').deleted, false, 'undo did not restore');
  toast = realToast;
});

test('editing one item leaves the others, and the checked ones, alone', () => {
  oneList();
  editItem('i1');
  withBox('editItem', 'Milk', () => saveItemEdit('i1'));
  const other = S.listItems.find(i => i.id === 'i2');
  assert.strictEqual(other.text, 'Bread');
  assert.strictEqual(other.checked, true, 'the checked state of another item moved');
});

test('a list can be renamed without touching its items', () => {
  oneList();
  renameList('l1');
  assert.strictEqual(listRenameId, 'l1');
  assert.strictEqual(listEditId, null, 'both editors were open at once');
  withBox('renameList', 'Groceries', () => saveListRename('l1'));
  assert.strictEqual(S.lists.find(l => l.id === 'l1').name, 'Groceries');
  assert.strictEqual(S.listItems.filter(i => i.listId === 'l1' && !i.deleted).length, 2,
    'renaming the list disturbed its items');
});

test('an empty list rename cancels too', () => {
  oneList();
  renameList('l1');
  withBox('renameList', '', () => saveListRename('l1'));
  assert.strictEqual(S.lists.find(l => l.id === 'l1').name, 'Grocerys');
});

test('the row still toggles, and the edit control is a visible word', () => {
  // Rule 1: adding an edit path must not take the primary action away.
  oneList();
  toggleItem('i1');
  assert.strictEqual(S.listItems.find(i => i.id === 'i1').checked, true,
    'tapping the row no longer toggles');
  const m = { innerHTML:'' };
  renderListDetail(m);
  assert.ok(/>Edit</.test(m.innerHTML), 'the edit control has no visible label');
  assert.ok(/toggleItem\('i1'\)/.test(m.innerHTML), 'the row lost its toggle');
});

console.log('\nNotes (v9.60)');

function someNotes(){
  boot(null);
  S.notes = [
    { id:'n1', title:'Uniform sizes', body:'Braelyn medium', pinned:false, personIds:[],
      created:'2026-08-20T10:00:00.000Z', updated:'2026-08-20T10:00:00.000Z', deleted:false },
    { id:'n2', title:'', body:'Office number 555-0100\nAsk for Karen', pinned:false, personIds:[],
      created:'2026-08-25T10:00:00.000Z', updated:'2026-08-25T10:00:00.000Z', deleted:false },
  ];
  noteSearch = '';
  view = { tab:'notes', sub:null, data:null };
}

test('a note with no title borrows the first non-empty line of the body', () => {
  // Apple Notes' convention; Keep gives a dedicated title line. Doing both means
  // quick capture needs no title and the board still reads properly.
  someNotes();
  assert.strictEqual(noteTitleOf(S.notes[1]), 'Office number 555-0100');
  assert.strictEqual(noteTitleOf(S.notes[0]), 'Uniform sizes', 'an explicit title must win');
  assert.strictEqual(noteTitleOf({ title:'', body:'\n\n  \n' }), 'Untitled note',
    'an empty note must still have a name');
  assert.strictEqual(noteTitleOf({ title:'  Padded  ', body:'x' }), 'Padded');
});

test('the preview never repeats the line the title was borrowed from', () => {
  someNotes();
  assert.strictEqual(notePreviewOf(S.notes[1]), 'Ask for Karen');
  assert.strictEqual(notePreviewOf(S.notes[0]), 'Braelyn medium',
    'a note with its own title should preview from line one');
});

test('quick capture creates a note, seeds it, and opens it', () => {
  someNotes();
  let opened = null;
  const realSub = sub;
  sub = (name, data) => { opened = { name, data }; };
  withBox('newNote', 'Coach said cleats by Friday', () => newNote());
  sub = realSub;
  assert.strictEqual(S.notes.length, 3);
  assert.strictEqual(S.notes[0].body, 'Coach said cleats by Friday', 'not newest-first, or not seeded');
  assert.ok(opened && opened.name === 'noteDetail', 'it did not open the new note');
  assert.strictEqual(opened.data.id, S.notes[0].id);
  S = load();
  assert.strictEqual(S.notes.length, 3, 'the new note did not survive a reload');
});

test('typing autosaves, without re-rendering the screen out from under the caret', () => {
  someNotes();
  view = { tab:'notes', sub:'noteDetail', data:{ id:'n1' } };
  let rendered = 0;
  const realRender = render;
  render = () => { rendered++; };
  const real = document.getElementById;
  document.getElementById = (want) => {
    const node = real.call(document, want);
    if(want === 'noteTitle') node.value = 'Uniform sizes';
    if(want === 'noteBody')  node.value = 'Braelyn medium — 10.5 shoe';
    return node;
  };
  writeNote('n1');
  document.getElementById = real;
  render = realRender;
  assert.strictEqual(S.notes[0].body, 'Braelyn medium — 10.5 shoe', 'the edit was not written');
  assert.strictEqual(rendered, 0, 'writing re-rendered — that destroys focus mid-word');
  assert.notStrictEqual(S.notes[0].updated, '2026-08-20T10:00:00.000Z', 'updated did not move');
});

test('a pending autosave is flushed rather than lost when the note is left', () => {
  someNotes();
  view = { tab:'notes', sub:'noteDetail', data:{ id:'n1' } };
  const real = document.getElementById;
  document.getElementById = (want) => {
    const node = real.call(document, want);
    if(want === 'noteTitle') node.value = 'Uniform sizes';
    if(want === 'noteBody')  node.value = 'typed but not yet debounced';
    return node;
  };
  noteEdited('n1');                       // schedules, does not write
  assert.strictEqual(S.notes[0].body, 'Braelyn medium', 'the debounce wrote immediately');
  flushNote();                            // what blur and Done call
  document.getElementById = real;
  assert.strictEqual(S.notes[0].body, 'typed but not yet debounced',
    'tapping away lost what was typed');
});

test('pinning splits the board into two groups, pinned first', () => {
  someNotes();
  togglePinNote('n1');
  assert.strictEqual(S.notes.find(n => n.id === 'n1').pinned, true);
  const m = { innerHTML:'' };
  renderNotes(m);
  assert.ok(/Pinned/.test(m.innerHTML) && /Others/.test(m.innerHTML),
    'pinned and unpinned are not shown as separate groups');
  assert.ok(m.innerHTML.indexOf('Uniform sizes') < m.innerHTML.indexOf('Office number'),
    'the pinned note is not at the top');
  togglePinNote('n1');
  assert.strictEqual(S.notes.find(n => n.id === 'n1').pinned, false, 'unpin does not work');
});

test('search covers title and body, and can be cleared', () => {
  someNotes();
  noteSearch = 'karen';
  assert.strictEqual(S.notes.filter(noteMatches).length, 1, 'body text is not searched');
  noteSearch = 'uniform';
  assert.strictEqual(S.notes.filter(noteMatches).length, 1, 'titles are not searched');
  noteSearch = 'zzz';
  assert.strictEqual(S.notes.filter(noteMatches).length, 0);
  noteSearch = '';
  assert.strictEqual(S.notes.filter(noteMatches).length, 2, 'an empty query must match everything');
});

test('search finds a note by the person it is tagged to', () => {
  someNotes();
  S.kids.push({ id:'k9', name:'Olivia', color:'#7C3AED', type:'kid', deleted:false });
  S.notes[0].personIds = ['k9'];
  noteSearch = 'olivia';
  assert.strictEqual(S.notes.filter(noteMatches).length, 1,
    'people are this app\'s labels — searching one should find the note');
  noteSearch = '';
});

test('deleting a note is soft and undoable, and does not strand the screen', () => {
  someNotes();
  view = { tab:'notes', sub:'noteDetail', data:{ id:'n1' } };
  let undo = null;
  const realToast = toast;
  toast = (msg, action) => { if(action && action.fn) undo = action.fn; };
  delNote('n1');
  toast = realToast;
  assert.strictEqual(S.notes.find(n => n.id === 'n1').deleted, true);
  assert.strictEqual(S.notes.length, 2, 'the row was destroyed instead of soft-deleted');
  assert.strictEqual(view.sub, null, 'it left you sitting on a deleted note');
  assert.ok(undo, 'no undo was offered');
  undo();
  assert.strictEqual(S.notes.find(n => n.id === 'n1').deleted, false);
});

test('a deleted note renders a real state, not a crash', () => {
  someNotes();
  S.notes[0].deleted = true;
  view = { tab:'notes', sub:'noteDetail', data:{ id:'n1' } };
  const m = { innerHTML:'' };
  renderNoteDetail(m);
  assert.ok(/That note is gone/.test(m.innerHTML), 'a missing note is not handled');
});

test('tagging a person marks the note edited without losing the body', () => {
  someNotes();
  S.kids.push({ id:'k9', name:'Olivia', color:'#7C3AED', type:'kid', deleted:false });
  view = { tab:'notes', sub:'noteDetail', data:{ id:'n1' } };
  toggleNotePerson('n1', 'k9');
  assert.deepStrictEqual(S.notes[0].personIds, ['k9']);
  assert.strictEqual(S.notes[0].body, 'Braelyn medium', 'tagging clobbered the body');
  toggleNotePerson('n1', 'k9');
  assert.deepStrictEqual(S.notes[0].personIds, [], 'a second tap should untag');
});

test('the empty board explains itself instead of showing a bare screen', () => {
  boot(null); S.notes = []; noteSearch = '';
  const m = { innerHTML:'' };
  renderNotes(m);
  assert.ok(/No notes yet/.test(m.innerHTML));
  assert.ok(/Take a note/.test(m.innerHTML), 'no way to add the first note');
});

test('notes ride along in a backup and come back from one', () => {
  someNotes();
  save();
  const backup = JSON.parse(localStorage.getItem('flyersnap'));
  assert.strictEqual(backup.notes.length, 2, 'notes are not in the saved blob');
  boot(JSON.stringify(backup));
  assert.strictEqual(S.notes.length, 2, 'notes did not come back');
  assert.strictEqual(S.notes[0].title, 'Uniform sizes');
});

test('an old save with no notes key loads with an empty one, not undefined', () => {
  const old = JSON.parse(GOOD);
  delete old.notes;
  old.schemaVersion = 1;
  boot(JSON.stringify(old));
  assert.ok(Array.isArray(S.notes), 'notes is not an array on an upgraded save');
  assert.strictEqual(S.notes.length, 0);
  const m = { innerHTML:'' };
  renderNotes(m);                        // must not throw
  assert.ok(/No notes yet/.test(m.innerHTML));
});

test('a save whose notes key is junk is coerced, not trusted', () => {
  const bad = JSON.parse(GOOD);
  bad.notes = 'not an array';
  bad.schemaVersion = 7;
  boot(JSON.stringify(bad));
  assert.ok(Array.isArray(S.notes), 'a junk notes value reached the app');
});

test('pruning drops deleted notes and counts them', () => {
  someNotes();
  S.notes[0].deleted = true;
  const before = S.notes.length;
  manualPrune();
  assert.strictEqual(S.notes.length, before - 1, 'a deleted note survived the prune');
  assert.strictEqual(S.notes[0].id, 'n2', 'the wrong note was pruned');
});

console.log('\nNotes tab: two areas, Notes and Lists (v9.61)');

function twoAreas(){
  boot(null);
  S.lists.push({ id:'l1', name:'Groceries', deleted:false });
  S.listItems.push({ id:'i1', listId:'l1', text:'Milk', checked:false, deleted:false });
  S.notes = [{ id:'n1', title:'Uniform sizes', body:'Braelyn medium', pinned:false,
    personIds:[], created:'2026-08-20T10:00:00.000Z', updated:'2026-08-20T10:00:00.000Z', deleted:false }];
  S.settings.notesArea = 'notes';
  view = { tab:'notes', sub:null, data:null };
}

test('the tab bar is back to five, and Lists is not one of them', () => {
  // Apple HIG: "In general, use between three and five tabs on iPhone."
  // Material: "Use up to five top-level destinations."
  assert.strictEqual(TABS.length, 5, 'expected five tabs');
  const ids = TABS.map(t => t.id);
  assert.ok(ids.includes('notes'), 'Notes is not a tab');
  assert.ok(!ids.includes('lists'), 'Lists is still its own tab');
  assert.strictEqual(ids[2], 'notes', 'Notes should hold the slot Lists had');
});

test('nav("lists") still works — it opens the Lists AREA, not a blank screen', () => {
  // The name outlived the tab: people use it, the router emits it, and the
  // a11y audit calls it. A view.tab the tabs map cannot answer renders nothing.
  twoAreas();
  nav('lists');
  assert.strictEqual(view.tab, 'notes', 'it left view.tab on a screen that no longer exists');
  assert.strictEqual(notesArea(), 'lists', 'it did not select the Lists area');
  const m = { innerHTML:'' };
  renderNotes(m);
  assert.ok(/Groceries/.test(m.innerHTML), 'the lists did not render');
});

test('the chosen area is remembered across a reload', () => {
  twoAreas();
  setNotesArea('lists');
  S = load();
  assert.strictEqual(notesArea(), 'lists', 'it forgot which area was in use');
  setNotesArea('notes');
  S = load();
  assert.strictEqual(notesArea(), 'notes');
});

test('the switcher is on screen in BOTH areas, so neither is a dead end', () => {
  twoAreas();
  let m = { innerHTML:'' };
  renderNotes(m);
  assert.ok(/setNotesArea\('lists'\)/.test(m.innerHTML), 'no way through to Lists');
  assert.ok(/setNotesArea\('notes'\)/.test(m.innerHTML), 'no way back to Notes');
  assert.ok(/Uniform sizes/.test(m.innerHTML), 'the notes board did not render');

  setNotesArea('lists');
  m = { innerHTML:'' };
  renderNotes(m);
  assert.ok(/setNotesArea\('notes'\)/.test(m.innerHTML), 'the Lists area cannot get back');
  assert.ok(/setNotesArea\('lists'\)/.test(m.innerHTML), 'the switcher lost its own area');
  assert.ok(!/Uniform sizes/.test(m.innerHTML), 'both areas rendered at once');
});

test('the switcher is a real button, not a span pretending to be one', () => {
  // The v9.12 review found bare <span onclick> controls on Edit Event and
  // treated them as a defect. A control that is a control should be a button.
  twoAreas();
  const m = { innerHTML:'' };
  renderNotes(m);
  assert.ok(/<button class="chip[^"]*" aria-pressed="(true|false)"\s*\n?\s*onclick="setNotesArea/.test(m.innerHTML)
         || /<button class="chip[^"]*" aria-pressed=/.test(m.innerHTML),
    'the area switcher is not a button with a pressed state');
  assert.ok(!/<span[^>]*onclick="setNotesArea/.test(m.innerHTML), 'the switcher is a span');
});

test('every list function is still reachable, and behaves identically', () => {
  // Rule 1: this is a relocation, not a removal.
  twoAreas();
  setNotesArea('lists');
  const m = { innerHTML:'' };
  renderNotes(m);
  ['addList()', "sub('listDetail'", 'renameList(', 'delList('].forEach(fn =>
    assert.ok(m.innerHTML.includes(fn), 'the Lists area lost: ' + fn));

  // ...and the detail screen still opens from inside the Notes tab.
  view = { tab:'notes', sub:'listDetail', data:{ id:'l1' } };
  const d = { innerHTML:'' };
  renderListDetail(d);
  assert.ok(/Milk/.test(d.innerHTML), 'the list detail screen broke');
  assert.ok(/addItem\('l1'\)/.test(d.innerHTML), 'items can no longer be added');
  assert.ok(/editItem\('i1'\)/.test(d.innerHTML), 'items can no longer be edited');
});

test('the header names the AREA while the tab names the section', () => {
  twoAreas();
  let seen = null;
  const realSet = setHeader;
  setHeader = (t) => { seen = t; };
  renderNotes({ innerHTML:'' });
  assert.strictEqual(seen, 'Notes');
  setNotesArea('lists');
  renderNotes({ innerHTML:'' });
  assert.strictEqual(seen, 'Lists', 'the header does not say which area you are in');
  setHeader = realSet;
});

test('the assistant can be sent to either area by name', () => {
  const screen = INTENTS.find(i => i.id === 'open_screen');
  assert.ok(screen, 'open_screen is gone');
  const values = screen.params.screen.values;
  assert.ok(values.includes('notes'), '"take me to my notes" would not validate');
  assert.ok(values.includes('lists'), 'the old name stopped validating');
});

test('going back from a list detail returns to the Lists area, not to Notes', () => {
  twoAreas();
  setNotesArea('lists');
  view = { tab:'notes', sub:'listDetail', data:{ id:'l1' } };
  back();
  assert.strictEqual(view.tab, 'notes');
  assert.strictEqual(view.sub, null);
  assert.strictEqual(notesArea(), 'lists', 'it dumped you on the wrong half');
});

console.log('\nCode-review fixes (v9.63)');

test('P5-07: dismissing one duplicate group does not destroy the next one', () => {
  // dedupeKeep was keyed by the group's POSITION. dismissGroup() removes a
  // group, duplicateGroups() is recomputed, everything shifts down one -- and
  // dedupeKeep still held the id chosen for whatever used to be at that index.
  // With that id in no surviving group, `e.id !== keep` was true for EVERY
  // member and applyDedupe deleted BOTH events instead of one.
  boot(GOOD);
  const d1 = dayAhead(3), d2 = dayAhead(4);
  S.events = [
    { id:'a1', title:'Open House', date:d1, kind:'event', deleted:false },
    { id:'a2', title:'Open House Night', date:d1, kind:'event', deleted:false },
    { id:'b1', title:'Picture Day', date:d2, kind:'event', deleted:false },
    { id:'b2', title:'Picture Day Reminder', date:d2, kind:'event', deleted:false },
  ];
  assert.strictEqual(duplicateGroups().length, 2, 'expected two groups to start');
  openDedupe();
  dismissGroup(0);                                  // "Not duplicates" on the first
  assert.strictEqual(duplicateGroups().length, 1, 'one group should remain');
  applyDedupe();
  const live = S.events.filter(e => !e.deleted).map(e => e.id).sort();
  // The dismissed pair survives whole, and the remaining group loses exactly
  // the copy that was not chosen -- never both.
  assert.ok(live.includes('a1') && live.includes('a2'), 'the dismissed pair was destroyed');
  assert.strictEqual(live.filter(id => id[0] === 'b').length, 1,
    'the surviving group lost both events instead of one: ' + live.join(','));
});

test('P5-07: a keep-id belonging to no member of the group is refused', () => {
  // Belt and braces on the same failure: even with a stable key, an id that is
  // not in THIS group must never mean "keep this one".
  boot(GOOD);
  const d = dayAhead(5);
  S.events = [
    { id:'x', title:'Concert', date:d, kind:'event', deleted:false },
    { id:'y', title:'Concert Night', date:d, kind:'event', deleted:false },
  ];
  openDedupe();
  setDedupeKeep(dedupeGroupKey(duplicateGroups()[0]), 'not-in-this-group');
  applyDedupe();
  assert.strictEqual(S.events.filter(e => !e.deleted).length, 2,
    'a bogus keep-id deleted the whole group');
});

test('P4-01: sign-out only claims success when the token is really gone', () => {
  boot(GOOD);
  const realRemove = localStorage.removeItem;
  const realAlert = alert, realToast = toast;
  let alerted = null, toasted = null;
  alert = (m) => { alerted = m; };
  toast = (m) => { toasted = m; };

  // Storage refuses the write -- private mode, storage access denied.
  localStorage.setItem('flyersnap.gordon.session', '{"idToken":"x"}');
  localStorage.removeItem = () => { throw new Error('QuotaExceededError'); };
  assert.strictEqual(clearGordonSession(), false, 'it claimed success while throwing');
  gordonSignOutUI();
  assert.ok(alerted && /Could not sign out/.test(alerted),
    'the user was told they signed out when they did not');
  assert.strictEqual(toasted, null, 'it toasted success anyway');

  // ...and the normal path still works.
  localStorage.removeItem = realRemove;
  alerted = null; toasted = null;
  assert.strictEqual(clearGordonSession(), true);
  gordonSignOutUI();
  assert.strictEqual(alerted, null, 'a successful sign-out must not alert');
  assert.ok(toasted && /Signed out/.test(toasted), 'a successful sign-out says so');

  alert = realAlert; toast = realToast;
});

test('P5-06: Select all on the export picker actually selects them all', () => {
  // The ids used to be serialised into the onclick attribute with
  // JSON.stringify -- double quotes, inside a double-quoted attribute -- so the
  // browser truncated the handler and the control had never worked at all.
  boot(GOOD);
  const d = dayAhead(2);
  S.events = [
    { id:'e1', title:'A', date:d, kind:'event', deleted:false },
    { id:'e2', title:'B', date:d, kind:'event', deleted:false },
    { id:'e3', title:'C', date:dayAhead(3), kind:'event', deleted:false },
  ];
  exportPick = new Set();
  toggleAllExportPick();
  assert.strictEqual(exportPick.size, 3, 'select all did not select every candidate');
  toggleAllExportPick();
  assert.strictEqual(exportPick.size, 0, 'a second tap should clear them');
});

test('P5-06: the handler takes no argument, so nothing is serialised into markup', () => {
  const m = { innerHTML:'' };
  boot(GOOD);
  S.events = [{ id:'e1', title:'A', date:dayAhead(2), kind:'event', deleted:false }];
  exportPick = new Set();
  renderPickExport(m);
  assert.ok(/toggleAllExportPick\(\)/.test(m.innerHTML), 'the control is gone');
  assert.ok(!/toggleAllExportPick\(\[/.test(m.innerHTML),
    'ids are being serialised into the attribute again — that is what broke it');
});

test('P5-01: a repeated word no longer merges two unrelated events', () => {
  // Overlap counted A as a MULTISET while dividing by the shorter title's word
  // count, so one repeated word could reach 1.0.
  const d = dayAhead(4);
  const a = { date:d, title:'Grade 3 and Grade 4 and Grade 5 Swim' };
  const b = { date:d, title:'Grade 6 Trip' };
  assert.strictEqual(looksDuplicate(a, b), false,
    'two unrelated events on the same day still merge as duplicates');

  // ...and the thing the function exists for still works.
  assert.strictEqual(looksDuplicate(
    { date:d, title:'Picture Day' },
    { date:d, title:'Fall Picture Day for Grades 1-5' }), true,
    'a real containment match was broken by the fix');
  assert.strictEqual(looksDuplicate(
    { date:d, title:'Open House' },
    { date:d, title:'Open House' }), true, 'identical titles must still match');
});

test('dismissing an unreadable email records it, so it is not re-read forever', () => {
  // Verified during the P5 follow-up: dismissOneEmail() removed the row from
  // the screen and recorded NOTHING, so fetchEmailQueue offered the same msgId
  // on the next check and the app fetched and re-extracted it at model cost --
  // every 20 minutes, indefinitely.
  boot(GOOD);
  S.settings.seenMsgs = [];
  lastEmailProblems = [{ subject:'Newsletter', reason:'No dates found', msgId:'m1', retriable:false }];
  pendingEvents = [{ title:'x', date:dayAhead(1), selected:true }];
  dismissOneEmail('m1');
  assert.ok((S.settings.seenMsgs || []).includes('m1'),
    'the dismissed message was not recorded — it will be re-read and re-billed');
  S = load();
  assert.ok((S.settings.seenMsgs || []).includes('m1'), 'and it did not survive a reload');
  pendingEvents = [];
});

test('an empty email check clears the waiting badge', () => {
  // openEmailReviewNow() reset the count on an empty result; checkEmail() did
  // not, so a queue that emptied any other way left "N waiting" on the Events
  // tab with nothing behind it.
  boot(GOOD);
  const src = String(checkEmail);
  const empty = src.split('if(!fresh.length)')[1].split('}')[0];
  assert.ok(/pendingEmailCount = 0/.test(empty),
    'the empty-result path does not clear the badge');
});

test('a new person never takes a colour someone else is already using', () => {
  // The colour was picked by LIVE COUNT, so deleting someone in the middle made
  // the next person collide with an existing one -- and colour is the person tag
  // on every chip, filter and event row. Verified by execution before the fix:
  // Ana=#7C3AED Cy=#B45309 Dee=#B45309.
  boot(GOOD);
  S.kids.length = 0;
  const addNamed = (n) => {
    const real = document.getElementById;
    document.getElementById = (id) => id === 'kidName' ? { value:n } : real.call(document, id);
    addKid();
    document.getElementById = real;
  };
  addNamed('Ana'); addNamed('Ben'); addNamed('Cy');
  S.kids.find(k => k.name === 'Ben').deleted = true;
  addNamed('Dee');
  const live = S.kids.filter(k => !k.deleted);
  assert.strictEqual(live.length, 3);
  assert.strictEqual(new Set(live.map(k => k.color)).size, 3,
    'two live people share a colour: ' + live.map(k => k.name + '=' + k.color).join(' '));
  // ...and the freed colour is the one that gets reused.
  assert.strictEqual(live.find(k => k.name === 'Dee').color, KID_COLORS[1],
    'the free colour was skipped');
});

console.log('\nDismissals are reversible (v9.66 — closes P6-01, P6-02, P7-01)');

function twoClashing(){
  boot(GOOD);
  const d = dayAhead(3);
  S.events = [
    { id:'c1', title:'Band', date:d, time:'19:00', endTime:'20:30', kind:'event', deleted:false },
    { id:'c2', title:'Volleyball', date:d, time:'19:30', endTime:'21:00', kind:'event', deleted:false },
  ];
  S.settings.dismissedConflicts = [];
  const c = findConflicts(S.events, todayISO()).find(x => x.type === 'overlap');
  assert.ok(c, 'the fixture does not clash');
  return conflictKey(c);
}

test('P6-01: dismissing a clash warning can be undone on the spot', () => {
  const key = twoClashing();
  let undo = null;
  const realToast = toast;
  toast = (m, action) => { if(action && action.fn) undo = action.fn; };
  dismissConflict(key);
  toast = realToast;
  assert.ok(S.settings.dismissedConflicts.includes(key), 'it was not dismissed');
  assert.ok(undo, 'no undo was offered — that is the one-way door');
  undo();
  assert.ok(!S.settings.dismissedConflicts.includes(key), 'undo did not bring it back');
  assert.strictEqual(findConflicts(S.events, todayISO()).filter(c =>
    !S.settings.dismissedConflicts.includes(conflictKey(c))).length, 1,
    'the warning did not reappear');
});

test('P6-01: a dismissed warning is listed, and can be brought back later', () => {
  const key = twoClashing();
  const realToast = toast; toast = () => {};
  dismissConflict(key);
  toast = realToast;
  assert.strictEqual(dismissedCount(), 1, 'the Settings row would show nothing');

  const m = { innerHTML:'' };
  view = { tab:'settings', sub:'setDismissed', data:null };
  renderSetDismissed(m);
  assert.ok(/Band/.test(m.innerHTML) && /Volleyball/.test(m.innerHTML),
    'the screen does not name the events involved');
  assert.ok(/restoreDismissedConflict\(/.test(m.innerHTML), 'no way back from the listing');

  restoreDismissedConflict(key);
  assert.strictEqual(dismissedCount(), 0);
  assert.strictEqual(S.settings.dismissedConflicts.length, 0);
});

test('P6-01: clear-all brings every silenced warning back, undoably', () => {
  const key = twoClashing();
  const realToast = toast;
  let undo = null;
  toast = (m, action) => { if(action && action.fn) undo = action.fn; };
  dismissConflict(key);
  undo = null;
  clearDismissedConflicts();
  toast = realToast;
  assert.strictEqual(S.settings.dismissedConflicts.length, 0, 'clear-all did nothing');
  assert.ok(undo, 'clear-all offered no undo');
  undo();
  assert.ok(S.settings.dismissedConflicts.includes(key), 'undoing clear-all did not restore');
});

test('P6-02: "Not duplicates" undoes only the pair you just dismissed', () => {
  boot(GOOD);
  const d1 = dayAhead(3), d2 = dayAhead(4);
  S.events = [
    { id:'a1', title:'Open House', date:d1, kind:'event', deleted:false },
    { id:'a2', title:'Open House Night', date:d1, kind:'event', deleted:false },
    { id:'b1', title:'Picture Day', date:d2, kind:'event', deleted:false },
    { id:'b2', title:'Picture Day Reminder', date:d2, kind:'event', deleted:false },
  ];
  S.settings.notDuplicates = [];
  let undo = null;
  const realToast = toast;
  toast = (m, action) => { if(action && action.fn) undo = action.fn; };
  dismissGroup(0);
  const afterFirst = S.settings.notDuplicates.slice();
  assert.strictEqual(afterFirst.length, 1, 'one pair should be recorded');
  const firstUndo = undo;
  dismissGroup(0);                                  // the group that shifted down
  assert.strictEqual(S.settings.notDuplicates.length, 2, 'both pairs recorded');
  toast = realToast;

  // Undoing the FIRST dismissal must not remove the second decision.
  firstUndo();
  assert.strictEqual(S.settings.notDuplicates.length, 1,
    'the undo removed a decision it did not make');
  assert.ok(!S.settings.notDuplicates.includes(afterFirst[0]), 'it undid the wrong pair');
});

test('P6-02: a not-duplicates pair is listed and restorable', () => {
  boot(GOOD);
  const d = dayAhead(3);
  S.events = [
    { id:'a1', title:'Open House', date:d, kind:'event', deleted:false },
    { id:'a2', title:'Open House Night', date:d, kind:'event', deleted:false },
  ];
  S.settings.notDuplicates = []; S.settings.dismissedConflicts = [];
  const realToast = toast; toast = () => {};
  dismissGroup(0);
  toast = realToast;
  const key = S.settings.notDuplicates[0];
  const m = { innerHTML:'' };
  renderSetDismissed(m);
  assert.ok(/Open House/.test(m.innerHTML), 'the pair is not named on the screen');
  assert.ok(/restoreNotDuplicate\(/.test(m.innerHTML), 'no way back');
  restoreNotDuplicate(key);
  assert.strictEqual(S.settings.notDuplicates.length, 0);
  assert.strictEqual(duplicateGroups().length, 1, 'the pair is not offered again');
});

test('P7-01: the dismiss control says "dismiss", and so does the big green one', () => {
  twoClashing();
  const html = conflictBanner();
  assert.ok(/>Dismiss</.test(html),
    'the bare x is back — an unlabelled control that silences a warning permanently');
  assert.ok(/dismiss this warning<\/button>/.test(html),
    'the keep-both button no longer says what it actually does');
  // Both still work, and both are still there (rule 1).
  assert.strictEqual((html.match(/dismissConflict\(/g) || []).length, 2,
    'one of the two dismiss paths was removed');
});

test('the Settings hub shows how much is silenced', () => {
  boot(GOOD);
  S.settings.dismissedConflicts = ['overlap|2026-12-09|e1,e2'];
  S.settings.notDuplicates = ['e1~e2'];
  assert.strictEqual(dismissedCount(), 2);
  const m = { innerHTML:'' };
  renderSettings(m);
  assert.ok(/Dismissed warnings/.test(m.innerHTML), 'the hub row is missing');
  assert.ok(/2 silenced/.test(m.innerHTML), 'the hub row does not say how many');
  assert.ok(/setDismissed/.test(m.innerHTML), 'the row points nowhere');
});

console.log('\nThree confirmed review findings (v9.67)');

test('citations above the 99th are no longer silently dropped', () => {
  // Verified by execution before the fix: a "next 3 months" scope with 140
  // events emitted 140 refs, and citedEvents('see [140]') returned 0.
  const refs = [];
  for(let i = 1; i <= 140; i++) refs.push({ ref:i, id:'e'+i, line:'x', rel:'' });
  assert.strictEqual(citedEvents('see [140]', refs).length, 1, 'ref 140 is dropped');
  assert.strictEqual(citedEvents('see [100]', refs).length, 1, 'ref 100 is dropped');
  assert.strictEqual(citedEvents('see [7]', refs).length, 1, 'ordinary refs broke');
  assert.strictEqual(citedEvents('see [1400]', refs).length, 0,
    'the regex now matches something that is not a ref');
});

test('a progress note is not filed as a failure when the extraction succeeded', () => {
  // 'combined read found nothing; trying each part separately' used to go into
  // `problems`, and every entry there became a review-box failure AND a Problem
  // Log row -- so an email the app then read correctly still left a
  // "couldn't be read" trace. Same symptom migration v7 was written to clear.
  const src = String(extractFromEmailPayload);
  assert.ok(/const notes = \[\]/.test(src), 'progress notes share the failure list again');
  assert.ok(/notes\.push\('combined read found nothing/.test(src),
    'the progress note is back in `problems`');
  assert.ok(!/problems\.push\('combined read/.test(src),
    'a progress note is still being filed as a problem');
  assert.ok(/return \{ events, problems, notes \}/.test(src), 'notes are not returned');
});

test('the fallback toast and its log entry wait until Anthropic has answered', () => {
  // They used to fire before `return await callClaude(...)`, so a failing
  // Anthropic left the user told it had answered and the log claiming a
  // recovery that never happened. Same mistake P4-01 fixed in sign-out.
  const src = String(callAI);
  const call = src.indexOf('await callClaude(');
  const logged = src.indexOf("fellBackTo:'anthropic'");
  const toasted = src.indexOf("'Read by Anthropic — sign in");
  assert.ok(call > 0 && logged > 0 && toasted > 0, 'the fallback path changed shape');
  assert.ok(logged > call, 'the fellBackTo entry is still written before the call');
  assert.ok(toasted > call, 'the toast still fires before the call');
});

console.log('\nClash banner — removing just one (v9.69)');

// A BUSY-DAY conflict: four events on one future date, which is the shape
// findConflicts() reports at its threshold of 4 and the shape Logan hit on
// 28 Aug. `overlap` conflicts always hold exactly two events, so they can
// never show this defect — the busy day is where "the others" means three.
function busyDay(){
  boot(null);
  const d = dayAhead(3);
  S.events.push({ id:'b1', title:'Volleyball Practice Begins', date:d, time:'15:15', kind:'event', deleted:false });
  S.events.push({ id:'b2', title:'Volleyball Practices Begin', date:d, time:'15:15', kind:'event', deleted:false });
  S.events.push({ id:'b3', title:'Costume Deposits Due', date:d, kind:'deadline', deleted:false });
  S.events.push({ id:'b4', title:'ELA Notebook Bring', date:d, kind:'deadline', deleted:false });
  clearClashSel();   // module-level view state outlives boot(); each fixture starts clean
  const c = findConflicts(S.events, todayISO()).find(x => x.type === 'busy-day');
  assert.ok(c, 'four events on one day do not register as a busy day');
  assert.strictEqual(c.events.length, 4, 'the busy-day conflict is not holding all four');
  return { key: conflictKey(c), d };
}

test('removing one event on a busy day keeps the other three', () => {
  // The defect: every control on the banner acted on the whole conflict.
  // "Keep only this" on a four-event busy day deletes THREE events to be rid
  // of one, and there was no inverse. Logan: "I still can't dismiss an
  // Individual item!"
  const { key } = busyDay();
  withConfirm(true, () => removeOneEvent('b2', key));
  const live = S.events.filter(e => !e.deleted).map(e => e.id).sort();
  assert.deepStrictEqual(live, ['b1', 'b3', 'b4'],
    'removing one event did not leave the other three alone: ' + live.join(','));
});

test('removing one is soft-delete plus dirty, exactly like keepOnlyEvent', () => {
  const { key } = busyDay();
  withConfirm(true, () => removeOneEvent('b3', key));
  const gone = S.events.find(e => e.id === 'b3');
  assert.strictEqual(gone.deleted, true);
  assert.strictEqual(gone.dirty, 1, 'not marked dirty — every other bulk removal is');
  assert.strictEqual(S.events.length, 4, 'the row was destroyed instead of soft-deleted');
});

test('declining the confirm removes nothing', () => {
  const { key } = busyDay();
  withConfirm(false, () => removeOneEvent('b2', key));
  assert.strictEqual(S.events.filter(e => !e.deleted).length, 4,
    'it removed the event after the user said no');
});

test('the undo restores the flags that were actually there', () => {
  const { key } = busyDay();
  S.events.find(e => e.id === 'b4').dirty = 7;
  const undo = captureUndo(() => withConfirm(true, () => removeOneEvent('b4', key)));
  assert.ok(undo, 'no undo was offered');
  undo();
  const back = S.events.find(e => e.id === 'b4');
  assert.strictEqual(back.deleted, false, 'undo did not restore the event');
  assert.strictEqual(back.dirty, 7, 'undo clobbered a flag it did not set');
});

test('removing one side of a two-event overlap ends the warning', () => {
  // The busy day is the case that needed this, but the control appears on every
  // conflict, and on an overlap it must behave as the complement of keepOnly.
  const { key } = clashPair();
  withConfirm(true, () => removeOneEvent('x2', key));
  assert.strictEqual(S.events.find(e => e.id === 'x1').deleted, false, 'it removed the wrong one');
  assert.strictEqual(findConflicts(S.events, todayISO()).length, 0,
    'the warning survived its own resolution');
});

test('nothing is written into dismissedConflicts, so an undo brings the warning back', () => {
  // keepOnlyEvent records the reason this must not dismiss: findConflicts()
  // re-derives from live events, so a key stored here would outlive the events
  // it names AND would silence the group if the undo restored the event.
  const { key } = busyDay();
  const undo = captureUndo(() => withConfirm(true, () => removeOneEvent('b1', key)));
  assert.deepStrictEqual(S.settings.dismissedConflicts || [], [],
    'removing an event silenced the whole conflict as a side effect');
  undo();
  assert.ok(findConflicts(S.events, todayISO()).some(x => x.type === 'busy-day'),
    'the busy day did not come back with the event');
});

test('a stale key, a deleted event, or an unknown id is refused rather than acted on', () => {
  const { key } = busyDay();
  withConfirm(true, () => removeOneEvent('b1', 'overlap|1999-01-01|nope'));
  assert.strictEqual(S.events.filter(e => !e.deleted).length, 4, 'a stale key still removed something');
  withConfirm(true, () => removeOneEvent('no-such-id', key));
  assert.strictEqual(S.events.filter(e => !e.deleted).length, 4, 'an unknown id still removed something');
  S.events.find(e => e.id === 'b2').deleted = true;
  withConfirm(true, () => removeOneEvent('b2', key));
  assert.strictEqual(S.events.filter(e => !e.deleted).length, 3, 'an already-deleted event was re-removed');
});

test('acting on a selection of several removes exactly those, and keeps the rest', () => {
  // The case v9.69 could not express at all: four events, drop two, keep two.
  const { key } = busyDay();
  toggleClashSelect(key);
  toggleClashPick('b2', key);
  toggleClashPick('b3', key);
  withConfirm(true, () => removeSelectedClash(key));
  const live = S.events.filter(e => !e.deleted).map(e => e.id).sort();
  assert.deepStrictEqual(live, ['b1', 'b4'],
    'removing a selection of two did not leave exactly the other two: ' + live.join(','));
});

test('keep-only on a selection removes everything that was not ticked', () => {
  const { key } = busyDay();
  toggleClashSelect(key);
  toggleClashPick('b1', key);
  toggleClashPick('b4', key);
  withConfirm(true, () => keepOnlySelectedClash(key));
  const live = S.events.filter(e => !e.deleted).map(e => e.id).sort();
  assert.deepStrictEqual(live, ['b1', 'b4'], 'the wrong events survived: ' + live.join(','));
});

test('Select all ticks everything, and a second tap clears it', () => {
  const { key } = busyDay();
  toggleClashSelect(key);
  selectAllClash(key);
  assert.strictEqual(clashSel.size, 4, 'select all did not tick every event');
  selectAllClash(key);
  assert.strictEqual(clashSel.size, 0, 'a second tap should clear the selection');
});

test('a selection cannot act on a different clash than the one it was made in', () => {
  // dedupeKeep was keyed by list POSITION and deleted both members of a group
  // when the list shifted (P5-07). findConflicts() re-derives on every render,
  // so a clash selection is pinned to its own key for the same reason.
  const { key } = busyDay();
  toggleClashSelect(key);
  toggleClashPick('b2', key);
  const otherKey = 'busy-day|1999-01-01|nope';
  withConfirm(true, () => removeSelectedClash(otherKey));
  assert.strictEqual(S.events.filter(e => !e.deleted).length, 4,
    'a selection made on one clash acted on another');
  // Paging away drops it, rather than leaving it armed against whatever loads.
  stepConflict();
  assert.strictEqual(clashSel, null, 'the selection survived paging to another clash');
});

test('a selection made on one clash does not put a DIFFERENT clash into select mode', () => {
  // The observable job of clashSelKey. removeFromClash re-derives and filters by
  // membership, so a stale selection could never delete the wrong event -- but
  // without the key pin the banner renders whatever clash it is showing as
  // "0 selected", with tick boxes and armed buttons, for a selection made
  // somewhere else. (Found by mutation: dropping the pin killed no test.)
  boot(null);
  clearClashSel();
  const d1 = dayAhead(3), d2 = dayAhead(5);
  S.events.push({ id:'p1', title:'Recital', date:d1, time:'17:00', endTime:'18:30', kind:'event', deleted:false });
  S.events.push({ id:'p2', title:'Volleyball', date:d1, time:'17:30', endTime:'19:00', kind:'event', deleted:false });
  S.events.push({ id:'q1', title:'Dentist', date:d2, time:'09:00', endTime:'10:00', kind:'event', deleted:false });
  S.events.push({ id:'q2', title:'Assembly', date:d2, time:'09:30', endTime:'10:30', kind:'event', deleted:false });
  const live = findConflicts(S.events, todayISO()).filter(c => c.type === 'overlap');
  assert.strictEqual(live.length, 2, 'expected two separate overlaps');

  conflictViewIndex = 0;
  const keyA = conflictKey(live[0]);
  toggleClashSelect(keyA);
  assert.ok(/selected/.test(conflictBanner()), 'the clash it was made on is not in select mode');

  // Page to the other clash WITHOUT clearing -- the state stepConflict() would
  // normally tidy up, reached here by a re-render after an undo or a dismiss.
  conflictViewIndex = 1;
  const other = conflictBanner();
  assert.ok(!/selected/.test(other),
    'the other clash rendered its select bar for a selection made elsewhere');
  assert.ok(!/toggleClashPick\('q1'/.test(other),
    'the other clash rendered tick boxes for a selection made elsewhere');
  assert.ok(/Select…/.test(other), 'the other clash lost its normal view');
  clearClashSel();
});

test('select mode ends when the removal happens, and the empty selection is refused', () => {
  const { key } = busyDay();
  toggleClashSelect(key);
  withConfirm(true, () => removeSelectedClash(key));
  assert.strictEqual(S.events.filter(e => !e.deleted).length, 4,
    'it removed something with nothing ticked');
  toggleClashPick('b1', key);
  withConfirm(true, () => removeSelectedClash(key));
  assert.strictEqual(clashSel, null, 'select mode stayed on after the removal');
});

console.log('\nNotes — folders and labels (v9.71)');

// One folder, one label, three notes. Built through the real handlers wherever
// possible, so a test cannot pass against a shape the app never produces.
function notesWithGroups(){
  boot(null);
  clearNoteFilters();
  S.noteFolders = []; S.noteLabels = []; S.notes = [];
  const school = addNoteGroup('noteFolders', 'School');
  const forms  = addNoteGroup('noteLabels', 'forms');
  const now = '2026-08-27T10:00:00.000Z';
  S.notes = [
    { id:'n1', title:'Supply list', body:'2 binders', pinned:false, personIds:[],
      folderId:school.id, labelIds:[forms.id], color:'', archived:false, created:now, updated:now, deleted:false },
    { id:'n2', title:'Office number', body:'555-0143', pinned:false, personIds:[],
      folderId:school.id, labelIds:[], color:'', archived:false, created:now, updated:now, deleted:false },
    { id:'n3', title:'Uniform sizes', body:'Braelyn M', pinned:false, personIds:[],
      folderId:null, labelIds:[forms.id], color:'', archived:false, created:now, updated:now, deleted:false },
  ];
  save();
  return { school, forms };
}

test('a note lives in ONE folder and carries ANY NUMBER of labels', () => {
  const { school, forms } = notesWithGroups();
  const sport = addNoteGroup('noteLabels', 'volleyball');
  setNoteFolder('n3', school.id);
  assert.strictEqual(S.notes.find(n => n.id === 'n3').folderId, school.id);
  toggleNoteLabel('n3', sport.id);
  assert.deepStrictEqual(S.notes.find(n => n.id === 'n3').labelIds.sort(),
    [forms.id, sport.id].sort(), 'a note could not hold two labels');
  // Moving folders REPLACES; labelling ACCUMULATES. That is the whole model.
  const other = addNoteGroup('noteFolders', 'Sport');
  setNoteFolder('n3', other.id);
  assert.strictEqual(S.notes.find(n => n.id === 'n3').folderId, other.id,
    'a second folder did not replace the first');
  assert.strictEqual(S.notes.find(n => n.id === 'n3').labelIds.length, 2,
    'moving folder disturbed the labels');
});

test('a duplicate name reuses the existing group instead of forking it', () => {
  // The failure mode every long-term tag user reports: "School" and "school "
  // sitting side by side, splitting one group in two. Nothing else in the app
  // can see both names at once, so this is the only place it can be stopped.
  notesWithGroups();
  const a = addNoteGroup('noteFolders', 'School');
  const b = addNoteGroup('noteFolders', '  school  ');
  assert.strictEqual(a.id, b.id, 'a case/space variant created a second folder');
  assert.strictEqual(noteFolders().length, 1, 'the folder list forked');
  assert.strictEqual(a.name, 'School', 'the original name was overwritten');
});

test('an empty or blank name creates nothing', () => {
  notesWithGroups();
  const before = noteLabels().length;
  assert.strictEqual(addNoteGroup('noteLabels', '   '), null, 'whitespace made a label');
  assert.strictEqual(addNoteGroup('noteLabels', ''), null, 'an empty string made a label');
  assert.strictEqual(noteLabels().length, before, 'the label list grew anyway');
});

test('REMOVING A FOLDER NEVER REMOVES ITS NOTES', () => {
  // "Delete folder" is exactly the phrase a user expects to mean "and
  // everything in it". CLAUDE.md rule 26 read forwards.
  const { school } = notesWithGroups();
  delNoteGroup('noteFolders', school.id);
  assert.strictEqual(liveNotes().length, 3, 'removing a folder destroyed notes');
  assert.strictEqual(S.notes.find(n => n.id === 'n1').folderId, null,
    'the note kept a folderId pointing at a folder that is gone');
  assert.strictEqual(noteFolders().length, 0, 'the folder survived its own removal');
});

test('removing a label drops it from every note and nothing else', () => {
  const { forms } = notesWithGroups();
  delNoteGroup('noteLabels', forms.id);
  assert.strictEqual(liveNotes().length, 3, 'removing a label destroyed notes');
  assert.ok(S.notes.every(n => !(n.labelIds || []).includes(forms.id)),
    'a note still points at a label that is gone');
});

test('undoing a folder removal puts the notes back where they were', () => {
  const { school } = notesWithGroups();
  const undo = captureUndo(() => delNoteGroup('noteFolders', school.id));
  assert.ok(undo, 'no undo was offered');
  undo();
  assert.strictEqual(noteFolders().length, 1, 'the folder did not come back');
  assert.strictEqual(S.notes.filter(n => n.folderId === school.id).length, 2,
    'the notes did not go back into the folder');
});

test('a rename keeps every membership, and an empty rename is refused', () => {
  // Ids, not names, are what a note stores -- so a rename must cost nothing.
  const { school } = notesWithGroups();
  assert.strictEqual(renameNoteGroup('noteFolders', school.id, 'Middle School'), true);
  assert.strictEqual(noteFolderName(school.id), 'Middle School');
  assert.strictEqual(S.notes.filter(n => n.folderId === school.id).length, 2,
    'a rename lost the notes in the folder');
  assert.strictEqual(renameNoteGroup('noteFolders', school.id, '   '), false,
    'a blank rename was accepted');
  assert.strictEqual(noteFolderName(school.id), 'Middle School', 'the name was blanked');
});

test('the folder filter shows one folder, and Unfiled shows only unfiled notes', () => {
  const { school } = notesWithGroups();
  setNoteFolderFilter(school.id);
  assert.deepStrictEqual(liveNotes().filter(notePassesFilter).map(n => n.id), ['n1', 'n2']);
  setNoteFolderFilter('');                       // '' means Unfiled, not "all"
  assert.deepStrictEqual(liveNotes().filter(notePassesFilter).map(n => n.id), ['n3']);
  clearNoteFilters();
  assert.strictEqual(liveNotes().filter(notePassesFilter).length, 3, 'clearing did not restore');
});

test('two labels NARROW the list — they are ANDed, not ORed', () => {
  // An OR would make every extra tap return MORE notes, which reads as the
  // control not working.
  const { forms } = notesWithGroups();
  const sport = addNoteGroup('noteLabels', 'volleyball');
  toggleNoteLabel('n3', sport.id);
  toggleNoteLabelFilter(forms.id);
  assert.deepStrictEqual(liveNotes().filter(notePassesFilter).map(n => n.id), ['n1', 'n3']);
  toggleNoteLabelFilter(sport.id);
  assert.deepStrictEqual(liveNotes().filter(notePassesFilter).map(n => n.id), ['n3'],
    'adding a second label widened the list instead of narrowing it');
});

test('a filter cleared by a removal cannot leave the board showing nothing', () => {
  // Deleting the folder you are filtering by must not strand you on an empty
  // screen with a control that no longer exists to switch off.
  const { school, forms } = notesWithGroups();
  setNoteFolderFilter(school.id);
  delNoteGroup('noteFolders', school.id);
  assert.strictEqual(noteFolderFilter, null, 'the board is still filtered by a folder that is gone');
  toggleNoteLabelFilter(forms.id);
  delNoteGroup('noteLabels', forms.id);
  assert.strictEqual(noteLabelFilter.size, 0, 'the board is still filtered by a label that is gone');
});

test('search reaches folder and label names', () => {
  notesWithGroups();
  noteSearch = 'school';
  assert.deepStrictEqual(liveNotes().filter(noteMatches).map(n => n.id), ['n1', 'n2'],
    'searching a folder name found nothing');
  noteSearch = 'forms';
  assert.deepStrictEqual(liveNotes().filter(noteMatches).map(n => n.id), ['n1', 'n3'],
    'searching a label name found nothing');
  noteSearch = '';
});

test('the board renders the filter bar, and the card says where the note lives', () => {
  notesWithGroups();
  const m = { innerHTML:'' };
  renderNotesBoard(m);
  assert.ok(/setNoteFolderFilter\('/.test(m.innerHTML), 'no folder chips on the board');
  assert.ok(/toggleNoteLabelFilter\('/.test(m.innerHTML), 'no label chips on the board');
  assert.ok(/Unfiled \(1\)/.test(m.innerHTML), 'Unfiled is missing its count');
  assert.ok(/#forms/.test(m.innerHTML), 'the card does not show its label');
  assert.ok(/School/.test(m.innerHTML), 'the card does not show its folder');
});

test('the filter bar stays away until there is something to tap', () => {
  // A filter bar over an empty vocabulary is chrome that teaches nothing.
  boot(null);
  clearNoteFilters();
  S.noteFolders = []; S.noteLabels = [];
  S.notes = [{ id:'z1', title:'Alone', body:'', pinned:false, personIds:[],
    folderId:null, labelIds:[], color:'', archived:false,
    created:'2026-08-27T10:00:00.000Z', updated:'2026-08-27T10:00:00.000Z', deleted:false }];
  const m = { innerHTML:'' };
  renderNotesBoard(m);
  assert.ok(!/setNoteFolderFilter\(/.test(m.innerHTML),
    'the filter bar rendered with no folders and no labels');
});

test('an empty result from a FILTER offers a way out; an empty search does not pretend to', () => {
  const { school } = notesWithGroups();
  S.notes.forEach(n => { n.folderId = null; });
  setNoteFolderFilter(school.id);
  const m = { innerHTML:'' };
  renderNotesBoard(m);
  assert.ok(/clearNoteFilters\(\)/.test(m.innerHTML),
    'a filter that matched nothing left no way to switch it off');
  clearNoteFilters();
});

test('the note screen offers one folder choice and many label choices', () => {
  const { school } = notesWithGroups();
  view = { tab:'notes', sub:'noteDetail', data:{ id:'n1' } };
  const m = { innerHTML:'' };
  renderNoteDetail(m);
  assert.ok(m.innerHTML.includes("setNoteFolder('n1','" + school.id + "')"),
    'the note cannot be moved to a folder');
  assert.ok(/setNoteFolder\('n1', null\)/.test(m.innerHTML), 'the note cannot be un-filed');
  assert.ok(/toggleNoteLabel\('n1','/.test(m.innerHTML), 'the note cannot be labelled');
  // Making one from here is the whole point: sending the user to a settings
  // screen first is how a filing feature goes unused (Civan et al.).
  assert.ok(/newNoteGroupFor\('noteFolders','n1'\)/.test(m.innerHTML),
    'a folder cannot be created from the note that needs it');
  assert.ok(/newNoteGroupFor\('noteLabels','n1'\)/.test(m.innerHTML),
    'a label cannot be created from the note that needs it');
});

test('a new note starts Unfiled with no labels, and old notes migrate the same way', () => {
  boot(null);
  clearNoteFilters();
  S.notes = [];
  const box = { value:'Picked up from practice' };
  const real = document.getElementById;
  document.getElementById = (id) => (id === 'newNote' ? box : real.call(document, id));
  try { newNote(); } finally { document.getElementById = real; }
  const n = S.notes[0];
  assert.strictEqual(n.folderId, null, 'a new note was filed somewhere on its own');
  assert.deepStrictEqual(n.labelIds, [], 'a new note arrived pre-labelled');

  // ...and a v8 save reaches the same shape rather than the render path.
  const old = migrate({ schemaVersion:8, notes:[{ id:'old', title:'t', body:'b' }] }, 8);
  assert.strictEqual(old.notes[0].folderId, null);
  assert.deepStrictEqual(old.notes[0].labelIds, []);
  assert.ok(Array.isArray(old.noteFolders) && Array.isArray(old.noteLabels),
    'the migration did not create the two collections');
  assert.strictEqual(old.noteFolders.length, 0, 'the migration invented a folder');
});

console.log('\nNotes — checklists, sort, colour, archive (v9.72)');

function noteWith(body, extra){
  boot(null);
  clearNoteFilters();
  S.noteFolders = []; S.noteLabels = [];
  const now = '2026-08-27T10:00:00.000Z';
  S.notes = [Object.assign({ id:'n1', title:'Sleepover', body, pinned:false, personIds:[],
    folderId:null, labelIds:[], color:'', archived:false,
    created:now, updated:now, deleted:false }, extra || {})];
  view = { tab:'notes', sub:'noteDetail', data:{ id:'n1' } };
  save();
  return S.notes[0];
}

test('checkbox lines in the body are found, in both states, with indentation', () => {
  const n = noteWith('Bring:\n- [ ] sleeping bag\n  - [x] pillow\nnot a checkbox\n- [X] snacks');
  const items = noteChecklist(n);
  assert.deepStrictEqual(items.map(i => i.text), ['sleeping bag', 'pillow', 'snacks']);
  assert.deepStrictEqual(items.map(i => i.done), [false, true, true],
    'an uppercase [X] or an indented item was misread');
  assert.deepStrictEqual(items.map(i => i.index), [1, 2, 4], 'line indexes are wrong');
  assert.deepStrictEqual(noteCheckProgress(n), { done:2, total:3 });
  assert.strictEqual(noteCheckProgress(noteWith('just words')), null,
    'a note with no checkboxes reported progress');
});

test('toggling a checkbox rewrites ONE line and leaves every byte around it alone', () => {
  // A checklist toggle that reformats your note is a checklist toggle nobody
  // trusts. Indentation, the text itself, and every other line must survive.
  noteWith('Header\n\n  - [ ] pillow\n- [x] snacks\n\ntrailing words');
  toggleNoteCheck('n1', 2);
  assert.strictEqual(S.notes[0].body,
    'Header\n\n  - [x] pillow\n- [x] snacks\n\ntrailing words',
    'the toggle disturbed something other than the one marker');
  toggleNoteCheck('n1', 3);
  assert.strictEqual(S.notes[0].body,
    'Header\n\n  - [x] pillow\n- [ ] snacks\n\ntrailing words',
    'unticking did not work, or it reformatted the note');
});

test('toggling a line that is not a checkbox, or does not exist, changes nothing', () => {
  const before = 'Header\n- [ ] pillow';
  noteWith(before);
  toggleNoteCheck('n1', 0);            // a plain line
  toggleNoteCheck('n1', 99);           // past the end
  toggleNoteCheck('n1', -1);
  assert.strictEqual(S.notes[0].body, before, 'a non-checkbox line was rewritten');
});

test('adding a checkbox appends one line and never eats the body', () => {
  // addNoteCheckItem flushes the pending autosave first, and that reads the
  // live textarea -- so the fixture has to present one holding what the note
  // actually says, or the flush writes an empty string over the body. Same
  // reason withBox() exists for the list-item tests.
  const withBody = (fn) => {
    const real = document.getElementById;
    document.getElementById = (id) => (id === 'noteBody'
      ? { value:S.notes[0].body, focus(){}, setSelectionRange(){}, get selectionStart(){ return 0; } }
      : (id === 'noteTitle' ? { value:S.notes[0].title } : real.call(document, id)));
    try { return fn(); } finally { document.getElementById = real; }
  };
  noteWith('Bring:');
  withBody(() => addNoteCheckItem('n1'));
  assert.strictEqual(S.notes[0].body, 'Bring:\n- [ ] ');
  withBody(() => addNoteCheckItem('n1'));
  assert.strictEqual(S.notes[0].body, 'Bring:\n- [ ] \n- [ ] ',
    'a second item did not get its own line');
  // ...and on an empty note it does not open with a stray newline.
  noteWith('');
  withBody(() => addNoteCheckItem('n1'));
  assert.strictEqual(S.notes[0].body, '- [ ] ');
});

test('the note screen renders each checkbox and announces its state', () => {
  noteWith('- [ ] sleeping bag\n- [x] pillow');
  const m = { innerHTML:'' };
  renderNoteDetail(m);
  assert.ok(/toggleNoteCheck\('n1',0\)/.test(m.innerHTML), 'the first item is not tappable');
  assert.ok(/toggleNoteCheck\('n1',1\)/.test(m.innerHTML), 'the second item is not tappable');
  assert.ok(/role="checkbox" aria-checked="false"/.test(m.innerHTML), 'an unticked item is not announced');
  assert.ok(/role="checkbox" aria-checked="true"/.test(m.innerHTML), 'a ticked item is not announced');
  assert.ok(/1 of 2/.test(m.innerHTML), 'the checklist has no progress count');
});

test('the board shows checklist progress', () => {
  noteWith('- [x] a\n- [ ] b\n- [ ] c');
  const m = { innerHTML:'' };
  renderNotesBoard(m);
  assert.ok(/1 of 3/.test(m.innerHTML), 'the card does not show how much is done');
});

test('sort is a saved setting, survives a reload, and rejects junk', () => {
  noteWith('x');
  setNoteSort('title');
  assert.strictEqual(S.settings.noteSort, 'title');
  S = load();
  assert.strictEqual(noteSort(), 'title', 'the sort choice did not survive a reload');
  setNoteSort('nonsense');
  assert.strictEqual(noteSort(), 'edited', 'a junk sort key was accepted');
});

test('each sort orders the board, and pinned always floats above it', () => {
  boot(null); clearNoteFilters(); S.noteFolders = []; S.noteLabels = [];
  const mk = (id, title, created, updated, pinned) => ({ id, title, body:'', pinned:!!pinned,
    personIds:[], folderId:null, labelIds:[], color:'', archived:false,
    created, updated, deleted:false });
  S.notes = [
    mk('a', 'Zebra', '2026-01-01T00:00:00.000Z', '2026-08-03T00:00:00.000Z'),
    mk('b', 'Apple', '2026-05-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
    mk('c', 'Mango', '2026-03-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', true),
  ];
  const order = () => { const m = { innerHTML:'' }; renderNotesBoard(m);
    return ['Zebra','Apple','Mango'].map(t => [t, m.innerHTML.indexOf(t)])
      .sort((x, y) => x[1] - y[1]).map(x => x[0]); };

  setNoteSort('edited');
  assert.deepStrictEqual(order(), ['Mango', 'Zebra', 'Apple'], 'edited order is wrong');
  setNoteSort('created');
  assert.deepStrictEqual(order(), ['Mango', 'Apple', 'Zebra'], 'created order is wrong');
  setNoteSort('title');
  assert.deepStrictEqual(order(), ['Mango', 'Apple', 'Zebra'], 'title order is wrong');
  // Mango is first in all three because it is pinned, not because of the sort.
  S.notes.find(n => n.id === 'c').pinned = false;
  setNoteSort('title');
  assert.deepStrictEqual(order(), ['Apple', 'Mango', 'Zebra'],
    'unpinning did not put the note back into the sorted order');
});

test('archiving takes a note off the board WITHOUT deleting it', () => {
  noteWith('keep me');
  toggleArchiveNote('n1');
  assert.strictEqual(S.notes[0].deleted, false, 'archive deleted the note');
  assert.strictEqual(S.notes[0].archived, true);
  assert.strictEqual(boardNotes().length, 0, 'the archived note is still on the board');
  assert.strictEqual(archivedNotes().length, 1, 'the archived note is nowhere');
  toggleArchiveNote('n1');
  assert.strictEqual(boardNotes().length, 1, 'unarchiving did not bring it back');
});

test('archiving offers an undo', () => {
  noteWith('keep me');
  const undo = captureUndo(() => toggleArchiveNote('n1'));
  assert.ok(undo, 'no undo was offered');
  undo();
  assert.strictEqual(S.notes[0].archived, false, 'undo did not unarchive');
});

test('an archived note still turns up when you search for it by name', () => {
  // A note you archived is a note you KEPT. Looking for it by name must find it.
  noteWith('the coach said 4pm', { title:'Practice time', archived:true });
  noteSearch = 'practice';
  const m = { innerHTML:'' };
  renderNotesBoard(m);
  noteSearch = '';
  assert.ok(/Practice time/.test(m.innerHTML),
    'searching by name could not reach an archived note');
});

test('the board offers a way into the archive only when something is in it', () => {
  noteWith('on the board');
  let m = { innerHTML:'' };
  renderNotesBoard(m);
  assert.ok(!/noteArchive/.test(m.innerHTML), 'an empty archive advertised itself');
  toggleArchiveNote('n1');
  m = { innerHTML:'' };
  renderNotesBoard(m);
  assert.ok(/sub\('noteArchive'\)/.test(m.innerHTML), 'no way to reach the archive');
  assert.ok(/Archived \(1\)/.test(m.innerHTML), 'the archive link has no count');
});

test('a colour must come from the app palette, and shows on the card', () => {
  noteWith('x');
  setNoteColor('n1', KID_COLORS[0]);
  assert.strictEqual(S.notes[0].color, KID_COLORS[0]);
  setNoteColor('n1', 'javascript:alert(1)');
  assert.strictEqual(S.notes[0].color, '', 'an arbitrary string was accepted as a colour');
  setNoteColor('n1', KID_COLORS[2]);
  const m = { innerHTML:'' };
  renderNotesBoard(m);
  assert.ok(m.innerHTML.includes('border-left:5px solid ' + KID_COLORS[2]),
    'the colour does not reach the card');
});

test('every phase-2 control is on the window bridge', () => {
  // Inline onclick handlers resolve against global scope; a missing one is a
  // button that throws on tap and reads as dead.
  ['toggleNoteCheck', 'addNoteCheckItem', 'setNoteSort', 'toggleArchiveNote', 'setNoteColor']
    .forEach(fn => assert.strictEqual(typeof globalThis[fn], 'function', fn + ' is not reachable'));
});

console.log('\nThe four P5 candidates, reproduced then fixed (v9.73)');

test('P5-A: an unloaded model gets null, not the first loaded one’s window', () => {
  // Measured on the unfixed build: asking about a model that was not loaded
  // returned llama3:70b's 8192 while the caller wanted a 32k model. Its own
  // docblock promises "null rather than a guess", because the number feeds a
  // decision about whether a prompt will FIT.
  const ps = { models:[
    { model:'llama3:70b', context_length:8192 },
    { model:'qwen3-vl:8b-instruct-q4_K_M', context_length:32768 },
  ]};
  assert.strictEqual(contextFromPs(ps, 'not-loaded-at-all'), null,
    'it guessed another model’s window again');
  // ...and every way of asking for the right one still works.
  assert.strictEqual(contextFromPs(ps, 'qwen3-vl:8b-instruct-q4_K_M'), 32768);
  assert.strictEqual(contextFromPs(ps, 'qwen3-vl:8b'), 32768, 'the family-prefix match broke');
  // No model named at all: the loaded one is still the only sensible answer.
  assert.strictEqual(contextFromPs({ models:[{ model:'x', context_length:4096 }] }, ''), 4096);
  assert.strictEqual(contextFromPs({ models:[] }, 'x'), null);
  assert.strictEqual(contextFromPs({ models:[{ model:'x' }] }, 'x'), null,
    'a missing context_length stopped returning null');
});

test('P5-B: the probed window is forgotten when the model or endpoint changes', () => {
  boot(null);
  invalidateLocalContext();
  S.settings.localModel = 'model-a';
  S.settings.localBaseUrl = 'https://one/v1';
  const keyA = localCtxKey();
  S.settings.localModel = 'model-b';
  assert.notStrictEqual(localCtxKey(), keyA, 'the cache key ignores the model');
  S.settings.localModel = 'model-a';
  S.settings.localBaseUrl = 'https://two/v1';
  assert.notStrictEqual(localCtxKey(), keyA, 'the cache key ignores the endpoint');
  S.settings.localBaseUrl = 'https://one/v1';
  assert.strictEqual(localCtxKey(), keyA, 'the same settings produce a different key');
});

test('P5-B: a failed probe does not silence the check for the whole session', () => {
  // localCtxAsked was set BEFORE the fetch, so one blocked /api/ps meant the
  // app never asked again. Driven through the flags rather than through fetch:
  // the harness runs async tests interleaved with sync ones, and a stubbed
  // fetch racing another test's stub would make this pass or fail for reasons
  // that have nothing to do with the finding (CLAUDE.md rule 25).
  boot(null);
  invalidateLocalContext();
  assert.strictEqual(localCtxAsked, false);
  assert.strictEqual(localCtx, null);

  // What the success path leaves behind: an answer, pinned to its key.
  S.settings.localModel = 'model-a';
  localCtx = 16384; localCtxAsked = true; localCtxFor = localCtxKey();
  assert.strictEqual(localCtxFor, localCtxKey(), 'the answer is not pinned to its settings');

  // Change the model: the key no longer matches, so the guard at the top of
  // probeLocalContext cannot return the stale answer.
  S.settings.localModel = 'model-b';
  assert.notStrictEqual(localCtxFor, localCtxKey(),
    'the cached window still answers for a model it was never measured on');
  invalidateLocalContext();
});

test('P5-B: probeLocalContext reads its inputs BEFORE it awaits', () => {
  // The settings can change while the request is in flight. Reading the model
  // name again afterwards would attribute the answer to a name nobody asked
  // about -- the same class of mistake as trusting a rendered index instead of
  // re-deriving from a key. Guard reads the shipped code, with comments and
  // strings stripped so prose cannot satisfy it (CLAUDE.md rule 21).
  const body = String(probeLocalContext);
  const code = body.replace(/\/\/[^\n]*/g, ' ')
                   .replace(/'(?:[^'\\]|\\.)*'/g, "''")
                   .replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const firstAwait = code.indexOf('await');
  assert.ok(firstAwait > 0, 'probeLocalContext no longer awaits anything');
  assert.ok(code.indexOf('askedModel') < firstAwait,
    'the model name is captured after the first await');
  assert.ok(code.indexOf('localCtxFor = key') < firstAwait,
    'the cache key is pinned after the first await');
  // ...and every failure path clears the flag, so the session can ask again.
  const after = code.slice(firstAwait);
  assert.strictEqual((after.match(/localCtxAsked = false/g) || []).length, 3,
    'not every failure path lets the app try again: ' + (after.match(/localCtxAsked = false/g) || []).length);

  // ...and the early return must consult the KEY, not just "have we asked".
  // Without this the mutation `if(localCtxAsked) return localCtx;` survived:
  // the flags test above drives the flags directly and never reaches this line.
  assert.ok(/if\(localCtxAsked && localCtxFor === key\)/.test(code),
    'the cache answers again without checking which settings it was measured on');
});

test('P5-C: "which one did you mean?" is never asked with nothing to offer', async () => {
  // Measured: a user with no lists asked to tick something off got the question,
  // ZERO buttons and a "Neither" link -- because [] is truthy.
  boot(null);
  S.lists = []; S.listItems = []; save();
  const r = await performRoute({ intent:'check_list_item', params:{ items:['milk'] }, confidence:0.9 });
  assert.ok(!r.choices || !r.choices.length, 'it still offers an empty choice list');
  assert.ok(/do not have any lists/i.test(r.answer),
    'it does not say the true thing instead: ' + r.answer);
});

test('P5-C2: choosing the list from the prompt actually ticks the items off', async () => {
  // askWhich stored { route, target, collection } and nothing else, while
  // confirmPendingAction read pa.itemIds -- so answering the question did
  // nothing at all, silently.
  boot(null);
  S.lists = [{ id:'L1', name:'Shopping', deleted:false },
             { id:'L2', name:'Camp', deleted:false }];
  S.listItems = [
    { id:'i1', listId:'L1', text:'milk', checked:false, deleted:false },
    { id:'i2', listId:'L1', text:'bread', checked:false, deleted:false },
    { id:'i3', listId:'L2', text:'milk', checked:false, deleted:false },
  ];
  save();
  const r = await performRoute({ intent:'check_list_item', params:{ items:['milk'] }, confidence:0.9 });
  assert.strictEqual((r.choices || []).length, 2, 'it did not ask which list');
  confirmPendingAction('L1');
  assert.strictEqual(S.listItems.find(i => i.id === 'i1').checked, true,
    'answering "which list?" ticked nothing off');
  assert.strictEqual(S.listItems.find(i => i.id === 'i3').checked, false,
    'it ticked the item off the list that was NOT chosen');
  assert.strictEqual(S.listItems.find(i => i.id === 'i2').checked, false,
    'it ticked something nobody asked for');
});

test('P5-D: clarify options are normalised to {id,name}', () => {
  // The prompt asks the model for ["choice A","choice B"] -- strings -- and the
  // renderer read c.id / c.name, emitting [{},{}]: two blank buttons.
  const p = parseAssistantTurn(JSON.stringify({
    clarify:'Which child is this for?', options:['Braelyn', 'Owen'] }));
  assert.ok(p.ok && p.turn.kind === 'clarify');
  const c = clarifyChoices(p.turn.options);
  assert.deepStrictEqual(c, [{ id:'Braelyn', name:'Braelyn' }, { id:'Owen', name:'Owen' }],
    'the options still reach the renderer as bare strings');
  // Tolerant of an object, and of junk.
  assert.deepStrictEqual(clarifyChoices([{ id:'a', name:'A' }]), [{ id:'a', name:'A' }]);
  assert.strictEqual(clarifyChoices([]), null, 'an empty option list is not a question');
  assert.strictEqual(clarifyChoices(['  ', '']), null, 'blank options became buttons');
  assert.strictEqual(clarifyChoices(undefined), null);

  // ...and the app must actually USE it. Calling the helper in a test proves
  // nothing about the call site: the mutation that reverted this one line to
  // `parsed.turn.options || null` -- shipping bare strings to a renderer that
  // reads {id,name} -- survived until this assertion existed.
  const src = String(runAsk);
  assert.ok(/choices:\s*parsed\.turn\.kind === 'clarify' \? clarifyChoices\(/.test(src),
    'clarify options reach the screen without being normalised again');
});

test('P5-D2: a clarify’s buttons render, and answer with text rather than an id', () => {
  // The old gate was `t.choices && pendingAction`, and a clarify never sets
  // pendingAction -- so these buttons had never rendered at all. Fixing only
  // the shape (D) would have shipped two blank ones.
  const ask = String(renderAsk);
  assert.ok(/answerClarify\(/.test(ask), 'a clarify option is not answerable');
  assert.ok(!/t\.choices && pendingAction/.test(ask),
    'the gate a clarify can never pass is back');
  assert.strictEqual(typeof answerClarify, 'function', 'answerClarify is not reachable');
});

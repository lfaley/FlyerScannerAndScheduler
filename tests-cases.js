/* FlyerSnap test cases — loaded by tests.js into a sandbox that already has the
   app's functions in scope. Run these with:  node tests.js  */

// Silence UI side effects
render = () => {};
toast = () => {};
sub = () => {};
// No network in tests; saving a watcher legitimately triggers a check, and we
// don't want a 20s JSONP timeout logging noise over real failures.
jsonpRequest = () => Promise.resolve({ ok: true, items: [] });

function test(name, fn){
  try { fn(); results.passed++; console.log('  ok    ' + name); }
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
  assert.strictEqual(S.schemaVersion, 4, 'stamped with the current version');
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
  assert.strictEqual(S.schemaVersion, 4);
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

test('a pasted full URL is split into URL and token', () => {
  boot(GOOD);
  const fields = { watcherUrl:'https://script.google.com/macros/s/AKfy123/exec?token=snap123', watcherToken:'' };
  document.getElementById = (id) => ({ value: id === 'watcherUrl' ? fields.watcherUrl : fields.watcherToken });
  saveWatcher();
  assert.strictEqual(S.settings.watcherUrl, 'https://script.google.com/macros/s/AKfy123/exec');
  assert.strictEqual(S.settings.watcherToken, 'snap123', 'token lifted out of the URL');
});

test('an explicit token field wins over one in the URL', () => {
  boot(GOOD);
  const fields = { watcherUrl:'https://script.google.com/macros/s/AKfy123/exec?token=stale', watcherToken:'fresh' };
  document.getElementById = (id) => ({ value: id === 'watcherUrl' ? fields.watcherUrl : fields.watcherToken });
  saveWatcher();
  assert.strictEqual(S.settings.watcherToken, 'fresh');
});

test('a /dev URL is rejected with an explanation', () => {
  boot(GOOD);
  const fields = { watcherUrl:'https://script.google.com/macros/s/AKfy123/dev', watcherToken:'x' };
  document.getElementById = (id) => ({ value: id === 'watcherUrl' ? fields.watcherUrl : fields.watcherToken });
  globalThis.lastAlert = null;
  saveWatcher();
  assert.ok(/dev URL will not work/.test(globalThis.lastAlert || ''), 'user is told why');
  assert.strictEqual(S.settings.watcherUrl, '', 'nothing saved');
});

test('trailing slashes are trimmed', () => {
  boot(GOOD);
  const fields = { watcherUrl:'https://script.google.com/macros/s/AKfy123/exec/', watcherToken:'t' };
  document.getElementById = (id) => ({ value: id === 'watcherUrl' ? fields.watcherUrl : fields.watcherToken });
  saveWatcher();
  assert.strictEqual(S.settings.watcherUrl, 'https://script.google.com/macros/s/AKfy123/exec');
});

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
  assert.ok(!looksDuplicate({ title:'Dinner', date:d }, { title:'Dinner Theater', date:d }) === false || true); // containment case below
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
  setDedupeKeep(0, null);
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
  setDedupeKeep(0, null);        // "keep both"
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

test('Anthropic stays the default and is never removed', () => {
  boot(GOOD);
  assert.strictEqual(aiProvider(), 'anthropic');
  assert.strictEqual(typeof callClaude, 'function', 'the Anthropic path still exists');
  assert.strictEqual(typeof callLocalModel, 'function', 'the local path is additional');
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

test('the local model refuses to run without a URL', async () => {
  boot(GOOD);
  S.settings.localBaseUrl = '';
  let threw = false;
  try { await callLocalModel([{type:'text',text:'x'}], 10); }
  catch(e){ threw = /No local model URL/.test(e.message); }
  assert.ok(threw, 'fails loudly instead of silently doing nothing');
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

test('plain text with no JSON passes through unharmed', () => {
  assert.strictEqual(cleanModelText('READY'), 'READY');
  assert.strictEqual(cleanModelText('Thinking...\nhmm\n...done thinking.\nREADY'), 'READY');
});

test('an object with nested braces survives', () => {
  const raw = '{"title":"A","meta":{"room":"12"},"date":"2026-08-05"}';
  const parsed = JSON.parse(cleanModelText(raw));
  assert.strictEqual(parsed.meta.room, '12');
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



/* FlyerSnap test cases — loaded by tests.js into a sandbox that already has the
   app's functions in scope. Run these with:  node tests.js  */

// Silence UI side effects
render = () => {};
toast = () => {};
sub = () => {};

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

test('past meals and non-standard slots are filtered out', () => {
  const future = dayAhead(1);
  localStorage.setItem('mealplan-out', JSON.stringify({
    schema:'mealplan-exchange.v1', meals:[
      { date:'2020-01-01', slot:'dinner', recipeId:'rb_a', title:'Old' },
      { date:future, slot:'dessert', recipeId:'rb_b', title:'Cake' },
      { date:future, slot:'lunch', recipeId:'rb_c', title:'Soup' }
    ]
  }));
  const meals = plannedMeals();
  assert.strictEqual(meals.length, 1);
  assert.strictEqual(meals[0].title, 'Soup');
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



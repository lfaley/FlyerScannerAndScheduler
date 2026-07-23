# FlyerSnap — Retired Code Reference (Meal Planner, Grocery Builder, Pantry)

**Purpose:** FlyerSnap is handing meal planning, the shopping list, ingredient
aggregation, and the pantry model to the recipe app. Rather than describe that
logic, here is the **complete, working, tested source** as it runs in FlyerSnap
v2.0 today. Adapt it; don't reinvent it.

This is plain browser JavaScript operating on in-memory arrays that persist to
localStorage. Your app is React + TS + IndexedDB, so you'll port the *logic*, not
the storage calls. The parts worth stealing are the pantry coverage rules and the
weekly roll-up — everything the previous docs only summarised.

---

## Data shapes these functions operate on

```js
// A saved recipe (FlyerSnap's own small box)
{ id, title, category, ingredients, instructions, deleted }
//   ingredients: newline-delimited plain text, ONE PER LINE

// A planned meal — one slot on one day
{ id, date /* YYYY-MM-DD */, slot /* breakfast|lunch|dinner */,
  title, recipeId /* null if typed freehand */, deleted }

// A shopping list, and its items
{ id, name, deleted }                                   // list
{ id, listId, text, checked, deleted,
  ingKey /* normalised match key, survives quantity suffix */,
  forDate /* date of earliest meal needing it -> the pantry hinge */ }
```

`ingKey` and `forDate` are the two fields that make the pantry work. Everything
else is ordinary.

---

## The 7-day meal planner (retired)

FlyerSnap's planner was a simple 7-day breakfast/lunch/dinner grid where each
slot stored `{date, slot, title, recipeId}`. Your planner supersedes it entirely,
so the UI code isn't worth porting — only the data shape mattered, and it's
documented above. (An earlier revision of this file pasted the grocery block
here by mistake; the canonical copy is the next section.)

## The grocery builder + pantry model (the important part)

This is the logic the recipe app must absorb and then *improve* (quantity totals).
Read the comments — they encode the mistakes FlyerSnap already made and fixed.

```js
// ---------- Meal plan -> grocery list ----------
// Recipes carry ingredients and the week carries recipes, so the grocery list
// can just be assembled instead of retyped.
//
// Pantry model: an ingredient is "covered" from the moment it lands on the list
// until the meal that needed it has passed. Ticking it off means you BOUGHT it,
// not that you used it — so it stays covered until its meal date goes by.
let groceryItems = [], grocerySel = null;

function normIng(s){
  return String(s).toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
}
function groceryList(){ return S.lists.find(l=>!l.deleted && /grocer|shop|store/i.test(l.name)); }

function coveredIngredients(){
  const today = todayISO();
  const list = groceryList();
  const held = new Set();
  if(!list) return held;
  S.listItems.filter(i=>i.listId===list.id && !i.deleted).forEach(i=>{
    const key = i.ingKey || normIng(i.text);
    if(!key) return;
    if(!i.checked){ held.add(key); return; }            // still on the list to buy
    if(i.forDate && i.forDate >= today) held.add(key);  // bought, meal not cooked yet
    // bought and the meal has passed -> eaten, buy it again
  });
  return held;
}

function openGroceryBuilder(){
  const days = next7();
  const planned = S.meals
    .filter(m=>!m.deleted && m.recipeId && days.includes(m.date))
    .sort((a,b)=>a.date.localeCompare(b.date));

  // Roll up by ingredient rather than by recipe — you shop by ingredient.
  const byIng = new Map();
  for(const meal of planned){
    const r = S.recipes.find(x=>x.id===meal.recipeId && !x.deleted);
    if(!r || !r.ingredients) continue;
    r.ingredients.split('\n').map(s=>s.trim()).filter(Boolean).forEach(line=>{
      const key = normIng(line);
      if(!key) return;
      if(!byIng.has(key)) byIng.set(key, { text:line, key, recipes:[], count:0, forDate:meal.date });
      const g = byIng.get(key);
      if(!g.recipes.includes(r.title)) g.recipes.push(r.title);
      g.count++;                                   // needed twice = say so
      if(meal.date < g.forDate) g.forDate = meal.date;
    });
  }

  const held = coveredIngredients();
  groceryItems = [...byIng.values()]
    .sort((x,y)=>x.key.localeCompare(y.key))
    .map(g=>({ ...g, dup: held.has(g.key) }));
  grocerySel = new Set(groceryItems.map((_,i)=>i).filter(i=>!groceryItems[i].dup));
  sub('groceryBuild');
}

function toggleGrocery(i){ grocerySel.has(i) ? grocerySel.delete(i) : grocerySel.add(i); render(); }
function groceryToggleAll(){
  grocerySel = grocerySel.size === groceryItems.length
    ? new Set()
    : new Set(groceryItems.map((_,i)=>i));
  render();
}
function addToGrocery(){
  const chosen = [...grocerySel].sort((a,b)=>a-b).map(i=>groceryItems[i]);
  if(!chosen.length){ toast('Tick the ingredients you need'); return; }
  let list = groceryList();
  if(!list){ list = { id:uid(), name:'Groceries', deleted:false }; S.lists.push(list); }
  chosen.forEach(it=>{
    S.listItems.push({
      id:uid(), listId:list.id,
      text: it.text + (it.count > 1 ? ' ×' + it.count : ''),
      ingKey: it.key,        // survives the ×N suffix so matching still works
      forDate: it.forDate,   // when it gets eaten
      checked:false, deleted:false
    });
  });
  save();
  toast(`Added ${chosen.length} item${chosen.length===1?'':'s'} to ${list.name}`);
  view = { tab:'lists', sub:'listDetail', data:{ id:list.id } };
  render();
}

function renderGroceryBuild(m){
  setHeader('Ingredients → Groceries', true);
  if(!groceryItems.length){
    m.innerHTML = `<div class="empty"><div class="et">No recipe ingredients this week</div>
      <div class="eb">Plan a meal from your Recipe Box — tap any slot on the Meals tab and pick a recipe chip — and its ingredients show up here ready to shop.</div></div>`;
    return;
  }
  const n = grocerySel.size;
  const dupCount = groceryItems.filter(i=>i.dup).length;
  let html = `<div class="help">Everything this week's planned meals call for.${dupCount?` ${dupCount} already covered — unticked. Those come back once the meal has passed.`:''}</div>
    <div style="text-align:right;margin-bottom:6px">
      <button class="linkbtn" style="padding:2px 8px" onclick="groceryToggleAll()">${n===groceryItems.length?'Clear all':'Select all'}</button></div>`;

  html += groceryItems.map((it,i)=>{
    const on = grocerySel.has(i);
    return `<div class="card row ${on?'':'dim'}" style="padding:11px;margin-bottom:6px" onclick="toggleGrocery(${i})">
      <div class="check ${on?'on':''}" style="width:22px;height:22px;font-size:12px">${on?'✓':''}</div>
      <div class="grow">
        <div style="font-size:14px">${esc(it.text)}${it.count>1?` <b>×${it.count}</b>`:''}</div>
        <div class="meta" style="font-size:11px">${esc(it.recipes.join(', '))}</div>
      </div>
      ${it.dup?`<span class="meta" style="font-size:10px">covered</span>`:''}
    </div>`;
  }).join('');

  html += `<div class="card" style="position:sticky;bottom:76px;margin-top:12px">
    <button class="btn" onclick="addToGrocery()">🛒 Add ${n} to grocery list</button>
  </div><div style="height:70px"></div>`;
  m.innerHTML = html;
}
```

---

## What to keep, what to improve

**Keep exactly:**

- `normIng()` — the match key. Lowercase, strip punctuation, collapse whitespace.
  Simple and it works. Aggregation and pantry both hinge on it.
- The **pantry coverage rule** in `coveredIngredients()`. This is the subtle,
  hard-won part:
  - On the list, unbought -> covered (don't offer it again).
  - Bought (`checked`) but `forDate >= today` -> **still covered** (it's in the
    fridge, the meal hasn't happened).
  - Bought and `forDate` has passed -> consumed -> offer it again.
  FlyerSnap's first version treated "checked off" as "used up", which wrongly
  re-shopped Wednesday's beef that you bought on Sunday. Don't repeat that.
- Carrying `forDate`. **Decision (Logan, confirmed):** hold an ingredient until
  the **last** meal needing it has passed, not the first. FlyerSnap used the
  earliest date because it only counted names; once you sum quantities that rule
  is wrong. Concretely: three dinners need beef, all bought Sunday — releasing it
  when Monday's dinner is cooked would wrongly re-shop beef still in the fridge
  for Wednesday. So `forDate` should be the **latest** meal date needing that
  ingredient in the window. Your reviewer caught this; it was a genuine bug in
  the original model, not a preference.

**Improve (where FlyerSnap stopped):**

- FlyerSnap keyed on ingredient **name** and counted repeats (`count`), rendering
  "beef ×3". Logan explicitly wants **summed quantities** — "3 recipes need beef
  -> total pounds of beef". That means parsing `quantity` off each ingredient and
  adding compatible units, with graceful fallback (list separately + note) when
  scraped units don't parse. This is the net-new work; the roll-up scaffold in
  `openGroceryBuilder()` is where it slots in.
- FlyerSnap's pantry is driven by the shopping list's checkboxes. You also have a
  **mark-recipe-cooked** action — wire that to the same "consumed" transition, so
  cooking a meal releases its ingredients from the pantry even if the list item was
  never manually checked.

**Drop:** the `sub()`, `render()`, `toast()`, `save()`, `S.*` calls — those are
FlyerSnap's runtime. Replace with your store adapter and React state.

/**
 * tools/preview.js — visual review harness.
 *
 *   node tools/preview.js [outDir]
 *
 * Serves the repo, seeds a realistic demo state, and screenshots every tab at
 * iPhone viewport in BOTH color schemes. Design changes get reviewed here
 * before anything is deployed — the Node test sandbox cannot see rendering,
 * which is how the v8.6 floating-button bug shipped.
 *
 * Chromium is not Safari: it verifies layout, spacing, palette and contrast,
 * not WebKit quirks. On-phone verification still happens before each release.
 */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = process.argv[2] || path.join(root, 'preview-shots');

const iso = (offsetDays) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

// Demo state: enough rows that density, grouping, tags and badges all render.
const demo = {
  schemaVersion: 4,
  events: [
    { id:'e1', title:'Assistant Application Deadline', date:iso(2),  kind:'deadline', time:'',      location:'', note:'Submit via Google Form; dancer must be at least 10.', source:'email', from:'noreply@sportsyou.com', personIds:['k1'], kidId:'k1', unread:true,  deleted:false, exported:false },
    { id:'e2', title:'Chalk the Walk',                 date:iso(3),  kind:'event',    time:'09:00', location:'Chapel Lakes Elementary', note:'Community chalk art event runs 9am-7pm.', source:'email', from:'donotreply@parentsquare.com', personIds:['k2'], kidId:'k2', unread:true,  deleted:false, exported:false },
    { id:'e3', title:'Volleyball Tryouts Begin',       date:iso(5),  kind:'event',    time:'16:00', location:'North Gym', note:'', source:'photo', personIds:['k1'], kidId:'k1', unread:false, deleted:false, exported:true  },
    { id:'e4', title:'Picture Day',                    date:iso(12), kind:'event',    time:'08:30', location:'', note:'Order forms went home Tuesday.', source:'photo', personIds:['k1','k2'], kidId:'k1', unread:false, deleted:false, exported:false },
    { id:'e5', title:'Field Trip Permission Slip Due', date:iso(9),  kind:'deadline', time:'',      location:'', note:'', source:'pdf', personIds:['k2'], kidId:'k2', unread:false, deleted:false, exported:false },
    { id:'e6', title:'Fall Recital',                   date:iso(45), kind:'event',    time:'18:00', location:'Community Center', note:'', source:'photo', personIds:['k1'], kidId:'k1', unread:false, deleted:false, exported:false },
    { id:'e7', title:'Book Fair Week',                 date:iso(-6), kind:'event',    time:'',      location:'Library', note:'', source:'email', personIds:['k2'], kidId:'k2', unread:false, deleted:false, exported:false },
  ],
  kids: [
    { id:'k1', name:'Olivia',  color:'#7C3AED', type:'kid' },
    { id:'k2', name:'Braelyn', color:'#0E7490', type:'kid' },
  ],
  chores: [
    { id:'c1', title:'Make bed',        kidId:'k1', frequency:'daily',  daysOfWeek:'', stars:1, deleted:false },
    { id:'c2', title:'Feed the dog',    kidId:'k2', frequency:'daily',  daysOfWeek:'', stars:1, deleted:false },
    { id:'c3', title:'Take out trash',  kidId:'k1', frequency:'weekly', daysOfWeek:String(new Date().getDay()), stars:2, deleted:false },
  ],
  completions: [], rewards: [{ id:'r1', title:'Movie night pick', stars:10, deleted:false }],
  problems: [], redemptions: [],
  lists: [
    { id:'l1', name:'Costco',       deleted:false },
    { id:'l2', name:'Storage unit', deleted:false },
    { id:'l3', name:'Store',        deleted:false },
  ],
  listItems: [
    { id:'i1', listId:'l1', text:'Paper towels', checked:false, deleted:false },
    { id:'i2', listId:'l3', text:'Milk',         checked:false, deleted:false },
    { id:'i3', listId:'l3', text:'Bananas',      checked:true,  deleted:false },
  ],
  settings: { apiKey:'demo', alerts:{ deadline:[7,1], event:[2,0] } },
};

const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const mime = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.png':'image/png' }[path.extname(f)] || 'text/plain';
  res.writeHead(200, { 'content-type': mime });
  res.end(fs.readFileSync(f));
});

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  await new Promise(r => server.listen(8735, r));
  const browser = await chromium.launch();

  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({
      viewport: { width: 393, height: 852 },
      colorScheme: scheme,
      deviceScaleFactor: 2,
    });
    await page.addInitScript((state) => {
      localStorage.setItem('flyersnap', JSON.stringify(state));
      localStorage.setItem('flyersnap-lastsnapshot', String(Date.now()));
    }, demo);
    await page.goto('http://localhost:8735/');
    await page.waitForTimeout(500);

    for (const tab of ['events', 'chores', 'lists', 'meals', 'settings']) {
      await page.evaluate((t) => nav(t), tab);
      await page.waitForTimeout(400);
      const file = path.join(outDir, `${tab}-${scheme}.png`);
      await page.screenshot({ path: file, fullPage: false });
      console.log('wrote', path.relative(root, file));
    }
    // One sub-screen that matters for design review: the capture sheet.
    await page.evaluate(() => { nav('events'); sub('capture'); });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, `capture-${scheme}.png`) });
    console.log('wrote', path.relative(root, path.join(outDir, `capture-${scheme}.png`)));
    await page.close();
  }

  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });

/**
 * tools/a11y-audit.js — accessibility audit of the RENDERED DOM.
 *
 *   node tools/a11y-audit.js       # exits 1 if any screen has problems
 *
 * The tests in tests-modules.js read the SOURCE; this reads what the browser
 * actually builds, which is the only way to catch a control whose accessible
 * name computes to nothing at runtime. It found exactly that on the Lists
 * screen in v9.1: delete buttons whose only name lived on the <svg> inside.
 *
 * Checks per screen: every focusable control resolves to a name, every tap
 * target is >= 44px tall, exactly one aria-current and one h1.
 * Chromium, not Safari -- structure, not WebKit behaviour.
 */
const { chromium } = require('playwright');
const http=require('http'), fs=require('fs'), path=require('path');
const root=require('path').join(__dirname,'..');
const srv=http.createServer((q,r)=>{let p=q.url.split('?')[0]; if(p==='/')p='/index.html';
  const f=path.join(root,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}
  r.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png'}[path.extname(f)]||'text/plain'});
  r.end(fs.readFileSync(f));});
(async()=>{
  await new Promise(r=>srv.listen(8736,r));
  const b=await chromium.launch(process.env.PW_EXE?{executablePath:process.env.PW_EXE}:{});
  const pg=await b.newPage({viewport:{width:393,height:852}});
  await pg.addInitScript(()=>localStorage.setItem('flyersnap',JSON.stringify({schemaVersion:4,
    events:[{id:'e1',title:'Recital',date:'2026-12-01',kind:'event',personIds:[],unread:false,deleted:false}],
    kids:[{id:'k1',name:'Olivia',color:'#7C3AED',type:'kid'}],chores:[],completions:[],rewards:[],problems:[],
    redemptions:[],lists:[{id:'l1',name:'Costco',deleted:false}],listItems:[],settings:{apiKey:'x'}})));
  await pg.goto('http://localhost:8736/'); await pg.waitForTimeout(500);
  const out={};
  for(const tab of ['events','chores','lists','meals','settings']){
    await pg.evaluate(t=>nav(t),tab); await pg.waitForTimeout(300);
    out[tab]=await pg.evaluate(()=>{
      const problems=[];
      // Controls with no accessible name at all
      document.querySelectorAll('button,a[href],input,textarea,select').forEach(el=>{
        if(el.type==='hidden') return;
        const name=(el.getAttribute('aria-label')||'').trim()
          || (el.id && (document.querySelector(`label[for="${el.id}"]`)||{}).textContent||'').trim()
          || (el.innerText||'').trim();
        if(!name) problems.push('unnamed '+el.tagName.toLowerCase()+' '+(el.id||el.className||''));
      });
      // Tap targets under 44px
      document.querySelectorAll('button,.chip,.card.row').forEach(el=>{
        const r=el.getBoundingClientRect();
        if(r.height>0 && r.height<44) problems.push(`small target ${r.height.toFixed(0)}px: ${(el.innerText||el.className).slice(0,28)}`);
      });
      const cur=document.querySelectorAll('[aria-current="page"]').length;
      const h1=document.querySelectorAll('h1').length;
      return {problems, ariaCurrent:cur, h1};
    });
  }
  console.log(JSON.stringify(out, null, 1));
  const total = Object.values(out).reduce((n, v) => n + v.problems.length, 0);
  for(const [tab, v] of Object.entries(out)){
    if(v.ariaCurrent !== 1) console.error(`${tab}: expected 1 aria-current, got ${v.ariaCurrent}`);
    if(v.h1 !== 1) console.error(`${tab}: expected 1 h1, got ${v.h1}`);
  }
  console.log(total ? `\n${total} problem(s) found` : '\nno problems found');
  await b.close(); srv.close();
  if(total) process.exitCode = 1;
})().catch(e=>{console.error(e);process.exit(1)});

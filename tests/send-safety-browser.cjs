const {installTabFixture}=require('./tab-runtime-fixture.cjs');
// Local fixtures only. QA_SOURCE may point to a frozen pre-fix script; output stays outside Git.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const source=fs.readFileSync(process.env.QA_SOURCE||path.join(__dirname,'../SUUMO-DEV.user.js'),'utf8');
const output=process.env.QA_OUTPUT||'/tmp/suumo-send-safety-results.json';
const names=[...source.matchAll(/^  (?:async )?function (\w+)\(/gm)].map(m=>m[1]);
const script=auto=>source.replace('  init();\n})();',`  window.qa={${names.join(',')}};if(${!!auto}||localStorage.getItem('qa-auto')==='1')init();\n})();`);
const K={item:'suumo_advanced_tab_item_context_v1',sent:'suumo_advanced_tab_sent_context_v1',guard:'suumo_advanced_final_send_guard_v1',issues:'suumo_advanced_issue_log_v1',ticket:'suumo_advanced_page_transition_v1',quarantine:'suumo_advanced_unresolved_send_tab_v1'};
const listing=i=>`https://suumo.jp/chintai/bc_${100000001+i}/`,form=(i,n=1)=>`https://suumo.jp/jj/chintai/shiryou/FR400FG00${n}/?fixture=${i}`;
const html=b=>'<!doctype html><html><head><meta charset="utf-8"></head><body>'+b+'<!--'+'padding'.repeat(200)+'--></body></html>';
const fields=['textSinkokuKaisya','textSinkokusyaName','renrakusakiTelNo','textSinkokuMail','js-textKanriKaisya','js-textKanriKaisyaTel','js-textKanriKaisyaTantouName','js-textMansitu','textSinkokuDate','textSeiyakuDate','textSinkokuKaisyaKakuninDate'];
const inputHtml=i=>html('<select id="js-selectGosinkoku"><option value="1">1</option></select><input type="radio" id="tashaKanri">'+fields.map(id=>`<input id="${id}">`).join('')+`<a class="js-clickToForm" rel="/jj/chintai/shiryou/FR400FG002/" href="${form(i,2)}">確認</a>`);
const sendHtml=(i,complete=false)=>html(`<input name="bc" value="${100000001+i}" type="hidden"><a id="send" class="js-clickToForm" rel="/jj/chintai/shiryou/FR400FG003/" href="${form(i,3)}">模擬送信</a>`+`<script>document.querySelector('#send').onclick=e=>{${complete?'':'e.preventDefault();'}const c=JSON.parse(localStorage.getItem('qa-clicks')||'[]');c.push({actual:'${listing(i)}',guard:qaGet('${K.guard}'),at:performance.now()});localStorage.setItem('qa-clicks',JSON.stringify(c));};</script>`);
function initial(n=2){return {manager1_required_initialized_20261015:true,date_defaults_migrated_20261015:true,profile_manager1:'架空担当',profile_company:'架空申告会社',profile_tel:'0300000000',profile_email:'qa@example.invalid',date_skip_apply:true,date_skip_contract:true,date_skip_confirm:false,settingsSentinel:'KEEP',suumo_permanent_excluded_companies:['架空除外'],ielove_suumo_execution_v1:{items:Array.from({length:n},(_,i)=>({url:listing(i),name:'架空物件'+i,profile:{mgmt_company:'架空会社',mgmt_tel:'0312345678',manager2:'架空担当',room:String(101+i)},status:'pending'}))}}}
const results=[];let currentMetrics=null;
async function test(name,fn,kind='dom') {if(process.env.QA_FILTER&&!name.includes(process.env.QA_FILTER))return;const metrics={clickEvents:0,navigations:0};currentMetrics=metrics;try{const evidence=await fn();results.push({name,kind,status:'PASS',metrics,evidence});console.log('PASS',name)}catch(e){results.push({name,kind,status:'FAIL',metrics,error:String(e.stack)});console.log('FAIL',name,e.message)}}
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox'],ignoreDefaultArgs:['--disable-back-forward-cache']});
async function context({auto=false,n=2,route,fast=false}={}){
 const ctx=await browser.newContext({timezoneId:'Asia/Tokyo'});const seed=initial(n);ctx.setDefaultTimeout(10000);ctx.setDefaultNavigationTimeout(10000);
 const metrics=currentMetrics;const documents=new WeakMap();
 await ctx.exposeBinding('qaObservedClick',()=>{metrics.clickEvents++});
 await ctx.exposeBinding('qaObservedDocument',({page})=>{const count=(documents.get(page)||0)+1;documents.set(page,count);if(count>1)metrics.navigations++});
 await ctx.addInitScript(({seed,code,fast,fixture,auto})=>{
  if(!localStorage.getItem('qa-store'))localStorage.setItem('qa-store',JSON.stringify(seed));const read=()=>JSON.parse(localStorage.getItem('qa-store'));
  window.GM_getValue=(k,d)=>{const s=read();return k in s?s[k]:d};window.GM_setValue=(k,v)=>{const s=read();s[k]=v;localStorage.setItem('qa-store',JSON.stringify(s))};window.GM_deleteValue=k=>{const s=read();delete s[k];localStorage.setItem('qa-store',JSON.stringify(s))};window.GM_xmlhttpRequest=()=>{};window.confirm=()=>true;
  if(fast){const native=setTimeout;window.setTimeout=(fn,ms,...args)=>native(fn,[6000,8000].includes(ms)?80:ms,...args)}
  eval("("+fixture+")()");
  if(!sessionStorage.getItem("qa-seeded")){qaSet("ielove_suumo_execution_v1",seed.ielove_suumo_execution_v1);sessionStorage.setItem("qa-seeded","1")}

 },{seed,code:script(auto),fast,auto,fixture:installTabFixture.toString()});
 const observe="document.addEventListener('click',e=>{if(e.isTrusted||e.target.closest?.('a,button'))window.qaObservedClick().catch(()=>{})},true);\nwindow.addEventListener('pageshow',e=>{const a=JSON.parse(localStorage.getItem('qa-pageshow')||'[]');a.push({url:location.href,persisted:e.persisted});localStorage.setItem('qa-pageshow',JSON.stringify(a))});\nwindow.qaObservedDocument().catch(()=>{});";
 const boot='<script>'+observe+'eval('+JSON.stringify(script(auto)).replace(/</g,'\\u003c')+')</script>';
 await ctx.route('**/*',async r=>{const fulfill=r.fulfill.bind(r);r.fulfill=opts=>fulfill({...opts,body:opts.body+boot});assert.equal(r.request().method(),'GET','Real POST must never occur');if(route)return route(r);return r.fulfill({contentType:'text/html; charset=utf-8',body:html('local fixture')})});
 return ctx;
}
async function unit(n=2){const ctx=await context({n});const p=await ctx.newPage();await p.goto(listing(0));await p.evaluate(urls=>{qa.setBatch(urls,0,'ielove');if(!qa.bindListingToTab())throw Error('listing bind failed')},Array.from({length:n},(_,i)=>listing(i)));return {ctx,p}}
async function enter(p,kind,i=0,body){await p.evaluate(({kind,url,body})=>{if(!qa.queuePageTransition(kind))throw Error('ticket failed');history.pushState(null,'',url);document.body.innerHTML=body;if(!qa.isCurrentTabItem())throw Error('page bind failed');if(kind==='confirm')qaSet('suumo_batch_stage','submitting-confirm')},{kind,url:form(i,kind==='input'?1:kind==='confirm'?2:3),body:body||'<a id="send" class="js-clickToForm" rel="/jj/chintai/shiryou/FR400FG003/">模擬送信</a>'});await p.evaluate(actual=>{window.clicks=[];const b=document.querySelector('#send');if(b)b.onclick=()=>clicks.push({actual,guard:qaGet('suumo_advanced_final_send_guard_v1')})},listing(i))}
async function click(p){await p.evaluate(()=>qa.handleConfirmPage());return p.evaluate(()=>({clicks,store:qaRead()}))}
try{
await test('normal: final click exactly once with matching receipt',async()=>{const {ctx,p}=await unit();try{await enter(p,'confirm');const r=await click(p);await p.evaluate(()=>qa.handleConfirmPage());assert.equal(r.clicks.length,1);assert.equal(r.clicks[0].actual,r.clicks[0].guard.url);assert.equal(await p.evaluate(()=>clicks.length),1);return r.clicks}finally{await ctx.close()}});
await test('regression: new batch immediately after click cannot clear guard',async()=>{const {ctx,p}=await unit();try{await enter(p,'confirm');await click(p);const r=await p.evaluate(url=>{const before=qaGet('suumo_advanced_final_send_guard_v1');const started=qa.setBatch([url],0,'ielove');return {started,before,after:qaGet('suumo_advanced_final_send_guard_v1')}},listing(0));assert.equal(r.started,false);assert.deepEqual(r.after,r.before);return r}finally{await ctx.close()}});
await test('regression: stop before deadline retains unresolved protection',async()=>{const {ctx,p}=await unit();try{await enter(p,'confirm');await click(p);const r=await p.evaluate(url=>{qa.stopBatch();const restarted=qa.setBatch([url],0,'ielove');return {restarted,guard:qaGet('suumo_advanced_final_send_guard_v1'),stage:qaGet('suumo_batch_stage')}},listing(0));assert.equal(r.restarted,false);assert.equal(r.guard.status,'sending');return r}finally{await ctx.close()}});
await test('regression: delayed same-ID completion beyond 90 seconds accepted',async()=>{const {ctx,p}=await unit();try{await p.clock.install();await enter(p,'confirm');await p.evaluate(()=>{window.pending=qa.handleConfirmPage()});await p.clock.runFor(300);await p.evaluate(()=>pending);await p.clock.runFor(100000);const before=await p.evaluate(()=>({index:qaGet('suumo_batch_index'),stage:qaGet('suumo_batch_stage')}));assert.equal(before.index,0);assert.equal(before.stage,'send-uncertain');await p.evaluate(url=>{history.pushState(null,'',url);document.body.innerHTML='正しい同じPOSTの遅延完了';window.pending=qa.handleCompletePage()},form(0,3));await p.clock.runFor(150);await p.evaluate(()=>pending);const r=await p.evaluate(()=>({index:qaGet('suumo_batch_index'),items:qaGet('ielove_suumo_execution_v1').items}));assert.equal(r.items[0].status,'complete');assert.equal(r.index,1);return r}finally{await ctx.close()}});
await test('regression: stale stop cannot cancel another owner',async()=>{const {ctx,p}=await unit();try{const r=await p.evaluate(()=>{qaSet('suumo_batch_owner_token','new-owner');qa.stopBatch();return {active:qaGet('suumo_batch_active'),owner:qaGet('suumo_batch_owner_token')}});assert.equal(r.active,true);assert.equal(r.owner,'new-owner');return r}finally{await ctx.close()}});
await test('regression: previous retry timer cannot navigate a new batch',async()=>{const {ctx,p}=await unit();try{await enter(p,'input',0,'入力');await p.clock.install();await p.evaluate(url=>{qa.scheduleReportRetry('掲載リンク取得','申告リンクが見つかりません');qa.stopBatch();qa.setBatch([url],0,'ielove')},listing(0));const requests=[];p.on('request',r=>requests.push(r.url()));await p.clock.runFor(501);await new Promise(r=>setTimeout(r,100));assert.equal(requests.length,0,JSON.stringify(requests));return {requests}}finally{await ctx.close()}});
await test('regression: copied unknown action states automatic progression is stopped',async()=>{const {ctx,p}=await unit();try{const text=await p.evaluate(()=>qa.formatIssueReport([{phase:'最終送信',kind:'送信結果不明',action:'結果確認まで自動進行停止',index:1,attempts:1,detail:'送信結果不明',at:new Date().toISOString()}]));assert.ok(text.includes('結果確認まで自動進行停止'),text)}finally{await ctx.close()}});
await test('unknown: timeout stops queue and disables retry/skip',async()=>{const {ctx,p}=await unit();try{await p.clock.install();await enter(p,'confirm');await p.evaluate(()=>{window.pending=qa.handleConfirmPage()});await p.clock.runFor(300);await p.evaluate(()=>pending);await p.clock.runFor(61000);const r=await p.evaluate(()=>({index:qaGet('suumo_batch_index'),stage:qaGet('suumo_batch_stage'),guard:qaGet('suumo_advanced_final_send_guard_v1'),skip:document.querySelector('#tm-skip-item')?.disabled,retry:!!document.querySelector('#tm-retry-current'),issues:qa.issueList()}));assert.equal(r.index,0);assert.equal(r.stage,'send-uncertain');assert.equal(r.skip,true);assert.equal(r.retry,false);assert.equal(r.guard.status,'sending');assert.equal(r.issues.length,1);return r}finally{await ctx.close()}});
await test('unknown: reload restores visible stopped panel',async()=>{const {ctx,p}=await unit();try{await enter(p,'confirm');await click(p);await p.evaluate(()=>qa.advanceUncertainSubmission('最終送信の結果不明'));const store=await p.evaluate(()=>qaRead());await p.evaluate(()=>localStorage.setItem('qa-auto','1'));await p.reload();await p.waitForTimeout(150);const panel=await p.locator('#tm-batch-status').count();assert.equal(panel,1);assert.equal(await p.evaluate(()=>qaGet('suumo_batch_stage')),'send-uncertain');return {panel,guardPreserved:!!store[K.guard]}}finally{await ctx.close()}});
await test('fresh tab may intentionally restart while original tab stays quarantined',async()=>{const {ctx,p}=await unit();try{await enter(p,'confirm');await click(p);const before=await p.evaluate(()=>qaGet('suumo_advanced_final_send_guard_v1'));const b=await ctx.newPage();await b.goto(listing(0));assert.equal(await b.evaluate(url=>qa.setBatch([url],0,'ielove'),listing(0)),true);assert.deepEqual(await p.evaluate(()=>qaGet('suumo_advanced_final_send_guard_v1')),before);assert.equal(await b.evaluate(()=>qaGet('suumo_advanced_final_send_guard_v1',null)),null)}finally{await ctx.close()}},'browser');
await test('quarantine persistence failure never clicks',async()=>{const {ctx,p}=await unit();try{await enter(p,'confirm');await p.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(this===sessionStorage&&k==='suumo_advanced_unresolved_send_tab_v1')throw Error('fixture denied');return set.call(this,k,v)}});assert.equal((await click(p)).clicks.length,0)}finally{await ctx.close()}});
await test('completion with old send ID cannot finish current item',async()=>{const {ctx,p}=await unit();try{await enter(p,'confirm');await click(p);const r=await p.evaluate(async url=>{const t=JSON.parse(sessionStorage.getItem('suumo_advanced_page_transition_v1'));t.sendId='old-send-id';sessionStorage.setItem('suumo_advanced_page_transition_v1',JSON.stringify(t));history.pushState(null,'',url);document.body.innerHTML='古い送信IDの完了';await qa.handleCompletePage();return{index:qaGet('suumo_batch_index'),status:qaGet('ielove_suumo_execution_v1').items[0].status}},form(0,3));assert.equal(r.index,0);assert.equal(r.status,'sending');return r}finally{await ctx.close()}});
for(const change of ['index','url','owner','profile','entry'])await test('250ms recheck: '+change,async()=>{const {ctx,p}=await unit();try{await p.clock.install();await enter(p,'confirm');await p.evaluate(()=>{window.pending=qa.handleConfirmPage()});await p.clock.runFor(100);await p.evaluate(change=>{const s=qaRead();if(change==='index')s.suumo_batch_index=1;if(change==='url')s.suumo_batch_urls[0]='https://suumo.jp/chintai/bc_999999999/';if(change==='owner')s.suumo_batch_owner_token='other';if(change==='profile')s.ielove_suumo_execution_v1.items[0].profile.room='999';if(change==='entry')history.replaceState(null,'',location.href);qaWrite(s)},change);await p.clock.runFor(200);await p.evaluate(()=>pending);assert.equal(await p.evaluate(()=>clicks.length),0)}finally{await ctx.close()}});
await test('missing sessionStorage fails closed',async()=>{const {ctx,p}=await unit();try{await enter(p,'confirm');await p.evaluate(()=>sessionStorage.clear());const r=await click(p);assert.equal(r.clicks.length,0)}finally{await ctx.close()}});
await test('no Web Locks fails closed',async()=>{const {ctx,p}=await unit();try{await enter(p,'confirm');await p.evaluate(()=>Object.defineProperty(navigator,'locks',{value:undefined}));assert.equal((await click(p)).clicks.length,0)}finally{await ctx.close()}});
await test('copy: legacy private values and bad dates removed',async()=>{const {ctx,p}=await unit();try{const text=await p.evaluate(()=>qa.formatIssueReport([{phase:'秘密担当',index:1,kind:'秘密会社',action:'token=FAKE',attempts:1,detail:'氏名秘密太郎 room=999 qa@example.com 0312345678 token=FAKE',url:'https://example.com/FAKE',at:'2026-10-25T00:00:00秘密太郎'}]));for(const s of ['秘密太郎','秘密担当','秘密会社','999','qa@example.com','0312345678','FAKE'])assert.ok(!text.includes(s));return text}finally{await ctx.close()}});
for(const mode of ['missing-dom','mismatch'])await test('form preparation max3 with 500ms: '+mode,async()=>{const {ctx,p}=await unit();try{await p.clock.install();await enter(p,'input',0,mode==='missing-dom'?'フォーム未読込':inputHtml(0));await p.evaluate(mode=>{if(mode==='mismatch')document.querySelector('#js-textMansitu').addEventListener('input',e=>e.target.value='999');const native=setTimeout;window.setTimeout=(fn,ms,...args)=>{const w=JSON.parse(localStorage.getItem('qa-waits')||'[]');w.push(ms);localStorage.setItem('qa-waits',JSON.stringify(w));return native(fn,ms,...args)};window.preparing=qa.prepareReportForm()},mode);await p.clock.runFor(mode==='missing-dom'?26000:5000);await p.waitForURL(listing(1));const r=await p.evaluate(()=>({state:qaRead(),waits:JSON.parse(localStorage.getItem('qa-waits')||'[]')}));assert.equal(r.state[K.issues][0].attempts,3);assert.equal(r.state.suumo_batch_index,1);assert.equal(r.waits.filter(ms=>ms===500).length,2);assert.equal(r.state.ielove_suumo_execution_v1.items[0].status,'skipped');return r}finally{await ctx.close()}});
for(const pathname of ['/rent','/rent/','/rent/index/','/sale/','/rental/'])await test('ielove launcher scope '+pathname,async()=>{const ctx=await context({auto:true});try{const p=await ctx.newPage();await p.goto('https://cloud.ielove.jp'+pathname);await p.waitForTimeout(100);assert.equal(await p.locator('#tm-ielove-settings').count(),/^\/rent(?:\/|$)/.test(pathname)?1:0)}finally{await ctx.close()}},'browser');
await test('bb.ielove.jp does not launch',async()=>{const ctx=await context({auto:true});try{const p=await ctx.newPage();await p.goto('https://bb.ielove.jp/rent/');await p.waitForTimeout(100);assert.equal(await p.locator('#tm-ielove-settings').count(),0)}finally{await ctx.close()}},'browser');
// End-to-end actual browser navigation through all public entry points.
for(const mode of ['normal10','mixed10','fast10'])await test('browser queue '+mode,async()=>{
 const visits=[],done=[];const ctx=await context({auto:true,n:10,fast:mode==='mixed10',route:r=>{const u=new URL(r.request().url());const phase=u.pathname.includes('FR400FG003')?'complete':u.pathname.includes('FR400FG002')?'confirm':u.pathname.includes('FR400FG001')?'input':'listing';const i=phase==='listing'?Number(u.pathname.match(/bc_(\d+)/)?.[1])-100000001:Number(u.searchParams.get('fixture'));visits.push({phase,i,at:Date.now(),document:r.request().isNavigationRequest()});let b;if(phase==='listing')b=html(mode==='mixed10'&&i===1?'お探しの情報は、当サイトへの掲載が終了したためご覧いただけません':mode==='mixed10'&&i===3?'申告リンク欠落':`<a id="js-bknToiawaseFr" href="${form(i)+(mode==='fast10'?'&bc='+(100000001+i):'')}">申告</a>`);if(phase==='input')b=inputHtml(i);if(phase==='confirm')b=sendHtml(i,!(mode==='mixed10'&&i===8));if(phase==='complete'){done.push(i);b=html('正しい物件の完了')}return r.fulfill({contentType:'text/html; charset=utf-8',body:b})}});
 try{const p=await ctx.newPage();await p.goto('https://suumo.jp/qa-start');await p.evaluate(urls=>qa.setBatch(urls,0,'ielove'),Array.from({length:10},(_,i)=>listing(i)));await p.goto(listing(0));if(mode==='mixed10'){await p.waitForFunction(()=>qaGet('suumo_advanced_final_send_guard_v1')?.index===8,{},{timeout:25000,polling:50});await p.evaluate(()=>{const g=qaGet('suumo_advanced_final_send_guard_v1');g.startedAt=Date.now()-61000;qaSet('suumo_advanced_final_send_guard_v1',g);window.dispatchEvent(new Event('online'))});await p.waitForFunction(()=>qaGet('suumo_batch_stage')==='send-uncertain',{},{timeout:3000,polling:50});assert.equal(await p.evaluate(()=>qaGet('suumo_batch_index')),8);assert.ok(!done.includes(9));await p.goto(form(8,3));}await p.waitForFunction(()=>qaGet('suumo_batch_active')===false,{},{timeout:25000,polling:50});const s=await p.evaluate(()=>qaRead());const c=await p.evaluate(()=>JSON.parse(localStorage.getItem('qa-clicks')||'[]'));assert.equal(c.length,mode==='mixed10'?8:10);assert.equal(new Set(c.map(x=>x.actual)).size,c.length);assert.ok(c.every(x=>x.actual===x.guard.url));if(mode==='mixed10'){assert.equal((s[K.issues]||[]).find(x=>x.phase==='申告：掲載リンク取得')?.attempts,3);const tries=visits.filter(x=>x.phase==='listing'&&x.i===3);assert.equal(tries.length,3);assert.ok(tries[1].at-tries[0].at>=500&&tries[2].at-tries[1].at>=500)}if(mode==='fast10')assert.equal(visits.filter(v=>v.phase==='listing'&&v.i>0&&v.document).length,0);assert.equal(s.settingsSentinel,'KEEP');assert.deepEqual(s.suumo_permanent_excluded_companies,['架空除外']);assert.equal(s.ielove_suumo_execution_v1.items.filter(x=>x.status==='complete').length,mode==='mixed10'?8:10);return{visits,done,clicks:c,issues:s[K.issues]||[]};}finally{await ctx.close()}
},'browser');

await test('regression: HTTP500 completion remains unknown until valid completion',async()=>{let completionRequests=0;const ctx=await context({auto:true,n:2,route:r=>{const u=new URL(r.request().url());if(u.pathname.includes('FR400FG003')){completionRequests++;return r.fulfill({status:completionRequests===1?500:200,contentType:'text/html; charset=utf-8',body:html(completionRequests===1?'Internal Server Error':'正しい完了')})}if(u.pathname.includes('FR400FG002'))return r.fulfill({contentType:'text/html; charset=utf-8',body:sendHtml(0,true)});if(u.pathname.includes('FR400FG001'))return r.fulfill({contentType:'text/html; charset=utf-8',body:inputHtml(0)});return r.fulfill({contentType:'text/html; charset=utf-8',body:html(u.href===listing(0)?`<a id="js-bknToiawaseFr" href="${form(0)}">申告</a>`:'検査開始／終点')})}});try{const p=await ctx.newPage();await p.goto('https://suumo.jp/qa-start');await p.evaluate(urls=>qa.setBatch(urls,0,'ielove'),[listing(0),listing(1)]);await p.goto(listing(0));await p.waitForFunction(()=>qaGet('suumo_batch_index')===1||qaGet('suumo_batch_stage')==='send-uncertain',{},{timeout:5000,polling:50});const first=await p.evaluate(()=>({index:qaGet('suumo_batch_index'),stage:qaGet('suumo_batch_stage'),items:qaGet('ielove_suumo_execution_v1').items,skip:document.querySelector('#tm-skip-item')?.disabled}));assert.equal(first.index,0,JSON.stringify(first));assert.equal(first.stage,'send-uncertain');assert.equal(first.skip,true);await p.reload();await p.waitForURL(listing(1));const last=await p.evaluate(()=>({index:qaGet('suumo_batch_index'),items:qaGet('ielove_suumo_execution_v1').items,clicks:JSON.parse(localStorage.getItem('qa-clicks')||'[]')}));assert.equal(last.items[0].status,'complete');assert.equal(last.clicks.length,1);return{completionRequests,first,last}}finally{await ctx.close()}},'browser');
for(const offset of [0,100,400])await test('concurrent cloned receipts '+offset+'ms',async()=>{const {ctx,p}=await unit();try{await enter(p,'confirm');const snapshot=await p.evaluate(()=>{localStorage.setItem('qa-auto','1');return history.state});const made=ctx.waitForEvent('page');await p.evaluate(u=>window.open(u,'_blank'),form(0,2));const b=await made;await b.waitForLoadState();await b.waitForURL(form(0,2));await b.waitForFunction(()=>!!document.querySelector('#tm-main-buttons'));const cloneState=await b.evaluate(()=>({opener:!!window.opener,length:history.length,stamp:history.state,active:qa.isAnyBatchActive()}));assert.equal(cloneState.active,false,JSON.stringify(cloneState));await b.evaluate(stamp=>{history.replaceState(stamp,'',location.href);document.body.innerHTML='<a id="send" class="js-clickToForm" rel="/jj/chintai/shiryou/FR400FG003/">送信</a>'},snapshot);for(const page of [p,b])await page.evaluate(()=>document.querySelector('#send').onclick=()=>{const c=JSON.parse(localStorage.getItem('qa-clone-clicks')||'[]');c.push(qaGet('suumo_advanced_final_send_guard_v1'));localStorage.setItem('qa-clone-clicks',JSON.stringify(c))});await Promise.all([p.evaluate(()=>qa.handleConfirmPage()),b.evaluate(async ms=>{await new Promise(r=>setTimeout(r,ms));await qa.handleConfirmPage()},offset)]);const c=await b.evaluate(()=>JSON.parse(localStorage.getItem('qa-clone-clicks')||'[]'));assert.equal(c.length,1);assert.equal(c[0].url,listing(0));return c}finally{await ctx.close()}},'browser');
for(const mode of ['confirm-back','complete-back','confirm-forward'])await test('history/BFCache '+mode,async()=>{let targetHeld=false;const ctx=await context({auto:true,n:3,route:r=>{const u=new URL(r.request().url()),phase=u.pathname.includes('FR400FG003')?'complete':u.pathname.includes('FR400FG002')?'confirm':u.pathname.includes('FR400FG001')?'input':'listing';const i=phase==='listing'?Number(u.pathname.match(/bc_(\d+)/)?.[1])-100000001:Number(u.searchParams.get('fixture'));let b;if(phase==='listing')b=html(Number.isFinite(i)&&i<2?`<a id="js-bknToiawaseFr" href="${form(i)}">申告</a>`:'開始／終点');if(phase==='input')b=inputHtml(i);if(phase==='confirm'){b=i===1&&mode!=='complete-back'?html('送信ボタン読込待ち'):sendHtml(i,i===0);if(i===1)targetHeld=true}if(phase==='complete')b=html('物件'+i+'の完了');return r.fulfill({contentType:'text/html; charset=utf-8',body:b})}});try{const p=await ctx.newPage();await p.goto('https://suumo.jp/qa-start');await p.evaluate(urls=>qa.setBatch(urls,0,'ielove'),[listing(0),listing(1),listing(2)]);await p.goto(listing(0));await p.waitForURL(form(1,2));await p.waitForFunction(m=>m==='complete-back'?qaGet('suumo_advanced_final_send_guard_v1')?.index===1:qaGet('suumo_batch_stage')==='submitting-final',mode,{timeout:5000,polling:50});const before=await p.evaluate(()=>qaRead());const old=mode==='complete-back'?form(0,3):form(0,2);if(mode==='confirm-forward'){await p.evaluate(()=>history.go(-7));await p.waitForFunction(()=>location.href==='https://suumo.jp/qa-start',{},{polling:50});await p.evaluate(()=>history.go(3))}else await p.evaluate(n=>history.go(n),mode==='complete-back'?-3:-4);await p.waitForFunction(u=>location.href===u,old,{polling:50});await p.waitForTimeout(400);const r=await p.evaluate(()=>({store:qaRead(),clicks:JSON.parse(localStorage.getItem('qa-clicks')||'[]'),pages:JSON.parse(localStorage.getItem('qa-pageshow')||'[]')}));assert.equal(r.store.suumo_batch_index,1);assert.equal(r.store.ielove_suumo_execution_v1.items[1].status,before.ielove_suumo_execution_v1.items[1].status);assert.equal(r.clicks.length,mode==='complete-back'?2:1);return {targetHeld,...r,bfCacheRestored:r.pages.some(x=>x.persisted)}}finally{await ctx.close()}},'browser');
await test('independent tabs simultaneous send burst has one click',async()=>{const {ctx,p}=await unit();try{
 const b=await ctx.newPage();await b.goto(listing(0));await b.evaluate(url=>{qa.setBatch([url],0,'ielove');qa.bindListingToTab()},listing(0));
 for(const page of [p,b]){await enter(page,'confirm');await page.evaluate(()=>document.querySelector('#send').onclick=()=>{const c=JSON.parse(localStorage.getItem('qa-burst')||'[]');c.push(qaGet('suumo_advanced_final_send_guard_v1').id);localStorage.setItem('qa-burst',JSON.stringify(c))})}
 // Use one shared wall-clock deadline to overlap real Web Locks requests.
 const at=Date.now()+400;await Promise.all([p,b].map(page=>page.evaluate(async at=>{await new Promise(r=>setTimeout(r,Math.max(0,at-Date.now())));await qa.handleConfirmPage()},at)));
 const clicks=await p.evaluate(()=>JSON.parse(localStorage.getItem('qa-burst')||'[]'));assert.equal(clicks.length,1);return clicks;
 }finally{await ctx.close()}},'browser');
await test('real-style listing popup: same-origin input tab keeps UI and batch without resending in listing tab',async()=>{
 const ctx=await context({n:2,route:r=>{
  const path=new URL(r.request().url()).pathname;
  const page=path.startsWith('/chintai/bc_')
   ? html('<a id="js-bknToiawaseFr" target="suumo-report-popup" rel="opener" href="'+form(0,1)+'">指摘フォームを開く</a>')
   : path.includes('/FR400FG001/')?inputHtml(0):html('unused');
  return r.fulfill({contentType:'text/html; charset=utf-8',body:page});
 }});
 try{
  const original=await ctx.newPage();
  await original.goto(listing(0));
  assert.equal(await original.evaluate(urls=>{const ok=qa.setBatch(urls,0,'ielove');return ok&&qa.bindListingToTab()},[listing(0)]),true);
  assert.equal(await original.evaluate(()=>qa.queuePageTransition('input')),true);
  const opening=ctx.waitForEvent('page');
  await original.locator('#js-bknToiawaseFr').click();
  const popup=await opening;
  await popup.waitForLoadState('domcontentloaded');
  const evidence=await popup.evaluate(async()=>{
   const before={hasOpener:!!window.opener,kind:location.pathname,active:qa.isBatchActive()};
   await qa.init();
   return {...before,
    activeAfter:qa.isBatchActive(),
    hasSettingsButton:!!document.getElementById('tm-main-buttons'),
    hasBatchPanel:!!document.getElementById('tm-batch-status'),
    errorToast:document.getElementById('tm-toast')?.textContent||'',
    sourceActive:window.opener?.sessionStorage.getItem('suumo_advanced_tab_runtime_v1_suumo_batch_active')
   };
  });
  assert.equal(evidence.hasOpener,true);
  assert.equal(evidence.active,true);
  assert.equal(evidence.activeAfter,true);
  assert.equal(evidence.sourceActive,'false');
  assert.equal(evidence.hasSettingsButton,true);
  assert.equal(evidence.hasBatchPanel,true);
  assert.doesNotMatch(evidence.errorToast,/タブ専用の保存状態を確認できません/);
  return evidence;
 }finally{await ctx.close()}
});
await test('real SUUMO link href=# opens parameter-free input popup with settings UI and active batch',async()=>{
 const ctx=await context({n:1,route:r=>{
  const path=new URL(r.request().url()).pathname;
  const listingPage=html('<a id="js-bknToiawaseFr" href="#">指摘フォームを開く</a>'
   +'<script>document.querySelector("#js-bknToiawaseFr").addEventListener("click",e=>{e.preventDefault();window.open("/jj/chintai/shiryou/FR400FG001/","suumo-report-popup");});</script>');
  return r.fulfill({contentType:'text/html; charset=utf-8',
   body:path.startsWith('/chintai/bc_')?listingPage:
    path.includes('/FR400FG001/')?inputHtml(0):html('unused')});
 }});
 try{
  const original=await ctx.newPage();
  await original.goto(listing(0));
  assert.equal(await original.evaluate(urls=>{
   const ok=qa.setBatch(urls,0,'ielove');
   return ok&&qa.bindListingToTab()&&qa.queuePageTransition('input');
  },[listing(0)]),true);
  const opening=ctx.waitForEvent('page');
  await original.locator('#js-bknToiawaseFr').click();
  const popup=await opening;
  await popup.waitForLoadState('domcontentloaded');
  const evidence=await popup.evaluate(async()=>{
   await qa.init();
   return {url:location.pathname,opener:!!window.opener,
    href:window.opener?.document.querySelector('#js-bknToiawaseFr')?.getAttribute('href'),
    active:qa.isBatchActive(),
    settings:!!document.getElementById('tm-main-buttons'),
    panel:!!document.getElementById('tm-batch-status'),
    parentActive:window.opener?.sessionStorage.getItem('suumo_advanced_tab_runtime_v1_suumo_batch_active'),
    toast:document.querySelector('#tm-toast')?.textContent||''};
  });
  assert.equal(evidence.href,'#');
  assert.equal(evidence.url,'/jj/chintai/shiryou/FR400FG001/');
  assert.equal(evidence.opener,true);
  assert.equal(evidence.active,true);
  assert.equal(evidence.parentActive,'false');
  assert.equal(evidence.settings,true);
  assert.equal(evidence.panel,true);
  assert.doesNotMatch(evidence.toast,/安全停止：タブ専用の保存状態を確認できません/);
  return evidence;
 }finally{await ctx.close()}
},'browser');
for(const mode of ['wrong-input','revoke-fails'])await test('popup safety: '+mode,async()=>{
 const ctx=await context({n:1,route:r=>r.fulfill({contentType:'text/html; charset=utf-8',body:new URL(r.request().url()).pathname.startsWith('/chintai/bc_')?html('<a id="js-bknToiawaseFr" target="suumo-report-popup" rel="opener" href="'+form(0,1)+'">申告</a>'):inputHtml(1)})});
 try{
  const p=await ctx.newPage();await p.goto(listing(0));await p.evaluate(url=>{qa.setBatch([url],0,'ielove');qa.bindListingToTab();qa.queuePageTransition('input')},listing(0));
  if(mode==='revoke-fails')await p.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(this===sessionStorage&&k==='suumo_advanced_tab_runtime_v1_suumo_batch_active'&&v==='false')throw Error('synthetic parent write failure');return set.call(this,k,v)}});
  const opening=ctx.waitForEvent('page');await p.evaluate(url=>window.open(url,'suumo-report-popup'),mode==='wrong-input'?form(1,1):form(0,1));const b=await opening;await b.waitForLoadState();
  await b.evaluate(()=>qa.init());
  if(mode==='revoke-fails'){await b.reload();await b.evaluate(()=>qa.init())}
  const state=await b.evaluate(()=>({active:qa.isBatchActive(),parentActive:window.opener.sessionStorage.getItem('suumo_advanced_tab_runtime_v1_suumo_batch_active'),stage:qaGet('suumo_batch_stage')}));
  assert.equal(state.active,false,JSON.stringify(state));assert.equal(state.parentActive,'true');return state;
 }finally{await ctx.close()}
},'browser');
for(const copy of ['copied','empty'])await test('real-style listing popup: full two-item queue '+copy,async()=>{
 const ctx=await context({auto:true,n:2,route:r=>{const u=new URL(r.request().url());const phase=u.pathname.includes('FR400FG003')?'complete':u.pathname.includes('FR400FG002')?'confirm':u.pathname.includes('FR400FG001')?'input':'listing';const i=phase==='listing'?Number(u.pathname.match(/bc_(\d+)/)?.[1])-100000001:Number(u.searchParams.get('fixture'));let body=phase==='listing'?html(Number.isFinite(i)?'<a id="js-bknToiawaseFr" target="suumo-report-popup" rel="opener" href="'+form(i,1)+'">申告</a>':'開始'):phase==='input'?inputHtml(i):phase==='confirm'?sendHtml(i,true):html('模擬完了');if(copy==='empty'&&phase==='input')body+='<script>for(const key of Object.keys(sessionStorage))if(!key.startsWith("qa-"))sessionStorage.removeItem(key)</script>';return r.fulfill({contentType:'text/html; charset=utf-8',body})}});
 try{
  const pages=[];ctx.on('page',p=>pages.push(p));const original=await ctx.newPage();await original.goto('https://suumo.jp/qa-start');await original.evaluate(urls=>qa.setBatch(urls,0,'ielove'),[listing(0),listing(1)]);const first=ctx.waitForEvent('page');await original.goto(listing(0));const child=await first;await child.waitForLoadState();const second=ctx.pages().find(p=>p!==original&&p!==child)||await ctx.waitForEvent('page');await second.waitForLoadState();
  await second.waitForFunction(()=>qaGet('suumo_batch_active')===false&&qaGet('ielove_suumo_execution_v1')?.items.every(x=>x.status==='complete'),{},{timeout:20000});
  const result=await second.evaluate(()=>({clicks:JSON.parse(localStorage.getItem('qa-clicks')||'[]'),items:qaGet('ielove_suumo_execution_v1').items,sentinel:GM_getValue('settingsSentinel')}));assert.equal(result.clicks.length,2);assert.equal(new Set(result.clicks.map(x=>x.actual)).size,2);assert.ok(result.clicks.every(x=>x.actual===x.guard.url));for(const p of [original,child])assert.equal(await p.evaluate(()=>qa.isBatchActive()),false);assert.equal(result.sentinel,'KEEP');return result;
 }finally{await ctx.close()}
},'browser');
await test('real-style listing popup: cross-origin opener keeps ordinary settings UI',async()=>{
 const ctx=await context({auto:true,route:r=>r.fulfill({contentType:'text/html; charset=utf-8',body:html('架空ページ')})});try{
  const p=await ctx.newPage();await p.goto('https://cloud.ielove.jp/rent/');const opening=ctx.waitForEvent('page');await p.evaluate(url=>window.open(url,'suumo-cross-origin-report'),form(0,1));const b=await opening;await b.waitForLoadState();await b.locator('#tm-main-buttons').waitFor();const result=await b.evaluate(()=>{let isolated=false;try{void window.opener.location.origin}catch(e){isolated=e.name==='SecurityError'}return{isolated,active:qa.isBatchActive(),toast:document.querySelector('#tm-toast')?.textContent||'',settings:!!document.querySelector('#tm-main-buttons')}});assert.equal(result.isolated,true);assert.equal(result.active,false);assert.equal(result.settings,true);assert.doesNotMatch(result.toast,/タブ専用の保存状態を確認できません/);return result;
 }finally{await ctx.close()}
},'browser');
await test('new opened tab stays independent on its later same-tab reload',async()=>{const {ctx,p}=await unit();try{
 await p.evaluate(()=>localStorage.setItem('qa-auto','1'));const made=ctx.waitForEvent('page');await p.evaluate(url=>window.open(url,'_blank'),listing(0));const b=await made;await b.waitForURL(listing(0));await b.locator('#tm-main-buttons').waitFor();
 assert.equal(await b.evaluate(()=>qa.isAnyBatchActive()),false);
 await b.evaluate(url=>{qa.setBatch([url],0,'ielove');qa.bindListingToTab()},listing(0));const before=await b.evaluate(()=>({token:qa.getTabOwnerToken(),history:history.state}));
 await b.reload();assert.equal(await b.evaluate(()=>qa.getTabOwnerToken()),before.token);assert.deepEqual(await b.evaluate(()=>history.state),before.history);assert.equal(await b.evaluate(()=>qa.isBatchActive()),true);
 }finally{await ctx.close()}},'browser');
await test('opened-tab reload with lost history cannot erase pending send',async()=>{const {ctx,p}=await unit();try{
 await p.evaluate(()=>localStorage.setItem('qa-auto','1'));const made=ctx.waitForEvent('page');await p.evaluate(url=>window.open(url,'_blank'),listing(0));const b=await made;await b.waitForURL(listing(0));await b.locator('#tm-main-buttons').waitFor();
 await b.evaluate(url=>{localStorage.removeItem('qa-auto');qa.setBatch([url],0,'ielove');qa.bindListingToTab();qa.queuePageTransition('confirm');history.replaceState(null,'','/jj/chintai/shiryou/FR400FG002/?fixture=0');qa.isCurrentTabItem();qaSet('suumo_batch_stage','submitting-confirm');document.body.innerHTML='<a id="send" class="js-clickToForm" rel="/jj/chintai/shiryou/FR400FG003/">送信</a>';window.clicks=[];document.querySelector('#send').onclick=()=>clicks.push('sent')},listing(0));
 assert.equal((await click(b)).clicks.length,1);const guard=await b.evaluate(()=>{history.replaceState(null,'',location.href);localStorage.setItem('qa-auto','1');return qaGet('suumo_advanced_final_send_guard_v1')});await b.reload();
 assert.deepEqual(await b.evaluate(()=>qaGet('suumo_advanced_final_send_guard_v1')),guard);assert.equal(await b.evaluate(()=>sessionStorage.getItem('suumo_advanced_unresolved_send_tab_v1')),'1');assert.equal(await b.evaluate(url=>qa.setBatch([url],0,'ielove'),listing(0)),false);
 }finally{await ctx.close()}},'browser');
await test('runtime quota failure never clicks or overwrites GM settings',async()=>{const {ctx,p}=await unit();try{
 await enter(p,'confirm');await p.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(this===sessionStorage&&k.startsWith('suumo_advanced_tab_runtime_v1_'))throw new DOMException('fixture quota','QuotaExceededError');return set.call(this,k,v)}});
 await p.evaluate(async()=>{try{await qa.handleConfirmPage()}catch{}});assert.equal(await p.evaluate(()=>clicks.length),0);assert.equal(await p.evaluate(()=>GM_getValue('settingsSentinel')),'KEEP');assert.ok((await p.locator('#tm-toast').textContent()).includes('保存'));
 }finally{await ctx.close()}});
// Corrupt/denied runtime reads must not silently change an ielove job into regular reporting.
for(const fault of ['invalid-json','wrong-shape','denied-read'])await test('storage fault blocks send: '+fault,async()=>{const {ctx,p}=await unit();try{
 await enter(p,'confirm');
 await p.evaluate(fault=>{const key='suumo_advanced_tab_runtime_v1_ielove_suumo_execution_v1';if(fault==='denied-read'){const get=Storage.prototype.getItem;Storage.prototype.getItem=function(k){if(this===sessionStorage&&k===key)throw Error('fixture access denied');return get.call(this,k)}}else sessionStorage.setItem(key,fault==='invalid-json'?'{broken':'{}')},fault);
 await p.evaluate(()=>qa.handleConfirmPage());
 assert.equal(await p.evaluate(()=>clicks.length),0);
 assert.equal(await p.evaluate(()=>GM_getValue('settingsSentinel')),'KEEP');
 assert.ok((await p.locator('#tm-toast').textContent())?.includes('保存'));
 }finally{await ctx.close()}});
await test('copy button redacts legacy log content and invalid timestamp',async()=>{const {ctx,p}=await unit();try{
 await p.evaluate(()=>{qaSet('suumo_advanced_issue_log_v1',[{phase:'検索',kind:'検索・会社情報取得失敗',index:1,attempts:3,action:'最大3回試行後スキップ',detail:'秘密太郎 qa@example.com token=secret TEL0312345678',at:'0000-00-00 SECRET'}]);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.qaCopied=text}}});qa.openIssueResults()});
 await p.getByRole('button',{name:'エラー内容をコピー',exact:true}).click();const text=await p.evaluate(()=>qaCopied);for(const secret of ['秘密太郎','qa@example.com','secret','0312345678','0000-00-00','SECRET'])assert.ok(!text.includes(secret));assert.ok(text.includes('検索')&&text.includes('3'));return{text};
 }finally{await ctx.close()}});
await test('closed tab 176/201 does not transfer queue/results to fresh tab',async()=>{const {ctx,p}=await unit(201);try{
 await p.evaluate(()=>{qaSet('suumo_batch_index',175);qaSet('suumo_advanced_issue_log_v1',[{kind:'old'}]);});
 await p.close();const b=await ctx.newPage();await b.goto(listing(0));
 assert.equal(await b.evaluate(()=>qa.isAnyBatchActive()),false);
 assert.deepEqual(await b.evaluate(()=>qa.getBatchUrls()),[]);
 assert.equal(await b.locator('#tm-stale-batch-recovery, #tm-issue-results').count(),0);
 assert.equal(await b.evaluate(url=>qa.setBatch([url],0,'ielove'),listing(0)),true);
 assert.equal(await b.evaluate(()=>qa.getBatchIndex()),0);
 assert.equal(await b.evaluate(()=>GM_getValue('settingsSentinel')),'KEEP');
 }finally{await ctx.close()}},'browser');
await test('same-tab confirmation reload retains matching entry and single send',async()=>{const {ctx,p}=await unit();try{
 await enter(p,'confirm');const stamp=await p.evaluate(()=>history.state);
 await p.reload();assert.deepEqual(await p.evaluate(()=>history.state),stamp);
 await p.evaluate(()=>{document.body.innerHTML='<a id="send" class="js-clickToForm" rel="/jj/chintai/shiryou/FR400FG003/">送信</a>';window.clicks=[];document.querySelector('#send').onclick=()=>clicks.push({actual:qa.getBatchUrls()[qa.getBatchIndex()],guard:qaGet('suumo_advanced_final_send_guard_v1')})});
 assert.equal((await click(p)).clicks.length,1);await p.reload();
 await p.evaluate(()=>{document.body.innerHTML='<a id="send" class="js-clickToForm" rel="/jj/chintai/shiryou/FR400FG003/">送信</a>';window.clicks=[];document.querySelector('#send').onclick=()=>clicks.push('duplicate')});
 assert.equal((await click(p)).clicks.length,0);
 }finally{await ctx.close()}},'browser');
await test('dates preserve skip settings and confirm date',async()=>{const {ctx,p}=await unit();try{await enter(p,'input',0,inputHtml(0));const r=await p.evaluate(async()=>{await qa.autofill(false);return {apply:document.querySelector('#textSinkokuDate').value,contract:document.querySelector('#textSeiyakuDate').value,confirm:document.querySelector('#textSinkokuKaisyaKakuninDate').value,room:document.querySelector('#js-textMansitu').value}});assert.equal(r.apply,'');assert.equal(r.contract,'');assert.match(r.confirm,/^\d{4}\/\d{2}\/\d{2}/);assert.equal(r.room,'101');return r}finally{await ctx.close()}});
await test('ielove acquire/edit/prev/next/normal/handoff preserves values',async()=>{let detailFetches=0;const row=i=>`<tr id="row_${i}"><td><span id="realEstateName1_${i}">架空物件${i}</span><span id="spareDetail_${i}">${100+i}</span><span id="address_${i}">東京都葛飾区金町3丁目</span><span id="price_${i}">6.7万円</span><span id="motozukeName_${i}">架空管理会社</span><span id="motozukeStaffName_${i}">架空担当</span><span id="motozukePhoneNum_${i}">0312345678</span><p>2024年5月 18.98㎡</p></td></tr>`;const ctx=await context({auto:true,route:r=>{if(r.request().url().includes('/detail/id/')){detailFetches++;return r.fulfill({contentType:'text/html; charset=utf-8',body:html('<table><tr><th>所在階/階建</th><td>1階/3階建</td></tr></table>')})}return r.fulfill({contentType:'text/html; charset=utf-8',body:html('<table>'+row(1)+row(2)+'</table>')})}});try{const p=await ctx.newPage();await p.goto('https://cloud.ielove.jp/rent/');await p.getByText('指摘設定',{exact:true}).click();await p.getByText('一括取得',{exact:true}).click();await p.locator('#tm-ielove-batch-name').filter({hasText:'架空物件1'}).waitFor();await p.locator('#tm-mgmt-company').fill('変更会社１');await p.locator('#tm-manager2').fill('変更担当１');await p.locator('#tm-ielove-next').click();await p.locator('#tm-mgmt-company').fill('変更会社２');await p.locator('#tm-ielove-prev').click();assert.equal(await p.locator('#tm-mgmt-company').inputValue(),'変更会社１');await p.locator('#tm-ielove-back').click();const r=await p.evaluate(()=>{const draft=qaGet('ielove_batch_draft_v1');qa.activateIeloveBatchEditor(draft);window.qaOpened=[];window.open=u=>{qaOpened.push(u);return{}};qa.handoffIeloveBatchToSuumo(draft);return{draft,opened:qaOpened,handoff:qaGet('ielove_suumo_handoff_v1'),sentinel:qaGet('settingsSentinel')}});assert.equal(detailFetches,2);assert.equal(r.draft.records[0].managementCompany,'変更会社１');assert.equal(r.draft.records[1].managementCompany,'変更会社２');assert.equal(r.handoff.records.length,2);assert.match(new URL(r.opened[0]).searchParams.get('fw'),/2024年5月 1階 18.98m 6.7万円/);assert.equal(r.sentinel,'KEEP');return{detailFetches,...r}}finally{await ctx.close()}},'browser');
}catch(e){throw e}finally{await browser.close();fs.writeFileSync(output,JSON.stringify({sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),results},null,2));}
console.log('TOTAL',results.length,'FAIL',results.filter(r=>r.status==='FAIL').length);if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});

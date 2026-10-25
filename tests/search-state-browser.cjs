const {chromium}=require('playwright');
const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto');
const path=require('node:path');const repo=path.resolve(__dirname,'..');
const source=fs.readFileSync(repo+'/SUUMO-DEV.user.js','utf8');
const results=[];
const KEYS={issues:'suumo_advanced_issue_log_v1',retry:'suumo_advanced_report_retry_v1',guard:'suumo_advanced_final_send_guard_v1'};
const sourceKeys=[...source.matchAll(/const (ISSUE_LOG_KEY|FINAL_SEND_GUARD_KEY|BATCH_SKIP_LOG_KEY) = "([^"]+)"/g)];
for(const m of sourceKeys){if(m[1]==='ISSUE_LOG_KEY')KEYS.issues=m[2];if(m[1]==='FINAL_SEND_GUARD_KEY')KEYS.guard=m[2]}
const names=['bindListingToTab','readTabContext','isCurrentTabItem','isCurrentTabSent','isConfirmedNoResultMessage','isConfirmedListingEndedPage','autoSkipEndedListingIfConfirmed','scanIeloveSuumoPages','collectIeloveSuumoResults','recordIssue','issueList','formatIssueReport','openIssueResults','prepareReportForm','handleListingPage','handleConfirmPage','handleCompletePage','submitCurrentAndContinue','scheduleReportRetry','clearReportRetry','reconcileBatchState','currentUncertainSend','blockUncertainIeloveResend','advanceUncertainSubmission','setBatch','goToNextListing','advancePastSkippedListing','buildIeloveSuumoSearch','autofill','readSuumoRoomCard','checkScriptUpdate','openSettings','getIeloveHandoff'];
const exported=source.replace('  init();\n})();',`  window.api={${names.join(',')}};\n})();`);
// Instrument only navigation assignments in the unit variant. The deployed source stays untouched.
const unit=exported.replace(/location.href\s*=\s*([^;]+);/g,'window.qaNav($1);');
const fw='東京都葛飾区金町3 2024年5月 1階 18.98m 6.7万円';
const search=(i=0)=>'https://suumo.jp/jj/chintai/ichiran/FR301FC011/?'+new URLSearchParams({fw,pc:'100',suumo_jj_batch:'qa',fixture:String(i)});
const listing=i=>'https://suumo.jp/chintai/bc_'+(100000001+i)+'/';
const form=(i,n=1)=>`https://suumo.jp/jj/chintai/shiryou/FR400FG00${n}/?fixture=${i}`;
const profile={mgmt_company:'テスト管理会社',mgmt_tel:'0312345678',manager2:'テスト担当',room:'101'};
function storeFor(n=2){return {manager1_required_initialized_20261015:true,date_defaults_migrated_20261015:true,profile_manager1:'試験者',suumo_batch_active:true,suumo_batch_owner_token:'qa-owner',suumo_batch_urls:Array.from({length:n},(_,i)=>listing(i)),suumo_batch_index:0,suumo_batch_stage:'listing',ielove_suumo_execution_v1:{items:Array.from({length:n},(_,i)=>({url:listing(i),profile:{...profile,room:String(101+i)},status:'pending',name:'模擬物件'+i}))}}}
const html=(body)=>'<!doctype html><html><head><meta charset="utf-8"></head><body>'+body+'<!--'+'padding'.repeat(200)+'--></body></html>';
const card=(i=0,opt={})=>`<div class="property-body js-property"><input name="bc" value="${100000001+i}"><div class="property_inner-title"><a href="/chintai/bc_${100000001+i}/">物件 1階</a></div><div class="detailbox-property-point">6.7万円</div><table class="detailbox-property"><tr><td></td><td></td><td>${opt.area||18.98}m2</td><td></td><td>東京都葛飾区金町3丁目</td></tr></table>${opt.company===false?'':`<a href="/chintai/kaisha/c${i%3}/">テスト会社${i%3}</a>`}</div>`;
function formHtml(i,opt={}){return html('<select id="js-selectGosinkoku"><option value="1">1</option></select><input type="radio" id="tashaKanri">'+['textSinkokuKaisya','textSinkokusyaName','renrakusakiTelNo','textSinkokuMail','js-textKanriKaisya','js-textKanriKaisyaTel','js-textKanriKaisyaTantouName','js-textMansitu','textSinkokuDate','textSeiyakuDate','textSinkokuKaisyaKakuninDate'].map(id=>`<input id="${id}">`).join('')+(opt.missing?'':`<a class="js-clickToForm" rel="/jj/chintai/shiryou/FR400FG002/" href="${form(i,2)}">確認</a>`))}
async function setup(page,{url=listing(0),body=html(''),store=storeFor(),script=unit,clock=false}={}){
 await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body}));
 await page.goto(url);
 if(clock)await page.clock.install();
 await page.evaluate(({store,keys})=>{
  window.store=store;window.nav=[];window.clicks=[];window.waits=[];window.copied='';
  window.qaNav=u=>nav.push(String(u));
  window.GM_getValue=(k,d)=>k in window.store?structuredClone(window.store[k]):d;
  window.GM_setValue=(k,v)=>{window.store[k]=structuredClone(v)};
  window.GM_deleteValue=k=>{delete window.store[k]};window.GM_xmlhttpRequest=()=>{};
  sessionStorage.setItem('suumo_batch_tab_owner_token','qa-owner');
  window.confirm=()=>false;
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window.copied=t}}});
  const timeout=window.setTimeout;window.setTimeout=(fn,ms,...a)=>{waits.push(ms);return timeout(fn,ms,...a)};
 },{store,keys:KEYS});
 await page.addScriptTag({content:script});

 // Unit fixtures model the preceding matching listing visit using the real binding helper.
 await page.evaluate(({url,keys})=>{
  if(!window.store?.suumo_batch_active||location.hostname!=="suumo.jp")return;
  const oldUrl=location.href,u=new URL(url);
  const id=(u.pathname.match(/bc_(\d+)/)||[])[1] || String(100000001+Number(u.searchParams.get("fixture")||0));
  history.replaceState(null,"","/chintai/bc_"+id+"/");
  api.bindListingToTab();
  history.replaceState(null,"",oldUrl);
  const ctx=api.readTabContext("suumo_advanced_tab_item_context_v1"),idx=store.suumo_batch_index||0;
  if(ctx && (store[keys.guard]?.status==="sending"||store.ielove_suumo_execution_v1?.items[idx]?.status==="sending")){
   const guard={...(store[keys.guard]||{}),id:store[keys.guard]?.id||"qa-existing-send",itemId:ctx.id,index:idx,url:store.suumo_batch_urls[idx],ownerToken:store.suumo_batch_owner_token,status:"sending"};
   store[keys.guard]=guard;sessionStorage.setItem("suumo_advanced_tab_sent_context_v1",JSON.stringify(guard));
  }
 },{url,keys:KEYS});
}
async function test(name,fn){if(process.env.QA_FILTER&&!name.startsWith(process.env.QA_FILTER))return;try{const evidence=await fn();results.push({name,status:'PASS',evidence});console.log('PASS',name)}catch(e){results.push({name,status:'FAIL',error:String(e.stack)});console.log('FAIL',name,e.message)}}
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const newPage=()=>browser.newPage();
const state=()=>({manager1_required_initialized_20261015:true,profile_manager1:'架空担当者',businessSentinel:{retain:'架空業務情報'},ielove_suumo_handoff_v1:{token:'qa',index:0,records:[{}],searches:[{url:search()}]}});
const cards21=`<div id="js-bukkenList">${Array.from({length:21},(_,i)=>card(i)).join('')}</div>`;
try{
await test('S1 正常21掲載をゼロ件と誤判定しない',async()=>{const p=await newPage();try{await setup(p,{url:search(),body:html(cards21),store:state()});await p.evaluate(()=>api.collectIeloveSuumoResults());const r=await p.evaluate(()=>({store,nav,count:document.querySelectorAll('.js-property').length}));assert.equal(r.count,21);assert.equal(r.store.ielove_suumo_choices_v1[0].__companies.reduce((n,g)=>n+g.urls.length,0),21);assert.ok(!r.store[KEYS.issues]);return r}finally{await p.close()}});
for(const mode of ['missing','token','index','url','new-batch'])await test('S2 検索途中の状態変更:'+mode,async()=>{const p=await newPage();try{await setup(p,{url:search(),body:html(cards21+`<a href="${search()}&pn=2">次へ</a>`),store:state()});await p.evaluate(({mode,body})=>{window.fetch=async()=>{if(mode==='missing')delete store.ielove_suumo_handoff_v1;if(mode==='token')store.ielove_suumo_handoff_v1.token='new';if(mode==='index')store.ielove_suumo_handoff_v1.index=1;if(mode==='url')store.ielove_suumo_handoff_v1.searches[0].url+='&changed=1';if(mode==='active')store.suumo_batch_active=true;if(mode==='new-batch'){store.ielove_suumo_handoff_v1.token='new';const u=new URL(location.href);u.searchParams.set('suumo_jj_batch','new');history.replaceState(null,'',u)};return{ok:true,headers:new Headers({'content-type':'text/html'}),text:async()=>body}}},{mode,body:html(cards21)});await p.evaluate(()=>api.collectIeloveSuumoResults());const r=await p.evaluate(()=>({store,nav,message:document.querySelector('#tm-toast')?.textContent}));assert.equal(r.nav.length,0);assert.equal(r.store.ielove_suumo_choices_v1,undefined);assert.equal(r.store[KEYS.issues],undefined);assert.ok(r.message.includes('原因候補：'));assert.equal(r.store.businessSentinel.retain,'架空業務情報');return r}finally{await p.close()}});
await test('S5 明示0件は1回で記録して即時スキップ',async()=>{const p=await newPage();try{await setup(p,{url:search(),body:html('<div id="js-bukkenList"></div><p>条件にあう物件がありません</p>'),store:state()});await p.evaluate(()=>api.collectIeloveSuumoResults());const r=await p.evaluate(()=>({choice:store.ielove_suumo_choices_v1?.[0],issues:api.issueList(),nav}));assert.equal(r.choice.__emptyResult,true);assert.equal(r.choice.__collectionError,false);assert.equal(r.issues.length,1);assert.equal(r.issues[0].attempts,1);assert.equal(r.nav.length,0);return r}finally{await p.close()}});
await test('S6 タブ保存状態が破損していれば候補を保存せず停止',async()=>{const p=await newPage();try{await setup(p,{url:search(),body:html(cards21),store:state()});await p.evaluate(()=>{sessionStorage.setItem('suumo_advanced_tab_runtime_v1_suumo_batch_active','{bad');});await p.evaluate(()=>api.collectIeloveSuumoResults());const r=await p.evaluate(()=>({choice:store.ielove_suumo_choices_v1,nav,message:document.querySelector('#tm-toast')?.textContent}));assert.equal(r.choice,undefined);assert.equal(r.nav.length,0);assert.ok(r.message.includes('保存'));return r}finally{await p.close()}});
await test('S3 URLの起動識別子不一致では自動開始しない',async()=>{const p=await newPage();try{await setup(p,{url:search().replace('suumo_jj_batch=qa','suumo_jj_batch=other'),body:html(cards21),store:state()});await p.evaluate(()=>api.collectIeloveSuumoResults());const r=await p.evaluate(()=>({store,nav}));assert.equal(r.store.ielove_suumo_choices_v1,undefined);assert.equal(r.nav.length,0);return r}finally{await p.close()}});
await test('S4 以前のGM進捗176/201を新タブが無視して検索を開始',async()=>{
 const s=state();
 s.suumo_batch_active=true;
 s.suumo_batch_owner_token='old-owner';
 s.suumo_batch_index=175;
 s.suumo_batch_urls=Array.from({length:201},(_,i)=>'https://suumo.jp/chintai/bc_'+(100000001+i)+'/');
 const ctx=await browser.newContext();
 try{
  await ctx.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:html(cards21)}));
  await ctx.addInitScript(({s,source})=>{
   if(!localStorage.getItem('qa-state'))localStorage.setItem('qa-state',JSON.stringify(s));
   const read=()=>JSON.parse(localStorage.getItem('qa-state'));
   window.GM_getValue=(k,d)=>{const z=read();return k in z?z[k]:d};
   window.GM_setValue=(k,v)=>{const z=read();z[k]=v;localStorage.setItem('qa-state',JSON.stringify(z))};
   window.GM_deleteValue=k=>{const z=read();delete z[k];localStorage.setItem('qa-state',JSON.stringify(z))};
   window.GM_xmlhttpRequest=()=>{};
   eval(source);
  },{s,source});
  const p=await ctx.newPage();
  const observations=[];
  for(let n=0;n<2;n++){
   if(!n)await p.goto(search());else await p.reload();
   await p.waitForFunction(()=>{
    const data=JSON.parse(localStorage.getItem('qa-state')||'{}');
    return Array.isArray(data.ielove_suumo_choices_v1?.[0]?.__companies);
   });
   observations.push(await p.evaluate(()=>{
    const data=JSON.parse(localStorage.getItem('qa-state')||'{}');
    return {count:document.querySelectorAll('.js-property').length,
     companies:data.ielove_suumo_choices_v1?.[0]?.__companies?.length||0,
     legacyActive:data.suumo_batch_active,
     legacyIndex:data.suumo_batch_index,
     newTabActive:sessionStorage.getItem('suumo_advanced_tab_runtime_v1_suumo_batch_active'),
     recoveryModal:!!document.getElementById('tm-stale-batch-recovery'),
     manager:data.profile_manager1};
   }));
  }
  assert.equal(observations[1].count,21);
  assert.ok(observations[1].companies>0);
  assert.equal(observations[1].legacyActive,true); // legacy saved bytes ignored, not erased
  assert.equal(observations[1].legacyIndex,175);
  assert.equal(observations[1].newTabActive,null);
  assert.equal(observations[1].recoveryModal,false);
  assert.equal(observations[1].manager,s.profile_manager1);
  fs.writeFileSync(process.env.QA_SEARCH_STATE_EVIDENCE||'/tmp/suumo-tab-close-s4-evidence.json',JSON.stringify(observations,null,2));
  return observations;
 }finally{await ctx.close()}
});
}finally{await browser.close()}fs.writeFileSync(process.env.QA_SEARCH_STATE_OUTPUT||'/tmp/suumo-search-state-results.json',JSON.stringify({results},null,2));console.log('TOTAL',results.length,'FAIL',results.filter(x=>x.status==='FAIL').length);if(results.some(x=>x.status==='FAIL'))process.exitCode=1})().catch(e=>{console.error(e);process.exitCode=1});

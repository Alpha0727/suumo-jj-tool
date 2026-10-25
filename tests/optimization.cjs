// Run: node tests/optimization.cjs (requires Playwright and Chromium).
// Regression benchmark against shipping v8.0.2; candidate is current TEST source. Only local fixtures; no real-site requests or submissions.
const {chromium} = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const old = fs.readFileSync(path.join(root,'releases/SUUMO-DEV-8.0.2.user.js'),'utf8');
const current = fs.readFileSync(path.join(root,'SUUMO-DEV.user.js'),'utf8');
const keyword = '東京都葛飾区金町3 2024年5月 1階 18.98m 6.7万円';
function search(pc=100, fw=keyword) {return 'https://suumo.jp/jj/chintai/ichiran/FR301FC011/?'+new URLSearchParams({fw,pc:String(pc),suumo_jj_batch:'fixture'})}
function card(i, opt={}) {
 const id = opt.id || String(100000000+i);
 const company = opt.company || '会社'+i%3;
 return `<div class="js-property property-body"><div class="property_inner-title"><a href="/chintai/bc_${id}/">物件 ${opt.floor||1}階 ${opt.room||101}号室</a></div>
 <input name="bc" value="${id}"><input name="clipkey" value="${opt.conflict||id}">
 <div class="detailbox-property-point">${opt.rent||6.7}万円</div>
 <table class="detailbox-property"><tr><td>間取</td><td>費用</td><td>${opt.missing?'':opt.area||18.98}m2</td><td>その他</td><td>${opt.address||'東京都葛飾区金町3丁目'}</td></tr></table>
 ${opt.noLink ? `<div class="detailnote-box-item"><div>${opt.noName?'':company}</div></div>` : `<a href="/chintai/kaisha/${company}/">${company}</a><div class="detailnote-box-item">${'<div>予備情報</div>'.repeat(20)}</div>`}</div>`;
}
function html(cards,next=0,pc=100){return `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="js-bukkenList">${cards.join('')}</div>${!cards.length?'<p>条件にあう物件がありません</p>':''}${next?`<a href="${search(pc)}&pn=${next}">次へ</a>`:''}<!--${'padding'.repeat(200)}--></body></html>`}
function expose(source){const exposed=source.replace('  init();\n})();',`  globalThis.api={scanIeloveSuumoPages,readSuumoRoomCard,collectIeloveSuumoResults,isIeloveSelectionReady,openIeloveSuumoSelection,startIeloveSuumoReporting,blockUncertainIeloveResend,submitCurrentAndContinue,autofill,ieloveFormMismatch,buildIeloveSuumoSearch,setBatch,bindListingToTab,queuePageTransition,isCurrentTabItem,tabGet,tabSet};\n})();`);return source.includes("function tabGet(")?exposed:exposed.replace(",tabGet,tabSet}","}")}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 let passed=0;
 const results=[];
 async function run(source, pages, opt={}) {
  const page=await browser.newPage();
  const url=search(opt.pc||100);
  const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
  await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:pages[0]}));
  await page.goto(url);
  await page.evaluate(({pages,opt,url})=>{
   window.store={manager1_required_initialized_20261015:true,date_defaults_migrated_20261015:true,profile_manager1:'テスト担当'};
   window.GM_getValue=(k,d)=>k in store?structuredClone(store[k]):d;
   window.GM_setValue=(k,v)=>{store[k]=structuredClone(v)};
   window.GM_deleteValue=k=>{delete store[k]};window.GM_xmlhttpRequest=()=>{};
   window.store.ielove_suumo_handoff_v1={token:'fixture',index:0,records:[{name:'テスト',room:'101'}],searches:[{url}]};
   window.calls=[];window.inFlight=0;window.peak=0;
   window.parseMs=0;
   const parse=DOMParser.prototype.parseFromString;
   DOMParser.prototype.parseFromString=function(...args){const t=performance.now();try{return parse.apply(this,args)}finally{window.parseMs+=performance.now()-t}};
   const nativeTimeout=window.setTimeout;
   if(opt.timeout)window.setTimeout=(fn,ms,...args)=>nativeTimeout(fn,ms===12000?40:ms,...args);
   window.fetch=async(url,init)=>{
    const n=Number(new URL(url).searchParams.get('pn')||1);
    calls.push(n);inFlight++;peak=Math.max(peak,inFlight);
    try {
     if(opt.latency)await new Promise(r=>nativeTimeout(r,opt.latency));
     if(opt.cancel)store.ielove_suumo_handoff_v1.token='changed';
     if(opt.stop)sessionStorage.setItem("suumo_advanced_tab_runtime_v1_suumo_batch_active","true");
     if(opt.changeIndex)store.ielove_suumo_handoff_v1.index=1;
     if(opt.timeout)await new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError')),{once:true}));
     if(opt.fail || (opt.once && calls.length===1))throw new TypeError('network failure');
     const status=opt.status||200;
     return {ok:status===200,status,headers:new Headers({'content-type':opt.nonHtml?'application/json':'text/html',...(opt.retryAfter?{'retry-after':opt.retryAfter}:{})}),text:async()=>pages[n-1]||pages.at(-1)};
    } finally {inFlight--}
   };
  },{pages,opt,url});
  await page.addScriptTag({content:expose(source)});
  const output=await page.evaluate(async({url,collect})=>{
   const start=performance.now();let groups,error;
   const timings=[];const original=console.debug;console.debug=(label,r)=>{timings.push(r)};
   try{if(collect)await api.collectIeloveSuumoResults();else groups=await api.scanIeloveSuumoPages(url,0)}catch(e){error=e.message}
   console.debug=original;
   return {groups,error,ms:performance.now()-start,parseMs:window.parseMs,calls,peak,timings,store,dialog:!!document.querySelector('#tm-ielove-suumo-selection'),issueDialog:!!document.querySelector('#tm-advanced-issue-results')};
  },{url,collect:opt.collect});
  assert.deepEqual(pageErrors,[]);
  await page.close();return output;
 }
 try {
  const cases=[
   ['zero',[html([])]],['one',[html([card(1)])]],
   ['30',[html(Array.from({length:30},(_,i)=>card(i)))]],
   ['100',[html(Array.from({length:100},(_,i)=>card(i))),html([])]],
   ['101',[html(Array.from({length:100},(_,i)=>card(i)),2),html([card(100)])]],
   ['duplicate',[html([card(1),card(1),card(2)])]],
   ['different rooms same conditions',[html([card(1,{room:101}),card(2,{room:102}),card(3,{floor:2}),card(4,{area:19}),card(5,{rent:7}),card(6,{address:'東京都葛飾区金町4'})])]],
   ['no company link',[html([card(1,{noLink:true})])]],
   ['missing area excluded',[html([card(1,{missing:true}),card(2)])]],
   ['missing company stops',[html([card(1,{noLink:true,noName:true})])]],
   ['ambiguous id stops',[html([card(1,{conflict:'999999999'})])]],
   ['company conflict stops',[html([card(1),card(1,{company:'別会社'})])]],
   ['missing next page stops',[html([card(1)],2),html([])]],
   ['repeated next page stops',[html([card(1)],2),html([card(1)],2)]],
   ['30 per page',[html(Array.from({length:30},(_,i)=>card(i)),2,30),html([card(30)])],{pc:30}],
  ];
  for(const [name,pages,opt] of cases){
   const a=await run(old,pages,opt);const b=await run(current,pages,opt);
   assert.deepEqual(b.groups,a.groups,name);if(['one','30','100','101','duplicate','different rooms same conditions','no company link','missing area excluded','30 per page'].includes(name))assert.ok(b.groups?.length,name);if(name==='different rooms same conditions')assert.equal(b.groups.reduce((n,g)=>n+g.urls.length,0),2);if(name==='missing area excluded')assert.equal(b.groups.reduce((n,g)=>n+g.urls.length,0),1);if(['missing company stops','ambiguous id stops','company conflict stops'].includes(name))assert.ok(b.error,name);if(name==='zero'){assert.equal(b.error,undefined);assert.deepEqual(b.groups,[])}assert.equal(!!b.error,!!a.error,name);
   assert.deepEqual(b.calls,a.calls,name);assert.ok(b.peak<=1);
   console.log('PASS parity:',name,a.error?'(safe stop)':'');passed++;
  }
  const multi=[html([card(1)],2),html([card(2)])];
  for(const [name,opt,expectCalls] of [['retry success',{once:true},3],['network failure',{fail:true},3],['timeout',{timeout:true},3],['403 no retry',{status:403},1],['429 retry',{status:429},3],['long Retry-After stops',{status:429,retryAfter:'120'},1],['non HTML stops',{nonHtml:true},1],['changed handoff stops',{cancel:true},1],['stopped during fetch',{stop:true},1],['changed property during fetch',{changeIndex:true},1]]){
   const b=await run(current,multi,{...opt,collect:true});assert.equal(b.calls.length,expectCalls,name);
   const choice=b.store.ielove_suumo_choices_v1?.[0];
   if(opt.once)assert.ok(!choice.__collectionError,name);else if(!opt.cancel&&!opt.stop&&!opt.changeIndex)assert.equal(choice.__collectionError,true,name);else assert.equal(choice,undefined,name);assert.ok(b.peak<=1);console.log('PASS recovery:',name);passed++;
  }
  const success=await run(current,[html([card(1)])],{collect:true});
  assert.ok(success.dialog);assert.ok(success.store.ielove_suumo_choices_v1[0].__companies.length);
  const failure=await run(current,multi,{fail:true,collect:true});
  assert.equal(failure.store.ielove_suumo_choices_v1[0].__collectionError,true);assert.ok(failure.issueDialog);
  console.log('PASS collection: auto selection and failed scan never saves partial candidates');passed++;
  // Real page navigation inside intercepted browser: two properties, then resume from saved choices.
  {
   const context=await browser.newContext();
   const page=await context.newPage();
   const urls=[search(),search(100,keyword.replace('6.7万円','6.8万円'))];
   const initial={manager1_required_initialized_20261015:true,date_defaults_migrated_20261015:true,profile_manager1:'テスト担当',ielove_suumo_handoff_v1:{token:'fixture',index:0,records:[{name:'一件目'},{name:'二件目'}],searches:urls.map(url=>({url}))}};
   const navigations=[];
   await context.route('**/*',r=>{
    assert.equal(r.request().method(),'GET');
    const i=new URL(r.request().url()).searchParams.get('fw').includes('6.8万円')?1:0;
    navigations.push(i);
    r.fulfill({contentType:'text/html; charset=utf-8',body:html([card(i+1,{rent:i?6.8:6.7})])});
   });
   await page.addInitScript(({initial,source})=>{
    if(!localStorage.getItem('fixture-store'))localStorage.setItem('fixture-store',JSON.stringify(initial));
    const read=()=>JSON.parse(localStorage.getItem('fixture-store'));
    window.GM_getValue=(k,d)=>{const s=read();return k in s?s[k]:d};
    window.GM_setValue=(k,v)=>{const s=read();s[k]=v;localStorage.setItem('fixture-store',JSON.stringify(s))};
    window.GM_deleteValue=k=>{const s=read();delete s[k];localStorage.setItem('fixture-store',JSON.stringify(s))};
    window.GM_xmlhttpRequest=()=>{};
    window.confirm=()=>false;
    eval(source);
   },{initial,source:current});
   await page.goto(urls[0]);
   await page.locator('#tm-ielove-suumo-selection [data-company-key]').nth(1).waitFor();
   assert.deepEqual(navigations,[0,1]);
   let saved=await page.evaluate(()=>GM_getValue('ielove_suumo_choices_v1'));
   assert.equal(saved[0].__companies[0].urls[0],'https://suumo.jp/chintai/bc_100000001/');
   assert.equal(saved[1].__companies[0].urls[0],'https://suumo.jp/chintai/bc_100000002/');
   await page.locator('[data-property-index="0"] button[data-choice="once"]').click();
   await page.locator('[data-property-index="1"] button[data-choice="permanent"]').click();
   await page.reload();
   await page.locator('#tm-ielove-suumo-selection [data-company-key]').nth(1).waitFor();
   saved=await page.evaluate(()=>GM_getValue('ielove_suumo_choices_v1'));
   assert.equal(saved[0][saved[0].__companies[0].key],'once');
   assert.ok((await page.evaluate(()=>GM_getValue('ielove_suumo_excluded_company_ids_v1'))).length);
   assert.deepEqual(navigations,[0,1,1]); // Reload only; no extra fetch of completed properties.
   await context.close();
   console.log('PASS navigation: two properties, automatic selection, exclusions, reload/resume cached choices');passed++;
  }
  {
   const blank='<!doctype html><html><body>ログインが必要です</body></html>'+' '.repeat(1100);
   const stopped=await run(current,[html(Array.from({length:100},(_,i)=>card(i))),blank]);
   assert.match(stopped.error,/0件表示/);
   const cycle=await run(current,[html([card(1)],2),html([card(2)],3),html([card(1)],4)]);
   assert.match(cycle.error,/循環/);
   console.log('PASS terminal safety: unknown empty page and nonadjacent page cycle stop');passed++;
  }
  {
   const page=await browser.newPage();
   await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><body>'+['textSinkokuKaisya','textSinkokusyaName','renrakusakiTelNo','textSinkokuMail','js-textKanriKaisya','js-textKanriKaisyaTel','js-textKanriKaisyaTantouName','js-textMansitu'].map(id=>`<input id="${id}">`).join('')+'<a class="js-clickToForm" rel="/jj/chintai/shiryou/FR400FG002/">確認</a></body></html>'}));
   await page.goto('https://suumo.jp/jj/chintai/shiryou/FR400FG001/');
   await page.evaluate(()=>{
    const profile={mgmt_company:'管理会社',mgmt_tel:'0312345678',manager2:'担当',room:'101'};
    window.store={manager1_required_initialized_20261015:true,date_defaults_migrated_20261015:true,profile_manager1:'担当者',suumo_batch_active:true,suumo_batch_owner_token:'owner',suumo_batch_urls:[location.href],suumo_batch_index:0,ielove_suumo_execution_v1:{items:[{url:location.href,profile,status:'pending'}]}};
    sessionStorage.setItem('suumo_batch_tab_owner_token','owner');
    window.GM_getValue=(k,d)=>k in store?structuredClone(store[k]):d;window.GM_setValue=(k,v)=>{store[k]=structuredClone(v)};window.GM_deleteValue=k=>{delete store[k]};
    window.clicks=0;document.querySelector('a').onclick=()=>{clicks++};
   });
   await page.addScriptTag({content:expose(current)});
   const result=await page.evaluate(async()=>{
    const execution=store.ielove_suumo_execution_v1;execution.items[0].url='https://suumo.jp/chintai/bc_100000001/';api.tabSet('ielove_suumo_execution_v1',execution);const old=location.href;history.replaceState(null,'',execution.items[0].url);api.setBatch([execution.items[0].url],0,'ielove');api.bindListingToTab();api.queuePageTransition('input');history.pushState(null,'',old);api.isCurrentTabItem();await api.autofill(false);const filled=document.querySelector('#js-textMansitu').value;
    api.tabSet('suumo_batch_form_ready',true);api.tabSet('suumo_batch_stage','input-ready');document.querySelector('#js-textMansitu').value='999';await api.submitCurrentAndContinue();
    const blocked=api.tabGet('suumo_batch_error',false)&&clicks===0;
    document.querySelector('#js-textMansitu').value='101';api.tabSet('suumo_batch_error',false);api.tabSet('suumo_batch_form_ready',true);
    await api.submitCurrentAndContinue();const first=clicks;
    await api.submitCurrentAndContinue();await api.submitCurrentAndContinue();const final=clicks;
    const e=api.tabGet('ielove_suumo_execution_v1');e.items[0].status='sending';api.tabSet('ielove_suumo_execution_v1',e);
    const ctx=JSON.parse(sessionStorage.getItem('suumo_advanced_tab_item_context_v1'));const marker={...ctx,id:'mock-post',itemId:ctx.id,status:'sending',startedAt:Date.now()};api.tabSet('suumo_advanced_final_send_guard_v1',marker);sessionStorage.setItem('suumo_advanced_tab_sent_context_v1',JSON.stringify(marker));const uncertain=api.blockUncertainIeloveResend();return {filled,blocked,first,final,uncertain};
   });
   assert.deepEqual(result,{filled:'101',blocked:true,first:1,final:1,uncertain:true});
   await page.close();
   console.log('PASS form simulation: profile autofill, mismatch stop, native confirmation, duplicate click prevention, uncertain-send stop');passed++;
  }
  // Test metadata is intentionally isolated; runtime keys move to sessionStorage.
  assert.match(current,/@namespace\s+jp\.re\.autofill\.suumo\.codex\.test/);
  assert.doesNotMatch(current,/^\/\/ @(?:updateURL|downloadURL)/m);
  assert.match(current,/@exclude\s+https:\/\/suumo\.jp\/\*/);
  console.log('PASS TEST isolation metadata');passed++;
  // Browser benchmark: identical local HTML and simulated 300ms response latency; actual elapsed wall time.
  const pages=[html(Array.from({length:100},(_,i)=>card(i)),2),html(Array.from({length:100},(_,i)=>card(100+i)),3),html(Array.from({length:100},(_,i)=>card(200+i)),4),html([card(300)])];
  for(let i=0;i<3;i++){
   const a=await run(old,pages,{latency:300});const b=await run(current,pages,{latency:300});
   assert.deepEqual(b.groups,a.groups);assert.deepEqual(b.calls,a.calls);
   results.push({oldMs:a.ms,newMs:b.ms,requests:a.calls.length,oldParseMs:a.parseMs,newParseMs:b.parseMs,newMetrics:b.timings});
  }
  const parserBench=[];
  for(const source of [old,current]){
   const page=await browser.newPage();await page.goto('about:blank');
   await page.evaluate(()=>{window.GM_getValue=(k,d)=>d;window.GM_setValue=()=>{};window.GM_deleteValue=()=>{}});
   await page.addScriptTag({content:expose(source)});
   const sample=html(Array.from({length:1000},(_,i)=>card(i)));
   parserBench.push(await page.evaluate(html=>{
    const doc=new DOMParser().parseFromString(html,'text/html');const cards=[...doc.querySelectorAll('.js-property')];
    cards.map(api.readSuumoRoomCard); // warmup
    const samples=[];for(let i=0;i<5;i++){const t=performance.now();const rows=cards.map(api.readSuumoRoomCard);samples.push(performance.now()-t);if(rows.length!==1000)throw Error('wrong count')}
    return samples;
   },sample));await page.close();
  }
  console.log('PARSER_BENCH_1000_CARDS',JSON.stringify(parserBench));
  console.log(JSON.stringify({passed,benchmark:results,parserBench},null,2));
  fs.writeFileSync(process.env.QA_OPTIMIZATION_OUTPUT||'/tmp/suumo-optimization.json',JSON.stringify({environment:'Headless Chromium, local generated fixtures, simulated 300ms response latency; not live SUUMO',passed,benchmark:results,parserBench},null,2)+'\n');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

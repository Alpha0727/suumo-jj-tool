// Run: node tests/optimization.cjs (requires Playwright and Chromium).
// Regression benchmark pinned to v7.54.8 archive. Only local fixtures; no real-site requests or submissions.
const {chromium} = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const old = require('node:child_process').execFileSync('git',['show','85735877cb3af393a4c6b5413c452544c94a1c7d:SUUMO-DEV.user.js'],{cwd:root,encoding:'utf8'});
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
function expose(source){return source.replace('  init();\n})();',`  globalThis.api={scanIeloveSuumoPages,readSuumoRoomCard,collectIeloveSuumoResults,isIeloveSelectionReady,openIeloveSuumoSelection,startIeloveSuumoReporting,blockUncertainIeloveResend,submitCurrentAndContinue,autofill,ieloveFormMismatch,buildIeloveSuumoSearch};\n})();`)}

(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const tests=[],benchmark=[];
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
     if(opt.stop)store.suumo_batch_active=true;
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
   return {groups,error,ms:performance.now()-start,parseMs:window.parseMs,calls,peak,timings,store,dialog:!!document.querySelector('#tm-ielove-suumo-selection')};
  },{url,collect:opt.collect});
  assert.deepEqual(pageErrors,[]);
  await page.close();return output;
 }

try{
const cases=[['zero',[html([])]],['one',[html([card(1)])]],['30',[html(Array.from({length:30},(_,i)=>card(i)))]],['100',[html(Array.from({length:100},(_,i)=>card(i))),html([])]],['101',[html(Array.from({length:100},(_,i)=>card(i)),2),html([card(100)])]],['duplicate',[html([card(1),card(1),card(2)])]],['different rooms',[html([card(1,{room:101}),card(2,{room:102}),card(3,{floor:2}),card(4,{area:19}),card(5,{rent:7}),card(6,{address:'東京都葛飾区金町4'})])]],['no company link',[html([card(1,{noLink:true})])]],['missing area',[html([card(1,{missing:true}),card(2)])]]];
for(const [name,pages] of cases){const a=await run(old,pages),b=await run(current,pages);assert.deepEqual(b.groups,a.groups);assert.equal(b.error,undefined);tests.push({name,status:'PASS',urls:b.groups.reduce((n,g)=>n+g.urls.length,0)});console.log('PASS baseline vs current',name)}
const pages=[html(Array.from({length:100},(_,i)=>card(i)),2),html(Array.from({length:100},(_,i)=>card(100+i)),3),html(Array.from({length:100},(_,i)=>card(200+i)),4),html([card(300)])];
for(let i=0;i<3;i++){const a=await run(old,pages,{latency:300}),b=await run(current,pages,{latency:300});assert.deepEqual(a.groups,b.groups);benchmark.push({oldMs:a.ms,newMs:b.ms,oldRequests:a.calls.length,newRequests:b.calls.length,oldParseMs:a.parseMs,newParseMs:b.parseMs})}
const out={baselineCommit:'85735877cb3af393a4c6b5413c452544c94a1c7d',baselineSha256:require('crypto').createHash('sha256').update(old).digest('hex'),candidateSha256:require('crypto').createHash('sha256').update(current).digest('hex'),oldVersion:old.match(/@version\s+(\S+)/)[1],newVersion:current.match(/@version\s+(\S+)/)[1],tests,benchmark};fs.writeFileSync(process.env.QA_COMPARISON_OUTPUT||'/tmp/suumo-search-regression.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

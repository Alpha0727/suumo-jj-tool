// Run: node tests/memory.cjs (requires Playwright and Chromium).
// Memory comparison with shipping v8.0.2; candidate is current source; no real-site requests or submissions.
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
function expose(source){return source.replace('  init();\n})();',`  globalThis.api={scanIeloveSuumoPages,readSuumoRoomCard,collectIeloveSuumoResults,isIeloveSelectionReady,openIeloveSuumoSelection,startIeloveSuumoReporting,blockUncertainIeloveResend,submitCurrentAndContinue,autofill,ieloveFormMismatch,buildIeloveSuumoSearch};\n})();`)}

(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{const results=[];for(const source of [old,current]){const page=await browser.newPage();await page.goto('about:blank');await page.evaluate(()=>{window.GM_getValue=(k,d)=>d;window.GM_setValue=()=>{};window.GM_deleteValue=()=>{}});await page.addScriptTag({content:expose(source)});const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');const before=await cdp.send('Runtime.getHeapUsage');await page.evaluate(html=>{window.doc=new DOMParser().parseFromString(html,'text/html');window.rows=[...doc.querySelectorAll('.js-property')].map(api.readSuumoRoomCard)},html(Array.from({length:1000},(_,i)=>card(i))));await cdp.send('HeapProfiler.collectGarbage');const after=await cdp.send('Runtime.getHeapUsage');results.push({before,after});await page.close()}fs.writeFileSync(process.env.QA_MEMORY_OUTPUT||'/tmp/suumo-memory.json',JSON.stringify({description:'1000 synthetic cards, one retained DOM and parsed rows, CDP heap after GC; not peak process memory',results},null,2)+'\n');console.log(JSON.stringify(results));}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

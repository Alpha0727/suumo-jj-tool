// Node.js built-in regression test for the exact helper extracted from the userscript.
// No SUUMO requests, POST, or actual form submissions are executed.
// Run: node --test tests/fast-report-navigation.cjs
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=fs.readFileSync(require("node:path").join(__dirname,"..","SUUMO-DEV.user.js"),"utf8");
const begin=source.indexOf('  const FAST_REPORT_NAV_KEY = ');
const end=source.indexOf('  let nextListingStarted = false;',begin);
assert.ok(begin>0&&end>begin,"Missing v8 helper");
const helper=source.slice(begin,end);
const id="100529137600";
const listing="https://suumo.jp/chintai/bc_"+id+"/";
const input="https://suumo.jp/jj/chintai/shiryou/FR400FG001/?bc="+id;
function doc(href=input,attrs={}) {
 return {querySelector:()=>href===null?null:{
  tagName:"A",hasAttribute:key=>Boolean(attrs[key]),
  getAttribute:key=>key==="href"?href:null
 }};
}
function setup(o={}) {
 const nav=[],tickets=[],gets=[];
 let active=true;
 const location={origin:"https://suumo.jp",assign:url=>nav.push(["input",url])};
 Object.defineProperty(location,"href",{
  get:()=>"https://suumo.jp/jj/chintai/shiryou/FR400FG003/",
  set:url=>nav.push(["listing",url])
 });
 const ctx={
  URL,AbortController,location,
  sessionStorage:{getItem:()=>o.enabled===false?"0":"1"},
  batchTaskStillCurrent:()=>active,
  setTimeout,clearTimeout,
  DOMParser:class{parseFromString(){return o.doc||doc()}},
  currentUncertainSend:()=>Boolean(o.uncertain),
  GM_getValue:()=>o.guard||null,
  FINAL_SEND_GUARD_KEY:"guard",
  queuePageTransition:kind=>{tickets.push(kind);return o.ticket!==false},
  console:{info(){},debug(){}},
  fetch:async(url,init)=>{
   gets.push({url,method:init.method,credentials:init.credentials});
   if(o.stale)active=false;
   if(o.error)throw Error("synthetic network error");
   return {
    ok:o.ok!==false,url:o.redirect||url,
    headers:new Headers({"content-type":o.mime||"text/html"}),
    text:async()=>o.html||"x".repeat(1200)
   };
  }
 };
 vm.createContext(ctx);
 vm.runInContext(helper+'\nglobalThis.api={directReportInputUrlFromListingDoc,navigateNextListingWithoutDisplay};',ctx);
 return {api:ctx.api,nav,tickets,gets};
}
test("V8 source parses and is clearly versioned",()=>{
 assert.match(source,/\/\/ @version\s+8\.0/);
 assert.match(source,/const SCRIPT_VERSION = "8\.0"/);
 new vm.Script(source);
});
test("Only source-listed and listing-ID-bound GET form links are accepted",()=>{
 const {api}=setup();
 assert.equal(api.directReportInputUrlFromListingDoc(doc(),listing),input);
 for(const [bad,attrs] of [
  [input.replace(id,"100529137601"),{}],
  [input.replace("suumo.jp","evil.example"),{}],
  [input.replace("FR400FG001","FR400FG002"),{}],
  ["javascript:void(0)",{}],
  [input.replace("?bc="+id,""),{}],
  [input,{onclick:true}],
  [input,{target:true}],
  [null,{}]
 ]) assert.equal(api.directReportInputUrlFromListingDoc(doc(bad,attrs),listing),null);
});
test("A validated listing-bound form avoids rendering the next listing document",async()=>{
 const x=setup();await x.api.navigateNextListingWithoutDisplay({},listing);
 assert.deepEqual(x.nav,[["input",input]]);
 assert.deepEqual(x.tickets,["input"]);
 assert.deepEqual(x.gets,[{url:listing,method:"GET",credentials:"same-origin"}]);
});
test("When unsupported, the old path is used without even fetching",async()=>{
 const x=setup({enabled:false});await x.api.navigateNextListingWithoutDisplay({},listing);
 assert.deepEqual(x.nav,[["listing",listing]]);
 assert.deepEqual(x.tickets,["listing"]);
 assert.equal(x.gets.length,0);
});
for(const [label,opts] of [
 ["network error",{error:true}],
 ["non-2xx result",{ok:false}],
 ["non-HTML result",{mime:"application/json"}],
 ["login redirect",{redirect:"https://suumo.jp/login/"}],
 ["unexpectedly short HTML",{html:"too short"}],
 ["different listing ID",{doc:doc(input.replace(id,"100529137601"))}],
 ["unresolved send",{guard:{status:"sending"}}],
 ["uncertain send",{uncertain:true}]
])test("Legacy fallback on "+label,async()=>{
 const x=setup(opts);await x.api.navigateNextListingWithoutDisplay({},listing);
 assert.deepEqual(x.nav,[["listing",listing]]);
 assert.deepEqual(x.tickets,["listing"]);
 assert.equal(x.gets.length,1);
});
test("Stale asynchronous GET cannot navigate the next listing",async()=>{
 const x=setup({stale:true});await x.api.navigateNextListingWithoutDisplay({},listing);
 assert.deepEqual(x.nav,[]);assert.deepEqual(x.tickets,[]);
});
test("Failed transition-ticket persistence never navigates either path",async()=>{
 const x=setup({ticket:false});await x.api.navigateNextListingWithoutDisplay({},listing);
 assert.deepEqual(x.nav,[]);
 assert.deepEqual(x.tickets,["input","listing"]);
});

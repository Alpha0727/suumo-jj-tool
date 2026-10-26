// Regression for the v8.0.2-style shared live execution model.
// Run: node --test tests/report-popup-handoff.cjs
// No real website requests, login, form input, or POST.
"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"..","SUUMO-DEV.user.js"),"utf8");
function extract(name) {
 const start=source.indexOf("  function "+name+"(");
 assert.ok(start>=0,name+" not found");
 const end=source.indexOf("\n  }\n",start);
 assert.ok(end>start,name+" end not found");
 return source.slice(start,end+5);
}
const functions=["validTabRuntimeValue","tabGet","tabSet","tabDelete","isBatchOwnerTab","isBatchActive","isAnyBatchActive"];
const runtime=functions.map(extract).join("\n");
function fixture(storage=new Map(),tabState=new Map(),blocked=false) {
 const globalStore={
  get:(k,def)=>storage.has(k)?structuredClone(storage.get(k)):def,
  set:(k,v)=>{if(blocked)throw Error("blocked");storage.set(k,structuredClone(v));},
  remove:k=>{if(blocked)throw Error("blocked");storage.delete(k);}
 };
 let warning=0;
 const ctx={
  GM_getValue:globalStore.get,GM_setValue:globalStore.set,GM_deleteValue:globalStore.remove,
  sessionStorage:{getItem:k=>tabState.get(k)||null,setItem:(k,v)=>tabState.set(k,String(v)),removeItem:k=>tabState.delete(k)},
  BATCH_KEYS:{active:"suumo_batch_active",ownerToken:"suumo_batch_owner_token",urls:"suumo_batch_urls",index:"suumo_batch_index"},
  TAB_OWNER_TOKEN_KEY:"suumo_batch_tab_owner_token",
  failTabRuntime:()=>{warning++},
  getTabOwnerToken:()=>tabState.get("suumo_batch_tab_owner_token")||"",
  tabRuntimeFault:false
 };
 vm.createContext(ctx);
 vm.runInContext(runtime+"\nglobalThis.runtime = {get:tabGet,set:tabSet,del:tabDelete,active:isBatchActive,anyActive:isAnyBatchActive,owner:isBatchOwnerTab};",ctx);
 return {api:ctx.runtime,global:storage,tab:tabState,warnings:()=>warning};
}
test("UI is initialized before any progress check in the real SUUMO entry point",()=>{
 const init=source.slice(source.indexOf("  async function init()"),source.lastIndexOf("\n  init();"));
 const pos=init.indexOf('if (location.hostname !== "suumo.jp") return;');
 const ui=init.indexOf("addMainButtons();",pos);
 const gate=init.indexOf("if (tabRuntimeFault) return;",pos);
 assert.ok(pos>=0&&ui>pos&&gate>ui);
 assert.doesNotMatch(init,/discardOpenedTabRuntime/);
});
test("No strict window.name or popup-state rejection remains",()=>{
 assert.doesNotMatch(source,/discardOpenedTabRuntime|acceptReportPopupHandoff|TAB_WINDOW_ID_KEY|TAB_RUNTIME_PREFIX/);
 assert.doesNotMatch(source,/showStaleBatchRecoveryDialog\(/);
});
test("GM shared execution permits real separate report tab with same owner token",()=>{
 const GM=new Map(),original=new Map([["suumo_batch_tab_owner_token","live-owner"]]);
 const sourceTab=fixture(GM,original),report=fixture(GM,new Map(original));
 sourceTab.api.set("suumo_batch_owner_token","live-owner");
 sourceTab.api.set("suumo_batch_active",true);
 sourceTab.api.set("suumo_batch_urls",["https://suumo.jp/chintai/bc_100531168931/"]);
 assert.equal(report.api.active(),true);
 report.api.set("suumo_batch_index",0);
 assert.deepEqual(sourceTab.api.get("suumo_batch_urls",[]),["https://suumo.jp/chintai/bc_100531168931/"]);
});
test("Cloned batch state never grants new tab ownership unless owner token matches",()=>{
 const GM=new Map([["suumo_batch_active",true],["suumo_batch_owner_token","old-owner"]]);
 for(const tab of [new Map(),new Map([["suumo_batch_tab_owner_token","different"]])]){
  const f=fixture(GM,tab);
  assert.equal(f.api.active(),false);assert.equal(f.api.anyActive(),false);
 }
});
test("Closing the owner tab leaves no resumable batch in an unrelated fresh tab",()=>{
 const GM=new Map(),old=fixture(GM,new Map([["suumo_batch_tab_owner_token","prior"]]));
 old.api.set("suumo_batch_owner_token","prior");old.api.set("suumo_batch_active",true);
 const fresh=fixture(GM,new Map());
 assert.equal(fresh.api.active(),false);
 assert.equal(fresh.api.anyActive(),false);
});
test("New run replaces dormant old shared values without restoring old progress",()=>{
 const GM=new Map([["suumo_batch_active",true],["suumo_batch_index",176],["suumo_batch_owner_token","old"]]);
 const f=fixture(GM,new Map([["suumo_batch_tab_owner_token","new"]]));
 assert.equal(f.api.active(),false);
 f.api.set("suumo_batch_owner_token","new");
 f.api.set("suumo_batch_index",0);
 f.api.set("suumo_batch_active",true);
 assert.equal(f.api.active(),true);
 assert.equal(f.api.get("suumo_batch_index",99),0);
});
test("Missing owner token uses its fallback, not a false corruption warning",()=>{
 const f=fixture();
 assert.equal(f.api.get("suumo_batch_owner_token",""),"");
 assert.equal(f.api.active(),false);
 assert.equal(f.warnings(),0);
});
test("Corrupt shared execution state fails closed",()=>{
 const GM=new Map([["suumo_batch_active","true"],["suumo_batch_owner_token","live"]]);
 const f=fixture(GM,new Map([["suumo_batch_tab_owner_token","live"]]));
 assert.equal(f.api.active(),false);
 assert.ok(f.warnings()>0);
});
test("GM storage failure cannot silently proceed",()=>{
 const f=fixture(new Map(),new Map(),true);
 assert.throws(()=>f.api.set("suumo_batch_active",true));
 assert.equal(f.api.active(),false);
 assert.ok(f.warnings()>0);
});
test("Completion and send guards remain in source",()=>{
 for(const pattern of [/navigator\.locks\.request/,/function isCurrentTabItem\(/,/function queuePageTransition\(/,
 /function isCurrentTabSent\(/,/function handleConfirmPage\(/,/function handleCompletePage\(/])
  assert.match(source,pattern);
 new vm.Script(source);
});

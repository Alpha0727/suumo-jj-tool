// Codex TEST ONLY. Fast unit/regression checks for tab-scoped state.
// Run: node --test tests/tab-runtime-lifecycle.cjs
// All data is simulated; no SUUMO or いえらぶ access and no POST.
"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const src=fs.readFileSync(path.join(__dirname,"..","SUUMO-DEV.user.js"),"utf8");
function sourceBetween(begin,end){
  const a=src.indexOf(begin),b=src.indexOf(end,a);
  assert.ok(a>=0&&b>a,"Missing source boundary: "+begin);
  return src.slice(a,b);
}
const tabHelpers=sourceBetween("  const TAB_RUNTIME_PREFIX =", "  const TAB_OWNER_TOKEN_KEY =");
const stages=sourceBetween("  function getBatchStage()","  function createBatchOwnerToken()");
const activeHelpers=sourceBetween("  function getBatchUrls()","  function requireProfileManager()");
function makeStorage(shared=new Map()){
 return {
  getItem:k=>shared.has(k)?shared.get(k):null,
  setItem:(k,v)=>{shared.set(k,String(v))},
  removeItem:k=>{shared.delete(k)},
  get length(){return shared.size}
 };
}
function makeTab(store=makeStorage()){
 const gm=new Map([["suumo_batch_active",true],["profile_manager1","keep"]]);
 const ctx={
  sessionStorage:store,console:{warn:()=>{}},
  GM_getValue:(k,d)=>gm.has(k)?gm.get(k):d,
  GM_setValue:(k,v)=>gm.set(k,v),
  GM_deleteValue:k=>gm.delete(k),
  BATCH_KEYS:{
   active:"suumo_batch_active",urls:"suumo_batch_urls",index:"suumo_batch_index",
   stage:"suumo_batch_stage",submitting:"suumo_batch_submitting",
   confirmReady:"suumo_batch_confirm_ready",error:"suumo_batch_error",
   formReady:"suumo_batch_form_ready",ownerToken:"suumo_batch_owner_token"
  },
  STAGES:{LISTING:"listing"},
  isBatchOwnerTab:()=>true
 };
 vm.createContext(ctx);
 vm.runInContext(tabHelpers+"\n"+stages+"\n"+activeHelpers+
  "\nglobalThis.api={tabGet,tabSet,tabDelete,getBatchStage,setBatchStage,getBatchIndex,getBatchUrls,isBatchActive,isAnyBatchActive,setSubmitting,isSubmitting};",ctx);
 return {...ctx,api:ctx.api,gm,store};
}
test("TEST metadata cannot auto-run on real SUUMO or いえらぶ",()=>{
 assert.match(src,/\/\/ @name\s+SUUMO JJ 上位版【CODEX TEST ONLY】/);
 assert.match(src,/\/\/ @namespace\s+jp\.re\.autofill\.suumo\.codex\.test/);
 assert.match(src,/\/\/ @exclude\s+https:\/\/suumo\.jp\/\*/);
 assert.match(src,/\/\/ @exclude\s+https:\/\/cloud\.ielove\.jp\/\*/);
 assert.doesNotMatch(src,/^\/\/ @updateURL/m);
 assert.doesNotMatch(src,/^\/\/ @downloadURL/m);
 assert.match(src,/\/\/ @version\s+8\.0\.3/);
 new vm.Script(src);
});
test("Legacy GM active and 176/201 stale records do not start in a fresh SUUMO tab",()=>{
 const f=makeTab();
 f.gm.set("suumo_batch_index",175);
 f.gm.set("suumo_batch_urls",Array.from({length:201},(_,i)=>"listing"+i));
 assert.equal(f.api.isAnyBatchActive(),false);
 assert.equal(f.api.getBatchIndex(),0);
 assert.equal(f.api.getBatchUrls().length,0);
 assert.equal(f.gm.get("profile_manager1"),"keep");
});
test("Same tab retains progress through a full document reload",()=>{
 const store=makeStorage();
 let f=makeTab(store);
 f.api.tabSet(f.BATCH_KEYS.active,true);
 f.api.tabSet(f.BATCH_KEYS.urls,Array.from({length:201},(_,i)=>"listing"+i));
 f.api.tabSet(f.BATCH_KEYS.index,175);
 f.api.setBatchStage("input-ready");
 f.api.setSubmitting(true);
 f=makeTab(store);
 assert.equal(f.api.isAnyBatchActive(),true);
 assert.equal(f.api.getBatchIndex(),175);
 assert.equal(f.api.getBatchUrls().length,201);
 assert.equal(f.api.getBatchStage(),"input-ready");
 assert.equal(f.api.isSubmitting(),true);
});
test("Closing a tab ends its progress; another fresh tab never inherits it",()=>{
 const original=makeTab();
 original.api.tabSet(original.BATCH_KEYS.active,true);
 original.api.tabSet(original.BATCH_KEYS.index,175);
 const next=makeTab();
 assert.equal(next.api.isAnyBatchActive(),false);
 assert.equal(next.api.getBatchIndex(),0);
 assert.equal(original.gm.get("profile_manager1"),"keep");
});
test("Per-tab send guard and claim do not live in globally persistent GM",()=>{
 const f=makeTab();
 f.api.tabSet("suumo_advanced_final_send_guard_v1",{status:"sending",id:"mock"});
 assert.equal(f.api.tabGet("suumo_advanced_final_send_guard_v1",null).id,"mock");
 assert.equal(makeTab().api.tabGet("suumo_advanced_final_send_guard_v1",null),null);
 assert.doesNotMatch(src,/GM_(?:get|set|delete)Value\((?:BATCH_KEYS\.|FINAL_SEND_GUARD_KEY|IELOVE_BATCH_EXECUTION_KEY|ISSUE_LOG_KEY)/);
 assert.match(src,/sessionStorage\.setItem\(SEND_CLAIM_STORAGE_KEY/);
 assert.doesNotMatch(src,/localStorage\.(?:setItem|getItem|removeItem)\(SEND_CLAIM_STORAGE_KEY/);
});
test("Runtime state can be removed without touching user settings",()=>{
 const f=makeTab();
 f.api.tabSet("suumo_batch_active",true);
 f.api.tabDelete("suumo_batch_active");
 assert.equal(f.api.tabGet("suumo_batch_active",false),false);
 assert.equal(f.gm.get("profile_manager1"),"keep");
});
test("Unavailable sessionStorage must never fall back to persistent GM",()=>{
 const broken={getItem(){throw Error("no storage")},setItem(){throw Error("no storage")},removeItem(){throw Error("no storage")}};
 const f=makeTab(broken);
 assert.equal(f.api.isAnyBatchActive(),false);
 assert.throws(()=>f.api.tabSet("suumo_batch_active",true));
 assert.equal(f.gm.get("suumo_batch_active"),true); // stale legacy GM deliberately not overwritten
});
test("Previous manual stale-history recovery UI is not present",()=>{
 assert.doesNotMatch(src,/function showStaleBatchRecoveryDialog/);
 assert.doesNotMatch(src,/function clearConfirmedDormantBatch/);
 assert.doesNotMatch(src,/function checkLiveBatchOwner/);
});

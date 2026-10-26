// GM-shared live-batch regression based on v8.0.2.
// Run: node --test tests/tab-runtime-lifecycle.cjs
// No real SUUMO/ielove requests or POST; only synthetic state.
"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const src=fs.readFileSync(path.join(__dirname,"..","SUUMO-DEV.user.js"),"utf8");
function section(start,end){
 const a=src.indexOf(start),b=src.indexOf(end,a);
 assert.ok(a>=0&&b>a, "Section not found: "+start);
 return src.slice(a,b);
}
const helpers=section("  let tabRuntimeFault = false;","  const TAB_OWNER_TOKEN_KEY =");
const stage=section("  function getBatchStage()","  function createBatchOwnerToken()");
const adapter=section("  const BatchState = {","  function getBatchUrls()");
const states=section("  function getBatchUrls()","  function requireProfileManager()");
const code=helpers+"\n"+stage+"\n"+adapter+"\n"+states+
 "\nglobalThis.api={BatchState,tabGet,tabSet,tabDelete,getBatchIndex,getBatchStage,isBatchActive,isAnyBatchActive,setBatchStage,setSubmitting,isSubmitting};";
function makeTab(gm=new Map(),token="",block=false){
 const ctx={BATCH_KEYS:{active:"suumo_batch_active",index:"suumo_batch_index",urls:"suumo_batch_urls",ownerToken:"suumo_batch_owner_token",stage:"suumo_batch_stage",submitting:"suumo_batch_submitting",confirmReady:"suumo_batch_confirm_ready",error:"suumo_batch_error",formReady:"suumo_batch_form_ready"},STAGES:{LISTING:"listing"},
 GM_getValue:(k,d)=>gm.has(k)?structuredClone(gm.get(k)):d,
 GM_setValue:(k,v)=>{if(block)throw Error("denied");gm.set(k,structuredClone(v))},
 GM_deleteValue:k=>{if(block)throw Error("denied");gm.delete(k)},
 isBatchOwnerTab:()=>gm.get("suumo_batch_owner_token")===token&&!!token,
 console:{warn:()=>{}},toast:()=>{}
 };
 vm.createContext(ctx);vm.runInContext(code,ctx);
 return {gm,api:ctx.api};
}
test("TEST header remains excluded from all real SUUMO and ielove pages",()=>{
 assert.match(src,/@name\s+SUUMO JJ 上位版【CODEX TEST ONLY】/);
 assert.match(src,/@exclude\s+https:\/\/suumo\.jp\/\*/);
 assert.match(src,/@exclude\s+https:\/\/cloud\.ielove\.jp\/\*/);
 assert.doesNotMatch(src,/^\/\/ @updateURL/m);
 assert.match(src,/@version\s+8\.0\.3/);
 new vm.Script(src);
});
test("The old popup-window-name gate is removed and settings UI initializes first",()=>{
 assert.doesNotMatch(src,/discardOpenedTabRuntime|acceptReportPopupHandoff|TAB_WINDOW_ID_KEY/);
 const entry=src.slice(src.indexOf("  async function init()"));
 assert.ok(entry.indexOf("addMainButtons();")<entry.indexOf("if (tabRuntimeFault) return;"));
});
test("Owner's tab keeps the live queue across reload and in the report popup",()=>{
 const gm=new Map(),listing=makeTab(gm,"a");
 listing.api.tabSet("suumo_batch_owner_token","a");
 listing.api.tabSet("suumo_batch_active",true);
 listing.api.tabSet("suumo_batch_index",175);
 listing.api.tabSet("suumo_batch_urls",Array.from({length:201},(_,i)=>"listing"+i));
 listing.api.setBatchStage("input-ready");
 const popup=makeTab(gm,"a");
 assert.equal(popup.api.isBatchActive(),true);
 assert.equal(popup.api.getBatchIndex(),175);
 assert.equal(popup.api.getBatchUrls().length,201);
 assert.equal(popup.api.getBatchStage(),"input-ready");
});
test("Closed tab leaves no resumable execution in a newly opened unowned tab",()=>{
 const gm=new Map([["suumo_batch_active",true],["suumo_batch_owner_token","old"]]);
 const newTab=makeTab(gm,"");
 assert.equal(newTab.api.isBatchActive(),false);
 assert.equal(newTab.api.isAnyBatchActive(),false);
});
test("An unrelated tab cannot access a live job without the correct owner token",()=>{
 const gm=new Map([["suumo_batch_active",true],["suumo_batch_owner_token","a"]]);
 assert.equal(makeTab(gm,"b").api.isBatchActive(),false);
 assert.equal(makeTab(gm,"a").api.isBatchActive(),true);
});
test("Old GM index does not cause any active ownerless workflow",()=>{
 const gm=new Map([["suumo_batch_active",true],["suumo_batch_index",175],["suumo_batch_owner_token","old"]]);
 const fresh=makeTab(gm,"");
 assert.equal(fresh.api.isAnyBatchActive(),false);
});
test("Shared final send guard survives form navigation and is removable",()=>{
 const gm=new Map(),a=makeTab(gm,"one"),b=makeTab(gm,"one");
 a.api.tabSet("suumo_advanced_final_send_guard_v1",{status:"sending",id:"mock"});
 assert.equal(b.api.tabGet("suumo_advanced_final_send_guard_v1",null).id,"mock");
 b.api.tabDelete("suumo_advanced_final_send_guard_v1");
 assert.equal(a.api.tabGet("suumo_advanced_final_send_guard_v1",null),null);
 assert.match(src,/navigator\.locks\.request/);
});
test("Missing GM values use defaults; no false corruption at first startup",()=>{
 const f=makeTab();
 assert.equal(f.api.tabGet("suumo_batch_owner_token",""),"");
 assert.equal(f.api.tabGet("suumo_batch_active",false),false);
});
test("Malformed GM values cause closed-state response",()=>{
 const gm=new Map([["suumo_batch_active","true"],["suumo_batch_owner_token","a"]]);
 const a=makeTab(gm,"a");
 assert.equal(a.api.isBatchActive(),false);
});
test("GM write failures stop and cannot silently publish active state",()=>{
 const gm=new Map(),a=makeTab(gm,"a",true);
 assert.throws(()=>a.api.tabSet("suumo_batch_active",true));
 assert.equal(gm.has("suumo_batch_active"),false);
});
test("No manual 176/201 progress recovery UI is restored",()=>{
 for(const fn of ["showStaleBatchRecoveryDialog","clearConfirmedDormantBatch","checkLiveBatchOwner"])
 assert.ok(!src.includes("function "+fn+"("));
});

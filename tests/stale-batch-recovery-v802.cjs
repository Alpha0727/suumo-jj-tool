// Advanced v8.0.2 stale-batch recovery regression (no real SUUMO calls or POST).
// Run: node --test tests/stale-batch-recovery-v802.cjs
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const src = fs.readFileSync(path.join(__dirname,"..","SUUMO-DEV.user.js"),"utf8");
const start = src.indexOf("  function batchRecoveryBlockReason()");
const end = src.indexOf("  function showStaleBatchRecoveryDialog()",start);
assert.ok(start > 0 && end > start,"Stale recovery helper not found");
const code = src.slice(start,end);
function fixture(extra={},options={}){
 const K={active:"suumo_batch_active",ownerToken:"suumo_batch_owner_token",stage:"suumo_batch_stage",
         submitting:"suumo_batch_submitting",confirmReady:"suumo_batch_confirm_ready",formReady:"suumo_batch_form_ready",
         error:"suumo_batch_error",index:"suumo_batch_index",urls:"suumo_batch_urls"};
 const store={
  [K.active]:true,[K.ownerToken]:"stale-owner",[K.stage]:"listing",[K.submitting]:false,
  [K.index]:2,[K.urls]:["a","b","c"],
  profile_manager1:"unchanged",ielove_suumo_handoff_v1:{token:"preserve"},
  ielove_suumo_choices_v1:{saved:true},suumo_advanced_issue_log_v1:[{kind:"history"}],
  ...extra
 };
 const ctx={
  GM_getValue:(k,d)=>Object.prototype.hasOwnProperty.call(store,k)?store[k]:d,
  GM_setValue:(k,v)=>{store[k]=v},GM_deleteValue:k=>{delete store[k]},
  BATCH_KEYS:K,FINAL_SEND_GUARD_KEY:"suumo_advanced_final_send_guard_v1",
  SEND_CLAIM_STORAGE_KEY:"suumo_jj_advanced_final_send_claim_v1",
  TAB_UNCERTAIN_SEND_KEY:"suumo_advanced_unresolved_send_tab_v1",
  IELOVE_BATCH_EXECUTION_KEY:"ielove_suumo_execution_v1",
  FORM_PREP_ATTEMPTS_KEY:"suumo_form_prep_attempts",REPORT_RETRY_KEY:"suumo_advanced_report_retry_v1",
  STAGES:{SUBMITTING_CONFIRM:"submitting-confirm",SUBMITTING_FINAL:"submitting-final",SEND_UNCERTAIN:"send-uncertain"},
  localStorage:{getItem:()=>{if(options.storageError)throw Error("unavailable");return options.claim?"claim":null}},
  sessionStorage:{getItem:()=>options.uncertain?"1":null},
  isAnyBatchActive:()=>!!store[K.active],
  isBatchOwnerTab:()=>!!options.owner,
  isCurrentTabItem:()=>!!options.item,
  isSubmitting:()=>!!store[K.submitting],
  getBatchStage:()=>store[K.stage]||"listing",
  setSubmitting:v=>{store[K.submitting]=v},
  setConfirmReady:v=>{store[K.confirmReady]=v},
  setBatchError:v=>{store[K.error]=v},
  setFormReady:v=>{store[K.formReady]=v}
 };
 vm.createContext(ctx);
 vm.runInContext(code+
  "\nglobalThis.api={batchRecoveryBlockReason,clearConfirmedDormantBatch};",ctx);
 return {store,K,api:ctx.api};
}
test("Only the dormant batch state is cleared after deliberate confirmation",()=>{
 const f=fixture();
 assert.equal(f.api.batchRecoveryBlockReason(),"");
 assert.equal(f.api.clearConfirmedDormantBatch("stale-owner"),true);
 assert.equal(f.store[f.K.active],false);
 assert.equal(f.store[f.K.urls].length,0);
 assert.equal(f.store.profile_manager1,"unchanged");
 assert.equal(f.store.ielove_suumo_handoff_v1.token,"preserve");
 assert.equal(f.store.ielove_suumo_choices_v1.saved,true);
 assert.equal(f.store.suumo_advanced_issue_log_v1[0].kind,"history");
});
const blockers=[
 ["send marker",{"suumo_advanced_final_send_guard_v1":{status:"sending"}},{}],
 ["ambiguous send marker",{"suumo_advanced_final_send_guard_v1":{status:"unknown"}},{}],
 ["send claim",{}, {claim:true}],
 ["uncertain same-tab submission",{}, {uncertain:true}],
 ["inaccessible send storage",{}, {storageError:true}],
 ["submitting flag",{"suumo_batch_submitting":true},{}],
 ["submitting confirm",{"suumo_batch_stage":"submitting-confirm"},{}],
 ["submitting final",{"suumo_batch_stage":"submitting-final"},{}],
 ["uncertain stage",{"suumo_batch_stage":"send-uncertain"},{}],
 ["ielove sending",{"ielove_suumo_execution_v1":{items:[{status:"sending"}]}},{}],
 ["ielove uncertain",{"ielove_suumo_execution_v1":{items:[{status:"uncertain"}]}},{}],
 ["actual active owner",{},{owner:true,item:true}]
];
for(const [name,extra,opts] of blockers){
 test("Reject reset while "+name,()=>{
  const f=fixture(extra,opts);
  assert.notEqual(f.api.batchRecoveryBlockReason(),"");
  assert.equal(f.api.clearConfirmedDormantBatch("stale-owner"),false);
  assert.equal(f.store[f.K.active],true);
 });
}
test("A search tab bearing an old owner token can recover when no stamped item remains",()=>{
 const f=fixture({},{owner:true,item:false});
 assert.equal(f.api.batchRecoveryBlockReason(),"");
 assert.equal(f.api.clearConfirmedDormantBatch("stale-owner"),true);
});
test("An outdated owner token never resets a new batch",()=>{
 const f=fixture();
 assert.equal(f.api.clearConfirmedDormantBatch("other-owner"),false);
 assert.equal(f.store[f.K.active],true);
});
test("Inactive state never needs or permits another reset",()=>{
 const f=fixture({"suumo_batch_active":false});
 assert.equal(f.api.clearConfirmedDormantBatch("stale-owner"),false);
});
test("Complete/pending records are not treated as sent or unknown",()=>{
 const f=fixture({"ielove_suumo_execution_v1":{items:[{status:"complete"},{status:"pending"}]}});
 assert.equal(f.api.batchRecoveryBlockReason(),"");
 assert.equal(f.api.clearConfirmedDormantBatch("stale-owner"),true);
});

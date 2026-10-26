// SUUMO listing -> new report popup handoff regression.
// Run: node --test tests/report-popup-handoff.cjs
// Synthetic sessionStorage and opener only; no live SUUMO requests or POST.
"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),
  vm=require("node:vm"),path=require("node:path");
const src=fs.readFileSync(path.join(__dirname,"..","SUUMO-DEV.user.js"),"utf8");
const begin=src.indexOf("  function acceptReportPopupHandoff()");
const end=src.indexOf("  // A window.open tab starts with a COPY",begin);
assert.ok(begin>0&&end>begin,"Production popup-handoff helper missing");
const helper=src.slice(begin,end);
function scenario(opts={}){
 const prefix="suumo_advanced_tab_runtime_v1_";
 const storageKey="suumo_advanced_browser_tab_identity_v1";
 const contextKey="suumo_advanced_tab_item_context_v1";
 const ticketKey="suumo_advanced_page_transition_v1";
 const ownerKey="suumo_batch_tab_owner_token";
 const batchKey="batch-owner",listing="https://suumo.jp/chintai/bc_123456789/";
 function makeStorage(state=new Map()){
  return {get length(){return state.size},key:i=>[...state.keys()][i]||null,
   getItem:k=>state.get(k)??null,setItem:(k,v)=>state.set(k,String(v)),
   removeItem:k=>state.delete(k),state};
 }
 const parent=makeStorage(),child=makeStorage();
 parent.setItem(storageKey,"parent-tab");
 parent.setItem(ownerKey,batchKey);
 for(const [key,value] of Object.entries({
  suumo_batch_active:true,suumo_batch_urls:[listing],suumo_batch_index:0,
  suumo_batch_owner_token:batchKey,suumo_batch_stage:opts.stage||"listing",
  suumo_batch_submitting:false,suumo_advanced_final_send_guard_v1:opts.guard||null
 }))parent.setItem(prefix+key,JSON.stringify(value));
 parent.setItem(contextKey,JSON.stringify({ownerToken:batchKey,index:0,url:listing,id:"item-1"}));
 parent.setItem(ticketKey,JSON.stringify({
  kind:opts.ticketKind||"input",ownerToken:batchKey,index:0,url:listing,
  itemId:"item-1",at:Date.now()-(opts.expired?200000:300)
 }));
 if(opts.cloned!==false)for(const [key,value] of parent.state)child.setItem(key,value);
 const opener={closed:false,name:"parent-tab",sessionStorage:parent,
  location:{origin:"https://suumo.jp",pathname:opts.parentPath||"/chintai/bc_123456789/"},
  document:{querySelector:()=>opts.missingLink?null:{}}};
 const browserWindow={opener:opts.noOpener?null:opener,name:""};
 const context={
  window:browserWindow,sessionStorage:child,location:{origin:"https://suumo.jp"},
  BATCH_KEYS:{active:"suumo_batch_active",urls:"suumo_batch_urls",index:"suumo_batch_index",
   ownerToken:"suumo_batch_owner_token",stage:"suumo_batch_stage",submitting:"suumo_batch_submitting"},
  TAB_RUNTIME_PREFIX:prefix,TAB_WINDOW_ID_KEY:storageKey,TAB_OWNER_TOKEN_KEY:ownerKey,
  TAB_ITEM_CONTEXT_KEY:contextKey,TAB_SENT_CONTEXT_KEY:"sent",TAB_UNCERTAIN_SEND_KEY:"uncertain",
  PAGE_NAV_TICKET_KEY:ticketKey,PAGE_ACTIVE_ENTRY_KEY:"active-entry",
  SEND_CLAIM_STORAGE_KEY:"send-claim",FAST_REPORT_NAV_KEY:"fast-nav",
  FINAL_SEND_GUARD_KEY:"suumo_advanced_final_send_guard_v1",PAGE_TICKET_MAX_AGE_MS:90000,
  STAGES:{LISTING:"listing"},isInputPage:()=>!opts.notInput,
  createBatchOwnerToken:()=>"fresh-unique-child",failTabRuntime:()=>{}
 };
 vm.createContext(context);
 vm.runInContext(helper+"\nglobalThis.acceptPopup=acceptReportPopupHandoff;",context);
 return {run:()=>context.acceptPopup(),parent,child,browserWindow,prefix,storageKey};
}
for(const cloned of [true,false])test("Legitimate SUUMO input popup "+(cloned?"copies":"reads")+" active listing state",()=>{
 const f=scenario({cloned});
 assert.equal(f.run(),true);
 assert.equal(f.child.getItem(f.prefix+"suumo_batch_active"),"true");
 assert.equal(f.parent.getItem(f.prefix+"suumo_batch_active"),"false");
 assert.equal(f.browserWindow.name,f.child.getItem(f.storageKey));
 assert.notEqual(f.browserWindow.name,"parent-tab");
 assert.ok(f.child.getItem("suumo_advanced_page_transition_v1"));
});
for(const [name,config] of [
 ["non-input popup",{notInput:true}],
 ["missing opener",{noOpener:true}],
 ["unrelated listing",{parentPath:"/chintai/bc_987654321/"}],
 ["no actual listing link",{missingLink:true}],
 ["expired transition ticket",{expired:true}],
 ["confirmation ticket",{ticketKind:"confirm"}],
 ["unresolved sending guard",{guard:{status:"sending"}}],
 ["not in listing stage",{stage:"submitting-final"}]
])test("Reject "+name+" without changing original tab",()=>{
 const f=scenario(config);
 assert.equal(f.run(),false);
 assert.equal(f.parent.getItem(f.prefix+"suumo_batch_active"),"true");
});
test("Cross-origin opener is ignored without flagging the tab state as corrupt",()=>{
 const f=scenario({cloned:false});
 f.browserWindow.opener={closed:false,location:{get origin(){throw Error("cross-origin")}}};
 assert.equal(f.run(),false);
 assert.equal(f.parent.getItem(f.prefix+"suumo_batch_active"),"true");
});
test("Only first popup can take ownership of an active listing",()=>{
 const a=scenario();
 assert.equal(a.run(),true);
 assert.equal(a.run(),false);
 assert.equal(a.parent.getItem(a.prefix+"suumo_batch_active"),"false");
});
test("Existing duplicate/send and reloading safety code remains in place",()=>{
 assert.match(src,/function isCurrentTabItem\(/);
 assert.match(src,/function currentUncertainSend\(/);
 assert.match(src,/navigator\.locks\.request/);
 assert.match(src,/function handleCompletePage\(/);
 assert.match(src,/function failTabRuntime\(/);
 assert.match(src,/\/\/ @version\s+8\.0\.3/);
 new vm.Script(src);
});

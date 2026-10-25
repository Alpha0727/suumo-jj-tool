// Node.js regression checks for Ver.8.0 DOM observer + progress-panel optimizations.
// No network access, POST, or user data is used.
// Run: node --test tests/v8-ui-lightweight.cjs
"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=fs.readFileSync(require("node:path").join(__dirname,"..","SUUMO-DEV.user.js"),"utf8");
function section(start,end){
 const a=source.indexOf(start),b=source.indexOf(end,a);
 assert.ok(a>0 && b>a,"Code boundary missing "+start);
 return source.slice(a,b);
}
const observerSource=section("  function waitForReadyElement(", "  async function setValue(");
const panelSource=section("  function updateBatchPanel()", "  function normalizePhone(");
function observerHarness(initial){
 const timers=new Map(),objects=[],record={value:initial};
 let seq=0;
 const c={
  document:{documentElement:{},querySelector(){return record.value}},
  Promise,
  MutationObserver:class{
   constructor(cb){this.callback=cb;objects.push(this)}
   observe(_,options){this.options=options}
   disconnect(){this.closed=true}
  },
  setTimeout(cb,ms){const id=++seq;timers.set(id,{cb,ms});return id},
  clearTimeout(id){timers.delete(id)}
 };
 vm.createContext(c);
 vm.runInContext(observerSource+"\nglobalThis.wait=waitForReadyElement;",c);
 return {wait:c.wait,record,timers,objects,
  mutate(times=1){for(let i=0;i<times;i++)objects[0].callback()},
  tick(ms){for(const [id,t] of [...timers])if(t.ms===ms&&timers.has(id)){timers.delete(id);t.cb()}}
 };
}
test("Existing field returns immediately without a watcher",async()=>{
 const h=observerHarness({id:"ok"});
 assert.equal((await h.wait("#any")).id,"ok");
 assert.equal(h.objects.length,0);
});
test("50 DOM mutations coalesce to one 30ms check",async()=>{
 const h=observerHarness(null);
 const result=h.wait("#target");
 assert.equal(h.objects[0].options.attributes,undefined);
 h.record.value={id:"target"};
 h.mutate(50);
 assert.equal([...h.timers.values()].filter(x=>x.ms===30).length,1);
 h.tick(30);
 assert.equal((await result).id,"target");
 assert.equal(h.objects[0].closed,true);
 assert.equal(h.timers.size,0);
});
test("When predicate is present, attribute changes are watched",async()=>{
 const h=observerHarness(null);
 const result=h.wait("#target",8000,v=>v.editable);
 assert.equal(h.objects[0].options.attributes,true);
 h.record.value={editable:false};
 h.mutate();h.tick(30);
 h.record.value.editable=true;
 h.mutate();h.tick(30);
 assert.equal((await result).editable,true);
});
test("Missing field still times out",async()=>{
 const h=observerHarness(null);
 const result=h.wait("#not-found",8000);
 h.tick(8000);
 assert.equal(await result,null);
 assert.equal(h.timers.size,0);
});
function panelHarness(){
 let writes=0,elementSeq=0,activePanel=null;
 const buttons=new Map();
 const data={active:true,ready:false,error:false,submitting:false,uncertain:false,stage:"input-preparing",index:0};
 const panel={
  html:"",
  get innerHTML(){return this.html},
  set innerHTML(x){writes++;this.html=x;buttons.clear()},
  querySelector(sel){return get(sel.slice(1))},
  remove(){activePanel=null}
 };
 function get(id){
  if(id==="tm-batch-status")return activePanel;
  if(!activePanel||!panel.html.includes('id="'+id+'"'))return null;
  if(!buttons.has(id))buttons.set(id,{id,serial:++elementSeq,style:{}});
  return buttons.get(id);
 }
 const c={
  document:{
   createElement:()=>panel,body:{appendChild:x=>{activePanel=x}},
   getElementById:get
  },
  isListingPage:()=>false,isBatchActive:()=>data.active,
  getBatchUrls:()=>["https://suumo.jp/chintai/bc_100529137600/"],
  getBatchIndex:()=>data.index,isSubmitting:()=>data.submitting,
  isBatchError:()=>data.error,isFormReady:()=>data.ready,
  currentIeloveExecutionItem:()=>null,
  PROFILE:{mgmt_company:"Test",mgmt_tel:"0300000000",manager2:"Staff",room:"101"},
  getBatchStage:()=>data.stage,currentUncertainSend:()=>data.uncertain,
  isInputPage:()=>true,isConfirmPage:()=>false,isCompletePage:()=>false,
  STAGES:{SEND_UNCERTAIN:"send-uncertain"},
  escapeHtml:v=>String(v),AUTO_ACTION_SINGLE_PHASE:"single-submit-v7549",
  cancelAutoAction(){},startAutoAction(){},
  retryCurrentListing(){},skipBatchItem(){},stopBatch(){},
  submitCurrentAndContinue(){},
  autoActionCancelledPhase:null
 };
 vm.createContext(c);
 vm.runInContext(panelSource+"\nglobalThis.update=updateBatchPanel;",c);
 return {update:c.update,data,buttons,get,panel,get writes(){return writes}};
}
test("Repeated status checks do not recreate identical progress DOM",()=>{
 const x=panelHarness();x.update();
 assert.equal(x.writes,1);
 for(let i=0;i<50;i++)x.update();
 assert.equal(x.writes,1);
 assert.equal(typeof x.get("tm-stop-batch").onclick,"function");
});
test("Meaningful status change still updates buttons and text",()=>{
 const x=panelHarness();x.update();
 x.data.ready=true;x.update();
 assert.equal(x.writes,2);
 const submit=x.get("tm-submit-next");
 assert.equal(typeof submit.onclick,"function");
 x.update();assert.equal(x.writes,2);
 assert.equal(x.get("tm-submit-next"),submit);
 x.data.uncertain=true;x.data.stage="send-uncertain";x.update();
 assert.equal(x.writes,3);
 assert.equal(x.get("tm-submit-next"),null);
 assert.match(x.panel.html,/二重送信防止/);
});

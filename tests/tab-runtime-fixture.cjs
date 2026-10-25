// Explicit test accessors. GM mocks remain persistent: accidental production GM
// runtime reads are never hidden by this adapter. Inject with addInitScript/eval.
function installTabFixture() {
  const prefix='suumo_advanced_tab_runtime_v1_';
  const runtime=k=>/^suumo_batch_|^suumo_auto_action_|^suumo_form_prep_attempts$/.test(k)||[
    'suumo_advanced_final_send_guard_v1','suumo_advanced_issue_log_v1',
    'suumo_advanced_report_retry_v1','ielove_suumo_execution_v1','last_search_token'
  ].includes(k);
  window.qaGet=(k,d)=>runtime(k)?JSON.parse(sessionStorage.getItem(prefix+k)??JSON.stringify(d??null)):GM_getValue(k,d);
  window.qaSet=(k,v)=>runtime(k)?sessionStorage.setItem(prefix+k,JSON.stringify(v)):GM_setValue(k,v);
  window.qaRead=()=>{
    const data=JSON.parse(localStorage.getItem('qa-store')||'{}');
    for(let i=0;i<sessionStorage.length;i++){
      const k=sessionStorage.key(i);
      if(k.startsWith(prefix))data[k.slice(prefix.length)]=JSON.parse(sessionStorage.getItem(k));
    }
    return data;
  };
  window.qaWrite=data=>{for(const [k,v] of Object.entries(data))qaSet(k,v)};
}
module.exports={installTabFixture};

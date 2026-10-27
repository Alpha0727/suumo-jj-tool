// Explicit shared-GM fixture accessors. SessionStorage contains only tab identity,
// page tickets and local send receipts, exactly as the current production code.
function installTabFixture() {
 window.qaGet=(k,d)=>GM_getValue(k,d);
 window.qaSet=(k,v)=>GM_setValue(k,v);
 window.qaRead=()=>JSON.parse(localStorage.getItem('qa-store')||'{}');
 window.qaWrite=data=>{for(const [k,v] of Object.entries(data))GM_setValue(k,v)};
}
module.exports={installTabFixture};

// contentScript.js — QuickForce v1.9.0
// Includes hidden, non-configurable ALT+B toast that works across iframes

/* ---------- UI: toast ---------- */
function toast(msg){
  const t=document.createElement('div'); t.textContent=msg;
  Object.assign(t.style,{
    position:'fixed', top:'12px', left:'50%', transform:'translateX(-50%)',
    background:'#032D60', color:'#fff', padding:'8px 12px', borderRadius:'6px',
    zIndex:2147483647, font:'13px system-ui'
  });
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),1600);
}

/* ---------- helpers ---------- */
function findRecordIdFromUrl(url){
  const u=new URL(url);
  const qp=u.searchParams.get('id');
  if(qp&&/^[a-zA-Z0-9]{15,18}$/.test(qp)) return qp;
  const p=u.pathname;
  let m=p.match(/\/lightning\/r\/[^/]+\/([a-zA-Z0-9]{15,18})\b/); if(m) return m[1];
  m=p.match(/\/([a-zA-Z0-9]{15,18})(?:[\/?]|$)/); if(m) return m[1];
  return null;
}
function findRecordIdFromDom(){
  const sels=['[data-recordid]','[data-record-id]','[data-record]','[data-key="recordId"]','[name="recordId"]'];
  for(const s of sels){
    const el=document.querySelector(s); if(!el) continue;
    const v=el.getAttribute('data-recordid')||el.getAttribute('data-record-id')||el.getAttribute('data-record')||el.value||el.textContent;
    if(v&&/^[a-zA-Z0-9]{15,18}$/.test(v.trim())) return v.trim();
  }
  return null;
}
function findObjectApiFromUrl(url){
  const u=new URL(url), p=u.pathname;
  let m=p.match(/\/lightning\/o\/([^/]+)\/list\b/); if(m) return m[1];
  m=p.match(/\/lightning\/r\/([^/]+)\/[a-zA-Z0-9]{15,18}\b/); if(m) return m[1];
  return null;
}
function objectFromClassicPrefix(url){
  const p=new URL(url).pathname;
  const m=p.match(/\/([a-zA-Z0-9]{3})[a-zA-Z0-9]{12,15}\b/);
  if(!m) return null;
  const map={"001":"Account","003":"Contact","006":"Opportunity","00Q":"Lead","00T":"Task","00U":"Event","005":"User","00a":"ContentDocument"};
  return map[m[1]]||null;
}

/* ---------- actions ---------- */
async function handleCopyId(){
  const id=findRecordIdFromUrl(location.href)||findRecordIdFromDom();
  if(!id){ toast('No record Id detected'); return; }
  try{ await navigator.clipboard.writeText(id); toast('Copied: '+id); }
  catch{ toast('Clipboard error'); }
}
async function handleNavigate(){
  let clip=''; try{ clip=await navigator.clipboard.readText(); }catch{}
  const m=clip.match(/\b([a-zA-Z0-9]{15,18})\b/);
  if(!m){ toast('No record Id on clipboard'); return; }
  location.assign(`${location.origin}/lightning/r/${m[1]}/view`);
}
async function handleToggleSetup(){
  const obj=findObjectApiFromUrl(location.href)||objectFromClassicPrefix(location.href);
  if(obj){
    const url=`${location.origin}/lightning/setup/ObjectManager/${obj}/FieldsAndRelationships/view`;
    try{ window.open(url,'_blank','noopener'); }catch{ location.assign(url); }
  } else {
    const home=`${location.origin}/lightning/setup/SetupOneHome/home`;
    try{ window.open(home,'_blank','noopener'); }catch{ location.assign(home); }
  }
}
function handleOpenFlowsHome(){
  const url=`${location.origin}/lightning/setup/Flows/home`;
  try{ window.open(url,'_blank','noopener'); }catch{ location.assign(url); }
}
function handleOpenReportsHome(){
  const url=`${location.origin}/lightning/o/Report/home`;
  try{ window.open(url,'_blank','noopener'); }catch{ location.assign(url); }
}

/* New: Dashboards / App Manager / Installed Packages / Users */
function handleOpenDashboardsHome(){
  const url=`${location.origin}/lightning/o/Dashboard/home`;
  try{ window.open(url,'_blank','noopener'); }catch{ location.assign(url); }
}
function handleOpenAppManager(){
  const url=`${location.origin}/lightning/setup/NavigationMenus/home`;
  try{ window.open(url,'_blank','noopener'); }catch{ location.assign(url); }
}
function handleOpenInstalledPackages(){
  const url=`${location.origin}/lightning/setup/ImportedPackage/home`;
  try{ window.open(url,'_blank','noopener'); }catch{ location.assign(url); }
}
function handleOpenUsersHome(){
  const url=`${location.origin}/lightning/setup/ManageUsers/home`;
  try{ window.open(url,'_blank','noopener'); }catch{ location.assign(url); }
}

/* ---------- hidden ALT+B across iframes ---------- */
(function attachHiddenB(){
  if (window.__qf_hidden_b__) return;
  window.__qf_hidden_b__ = true;

  const handler = (e) => {
    const isEditable = (el) => el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName));
    if (isEditable(e.target)) return;

    const isB = e.code === 'KeyB' || e.key === 'b' || e.key === 'B';
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && isB) {
      e.preventDefault();
      e.stopPropagation();
      try {
        (window.top || window).postMessage({ __qf_toast: "Good job, BROTHER!" }, "*");
      } catch {
        toast("Good job, BROTHER!");
      }
    }
  };

  // capture phase on both to beat app handlers; across frames via all_frames:true
  window.addEventListener('keydown', handler, true);
  document.addEventListener('keydown', handler, true);

  // show toast if instructed by a child frame
  window.addEventListener('message', (evt) => {
    if (evt?.data && evt.data.__qf_toast) toast(evt.data.__qf_toast);
  }, true);
})();

/* ---------- bridge from background (Chrome commands) ---------- */
chrome.runtime.onMessage.addListener((msg)=>{
  if (msg && msg.ping) return;
  if (msg?.type==='COPY_ID') handleCopyId();
  else if (msg?.type==='NAVIGATE') handleNavigate();
  else if (msg?.type==='TOGGLE_SETUP') handleToggleSetup();
  else if (msg?.type==='OPEN_FLOWS_HOME') handleOpenFlowsHome();
  else if (msg?.type==='OPEN_REPORTS_HOME') handleOpenReportsHome();
  else if (msg?.type==='OPEN_DASHBOARDS_HOME') handleOpenDashboardsHome();
  else if (msg?.type==='OPEN_APP_MANAGER') handleOpenAppManager();
  else if (msg?.type==='OPEN_INSTALLED_PACKAGES') handleOpenInstalledPackages();
  else if (msg?.type==='OPEN_USERS_HOME') handleOpenUsersHome();
});

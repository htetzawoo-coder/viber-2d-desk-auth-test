let db=window.v2dDb||null;
let auth=window.v2dAuth||null;
const CURRENT_USER=auth?.currentUser||window.V2D_CURRENT_USER||null;
const CURRENT_UID=CURRENT_USER?.uid||"guest";
const USER_STORAGE_PREFIX=`v2d_user_${CURRENT_UID}__`;

function userStorageKey(base){ return USER_STORAGE_PREFIX+base; }
function userGetItem(base){ return localStorage.getItem(userStorageKey(base)); }
function userSetItem(base,value){
  localStorage.setItem(userStorageKey(base),value);
  if(window.__V2D_CLOUD_SYNC_READY && !window.__V2D_APPLYING_REMOTE && typeof scheduleCloudSync==='function' && isCloudRelevantKey(base)){
    scheduleCloudSync(base);
  }
}
function userRemoveItem(base){ localStorage.removeItem(userStorageKey(base)); }

const LEGACY_USER_STORAGE_KEYS=[
  "v2d_records","v2d_over_deductions","v2d_audit_trail","v2d_undo_stack",
  "v2d_settings","v2d_global_view","v2d_p_memory","v2d_dealer_manual_memory",
  "v2d_session_manual_lock","v2d_topbar_state","v2d_runtime_errors","v2d_last_version"
];

function migrateLegacyLocalDataOnce(){
  if(!CURRENT_USER) return;
  const doneKey=userStorageKey("legacy_migration_done");
  if(localStorage.getItem(doneKey)==="1") return;

  const claimedUid=localStorage.getItem("v2d_legacy_claimed_uid");
  if(!claimedUid || claimedUid===CURRENT_UID){
    const targetExists=userGetItem("v2d_records")!==null || userGetItem("v2d_settings")!==null;
    if(!targetExists){
      LEGACY_USER_STORAGE_KEYS.forEach(key=>{
        const value=localStorage.getItem(key);
        if(value!==null) userSetItem(key,value);
      });
    }
    localStorage.setItem("v2d_legacy_claimed_uid",CURRENT_UID);
  }
  localStorage.setItem(doneKey,"1");
}
migrateLegacyLocalDataOnce();

const pages = [
  ['dashboard',{en:'Dashboard',my:'ပင်မ'}],
  ['entry',{en:'Entry',my:'စာရင်းသွင်း'}],
  ['records',{en:'Entry Records',my:'စာရင်းမှတ်တမ်း'}],
  ['limit',{en:'Limit Board',my:'ကန့်သတ်ဘုတ်'}],
  ['over',{en:'Over',my:'ကျော်နေသောစာရင်း'}],
  ['reports',{en:'Reports',my:'အစီရင်ခံစာ'}],
  ['image',{en:'Image',my:'ပုံ / မျှဝေ'}],
  ['settings',{en:'Settings',my:'ဆက်တင်'}],
  ['audit',{en:'History',my:'မှတ်တမ်း / Undo'}]
];
const N2 = Array.from({length:100},(_,i)=>String(i).padStart(2,'0'));
const FIXED = {
  A:['05','16','27','38','49','50','61','72','83','94'],
  POWER:['05','16','27','38','49','50','61','72','83','94'],
  Z:['07','18','24','35','42','53','69','70','81','96'],
  B:['01','10','12','21','23','32','34','43','45','54','56','65','67','76','78','87','89','98','90','09']
};
let records = JSON.parse(userGetItem('v2d_records')||'[]');
let overDeductions = JSON.parse(userGetItem('v2d_over_deductions')||'[]');
let auditTrail = JSON.parse(userGetItem('v2d_audit_trail')||'[]');
let undoStack = JSON.parse(userGetItem('v2d_undo_stack')||'[]');
let settings = JSON.parse(userGetItem('v2d_settings')||'{}');
let preview = {detailRows:[], totals:[], warnings:[], issues:[], cards:[]};
let globalView = JSON.parse(userGetItem('v2d_global_view')||'{}');
let pMemory = JSON.parse(userGetItem('v2d_p_memory')||'{}');
let dealerManualMemory = JSON.parse(userGetItem('v2d_dealer_manual_memory')||'{}');
let sessionManualLock = userGetItem('v2d_session_manual_lock') === '1';
let pendingDuplicateBlockKeys = [];
let pendingDuplicateBlockLabels = [];
let currentGroupEdit = null;
let currentSelectedCardId = '';
let entryWorkspaceSelectedCardId = '';
let reportTotalBreakdownOpen = false;
let reportPBreakdownOpen = false;
const reportExpandedNames = new Set();
const reportExpandedPNames = new Set();
let groupEditPreviewTimer = null;
let currentIssueIndex = 0;
const initialRegisteredShopName=localStorage.getItem(`v2d_user_${CURRENT_UID}__initial_shop_name`)||"";
let topbarState = userGetItem('v2d_topbar_state') || 'open';

function selectedWriterProfile(){ return (val('entryWriter') || settings.lastWriter || 'AUTO').toUpperCase(); }
function normalizeWriterProfile(w){ return String(w||'AUTO').toUpperCase(); }
function writerHintText(w){
  const x = normalizeWriterProfile(w);
  if(x==='A') return 'A Writer: carry lines, split R style, အပူး, subtotal/total notes ကိုပိုနားလည်အောင်ဖတ်မယ်။';
  if(x==='B') return 'B Writer: nထိပ်=n/, nပိတ်=/n, grouped amount share, structured amount R amount style ကိုဦးစားပေးမယ်။';
  if(x==='C') return 'C Writer: dot-separated 2-digit groups + shared R amount style ကိုဦးစားပေးမယ်။';
  if(x==='OTHER') return 'Other Writer: generic parser rule နဲ့ဖတ်မယ်။ writer-specific shortcut တွေကို conservative mode နဲ့ကိုင်မယ်။';
  return 'Auto: generic parser နဲ့စပြီး A / B / C pattern နီးစပ်တာကို line-by-line soft detect လုပ်မယ်။';
}
function renderWriterHint(){
  const el=document.getElementById('writerHint');
  if(el) el.textContent = writerHintText(selectedWriterProfile());
}
function detectAutoWriter(line){
  const s = normalize(line);
  if(/(?:ထိပ်|ပိတ်)/.test(s)) return 'B';
  if(/\d{2}(?:\.\d{2}){2,}\s*[Rr]\s*\d+/.test(s)) return 'C';
  if(/[|]/.test(s) || /အပူး|ပါတ်|ပတ်|အခွေ|ခွေ/.test(s)) return 'A';
  return 'OTHER';
}
function preprocessWriterLine(line, writer){
  let s = String(line||'');
  const w = normalizeWriterProfile(writer);
  if(w==='A'){
    s = s.replace(/(\d{2})\s*[|lI]\s*(\d+)/g, '$1 R $2');
    s = s.replace(/(\d{2})\s+(\d+)\s*[|lI]\s*(\d+)/g, '$1 $2 R $3');
  }else if(w==='B'){
    s = s.replace(/([0-9])\s*ပိတ/g,'$1 ပိတ်');
    s = s.replace(/([0-9])\s*ထိပ္/g,'$1 ထိပ်');
  }else if(w==='C'){
    s = s.replace(/[၊,]/g,'.');
  }
  return s;
}

function today(){return new Date().toISOString().slice(0,10)}
function autoSessionForDate(date){
  const d = date || today();
  if(d !== today()) return 'AM';
  const now = new Date();
  return now.getHours() >= 14 ? 'PM' : 'AM';
}
function saveGlobalView(){ userSetItem('v2d_global_view', JSON.stringify(globalView)); }
function savePMemory(){ userSetItem('v2d_p_memory', JSON.stringify(pMemory)); }
function saveSessionLock(){ userSetItem('v2d_session_manual_lock', sessionManualLock ? '1' : '0'); }
function saveAuditTrail(){
  try{
    userSetItem('v2d_audit_trail', JSON.stringify((auditTrail||[]).slice(0,120)));
  }catch(e){
    auditTrail = (auditTrail||[]).slice(0,40).map(x=>({...x, rawText:''}));
    try{ userSetItem('v2d_audit_trail', JSON.stringify(auditTrail)); }catch(_e){}
  }
}
function saveUndoStack(){
  try{
    userSetItem('v2d_undo_stack', JSON.stringify((undoStack||[]).slice(0,8)));
  }catch(e){
    undoStack = (undoStack||[]).slice(0,3);
    try{ userSetItem('v2d_undo_stack', JSON.stringify(undoStack)); }catch(_e){}
  }
}
function deepCopy(obj){ return JSON.parse(JSON.stringify(obj)); }
function snapshotBeforeChange(label, meta={}){
  undoStack.unshift({
    ts: Date.now(),
    label,
    meta,
    records: deepCopy(records||[]),
    overDeductions: deepCopy(overDeductions||[])
  });
  undoStack = undoStack.slice(0,8);
  saveUndoStack();
}
function pushAudit(action, meta={}){
  const safeMeta = {...meta};
  if(safeMeta.rawText && String(safeMeta.rawText).length > 4000) safeMeta.rawText = String(safeMeta.rawText).slice(0,4000);
  auditTrail.unshift({ts:Date.now(), action, ...safeMeta});
  auditTrail = auditTrail.slice(0,120);
  saveAuditTrail();
}
function collectNamesFromRows(rows){
  return [...new Set((rows||[]).map(r=>r.name||'Default').filter(Boolean))].join(', ');
}
function copyLatestRawHistory(){
  const item=(auditTrail||[]).find(x=>x.rawText);
  if(!item){ showToast('Copy လုပ်ရန် raw history မရှိသေးပါ'); return; }
  navigator.clipboard.writeText(item.rawText||'').then(()=>showToast('Latest raw history ကို copy လုပ်ပြီးပါပြီ'));
}
function clearAuditTrail(){
  if(!confirm('Audit history ကိုပဲ ဖျက်မလား? Data records မဖျက်ပါ။')) return;
  auditTrail=[]; undoStack=[]; saveAuditTrail(); saveUndoStack(); renderAuditTrail(); showToast('Audit history cleared');
}
function undoLastAction(){
  if(!undoStack.length){ showToast('Undo ပြန်သွားရန် action မရှိသေးပါ'); return; }
  const last = undoStack.shift();
  records = deepCopy(last.records||[]);
  overDeductions = deepCopy(last.overDeductions||[]);
  saveUndoStack();
  saveRecords();
  saveOverDeductions();
  pushAudit('UNDO', {label:last.label||'Undo', summary:'Undo ပြန်သွားပါပြီ'});
  renderAll();
  showToast('Undo ပြန်သွားပါပြီ');
}
function auditCardHtml(a, idx){
  const time = a.ts ? new Date(a.ts).toLocaleString() : '-';
  const raw = a.rawText ? `
    <div class="saveTiny" style="margin-top:8px">Raw Message</div>
    <textarea readonly style="width:100%;min-height:100px;background:#020617;color:#e5e7eb;border:1px solid #334155;border-radius:10px;padding:8px">${String(a.rawText||'')}</textarea>
    <div class="btnrow" style="margin-top:6px"><button class="btn gray small" onclick="navigator.clipboard.writeText(auditTrail[${idx}].rawText||'').then(()=>showToast('Raw text copied'))">Copy Raw</button></div>
  ` : '';
  return `
    <div class="card" style="margin-top:10px;background:#020617">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div><b>${escapeHtml(a.action||'ACTION')}</b> <span class="miniBadge">${escapeHtml(a.label||'')}</span></div>
        <div class="muted">${escapeHtml(time)}</div>
      </div>
      <div class="muted" style="margin-top:6px">${escapeHtml(a.summary||'')}</div>
      ${(a.name||a.names||a.date||a.session) ? `<div class="saveTiny" style="margin-top:6px">Name: ${escapeHtml(a.name||a.names||'-')} | Date: ${escapeHtml(a.date||'-')} | Session: ${escapeHtml(a.session||'-')}</div>` : ''}
      ${raw}
    </div>
  `;
}
function renderAuditTrail(){
  const box = document.getElementById('auditTrailList');
  if(!box) return;
  setText('auditRowsCount', (auditTrail||[]).length);
  setText('auditRawCount', (auditTrail||[]).filter(x=>x.rawText).length);
  setText('undoReadyCount', (undoStack||[]).length);
  box.innerHTML = (auditTrail||[]).length ? auditTrail.slice(0,60).map((a,i)=>auditCardHtml(a,i)).join('') : '<div class="muted">History မရှိသေးပါ</div>';
}
function pKey(date, session){ return `${date||today()}__${session||'AM'}`; }
function allowedSessionValue(el, value){
  if(!el) return false;
  return Array.from(el.options || []).some(opt => opt.value === value);
}
function setValueIfExists(id, value){
  const el = document.getElementById(id);
  if(!el) return;
  if(el.tagName === 'SELECT' && !allowedSessionValue(el, value)) return;
  el.value = value;
}
function currentPageLabel(){
  const active = document.querySelector('.tab.active');
  if(active) return active.textContent.split('\n')[0].trim();
  return 'Dashboard';
}
function renderMiniTopInfo(){
  return;
}
function applyTopbarState(){
  const topbar = document.getElementById('topbar');
  const btn = document.getElementById('topToggleBtn');
  const tabsBtn = document.getElementById('tabsToggleBtn');
  const collapsedBtn = document.querySelector('.collapsedOpenBtn');
  if(!topbar || !btn) return;
  const collapsed = topbarState === 'collapsed';
  topbar.classList.toggle('collapsed', collapsed);
  document.body.classList.toggle('topbar-collapsed', collapsed);
  btn.textContent = collapsed ? 'Open ▼' : 'Minimize ▲';
  if(tabsBtn){
    tabsBtn.innerHTML = collapsed ? 'Open<small>ထိပ်ပိုင်းဖွင့်</small>' : 'Minimize<small>ထိပ်ပိုင်းဖျောက်</small>';
  }
  if(collapsedBtn){
    collapsedBtn.textContent = collapsed ? 'Open ▼' : 'Open ▼';
  }
  renderMiniTopInfo();
}
function toggleTopbar(){
  topbarState = topbarState === 'collapsed' ? 'open' : 'collapsed';
  userSetItem('v2d_topbar_state', topbarState);
  applyTopbarState();
}
function getStoredPNumber(date, session){
  const raw = String(pMemory[pKey(date, session)] || '').trim();
  return /^\d{1,2}$/.test(raw) ? raw.padStart(2,'0') : '';
}
function restorePNumber(){
  const date = val('reportDate') || (globalView.date || today());
  const session = val('reportSession') || (globalView.session || 'AM');
  if(session === 'AM' || session === 'PM'){
    setVal('pNumber', getStoredPNumber(date, session));
  }else{
    const am=getStoredPNumber(date,'AM')||'-';
    const pm=getStoredPNumber(date,'PM')||'-';
    setVal('pNumber', `AM ${am} | PM ${pm}`);
  }
}
function rememberPNumber(){
  // Report input is read-only. P Number is saved from Settings.
  restorePNumber();
}
function sanitizeSettingsPNumber(){
  const el=document.getElementById('settingsPNumber');
  if(!el) return;
  el.value=String(el.value||'').replace(/\D/g,'').slice(0,2);
}
function loadSettingsPNumber(){
  const date=val('settingsPDate')||today();
  const session=val('settingsPSession')||'AM';
  const p=getStoredPNumber(date,session);
  setVal('settingsPNumber',p);
  setText('settingsPStatus', p ? `${date} / ${session} / P = ${p}` : `${date} / ${session} / P Number မသတ်မှတ်ရသေးပါ`);
}
function saveSettingsPNumber(){
  const date=val('settingsPDate')||today();
  const session=val('settingsPSession')||'AM';
  const raw=String(val('settingsPNumber')||'').replace(/\D/g,'');
  if(!/^\d{1,2}$/.test(raw)){showToast('P Number ကို 00 မှ 99 အတွင်း ရိုက်ပါ'); return;}
  const p=raw.padStart(2,'0');
  pMemory[pKey(date,session)]=p;
  savePMemory();
  setVal('settingsPNumber',p);
  loadSettingsPNumber();
  restorePNumber();
  renderReports();
  showToast(`${date} ${session} P Number ${p} သိမ်းပြီးပါပြီ`);
}
function clearSettingsPNumber(){
  const date=val('settingsPDate')||today();
  const session=val('settingsPSession')||'AM';
  delete pMemory[pKey(date,session)];
  savePMemory();
  setVal('settingsPNumber','');
  loadSettingsPNumber();
  restorePNumber();
  renderReports();
  showToast(`${date} ${session} P Number ဖျက်ပြီးပါပြီ`);
}
function applyGlobalDateSession(date, session, rerender=true){
  const d = date || today();
  const s = session || 'AM';
  globalView = {date:d, session:s};
  saveGlobalView();

  setValueIfExists('globalDate', d);
  setValueIfExists('globalSession', s);

  ['entryDate','recordDate','limitDate','overDate','reportDate','imageDate'].forEach(id => setValueIfExists(id, d));
  ['entrySession','recordSession','limitSession','overSession','reportSession','imageSession'].forEach(id => setValueIfExists(id, s));

  restorePNumber();
  if(document.getElementById('settingsPDate')){
    setVal('settingsPDate', d);
    if(s==='AM' || s==='PM') setVal('settingsPSession', s);
    loadSettingsPNumber();
  }
  loadManualDealerInputs();
  renderMiniTopInfo();
  if(rerender) renderAll();
}
function onGlobalDateChange(v){
  sessionManualLock = false;
  saveSessionLock();
  applyGlobalDateSession(v, autoSessionForDate(v), true);
}
function onGlobalSessionChange(v){
  sessionManualLock = true;
  saveSessionLock();
  applyGlobalDateSession(val('globalDate') || globalView.date || today(), v, true);
}
function setupGlobalSyncListeners(){
  ['entryDate','recordDate','limitDate','overDate','reportDate','imageDate'].forEach(id=>{
    const el=document.getElementById(id);
    if(!el) return;
    el.addEventListener('change', ()=>{
      sessionManualLock = false;
      saveSessionLock();
      applyGlobalDateSession(el.value, autoSessionForDate(el.value), true);
    });
  });
  ['entrySession','recordSession','limitSession','overSession','reportSession','imageSession'].forEach(id=>{
    const el=document.getElementById(id);
    if(!el) return;
    el.addEventListener('change', ()=>{
      const newSession = el.value || 'AM';
      const date = val('globalDate') || globalView.date || today();
      sessionManualLock = true;
      saveSessionLock();
      applyGlobalDateSession(date, newSession, true);
    });
  });
  const pEl = document.getElementById('pNumber');
  if(pEl) pEl.readOnly = true;
}
function startAutoPMSync(){
  setInterval(()=>{
    const currentDate = val('globalDate') || globalView.date || today();
    if(currentDate !== today()) return;
    if(sessionManualLock) return;
    const autoSession = autoSessionForDate(currentDate);
    const currentSession = val('globalSession') || globalView.session || 'AM';
    if(currentSession !== 'DAILY' && currentSession !== autoSession){
      applyGlobalDateSession(currentDate, autoSession, true);
      showToast('Auto session → ' + autoSession);
    }
  }, 60000);
}
function money(n){return Number(n||0).toLocaleString('en-US')}
function unit(n){let v=Number(n||0)/100; return Number.isInteger(v)? String(v): String(parseFloat(v.toFixed(2)))}
function inferToastType(message){
  const s=String(message||'').toLowerCase();
  if(/မအောင်မြင်|error|failed|permission|မရှိ|မရွေး|မရပါ/.test(s)) return 'error';
  if(/duplicate|သတိ|စစ်|ရွေးပါ|ပြည့်/.test(s)) return 'warn';
  if(/အောင်မြင်|ပြီးပါပြီ|saved|save ပြီး|login အောင်မြင်/.test(s)) return 'success';
  return 'info';
}
function showToast(msg,type='',duration=4200){
  let t=document.getElementById('toast');
  if(!t){
    t=document.createElement('div');
    t.id='toast';
    t.className='toast';
    t.setAttribute('role','status');
    t.setAttribute('aria-live','polite');
    t.setAttribute('aria-atomic','true');
    document.body.appendChild(t);
  }
  const finalType=type||inferToastType(msg);
  t.textContent=translateUiMessage(String(msg||''));
  t.className=`toast ${finalType}`;
  // Restart the entrance animation even for back-to-back notices.
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(window.__v2dToastTimer);
  window.__v2dToastTimer=setTimeout(()=>{
    t.classList.remove('show');
  },Math.max(2500,Number(duration)||4200));
}
function saveRecords(){
  try{
    userSetItem('v2d_records',JSON.stringify(records));
  }catch(e){
    showToast('Save storage ပြည့်နေပါတယ်။ Audit history ကို လျှော့ပြီး ထပ်သိမ်းပါ');
    throw e;
  }
}

const CLOUD_SYNC_VERSION='4.3.0';
const CLOUD_WORKSPACE_DOC_ID='current_workspace';
const CLOUD_SYNC_DEBOUNCE_MS=900;
const CLOUD_RELEVANT_STORAGE_KEYS=new Set([
  'v2d_records','v2d_over_deductions','v2d_settings','v2d_global_view',
  'v2d_p_memory','v2d_dealer_manual_memory','v2d_audit_trail'
]);
const DEVICE_ID=(()=>{
  const key='v2d_device_id';
  let id=localStorage.getItem(key);
  if(!id){
    id=(window.crypto?.randomUUID?.()||('device-'+Date.now()+'-'+Math.random().toString(36).slice(2)));
    localStorage.setItem(key,id);
  }
  return id;
})();

let cloudSyncState={
  initialized:false,
  uiReady:false,
  dirty:false,
  dirtyBaseHash:'',
  baseHash:'',
  timer:null,
  inFlight:false,
  queued:false,
  unsubscribe:null,
  conflictData:null,
  lastSyncedAt:'',
  lastError:'',
  needsInitialUpload:false
};

function isCloudRelevantKey(base){ return CLOUD_RELEVANT_STORAGE_KEYS.has(String(base||'')); }
function cloudMetaKey(){ return userStorageKey('v2d_cloud_meta'); }
function readCloudMeta(){
  try{return JSON.parse(localStorage.getItem(cloudMetaKey())||'{}')||{};}catch(_e){return {};}
}
function writeCloudMeta(patch={}){
  const current=readCloudMeta();
  const next={...current,...patch,updatedAt:new Date().toISOString()};
  localStorage.setItem(cloudMetaKey(),JSON.stringify(next));
  return next;
}
function simpleHash(text){
  let h=2166136261;
  const str=String(text||'');
  for(let i=0;i<str.length;i++){
    h^=str.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
  return (h>>>0).toString(16).padStart(8,'0');
}
function compactAuditForCloud(items){
  return (Array.isArray(items)?items:[]).slice(0,60).map(item=>({
    ...item,
    rawText:item?.rawText?String(item.rawText).slice(0,1500):''
  }));
}
function normalizeCloudRecords(items){
  return (Array.isArray(items)?items:[]).map((row,index)=>({
    ...row,
    id:row?.id||`legacy-${row?.ts||0}-${index}-${row?.number||'00'}-${row?.amount||0}`,
    cardId:row?.cardId||'',
    cardNumber:Number(row?.cardNumber||0)||0,
    cardIndexInBatch:Number(row?.cardIndexInBatch||row?.cardIndexInPaste||0)||0,
    cardTime:row?.cardTime||'',
    cardHeaderStamp:row?.cardHeaderStamp||row?.headerStamp||'',
    cardHeaderName:row?.cardHeaderName||'',
    cardRawText:row?.cardRawText||''
  }));
}
function currentWorkspaceState(){
  return {
    records:normalizeCloudRecords(records),
    overDeductions:Array.isArray(overDeductions)?overDeductions:[],
    settings:settings&&typeof settings==='object'?settings:{},
    globalView:globalView&&typeof globalView==='object'?globalView:{},
    pMemory:pMemory&&typeof pMemory==='object'?pMemory:{},
    dealerManualMemory:dealerManualMemory&&typeof dealerManualMemory==='object'?dealerManualMemory:{},
    auditTrail:compactAuditForCloud(auditTrail)
  };
}
function workspaceContentHash(state=currentWorkspaceState()){
  return simpleHash(JSON.stringify(state));
}
function buildCloudWorkspace(reason='auto'){
  const state=currentWorkspaceState();
  const contentHash=workspaceContentHash(state);
  return {
    type:'cloud_first_workspace',
    schemaVersion:2,
    app:'Viber 2D Desk',
    version:'Stage 4.3.0 Language + Theme',
    syncVersion:CLOUD_SYNC_VERSION,
    ownerUid:CURRENT_UID,
    ownerEmail:CURRENT_USER?.email||'',
    deviceId:DEVICE_ID,
    reason,
    contentHash,
    ...state,
    totalRecords:state.records.length,
    totalAmount:state.records.reduce((sum,row)=>sum+Number(row.amount||0),0),
    clientUpdatedAt:new Date().toISOString(),
    updatedAt:firebase.firestore.FieldValue.serverTimestamp()
  };
}
function currentUserSnapshotsRef(){
  if(!db || !CURRENT_USER) return null;
  return db.collection('users').doc(CURRENT_UID).collection('snapshots');
}
function currentWorkspaceRef(){
  const snapshots=currentUserSnapshotsRef();
  return snapshots?snapshots.doc(CLOUD_WORKSPACE_DOC_ID):null;
}
function formatSyncTime(value){
  const date=value?new Date(value):new Date();
  if(Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
}
function setCloudSyncStatus(status,message='',detail=''){
  const pill=document.getElementById('cloudSyncPill');
  const text=document.getElementById('cloudSyncText');
  const small=document.getElementById('cloudSyncDetail');
  if(pill) pill.className=`cloudSyncPill ${status}`;
  const defaults={
    loading:tUi('cloudLoading'),
    saving:tUi('saving'),
    synced:tUi('cloudSynced'),
    offline:tUi('offlineWaiting'),
    conflict:tUi('syncConflict'),
    error:tUi('syncError')
  };
  if(text) text.textContent=message?translateUiMessage(message):(defaults[status]||'Cloud');
  const finalDetail=detail?translateUiMessage(detail):(
    status==='synced'&&cloudSyncState.lastSyncedAt?`${tUi('last')} ${formatSyncTime(cloudSyncState.lastSyncedAt)}`:
    status==='offline'?tUi('autoSyncWhenOnline'):
    status==='conflict'?tUi('newerDataOtherDevice'):
    status==='loading'?tUi('checkingAccountData'):''
  );
  if(small) small.textContent=finalDetail;
  const wsBox=document.getElementById('entryWsSyncBox');
  const wsText=document.getElementById('entryWsSyncText');
  const wsDetail=document.getElementById('entryWsSyncDetail');
  if(wsBox) wsBox.className=`workspaceSyncBox ${status}`;
  if(wsText) wsText.textContent=message||defaults[status]||'Cloud';
  if(wsDetail) wsDetail.textContent=finalDetail;
}
function persistWorkspaceStateLocally(){
  window.__V2D_APPLYING_REMOTE=true;
  try{
    userSetItem('v2d_records',JSON.stringify(records));
    userSetItem('v2d_over_deductions',JSON.stringify(overDeductions));
    userSetItem('v2d_settings',JSON.stringify(settings));
    userSetItem('v2d_global_view',JSON.stringify(globalView));
    userSetItem('v2d_p_memory',JSON.stringify(pMemory));
    userSetItem('v2d_dealer_manual_memory',JSON.stringify(dealerManualMemory));
    userSetItem('v2d_audit_trail',JSON.stringify((auditTrail||[]).slice(0,120)));
  }finally{
    window.__V2D_APPLYING_REMOTE=false;
  }
}
function applyCloudWorkspace(data,{initial=false}={}){
  if(!data || typeof data!=='object') return false;
  window.__V2D_APPLYING_REMOTE=true;
  try{
    records=normalizeCloudRecords(data.records);
    overDeductions=Array.isArray(data.overDeductions)?data.overDeductions:[];
    settings=data.settings&&typeof data.settings==='object'?data.settings:{};
    globalView=data.globalView&&typeof data.globalView==='object'?data.globalView:{};
    pMemory=data.pMemory&&typeof data.pMemory==='object'?data.pMemory:{};
    dealerManualMemory=data.dealerManualMemory&&typeof data.dealerManualMemory==='object'?data.dealerManualMemory:{};
    auditTrail=Array.isArray(data.auditTrail)?data.auditTrail:[];
    persistWorkspaceStateLocally();
  }finally{
    window.__V2D_APPLYING_REMOTE=false;
  }
  const hash=data.contentHash||workspaceContentHash();
  cloudSyncState.baseHash=hash;
  cloudSyncState.dirtyBaseHash='';
  cloudSyncState.dirty=false;
  cloudSyncState.conflictData=null;
  cloudSyncState.lastSyncedAt=data.clientUpdatedAt||new Date().toISOString();
  writeCloudMeta({pending:false,lastCloudHash:hash,dirtyBaseHash:'',lastSyncedAt:cloudSyncState.lastSyncedAt,lastError:''});
  if(!initial && cloudSyncState.uiReady) refreshUiFromCloud();
  return true;
}
function refreshUiFromCloud(){
  window.__V2D_APPLYING_REMOTE=true;
  try{
    settings={shopName:(initialRegisteredShopName||'Viber 2D Desk'),commissionRate:20,payoutRate:80,defaultLimit:10000,amClose:'12:00',pmClose:'16:30',names:['Default'],nameRates:{Default:20},lang:(localStorage.getItem('v2d_ui_language')||'my'),theme:(localStorage.getItem('v2d_ui_theme')||'system'),...settings};
    if(!Array.isArray(settings.names)||!settings.names.length) settings.names=['Default'];
    if(!settings.nameRates) settings.nameRates={};
    settings.names.forEach(name=>{if(settings.nameRates[name]==null) settings.nameRates[name]=settings.commissionRate||20;});
    setVal('shopName',settings.shopName);
    setVal('commissionRate',settings.commissionRate);
    setVal('payoutRate',settings.payoutRate);
    setVal('defaultLimit',settings.defaultLimit);
    setVal('amClose',settings.amClose);
    setVal('pmClose',settings.pmClose);
    refreshNameSelects();
    setLang(settings.lang||'my');
    syncLimitInputs();
    loadSettingsPNumber();
    loadManualDealerInputs();
    renderAll();
    renderDiagnostics();
  }finally{
    window.__V2D_APPLYING_REMOTE=false;
  }
}
function markCloudDirty(reason='local-change'){
  if(window.__V2D_APPLYING_REMOTE) return;
  if(!cloudSyncState.dirty){
    cloudSyncState.dirtyBaseHash=cloudSyncState.baseHash||readCloudMeta().lastCloudHash||'';
  }
  cloudSyncState.dirty=true;
  writeCloudMeta({pending:true,dirtyBaseHash:cloudSyncState.dirtyBaseHash,lastError:''});
  if(!navigator.onLine){
    setCloudSyncStatus('offline');
  }else{
    setCloudSyncStatus('saving','Saving…','ပြောင်းလဲမှုကို Cloud တင်ရန် စောင့်နေသည်');
  }
}
function scheduleCloudSync(reason='local-change',delay=CLOUD_SYNC_DEBOUNCE_MS){
  if(!CURRENT_USER || !db || window.__V2D_APPLYING_REMOTE) return;
  markCloudDirty(reason);
  clearTimeout(cloudSyncState.timer);
  cloudSyncState.timer=setTimeout(()=>flushCloudWorkspace({showMsg:false,reason}),Math.max(100,Number(delay)||CLOUD_SYNC_DEBOUNCE_MS));
}
async function flushCloudWorkspace({showMsg=false,reason='auto',force=false}={}){
  if(!CURRENT_USER || !db){
    setCloudSyncStatus('error','Sync Error','Login/Firebase မချိတ်မိသေးပါ');
    if(showMsg) showToast('Login/Firebase မချိတ်မိသေးပါ','error',5500);
    return false;
  }
  if(!navigator.onLine){
    markCloudDirty(reason);
    if(showMsg) showToast('Internet မရှိသေးပါ။ Data ကို စက်ထဲသိမ်းထားပြီး Internet ပြန်ရလျှင် Auto Sync လုပ်မယ်','warn',6500);
    return false;
  }
  if(cloudSyncState.inFlight){
    cloudSyncState.queued=true;
    return false;
  }
  if(cloudSyncState.conflictData && !force){
    setCloudSyncStatus('conflict');
    if(showMsg) showToast('တခြားစက်မှာ Cloud Data အသစ်ရှိနေပါတယ်။ Backup JSON ထုတ်ပြီး Cloud Refresh ဖြင့် စစ်ပါ','error',7500);
    return false;
  }
  const payload=buildCloudWorkspace(reason);
  const payloadBytes=new TextEncoder().encode(JSON.stringify({...payload,updatedAt:null})).length;
  if(payloadBytes>950000){
    const message='Cloud workspace အရွယ်အစားကြီးလွန်းနေပါတယ်။ Backup JSON ထုတ်ထားပြီး Card-based Cloud Stage ကို ဆက်တင်ပါ';
    cloudSyncState.lastError=message;
    writeCloudMeta({pending:true,lastError:message});
    setCloudSyncStatus('error','Sync Size Limit',`${Math.round(payloadBytes/1024)} KB`);
    if(showMsg) showToast(message,'error',8000);
    return false;
  }
  if(!force && !cloudSyncState.dirty && payload.contentHash===cloudSyncState.baseHash){
    setCloudSyncStatus('synced');
    return true;
  }
  cloudSyncState.inFlight=true;
  cloudSyncState.queued=false;
  setCloudSyncStatus('saving','Saving…',showMsg?'Cloud ကို တင်နေသည်':'Auto Sync လုပ်နေသည်');
  if(showMsg) showToast('Cloud Sync စတင်နေပါသည်…','info',3000);
  try{
    const ref=currentWorkspaceRef();
    if(!ref) throw new Error('Cloud workspace path မရပါ');
    const expectedBase=cloudSyncState.dirtyBaseHash||cloudSyncState.baseHash||'';
    await db.runTransaction(async transaction=>{
      const snap=await transaction.get(ref);
      if(snap.exists){
        const remote=snap.data()||{};
        const remoteHash=remote.contentHash||'';
        const changedElsewhere=remoteHash && expectedBase && remoteHash!==expectedBase && remote.deviceId!==DEVICE_ID;
        if(changedElsewhere){
          const err=new Error('တခြားစက်မှာ Cloud Data အသစ်ပြောင်းထားပါတယ်');
          err.code='v2d/cloud-conflict';
          err.remoteData=remote;
          throw err;
        }
      }
      transaction.set(ref,payload,{merge:false});
    });
    records=payload.records;
    cloudSyncState.baseHash=payload.contentHash;
    cloudSyncState.dirtyBaseHash='';
    cloudSyncState.dirty=false;
    cloudSyncState.conflictData=null;
    cloudSyncState.lastError='';
    cloudSyncState.lastSyncedAt=payload.clientUpdatedAt;
    writeCloudMeta({pending:false,lastCloudHash:payload.contentHash,dirtyBaseHash:'',lastSyncedAt:payload.clientUpdatedAt,lastError:''});
    userRemoveItem('v2d_force_sync_on_boot');
    setCloudSyncStatus('synced');
    if(showMsg) showToast('Cloud Sync အောင်မြင်ပါပြီ','success',5000);
    return true;
  }catch(err){
    console.error('Cloud sync failed',err);
    cloudSyncState.lastError=err?.message||String(err);
    if(err?.code==='v2d/cloud-conflict'){
      cloudSyncState.conflictData=err.remoteData||{};
      writeCloudMeta({pending:true,lastError:cloudSyncState.lastError});
      setCloudSyncStatus('conflict');
      if(showMsg) showToast('Sync Conflict: တခြားစက်မှာ Data အသစ်ရှိနေပါတယ်။ Local Data ကို မဖျက်ထားပါ','error',8000);
    }else{
      writeCloudMeta({pending:true,lastError:cloudSyncState.lastError});
      setCloudSyncStatus(navigator.onLine?'error':'offline','Sync Error',cloudSyncState.lastError);
      if(showMsg) showToast('Cloud Sync မအောင်မြင်ပါ: '+cloudSyncState.lastError,'error',7500);
    }
    return false;
  }finally{
    cloudSyncState.inFlight=false;
    if(cloudSyncState.queued && !cloudSyncState.conflictData){
      cloudSyncState.queued=false;
      setTimeout(()=>flushCloudWorkspace({showMsg:false,reason:'queued-change'}),250);
    }
  }
}
async function findLatestLegacySnapshot(){
  const snapshots=currentUserSnapshotsRef();
  if(!snapshots) return null;
  try{
    const snap=await snapshots.orderBy('localCreatedAt','desc').limit(30).get();
    let found=null;
    snap.forEach(doc=>{
      const data=doc.data()||{};
      if(!found && doc.id!==CLOUD_WORKSPACE_DOC_ID && data.type==='stage2_full_snapshot') found=data;
    });
    return found;
  }catch(err){
    console.warn('Legacy snapshot lookup skipped',err);
    return null;
  }
}
async function fetchCurrentWorkspace({serverFirst=true}={}){
  const ref=currentWorkspaceRef();
  if(!ref) return null;
  if(serverFirst && navigator.onLine){
    try{
      const snap=await ref.get({source:'server'});
      return snap.exists?snap.data():null;
    }catch(err){
      console.warn('Server workspace read failed; trying cache',err);
    }
  }
  try{
    const snap=await ref.get();
    return snap.exists?snap.data():null;
  }catch(_err){
    return null;
  }
}
function subscribeCloudWorkspace(){
  const ref=currentWorkspaceRef();
  if(!ref || cloudSyncState.unsubscribe) return;
  cloudSyncState.unsubscribe=ref.onSnapshot({includeMetadataChanges:true},snap=>{
    if(!snap.exists) return;
    const data=snap.data()||{};
    if(snap.metadata.hasPendingWrites){
      setCloudSyncStatus('saving','Saving…','Browser queue ထဲမှာရှိသည်');
      return;
    }
    const remoteHash=data.contentHash||'';
    if(!remoteHash){ setCloudSyncStatus('synced'); return; }
    if(remoteHash===cloudSyncState.baseHash){
      cloudSyncState.lastSyncedAt=data.clientUpdatedAt||cloudSyncState.lastSyncedAt||new Date().toISOString();
      setCloudSyncStatus('synced');
      return;
    }
    if(cloudSyncState.dirty){
      cloudSyncState.conflictData=data;
      setCloudSyncStatus('conflict');
      return;
    }
    applyCloudWorkspace(data,{initial:false});
    setCloudSyncStatus('synced','Cloud Updated',`တခြားစက်မှ ${formatSyncTime(data.clientUpdatedAt)}`);
    if(cloudSyncState.uiReady) showToast('တခြားစက်မှ Cloud Data အသစ်ကို Auto Update လုပ်ပြီးပါပြီ','success',4500);
  },err=>{
    console.error('Cloud listener error',err);
    setCloudSyncStatus(navigator.onLine?'error':'offline','Sync Error',err?.message||String(err));
  });
}
async function initializeCloudFirstSync(){
  setCloudSyncStatus('loading');
  const meta=readCloudMeta();
  cloudSyncState.baseHash=meta.lastCloudHash||'';
  cloudSyncState.dirty=meta.pending===true;
  cloudSyncState.dirtyBaseHash=meta.dirtyBaseHash||cloudSyncState.baseHash||'';
  cloudSyncState.lastSyncedAt=meta.lastSyncedAt||'';
  const forceUpload=userGetItem('v2d_force_sync_on_boot')==='1';
  try{ await Promise.resolve(window.v2dPersistenceReady); }catch(_e){}
  const remote=await fetchCurrentWorkspace({serverFirst:true});
  if(remote){
    const remoteHash=remote.contentHash||'';
    if(forceUpload){
      cloudSyncState.baseHash=remoteHash;
      cloudSyncState.dirty=true;
      cloudSyncState.dirtyBaseHash=remoteHash;
      cloudSyncState.needsInitialUpload=true;
    }else if(cloudSyncState.dirty){
      const expected=cloudSyncState.dirtyBaseHash||cloudSyncState.baseHash||'';
      if(expected && remoteHash && expected!==remoteHash){
        cloudSyncState.conflictData=remote;
      }else{
        cloudSyncState.baseHash=remoteHash;
        cloudSyncState.dirtyBaseHash=remoteHash;
        cloudSyncState.needsInitialUpload=true;
      }
    }else{
      applyCloudWorkspace(remote,{initial:true});
    }
  }else if(!forceUpload && !cloudSyncState.dirty){
    const legacy=await findLatestLegacySnapshot();
    if(legacy){
      applyCloudWorkspace(legacy,{initial:true});
      cloudSyncState.needsInitialUpload=true;
      cloudSyncState.dirty=true;
      cloudSyncState.dirtyBaseHash='';
    }else{
      cloudSyncState.needsInitialUpload=true;
      cloudSyncState.dirty=true;
      cloudSyncState.dirtyBaseHash='';
    }
  }else{
    cloudSyncState.needsInitialUpload=true;
  }
  cloudSyncState.initialized=true;
  window.__V2D_CLOUD_SYNC_READY=true;
  subscribeCloudWorkspace();
  if(cloudSyncState.conflictData){
    setCloudSyncStatus('conflict');
  }else if(!navigator.onLine){
    setCloudSyncStatus('offline');
  }else if(cloudSyncState.needsInitialUpload || cloudSyncState.dirty){
    setCloudSyncStatus('saving','Saving…','Initial Auto Sync စောင့်နေသည်');
  }else{
    setCloudSyncStatus('synced');
  }
}
async function saveCloudSnapshot(showMsg=true){
  if(showMsg) return flushCloudWorkspace({showMsg:true,reason:'manual-sync',force:false});
  scheduleCloudSync('legacy-auto-call');
  return true;
}
async function loadLatestCloudSnapshot(){
  if(!db || !CURRENT_USER){ showToast('Login/Firebase မချိတ်မိသေးပါ','error',5500); return; }
  const hasPending=cloudSyncState.dirty||readCloudMeta().pending===true;
  const prompt=hasPending
    ? 'ဒီစက်မှာ Cloud မတင်ရသေးသော ပြောင်းလဲမှုရှိပါတယ်။ Backup JSON အရင်ထုတ်ရန် အကြံပြုပါတယ်။ Cloud Data ဖြင့် Local Data ကို အစားထိုးမလား?'
    : 'Cloud မှနောက်ဆုံး Data ကို ပြန်ဖတ်မလား?';
  if(!confirm(prompt)) return;
  try{
    showToast('Cloud Data ပြန်ဖတ်နေပါသည်…','info',3500);
    let found=await fetchCurrentWorkspace({serverFirst:true});
    if(!found) found=await findLatestLegacySnapshot();
    if(!found){ showToast('Cloud Data မတွေ့သေးပါ','warn',5000); return; }
    applyCloudWorkspace(found,{initial:false});
    cloudSyncState.conflictData=null;
    setCloudSyncStatus('synced');
    showToast('Cloud Refresh အောင်မြင်ပါပြီ','success',5000);
  }catch(err){
    console.error(err);
    showToast('Cloud Refresh မအောင်မြင်ပါ: '+(err?.message||err),'error',7000);
  }
}
function syncCloudNow(){ return saveCloudSnapshot(true); }

window.addEventListener('offline',()=>{
  if(cloudSyncState.dirty) writeCloudMeta({pending:true});
  setCloudSyncStatus('offline');
});
window.addEventListener('online',()=>{
  flushParserReportQueue();
  if(cloudSyncState.conflictData){ setCloudSyncStatus('conflict'); return; }
  if(cloudSyncState.dirty || readCloudMeta().pending===true){
    flushCloudWorkspace({showMsg:false,reason:'network-restored'});
  }else{
    setCloudSyncStatus('synced');
  }
});

function saveOverDeductions(){userSetItem('v2d_over_deductions',JSON.stringify(overDeductions));}
function saveSettings(){
  settings.shopName = val('shopName') || 'Viber 2D Desk';
  settings.commissionRate = Number(val('commissionRate')||0);
  settings.payoutRate = Number(val('payoutRate')||80);
  settings.defaultLimit = Number(val('defaultLimit')||10000);
  settings.amClose = val('amClose') || '12:00';
  settings.pmClose = val('pmClose') || '16:30';
  if(!Array.isArray(settings.names)||!settings.names.length) settings.names=['Default'];
  if(!settings.nameRates) settings.nameRates={}; settings.names.forEach(n=>{if(settings.nameRates[n]==null) settings.nameRates[n]=settings.commissionRate||20;});
  settings.lang = val('langSelect') || settings.lang || 'my';
  settings.lastWriter = val('entryWriter') || settings.lastWriter || 'AUTO';
  userSetItem('v2d_settings',JSON.stringify(settings));
}
function val(id){const el=document.getElementById(id); return el?el.value:''}
function setVal(id,v){const el=document.getElementById(id); if(el) el.value=v}
function uniq(a){return [...new Set(a)]}
function rev(n){n=String(n).padStart(2,'0'); return n[1]+n[0]}
function even(d){return Number(d)%2===0}
function odd(d){return !even(d)}
function splitPairs(s){const c=String(s).replace(/\D/g,''); const out=[]; for(let i=0;i+1<c.length;i+=2) out.push(c.slice(i,i+2)); return out.filter(x=>/^\d{2}$/.test(x));}
function normalize(s){
  return String(s||'')
    .normalize('NFKC')
    .replace(/[@&]/g,'R')
    .replace(/[Ｒｒ]/g,'R')
    .replace(/([0-9]{2}(?:[\s,./-]+[0-9]{2})*)\s*[|¦]+\s*(\d+)/g,'$1R$2')
    .replace(/([0-9]{2})[)\]}>]+(?=\s*\d)/g,'$1=')
    .replace(/([0-9]{2})\s*[:;"'`]+(?=\s*[0-9]{2}\b)/g,'$1.')
    .replace(/([0-9])\s*[-=:."']+\s*(ထိပ်|ထိပ်စီး|ရှေ့|အရှေ့|နောက်|အနောက်|အပိတ်|ပိတ်)/g,'$1 $2 ')
    .replace(/(ထိပ်|ထိပ်စီး|ရှေ့|အရှေ့|နောက်|အနောက်|အပိတ်|ပိတ်)\s*[-=:."']+\s*(\d+)/g,'$1 $2')
    .replace(/([0-9]{2})\s*[-=:."']+\s*(?=[0-9]{2}\b)/g,'$1.')
    .replace(/([0-9]{2})\s*[({\[]+\s*(?=[0-9]{2}\b)/g,'$1.')
    .replace(/([0-9]{2})\s*[)}\]>]+\s*(?=[0-9]{2}\b)/g,'$1.')
    .replace(/အပါ/g,'ပါ')
    .replace(/အပူ/g,'အပူး')
    .replace(/အခေွ|အခွဲ/g,'အခွေ')
    .replace(/ပါဝါ/g,' A ')
    .replace(/နက်ခက်|နက္ခ|နက်ခ/g,' Z ')
    .replace(/ညီအကို|ညီကို/g,' B ')
    .replace(/[＝]/g,'=')
    .replace(/[–—−]/g,'-')
    .replace(/\r/g,'\n')
    .trim();
}
function numberGroups(s){return [...String(s).matchAll(/\d+/g)].map(m=>m[0]);}
function breakNums(code){
  const n=Number(code); if(!Number.isFinite(n)) return [];
  let sums=[]; if(n>=10 && n<=18) sums=[n-10,n]; else sums=[n];
  return N2.filter(x=>sums.includes(Number(x[0])+Number(x[1])));
}
function containsDigit(d){return N2.filter(x=>x.includes(d));}
function comboDigits(ds){ds=uniq(ds.filter(x=>/\d/.test(x))); const out=[]; ds.forEach(a=>ds.forEach(b=>out.push(a+b))); return out;}
function parityNums(a,b){
  return N2.filter(n=>{
    const okA = a==='+'?even(n[0]):a==='-'?odd(n[0]):a==='/'?true:n[0]===a;
    const okB = b==='+'?even(n[1]):b==='-'?odd(n[1]):b==='/'?true:n[1]===b;
    return okA && okB;
  });
}
function expandToken(token){
  let t=normalize(token).toUpperCase().replace(/\s+/g,'');
  if(!t) return [];
  if(FIXED[t]) return FIXED[t].slice();
  if(t.includes('-') && !['--','-+','-/'].includes(t) && !/^\d-$/.test(t) && !/^\/-$/.test(t)){
    const idx=t.indexOf('-'); const base=t.slice(0,idx); const rem=t.slice(idx+1);
    const baseNums=expandToken(base); const remNums=splitPairs(rem);
    if(baseNums.length && remNums.length) return baseNums.filter(n=>!remNums.includes(n));
  }
  if(t==='//') return N2.filter(n=>n[0]===n[1]);
  if(t==='++') return parityNums('+','+');
  if(t==='--') return parityNums('-','-');
  if(t==='+-') return parityNums('+','-');
  if(t==='-+') return parityNums('-','+');
  if(t==='+/') return parityNums('+','/');
  if(t==='-/') return parityNums('-','/');
  if(t==='/+') return parityNums('/','+');
  if(t==='/-') return parityNums('/','-');
  if(/^\+\d$/.test(t)) return parityNums('+',t[1]);
  if(/^-\d$/.test(t)) return parityNums('-',t[1]);
  if(/^\d\+$/.test(t)) return parityNums(t[0],'+');
  if(/^\d-$/.test(t)) return parityNums(t[0],'-');
  if(/^\d\/$/.test(t)) return parityNums(t[0],'/');
  if(/^\/\d$/.test(t)) return parityNums('/',t[1]);
  if(/^\/\d{2}$/.test(t)) return [t.slice(1)];
  if(/^\*\d{1,2}$/.test(t)) return breakNums(t.slice(1));
  if(/^\d\*$/.test(t)) return containsDigit(t[0]);
  if(/^\d{2}\*$/.test(t)) return uniq([t.slice(0,2),rev(t.slice(0,2))]);
  if(/^\d{2,}\*\*$/.test(t)) return comboDigits(t.replace(/\*\*/g,'').split(''));
  if(/^\d{2}$/.test(t)) return [t];
  if(/^\d{4,}$/.test(t) && t.length%2===0) return splitPairs(t);
  return [];
}
function expandExpression(expr){
  expr=normalize(expr);
  const rawTokens=expr.split(/[\s,.]+/).filter(Boolean);
  const out=[];
  rawTokens.forEach(tok=>{
    if(/^\d{2}\/\d{2}(\/\d{2})*$/.test(tok)) tok.split('/').forEach(x=>out.push(x));
    else expandToken(tok).forEach(x=>out.push(x));
  });
  return uniq(out.filter(x=>/^\d{2}$/.test(x)));
}
function addRow(rows,warnings,num,amount,source,type){
  num=String(num).padStart(2,'0'); const amt=Number(String(amount).replace(/[^\d]/g,''));
  if(!/^\d{2}$/.test(num)){warnings.push('Number မမှန်: '+num+' | '+source);return;}
  if(!Number.isFinite(amt)||amt<=0){warnings.push('Amount မမှန်: '+amount+' | '+source);return;}
  rows.push({number:num,amount:amt,type,source});
}
function parseReverseLine(line){
  const source=line; const rows=[]; const warnings=[]; const s=normalize(line); const up=s.toUpperCase(); const rIndex=up.indexOf('R');
  const before=s.slice(0,rIndex).trim(); const after=s.slice(rIndex+1).trim(); const afterNums=numberGroups(after); const beforeGroups=numberGroups(before);
  if(!afterNums.length){warnings.push('R နောက် amount မတွေ့: '+source); return {rows,warnings, meta:null};}
  let nums=[], normalAmount=afterNums[0], reverseAmount=afterNums[0], carryable=true;
  const lastBefore=beforeGroups[beforeGroups.length-1];
  if(beforeGroups.length>=2 && lastBefore && lastBefore.length>2){
    // Example: 86.87.1000R250 => normal amount 1000, reverse amount 250.
    // This mixed-amount style is not used as carry mode for following bare lines.
    normalAmount=lastBefore; reverseAmount=afterNums[0]; carryable=false;
    nums=beforeGroups.slice(0,-1).flatMap(g=>g.length===2?[g]:splitPairs(g));
  }else{
    // Example: 52R500 or 34 r 300 => both original and reverse use 500/300.
    nums=expandExpression(before);
  }
  if(!nums.length){warnings.push('R ရှေ့ number မတွေ့: '+source); return {rows,warnings, meta:null};}
  nums.forEach(n=>{
    addRow(rows,warnings,n,normalAmount,source,'normal');
    // In Viber R mode, doubles are intentionally entered twice, e.g. 00=300 and 00=300.
    addRow(rows,warnings,rev(n),reverseAmount,source,'reverse');
  });
  return {rows,warnings, meta: carryable ? {mode:'reverse', amount:Number(reverseAmount)} : null};
}

function tokenList(s){
  return [...normalize(s).matchAll(/[Rr]|\d+|[^\dRr]+/g)].map(m=>m[0]).filter(Boolean);
}
function isNumTok(t){return /^\d+$/.test(t);}
function isRTok(t){return /^[Rr]$/.test(t);}
function nextNumber(tokens, start){
  for(let j=start;j<tokens.length;j++) if(isNumTok(tokens[j])) return {value:tokens[j], index:j};
  return null;
}
function nextR(tokens, start){
  for(let j=start;j<tokens.length;j++){
    if(isRTok(tokens[j])) return j;
    if(isNumTok(tokens[j])) return -1;
  }
  return -1;
}
function emitNormal(nums, amount, rows, warnings, source, type='normal'){
  nums.forEach(n=>addRow(rows,warnings,n,amount,source,type));
}
function emitReverse(nums, normalAmount, reverseAmount, rows, warnings, source, mixed=false){
  nums.forEach(n=>{
    addRow(rows,warnings,n,normalAmount,source,mixed?'mixed-normal':'normal');
    addRow(rows,warnings,rev(n),reverseAmount,source,mixed?'mixed-reverse':'reverse');
  });
}
function parseComplexLine(line){
  // Smart inline parser for styles like:
  // 42.32,65.21.700r300
  // 45.65R500,23,53.86.300r200.77,22,00.1000,
  const source=line; const rows=[]; const warnings=[]; const tokens=tokenList(line);
  let nums=[]; let meta=null;
  for(let i=0;i<tokens.length;i++){
    const t=tokens[i];
    if(isNumTok(t)){
      if(t.length===2){ nums.push(t); continue; }
      // length >= 3 means amount in this number-only parser.
      const rIdx=nextR(tokens,i+1);
      if(rIdx>i){
        const revObj=nextNumber(tokens,rIdx+1);
        if(!revObj){ warnings.push('R နောက် amount မတွေ့: '+source); break; }
        if(!nums.length){ warnings.push('Amount ရှေ့ number မတွေ့: '+source); }
        emitReverse(nums,t,revObj.value,rows,warnings,source,true);
        nums=[]; meta=null; i=revObj.index; continue;
      }else{
        if(!nums.length){ warnings.push('Amount ရှေ့ number မတွေ့: '+source); }
        emitNormal(nums,t,rows,warnings,source,'normal');
        nums=[]; meta={mode:'normal', amount:Number(t)}; continue;
      }
    }
    if(isRTok(t)){
      const amtObj=nextNumber(tokens,i+1);
      if(!amtObj){ warnings.push('R နောက် amount မတွေ့: '+source); break; }
      if(!nums.length){ warnings.push('R ရှေ့ number မတွေ့: '+source); }
      emitReverse(nums,amtObj.value,amtObj.value,rows,warnings,source,false);
      nums=[]; meta={mode:'reverse', amount:Number(amtObj.value)}; i=amtObj.index; continue;
    }
  }
  if(nums.length){ warnings.push('Amount မပါသော number များ: '+nums.join(',')+' | '+source); }
  return {rows,warnings,meta};
}
function addRowsForList(rows,warnings,nums,amount,source,type='normal'){
  nums.forEach(n=>addRow(rows,warnings,n,amount,source,type));
}
function parsePastePairBranchLine(line){
  const source=line; const rows=[]; const warnings=[];
  const s=normalize(line).replace(/\s+/g,' ').trim();
  let m;
  const pairList = /^(?:\d{2}(?:\s*[\/.*\-=:;"'{}\[\]()<>]+\s*))+\d{2}$/;

  // 4ထိပ်/1000 | 4နောက်/500
  m=s.match(/^(\d)\s*(?:ထိပ်စီး|ထိပ်|ရှေ့|အရှေ့)\s*\/\s*(\d+)(?:\s*[^\d].*)?$/);
  if(m){
    addRowsForList(rows,warnings,parityNums(m[1],'/'),m[2],source,'paste-front-slash');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[2])}};
  }
  m=s.match(/^(\d)\s*(?:နောက်ပိတ်|နောက်|အနောက်|အပိတ်|ပိတ်)\s*\/\s*(\d+)(?:\s*[^\d].*)?$/);
  if(m){
    addRowsForList(rows,warnings,parityNums('/',m[1]),m[2],source,'paste-back-slash');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[2])}};
  }

  // helper: list followed by =normal R reverse
  m=s.match(/^(.*)\s*=\s*(\d+)\s*[Rr@&]\s*(\d+)(?:\s*[^\d].*)?$/);
  if(m && pairList.test(m[1].trim())){
    const nums=(m[1].match(/\d{2}/g)||[]);
    nums.forEach(n=>{
      addRow(rows,warnings,n,m[2],source,'paste-mixed-normal');
      addRow(rows,warnings,rev(n),m[3],source,'paste-mixed-reverse');
    });
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[2])}};
  }

  // list + reverse shared amount
  m=s.match(/^(.*)\s*[Rr@&]\s*(\d+)(?:\s*[^\d].*)?$/);
  if(m && pairList.test(m[1].trim())){
    const nums=(m[1].match(/\d{2}/g)||[]);
    nums.forEach(n=>{
      addRow(rows,warnings,n,m[2],source,'paste-reverse');
      addRow(rows,warnings,rev(n),m[2],source,'paste-reverse');
    });
    return {handled:true, rows, warnings, meta:{mode:'reverse', amount:Number(m[2])}};
  }

  // plain pair list + trailing amount (no reverse)
  m=s.match(/^(.*?)(\d{3,})(?:\s*[^\d].*)?$/);
  if(m && pairList.test(m[1].trim())){
    const nums=(m[1].match(/\d{2}/g)||[]);
    addRowsForList(rows,warnings,nums,m[2],source,'paste-plain-list');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[2])}};
  }

  return {handled:false, rows, warnings, meta:null};
}
function breakByDigit(d){
  const x=Number(d); return N2.filter(n=>[x,x+10].includes(Number(n[0])+Number(n[1])));
}
function parseSpecialBurmeseLine(line){
  const source=line; const rows=[]; const warnings=[]; let s=normalize(line).replace(/\s+/g,' ').trim();
  // Total notes like T45000 / T 3000 are ignored.
  if(/^T\s*\d+\s*$/i.test(s)) return {handled:true, rows, warnings, meta:null, ignored:true};

  // Pure note/name lines with no digits are ignored.
  if(!/\d/.test(s) && !/(ပါ|ပတ်|ပါတ်|ပူး|အပူး|ခွေ|အခွေ|ထိပ်|နောက်|ဘရိတ်|ပါဝါ|နက္ခ|နက်ခ|ညီကို|R|@|\*|\/)/i.test(s)){
    return {handled:true, rows, warnings, meta:null, ignored:true};
  }

  let m;

  // 57=82=32=R300 => each pair gets amount on original + reverse.
  m=s.match(/^((?:\d{2}\s*=\s*){2,}\d{2})\s*=\s*[Rr]\s*(\d+)(?:\s*[^\d].*)?$/);
  if(m){
    const nums=(m[1].match(/\d{2}/g)||[]);
    const amount=m[2];
    nums.forEach(n=>{
      addRow(rows,warnings,n,amount,source,'multi-eq-r');
      addRow(rows,warnings,rev(n),amount,source,'multi-eq-r');
    });
    return {handled:true, rows, warnings, meta:{mode:'reverse', amount:Number(amount)}};
  }

  // 33*77*88*500 => 33,77,88 all at 500
  m=s.match(/^((?:\d{2}\*\s*){2,})(\d+)(?:\s*[^\d].*)?$/);
  if(m){
    const nums=[...m[1].matchAll(/(\d{2})\*/g)].map(x=>x[1]);
    addRowsForList(rows,warnings,nums,m[2],source,'explicit-star-list-noeq');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[2])}};
  }

  // 22*55*66*=500 => explicit listed doubles with one shared amount.
  m=s.match(/^((?:\d{2}\*\s*)+)\s*=\s*(\d+)(?:\s*[^\d].*)?$/);
  if(m){
    const nums=[...m[1].matchAll(/(\d{2})\*/g)].map(x=>x[1]);
    addRowsForList(rows,warnings,nums,m[2],source,'explicit-star-list');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[2])}};
  }

  // 53/1000 => plain number 53 at amount 1000
  m=s.match(/^(\d{2})\/\s*(\d+)(?:\s*[^\d].*)?$/);
  if(m){
    addRow(rows,warnings,m[1],m[2],source,'plain-slash-amount');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[2])}};
  }

  // အပူးးးးး500 / အပူး300 / အပူ300 => all doubles with one shared amount.
  m=s.match(/^အ?ပူး[^\d=]*=?\s*(\d+)(?:\s*[^\d].*)?$/);
  if(m){
    addRowsForList(rows,warnings,N2.filter(n=>n[0]===n[1]),m[1],source,'double');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[1])}};
  }

  // 47*49*76R1000 => each 2-digit star pair gets same amount on original + reverse.
  m=s.match(/^((?:\d{2}\*\s*)+)\s*[Rr]\s*(\d+)(?:\s*[^\d].*)?$/);
  if(m){
    const nums=[...m[1].matchAll(/(\d{2})\*/g)].map(x=>x[1]);
    const amount=m[2];
    nums.forEach(n=>{
      addRow(rows,warnings,n,amount,source,'star-pair-r');
      addRow(rows,warnings,rev(n),amount,source,'star-pair-r');
    });
    return {handled:true, rows, warnings, meta:{mode:'reverse', amount:Number(amount)}};
  }

  // 40=3000R1000 => original gets 3000, reverse gets 1000.
  m=s.match(/^(\d{2})\s*=\s*(\d+)\s*[Rr@&]\s*(\d+)(?:\s*[^\d].*)?$/);
  if(m){
    addRow(rows,warnings,m[1],m[2],source,'mixed-normal');
    addRow(rows,warnings,rev(m[1]),m[3],source,'mixed-reverse');
    return {handled:true, rows, warnings, meta:{mode:'mixed', amount:Number(m[2]), reverseAmount:Number(m[3])}};
  }

  // 67R1500 => original and reverse both use same amount.
  m=s.match(/^(\d{2})\s*[Rr]\s*(\d+)(?:\s*[^\d].*)?$/);
  if(m){
    addRow(rows,warnings,m[1],m[2],source,'reverse');
    addRow(rows,warnings,rev(m[1]),m[2],source,'reverse');
    return {handled:true, rows, warnings, meta:{mode:'reverse', amount:Number(m[2])}};
  }

  // nပါR100 / nပါတ်R100: digit-include with optional R marker from handwriting/OCR.
  m=s.match(/^(\d)\s*=?\s*(?:ပါ|ပါတ်|ပတ်)\s*[Rr]\s*(\d+)$/);
  if(m){
    const d=m[1], amount=m[2];
    addRowsForList(rows,warnings,containsDigit(d),amount,source,'digit-include-r');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(amount)}};
  }

  // 3/8ဘရိတ်500: multiple break digits, same amount for each break set.
  m=s.match(/^(\d(?:\s*\/\s*\d)+)\s*ဘရိတ်\s*=?\s*(\d+)$/);
  if(m){
    const digits=m[1].split('/').map(x=>x.trim()).filter(Boolean), amount=m[2];
    digits.forEach(d=>addRowsForList(rows,warnings,breakByDigit(d),amount,source,'multi-break'));
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(amount)}};
  }

  // 5/=400R100 or 5/400R100 => 5/ = 400 and /5 = 100
  m=s.match(/^(\d)\/\s*=?\s*(\d+)\s*[Rr]\s*(\d+)$/);
  if(m){
    addRowsForList(rows,warnings,parityNums(m[1],'/'),m[2],source,'front-digit-short');
    addRowsForList(rows,warnings,parityNums('/',m[1]),m[3],source,'back-digit-short-r');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[2])}};
  }

  // /5=100R400 or /5 100 R 400 => /5 = 100 and 5/ = 400
  m=s.match(/^\/(\d)\s*=?\s*(\d+)\s*[Rr]\s*(\d+)$/);
  if(m){
    addRowsForList(rows,warnings,parityNums('/',m[1]),m[2],source,'back-digit-short');
    addRowsForList(rows,warnings,parityNums(m[1],'/'),m[3],source,'front-digit-short-r');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[2])}};
  }

  // 123ထိပ်500R300 / 123-ထိပ်-500 / 3/4 ထိပ် 500နောက်300
  // Multiple digits before front/top word; each digit gets front amount and optional back/R amount.
  m=s.match(/^([\d\s\/]{1,20})\s*=?\s*(?:ထိပ်စီး|ထိပ်|ရှေ့|အရှေ့)\s*=?\s*(\d+)\s*(?:[Rr]|(?:နောက်ပိတ်|နောက်|အနောက်|အပိတ်|ပိတ်))\s*=?\s*(\d+)(?:\s*[^\d].*)?$/);
  if(m){
    digitSeqList(m[1]).forEach(d=>{
      addRowsForList(rows,warnings,parityNums(d,'/'),m[2],source,'multi-front');
      addRowsForList(rows,warnings,parityNums('/',d),m[3],source,'multi-back-r');
    });
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[2])}};
  }

  // 123နောက်500R300 / 3/4 နောက် 500 ထိပ် 300
  m=s.match(/^([\d\s\/]{1,20})\s*=?\s*(?:နောက်ပိတ်|နောက်|အနောက်|အပိတ်|ပိတ်)\s*=?\s*(\d+)\s*(?:[Rr]|(?:ထိပ်စီး|ထိပ်|ရှေ့|အရှေ့))\s*=?\s*(\d+)(?:\s*[^\d].*)?$/);
  if(m){
    digitSeqList(m[1]).forEach(d=>{
      addRowsForList(rows,warnings,parityNums('/',d),m[2],source,'multi-back');
      addRowsForList(rows,warnings,parityNums(d,'/'),m[3],source,'multi-front-r');
    });
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[2])}};
  }

  // 2ထိပ် 500 R 200 / 2=ထိပ်700R600: front/top digit at normal amount and reverse/back digit at R amount.
  m=s.match(/^(\d)\s*=?\s*(?:ထိပ်စီး|ထိပ်|ရှေ့|အရှေ့)\s*(\d+)\s*[Rr]\s*(\d+)$/);
  if(m){
    addRowsForList(rows,warnings,parityNums(m[1],'/'),m[2],source,'front-digit');
    addRowsForList(rows,warnings,parityNums('/',m[1]),m[3],source,'back-digit-r');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[2])}};
  }

  // 2နောက် 500 R 200 / 2=နောက်700R600: back digit at normal amount and front digit at R amount.
  m=s.match(/^(\d)\s*=?\s*(?:နောက်ပိတ်|နောက်|အနောက်|အပိတ်|ပိတ်)\s*(\d+)\s*[Rr]\s*(\d+)$/);
  if(m){
    addRowsForList(rows,warnings,parityNums('/',m[1]),m[2],source,'back-digit');
    addRowsForList(rows,warnings,parityNums(m[1],'/'),m[3],source,'front-digit-r');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[2])}};
  }

  // 123ထိပ်500 / 123=ထိပ်500 / 3/4 ထိပ် 500 / 123နောက်500: multiple front/back digits.
  m=s.match(/^([\d\s\/]{1,20})\s*=?\s*(?:ထိပ်စီး|ထိပ်|ရှေ့|အရှေ့)\s*=?\s*(\d+)$/);
  if(m){
    digitSeqList(m[1]).forEach(d=>addRowsForList(rows,warnings,parityNums(d,'/'),m[2],source,'multi-front'));
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[2])}};
  }
  m=s.match(/^([\d\s\/]{1,20})\s*=?\s*(?:နောက်ပိတ်|နောက်|အနောက်|အပိတ်|ပိတ်)\s*=?\s*(\d+)$/);
  if(m){
    digitSeqList(m[1]).forEach(d=>addRowsForList(rows,warnings,parityNums('/',d),m[2],source,'multi-back'));
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[2])}};
  }

  // 11.88.55.33=1000 [optional note]  or 22,77,88,99,44=1000
  m=s.match(/^((?:\d{2}[\s,./\-=:\"'{}\[\]\(\)<>]*){2,})\s*=\s*(\d+)(?:\s*[^\d].*)?$/);
  if(m){
    const nums = (m[1].match(/\d{2}/g) || []);
    addRowsForList(rows,warnings,nums,m[2],source,'explicit-multi');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[2])}};
  }

  // 1=8ပါ500 / 1=8=9ပါ500 => each digit expands as d*
  m=s.match(/^((?:\d\s*=\s*)+\d)\s*(?:ပါ|ပါတ်|ပတ်)\s*(အ?ပူးပါ)?\s*=?\s*(\d+)(?:\s*[^\d].*)?$/);
  if(m){
    const digits=uniq((m[1].match(/\d/g)||[]));
    const extraDouble=!!m[2];
    const amount=m[3];
    digits.forEach(d=>{
      addRowsForList(rows,warnings,containsDigit(d),amount,source,'digit-include');
      if(extraDouble) addRow(rows,warnings,d+d,amount,source,'extra-double');
    });
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(amount)}};
  }

  // n=ပါ1000 / nပါတ်ပူးပါ 5000 / nပတ် amount
  m=s.match(/^(\d)\s*=?\s*(?:ပါ|ပါတ်|ပတ်)\s*(အ?ပူးပါ)?\s*=?\s*(\d+)(?:\s*[^\d].*)?$/);
  if(m){
    const d=m[1], extraDouble=!!m[2], amount=m[3];
    addRowsForList(rows,warnings,containsDigit(d),amount,source,'digit-include');
    if(extraDouble) addRow(rows,warnings,d+d,amount,source,'extra-double');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(amount)}};
  }

  // အပူး500 / အပူး=200
  m=s.match(/^အ?ပူး\s*=?\s*(\d+)$/);
  if(m){
    addRowsForList(rows,warnings,N2.filter(n=>n[0]===n[1]),m[1],source,'double');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[1])}};
  }

  // (33)ပူး500 or 33ပူး500
  m=s.match(/^\(?\s*(\d{2})\s*\)?\s*ပူး\s*=?\s*(\d+)$/);
  if(m){
    addRow(rows,warnings,m[1],m[2],source,'single-double');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[2])}};
  }

  // 1790ခွေ500 / 1790-ခွေ-500 / 1790ခွေပူး500 / 1790အခွေ1000အပူးပါ
  // ခွေ = permutations without doubles
  // ခွေပူး / ခွေအပူး / ခွေအပူးပါ = permutations + doubles from the same digits
  m=s.match(/^(\d{2,})\s*[-=.:]*\s*(?:အခွေ|ခွေ)\s*[-=.:]*\s*(?:(အ?ပူးပါ|ပူးပါ|အ?ပူး|ပူး)\s*)?[-=.:]*\s*(\d+)(?:\s*[^\d].*)?$/);
  if(m){
    const digits=uniq(m[1].split(''));
    const includeDoubles=!!m[2];
    const amount=m[3];
    const nums=[];
    digits.forEach(a=>digits.forEach(b=>{
      if(includeDoubles || a!==b) nums.push(a+b);
    }));
    addRowsForList(rows,warnings,nums,amount,source,includeDoubles?'khwe-double':'khwe');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(amount)}};
  }

  // 3=ဘရိတ်1000 => break digit 3 and 13.
  m=s.match(/^(\d)\s*=?\s*ဘရိတ်\s*=?\s*(\d+)$/);
  if(m){
    addRowsForList(rows,warnings,breakByDigit(m[1]),m[2],source,'break');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[2])}};
  }

  // နက္ခ / နက်ခက် amount
  m=s.match(/^(?:Z|နက်ခက်|နက္ခ|နက်ခ)\s*=?\s*(\d+)$/i);
  if(m){
    addRowsForList(rows,warnings,FIXED.Z,m[1],source,'natkhat');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[1])}};
  }

  // ပါဝါ amount
  m=s.match(/^(?:A|ပါဝါ)\s*=?\s*(\d+)$/i);
  if(m){
    addRowsForList(rows,warnings,FIXED.A,m[1],source,'power');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[1])}};
  }

  // ညီကို / ညီအကို amount
  m=s.match(/^(?:B|ညီကို|ညီအကို)\s*=?\s*(\d+)$/i);
  if(m){
    addRowsForList(rows,warnings,FIXED.B,m[1],source,'brother');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[1])}};
  }

  // 3နောက် =1000, 3နောက်ပိတ်1000
  m=s.match(/^(\d)\s*(?:နောက်ပိတ်|နောက်|အနောက်|အပိတ်|ပိတ်)\s*=?\s*(\d+)(?:\s*[^\d].*)?$/);
  if(m){
    addRowsForList(rows,warnings,parityNums('/',m[1]),m[2],source,'back-digit');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[2])}};
  }

  // 3ထိပ် / 3ထိပ်စီး amount
  m=s.match(/^(\d)\s*(?:ထိပ်စီး|ထိပ်|ရှေ့|အရှေ့)\s*=?\s*(\d+)(?:\s*[^\d].*)?$/);
  if(m){
    addRowsForList(rows,warnings,parityNums(m[1],'/'),m[2],source,'front-digit');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount:Number(m[2])}};
  }

  return {handled:false, rows, warnings, meta:null};
}
function parseSpecialCarryLine(line, ctx){
  const source=line; const rows=[]; const warnings=[];
  const amount = Number(ctx && ctx.amount ? ctx.amount : 0);
  const reverseMode = !!(ctx && ctx.mode==='reverse');
  if(!amount) return {handled:false, rows, warnings, meta:null};
  let s=normalize(line).replace(/\s+/g,' ').trim();
  let m;

  function addCarryNums(nums, type='carry-normal'){
    nums.forEach(n=>{
      addRow(rows,warnings,n,amount,source,type);
      if(reverseMode) addRow(rows,warnings,rev(n),amount,source,'carry-reverse');
    });
  }

  // 123ထိပ် / 3/4 ထိပ် / 123=ထိပ်  => each digit uses carried amount
  m=s.match(/^([\d\s\/]{1,20})\s*=?\s*(?:ထိပ်စီး|ထိပ်|ရှေ့|အရှေ့)$/);
  if(m){
    digitSeqList(m[1]).forEach(d=>addRowsForList(rows,warnings,parityNums(d,'/'),amount,source,'carry-front'));
    return {handled:true, rows, warnings, meta:{mode:'normal', amount}};
  }

  // 123နောက် / 3/4 နောက် / 123ပိတ်
  m=s.match(/^([\d\s\/]{1,20})\s*=?\s*(?:နောက်ပိတ်|နောက်|အနောက်|အပိတ်|ပိတ်)$/);
  if(m){
    digitSeqList(m[1]).forEach(d=>addRowsForList(rows,warnings,parityNums('/',d),amount,source,'carry-back'));
    return {handled:true, rows, warnings, meta:{mode:'normal', amount}};
  }

  // 1=8ပါ / 1=8=9ပါ / 7ပါတ်ပူးပါ / 7အပူးပါ  => carried amount
  m=s.match(/^((?:\d\s*=\s*)+\d)\s*(?:(?:ပါ|ပါတ်|ပတ်)\s*)?(အ?ပူးပါ|ပူးပါ|အ?ပူး|ပူး)?$/);
  if(m){
    const digits=uniq((m[1].match(/\d/g)||[]));
    const includeFamily = /(?:ပါ|ပါတ်|ပတ်)/.test(s) || !!m[2];
    const extraDouble=!!m[2];
    digits.forEach(d=>{
      if(includeFamily) addRowsForList(rows,warnings,containsDigit(d),amount,source,'carry-digit-include');
      if(extraDouble) addRow(rows,warnings,d+d,amount,source,'carry-extra-double');
    });
    return {handled:true, rows, warnings, meta:{mode:'normal', amount}};
  }
  m=s.match(/^(\d)\s*=?\s*(?:(?:ပါ|ပါတ်|ပတ်)\s*)?(အ?ပူးပါ|ပူးပါ|အ?ပူး|ပူး)?$/);
  if(m && (/(?:ပါ|ပါတ်|ပတ်)/.test(s) || m[2])){
    addRowsForList(rows,warnings,containsDigit(m[1]),amount,source,'carry-digit-include');
    if(m[2]) addRow(rows,warnings,m[1]+m[1],amount,source,'carry-extra-double');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount}};
  }

  // bare အပူး / ပူး => all doubles with carried amount
  m=s.match(/^အ?ပူး$/);
  if(m){
    addRowsForList(rows,warnings,N2.filter(n=>n[0]===n[1]),amount,source,'carry-double');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount}};
  }

  // 12345ခွေ / 12345အခွေ / 12345ခွေအပူးပါ / 12345-ခွေ-အပူးပါ
  m=s.match(/^(\d{2,})\s*[-=.:]*\s*(?:အခွေ|ခွေ)\s*[-=.:]*\s*(?:(အ?ပူးပါ|ပူးပါ|အ?ပူး|ပူး))?$/);
  if(m){
    const digits=uniq(m[1].split(''));
    const includeDoubles=!!m[2];
    const nums=[];
    digits.forEach(a=>digits.forEach(b=>{
      if(includeDoubles || a!==b) nums.push(a+b);
    }));
    addRowsForList(rows,warnings,nums,amount,source,includeDoubles?'carry-khwe-double':'carry-khwe');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount}};
  }

  // 3ဘရိတ် / 3/8ဘရိတ် with carried amount
  m=s.match(/^(\d(?:\s*\/\s*\d)+)\s*ဘရိတ်$/);
  if(m){
    m[1].split('/').map(x=>x.trim()).filter(Boolean).forEach(d=>addRowsForList(rows,warnings,breakByDigit(d),amount,source,'carry-break'));
    return {handled:true, rows, warnings, meta:{mode:'normal', amount}};
  }
  m=s.match(/^(\d)\s*=?\s*ဘရိတ်$/);
  if(m){
    addRowsForList(rows,warnings,breakByDigit(m[1]),amount,source,'carry-break');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount}};
  }

  // bare fixed families A / Z / B with carried amount
  if(/^(?:Z|နက်ခက်|နက္ခ|နက်ခ)$/i.test(s)){
    addRowsForList(rows,warnings,FIXED.Z,amount,source,'carry-natkhat');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount}};
  }
  if(/^(?:A|ပါဝါ)$/i.test(s)){
    addRowsForList(rows,warnings,FIXED.A,amount,source,'carry-power');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount}};
  }
  if(/^(?:B|ညီကို|ညီအကို)$/i.test(s)){
    addRowsForList(rows,warnings,FIXED.B,amount,source,'carry-brother');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount}};
  }

  // bare explicit star-list with shared carried amount: 22*55*66* or 33*77*88*
  m=s.match(/^((?:\d{2}\*\s*){2,})=?$/);
  if(m){
    const nums=[...m[1].matchAll(/(\d{2})\*/g)].map(x=>x[1]);
    addRowsForList(rows,warnings,nums,amount,source,'carry-explicit-star-list');
    return {handled:true, rows, warnings, meta:{mode:'normal', amount}};
  }

  // plain pair-list with spaces/dots/quotes etc and no explicit amount; use nearest carry.
  m=s.match(/^((?:\d{2}[\s,./\-=:"'{}\[\]\(\)<>]*){2,})$/);
  if(m){
    const nums=(m[1].match(/\d{2}/g)||[]);
    addCarryNums(nums);
    return {handled:true, rows, warnings, meta:{mode:reverseMode?'reverse':'normal', amount}};
  }

  return {handled:false, rows, warnings, meta:null};
}
function splitExprAmount(line){
  let s=normalize(line).trim();

  // Strong explicit form: expr = amount [optional trailing note]
  let m = s.match(/^(.*?)\s*=\s*(\d+)(?:\s*[^\d].*)?$/);
  if(m){
    let expr = (m[1] || '').trim();
    let amount = m[2];
    expr = expr.replace(/[=,.\s]+$/g,'');
    if(expr.endsWith('-') && !/^\d-$/.test(expr)) expr = expr.slice(0,-1).trim();
    return expr ? {expr, amount} : null;
  }

  // Standard trailing amount form: expr amount
  m = s.match(/(\d+)\s*$/);
  if(!m) return null;
  const amount = m[1];
  let expr = s.slice(0,m.index).trim();
  expr = expr.replace(/[=,.\s]+$/g,'');
  if(expr.endsWith('-') && !/^\d-$/.test(expr)) expr = expr.slice(0,-1).trim();
  return expr ? {expr, amount} : null;
}
function hasExplicitAmountOnLine(line){
  const s = normalize(line).trim();
  if(!s) return false;
  const paste = parsePastePairBranchLine(s);
  if(paste.handled && paste.meta && paste.meta.amount) return true;
  const pair = splitExprAmount(s);
  return !!(pair && pair.amount && expandExpression(pair.expr).length);
}
function parseLine(line){
  line=normalize(line); const rows=[]; const warnings=[]; if(!line) return {rows,warnings};
  if(/[Rr]/.test(line)) return parseReverseLine(line);
  const pair=splitExprAmount(line); if(!pair){warnings.push('Amount မတွေ့: '+line); return {rows,warnings};}
  const nums=expandExpression(pair.expr);
  if(!nums.length){warnings.push('Formula/Number မဖတ်နိုင်: '+line); return {rows,warnings};}
  nums.forEach(n=>addRow(rows,warnings,n,pair.amount,line,'normal'));
  return {rows,warnings};
}
function applyCarryLine(line, ctx){
  const rows=[]; const warnings=[]; const nums=expandExpression(line);
  if(!nums.length) return null;
  if(!ctx || !ctx.amount || !ctx.mode){warnings.push('Amount carry မရှိသေးသော bare line: '+line); return {rows,warnings};}
  nums.forEach(n=>{
    addRow(rows,warnings,n,ctx.amount,line,'carry-normal');
    if(ctx.mode==='reverse') addRow(rows,warnings,rev(n),ctx.amount,line,'carry-reverse');
    if(ctx.mode==='mixed') addRow(rows,warnings,rev(n),ctx.reverseAmount||ctx.amount,line,'carry-reverse-mixed');
  });
  return {rows,warnings};
}
function isBareCarryCandidate(line){
  const s=normalize(line);
  if(!s) return false;
  // one compact formula/number without amount delimiter. Examples: 96, 00, A, *12, /9, 9/, //, //-3355
  if(/\s/.test(s)) return false;
  if(/[=]/.test(s)) return false;
  return expandExpression(s).length>0;
}
function cleanNameText(x){
  return String(x||'').replace(/[⁨⁩\u200e\u200f\u202a-\u202e]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
}
function matchKnownName(raw){const n=cleanNameText(raw); return (settings.names||[]).find(x=>cleanNameText(x)===n) || null;}
function digitSeqList(seq){
  return uniq((String(seq||'').match(/\d/g)||[]).filter(Boolean));
}
function headerRecordSession(hour24, minute){
  return (hour24 > 12 || (hour24 === 12 && Number(minute||0) >= 1)) ? 'PM' : 'AM';
}
function parseHeaderStampMeta(stamp){
  const s=String(stamp||'').replace(/[\u200e\u200f]/g,'').trim();
  let m=s.match(/^(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if(m){
    const monthMap={january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
    const mon=monthMap[String(m[1]).toLowerCase()]||0;
    const day=Number(m[2]||0), year=Number(m[3]||0), h12=Number(m[4]||0), minute=Number(m[5]||0), ap=String(m[6]||'AM').toUpperCase();
    let hour=h12 % 12;
    if(ap==='PM') hour += 12;
    const date=`${year}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    return {date, session:headerRecordSession(hour, minute), hour, minute, stamp:s};
  }
  const d=new Date(s);
  if(!Number.isNaN(d.getTime())){
    const date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const hour=d.getHours();
    const minute=d.getMinutes();
    return {date, session:headerRecordSession(hour, minute), hour, minute, stamp:s};
  }
  return null;
}
function parseHeaderLine(line){
  const m=String(line).match(/^\s*\[\s*([^\]]+?)\s*\]\s*[⁨]?(.+?)[⁩]?\s*:\s*(.*)$/);
  if(!m) return null;
  const meta=parseHeaderStampMeta(m[1]);
  return {rawName:m[2].trim(), content:m[3].trim(), headerStamp:String(m[1]||'').trim(), headerDate:meta?.date||'', headerSession:meta?.session||'', headerHour:meta?.hour, headerMinute:meta?.minute};
}

function explicitCarryMetaForLine(line){
  const s = normalize(line);
  if(!s) return null;

  const paste = parsePastePairBranchLine(s);
  if(paste.handled && paste.meta && paste.meta.amount) return {...paste.meta};

  const sp = parseSpecialBurmeseLine(s);
  if(sp.handled && sp.meta && sp.meta.amount) return {...sp.meta};

  if(/[Rr@&]/.test(s)){
    const rx = parseComplexLine(s);
    if(rx.meta && rx.meta.amount) return {...rx.meta};
  }

  // Explicit plain amount on this same line must win over any nearby carry.
  if(hasExplicitAmountOnLine(s) && !/[Rr@&]/.test(s)){
    const pair = splitExprAmount(s);
    return {mode:'normal', amount:Number(pair.amount)};
  }

  const pair = splitExprAmount(s);
  if(pair && expandExpression(pair.expr).length) return {mode:'normal', amount:Number(pair.amount)};
  return null;
}
function normalizeMessageLines(text){
  return String(text||'').replace(/\r/g,'').split('\n').map((raw,i)=>({raw:String(raw||''),lineNo:i+1})).filter(x=>x.raw.trim());
}
function makeMessageBlockKey(headerStamp, headerName, lines){
  const body = normalizeDuplicateText((lines||[]).map(x=>x.raw||'').join('\n'));
  const stamp = normalizeDuplicateText(headerStamp||'');
  const name = cleanNameText(headerName||'');
  return `${stamp}__${name}__${body}`;
}
function buildMessageBlocks(text, defaultName){
  const blocks=[]; let block=null; let activeName=defaultName||'Default';
  normalizeMessageLines(text).forEach(item=>{
    const rawTrim=item.raw.trim();
    const header=parseHeaderLine(rawTrim);
    if(header){
      if(block && block.lines.length) blocks.push(block);
      const matched=matchKnownName(header.rawName);
      block={name:matched||activeName, headerName:header.rawName, headerMatched:!!matched, headerStamp:header.headerStamp||'', date:header.headerDate||'', session:header.headerSession||'', headerHour:header.headerHour, headerMinute:header.headerMinute, lines:[], startLine:item.lineNo};
      if(matched) activeName=matched;
      if(header.content && header.content.trim()) block.lines.push({raw:header.content.trim(), lineNo:item.lineNo, fromHeader:true, headerName:header.rawName, headerMatched:!!matched});
      else block.lines.push({raw:'', lineNo:item.lineNo, fromHeader:true, headerName:header.rawName, headerMatched:!!matched, emptyHeader:true});
    }else{
      if(!block) block={name:activeName, headerName:'', headerMatched:false, headerStamp:'', date:'', session:'', headerHour:null, headerMinute:null, lines:[], startLine:item.lineNo};
      block.lines.push({raw:rawTrim, lineNo:item.lineNo, fromHeader:false, headerName:'', headerMatched:false});
    }
  });
  if(block && block.lines.length) blocks.push(block);
  blocks.forEach((b, idx)=>{
    b.blockKey = makeMessageBlockKey(b.headerStamp||'', b.headerName||b.name||'', b.lines||[]);
    b.blockLabel = b.headerStamp ? `[${b.headerStamp}] ${b.headerName||b.name||''}` : `Manual Block ${idx+1} / ${b.name||'Default'}`;
    b.cardIndexInPaste = idx + 1;
    b.cardRawText = (b.lines||[]).map(x=>String(x.raw||'')).filter(Boolean).join('\n').trim();
    if(Number.isFinite(Number(b.headerHour)) && Number.isFinite(Number(b.headerMinute))){
      const hour=Number(b.headerHour), minute=Number(b.headerMinute);
      const h12=hour%12||12;
      b.cardTime=`${h12}:${String(minute).padStart(2,'0')} ${hour>=12?'PM':'AM'}`;
    }else{
      b.cardTime='';
    }
  });
  return blocks;
}
function parseMessageBlock(block, writerProfile, blockIndex=0){
  const detailRows=[]; const warnings=[]; const issues=[];
  const processed = block.lines.map(item=>{
    const lineWriter = normalizeWriterProfile(writerProfile)==='AUTO' ? detectAutoWriter(item.raw) : normalizeWriterProfile(writerProfile);
    const prepared = preprocessWriterLine(item.raw, lineWriter).trim();
    return {...item, lineWriter, prepared, explicit: explicitCarryMetaForLine(prepared)};
  });
  function nearestUpperExplicit(idx){
    for(let j=idx-1;j>=0;j--) if(processed[j].explicit && processed[j].explicit.amount) return processed[j].explicit;
    return null;
  }
  function nearestLowerExplicit(idx){
    for(let j=idx+1;j<processed.length;j++) if(processed[j].explicit && processed[j].explicit.amount) return processed[j].explicit;
    return null;
  }

  processed.forEach((item, idx)=>{
    let l = item.prepared;
    if(!l) return;
    let r = null;
    const carryCtx = nearestUpperExplicit(idx) || nearestLowerExplicit(idx);
    const upperCtx = nearestUpperExplicit(idx);


    const eqCarry = /=$/.test(l.trim()) ? l.trim().replace(/=+$/,'').trim() : null;
    if(eqCarry && carryCtx && expandExpression(eqCarry).length){
      r = applyCarryLine(eqCarry, carryCtx);
    }else{
      const pasteBranch = parsePastePairBranchLine(l);
      if(pasteBranch.handled){
        r = pasteBranch;
      }else{
        const sp = parseSpecialBurmeseLine(l);
        if(sp.handled){
          r = sp;
        }else{
          const hasOwnExplicit = hasExplicitAmountOnLine(l) || (!!item.explicit && item.explicit.amount);
          if(hasOwnExplicit){
            r = /[Rr@]/.test(l) ? parseComplexLine(l) : parseLine(l);
          }else{
            const carrySpecial = carryCtx ? parseSpecialCarryLine(l, carryCtx) : {handled:false, rows:[], warnings:[]};
            if(carrySpecial.handled){
              r = carrySpecial;
            }else if(isBareCarryCandidate(l) && carryCtx && !/[Rr@]/.test(l)){
              r = applyCarryLine(l, carryCtx);
            }else if(/[Rr@]/.test(l)){
              r = parseComplexLine(l);
            }else{
              r = parseLine(l);
            }
          }
        }
      }
    }

    if((!r || !r.rows || !r.rows.length) && isBareCarryCandidate(l) && !carryCtx){
      const msg='Same message block အတွင်း amount/formula မတွေ့: '+item.raw;
      warnings.push(msg);
      issues.push({lineNo:item.lineNo, line:item.raw, edited:item.raw, message:msg});
      return;
    }

    (r?.rows||[]).forEach(row=>{
      row.name=block.name||'Default';
      if(block.date) row.date = block.date;
      if(block.session) row.session = block.session;
      if(block.headerStamp) row.headerStamp = block.headerStamp;
      row.duplicateBlockKey = block.blockKey || '';
      row.duplicateBlockLabel = block.blockLabel || '';
      row.cardBlockKey = block.blockKey || '';
      row.cardIndexInPaste = Number(block.cardIndexInPaste||blockIndex+1)||1;
      row.cardTime = block.cardTime || '';
      row.cardHeaderStamp = block.headerStamp || '';
      row.cardHeaderName = block.headerName || '';
      row.cardRawText = block.cardRawText || '';
      row.cardSourceLine = Number(item.lineNo||0)||0;
    });
    detailRows.push(...(r?.rows||[]));
    (r?.warnings||[]).forEach(w=>warnings.push(w));
    if(r?.warnings?.length){
      issues.push({lineNo:item.lineNo, line:item.raw, edited:item.raw, message:r.warnings.join(' | ')});
    }
  });

  const card={
    tempCardKey:block.blockKey||`manual-${blockIndex+1}`,
    indexInPaste:Number(block.cardIndexInPaste||blockIndex+1)||1,
    name:block.name||'Default',
    date:block.date||'',
    session:block.session||'',
    time:block.cardTime||'',
    headerStamp:block.headerStamp||'',
    headerName:block.headerName||'',
    headerMatched:!!block.headerMatched,
    rawText:block.cardRawText||'',
    rowCount:detailRows.length,
    totalAmount:detailRows.reduce((sum,row)=>sum+Number(row.amount||0),0),
    warningCount:warnings.length,
    issueCount:issues.length,
    status:issues.length?'review':(warnings.length?'warning':'ready')
  };
  return {detailRows, warnings, issues, matchedHeader:block.headerMatched?1:0, card};
}
function parseMessage(text, defaultName='Default', writerProfile='AUTO'){
  const blocks = buildMessageBlocks(text, defaultName||'Default');
  const detailRows=[]; const warnings=[]; const issues=[]; const cards=[];
  let matchedHeaderCount=0;
  if(!blocks.length) return {detailRows, totals:[], warnings, issues, cards, matchedHeaderCount, needsNameSelection:false};

  blocks.forEach((block,blockIndex)=>{
    const res = parseMessageBlock(block, writerProfile, blockIndex);
    detailRows.push(...res.detailRows);
    warnings.push(...res.warnings);
    issues.push(...res.issues);
    if(res.card) cards.push(res.card);
    matchedHeaderCount += res.matchedHeader || 0;
  });

  const map=new Map();
  detailRows.forEach(r=>map.set(r.number,(map.get(r.number)||0)+r.amount));
  const totals=[...map.entries()].map(([number,amount])=>({number,amount})).sort((a,b)=>Number(a.number)-Number(b.number));
  const selectedName = String(defaultName||'').trim();
  const needsNameSelection = matchedHeaderCount===0 && (!selectedName || selectedName==='Default');
  const headerDates = [...new Set(blocks.map(b=>b.date).filter(Boolean))];
  const headerSessions = [...new Set(blocks.map(b=>b.session).filter(Boolean))];
  return {detailRows, totals, warnings, issues, cards, matchedHeaderCount, needsNameSelection, headerDates, headerSessions};
}

let entryImageState={name:'',size:0,source:''};

function handleEntryImage(evt, sourceType){
  const file=evt && evt.target && evt.target.files && evt.target.files[0];
  if(!file) return;
  const img=document.getElementById('entryImgPreview');
  const empty=document.getElementById('entryImgEmpty');
  const meta=document.getElementById('entryImgMeta');
  const reader=new FileReader();
  entryImageState={name:file.name||'image',size:file.size||0,source:sourceType||'upload'};
  reader.onload=function(e){
    img.src=e.target.result;
    img.style.display='block';
    empty.style.display='none';
    meta.textContent=`${entryImageState.name} • ${Math.round((entryImageState.size||0)/1024)} KB • ${entryImageState.source}`;
    showToast('Image preview ready. OCR text ကို right box ထဲ paste/edit လုပ်ပါ။');
  };
  reader.readAsDataURL(file);
  if(evt.target) evt.target.value='';
}

function clearEntryImage(){
  const img=document.getElementById('entryImgPreview');
  const empty=document.getElementById('entryImgEmpty');
  const meta=document.getElementById('entryImgMeta');
  if(img){img.src=''; img.style.display='none';}
  if(empty) empty.style.display='block';
  if(meta) meta.textContent='No file';
  entryImageState={name:'',size:0,source:''};
}

function useOcrTextToEntry(mode){
  const ocr=(document.getElementById('ocrPreviewText').value||'').trim();
  if(!ocr){showToast('OCR box ထဲ text မရှိသေးပါ'); return;}
  const ta=document.getElementById('entryText');
  if(mode==='append' && (ta.value||'').trim()){
    ta.value=(ta.value||'').replace(/\s+$/,'')+'\n'+ocr;
  }else{
    ta.value=ocr;
  }
  showToast('OCR text ကို Entry box ထဲ ထည့်ပြီးပါပြီ');
}

function toggleImageTools(){
  const box=document.getElementById('imgToolBox');
  if(!box) return;
  box.classList.toggle('compact-open');
}

const PARSER_REPORT_QUEUE_KEY='v2d_parser_report_queue';
let parserReportSubmitting=false;

function getPreviewSafetyState(){
  const issues=Array.isArray(preview?.issues)?preview.issues:[];
  const warnings=Array.isArray(preview?.warnings)?preview.warnings:[];
  const cards=Array.isArray(preview?.cards)?preview.cards:[];
  const reviewCards=cards.filter(c=>c?.status==='review').length;
  return {
    issueCount:issues.length,
    warningCount:warnings.length,
    reviewCardCount:reviewCards,
    requiresReview:issues.length>0 || warnings.length>0 || reviewCards>0
  };
}
function renderEntrySafetyStatus(){
  const box=document.getElementById('entrySafetyStatus');
  if(!box) return;
  if(!preview?.detailRows?.length && !(preview?.issues||[]).length){
    box.className='entrySafetyStatus safe';
    box.innerHTML=currentUiLang()==='en'?'Parse a message to run the safety check.':'Message ကို Parse လုပ်ပြီး Safety Check စစ်ပါ။';
    return;
  }
  const st=getPreviewSafetyState();
  if(st.requiresReview){
    box.className='entrySafetyStatus review';
    box.innerHTML=`<b>${currentUiLang()==='en'?'Review Required':'ပြန်လည်စစ်ဆေးရန်လို'}</b> · ${st.issueCount} issues · ${st.warningCount} warnings · ${st.reviewCardCount} review cards <button class="btn warn tinyBtn" onclick="openEntrySafetyGate()">${currentUiLang()==='en'?'Review':'စစ်ဆေးမည်'}</button> <button class="btn gray tinyBtn" onclick="openParserIssueReport()">${currentUiLang()==='en'?'Report':'Owner ထံ Report'}</button>`;
  }else{
    box.className='entrySafetyStatus safe';
    box.innerHTML=`<b>${currentUiLang()==='en'?'Safety Check Passed':'Safety Check အောင်မြင်'}</b> · ${preview.detailRows.length} rows · ${(preview.cards||[]).length} cards`;
  }
}
function openEntrySafetyGate(){
  const gate=document.getElementById('entrySafetyGate');
  const summary=document.getElementById('entrySafetySummary');
  if(!gate) return;
  const st=getPreviewSafetyState();
  if(summary) summary.textContent=currentUiLang()==='en'
    ? `${st.issueCount} issue(s), ${st.warningCount} warning(s), ${st.reviewCardCount} review card(s). Fix the source or explicitly save reviewed rows.`
    : `Issue ${st.issueCount} ခု၊ Warning ${st.warningCount} ခု၊ Review Card ${st.reviewCardCount} ခု ရှိပါသည်။ မူရင်းစာကိုပြင်ပါ သို့မဟုတ် စစ်ပြီးသား Rows ကို အတည်ပြုသိမ်းပါ။`;
  gate.style.display='block';
  gate.scrollIntoView({behavior:'smooth',block:'center'});
}
function closeEntrySafetyGate(){ const gate=document.getElementById('entrySafetyGate'); if(gate) gate.style.display='none'; }
function focusIssueFix(){
  closeEntrySafetyGate();
  if(preview?.issues?.length){ loadIssueLinesToEditor(); document.getElementById('issueEditorWrap')?.scrollIntoView({behavior:'smooth',block:'center'}); }
  else document.getElementById('entryText')?.focus();
}
function savePreviewReviewed(){
  const st=getPreviewSafetyState();
  const message=currentUiLang()==='en'
    ? `Save the current reviewed rows despite ${st.issueCount} issue(s) and ${st.warningCount} warning(s)? You can still edit saved records later.`
    : `Issue ${st.issueCount} ခုနှင့် Warning ${st.warningCount} ခု ရှိနေသော်လည်း လက်ရှိစစ်ပြီးသား Rows ကို သိမ်းမလား? သိမ်းပြီးနောက် Entry Record မှာ ဆက်ပြင်နိုင်ပါတယ်။`;
  if(!confirm(message)) return;
  try{
    window.__V2D_SAFETY_OVERRIDE=true;
    closeEntrySafetyGate();
    savePreview();
  }finally{
    window.__V2D_SAFETY_OVERRIDE=false;
  }
}
function parserOutputText(){
  const rows=preview?.detailRows||[];
  if(!rows.length) return '';
  return rows.map((r,i)=>`${i+1}. Card ${r.cardIndexInPaste||1} | ${r.number} | ${Number(r.amount||0)} | ${r.source||''}`).join('\n');
}
function parserReportQueue(){
  try{return JSON.parse(userGetItem(PARSER_REPORT_QUEUE_KEY)||'[]')||[];}catch(_e){return[];}
}
function saveParserReportQueue(queue){ userSetItem(PARSER_REPORT_QUEUE_KEY,JSON.stringify((queue||[]).slice(-100))); renderParserReportQueueStatus(); }
function renderParserReportQueueStatus(){
  const el=document.getElementById('parserReportQueueStatus'); if(!el) return;
  const count=parserReportQueue().length;
  el.textContent=count
    ? (currentUiLang()==='en'?`${count} report(s) waiting to send`:`Report ${count} ခု ပို့ရန်စောင့်နေသည်`)
    : (currentUiLang()==='en'?'No pending reports':'စောင့်နေသော Report မရှိပါ');
}
function openParserIssueReport(){
  const panel=document.getElementById('parserReportPanel'); if(!panel) return;
  const raw=val('entryText')||'';
  setVal('parserReportOriginal',raw);
  setVal('parserReportOutput',parserOutputText());
  const st=getPreviewSafetyState();
  const meta=document.getElementById('parserReportMeta');
  if(meta) meta.innerHTML=`<span>${escapeHtml(val('entryName')||'Default')}</span><span>${escapeHtml(val('entryDate')||today())}</span><span>${escapeHtml(val('entrySession')||'AM')}</span><span>${(preview.cards||[]).length} cards</span><span>${(preview.detailRows||[]).length} rows</span><span>${st.issueCount} issues</span>`;
  panel.style.display='block'; renderParserReportQueueStatus();
  panel.scrollIntoView({behavior:'smooth',block:'center'});
}
function closeParserIssueReport(){ const panel=document.getElementById('parserReportPanel'); if(panel) panel.style.display='none'; }
function buildParserIssueReportPayload(){
  const st=getPreviewSafetyState();
  const clientId=window.crypto?.randomUUID?.()||`PR-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    clientId,
    userUid:CURRENT_UID,
    userEmail:CURRENT_USER?.email||'',
    userDisplayName:CURRENT_USER?.displayName||window.V2D_CURRENT_PROFILE?.displayName||'',
    workspaceName:settings?.shopName||initialRegisteredShopName||'',
    entryName:val('entryName')||'Default',
    entryDate:val('entryDate')||today(),
    entrySession:val('entrySession')||'AM',
    writerProfile:selectedWriterProfile(),
    originalMessage:val('parserReportOriginal')||val('entryText')||'',
    parserOutput:val('parserReportOutput')||parserOutputText(),
    expectedCorrectRecords:val('parserReportExpected')||'',
    userNote:val('parserReportNote')||'',
    issueLines:(preview?.issues||[]).map(x=>({lineNo:Number(x.lineNo||0),line:String(x.line||''),message:String(x.message||'')})),
    warnings:(preview?.warnings||[]).map(String),
    cardCount:(preview?.cards||[]).length,
    rowCount:(preview?.detailRows||[]).length,
    issueCount:st.issueCount,
    warningCount:st.warningCount,
    appVersion:'4.3.0',
    parserVersion:'core-3.12.2-stage4.3',
    status:'new',
    localCreatedAt:new Date().toISOString()
  };
}
async function sendParserIssueReportPayload(payload){
  if(!db || !CURRENT_USER) throw new Error('Firebase/Login not ready');
  const clean={...payload}; delete clean.__queued;
  clean.createdAt=firebase.firestore.FieldValue.serverTimestamp();
  return db.collection('parserReports').doc(clean.clientId).set(clean);
}
async function flushParserReportQueue(){
  if(!navigator.onLine || !db || !CURRENT_USER) return false;
  let queue=parserReportQueue(); if(!queue.length){renderParserReportQueueStatus();return true;}
  const remaining=[];
  for(const item of queue){
    try{ await sendParserIssueReportPayload(item); }
    catch(err){ console.warn('Parser report queue send failed',err); remaining.push(item); }
  }
  saveParserReportQueue(remaining);
  return remaining.length===0;
}
async function submitParserIssueReport(){
  if(parserReportSubmitting) return;
  const payload=buildParserIssueReportPayload();
  if(!String(payload.originalMessage||'').trim()){
    showToast(currentUiLang()==='en'?'Original Viber message is required.':'Original Viber Message မရှိသေးပါ။','error',5500); return;
  }
  parserReportSubmitting=true;
  const btn=document.getElementById('parserReportSubmitBtn'); if(btn) btn.disabled=true;
  try{
    if(!navigator.onLine || !db){
      const q=parserReportQueue(); q.push({...payload,__queued:true}); saveParserReportQueue(q);
      showToast(currentUiLang()==='en'?'Offline: report queued and will send automatically.':'Offline ဖြစ်နေပါသည်။ Report ကို Queue ထဲသိမ်းပြီး Internet ပြန်ရလျှင် Auto ပို့ပါမယ်။','warn',6500);
      return;
    }
    await sendParserIssueReportPayload(payload);
    setVal('parserReportExpected',''); setVal('parserReportNote','');
    showToast(currentUiLang()==='en'?'Parser issue report sent to the App Owner queue.':'Parser Issue Report ကို App Owner Queue သို့ ပို့ပြီးပါပြီ။','success',6500);
    closeParserIssueReport();
  }catch(err){
    console.error('Parser issue report failed',err);
    if(!navigator.onLine){ const q=parserReportQueue(); q.push({...payload,__queued:true}); saveParserReportQueue(q); }
    showToast((currentUiLang()==='en'?'Report failed: ':'Report ပို့မရပါ: ')+(err?.message||err),'error',7500);
  }finally{
    parserReportSubmitting=false; if(btn) btn.disabled=false; renderParserReportQueueStatus();
  }
}

function confirmSaveAction(){
  try{
    const st=getPreviewSafetyState();
    if(st.requiresReview && !window.__V2D_SAFETY_OVERRIDE){
      openEntrySafetyGate();
      showToast(currentUiLang()==='en'?'Review required before saving.':'Save မလုပ်ခင် Parser Safety Review လုပ်ရန်လိုပါသည်။','warn',6000);
      return;
    }
    savePreview();
  }catch(err){
    console.error(err);
    showToast('Confirm Save error: ' + (err?.message || err));
  }
}
function parseInput(){
  const writer = selectedWriterProfile();
  preview=parseMessage(val('entryText'), val('entryName')||'Default', writer);

  const summary = computePreviewSaveSummary();
  const uniquePreviewBlockKeys = [...new Set((preview.detailRows||[]).map(r=>r.duplicateBlockKey).filter(Boolean))];
  const allDuplicate = uniquePreviewBlockKeys.length > 0 && summary.duplicateBlockKeys.length === uniquePreviewBlockKeys.length;

  if(allDuplicate){
    preview = {detailRows:[], totals:[], warnings:['All duplicate ဖြစ်နေပါတယ်။ Copy paste အသစ်ထည့်ပါ။'], issues:[], cards:[]};
    renderPreview();
    showToast('All duplicate ဖြစ်နေပါတယ်။ Copy paste အသစ်ထည့်ပါ။');
    return;
  }

  renderPreview();
  if(preview.matchedHeaderCount && preview.headerDates?.length===1 && preview.headerSessions?.length===1){
    showToast('Header time အတိုင်း ' + preview.headerDates[0] + ' / ' + preview.headerSessions[0] + ' ဖြင့် သိမ်းပါမယ်');
  }else{
    showToast('Preview ပြီးပါပြီ');
  }
}
function computePreviewSaveSummary(){
  const selectedDate=val('entryDate')||today();
  const selectedSession=(val('entrySession')||'AM').toUpperCase().startsWith('P')?'PM':'AM';
  const selectedName=(val('entryName')||'').trim()||'Default';
  const rows = preview.detailRows || [];

  const targetMap = new Map();
  rows.forEach(r=>{
    const rowDate = r.date || selectedDate;
    const rowSession = (r.session || selectedSession || 'AM').toUpperCase().startsWith('P') ? 'PM' : 'AM';
    const rowName = r.name || selectedName;
    const key = `${rowName}__${rowDate}__${rowSession}`;
    const prev = targetMap.get(key) || {name:rowName, date:rowDate, session:rowSession, rows:0, amount:0, cardKeys:new Set()};
    prev.rows += 1;
    prev.amount += Number(r.amount||0);
    prev.cardKeys.add(r.cardBlockKey||r.duplicateBlockKey||`row-${prev.rows}`);
    targetMap.set(key, prev);
  });

  const targets = [...targetMap.values()].map(x=>({...x,cards:x.cardKeys.size,cardKeys:undefined})).sort((a,b)=>`${a.date}${a.session}${a.name}`.localeCompare(`${b.date}${b.session}${b.name}`));

  const previewBlocks = new Map();
  rows.forEach(r=>{
    const key = r.duplicateBlockKey || '';
    if(!key) return;
    const prev = previewBlocks.get(key) || {
      blockKey:key,
      label:r.duplicateBlockLabel || 'Message Block',
      name:r.name || selectedName,
      date:r.date || selectedDate,
      session:(r.session || selectedSession || 'AM').toUpperCase().startsWith('P') ? 'PM' : 'AM',
      rows:0,
      amount:0
    };
    prev.rows += 1;
    prev.amount += Number(r.amount||0);
    previewBlocks.set(key, prev);
  });

  const duplicateBlocks = [];
  previewBlocks.forEach(pb=>{
    const exists = records.some(r=>
      (r.duplicateBlockKey||'') === pb.blockKey &&
      (r.date||'') === pb.date &&
      (r.session||'') === pb.session
    );
    if(exists) duplicateBlocks.push(pb);
  });

  return {
    targets,
    duplicateBlocks,
    duplicateBlockKeys: duplicateBlocks.map(x=>x.blockKey),
    duplicateBlockLabels: duplicateBlocks.map(x=>x.label)
  };
}
function renderSaveFlowBox(){
  const left = document.getElementById('saveTargetSummary');
  const right = document.getElementById('duplicateSummary');
  const actions = document.getElementById('duplicateActionBox');
  if(!left || !right || !actions) return;

  const summary = computePreviewSaveSummary();
  pendingDuplicateBlockKeys = summary.duplicateBlockKeys || [];
  pendingDuplicateBlockLabels = summary.duplicateBlockLabels || [];

  if(!preview.detailRows.length){
    left.innerHTML = '<div class="muted">Parse Preview မလုပ်ရသေးပါ</div>';
    right.innerHTML = '<div class="muted">Duplicate check မရှိသေးပါ</div>';
    actions.innerHTML = '';
    return;
  }

  left.innerHTML = summary.targets.length ? `
    <table>
      <thead><tr><th>Name</th><th>Date</th><th>Session</th><th class="right">Cards</th><th class="right">Rows</th><th class="right">Amount</th></tr></thead>
      <tbody>
        ${summary.targets.map(t=>`<tr><td>${escapeHtml(t.name)}</td><td>${t.date}</td><td><b>${t.session}</b></td><td class="right">${t.cards||0}</td><td class="right">${t.rows}</td><td class="right">${money(t.amount)}</td></tr>`).join('')}
      </tbody>
    </table>
  ` : '<div class="muted">Detected target မရှိသေးပါ</div>';

  if(preview.needsNameSelection){
    right.innerHTML = `<div class="dupNameWarn"><b>Name မရွေးရသေးပါ</b><br>Typing save လုပ်မယ်ဆို Name ကို အရင်ရွေးပြီးမှ Confirm Save လုပ်ပါ။</div>`;
    actions.innerHTML = '';
    return;
  }

  if(pendingDuplicateBlockKeys.length){
    right.innerHTML = `
      <div class="dupWarn"><b>Duplicate message block ${pendingDuplicateBlockKeys.length} ခုတွေ့ပါတယ်</b><br>Same Session ထဲမှာ ထပ်တူ message block ရှိနေပါတယ်။</div>
      <table style="margin-top:8px">
        <thead><tr><th>Header</th><th>Date</th><th>Session</th><th class="right">Rows</th></tr></thead>
        <tbody>
          ${summary.duplicateBlocks.map(d=>`<tr><td>${escapeHtml(d.label)}</td><td>${d.date}</td><td><b>${d.session}</b></td><td class="right">${d.rows}</td></tr>`).join('')}
        </tbody>
      </table>
    `;
    actions.innerHTML = `
      <div class="btnrow" style="margin-top:8px">
        <button class="btn warn small" onclick="deleteDuplicatePreviewBlocks(true)">Delete Existing + Save</button>
        <button class="btn secondary small" onclick="savePreview(true,'skip')">Skip Duplicate Only</button>
        <button class="btn small" onclick="savePreview(true,'all')">Save All Anyway</button>
        <button class="btn gray small" onclick="cancelDuplicateFlow()">Cancel</button>
      </div>
    `;
  }else{
    right.innerHTML = `<div class="dupOk"><b>No duplicate</b><br>ဒီ preview ကို current target ထဲ safe save လုပ်လို့ရပါတယ်။</div>`;
    actions.innerHTML = '';
  }
}
function cancelDuplicateFlow(){
  showToast('Duplicate warning ကိုပြထားပါတယ်။ Header line ကို ပြန်စစ်နိုင်ပါတယ်');
}
function deleteDuplicatePreviewBlocks(saveAfter=false){
  if(!pendingDuplicateBlockKeys.length){
    showToast('ဖျက်ရန် duplicate message block မရှိပါ');
    return;
  }
  snapshotBeforeChange('Delete Duplicate Blocks', {count:pendingDuplicateBlockKeys.length});
  const deleted = records.filter(r=>pendingDuplicateBlockKeys.includes(r.duplicateBlockKey || ''));
  records = records.filter(r=>!pendingDuplicateBlockKeys.includes(r.duplicateBlockKey || ''));
  saveRecords();
  saveCloudSnapshot(false);
  pushAudit('DELETE_DUPLICATE_BLOCKS', {
    label:`Deleted ${pendingDuplicateBlockKeys.length} duplicate blocks`,
    summary:'Duplicate message block ကို ဖျက်ပြီးပါပြီ',
    names: collectNamesFromRows(deleted),
    date: deleted[0]?.date || '',
    session: deleted[0]?.session || '',
    rawText: rawTextForBatch(deleted[0])
  });
  pendingDuplicateBlockKeys = [];
  pendingDuplicateBlockLabels = [];
  renderAll();
  renderSaveFlowBox();
  showToast('Existing duplicate message block ကို ဖျက်ပြီးပါပြီ');
  if(saveAfter) savePreview(true,'all');
}
function renderPreview(){
  setText('pvCards',(preview.cards||[]).length);
  setText('pvRows',preview.detailRows.length);
  setText('pvTotal',money(preview.detailRows.reduce((a,b)=>a+b.amount,0)));
  setText('pvWarnings',preview.warnings.length);
  const cardBody=document.getElementById('previewCardRows');
  if(cardBody){
    cardBody.innerHTML=(preview.cards||[]).map(card=>`<tr class="${card.status==='review'?'cardNeedsReview':''}"><td><b>${card.indexInPaste}</b></td><td>${escapeHtml(card.name||val('entryName')||'Default')}</td><td>${card.date||val('entryDate')||today()}</td><td>${card.session||val('entrySession')||'AM'}</td><td>${escapeHtml(card.time||'-')}</td><td class="right">${card.rowCount}</td><td class="right">${money(card.totalAmount)}</td><td><span class="cardStatus ${card.status}">${card.status==='review'?'Review':(card.status==='warning'?'Warning':'Ready')}</span></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Viber Card မတွေ့သေးပါ</td></tr>';
  }
  document.getElementById('previewRows').innerHTML=preview.detailRows.map((r,i)=>`<tr><td>${i+1}</td><td><b>${r.cardIndexInPaste||1}</b></td><td>${escapeHtml(r.cardTime||'-')}</td><td>${escapeHtml(r.name||val('entryName')||'Default')}</td><td><b>${r.number}</b></td><td class="right">${money(r.amount)}</td><td>${r.type}</td><td>${escapeHtml(r.source)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No preview</td></tr>';
  document.getElementById('previewAgg').innerHTML=preview.totals.map(r=>`<tr><td><b>${r.number}</b></td><td class="right">${money(r.amount)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No data</td></tr>';
  document.getElementById('warnBox').innerHTML=preview.warnings.length? `<div class="bad">${preview.warnings.map(escapeHtml).join('<br>')}</div>` : '<span class="good">Warnings မရှိပါ</span>';
  renderIssueEditor();
  renderSaveFlowBox();
  renderEntrySafetyStatus();
  renderParserReportQueueStatus();
  renderEntryWorkspace();
}
function renderIssueEditor(){
  const wrap=document.getElementById('issueEditorWrap');
  const list=document.getElementById('issueEditorList');
  const detail=document.getElementById('issueEditorDetail');
  const editor=document.getElementById('entryText');
  if(!wrap || !list || !detail || !editor) return;

  if(preview.issues && preview.issues.length){
    if(currentIssueIndex >= preview.issues.length) currentIssueIndex = 0;
    wrap.style.display='block';
    editor.classList.add('entryError');

    list.innerHTML = preview.issues.map((it,i)=>`
      <button class="issuePickBtn ${i===currentIssueIndex?'active':''}" onclick="selectIssue(${i})">
        Line ${it.lineNo}: ${escapeHtml(String(it.edited||it.line||'').slice(0,40))}
      </button>
    `).join('');

    const it = preview.issues[currentIssueIndex];
    detail.innerHTML = `
      <div class="issueMsg">Line ${it.lineNo}: ${escapeHtml(it.message)}</div>
      <textarea class="issueInput" id="issueLine_single" oninput="updateCurrentIssueText(this.value)">${escapeHtml(it.edited||it.line||'')}</textarea>
      <div class="issueQuickActions">
        <button class="btn secondary small" onclick="findCurrentIssueInEditor()">Find in Paste</button>
        <button class="btn secondary small" onclick="replaceCurrentIssueInEditor()">Replace in Paste Box</button>
        <button class="btn warn small" onclick="appendCurrentIssueToEditor()">Append Bottom</button>
        <button class="btn small" onclick="applyCurrentIssueAndReparse()">Apply & Reparse</button>
      </div>
    `;
  }else{
    wrap.style.display='none';
    list.innerHTML='';
    detail.innerHTML='';
    editor.classList.remove('entryError');
  }
}

function loadIssueLinesToEditor(){
  if(!preview.issues || !preview.issues.length){
    showToast('အနီစာ / Issue line မရှိပါ');
    return;
  }
  preview.issues.forEach(issue=>{
    if(issue.edited==null || issue.edited==='') issue.edited=issue.line||'';
  });
  currentIssueIndex=0;
  renderIssueEditor();
  showToast(`${preview.issues.length} issue lines ကို Fix Lines Editor ထဲ ဖော်ပြပြီးပါပြီ`);
}

function selectIssue(i){
  currentIssueIndex = i;
  renderIssueEditor();
}

function updateCurrentIssueText(value){
  if(!preview.issues || !preview.issues[currentIssueIndex]) return;
  preview.issues[currentIssueIndex].edited = value;
}

function findCurrentIssueInEditor(){
  if(!preview.issues || !preview.issues[currentIssueIndex]) return;
  const issue=preview.issues[currentIssueIndex];
  const ta=document.getElementById('entryText');
  const lines=ta.value.split('\n');
  const idx = issue.lineNo ? issue.lineNo-1 : lines.findIndex(x=>x.trim()===String(issue.line).trim());
  let start=0;
  for(let n=0;n<Math.max(0,idx);n++) start += lines[n].length + 1;
  const target = (idx>=0 ? lines[idx] : (issue.line||''));
  ta.focus();
  ta.setSelectionRange(start, start + String(target).length);
  showToast('Paste Box ထဲ line ကို ရှာပေးပြီးပါပြီ');
}

function replaceCurrentIssueInEditor(){
  if(!preview.issues || !preview.issues[currentIssueIndex]) return;
  const issue=preview.issues[currentIssueIndex];
  const ta=document.getElementById('entryText');
  const lines=ta.value.split('\n');
  const idx = issue.lineNo ? issue.lineNo-1 : lines.findIndex(x=>x.trim()===String(issue.line).trim());
  if(idx>=0) lines[idx]=issue.edited||issue.line;
  else lines.push(issue.edited||issue.line);
  ta.value = lines.join('\n');
  findCurrentIssueInEditor();
  showToast('Paste Box ထဲ အစားထိုးပြီးပါပြီ');
}

function appendCurrentIssueToEditor(){
  if(!preview.issues || !preview.issues[currentIssueIndex]) return;
  const issue=preview.issues[currentIssueIndex];
  const ta=document.getElementById('entryText');
  ta.value = ta.value.replace(/\s+$/,'') + '\n' + (issue.edited||issue.line);
  showToast('အောက်ဆုံးမှာ ထည့်ပြီးပါပြီ');
}

function applyCurrentIssueAndReparse(){
  replaceCurrentIssueInEditor();
  parseInput();
}

function clearIssueEditor(){
  const wrap=document.getElementById('issueEditorWrap');
  const list=document.getElementById('issueEditorList');
  const detail=document.getElementById('issueEditorDetail');
  const editor=document.getElementById('entryText');
  currentIssueIndex = 0;
  if(wrap) wrap.style.display='none';
  if(list) list.innerHTML='';
  if(detail) detail.innerHTML='';
  if(editor) editor.classList.remove('entryError');
  if(preview) preview.issues=[];
}

function normalizeDuplicateText(s){
  return String(s||'').replace(/\s+/g,' ').trim();
}
function targetCardKey(name,date,session){
  return `${String(name||'Default')}__${String(date||today())}__${String(session||'AM')}`;
}
function maxExistingCardNumber(name,date,session,excludeCardId=''){
  return records.reduce((max,row)=>{
    if(excludeCardId && row.cardId===excludeCardId) return max;
    if((row.name||'Default')!==name || row.date!==date || row.session!==session) return max;
    return Math.max(max,Number(row.cardNumber||0)||0);
  },0);
}
function prepareRowsWithCardMetadata(rows,{batchId,selectedName,selectedDate,selectedSession,ts}){
  const counters=new Map();
  const assignments=new Map();
  const rowCounters=new Map();
  const rawStoredCards=new Set();
  const ordered=[...rows].sort((a,b)=>(Number(a.cardIndexInPaste||0)-Number(b.cardIndexInPaste||0)) || (Number(a.cardSourceLine||0)-Number(b.cardSourceLine||0)));
  return ordered.map((r)=>{
    const name=r.name||selectedName||'Default';
    const date=r.date||selectedDate||today();
    const session=(r.session||selectedSession||'AM').toUpperCase().startsWith('P')?'PM':'AM';
    const target=targetCardKey(name,date,session);
    const sourceCardKey=r.cardBlockKey||r.duplicateBlockKey||`manual-${r.cardIndexInPaste||1}`;
    const assignmentKey=`${target}__${sourceCardKey}`;
    if(!assignments.has(assignmentKey)){
      if(!counters.has(target)) counters.set(target,maxExistingCardNumber(name,date,session));
      const next=counters.get(target)+1;
      counters.set(target,next);
      assignments.set(assignmentKey,{
        cardId:(window.crypto?.randomUUID?.()||`C-${ts}-${assignments.size+1}-${Math.random().toString(36).slice(2)}`),
        cardNumber:next,
        cardIndexInBatch:Number(r.cardIndexInPaste||assignments.size+1)||assignments.size+1
      });
    }
    const card=assignments.get(assignmentKey);
    const nextRow=(rowCounters.get(assignmentKey)||0)+1;
    rowCounters.set(assignmentKey,nextRow);
    const keepRaw=!rawStoredCards.has(assignmentKey);
    rawStoredCards.add(assignmentKey);
    return {...r,...card,name,date,session,cardBlockKey:sourceCardKey,cardRawText:keepRaw?(r.cardRawText||r.source||''):'',cardTime:r.cardTime||'',cardHeaderStamp:r.cardHeaderStamp||r.headerStamp||'',cardHeaderName:r.cardHeaderName||'',cardSourceLine:Number(r.cardSourceLine||0)||0,rowIndexInCard:nextRow,batchId};
  });
}
function savePreview(skipDuplicateCheck=false, duplicateMode='warn'){
  if(!preview.detailRows.length){showToast('Save လုပ်ရန် preview မရှိပါ'); return;}
  const selectedDate=val('entryDate')||today(); const selectedSession=val('entrySession')||'AM';
  if(selectedSession==='DAILY'){ showToast('Confirm Save လုပ်ရန် AM သို့မဟုတ် PM ကိုရွေးပါ'); return; }
  const selectedName=(val('entryName')||'').trim()||'Default';
  if(preview.needsNameSelection && selectedName==='Default'){
    renderSaveFlowBox();
    showToast('Name မရွေးရသေးပါ။ Name ရွေးပြီးမှ Confirm Save လုပ်ပါ','error',6000);
    go('entry');
    return;
  }

  const summary = computePreviewSaveSummary();
  if(!skipDuplicateCheck && summary.duplicateBlockKeys.length){
    pendingDuplicateBlockKeys = summary.duplicateBlockKeys;
    pendingDuplicateBlockLabels = summary.duplicateBlockLabels;
    renderSaveFlowBox();
    showToast('Duplicate message block တွေ့ပါတယ်။ Action တစ်ခုရွေးပါ','warn',6000);
    return;
  }

  const rawText = val('entryText') || '';
  const normalizedText = normalizeDuplicateText(rawText);
  const ts=Date.now(); const batchId='B'+ts; const writerProfile=selectedWriterProfile();

  let rowsToSave = [...preview.detailRows];
  if(duplicateMode==='skip' && pendingDuplicateBlockKeys.length){
    rowsToSave = rowsToSave.filter(r=>!pendingDuplicateBlockKeys.includes(r.duplicateBlockKey || ''));
  }

  if(!rowsToSave.length){
    showToast('အသစ်သိမ်းရန် row မရှိပါ');
    return;
  }

  rowsToSave=prepareRowsWithCardMetadata(rowsToSave,{batchId,selectedName,selectedDate,selectedSession,ts});
  const savedCardCount=new Set(rowsToSave.map(r=>r.cardId).filter(Boolean)).size;
  snapshotBeforeChange('Save Preview', {rows:rowsToSave.length, cards:savedCardCount, names:collectNamesFromRows(rowsToSave)});

  rowsToSave.forEach((r,saveIndex)=>{
    const rowName = r.name || selectedName;
    const rowDate = r.date || selectedDate;
    const rowSession = (r.session || selectedSession || 'AM').toUpperCase().startsWith('P') ? 'PM' : 'AM';
    const groupId = `${r.cardId||batchId}__${rowName}__${String(r.source||'').trim()}__${rowDate}__${rowSession}`;
    records.push({...r,name:rowName,date:rowDate,session:rowSession,ts,batchId,groupId,writerProfile,batchTextHash:normalizedText,batchRawText:saveIndex===0?rawText:'',duplicateBlockKey:r.duplicateBlockKey||'',duplicateBlockLabel:r.duplicateBlockLabel||'',id:crypto.randomUUID?crypto.randomUUID():String(ts)+Math.random()});
  });

  try{
    saveRecords();
  }catch(err){
    return;
  }
  saveCloudSnapshot(false);
  pushAudit('SAVE', {
    label: `Saved ${rowsToSave.length} rows`,
    summary: `Batch ${batchId} | ${savedCardCount} cards | ${rowsToSave.length} rows သိမ်းပြီး`,
    names: collectNamesFromRows(rowsToSave),
    date: rowsToSave[0]?.date || selectedDate,
    session: rowsToSave[0]?.session || selectedSession,
    rawText
  });
  pendingDuplicateBlockKeys = [];
  pendingDuplicateBlockLabels = [];
  preview={detailRows:[],totals:[],warnings:[],issues:[],cards:[]};
  renderAll();
  renderSaveFlowBox();
  showToast(`Confirm Save အောင်မြင်ပါပြီ — ${savedCardCount} ကတ် / ${rowsToSave.length} rows သိမ်းပြီးပါပြီ`,'success',5500);
}
function filterRecords(date,session,name='ALL'){
  return records.filter(r=>r.date===date && (session==='DAILY' || r.session===session) && (name==='ALL' || (r.name||'Default')===name));
}
function totalsByNumber(date,session,name='ALL'){
  const map=new Map(); filterRecords(date,session,name).forEach(r=>map.set(r.number,(map.get(r.number)||0)+Number(r.amount||0)));
  return Object.fromEntries([...map.entries()].sort((a,b)=>Number(a[0])-Number(b[0])));
}
function totalsByName(date,session){
  const map=new Map(); filterRecords(date,session,'ALL').forEach(r=>map.set(r.name||'Default',(map.get(r.name||'Default')||0)+Number(r.amount||0)));
  return Object.fromEntries([...map.entries()].sort((a,b)=>a[0].localeCompare(b[0])));
}
function deductionsFor(date,session,name='ALL'){
  return overDeductions.filter(d=>d.date===date && (session==='DAILY' || d.session===session) && (name==='ALL' ? true : (d.name===name || d.name==='ALL')));
}
function boardTotalsByNumber(date,session,name='ALL'){
  const totals={...totalsByNumber(date,session,name)};
  deductionsFor(date,session,name).forEach(d=>{totals[d.number]=(totals[d.number]||0)-Number(d.amount||0); if(totals[d.number]<0) totals[d.number]=0;});
  return totals;
}
function boardTableHTML(totals, limit, cb){
  let html='', total=0, overTotal=0, overCount=0;
  for(let row=0; row<10; row++){
    for(let ten=0; ten<10; ten++){
      const n=String(ten)+String(row); const amt=Number(totals[n]||0); total+=amt; const over=amt>limit; const hot=amt>0 && !over;
      if(over){overCount++; overTotal+=amt-limit;}
      html += `<div class="numCell ${over?'over':hot?'hot':''}">${n}</div><div class="amtCell ${amt?'':'empty'} ${over?'over':hot?'hot':''}">${amt?unit(amt):''}</div>`;
    }
  }
  cb?.({total,overTotal,overCount}); return html;
}
function renderLimit(){
  const date=val('limitDate')||today(); const session=val('limitSession')||'AM'; const name=val('limitName')||'ALL'; const limit=Number(val('limitAmount')||settings.defaultLimit||10000); const totals=boardTotalsByNumber(date,session,name);
  const board=document.getElementById('limitBoard'); let total=0, overTotal=0, overCount=0;
  board.innerHTML=boardTableHTML(totals, limit, (calc)=>{total=calc.total; overTotal=calc.overTotal; overCount=calc.overCount;});
  setText('limitTotal',money(total)); setText('limitOverTotal',money(overTotal)); setText('limitOverCount',overCount);
}
function renderOver(){
  const date=val('overDate')||today(); const session=val('overSession')||'AM'; const name=val('overName')||'ALL'; const limit=Number(val('overLimit')||settings.defaultLimit||10000); const totals=boardTotalsByNumber(date,session,name);
  const rows=Object.entries(totals).filter(([n,a])=>a>limit).map(([number,amount])=>({number,amount,over:amount-limit}));
  document.getElementById('overRows').innerHTML=rows.map((r,i)=>`<tr><td>${i+1}</td><td><b>${r.number}</b></td><td class="right bad">${money(r.over)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Over မရှိပါ</td></tr>';
  setText('overSumOver',money(rows.reduce((a,b)=>a+b.over,0)));
}
function dealerManualKey(date,session){return `${date||today()}__${session||'AM'}`;}
function saveDealerManualMemory(){userSetItem('v2d_dealer_manual_memory',JSON.stringify(dealerManualMemory||{}));}
function saveManualDealerInputs(){
  const date=val('reportDate')||today();
  const session=val('reportSession')||'AM';
  if(session==='DAILY') return;
  dealerManualMemory[dealerManualKey(date,session)] = [1,2,3].map(i=>({
    name:val('odName'+i)||'',
    amount:Number(val('odAmt'+i)||0),
    pAmount:Number(val('odPamt'+i)||0),
    cor:Number(val('odCor'+i)||0)
  }));
  saveDealerManualMemory();
}
function loadManualDealerInputs(){
  const date=val('reportDate')||today();
  const session=val('reportSession')||'AM';
  const rows = session==='DAILY' ? [] : (dealerManualMemory[dealerManualKey(date,session)]||[]);
  [1,2,3].forEach((i,idx)=>{
    const r=rows[idx]||{};
    setVal('odName'+i,r.name||'');
    setVal('odAmt'+i,r.amount||'');
    setVal('odPamt'+i,r.pAmount||'');
    setVal('odCor'+i,r.cor||'');
  });
}
function onReportViewChange(){
  restorePNumber();
  loadManualDealerInputs();
  renderReports();
}
function getRate(name){return Number((settings.nameRates&&settings.nameRates[name]!=null)?settings.nameRates[name]:(settings.commissionRate||0));}
function sessionPData(date,session,name='ALL'){
  const rate=Number(settings.payoutRate||80);
  if(session==='DAILY'){
    const pAM=getStoredPNumber(date,'AM');
    const pPM=getStoredPNumber(date,'PM');
    const amTotals=totalsByNumber(date,'AM',name);
    const pmTotals=totalsByNumber(date,'PM',name);
    const pamtAM=pAM?(amTotals[pAM]||0):0;
    const pamtPM=pPM?(pmTotals[pPM]||0):0;
    return {
      p:`AM ${pAM||'-'} | PM ${pPM||'-'}`,
      pAM,pPM,
      pamtAM,pamtPM,
      pamt:pamtAM+pamtPM,
      payout:(pamtAM+pamtPM)*rate
    };
  }
  const p=getStoredPNumber(date,session);
  const totals=totalsByNumber(date,session,name);
  const pamt=p?(totals[p]||0):0;
  return {p,pamt,payout:pamt*rate};
}
function reportCalc(){
  const date=val('reportDate')||today(); const session=val('reportSession')||'AM'; const name=val('reportName')||'ALL';
  restorePNumber();
  const totals=totalsByNumber(date,session,name); const nameTotals=totalsByName(date,session); const total=Object.values(totals).reduce((a,b)=>a+b,0);
  const pData=sessionPData(date,session,name);
  const com=total*(Number(settings.commissionRate||0)/100); const net=total-com; const pamt=pData.pamt; const payout=pData.payout; const final=net-payout;
  return {date,session,name,totals,nameTotals,total,com,net,p:pData.p,pData,pamt,payout,final};
}
function commissionSummary(name,date,session){
  const totals=totalsByNumber(date,session,name); const total=Object.values(totals).reduce((a,b)=>a+b,0);
  const pData=sessionPData(date,session,name); const pamt=pData.pamt; const payout=pData.payout;
  const rate=getRate(name); const cor=total*rate/100; const final=total-payout-cor;
  return {name,date,session,p:pData.p,pData,total,pamt,payout,rate,cor,final,status: final<0?'ဒိုင်မှ ပေးရန်':'ဒိုင်မှ ရရန်'};
}
function signedMoney(v){return v<0?'('+money(Math.abs(Math.round(v)))+')':money(Math.round(v));}
function manualOverDealerRows(){
  const payoutRate=Number(settings.payoutRate||80);
  return [1,2,3].map(i=>{
    const name=val('odName'+i)||('Over '+i);
    const amount=Number(val('odAmt'+i)||0);
    const pAmount=Number(val('odPamt'+i)||0);
    const cor=Number(val('odCor'+i)||0);
    const corAmount=amount*cor/100;
    const payout=pAmount*payoutRate;
    const final=amount-corAmount-payout;
    return {index:i,name,amount,pAmount,cor,corAmount,payout,final};
  }).filter(x=>x.amount>0 || x.pAmount>0 || x.cor>0 || (x.name && !/^Over \d+$/.test(x.name)));
}
function dealerSummary(date,session){
  const names=settings.names||[]; const sums=names.map(n=>commissionSummary(n,date,session));
  const allTotal=sums.reduce((a,b)=>a+b.total,0);
  const allPAmount=sums.reduce((a,b)=>a+b.pamt,0);
  const allPayout=sums.reduce((a,b)=>a+b.payout,0);
  const allCor=sums.reduce((a,b)=>a+b.cor,0);
  const overRows=manualOverDealerRows();
  const overAmount=overRows.reduce((a,b)=>a+b.amount,0);
  const overPAmount=overRows.reduce((a,b)=>a+b.pAmount,0);
  const overCor=overRows.reduce((a,b)=>a+b.corAmount,0);
  const overPayout=overRows.reduce((a,b)=>a+b.payout,0);
  const final=allTotal-allPayout-allCor-overAmount+overPayout+overCor;
  return {allTotal,allPAmount,allPayout,allCor,overAmount,overPAmount,overCor,overPayout,final,overRows,sums};
}
function renderDealerSummary(r){
  if(!document.getElementById('dealerTotal')) return;
  const d=dealerSummary(r.date,r.session);
  d.overRows.forEach(x=>{
    setText('odCorAmt'+x.index,money(Math.round(x.corAmount)));
    setText('odPayout'+x.index,money(Math.round(x.payout)));
    setText('odFinal'+x.index,signedMoney(x.final));
    const el=document.getElementById('odFinal'+x.index);
    if(el) el.className='dealerAuto '+(x.final<0?'dealerFinalNegative':'dealerFinalPositive');
  });
  [1,2,3].forEach(i=>{
    if(!d.overRows.some(x=>x.index===i)){
      setText('odCorAmt'+i,'0'); setText('odPayout'+i,'0'); setText('odFinal'+i,'0');
      const el=document.getElementById('odFinal'+i); if(el) el.className='dealerAuto';
    }
  });
  setText('dealerTotal',money(d.allTotal));
  setText('dealerPAmount',money(d.allPAmount));
  setText('dealerPayout',money(d.allPayout));
  setText('dealerCor',money(Math.round(d.allCor)));
  setText('dealerOverAmt',money(d.overAmount));
  setText('dealerOverPAmount',money(d.overPAmount));
  setText('dealerOverPayout',money(d.overPayout));
  setText('dealerOverCor',money(Math.round(d.overCor)));
  setText('dealerFinal',signedMoney(d.final));
  document.getElementById('dealerFinal').className='v '+(d.final<0?'dealerFinalNegative':'dealerFinalPositive');
}
function drawReportImage(title, lines, filename){
  const canvas=document.createElement('canvas'); canvas.width=900; canvas.height=Math.max(500,120+lines.length*36); const c=canvas.getContext('2d');
  c.fillStyle='#f8fafc'; c.fillRect(0,0,canvas.width,canvas.height); c.fillStyle='#0f172a'; c.font='bold 34px Arial'; c.fillText(title,32,54);
  c.strokeStyle='#16a34a'; c.lineWidth=4; c.beginPath(); c.moveTo(32,76); c.lineTo(canvas.width-32,76); c.stroke();
  c.font='22px Arial'; let y=120; lines.forEach(line=>{c.fillStyle=line.color||'#0f172a'; c.font=line.bold?'bold 23px Arial':'22px Arial'; c.fillText(line.text,40,y); y+=36;});
  const a=document.createElement('a'); a.href=canvas.toDataURL('image/png'); a.download=filename; a.click();
}
function saveCommissionReportImage(){
  const date=val('reportDate')||today(); const session=val('reportSession')||'AM'; const selected=val('reportName')||'ALL';
  const names=selected==='ALL'?(settings.names||[]): [selected];
  names.forEach(name=>{
    const s=commissionSummary(name,date,session); const neg=s.final<0;
    drawReportImage(`${name} ${session} စာရင်း`,[
      {text:`Date: ${date}`,bold:true},{text:`P Number: ${s.p}`,bold:true},{text:`Total Amount: ${money(s.total)}`},{text:`P Amount: ${money(s.pamt)}`},{text:`Payout: ${money(s.payout)}`},{text:`Cor ${s.rate}%: ${money(Math.round(s.cor))}`},{text:`Final: ${signedMoney(s.final)}`,bold:true,color:neg?'#dc2626':'#16a34a'},{text:s.status,bold:true,color:neg?'#dc2626':'#16a34a'}
    ],`commission-${name}-${date}-${session}.png`);
  });
}
function saveDealerReportImage(){
  const date=val('reportDate')||today(); const session=val('reportSession')||'AM'; const p=sessionPData(date,session,'ALL').p; const d=dealerSummary(date,session); const neg=d.final<0;
  const lines=[{text:`Date: ${date} | Session: ${session} | P: ${p}`,bold:true},{text:`All Total: ${money(d.allTotal)}`},{text:`All P Amount: ${money(d.allPAmount)}`},{text:`All Payout: ${money(d.allPayout)}`},{text:`All Cor: ${money(Math.round(d.allCor))}`},{text:`Manual Dealer Total: ${money(d.overAmount)}`},{text:`Manual P Amount: ${money(d.overPAmount)}`},{text:`Manual Payout: ${money(d.overPayout)}`},{text:`Manual Cor: ${money(Math.round(d.overCor))}`},{text:`Final Results: ${signedMoney(d.final)}`,bold:true,color:neg?'#16a34a':'#dc2626'}];
  d.overRows.forEach(x=>lines.push({text:`${x.name}: Total ${money(x.amount)} | P ${money(x.pAmount)} | Cor ${x.cor}%=${money(Math.round(x.corAmount))} | Payout ${money(x.payout)} | Final ${signedMoney(x.final)}`,color:x.final<0?'#16a34a':'#dc2626'}));
  drawReportImage('ဒိုင်စာရင်း / Dealer Summary',lines,`dealer-${date}-${session}.png`);
}
function reportCardKey(row){
  if(row.cardId) return `CARD__${row.cardId}`;
  return `LEGACY__${getBatchId(row)}__${row.name||'Default'}__${row.date||''}__${row.session||''}`;
}
function reportCardBreakdown(date,session,name='ALL'){
  const map=new Map();
  filterRecords(date,session,name).forEach(row=>{
    const key=reportCardKey(row);
    if(!map.has(key)){
      map.set(key,{
        key,
        cardId:row.cardId||'',
        cardNumber:Number(row.cardNumber||0)||0,
        name:row.name||'Default',
        date:row.date||date,
        session:row.session||'',
        time:row.cardTime||'',
        batchId:getBatchId(row),
        ts:Number(row.ts||0)||0,
        rows:0,
        total:0,
        sources:[]
      });
    }
    const card=map.get(key);
    card.rows+=1;
    card.total+=Number(row.amount||0);
    if(!card.time && row.cardTime) card.time=row.cardTime;
    if(!card.cardNumber && row.cardNumber) card.cardNumber=Number(row.cardNumber||0)||0;
    const src=String(row.source||'').trim();
    if(src && !card.sources.includes(src) && card.sources.length<3) card.sources.push(src);
    if(!card.ts || (Number(row.ts||0)&&Number(row.ts||0)<card.ts)) card.ts=Number(row.ts||0)||card.ts;
  });
  return [...map.values()].sort((a,b)=>{
    const nc=(a.name||'').localeCompare(b.name||''); if(nc) return nc;
    const sc=String(a.session||'').localeCompare(String(b.session||'')); if(sc) return sc;
    if((a.cardNumber||0)!==(b.cardNumber||0)) return (a.cardNumber||0)-(b.cardNumber||0);
    return (a.ts||0)-(b.ts||0);
  });
}
function reportPCardBreakdown(date,session,name='ALL'){
  const rows=filterRecords(date,session,name).filter(row=>{
    const p=getStoredPNumber(date,row.session||session);
    return !!p && String(row.number||'').padStart(2,'0')===String(p).padStart(2,'0');
  });
  const map=new Map();
  rows.forEach(row=>{
    const p=getStoredPNumber(date,row.session||session);
    const key=`${reportCardKey(row)}__P${p}`;
    if(!map.has(key)){
      map.set(key,{
        key,
        cardId:row.cardId||'',
        cardNumber:Number(row.cardNumber||0)||0,
        name:row.name||'Default',
        date:row.date||date,
        session:row.session||'',
        time:row.cardTime||'',
        pNumber:p||'',
        ts:Number(row.ts||0)||0,
        hits:0,
        amount:0,
        sources:[]
      });
    }
    const card=map.get(key);
    card.hits+=1;
    card.amount+=Number(row.amount||0);
    const src=String(row.source||'').trim();
    if(src && !card.sources.includes(src) && card.sources.length<3) card.sources.push(src);
  });
  return [...map.values()].sort((a,b)=>{
    const nc=(a.name||'').localeCompare(b.name||''); if(nc) return nc;
    const sc=String(a.session||'').localeCompare(String(b.session||'')); if(sc) return sc;
    if((a.cardNumber||0)!==(b.cardNumber||0)) return (a.cardNumber||0)-(b.cardNumber||0);
    return (a.ts||0)-(b.ts||0);
  });
}
function reportCardLabel(card){ return card.cardNumber?`#${card.cardNumber}`:'Legacy'; }
function reportOpenButton(card){
  if(!card.cardId) return '<span class="muted">Legacy</span>';
  return `<button class="actionBtn edit" onclick="openReportCard('${jsArg(card.cardId)}')">Open</button>`;
}
function reportTotalBreakdownHTML(cards,{showName=false,showSession=false}={}){
  if(!cards.length) return '<div class="muted">Card data မရှိသေးပါ</div>';
  const total=cards.reduce((a,b)=>a+Number(b.total||0),0);
  return `<div class="reportDrillHead"><b>Card Total Breakdown</b><span>${cards.length} cards · ${money(total)}</span></div>
    <div class="scroll"><table class="reportDrillTable"><thead><tr>${showName?'<th>Name</th>':''}<th>Card</th><th>Time</th>${showSession?'<th>Session</th>':''}<th class="right">Rows</th><th class="right">Amount</th><th>Source</th><th></th></tr></thead><tbody>${cards.map(card=>`<tr>${showName?`<td><b>${escapeHtml(card.name)}</b></td>`:''}<td><span class="cardNoBadge">${reportCardLabel(card)}</span></td><td>${escapeHtml(card.time||'-')}</td>${showSession?`<td>${escapeHtml(card.session||'-')}</td>`:''}<td class="right">${card.rows}</td><td class="right"><b>${money(card.total)}</b></td><td class="reportSourceCell">${escapeHtml(card.sources.join(' | ')||'-')}</td><td>${reportOpenButton(card)}</td></tr>`).join('')}</tbody><tfoot><tr><th colspan="${(showName?1:0)+(showSession?1:0)+3}">Total</th><th class="right">${money(total)}</th><th colspan="2"></th></tr></tfoot></table></div>`;
}
function reportPBreakdownHTML(cards,{showName=false,showSession=false}={}){
  if(!cards.length) return '<div class="muted">ရွေးထားသော Date / Session အတွက် P Number Card contribution မရှိပါ</div>';
  const total=cards.reduce((a,b)=>a+Number(b.amount||0),0);
  return `<div class="reportDrillHead"><b>P Number Card Breakdown</b><span>${cards.length} cards · P Amount ${money(total)}</span></div>
    <div class="scroll"><table class="reportDrillTable"><thead><tr>${showName?'<th>Name</th>':''}<th>P No.</th><th>Card</th><th>Time</th>${showSession?'<th>Session</th>':''}<th class="right">Hits</th><th class="right">P Amount</th><th>Source</th><th></th></tr></thead><tbody>${cards.map(card=>`<tr>${showName?`<td><b>${escapeHtml(card.name)}</b></td>`:''}<td><b>${escapeHtml(card.pNumber||'-')}</b></td><td><span class="cardNoBadge">${reportCardLabel(card)}</span></td><td>${escapeHtml(card.time||'-')}</td>${showSession?`<td>${escapeHtml(card.session||'-')}</td>`:''}<td class="right">${card.hits}</td><td class="right warnText"><b>${money(card.amount)}</b></td><td class="reportSourceCell">${escapeHtml(card.sources.join(' | ')||'-')}</td><td>${reportOpenButton(card)}</td></tr>`).join('')}</tbody><tfoot><tr><th colspan="${(showName?1:0)+(showSession?1:0)+4}">Total P Amount</th><th class="right">${money(total)}</th><th colspan="2"></th></tr></tfoot></table></div>`;
}
function toggleReportTotalBreakdown(){ reportTotalBreakdownOpen=!reportTotalBreakdownOpen; renderReports(); }
function toggleReportPBreakdown(){ reportPBreakdownOpen=!reportPBreakdownOpen; renderReports(); }
function toggleReportNameBreakdown(name,type){
  const set=type==='p'?reportExpandedPNames:reportExpandedNames;
  if(set.has(name)) set.delete(name); else set.add(name);
  renderReports();
}
function openReportCard(cardId){
  const row=records.find(r=>r.cardId===cardId);
  if(!row){ showToast('Card မတွေ့ပါ'); return; }
  setVal('recordDate',row.date||today());
  setVal('recordSession',row.session||'AM');
  setVal('recordName',row.name||'Default');
  setVal('recordSearch','');
  currentSelectedCardId=cardId;
  go('records');
  renderEntryRecords();
  setTimeout(()=>document.getElementById('cardNavigatorShell')?.scrollIntoView({behavior:'smooth',block:'start'}),80);
}
function renderReportTopBreakdowns(r){
  const totalPanel=document.getElementById('reportTotalBreakdown');
  const pPanel=document.getElementById('reportPBreakdown');
  const totalArrow=document.getElementById('rTotalArrow');
  const pArrow=document.getElementById('rPArrow');
  if(totalArrow) totalArrow.textContent=reportTotalBreakdownOpen?'▲':'▼';
  if(pArrow) pArrow.textContent=reportPBreakdownOpen?'▲':'▼';
  if(totalPanel){
    totalPanel.hidden=!reportTotalBreakdownOpen;
    if(reportTotalBreakdownOpen){
      const cards=reportCardBreakdown(r.date,r.session,r.name);
      totalPanel.innerHTML=reportTotalBreakdownHTML(cards,{showName:r.name==='ALL',showSession:r.session==='DAILY'});
    }
  }
  if(pPanel){
    pPanel.hidden=!reportPBreakdownOpen;
    if(reportPBreakdownOpen){
      const cards=reportPCardBreakdown(r.date,r.session,r.name);
      pPanel.innerHTML=reportPBreakdownHTML(cards,{showName:r.name==='ALL',showSession:r.session==='DAILY'});
    }
  }
}
function renderReports(){
  const r=reportCalc(); setText('rTotal',money(r.total)); setText('rCom',money(Math.round(r.com))); setText('rNet',money(Math.round(r.net))); setText('rPamt',money(r.pamt)); setText('rPayout',money(r.payout)); setText('rFinal',money(Math.round(r.final)));
  document.getElementById('rFinal').className='v '+(r.final>=0?'good':'bad');
  renderReportTopBreakdowns(r);
  const names=settings.names||[];
  document.getElementById('reportNameRows').innerHTML=names.map(n=>{
    const s=commissionSummary(n,r.date,r.session); const cls=s.final<0?'resultNegative':'resultPositive'; const f=s.final<0?'('+money(Math.abs(Math.round(s.final)))+')':money(Math.round(s.final));
    const totalOpen=reportExpandedNames.has(n), pOpen=reportExpandedPNames.has(n);
    let html=`<tr><td><b>${escapeHtml(n)}</b></td><td class="right"><button class="reportCellDrill" onclick="toggleReportNameBreakdown('${jsArg(n)}','total')">${money(s.total)} <span>${totalOpen?'▲':'▼'}</span></button></td><td class="right"><button class="reportCellDrill warnText" onclick="toggleReportNameBreakdown('${jsArg(n)}','p')">${money(s.pamt)} <span>${pOpen?'▲':'▼'}</span></button></td><td class="right">${money(s.payout)}</td><td class="right">${s.rate}%</td><td class="right">${money(Math.round(s.cor))}</td><td class="right ${cls}">${f}</td></tr>`;
    if(totalOpen || pOpen){
      const parts=[];
      if(totalOpen) parts.push(reportTotalBreakdownHTML(reportCardBreakdown(r.date,r.session,n),{showName:false,showSession:r.session==='DAILY'}));
      if(pOpen) parts.push(reportPBreakdownHTML(reportPCardBreakdown(r.date,r.session,n),{showName:false,showSession:r.session==='DAILY'}));
      html+=`<tr class="reportInlineDetailRow"><td colspan="7"><div class="reportInlineDetail">${parts.join('')}</div></td></tr>`;
    }
    return html;
  }).join('') || '<tr><td colspan="7" class="muted">No data</td></tr>';
  document.getElementById('reportRows').innerHTML=Object.entries(r.totals).map(([n,a])=>`<tr><td><b>${n}</b></td><td class="right">${money(a)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No data</td></tr>';
  renderDealerSummary(r);
}

function renderImageText(){
  const date=val('imageDate')||today(); const session=val('imageSession')||'AM'; const name=val('imageName')||'ALL'; const title=val('imageTitle')||'2D Report'; const totals=totalsByNumber(date,session,name); const total=Object.values(totals).reduce((a,b)=>a+b,0);
  const lines=[]; lines.push(`${title}`); lines.push(`${settings.shopName||'Viber 2D Desk'} | ${date} | ${session} | ${name}`); lines.push('--------------------'); Object.entries(totals).forEach(([n,a])=>lines.push(`${n} = ${money(a)}`)); lines.push('--------------------'); lines.push(`Total = ${money(total)}`);
  document.getElementById('shareText').textContent=lines.join('\n');
}
function renderMainBoard(){
  const board=document.getElementById('mainLimitBoard'); if(!board) return;
  const date=val('entryDate')||today(); const session=val('entrySession')||'AM'; const mode=val('entryBoardMode')||'ALL'; const name=mode==='NAME'?(val('entryBoardName')||'Default'):'ALL'; const limit=Number(val('entryLimitAmount')||settings.defaultLimit||10000);
  const totals=boardTotalsByNumber(date,session,name); const rows=filterRecords(date,session,name).length;
  let total=0, overTotal=0, overCount=0;
  board.innerHTML=boardTableHTML(totals, limit, (calc)=>{total=calc.total; overTotal=calc.overTotal; overCount=calc.overCount;});
  setText('mainBoardTotal',money(total)); setText('mainBoardOverTotal',money(overTotal)); setText('mainBoardOverCount',overCount); setText('mainBoardRows',rows);
}
function renderEntryOver(){
  const tbody=document.getElementById('entryOverRows'); if(!tbody) return;
  const date=val('entryDate')||today(); const session=val('entrySession')||'AM'; const mode=val('entryBoardMode')||'ALL'; const name=mode==='NAME'?(val('entryBoardName')||'Default'):'ALL'; const limit=Number(val('entryLimitAmount')||settings.defaultLimit||10000);
  const totals=boardTotalsByNumber(date,session,name); const rows=Object.entries(totals).filter(([n,a])=>a>limit).map(([number,amount])=>({number,amount,over:amount-limit}));
  tbody.innerHTML=rows.map((r,i)=>`<tr><td>${i+1}</td><td><b>${r.number}</b></td><td class="right bad">${money(r.over)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Over မရှိပါ</td></tr>';
  setText('entryOverSumOver',money(rows.reduce((a,b)=>a+b.over,0)));
}


/* Stage 4.3.0 — Full UI Language + Theme */
function entryWorkspaceBaseRows(){
  const date=val('entryDate')||today();
  const session=val('entrySession')||'AM';
  const name=val('entryName')||'Default';
  return records.filter(r=>r.cardId && (r.date||'')===date && (session==='DAILY'||r.session===session) && (r.name||'Default')===name);
}
function buildEntryWorkspaceCards(applySearch=true){
  const map=new Map();
  entryWorkspaceBaseRows().forEach(r=>{
    const key=r.cardId;
    if(!map.has(key)) map.set(key,{cardId:key,cardNumber:Number(r.cardNumber||0)||0,name:r.name||'Default',date:r.date||'',session:r.session||'',time:r.cardTime||'',batchId:getBatchId(r),ts:Number(r.ts||0)||0,rows:[],total:0,rawText:'',edited:false});
    const card=map.get(key);
    card.rows.push(r); card.total+=Number(r.amount||0);
    if(!card.rawText&&r.cardRawText) card.rawText=String(r.cardRawText||'');
    if(r.editedAt) card.edited=true;
    if(!card.time&&r.cardTime) card.time=r.cardTime;
    if(!card.cardNumber&&r.cardNumber) card.cardNumber=Number(r.cardNumber||0)||0;
    card.ts=Math.min(card.ts||Number(r.ts||0)||0,Number(r.ts||0)||0)||Number(r.ts||0)||0;
  });
  let cards=[...map.values()].map(card=>{
    card.rows.sort((a,b)=>(a.cardSourceLine||0)-(b.cardSourceLine||0)||(a.ts||0)-(b.ts||0));
    if(!card.rawText&&card.rows.length) card.rawText=rawTextForCard(card.rows[0]);
    if(!card.rawText){const seen=new Set();card.rawText=card.rows.map(r=>String(r.source||'').trim()).filter(src=>src&&!seen.has(src)&&seen.add(src)).join('\n');}
    card.searchBlob=[`#${card.cardNumber}`,`card ${card.cardNumber}`,card.time,card.rawText,...card.rows.flatMap(r=>[r.number,r.amount,r.source,r.type])].join(' ').toLowerCase();
    return card;
  }).sort((a,b)=>((a.cardNumber||0)-(b.cardNumber||0))||((a.ts||0)-(b.ts||0)));
  if(applySearch){const q=(val('entryWorkspaceSearch')||'').trim().toLowerCase(); if(q) cards=cards.filter(card=>card.searchBlob.includes(q));}
  return cards;
}
function selectedEntryWorkspaceCard(){return buildEntryWorkspaceCards(false).find(card=>card.cardId===entryWorkspaceSelectedCardId)||null;}
function setEntryWorkspaceActions(enabled){['entryWsEditBtn','entryWsCopyBtn'].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=!enabled;});}
function applyEntryWorkspaceUiState(){
  const board=document.querySelector('#entry .board-card');
  const boardCollapsed=userGetItem('v2d_ui_entry_board_collapsed')==='1';
  if(board) board.classList.toggle('workspace-collapsed',boardCollapsed);
  const boardBtn=document.getElementById('entryBoardToggleBtn'); if(boardBtn) boardBtn.textContent=boardCollapsed?'Expand Board ▼':'Collapse Board ▲';
  const tools=document.getElementById('entryToolsArea');
  const toolsCollapsed=userGetItem('v2d_ui_entry_tools_collapsed')==='1';
  if(tools) tools.classList.toggle('tools-collapsed',toolsCollapsed);
  const toolsBtn=document.getElementById('entryToolsToggleBtn'); if(toolsBtn) toolsBtn.textContent=toolsCollapsed?'Show Tools ▼':'Hide Tools ▲';
}
function toggleEntryBoardCompact(){userSetItem('v2d_ui_entry_board_collapsed',userGetItem('v2d_ui_entry_board_collapsed')==='1'?'0':'1');applyEntryWorkspaceUiState();}
function toggleEntryTools(){userSetItem('v2d_ui_entry_tools_collapsed',userGetItem('v2d_ui_entry_tools_collapsed')==='1'?'0':'1');applyEntryWorkspaceUiState();}
function renderEntryWorkspace(){
  const list=document.getElementById('entryWorkspaceCardList'); if(!list) return;
  applyEntryWorkspaceUiState();
  const date=val('entryDate')||today(), session=val('entrySession')||'AM', name=val('entryName')||'Default';
  const cards=buildEntryWorkspaceCards(true);
  setText('entryWsScope',`${name} · ${date} · ${session}`); setText('entryWsCardCount',cards.length);
  if(!cards.some(c=>c.cardId===entryWorkspaceSelectedCardId)) entryWorkspaceSelectedCardId=cards[0]?.cardId||'';
  list.innerHTML=cards.map(card=>`<button class="entryWsCardItem${card.cardId===entryWorkspaceSelectedCardId?' active':''}" onclick="selectEntryWorkspaceCard('${jsArg(card.cardId)}')"><span class="entryWsCardTop"><b>Card #${card.cardNumber||'-'}</b><span>${escapeHtml(card.time||'-')}</span></span><span class="entryWsCardSub"><span>${card.rows.length} rows${card.edited?' · Edited':''}</span><strong>${money(card.total)}</strong></span></button>`).join('')||'<div class="entryWsEmpty">ဒီ Date / Session / Name အတွက် Saved Card မရှိသေးပါ။<br>အောက်က Paste & Parse Tools မှ စာရင်းသွင်းနိုင်ပါတယ်။</div>';
  const card=cards.find(c=>c.cardId===entryWorkspaceSelectedCardId)||null;
  if(!card){
    setEntryWorkspaceActions(false); setText('entryWsSelectedTitle','Card မရွေးရသေးပါ');setText('entryWsSelectedMeta','ဘယ်ဘက် Card List မှ တစ်ကတ်ရွေးပါ');
    const raw=document.getElementById('entryWsRawText');if(raw)raw.textContent='ကတ်မရွေးရသေးပါ';
    const body=document.getElementById('entryWsRows');if(body)body.innerHTML='<tr><td colspan="5" class="muted">ကတ်တစ်ကတ်ရွေးပါ</td></tr>';
    setText('entryWsSelectedTotal','0');setText('entryWsSelectedRows','0 rows');setText('entryWsSelectedTime','-');
  }else{
    setEntryWorkspaceActions(true);setText('entryWsSelectedTitle',`${card.name} — Card #${card.cardNumber||'-'}`);setText('entryWsSelectedMeta',`${card.date} · ${card.session} · Viber ${card.time||'-'} · Batch ${batchLabel(card.rows[0]||{})}`);
    const raw=document.getElementById('entryWsRawText');if(raw)raw.textContent=card.rawText||'Raw Viber text မရှိပါ';
    const body=document.getElementById('entryWsRows');if(body)body.innerHTML=card.rows.map((r,i)=>`<tr class="${r.editedAt?'editedCardRow':''}"><td>${i+1}</td><td><b>${r.number}</b></td><td class="right">${money(r.amount)}</td><td>${escapeHtml(r.source||'')}</td><td><button class="actionBtn edit" onclick="editEntryRecord('${jsArg(r.id||'')}')">Edit</button></td></tr>`).join('')||'<tr><td colspan="5" class="muted">Record မရှိပါ</td></tr>';
    setText('entryWsSelectedTotal',money(card.total));setText('entryWsSelectedRows',`${card.rows.length} rows`);setText('entryWsSelectedTime',card.time||'-');
  }
  const nameRows=entryWorkspaceBaseRows();
  const nameTotal=nameRows.reduce((s,r)=>s+Number(r.amount||0),0);
  const sessionRows=records.filter(r=>(r.date||'')===date&&(session==='DAILY'||r.session===session));
  const sessionTotal=sessionRows.reduce((s,r)=>s+Number(r.amount||0),0);
  const pRows=nameRows.filter(r=>{const p=getStoredPNumber(date,r.session||session);return !!p&&String(r.number||'').padStart(2,'0')===String(p).padStart(2,'0');});
  const pTotal=pRows.reduce((s,r)=>s+Number(r.amount||0),0);
  const pLabel=session==='DAILY'?`P Amount (AM/PM)`:`P ${getStoredPNumber(date,session)||'-'} Amount`;
  const limit=Number(val('entryLimitAmount')||settings.defaultLimit||10000);
  const overTotal=currentOverRows(date,session,name,limit).reduce((s,r)=>s+Number(r.over||0),0);
  const previewTotal=(preview.detailRows||[]).reduce((s,r)=>s+Number(r.amount||0),0);
  setText('entryWsNameTotal',money(nameTotal));setText('entryWsNameLabel',name);setText('entryWsSessionTotal',money(sessionTotal));setText('entryWsPNumberLabel',pLabel);setText('entryWsPAmount',money(pTotal));setText('entryWsOverTotal',money(overTotal));setText('entryWsPreviewTotal',money(previewTotal));setText('entryWsPreviewCards',(preview.cards||[]).length);setText('entryWsPreviewRows',(preview.detailRows||[]).length);
  const cloudText=document.getElementById('cloudSyncText')?.textContent||'Cloud'; const cloudDetail=document.getElementById('cloudSyncDetail')?.textContent||''; setText('entryWsSyncText',cloudText);setText('entryWsSyncDetail',cloudDetail);
  const cloudPill=document.getElementById('cloudSyncPill');const wsBox=document.getElementById('entryWsSyncBox');if(cloudPill&&wsBox){const status=[...cloudPill.classList].find(c=>['loading','saving','synced','offline','conflict','error'].includes(c))||'loading';wsBox.className=`workspaceSyncBox ${status}`;}
}
function selectEntryWorkspaceCard(cardId){entryWorkspaceSelectedCardId=String(cardId||'');renderEntryWorkspace();}
function navigateEntryWorkspaceCard(delta){const cards=buildEntryWorkspaceCards(true);if(!cards.length){showToast(currentUiLang()==='en'?'No cards':'Card မရှိပါ');return;}let i=cards.findIndex(c=>c.cardId===entryWorkspaceSelectedCardId);if(i<0)i=0;const n=i+Number(delta||0);if(n<0||n>=cards.length){showToast(n<0?(currentUiLang()==='en'?'Already at the first card':'ပထမ Card ရောက်နေပါပြီ'):(currentUiLang()==='en'?'Already at the last card':'နောက်ဆုံး Card ရောက်နေပါပြီ'));return;}entryWorkspaceSelectedCardId=cards[n].cardId;renderEntryWorkspace();}
function openEntryWorkspaceCardEdit(){const card=selectedEntryWorkspaceCard();if(!card||!card.rows.length){showToast(currentUiLang()==='en'?'No card available to edit':'Edit လုပ်မည့် Card မရှိပါ');return;}openGroupEditByRecord(card.rows[0].id);}
function copyEntryWorkspaceCardRaw(){const card=selectedEntryWorkspaceCard();if(!card){showToast(currentUiLang()==='en'?'No card selected':'Card မရွေးရသေးပါ');return;}copyText(card.rawText||card.rows.map(r=>r.source||'').filter(Boolean).join('\n'));}
function openEntryWorkspaceRecords(){const card=selectedEntryWorkspaceCard();if(card){setVal('recordDate',card.date);setVal('recordSession',card.session);setVal('recordName',card.name);currentSelectedCardId=card.cardId;}else{setVal('recordDate',val('entryDate')||today());setVal('recordSession',val('entrySession')||'AM');setVal('recordName',val('entryName')||'ALL');}go('records');}
function focusNewEntryWorkspace(){const toolsCollapsed=userGetItem('v2d_ui_entry_tools_collapsed')==='1';if(toolsCollapsed){userSetItem('v2d_ui_entry_tools_collapsed','0');applyEntryWorkspaceUiState();}const ta=document.getElementById('entryText');if(ta){ta.focus();ta.scrollIntoView({behavior:'smooth',block:'center'});}}

function renderEntryLive(){renderMainBoard(); renderEntryOver(); renderEntryWorkspace();}
const I18N={
  my:{
    langLabel:'ဘာသာ',themeLabel:'Theme',themeSystem:'System',themeLight:'Light',themeDark:'Dark',
    backup:'Backup JSON',clearAll:'အားလုံးဖျက်',liveBoard:'Limit Table Board / Live Desk',
    boardNote:'Laptop screen အတွက် Board ကို အပေါ်ဆုံးမှာ သေသပ်ကျယ်ပြန့်စွာထားထားသည်။ Amount ကို Unit ဖြင့်ပြသည်။',
    refresh:'ပြန်ဖော်ပြ',date:'ရက်စွဲ',session:'Session',name:'အမည် / ကော်မရှင်',limitAmount:'Limit Amount',
    total:'စုစုပေါင်း',overTotal:'Over စုစုပေါင်း',overCount:'Over အရေအတွက်',recordRows:'Rows',
    entryTitle:'စာရင်းထည့်ရန်',parsePreview:'စစ်ကြည့်မည်',confirmSave:'အတည်ပြုသိမ်းမည်',clearText:'စာသားရှင်းမည်',
    parserSafety:'Parser လုံခြုံရေးစစ်ဆေးမှု',fixIssues:'Issue များပြင်မည်',saveReviewed:'စစ်ပြီး Rows သိမ်းမည်',reportParserIssue:'Parser မှားယွင်းမှု Report',cancel:'မလုပ်တော့',safetyHelp:'Parser မဖတ်နိုင်/မသေချာသောစာရှိပါက အရင်ပြင်ပါ။ User က စစ်ပြီးမှ စစ်ပြီး Rows သိမ်းမည် ဖြင့် ဆက်သိမ်းနိုင်သည်။',
    parserReportTitle:'Parser မှားယွင်းမှု Report',parserReportHint:'Original message နှင့် လက်ရှိ Parser Output ကို အလိုအလျောက်ထည့်ပေးထားသည်။ Correct Result နှင့် Note ကို ဖြည့်ပြီး App Owner ထံ ပို့ပါ။',originalMessage:'မူရင်း Viber Message',currentParserOutput:'လက်ရှိ Parser Output',expectedCorrectRecords:'အမှန်ဖြစ်ရမည့် Records',reportNote:'မှတ်ချက်',sendToOwner:'App Owner ထံပို့မည်',close:'ပိတ်မည်',
    previewRows:'Preview Rows',previewTotal:'Preview စုစုပေါင်း',warnings:'သတိပေးချက်',aggByNumber:'Number အလိုက်ပေါင်း',
    previewDetail:'Preview အသေးစိတ်',overLive:'Over / ကျော်စာရင်း',overNote:'အပေါ်က ရက်စွဲ / Session / Name အတိုင်း Over တွက်ထားသည်။',
    uploadImage:'ပုံတင်မည်',cameraBtn:'ကင်မရာ',clearImage:'ပုံရှင်းမည်',
    cloudLoading:'Cloud ဖွင့်နေသည်…',saving:'သိမ်းနေသည်…',cloudSynced:'Cloud သိမ်းပြီး',offlineWaiting:'Offline — စောင့်ဆိုင်းနေသည်',
    syncConflict:'Sync ပဋိပက္ခ',syncError:'Sync အမှား',last:'နောက်ဆုံး',autoSyncWhenOnline:'Internet ပြန်ရလျှင် Auto Sync',
    newerDataOtherDevice:'တခြားစက်မှာ Data အသစ်ရှိသည်',checkingAccountData:'Account data စစ်နေသည်'
  },
  en:{
    langLabel:'Language',themeLabel:'Theme',themeSystem:'System',themeLight:'Light',themeDark:'Dark',
    backup:'Backup JSON',clearAll:'Clear All',liveBoard:'Limit Table Board / Live Desk',
    boardNote:'A clean wide board is placed first for laptop screens. Amounts are displayed in unit format.',
    refresh:'Refresh',date:'Date',session:'Session',name:'Name / Commission',limitAmount:'Limit Amount',
    total:'Total',overTotal:'Over Total',overCount:'Over Count',recordRows:'Rows',entryTitle:'Entry',
    parsePreview:'Parse Preview',confirmSave:'Confirm Save',clearText:'Clear Text',
    parserSafety:'Parser Safety Check',fixIssues:'Fix Issues',saveReviewed:'Save Reviewed Rows',reportParserIssue:'Report Parser Issue',cancel:'Cancel',safetyHelp:'Fix unread or uncertain text first. After review, the user may explicitly save the reviewed rows.',
    parserReportTitle:'Parser Issue Report',parserReportHint:'The original message and current parser output are filled automatically. Add the correct result and a note, then send it to the App Owner.',originalMessage:'Original Viber Message',currentParserOutput:'Current Parser Output',expectedCorrectRecords:'Expected Correct Records',reportNote:'Note',sendToOwner:'Send to App Owner',close:'Close',previewRows:'Preview Rows',previewTotal:'Preview Total',
    warnings:'Warnings',aggByNumber:'Aggregated by Number',previewDetail:'Preview Detail',overLive:'Over',
    overNote:'Over is calculated using the selected date/session/name above.',uploadImage:'Upload Image',cameraBtn:'Camera',clearImage:'Clear Image',
    cloudLoading:'Opening Cloud…',saving:'Saving…',cloudSynced:'Cloud Synced',offlineWaiting:'Offline — Waiting to sync',
    syncConflict:'Sync Conflict',syncError:'Sync Error',last:'Last',autoSyncWhenOnline:'Auto sync when internet returns',
    newerDataOtherDevice:'Newer data exists on another device',checkingAccountData:'Checking account data'
  }
};

const UI_PHRASE_PAIRS=[
  ['Dashboard','ပင်မ'],['Entry','စာရင်းသွင်း'],['Entry Records','စာရင်းမှတ်တမ်း'],['Limit Board','ကန့်သတ်ဘုတ်'],['Over','ကျော်နေသောစာရင်း'],['Reports','အစီရင်ခံစာ'],['Image','ပုံ / မျှဝေ'],['Settings','ဆက်တင်'],['History','မှတ်တမ်း / Undo'],['Tests','Parser စမ်းသပ်မှု'],['Diagnostics','Error / Version'],
  ['Language','ဘာသာ'],['Theme','Theme'],['System','System'],['Light','Light'],['Dark','Dark'],['Backup JSON','Backup JSON'],['Restore JSON','Restore JSON'],['Sync Now','ယခု Sync'],['Cloud Refresh','Cloud ပြန်ယူ'],['Clear All','အားလုံးဖျက်'],['Logout','ထွက်မည်'],['Minimize ▲','ချုံ့မည် ▲'],['Open ▼','ဖွင့်မည် ▼'],
  ['Global Date','ရက်စွဲအားလုံး'],['Global Session','Session အားလုံး'],['Today Total','ယနေ့ စုစုပေါင်း'],['AM Total','AM စုစုပေါင်း'],['PM Total','PM စုစုပေါင်း'],['Latest Records','နောက်ဆုံးစာရင်းများ'],['Date','ရက်စွဲ'],['Session','Session'],['Name','အမည်'],['Card','ကတ်'],['Writer','ရေးသားပုံ'],['Number','နံပါတ်'],['Amount','ငွေပမာဏ'],['Source','မူရင်း'],
  ['Entry စတင်မယ်','စာရင်းစတင်မည်'],['Limit Board ကြည့်မယ်','Limit Board ကြည့်မည်'],['Formula Engine ပါပြီးသော Key များ','Formula Engine Key များ'],
  ['Board View / ကြည့်ပုံ','Board ကြည့်ပုံ'],['Total / အားလုံး','အားလုံး'],['By Name / နာမည်အလိုက်','အမည်အလိုက်'],['Board Name / ကြည့်မယ့်နာမည်','Board အမည်'],['Limit Amount','Limit ပမာဏ'],['Total','စုစုပေါင်း'],['Over Total','Over စုစုပေါင်း'],['Over Count','Over အရေအတွက်'],['Rows','Rows'],['Refresh','ပြန်ဖော်ပြ'],['Collapse Board ▲','Board ခေါက်မည် ▲'],['Expand Board ▼','Board ဖြန့်မည် ▼'],
  ['Laptop Professional Workspace / ကတ်စာရင်းအလုပ်ခွင်','Laptop Professional Workspace / ကတ်အလုပ်ခွင်'],['Saved Card List + Selected Card Editor + Live Summary ကို တစ်မျက်နှာတည်းတွင် အမြဲမြင်နိုင်အောင် စီထားသည်။','Saved Card List၊ Selected Card Editor နှင့် Live Summary ကို တစ်မျက်နှာတည်းတွင် မြင်နိုင်သည်။'],['+ New Paste / စာရင်းအသစ်','+ စာရင်းအသစ်'],['Entry Records ဖွင့်မယ်','Entry Records ဖွင့်မည်'],['Card List / ကတ်စာရင်း','ကတ်စာရင်း'],['Selected Card Editor','ရွေးထားသော ကတ်ပြင်ရန်'],['Live Summary','လက်ရှိအကျဉ်းချုပ်'],['Edit Card','ကတ်ပြင်မည်'],['Copy Raw','မူရင်း Copy'],['Selected Card Total','ရွေးထားသောကတ် စုစုပေါင်း'],['Selected Card Rows','ရွေးထားသောကတ် Rows'],['Viber Time','Viber အချိန်'],['Name Total','အမည် စုစုပေါင်း'],['Session Total','Session စုစုပေါင်း'],['P Number Amount','P Number ပမာဏ'],['Current Paste Preview Total','လက်ရှိ Paste Preview စုစုပေါင်း'],['Detected Cards','တွေ့ရှိသော ကတ်များ'],['Preview Rows','Preview Rows'],['Cloud Sync Status','Cloud Sync အခြေအနေ'],
  ['Paste & Parse Tools','Paste & Parse ကိရိယာများ'],['Hide Tools ▲','Tools ဖျောက်မည် ▲'],['Show Tools ▼','Tools ပြမည် ▼'],['Parse Preview','စစ်ကြည့်မည်'],['Confirm Save','အတည်ပြုသိမ်းမည်'],['Clear Text','စာသားရှင်းမည်'],['Preview Total','Preview စုစုပေါင်း'],['Warnings','သတိပေးချက်'],['Aggregated by Number','နံပါတ်အလိုက်ပေါင်း'],['Preview Detail','Preview အသေးစိတ်'],['Upload Image','ပုံတင်မည်'],['Camera','ကင်မရာ'],['Clear Image','ပုံရှင်းမည်'],
  ['Search','ရှာဖွေ'],['All Names','အမည်အားလုံး'],['Edit','ပြင်မည်'],['Delete','ဖျက်မည်'],['Remove','ဖယ်မည်'],['Save','သိမ်းမည်'],['Cancel','မလုပ်တော့'],['Close','ပိတ်မည်'],['Open','ဖွင့်မည်'],['Copy','Copy'],['Previous','ယခင်'],['Next','နောက်တစ်ခု'],['Apply','အတည်ပြုအသုံးပြု'],['Undo','ပြန်ဖျက်'],['Edited','ပြင်ထားသည်'],['No records','စာရင်းမရှိသေးပါ'],['No data','Data မရှိသေးပါ'],
  ['Report','အစီရင်ခံစာ'],['Total Amount','စုစုပေါင်းငွေ'],['P Amount','P ပမာဏ'],['Card Total','ကတ်စုစုပေါင်း'],['Time','အချိန်'],['Status','အခြေအနေ'],['Open Card','ကတ်ဖွင့်မည်'],['Daily','နေ့စဉ်'],['AM','AM'],['PM','PM'],['DAILY','DAILY'],
  ['Login','ဝင်မည်'],['Register','အကောင့်ဖွင့်မည်'],['Forgot Password','Password မေ့နေသည်'],['Password','Password'],['Confirm Password','Password အတည်ပြု'],['Your Name / အမည်','အမည်'],['Shop / Workspace Name','Shop / Workspace အမည်'],['Create Account / Account ဖွင့်မယ်','အကောင့်ဖွင့်မည်'],['Send Reset Email','Reset Email ပို့မည်'],['Login / ဝင်မယ်','ဝင်မည်']
];
const UI_EN_TO_MY=new Map(UI_PHRASE_PAIRS.map(([en,my])=>[en,my]));
const UI_MY_TO_EN=new Map(UI_PHRASE_PAIRS.map(([en,my])=>[my,en]));
const UI_BILINGUAL_ALIASES={
  'Restore JSON':{en:'Restore JSON',my:'Restore JSON'},'Sync Now':{en:'Sync Now',my:'ယခု Sync'},'Cloud Refresh':{en:'Cloud Refresh',my:'Cloud ပြန်ယူ'},
  'Dashboard ပင်မ':{en:'Dashboard',my:'ပင်မ'},'Entry စာရင်းသွင်း':{en:'Entry',my:'စာရင်းသွင်း'},'Entry Records စာရင်းမှတ်တမ်း':{en:'Entry Records',my:'စာရင်းမှတ်တမ်း'},
  'Limit Board ကန့်သတ်ဘုတ်':{en:'Limit Board',my:'ကန့်သတ်ဘုတ်'},'Over ကျော်နေသောစာရင်း':{en:'Over',my:'ကျော်နေသောစာရင်း'},'Reports အစီရင်ခံစာ':{en:'Reports',my:'အစီရင်ခံစာ'},
  'Image ပုံ / မျှဝေ':{en:'Image',my:'ပုံ / မျှဝေ'},'Settings ဆက်တင်':{en:'Settings',my:'ဆက်တင်'},'History မှတ်တမ်း / Undo':{en:'History',my:'မှတ်တမ်း / Undo'},
  'Tests Parser စမ်းသပ်မှု':{en:'Tests',my:'Parser စမ်းသပ်မှု'},'Diagnostics Error / Version':{en:'Diagnostics',my:'Error / Version'},'Open ထိပ်ပိုင်းဖွင့်':{en:'Open',my:'ထိပ်ပိုင်းဖွင့်'},
  'Refresh / ပြန်ဖော်ပြ':{en:'Refresh',my:'ပြန်ဖော်ပြ'},'+ New Paste / စာရင်းအသစ်':{en:'+ New Paste',my:'+ စာရင်းအသစ်'},'Entry Records ဖွင့်မယ်':{en:'Open Entry Records',my:'Entry Records ဖွင့်မည်'},
  'Edit Card / ကတ်ပြင်':{en:'Edit Card',my:'ကတ်ပြင်မည်'},'Copy Over Text / စာကူး':{en:'Copy Over Text',my:'Over စာကူး'},'Save Image / ပုံသိမ်း':{en:'Save Image',my:'ပုံသိမ်းမည်'},
  'Save Commission Image / ပုံသိမ်း':{en:'Save Commission Image',my:'Commission ပုံသိမ်းမည်'},'Save Dealer Image / ပုံသိမ်း':{en:'Save Dealer Image',my:'Dealer ပုံသိမ်းမည်'},
  'Sync Now / ယခု Sync':{en:'Sync Now',my:'ယခု Sync'},'◀ Previous':{en:'◀ Previous',my:'◀ ယခင်'},'Next ▶':{en:'Next ▶',my:'နောက်တစ်ခု ▶'},
  'Laptop Professional Workspace / ကတ်စာရင်းအလုပ်ခွင်':{en:'Laptop Professional Workspace',my:'Laptop ကတ်အလုပ်ခွင်'},'Card List / ကတ်စာရင်း':{en:'Card List',my:'ကတ်စာရင်း'},
  'Live Summary / လက်ရှိအကျဉ်းချုပ်':{en:'Live Summary',my:'လက်ရှိအကျဉ်းချုပ်'},'စာရင်းထည့်ရန် / Entry':{en:'Entry',my:'စာရင်းထည့်ရန်'},
  'အနီစာ ပြင်ရန် / Fix Lines':{en:'Fix Lines',my:'အနီစာ ပြင်ရန်'},'Save Preview / သိမ်းမည့်နေရာ စစ်ကြည့်':{en:'Save Preview',my:'သိမ်းမည့်နေရာ စစ်ကြည့်'},
  'Detected Viber Cards / တွေ့ရှိသော ကတ်များ':{en:'Detected Viber Cards',my:'တွေ့ရှိသော Viber ကတ်များ'},'Entry Records / သွင်းပြီးစာရင်းမှတ်တမ်း':{en:'Entry Records',my:'သွင်းပြီးစာရင်းမှတ်တမ်း'},
  'Card Navigator / ကတ်နံပါတ်အလိုက် စစ်ဆေးပြင်ဆင်ရန်':{en:'Card Navigator',my:'ကတ်နံပါတ်အလိုက် စစ်ဆေးပြင်ဆင်ရန်'},'Limit Table Board / ကန့်သတ်ဘုတ်':{en:'Limit Table Board',my:'ကန့်သတ်ဘုတ်'},
  'Over Page / ကျော်စာရင်း':{en:'Over Page',my:'ကျော်စာရင်း'},'AM / PM / Daily Report / အစီရင်ခံစာ':{en:'AM / PM / Daily Report',my:'AM / PM / Daily အစီရင်ခံစာ'},
  'Name Summary / နာမည်အလိုက်':{en:'Name Summary',my:'အမည်အလိုက် အကျဉ်းချုပ်'},'Number Summary / နံပါတ်အလိုက်':{en:'Number Summary',my:'နံပါတ်အလိုက် အကျဉ်းချုပ်'},
  'ဒိုင်စာရင်း / Dealer Summary':{en:'Dealer Summary',my:'ဒိုင်စာရင်း'},'Image / Share Text Page / ပုံနှင့်မျှဝေစာ':{en:'Image / Share Text Page',my:'ပုံနှင့်မျှဝေစာ'},
  'P Number Settings / Date နှင့် Session အလိုက်':{en:'P Number Settings by Date and Session',my:'ရက်စွဲနှင့် Session အလိုက် P Number ဆက်တင်'},
  'Commission Names / နာမည်စာရင်း':{en:'Commission Names',my:'ကော်မရှင်အမည်စာရင်း'},'History / Audit Trail / Undo':{en:'History / Audit Trail / Undo',my:'မှတ်တမ်း / Audit / Undo'},
  'Parser Regression Tests / အဟောင်းမှန်နေသော Logic စမ်းသပ်မှု':{en:'Parser Regression Tests',my:'Parser Logic စမ်းသပ်မှု'},'Developer Diagnostics / Error Checker / Version Control':{en:'Developer Diagnostics / Error Checker / Version Control',my:'Developer Error / Version စစ်ဆေးမှု'},
  'Group Edit / Batch Edit':{en:'Group Edit / Batch Edit',my:'အစုလိုက်ပြင်ဆင်ရန်'}
};
const UI_MESSAGE_PAIRS=[
 ['Copy လုပ်ရန် raw history မရှိသေးပါ','No raw history is available to copy.'],['Latest raw history ကို copy လုပ်ပြီးပါပြီ','Latest raw history copied.'],['Audit history cleared','Audit history cleared.'],['Undo ပြန်သွားရန် action မရှိသေးပါ','There is no action to undo.'],['Undo ပြန်သွားပါပြီ','Undo completed.'],['Raw text copied','Raw text copied.'],['P Number ကို 00 မှ 99 အတွင်း ရိုက်ပါ','Enter a P Number from 00 to 99.'],
 ['Save storage ပြည့်နေပါတယ်။ Audit history ကို လျှော့ပြီး ထပ်သိမ်းပါ','Local storage is full. Reduce audit history and save again.'],['Login/Firebase မချိတ်မိသေးပါ','Login/Firebase is not connected.'],['Internet မရှိသေးပါ။ Data ကို စက်ထဲသိမ်းထားပြီး Internet ပြန်ရလျှင် Auto Sync လုပ်မယ်','No internet. Data is saved locally and will auto-sync when internet returns.'],
 ['တခြားစက်မှာ Cloud Data အသစ်ရှိနေပါတယ်။ Backup JSON ထုတ်ပြီး Cloud Refresh ဖြင့် စစ်ပါ','Newer cloud data exists on another device. Export a JSON backup and check with Cloud Refresh.'],['Cloud Sync စတင်နေပါသည်…','Cloud sync started…'],['Cloud Sync အောင်မြင်ပါပြီ','Cloud sync successful.'],['Sync Conflict: တခြားစက်မှာ Data အသစ်ရှိနေပါတယ်။ Local Data ကို မဖျက်ထားပါ','Sync conflict: newer data exists on another device. Local data was not deleted.'],
 ['တခြားစက်မှ Cloud Data အသစ်ကို Auto Update လုပ်ပြီးပါပြီ','New cloud data from another device was auto-updated.'],['Cloud Data ပြန်ဖတ်နေပါသည်…','Refreshing cloud data…'],['Cloud Data မတွေ့သေးပါ','No cloud data found yet.'],['Cloud Refresh အောင်မြင်ပါပြီ','Cloud refresh successful.'],
 ['Image preview ready. OCR text ကို right box ထဲ paste/edit လုပ်ပါ။','Image preview is ready. Paste or edit OCR text in the right box.'],['OCR box ထဲ text မရှိသေးပါ','There is no text in the OCR box yet.'],['OCR text ကို Entry box ထဲ ထည့်ပြီးပါပြီ','OCR text was added to the Entry box.'],
 ['All duplicate ဖြစ်နေပါတယ်။ Copy paste အသစ်ထည့်ပါ။','All rows are duplicates. Paste a new message.'],['Preview ပြီးပါပြီ','Preview completed.'],['Duplicate warning ကိုပြထားပါတယ်။ Header line ကို ပြန်စစ်နိုင်ပါတယ်','A duplicate warning is shown. You can review the header line.'],['ဖျက်ရန် duplicate message block မရှိပါ','No duplicate message block to delete.'],['Existing duplicate message block ကို ဖျက်ပြီးပါပြီ','Existing duplicate message block deleted.'],
 ['အနီစာ / Issue line မရှိပါ','No issue line found.'],['Paste Box ထဲ line ကို ရှာပေးပြီးပါပြီ','The line was located in the Paste Box.'],['Paste Box ထဲ အစားထိုးပြီးပါပြီ','Replaced in the Paste Box.'],['အောက်ဆုံးမှာ ထည့်ပြီးပါပြီ','Added at the bottom.'],['Save လုပ်ရန် preview မရှိပါ','There is no preview to save.'],['Confirm Save လုပ်ရန် AM သို့မဟုတ် PM ကိုရွေးပါ','Select AM or PM before Confirm Save.'],['Name မရွေးရသေးပါ။ Name ရွေးပြီးမှ Confirm Save လုပ်ပါ','Select a Name before Confirm Save.'],['Duplicate message block တွေ့ပါတယ်။ Action တစ်ခုရွေးပါ','Duplicate message blocks found. Choose an action.'],['အသစ်သိမ်းရန် row မရှိပါ','There are no new rows to save.'],
 ['Card မတွေ့ပါ','Card not found.'],['Card ဖျက်ပြီး Cloud Sync လုပ်နေပါသည်','Card deleted. Cloud sync is in progress.'],['Record မတွေ့ပါ','Record not found.'],['Number မမှန်ပါ','Invalid number.'],['Amount မမှန်ပါ','Invalid amount.'],['Edited + Cloud Sync','Edited + Cloud Sync.'],['Group မတွေ့ပါ','Group not found.'],['Group state မရှိပါ','Group state not found.'],['Group text ကို parse မလုပ်နိုင်ပါ','Unable to parse group text.'],['Card Edit မှာ Viber Header တစ်ခုသာထားပါ','Keep only one Viber header in Card Edit.'],['Deleted + Cloud Sync','Deleted + Cloud Sync.'],['Batch မတွေ့ပါ','Batch not found.'],['Batch Deleted + Cloud Sync','Batch deleted + Cloud Sync.'],
 ['Name တစ်ခုရွေးပြီးမှ Delete Filtered Name လုပ်ပါ','Select a Name before deleting filtered name rows.'],['ဖျက်ရန် row မရှိပါ','No rows to delete.'],['Filtered Name Rows Deleted + Cloud Sync','Filtered name rows deleted + Cloud Sync.'],['Copy လုပ်ရန် record မရှိပါ','No records available to copy.'],['အရင် Run All Parser Tests လုပ်ပါ','Run all parser tests first.'],['Runtime error log cleared','Runtime error log cleared.'],['Copied','Copied.'],['Copy မရပါ','Copy failed.'],['Over မရှိပါ','No Over amount.'],['Backup JSON download စတင်ပါပြီ','Backup JSON download started.'],['Cleared','Cleared.'],['Name ထည့်ပါ','Enter a Name.'],['Name Added','Name added.'],['အနည်းဆုံး Name ၁ ခုထားပါ','Keep at least one Name.'],
 ['Audit history ကိုပဲ ဖျက်မလား? Data records မဖျက်ပါ။','Clear audit history only? Data records will not be deleted.'],['Browser cache, Service Worker cache ရှင်းပြီး App ကို version အသစ်ဖြင့် reload လုပ်မယ်။ ဆက်လုပ်မလား?','Clear browser and service worker caches, then reload the latest app version?'],['Copy Over Text လုပ်ပြီး Limit Board မှ Over amount ကို နုတ်မည်။ သေချာလား?','Copy Over Text and deduct the Over amount from the Limit Board?'],['Save Image လုပ်ပြီး Limit Board မှ Over amount ကို နုတ်မည်။ သေချာလား?','Save the image and deduct the Over amount from the Limit Board?'],['Data အကုန်ဖျက်မှာ သေချာလား?','Delete all data?'],
 ['Restore ပြီးပါပြီ။ App ကို ပြန်ဖွင့်ပြီး Cloud ကို Auto Sync လုပ်ပါမယ်။','Restore completed. The app will reopen and auto-sync to cloud.'],['JSON file ကိုဖတ်မရပါ','Unable to read the JSON file.']
];
const UI_MESSAGE_MY_TO_EN=new Map(UI_MESSAGE_PAIRS);
const UI_MESSAGE_EN_TO_MY=new Map(UI_MESSAGE_PAIRS.map(([my,en])=>[en,my]));
function currentUiLang(){ return settings?.lang || localStorage.getItem('v2d_ui_language') || 'my'; }
function tUi(key){ const lang=currentUiLang(); return (I18N[lang]||I18N.my)[key] ?? (I18N.en[key]||key); }
function translateLiteralText(text,lang=currentUiLang()){
  const raw=String(text??''); const trimmed=raw.trim(); if(!trimmed) return raw;
  const alias=UI_BILINGUAL_ALIASES[trimmed]; if(alias){const v=alias[lang];const lead=raw.slice(0,raw.indexOf(trimmed));const tail=raw.slice(raw.indexOf(trimmed)+trimmed.length);return lead+v+tail;}
  const mapped=lang==='en'?UI_MY_TO_EN.get(trimmed):UI_EN_TO_MY.get(trimmed);
  if(!mapped) return raw;
  const lead=raw.slice(0,raw.indexOf(trimmed)); const tail=raw.slice(raw.indexOf(trimmed)+trimmed.length);
  return lead+mapped+tail;
}
function translateUiMessage(message){
  const lang=currentUiLang(); let s=String(message??'');
  const msgMapped=lang==='en'?UI_MESSAGE_MY_TO_EN.get(s):UI_MESSAGE_EN_TO_MY.get(s); if(msgMapped) return msgMapped;
  const exact=translateLiteralText(s,lang); if(exact!==s) return exact;
  const rules=lang==='en' ? [
    [/Cloud Save စတင်နေပါသည်…/g,'Cloud save started…'],[/Cloud Save အောင်မြင်ပါပြီ/g,'Cloud save successful'],[/Login အောင်မြင်ပါပြီ။?/g,'Login successful.'],[/Account ဖွင့်ပြီး Login ဝင်ထားပါပြီ။?/g,'Account created and signed in.'],[/မရှိသေးပါ/g,'not available yet'],[/မရွေးရသေးပါ/g,'not selected'],[/မအောင်မြင်ပါ/g,'failed'],[/ပြီးပါပြီ/g,'completed'],[/သိမ်းပြီး/g,'saved'],[/စစ်နေပါသည်/g,'checking'],[/ဖွင့်နေပါသည်/g,'opening']
  ] : [
    [/Cloud save started…/gi,'Cloud Save စတင်နေပါသည်…'],[/Cloud save successful/gi,'Cloud Save အောင်မြင်ပါပြီ'],[/Login successful\.?/gi,'Login အောင်မြင်ပါပြီ။'],[/Account created and signed in\.?/gi,'Account ဖွင့်ပြီး Login ဝင်ထားပါပြီ။'],[/No records/gi,'စာရင်းမရှိသေးပါ'],[/not selected/gi,'မရွေးရသေးပါ'],[/failed/gi,'မအောင်မြင်ပါ'],[/completed/gi,'ပြီးပါပြီ'],[/Saving…/g,'သိမ်းနေသည်…']
  ];
  for(const [re,repl] of rules) s=s.replace(re,repl); return s;
}

const __v2dNativeConfirm=window.confirm.bind(window);
const __v2dNativeAlert=window.alert.bind(window);
window.confirm=(message)=>__v2dNativeConfirm(translateUiMessage(message));
window.alert=(message)=>__v2dNativeAlert(translateUiMessage(message));
function shouldSkipUiTranslation(node){
  const p=node.parentElement; if(!p) return true;
  if(p.closest('script,style,textarea,[data-no-i18n="true"],.workspaceRawText,.sharebox')) return true;
  const td=p.closest('td'); if(td && !p.closest('button')) return true;
  return false;
}
function translateUiTree(root=document){
  const lang=currentUiLang();
  root.querySelectorAll?.('[data-i18n]').forEach(el=>{const key=el.dataset.i18n; const d=I18N[lang]||I18N.my; if(d[key]) el.textContent=d[key];});
  root.querySelectorAll?.('[data-i18n-option]').forEach(el=>{const key=el.dataset.i18nOption; const d=I18N[lang]||I18N.my; if(d[key]) el.textContent=d[key];});
  root.querySelectorAll?.('input[placeholder],textarea[placeholder]').forEach(el=>{ if(el.dataset.noI18n==='true') return; const next=translateLiteralText(el.getAttribute('placeholder')||'',lang); if(next) el.setAttribute('placeholder',next); });
  const walker=document.createTreeWalker(root===document?document.body:root,NodeFilter.SHOW_TEXT);
  const nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node=>{ if(shouldSkipUiTranslation(node)) return; const next=translateLiteralText(node.nodeValue,lang); if(next!==node.nodeValue) node.nodeValue=next; });
  renderLanguageTabs();
}
function renderLanguageTabs(){
  const lang=currentUiLang(); const labels={
    dashboard:['Dashboard','ပင်မ'],entry:['Entry','စာရင်းသွင်း'],records:['Entry Records','စာရင်းမှတ်တမ်း'],limit:['Limit Board','ကန့်သတ်ဘုတ်'],over:['Over','ကျော်နေသောစာရင်း'],reports:['Reports','အစီရင်ခံစာ'],image:['Image','ပုံ / မျှဝေ'],settings:['Settings','ဆက်တင်'],audit:['History','မှတ်တမ်း / Undo'],tests:['Tests','Parser စမ်းသပ်မှု'],diagnostics:['Diagnostics','Error / Version']
  };
  document.querySelectorAll('#tabs .tab[data-id]').forEach(btn=>{const pair=labels[btn.dataset.id]; if(!pair)return; btn.innerHTML=lang==='en'?pair[0]:pair[1];});
}
let uiTranslateObserver=null;
function startUiTranslationObserver(){
  if(uiTranslateObserver) return;
  uiTranslateObserver=new MutationObserver(mutations=>{
    if(window.__V2D_TRANSLATING_UI) return;
    window.__V2D_TRANSLATING_UI=true;
    try{ for(const m of mutations){ for(const n of m.addedNodes||[]){ if(n.nodeType===Node.ELEMENT_NODE) translateUiTree(n); } } }finally{window.__V2D_TRANSLATING_UI=false;}
  });
  const main=document.getElementById('mainApp'); if(main) uiTranslateObserver.observe(main,{childList:true,subtree:true});
}
function setLang(lang){
  lang=lang==='en'?'en':'my'; settings.lang=lang; localStorage.setItem('v2d_ui_language',lang); userSetItem('v2d_settings',JSON.stringify(settings));
  document.documentElement.lang=lang==='en'?'en':'my';
  const sel=document.getElementById('langSelect'); if(sel) sel.value=lang;
  translateUiTree(document); startUiTranslationObserver();
  renderAll(); translateUiTree(document);
}
function resolvedTheme(theme){ if(theme==='system') return window.matchMedia?.('(prefers-color-scheme: light)').matches?'light':'dark'; return theme==='light'?'light':'dark'; }
function applyTheme(theme){
  theme=['light','dark','system'].includes(theme)?theme:'system';
  document.documentElement.dataset.theme=theme; document.documentElement.dataset.resolvedTheme=resolvedTheme(theme);
  const sel=document.getElementById('themeSelect'); if(sel) sel.value=theme;
}
function setTheme(theme){
  theme=['light','dark','system'].includes(theme)?theme:'system'; settings.theme=theme; localStorage.setItem('v2d_ui_theme',theme); userSetItem('v2d_settings',JSON.stringify(settings)); applyTheme(theme);
}
if(window.matchMedia){ const mq=window.matchMedia('(prefers-color-scheme: light)'); mq.addEventListener?.('change',()=>{if((settings?.theme||localStorage.getItem('v2d_ui_theme')||'system')==='system') applyTheme('system');}); }

function renderDashboard(){
  const t=today(); const am=filterRecords(t,'AM').reduce((a,b)=>a+b.amount,0); const pm=filterRecords(t,'PM').reduce((a,b)=>a+b.amount,0); setText('dashToday',money(am+pm)); setText('dashAM',money(am)); setText('dashPM',money(pm));
  document.getElementById('latestRows').innerHTML=records.slice(-30).reverse().map(r=>`<tr><td>${r.date}</td><td>${r.session}</td><td>${escapeHtml(r.name||'Default')}</td><td>${r.cardNumber?`#${r.cardNumber}`:'-'}</td><td>${escapeHtml(normalizeWriterProfile(r.writerProfile||'AUTO'))}</td><td><b>${r.number}</b></td><td class="right">${money(r.amount)}</td><td>${escapeHtml(r.source)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No records</td></tr>';
}

function jsArg(s){return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");}
function getBatchId(r){ return r.batchId || ('LEGACY-'+String(r.ts||0)); }
function getGroupId(r){ return r.groupId || (getBatchId(r)+'__'+(r.name||'Default')+'__'+String(r.source||'')); }
function batchLabel(r){ return getBatchId(r).replace(/^LEGACY-/,'L-').slice(-8); }
function rawTextForBatch(row){
  if(!row) return '';
  return row.batchRawText || records.find(r=>getBatchId(r)===getBatchId(row) && r.batchRawText)?.batchRawText || '';
}
function rawTextForCard(row){
  if(!row) return '';
  return row.cardRawText || (row.cardId?records.find(r=>r.cardId===row.cardId && r.cardRawText)?.cardRawText:'') || '';
}
function transferRawTextBeforeRowDelete(row){
  if(!row) return;
  if(row.cardRawText && row.cardId){
    const next=records.find(r=>r.id!==row.id && r.cardId===row.cardId);
    if(next && !next.cardRawText) next.cardRawText=row.cardRawText;
  }
  if(row.batchRawText){
    const next=records.find(r=>r.id!==row.id && getBatchId(r)===getBatchId(row));
    if(next && !next.batchRawText) next.batchRawText=row.batchRawText;
  }
}
function recordFilteredRows(){
  const date=val('recordDate')||today(), session=val('recordSession')||'AM', name=val('recordName')||'ALL', q=(val('recordSearch')||'').toLowerCase().trim();
  return records.filter(r=>{
    const okDate=r.date===date;
    const okSession=session==='DAILY' || r.session===session;
    const okName=name==='ALL' || (r.name||'Default')===name;
    const blob=((r.name||'')+' '+(r.number||'')+' '+(r.amount||'')+' '+(r.source||'')+' '+(r.type||'')+' '+getBatchId(r)+' card '+(r.cardNumber||'')+' '+(r.cardTime||'')).toLowerCase();
    return okDate && okSession && okName && (!q || blob.includes(q));
  }).sort((a,b)=>(a.ts||0)-(b.ts||0));
}

function cardNavigatorBaseRows(){
  const date=val('recordDate')||today();
  const session=val('recordSession')||'AM';
  const name=val('recordName')||'ALL';
  return records.filter(r=>{
    if(!r.cardId) return false;
    const okDate=(r.date||'')===date;
    const okSession=session==='DAILY' || r.session===session;
    const okName=name==='ALL' || (r.name||'Default')===name;
    return okDate && okSession && okName;
  });
}
function buildCardNavigatorCards(applySearch=true){
  const map=new Map();
  cardNavigatorBaseRows().forEach(r=>{
    const key=r.cardId;
    if(!map.has(key)){
      map.set(key,{
        cardId:key,
        cardNumber:Number(r.cardNumber||0)||0,
        name:r.name||'Default',
        date:r.date||'',
        session:r.session||'',
        time:r.cardTime||'',
        batchId:getBatchId(r),
        ts:Number(r.ts||0)||0,
        rows:[],
        total:0,
        rawText:'',
        edited:false
      });
    }
    const card=map.get(key);
    card.rows.push(r);
    card.total+=Number(r.amount||0);
    if(!card.rawText && r.cardRawText) card.rawText=String(r.cardRawText||'');
    if(r.editedAt) card.edited=true;
    if(!card.time && r.cardTime) card.time=r.cardTime;
    if(!card.cardNumber && r.cardNumber) card.cardNumber=Number(r.cardNumber||0)||0;
    card.ts=Math.min(card.ts||Number(r.ts||0)||0,Number(r.ts||0)||0) || Number(r.ts||0)||0;
  });
  let cards=[...map.values()].map(card=>{
    card.rows.sort((a,b)=>(a.cardSourceLine||0)-(b.cardSourceLine||0)||(a.ts||0)-(b.ts||0));
    if(!card.rawText && card.rows.length) card.rawText=rawTextForCard(card.rows[0]);
    if(!card.rawText){
      const seen=new Set();
      card.rawText=card.rows.map(r=>String(r.source||'').trim()).filter(src=>src&&!seen.has(src)&&seen.add(src)).join('\n');
    }
    card.searchBlob=[card.name,`#${card.cardNumber}`,`card ${card.cardNumber}`,card.time,card.date,card.session,card.rawText,...card.rows.flatMap(r=>[r.number,r.amount,r.source,r.type])].join(' ').toLowerCase();
    return card;
  }).sort((a,b)=>{
    const nameCompare=(a.name||'').localeCompare(b.name||'');
    if(nameCompare) return nameCompare;
    if((a.cardNumber||0)!==(b.cardNumber||0)) return (a.cardNumber||0)-(b.cardNumber||0);
    return (a.ts||0)-(b.ts||0);
  });
  if(applySearch){
    const q=(val('cardNavigatorSearch')||'').trim().toLowerCase();
    if(q) cards=cards.filter(card=>card.searchBlob.includes(q));
  }
  return cards;
}
function setCardNavigatorActionState(enabled){
  ['selectedCardEditBtn','selectedCardCopyBtn','selectedCardDeleteBtn'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.disabled=!enabled;
  });
}
function renderCardNavigator(){
  const list=document.getElementById('cardNavigatorList');
  if(!list) return;
  const cards=buildCardNavigatorCards(true);
  setText('navCardCount',cards.length);
  setText('cardNavigatorListHint',`${cards.length} cards`);
  if(!cards.some(card=>card.cardId===currentSelectedCardId)) currentSelectedCardId=cards[0]?.cardId||'';

  let lastName='';
  const listHtml=[];
  cards.forEach(card=>{
    if((val('recordName')||'ALL')==='ALL' && card.name!==lastName){
      lastName=card.name;
      listHtml.push(`<div class="cardNavNameGroup">${escapeHtml(card.name)}</div>`);
    }
    const active=card.cardId===currentSelectedCardId?' active':'';
    const statusClass=!card.rawText?'review':(card.edited?'edited':'saved');
    const statusText=!card.rawText?'Raw Missing':(card.edited?'Edited':'Saved');
    listHtml.push(`<button class="cardNavItem${active}" onclick="selectCardNavigator('${jsArg(card.cardId)}')">
      <span class="cardNavTop"><b>#${card.cardNumber||'-'}</b><span>${escapeHtml(card.time||'-')}</span></span>
      <span class="cardNavSub"><span>${card.rows.length} rows</span><strong>${money(card.total)}</strong></span>
      <span class="cardNavStatus ${statusClass}">${statusText}</span>
    </button>`);
  });
  list.innerHTML=listHtml.join('')||'<div class="cardNavigatorEmpty">ရွေးထားသော Date / Session / Name အတွက် Card မရှိသေးပါ</div>';

  const card=cards.find(x=>x.cardId===currentSelectedCardId)||null;
  if(!card){
    setText('navSelectedRows','0');
    setText('navSelectedTotal','0');
    setText('navSelectedTime','-');
    setText('selectedCardTitle','Card မရွေးရသေးပါ');
    setText('selectedCardMeta','ကတ်စာရင်းမှ တစ်ကတ်ရွေးပါ');
    const raw=document.getElementById('selectedCardRawText'); if(raw) raw.textContent='ကတ်မရွေးရသေးပါ';
    const tbody=document.getElementById('selectedCardRowsTable'); if(tbody) tbody.innerHTML='<tr><td colspan="6" class="muted">ကတ်တစ်ကတ်ရွေးပါ</td></tr>';
    setCardNavigatorActionState(false);
    return;
  }

  setCardNavigatorActionState(true);
  setText('navSelectedRows',card.rows.length);
  setText('navSelectedTotal',money(card.total));
  setText('navSelectedTime',card.time||'-');
  setText('selectedCardTitle',`${card.name} — Card #${card.cardNumber||'-'}`);
  setText('selectedCardMeta',`${card.date} · ${card.session} · Viber ${card.time||'-'} · Batch ${batchLabel(card.rows[0]||{})}`);
  const raw=document.getElementById('selectedCardRawText');
  if(raw) raw.textContent=card.rawText||'Raw Viber text မရှိပါ';
  const tbody=document.getElementById('selectedCardRowsTable');
  if(tbody){
    tbody.innerHTML=card.rows.map((r,i)=>`<tr class="${r.editedAt?'editedCardRow':''}"><td>${i+1}</td><td><b>${r.number}</b></td><td class="right">${money(r.amount)}</td><td>${escapeHtml(r.type||'')}</td><td>${escapeHtml(r.source||'')}</td><td><button class="actionBtn edit" onclick="editEntryRecord('${jsArg(r.id||'')}')">Row Edit</button></td></tr>`).join('')||'<tr><td colspan="6" class="muted">Record မရှိပါ</td></tr>';
  }
}
function selectCardNavigator(cardId){
  currentSelectedCardId=String(cardId||'');
  renderCardNavigator();
}
function openCardFromRecord(id){
  const row=records.find(r=>r.id===id);
  if(!row||!row.cardId){showToast('Card မတွေ့ပါ');return;}
  currentSelectedCardId=row.cardId;
  go('records');
  renderCardNavigator();
  setTimeout(()=>document.getElementById('cardNavigatorShell')?.scrollIntoView({behavior:'smooth',block:'start'}),60);
}
function selectedNavigatorCard(){
  return buildCardNavigatorCards(false).find(card=>card.cardId===currentSelectedCardId)||null;
}
function navigateSelectedCard(delta){
  const cards=buildCardNavigatorCards(true);
  if(!cards.length){showToast(currentUiLang()==='en'?'No cards':'Card မရှိပါ');return;}
  let index=cards.findIndex(card=>card.cardId===currentSelectedCardId);
  if(index<0) index=0;
  const next=index+Number(delta||0);
  if(next<0||next>=cards.length){showToast(next<0?'ပထမ Card ရောက်နေပါပြီ':'နောက်ဆုံး Card ရောက်နေပါပြီ');return;}
  currentSelectedCardId=cards[next].cardId;
  renderCardNavigator();
}
function openSelectedCardEdit(){
  const card=selectedNavigatorCard();
  if(!card||!card.rows.length){showToast(currentUiLang()==='en'?'No card available to edit':'Edit လုပ်မည့် Card မရှိပါ');return;}
  openGroupEditByRecord(card.rows[0].id);
}
function copySelectedCardText(){
  const card=selectedNavigatorCard();
  if(!card){showToast(currentUiLang()==='en'?'No card selected':'Card မရွေးရသေးပါ');return;}
  copyText(card.rawText||card.rows.map(r=>r.source||'').filter(Boolean).join('\n'));
}
function deleteSelectedCard(){
  const card=selectedNavigatorCard();
  if(!card){showToast(currentUiLang()==='en'?'No card selected':'Card မရွေးရသေးပါ');return;}
  if(!confirm(`${card.name} Card #${card.cardNumber||'-'} (${card.rows.length} rows / ${money(card.total)}) ကို အပြီးဖျက်မလား?`)) return;
  snapshotBeforeChange('Delete Card',{name:card.name,date:card.date,session:card.session,cardNumber:card.cardNumber});
  const raw=card.rawText||'';
  records=records.filter(r=>r.cardId!==card.cardId);
  currentSelectedCardId='';
  saveRecords();
  saveCloudSnapshot(false);
  pushAudit('DELETE_CARD',{label:`${card.name} Card #${card.cardNumber||'-'}`,summary:`${card.rows.length} rows / ${money(card.total)} ဖျက်ပြီး`,name:card.name,date:card.date,session:card.session,rawText:raw});
  renderAll();
  showToast('Card ဖျက်ပြီး Cloud Sync လုပ်နေပါသည်');
}
function scheduleGroupEditPreview(){
  clearTimeout(groupEditPreviewTimer);
  groupEditPreviewTimer=setTimeout(renderGroupEditPreview,180);
}
function renderGroupEditPreview(){
  const body=document.getElementById('groupEditPreviewRows');
  if(!body) return;
  if(!currentGroupEdit){
    body.innerHTML='<tr><td colspan="5" class="muted">Edit modal မဖွင့်ရသေးပါ</td></tr>';
    return;
  }
  const name=(val('groupEditName')||'Default').trim()||'Default';
  const writer=normalizeWriterProfile(val('groupEditWriter')||currentGroupEdit.writerProfile||'AUTO');
  const text=val('groupEditText').trim();
  if(!text){
    setText('groupEditPreviewRowCount','0');setText('groupEditPreviewTotal','0');setText('groupEditPreviewCardCount','0');setText('groupEditPreviewWarningCount','1');
    setText('groupEditPreviewWarning','Source Text မရှိပါ');
    body.innerHTML='<tr><td colspan="5" class="muted">Source Text ထည့်ပါ</td></tr>';
    return;
  }
  let parsed;
  try{ parsed=parseMessage(text,name,writer); }
  catch(error){
    setText('groupEditPreviewWarning',`Preview Error: ${error?.message||error}`);
    setText('groupEditPreviewWarningCount','1');
    body.innerHTML='<tr><td colspan="5" class="muted">Preview မလုပ်နိုင်ပါ</td></tr>';
    return;
  }
  const rows=parsed.detailRows||[];
  const warningList=[...(parsed.warnings||[]),...(parsed.issues||[]).map(x=>x.message||x.raw||'Review required')];
  setText('groupEditPreviewRowCount',rows.length);
  setText('groupEditPreviewTotal',money(rows.reduce((sum,r)=>sum+Number(r.amount||0),0)));
  setText('groupEditPreviewCardCount',rows.length?((parsed.cards||[]).length||1):0);
  setText('groupEditPreviewWarningCount',warningList.length);
  setText('groupEditPreviewWarning',warningList.length?warningList.slice(0,3).join(' · '):'Preview OK — Apply မလုပ်ခင် Rows နှင့် Total ကိုစစ်ပါ။');
  body.innerHTML=rows.slice(0,300).map((r,i)=>`<tr><td>${i+1}</td><td><b>${r.number}</b></td><td class="right">${money(r.amount)}</td><td>${escapeHtml(r.type||'')}</td><td>${escapeHtml(r.source||'')}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">Parse result မရှိပါ</td></tr>';
}

function renderEntryRecords(){
  if(!document.getElementById('entryRecordRows')) return;
  const rows=recordFilteredRows();
  const mode=val('recordViewMode')||'TIME';
  setText('recordRowsCount',rows.length);
  setText('recordRowsTotal',money(rows.reduce((s,r)=>s+Number(r.amount||0),0)));
  setText('recordNamesCount',new Set(rows.map(r=>r.name||'Default')).size);
  let html='';
  if(mode==='NAME'){
    const groups={}; rows.forEach(r=>{const n=r.name||'Default'; (groups[n] ||= []).push(r);});
    let no=1;
    Object.keys(groups).sort().forEach(name=>{
      const g=groups[name], total=g.reduce((s,r)=>s+Number(r.amount||0),0);
      html += `<tr class="recordHeaderRow"><td colspan="14">${escapeHtml(name)} — ${g.length} rows — Total ${money(total)}</td></tr>`;
      g.forEach(r=>{html += entryRecordRowHtml(r,no++);});
    });
  }else{
    html = rows.map((r,i)=>entryRecordRowHtml(r,i+1)).join('');
  }
  document.getElementById('entryRecordRows').innerHTML = html || '<tr><td colspan="14" class="muted">Record မရှိသေးပါ</td></tr>';
  renderCardNavigator();
}
function entryRecordRowHtml(r,no){
  const t=r.ts?new Date(r.ts).toLocaleTimeString(): '-';
  const id=jsArg(r.id||'');
  const cardActions=r.cardId
    ? `<button class="actionBtn openCard" onclick="openCardFromRecord('${id}')">Open Card</button><button class="actionBtn edit" onclick="openGroupEditByRecord('${id}')">Card Edit</button>`
    : `<button class="actionBtn edit" onclick="openGroupEditByRecord('${id}')">Group Edit</button>`;
  return `<tr class="${r.editedAt?'editedCardRow':''}"><td>${no}</td><td>${t}</td><td>${r.date||''}</td><td>${r.session||''}</td><td>${escapeHtml(r.name||'Default')}</td><td><span class="cardNoBadge">${r.cardNumber?`#${r.cardNumber}`:'Legacy'}</span></td><td>${escapeHtml(r.cardTime||'-')}</td><td>${escapeHtml(normalizeWriterProfile(r.writerProfile||'AUTO'))}</td><td><span class="miniBadge">${escapeHtml(batchLabel(r))}</span></td><td><b>${r.number}</b></td><td class="right">${money(r.amount)}</td><td>${escapeHtml(r.type||'')}</td><td>${escapeHtml(r.source||'')}</td><td class="nowrap"><button class="actionBtn edit" onclick="editEntryRecord('${id}')">Row Edit</button>${cardActions}<button class="actionBtn del" onclick="deleteEntryBatch('${id}')">Paste Batch ဖျက်</button><button class="actionBtn del" onclick="deleteEntryRecord('${id}')">Row ဖျက်</button></td></tr>`;
}
function editEntryRecord(id){
  const i=records.findIndex(r=>r.id===id); if(i<0){showToast('Record မတွေ့ပါ');return;}
  const r=records[i];
  const name=prompt('Name ပြင်ရန်', r.name||'Default'); if(name===null) return;
  const number=prompt('Number ပြင်ရန်', r.number||''); if(number===null) return;
  const amount=prompt('Amount ပြင်ရန်', r.amount||''); if(amount===null) return;
  const date=prompt('Date ပြင်ရန် YYYY-MM-DD', r.date||today()); if(date===null) return;
  const session=prompt('Session ပြင်ရန် AM / PM', r.session||'AM'); if(session===null) return;
  if(!/^\d{2}$/.test(String(number).padStart(2,'0').slice(-2))){showToast('Number မမှန်ပါ'); return;}
  const amt=Number(String(amount).replace(/[^\d]/g,'')); if(!amt){showToast('Amount မမှန်ပါ'); return;}
  snapshotBeforeChange('Edit Entry Record', {name:r.name||'Default', number:r.number});
  records[i]={...r,name:name.trim()||'Default',number:String(number).padStart(2,'0').slice(-2),amount:amt,date:date.trim()||today(),session:(session.toUpperCase().startsWith('P')?'PM':'AM'),editedAt:Date.now()};
  saveRecords(); saveCloudSnapshot(false); pushAudit('EDIT_ROW',{label:`${r.number} → ${String(number).padStart(2,'0').slice(-2)}`,summary:'Row edit ပြီးပါပြီ',name:name.trim()||'Default',date:date.trim()||today(),session:(session.toUpperCase().startsWith('P')?'PM':'AM'),rawText:rawTextForBatch(r)}); renderAll(); showToast('Edited + Cloud Sync');
}
function openGroupEditByRecord(id){
  const row = records.find(r=>r.id===id);
  if(!row){showToast('Group မတွေ့ပါ'); return;}
  const batchId=getBatchId(row), rowName=row.name||'Default';
  const isCard=!!row.cardId;
  const same = records.filter(r=>isCard ? r.cardId===row.cardId : (getBatchId(r)===batchId && (r.name||'Default')===rowName && r.date===row.date && r.session===row.session)).sort((a,b)=>(a.cardSourceLine||0)-(b.cardSourceLine||0) || (a.ts||0)-(b.ts||0));
  const seen=new Set(); const lines=[];
  const savedCardRaw=rawTextForCard(row);
  if(isCard && savedCardRaw){
    lines.push(savedCardRaw);
  }else{
    same.forEach(r=>{
      const src=String(r.source||'').trim();
      if(src && !seen.has(src)){ seen.add(src); lines.push(src); }
    });
  }
  currentGroupEdit = {scope:isCard?'CARD':'BATCH',cardId:row.cardId||'',cardNumber:Number(row.cardNumber||0)||0,cardTime:row.cardTime||'',cardHeaderStamp:row.cardHeaderStamp||'',cardHeaderName:row.cardHeaderName||'',cardIndexInBatch:Number(row.cardIndexInBatch||0)||0,batchId, oldName:rowName, oldDate:row.date, oldSession:row.session, ts:row.ts||Date.now(), writerProfile: normalizeWriterProfile(row.writerProfile||'AUTO')};
  setText('groupEditTitle',isCard?`Card Edit #${row.cardNumber||'-'} / ကတ်ပြင်ရန်`:'Group Edit / Batch Edit');
  setText('groupEditHelp',isCard?'ရွေးထားသော Viber Card တစ်ကတ်တည်းကို ပြင်ပြီး ပြန် Parse/Save လုပ်မယ်။ အခြားကတ်များ မထိခိုက်ပါ။':'ဒီ box ထဲမှာ batch/group source text ကို ပြင်လိုက်တာနဲ့ သက်ဆိုင်ရာ row တွေအကုန်တခါတည်းချိန်းပေးမယ်။');
  setVal('groupEditName', rowName);
  setVal('groupEditDate', row.date||today());
  setVal('groupEditSession', row.session||'AM');
  setVal('groupEditWriter', normalizeWriterProfile(row.writerProfile||'AUTO'));
  setVal('groupEditText', lines.join('\n'));
  setText('groupEditCardMeta',isCard?`${rowName} · ${row.date||''} ${row.session||''} · Card #${row.cardNumber||'-'} · Viber ${row.cardTime||'-'} · ${same.length} rows`:`${rowName} · ${row.date||''} ${row.session||''} · Paste Batch ${batchLabel(row)} · ${same.length} rows`);
  document.getElementById('groupEditModal').classList.add('show');
  renderGroupEditPreview();
}
function closeGroupEditModal(){
  currentGroupEdit = null;
  clearTimeout(groupEditPreviewTimer);
  const modal=document.getElementById('groupEditModal');
  if(modal) modal.classList.remove('show');
  setText('groupEditPreviewRowCount','0');
  setText('groupEditPreviewTotal','0');
  setText('groupEditPreviewCardCount','0');
  setText('groupEditPreviewWarningCount','0');
}
function applyGroupEdit(){
  if(!currentGroupEdit){ showToast('Group state မရှိပါ'); return; }
  const name = (val('groupEditName')||'Default').trim() || 'Default';
  const date = val('groupEditDate')||today();
  const session = (val('groupEditSession')||'AM').toUpperCase().startsWith('P') ? 'PM' : 'AM';
  const writerProfile = normalizeWriterProfile(val('groupEditWriter') || currentGroupEdit.writerProfile || 'AUTO');
  const text = val('groupEditText').trim();
  const parsed = parseMessage(text, name, writerProfile);
  if(!parsed.detailRows.length){ showToast('Group text ကို parse မလုပ်နိုင်ပါ'); return; }
  if(currentGroupEdit.scope==='CARD' && (parsed.cards||[]).length>1){ showToast('Card Edit မှာ Viber Header တစ်ခုသာထားပါ','error',6000); return; }

  const isCard=currentGroupEdit.scope==='CARD';
  snapshotBeforeChange(isCard?'Card Edit':'Group Edit', {name:currentGroupEdit.oldName, date:currentGroupEdit.oldDate, session:currentGroupEdit.oldSession, cardNumber:currentGroupEdit.cardNumber||0});
  records = records.filter(r=>isCard ? r.cardId!==currentGroupEdit.cardId : !(getBatchId(r)===currentGroupEdit.batchId && (r.name||'Default')===currentGroupEdit.oldName && r.date===currentGroupEdit.oldDate && r.session===currentGroupEdit.oldSession));
  const sameTarget=name===currentGroupEdit.oldName && date===currentGroupEdit.oldDate && session===currentGroupEdit.oldSession;
  const cardNumber=isCard?(sameTarget?currentGroupEdit.cardNumber:maxExistingCardNumber(name,date,session)+1):0;
  const cardId=isCard?currentGroupEdit.cardId:'';
  parsed.detailRows.forEach((r,editIndex)=>{
    const rowName = isCard ? name : (r.name || name);
    const finalCardId=isCard?cardId:(r.cardId||'');
    const groupId = `${finalCardId||currentGroupEdit.batchId}__${rowName}__${String(r.source||'').trim()}`;
    records.push({...r, name:rowName, date, session, ts:currentGroupEdit.ts, batchId:currentGroupEdit.batchId, groupId, writerProfile,cardId:finalCardId,cardNumber:isCard?cardNumber:(r.cardNumber||0),cardIndexInBatch:isCard?currentGroupEdit.cardIndexInBatch:(r.cardIndexInPaste||0),cardTime:isCard?(r.cardTime||currentGroupEdit.cardTime||''):(r.cardTime||''),cardHeaderStamp:isCard?(r.cardHeaderStamp||currentGroupEdit.cardHeaderStamp||''):(r.cardHeaderStamp||''),cardHeaderName:isCard?(r.cardHeaderName||currentGroupEdit.cardHeaderName||''):(r.cardHeaderName||''),cardRawText:editIndex===0?text:'', id:crypto.randomUUID?crypto.randomUUID():String(currentGroupEdit.ts)+Math.random(), editedAt:Date.now()});
  });
  if(isCard){
    currentSelectedCardId=cardId;
    setVal('recordDate',date);
    setVal('recordSession',session);
    setVal('recordName',name);
  }
  saveRecords();
  saveCloudSnapshot(false);
  pushAudit(isCard?'CARD_EDIT':'GROUP_EDIT',{label:isCard?`${name} Card #${cardNumber}`:`${name} ${date} ${session}`,summary:`${isCard?'Card':'Group'} Edit ${parsed.detailRows.length} rows`,name,date,session,rawText:text});
  closeGroupEditModal();
  renderAll();
  showToast(`${isCard?'Card':'Group'} Edit + Cloud Sync`);
}
function deleteEntryRecord(id){
  const i=records.findIndex(r=>r.id===id); if(i<0){showToast('Record မတွေ့ပါ');return;}
  const r=records[i]; if(!confirm(`${r.name||'Default'} | ${r.number} | ${money(r.amount)} ကို ဖျက်မလား?`)) return;
  snapshotBeforeChange('Delete Entry Record', {name:r.name||'Default', number:r.number});
  transferRawTextBeforeRowDelete(r);
  records.splice(i,1); saveRecords(); saveCloudSnapshot(false); pushAudit('DELETE_ROW',{label:`${r.name||'Default'} ${r.number}`,summary:`${money(r.amount)} ဖျက်ပြီး`,name:r.name||'Default',date:r.date||'',session:r.session||'',rawText:rawTextForBatch(r)}); renderAll(); showToast('Deleted + Cloud Sync');
}
function deleteEntryBatch(id){
  const row = records.find(r=>r.id===id); if(!row){showToast('Batch မတွေ့ပါ'); return;}
  const batchId=getBatchId(row);
  const sameRows = records.filter(r=>getBatchId(r)===batchId && r.date===row.date && r.session===row.session);
  const count = sameRows.length;
  if(!confirm(`Batch ${batchLabel(row)} မှာ ${count} rows ရှိတယ်။ တစ်ခါတည်းဖျက်မလား?`)) return;
  snapshotBeforeChange('Delete Entry Batch', {batch:batchLabel(row), count});
  records = records.filter(r=>!(getBatchId(r)===batchId && r.date===row.date && r.session===row.session));
  saveRecords(); saveCloudSnapshot(false); pushAudit('DELETE_BATCH',{label:batchLabel(row),summary:`Batch ${count} rows ဖျက်ပြီး`,names:collectNamesFromRows(sameRows),date:row.date||'',session:row.session||'',rawText:rawTextForBatch(row)}); renderAll(); showToast('Batch Deleted + Cloud Sync');
}
function deleteFilteredNameRows(){
  const date=val('recordDate')||today(), session=val('recordSession')||'AM', name=val('recordName')||'ALL';
  if(name==='ALL'){ showToast('Name တစ်ခုရွေးပြီးမှ Delete Filtered Name လုပ်ပါ'); return; }
  const deletedRows = records.filter(r=>r.date===date && (session==='DAILY' || r.session===session) && (r.name||'Default')===name);
  const count = deletedRows.length;
  if(!count){ showToast('ဖျက်ရန် row မရှိပါ'); return; }
  if(!confirm(`${date} ${session} ${name} rows ${count} ကြောင်းကို ဖျက်မလား?`)) return;
  snapshotBeforeChange('Delete Filtered Name Rows', {name, date, session, count});
  records = records.filter(r=>!(r.date===date && (session==='DAILY' || r.session===session) && (r.name||'Default')===name));
  saveRecords(); saveCloudSnapshot(false); pushAudit('DELETE_FILTERED_NAME',{label:`${name} ${date} ${session}`,summary:`Filtered rows ${count} ကြောင်းဖျက်ပြီး`,name,date,session,rawText:rawTextForBatch(deletedRows[0])}); renderAll(); showToast('Filtered Name Rows Deleted + Cloud Sync');
}
function copyEntryRecordsText(){
  const rows=recordFilteredRows();
  if(!rows.length){showToast('Copy လုပ်ရန် record မရှိပါ'); return;}
  const lines=[`Entry Records ${val('recordDate')||today()} ${val('recordSession')||'AM'} ${val('recordName')||'ALL'}`,'Time | Name | Card | Card Time | Writer | Batch | Number | Amount | Source'];
  rows.forEach(r=>lines.push(`${r.ts?new Date(r.ts).toLocaleTimeString():'-'} | ${r.name||'Default'} | ${r.cardNumber?`#${r.cardNumber}`:'Legacy'} | ${r.cardTime||'-'} | ${normalizeWriterProfile(r.writerProfile||'AUTO')} | ${batchLabel(r)} | ${r.number} | ${money(r.amount)} | ${r.source||''}`));
  lines.push('Total = '+money(rows.reduce((s,r)=>s+Number(r.amount||0),0)));
  copyText(lines.join('\n'));
}


const APP_VERSION='4.3.0';
const APP_VERSION_LABEL='Stage 4.3.0 Language + Theme';
const APP_LOADED_AT=Date.now();
let runtimeErrors=JSON.parse(userGetItem('v2d_runtime_errors')||'[]');
let lastDiagnosticsText='';

function saveRuntimeErrors(){
  runtimeErrors=(runtimeErrors||[]).slice(0,50);
  try{userSetItem('v2d_runtime_errors',JSON.stringify(runtimeErrors));}catch(_e){}
}
function addRuntimeError(type,message,source='',line=0,column=0,stack=''){
  runtimeErrors.unshift({
    ts:Date.now(),
    type:String(type||'ERROR'),
    message:String(message||'Unknown error'),
    source:String(source||''),
    line:Number(line||0),
    column:Number(column||0),
    stack:String(stack||'').slice(0,3000)
  });
  saveRuntimeErrors();
  renderDiagnostics();
}
window.addEventListener('error',event=>{
  addRuntimeError('WINDOW_ERROR',event.message,event.filename,event.lineno,event.colno,event.error?.stack||'');
});
window.addEventListener('unhandledrejection',event=>{
  const reason=event.reason;
  addRuntimeError('UNHANDLED_PROMISE',reason?.message||String(reason||'Promise rejected'),'','','',reason?.stack||'');
});

let lastParserTestText='';

function normalizeTestRows(rows){
  return (rows||[]).map(r=>`${String(r.number).padStart(2,'0')}:${Number(r.amount||0)}`).sort();
}
function sameTestArray(a,b){
  return JSON.stringify([...(a||[])].sort())===JSON.stringify([...(b||[])].sort());
}
function parserRowTest(name,input,expected){
  try{
    const result=parseMessage(input,'Regression','AUTO');
    const actual=normalizeTestRows(result.detailRows);
    const pass=sameTestArray(actual,expected);
    return {name,pass,expected:[...expected].sort(),actual,warnings:result.warnings||[]};
  }catch(err){
    return {name,pass:false,expected:[...expected].sort(),actual:[],error:String(err?.message||err)};
  }
}
function parserBooleanTest(name,actual,expected){
  const pass=actual===expected;
  return {name,pass,expected:[String(expected)],actual:[String(actual)]};
}
function runParserRegressionTests(){
  const tests=[];

  tests.push(parserRowTest(
    'Hyphen separator amount — 47-35-1500',
    '47-35-1500',
    ['47:1500','35:1500']
  ));

  tests.push(parserRowTest(
    'Dot group amount — 11.22.77.00.5000',
    '11.22.77.00.5000',
    ['11:5000','22:5000','77:5000','00:5000']
  ));

  tests.push(parserRowTest(
    'Reverse split amount — 54=1000R500',
    '54=1000R500',
    ['54:1000','45:500']
  ));

  tests.push(parserRowTest(
    'Slash group + reverse — 55/58=1000R500',
    '55/58=1000R500',
    ['55:1000','55:500','58:1000','85:500']
  ));

  tests.push(parserRowTest(
    'Multi group reverse — 50/51/52=500R300',
    '50/51/52=500R300',
    ['50:500','05:300','51:500','15:300','52:500','25:300']
  ));

  tests.push(parserRowTest(
    'Forward carry inside one message block',
    '63=500R200\n64\n65\n67\n97\n44=500',
    ['63:500','36:200','64:500','46:200','65:500','56:200','67:500','76:200','97:500','79:200','44:500']
  ));

  tests.push(parserRowTest(
    'Reverse R amount — 67R1500',
    '67R1500',
    ['67:1500','76:1500']
  ));

  tests.push(parserRowTest(
    'Different original/reverse amounts — 40=3000R1000',
    '40=3000R1000',
    ['40:3000','04:1000']
  ));

  const h1200=parseHeaderStampMeta('Tuesday, July 7, 2026 12:00 PM');
  const h1201=parseHeaderStampMeta('Tuesday, July 7, 2026 12:01 PM');
  const h0939=parseHeaderStampMeta('Tuesday, July 7, 2026 9:39 AM');
  tests.push(parserBooleanTest('Header 12:00 PM remains AM',h1200?.session,'AM'));
  tests.push(parserBooleanTest('Header 12:01 PM becomes PM',h1201?.session,'PM'));
  tests.push(parserBooleanTest('Header 9:39 AM becomes AM',h0939?.session,'AM'));

  const noName=parseMessage('47=500','Default','AUTO');
  tests.push(parserBooleanTest('Typing without Name requires selection',noName.needsNameSelection,true));

  const blockA=makeMessageBlockKey('Tuesday, July 7, 2026 9:39 AM','Tester',[{raw:'47=500'}]);
  const blockB=makeMessageBlockKey('Tuesday, July 7, 2026 9:39 AM','Tester',[{raw:'47=500'}]);
  const blockC=makeMessageBlockKey('Tuesday, July 7, 2026 9:39 AM','Tester',[{raw:'48=500'}]);
  tests.push(parserBooleanTest('Same message block creates same duplicate key',blockA===blockB,true));
  tests.push(parserBooleanTest('Different body creates different duplicate key',blockA!==blockC,true));

  const passed=tests.filter(t=>t.pass).length;
  const failed=tests.length-passed;

  setText('parserTestTotal',tests.length);
  setText('parserTestPassed',passed);
  setText('parserTestFailed',failed);

  const status=document.getElementById('parserTestStatus');
  if(status){
    status.innerHTML=failed===0
      ? '<span class="good"><b>ALL PASS</b> — အဟောင်း parser rules အားလုံးမှန်နေပါတယ်။</span>'
      : `<span class="bad"><b>${failed} TEST FAILED</b> — Failed rows ကို copy လုပ်ပြီး မပြင်ခင် စစ်ဆေးပါ။</span>`;
  }

  const box=document.getElementById('parserTestResults');
  if(box){
    box.innerHTML=tests.map((t,i)=>`
      <div class="testResultCard ${t.pass?'testPass':'testFail'}">
        <div><b>${i+1}. ${escapeHtml(t.name)}</b> — <span class="${t.pass?'good':'bad'}">${t.pass?'PASS':'FAIL'}</span></div>
        <pre>Expected: ${escapeHtml((t.expected||[]).join(', '))}
Actual:   ${escapeHtml((t.actual||[]).join(', '))}${t.warnings?.length?`\nWarnings: ${escapeHtml(t.warnings.join(' | '))}`:''}${t.error?`\nError: ${escapeHtml(t.error)}`:''}</pre>
      </div>
    `).join('');
  }

  lastParserTestText=[
    `Viber 2D Desk Parser Regression — ${new Date().toLocaleString()}`,
    `Total ${tests.length} | Passed ${passed} | Failed ${failed}`,
    '',
    ...tests.map((t,i)=>`${i+1}. ${t.pass?'PASS':'FAIL'} — ${t.name}\nExpected: ${(t.expected||[]).join(', ')}\nActual: ${(t.actual||[]).join(', ')}${t.error?`\nError: ${t.error}`:''}`)
  ].join('\n');

  showToast(failed===0?'Parser Tests ALL PASS':'Parser Tests မှာ FAIL ရှိပါတယ်');
}
function copyParserTestResults(){
  if(!lastParserTestText){
    showToast('အရင် Run All Parser Tests လုပ်ပါ');
    return;
  }
  copyText(lastParserTestText);
}
function clearParserTestResults(){
  lastParserTestText='';
  setText('parserTestTotal','0');
  setText('parserTestPassed','0');
  setText('parserTestFailed','0');
  const status=document.getElementById('parserTestStatus');
  const box=document.getElementById('parserTestResults');
  if(status) status.textContent='Run All Parser Tests ကိုနှိပ်ပါ။';
  if(box) box.innerHTML='';
}


function estimateLocalStorageBytes(){
  let total=0;
  try{
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i)||'';
      if(!key.startsWith(USER_STORAGE_PREFIX)) continue;
      const value=localStorage.getItem(key)||'';
      total += (key.length+value.length)*2;
    }
  }catch(_e){}
  return total;
}
function formatBytes(bytes){
  if(bytes<1024) return `${bytes} B`;
  if(bytes<1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1024/1024).toFixed(2)} MB`;
}
function checkVersionState(){
  const previous=userGetItem('v2d_last_version')||'';
  const changed=previous!==APP_VERSION;
  userSetItem('v2d_last_version',APP_VERSION);
  return {previous,current:APP_VERSION,changed};
}
function renderDiagnostics(){
  if(!document.getElementById('diagVersion')) return;
  setText('diagVersion',APP_VERSION);
  setText('diagErrorCount',(runtimeErrors||[]).length);
  setText('diagStorage',formatBytes(estimateLocalStorageBytes()));
  setText('diagLoadedAt',new Date(APP_LOADED_AT).toLocaleString());

  const versionState=checkVersionState();
  const notice=document.getElementById('diagVersionNotice');
  if(notice){
    if(versionState.changed && versionState.previous){
      notice.className='diagLog';
      notice.innerHTML=`<b>Version changed:</b> ${escapeHtml(versionState.previous)} → ${escapeHtml(versionState.current)}<br>Hard Reload ကို တစ်ကြိမ်လုပ်ပြီး feature tests ပြန်စစ်ပါ။`;
    }else{
      notice.className='diagOk';
      notice.innerHTML=`<b>Current version:</b> ${escapeHtml(APP_VERSION_LABEL)}<br>URL: ${escapeHtml(location.href)}`;
    }
  }

  const box=document.getElementById('diagErrorList');
  if(box){
    box.innerHTML=(runtimeErrors||[]).length
      ? runtimeErrors.map((e,i)=>`
        <div class="diagLog">
          <div><b>${i+1}. ${escapeHtml(e.type)}</b> — ${escapeHtml(new Date(e.ts).toLocaleString())}</div>
          <div class="diagCode" style="margin-top:6px">${escapeHtml(e.message)}
${e.source?`Source: ${escapeHtml(e.source)}:${e.line||0}:${e.column||0}`:''}
${e.stack?`\n${escapeHtml(e.stack)}`:''}</div>
        </div>
      `).join('')
      : '<div class="diagOk"><b>No runtime errors</b> — App error log ရှင်းနေပါတယ်။</div>';
  }
}
function runAppSelfCheck(){
  const requiredIds=[
    'entryText','entryName','entryDate','entrySession',
    'reportDate','reportSession','settingsPDate',
    'auditTrailList','parserTestResults','diagErrorList',
    'cardNavigatorList','selectedCardRowsTable','groupEditPreviewRows'
  ];
  const requiredFns=[
    'parseMessage','savePreview','renderReports','restoreJSONBackup',
    'runParserRegressionTests','undoLastAction','saveCloudSnapshot',
    'renderCardNavigator','openSelectedCardEdit','renderGroupEditPreview'
  ];
  const missingIds=requiredIds.filter(id=>!document.getElementById(id));
  const missingFns=requiredFns.filter(name=>typeof window[name]!=='function');

  const checks=[
    {name:'Required page elements',pass:missingIds.length===0,detail:missingIds.length?missingIds.join(', '):'OK'},
    {name:'Required functions',pass:missingFns.length===0,detail:missingFns.length?missingFns.join(', '):'OK'},
    {name:'LocalStorage writable',pass:(()=>{
      try{userSetItem('v2d_diag_test','1');userRemoveItem('v2d_diag_test');return true;}catch(_e){return false;}
    })(),detail:'Write / remove test'},
    {name:'Records array',pass:Array.isArray(records),detail:`${Array.isArray(records)?records.length:0} rows`},
    {name:'Settings object',pass:!!settings && typeof settings==='object' && !Array.isArray(settings),detail:settings?.shopName||'-'},
    {name:'P Number memory',pass:!!pMemory && typeof pMemory==='object' && !Array.isArray(pMemory),detail:`${Object.keys(pMemory||{}).length} entries`},
    {name:'Firebase authenticated user',pass:!!CURRENT_USER?.uid,detail:CURRENT_USER?.email||'No user'},
    {name:'User storage namespace',pass:CURRENT_UID!=='guest',detail:USER_STORAGE_PREFIX},
    {name:'Notice / Toast element',pass:!!document.getElementById('toast'),detail:document.getElementById('toast')?'Ready':'Missing'}
  ];

  const failed=checks.filter(c=>!c.pass);
  const box=document.getElementById('diagSelfCheck');
  if(box){
    box.innerHTML=checks.map(c=>`
      <div class="${c.pass?'diagOk':'diagLog'}">
        <b>${c.pass?'PASS':'FAIL'} — ${escapeHtml(c.name)}</b><br>
        <span class="diagCode">${escapeHtml(c.detail)}</span>
      </div>
    `).join('');
  }

  lastDiagnosticsText=[
    `Viber 2D Desk Diagnostics — ${new Date().toLocaleString()}`,
    `Version: ${APP_VERSION_LABEL}`,
    `URL: ${location.href}`,
    `Storage: ${formatBytes(estimateLocalStorageBytes())}`,
    `Runtime Errors: ${(runtimeErrors||[]).length}`,
    '',
    ...checks.map(c=>`${c.pass?'PASS':'FAIL'} — ${c.name}: ${c.detail}`),
    '',
    ...(runtimeErrors||[]).map((e,i)=>`${i+1}. ${e.type}: ${e.message} ${e.source||''}:${e.line||0}:${e.column||0}`)
  ].join('\n');

  renderDiagnostics();
  showToast(failed.length===0?'App Self Check ALL PASS':`${failed.length} Self Check FAIL`);
}
function copyDiagnosticsReport(){
  if(!lastDiagnosticsText) runAppSelfCheck();
  copyText(lastDiagnosticsText);
}
function clearRuntimeErrors(){
  runtimeErrors=[];
  saveRuntimeErrors();
  renderDiagnostics();
  showToast('Runtime error log cleared');
}
async function hardReloadApp(){
  const ok=confirm('Browser cache, Service Worker cache ရှင်းပြီး App ကို version အသစ်ဖြင့် reload လုပ်မယ်။ ဆက်လုပ်မလား?');
  if(!ok) return;
  try{
    if('caches' in window){
      const keys=await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k)));
    }
    if('serviceWorker' in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
  }catch(err){
    addRuntimeError('CACHE_CLEAR',err?.message||String(err),'hardReloadApp');
  }
  const url=new URL(location.href);
  url.searchParams.set('v',APP_VERSION+'-'+Date.now());
  location.replace(url.toString());
}

function renderAll(){renderDashboard();renderPreview();renderEntryLive();renderLimit();renderOver();renderReports();renderImageText();renderEntryRecords();renderAuditTrail();renderDiagnostics(); if(!window.__V2D_TRANSLATING_UI){window.__V2D_TRANSLATING_UI=true;try{translateUiTree(document);}finally{window.__V2D_TRANSLATING_UI=false;}}}
function setText(id,v){const el=document.getElementById(id); if(el) el.textContent=v;}
function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function go(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.id===id));
  document.body.classList.toggle('entry-sticky', id==='entry');
  if(id==='entry' && topbarState==='collapsed'){
    const box=document.getElementById('imgToolBox');
    if(box) box.classList.remove('compact-open');
  }
  renderMiniTopInfo();
  renderAll();
}
function insertKey(k){const ta=document.getElementById('entryText'); const add=(ta.value && !ta.value.endsWith('\n')?'\n':'')+k+' '; ta.value+=add; ta.focus();}
function copyText(text){navigator.clipboard?.writeText(text).then(()=>showToast('Copied')).catch(()=>showToast('Copy မရပါ'));}
function copyShareText(){copyText(document.getElementById('shareText').textContent)}
function currentOverRows(date,session,name,limit){
  const totals=boardTotalsByNumber(date,session,name);
  return Object.entries(totals).filter(([n,a])=>a>limit).map(([number,amount])=>({number,amount,over:amount-limit}));
}
function applyOverDeduction(date,session,name,rows,reason){
  rows.forEach(r=>overDeductions.push({date,session,name,number:r.number,amount:r.over,reason,ts:Date.now()}));
  saveOverDeductions(); renderAll();
}
function copyOverText(){
  const date=val('overDate')||today(); const session=val('overSession')||'AM'; const name=val('overName')||'ALL'; const limit=Number(val('overLimit')||settings.defaultLimit||10000); const rows=currentOverRows(date,session,name,limit);
  if(!rows.length){showToast('Over မရှိပါ'); return;}
  if(!confirm('Copy Over Text လုပ်ပြီး Limit Board မှ Over amount ကို နုတ်မည်။ သေချာလား?')) return;
  const lines=[`OVER ${date} ${session} ${name}`,'No | Number | Over']; rows.forEach((r,i)=>lines.push(`${i+1}. ${r.number} | ${money(r.over)}`)); lines.push('Total Over: '+money(rows.reduce((s,r)=>s+r.over,0))); copyText(lines.join('\n'));
  applyOverDeduction(date,session,name,rows,'copyText');
}
function saveOverImage(){
  const date=val('overDate')||today(); const session=val('overSession')||'AM'; const name=val('overName')||'ALL'; const limit=Number(val('overLimit')||settings.defaultLimit||10000); const rows=currentOverRows(date,session,name,limit);
  if(!rows.length){showToast('Over မရှိပါ'); return;}
  if(!confirm('Save Image လုပ်ပြီး Limit Board မှ Over amount ကို နုတ်မည်။ သေချာလား?')) return;
  const canvas=document.createElement('canvas'); canvas.width=720; canvas.height=Math.max(260,120+rows.length*34); const c=canvas.getContext('2d');
  c.fillStyle='#0f172a'; c.fillRect(0,0,canvas.width,canvas.height); c.fillStyle='#fff'; c.font='bold 28px Arial'; c.fillText(`OVER ${date} ${session} ${name}`,24,44); c.font='20px Arial'; c.fillStyle='#bbf7d0'; c.fillText('No     Number        Over',24,88); let y=122; c.fillStyle='#e5e7eb'; rows.forEach((r,i)=>{c.fillText(`${i+1}.        ${r.number}             ${money(r.over)}`,24,y); y+=34;}); c.fillStyle='#fca5a5'; c.fillText('Total Over: '+money(rows.reduce((s,r)=>s+r.over,0)),24,y+16);
  const a=document.createElement('a'); a.href=canvas.toDataURL('image/png'); a.download=`over-${date}-${session}-${name}.png`; a.click();
  applyOverDeduction(date,session,name,rows,'saveImage');
}
function currentBackupData(){
  return {
    app:'Viber 2D Desk',
    version:'Stage 4.3.0 Language + Theme',
    user:{uid:CURRENT_UID,email:CURRENT_USER?.email||'',displayName:CURRENT_USER?.displayName||''},
    settings,
    records,
    overDeductions,
    pMemory,
    dealerManualMemory,
    auditTrail,
    undoStack,
    exportedAt:new Date().toISOString()
  };
}
function downloadJSONData(data, filename){
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportJSON(){
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  downloadJSONData(currentBackupData(),`viber-2d-desk-backup-${stamp}.json`);
  showToast('Backup JSON download စတင်ပါပြီ');
}
function restoreJSONBackup(event){
  const input=event?.target;
  const file=input?.files?.[0];
  if(!file) return;

  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const data=JSON.parse(String(reader.result||''));
      if(!data || typeof data!=='object' || Array.isArray(data)){
        throw new Error('JSON object မဟုတ်ပါ');
      }
      if(!data.settings || typeof data.settings!=='object'){
        throw new Error('settings data မပါပါ');
      }
      if(!Array.isArray(data.records)){
        throw new Error('records list မပါပါ');
      }

      const recordCount=data.records.length;
      const overCount=Array.isArray(data.overDeductions)?data.overDeductions.length:0;
      const pCount=data.pMemory && typeof data.pMemory==='object'?Object.keys(data.pMemory).length:0;
      const dealerCount=data.dealerManualMemory && typeof data.dealerManualMemory==='object'?Object.keys(data.dealerManualMemory).length:0;

      const ok=confirm(
        `Restore JSON စစ်ဆေးချက်\n\n`+
        `Records: ${recordCount}\n`+
        `Over: ${overCount}\n`+
        `P Number entries: ${pCount}\n`+
        `Dealer entries: ${dealerCount}\n\n`+
        `လက်ရှိ data ကို auto-backup ထုတ်ပြီး ဒီ backup ဖြင့် အစားထိုးမည်။ ဆက်လုပ်မလား?`
      );
      if(!ok){
        input.value='';
        return;
      }

      const stamp=new Date().toISOString().replace(/[:.]/g,'-');
      downloadJSONData(currentBackupData(),`auto-before-restore-${stamp}.json`);

      settings={...settings,...data.settings};
      records=Array.isArray(data.records)?data.records:[];
      overDeductions=Array.isArray(data.overDeductions)?data.overDeductions:[];
      pMemory=(data.pMemory && typeof data.pMemory==='object' && !Array.isArray(data.pMemory))?data.pMemory:{};
      dealerManualMemory=(data.dealerManualMemory && typeof data.dealerManualMemory==='object' && !Array.isArray(data.dealerManualMemory))?data.dealerManualMemory:{};
      auditTrail=Array.isArray(data.auditTrail)?data.auditTrail:[];
      undoStack=Array.isArray(data.undoStack)?data.undoStack:[];

      userSetItem('v2d_settings',JSON.stringify(settings));
      userSetItem('v2d_records',JSON.stringify(records));
      userSetItem('v2d_over_deductions',JSON.stringify(overDeductions));
      userSetItem('v2d_p_memory',JSON.stringify(pMemory));
      userSetItem('v2d_dealer_manual_memory',JSON.stringify(dealerManualMemory));
      userSetItem('v2d_audit_trail',JSON.stringify(auditTrail.slice(0,120)));
      userSetItem('v2d_undo_stack',JSON.stringify(undoStack.slice(0,8)));
      userSetItem('v2d_force_sync_on_boot','1');

      alert('Restore ပြီးပါပြီ။ App ကို ပြန်ဖွင့်ပြီး Cloud ကို Auto Sync လုပ်ပါမယ်။');
      location.reload();
    }catch(err){
      console.error(err);
      alert('Restore မအောင်မြင်ပါ။ ' + (err?.message||err));
      if(input) input.value='';
    }
  };
  reader.onerror=()=>{
    alert('JSON file ကိုဖတ်မရပါ');
    if(input) input.value='';
  };
  reader.readAsText(file);
}
function clearAllData(){if(confirm('Data အကုန်ဖျက်မှာ သေချာလား?')){snapshotBeforeChange('Clear All Data'); records=[];overDeductions=[];saveRecords();saveOverDeductions(); pushAudit('CLEAR_ALL',{label:'All data cleared',summary:'records နှင့် over data အကုန်ဖျက်ပြီး'}); renderAll();showToast('Cleared');}}
function syncLimitInputs(){const v=settings.defaultLimit||val('defaultLimit')||10000; ['defaultLimit','limitAmount','overLimit','entryLimitAmount'].forEach(id=>setVal(id,v)); renderLimit(); renderOver(); renderEntryLive();}
function syncLimitFrom(v){
  const n=Number(v||0); settings.defaultLimit=n; ['defaultLimit','limitAmount','overLimit','entryLimitAmount'].forEach(id=>setVal(id,n)); saveSettings(); renderLimit(); renderOver(); renderEntryLive();
}
function nameOptions(includeAll=false){
  const names=(settings.names&&settings.names.length?settings.names:['Default']);
  return (includeAll?['ALL',...names]:names).map(n=>`<option value="${escapeHtml(n)}">${n==='ALL'?'All Names':escapeHtml(n)}</option>`).join('');
}
function refreshNameSelects(){
  ['entryName','entryBoardName'].forEach(id=>{const el=document.getElementById(id); if(el){const old=el.value; el.innerHTML=nameOptions(false); if(old) el.value=old;}});
  ['recordName','limitName','overName','reportName','imageName'].forEach(id=>{const el=document.getElementById(id); if(el){const old=el.value; el.innerHTML=nameOptions(true); if(old) el.value=old;}});
  const box=document.getElementById('nameList'); if(box){box.innerHTML=(settings.names||['Default']).map(n=>`<div class="nameRateRow"><b>${escapeHtml(n)}</b><input type="number" value="${settings.nameRates?.[n]??settings.commissionRate??20}" onchange="setNameRate('${String(n).replace(/'/g,"\'")}', this.value)" title="Cor %"><button class="btn danger small" onclick="removeName('${String(n).replace(/'/g,"\'")}')">Remove</button></div>`).join('');}
}
function setNameRate(n,v){ if(!settings.nameRates) settings.nameRates={}; settings.nameRates[n]=Number(v||0); saveSettings(); renderReports(); }
function addName(){
  const n=(val('newName')||'').trim(); if(!n){showToast('Name ထည့်ပါ'); return;}
  settings.names=uniq([...(settings.names||[]), n]); if(!settings.nameRates) settings.nameRates={}; settings.nameRates[n]=settings.nameRates[n]??settings.commissionRate??20; setVal('newName',''); saveSettings(); refreshNameSelects(); renderAll(); showToast('Name Added');
}
function removeName(n){
  if((settings.names||[]).length<=1){showToast('အနည်းဆုံး Name ၁ ခုထားပါ'); return;}
  if(!confirm(n+' ကို ဖယ်မလား?')) return;
  settings.names=(settings.names||[]).filter(x=>x!==n); if(settings.nameRates) delete settings.nameRates[n]; saveSettings(); refreshNameSelects(); renderAll();
}
function init(){
  if(!CURRENT_USER){
    console.error('Authenticated user မရှိဘဲ App init လုပ်မရပါ');
    return;
  }
  const authName=document.getElementById('authUserName');
  const authEmail=document.getElementById('authUserEmail');
  if(authName) authName.textContent=CURRENT_USER.displayName||window.V2D_CURRENT_PROFILE?.displayName||'User';
  if(authEmail) authEmail.textContent=CURRENT_USER.email||'';
  document.querySelectorAll('#tabs .tab').forEach(t=>t.classList.toggle('active', t.dataset.id==='dashboard'));
  ['entryDate','recordDate','limitDate','overDate','reportDate','imageDate'].forEach(id=>setVal(id,today()));
  settings={shopName:(initialRegisteredShopName||'Viber 2D Desk'),commissionRate:20,payoutRate:80,defaultLimit:10000,amClose:'12:00',pmClose:'16:30',names:['Default'],nameRates:{Default:20},lang:'my',...settings}; if(!Array.isArray(settings.names)||!settings.names.length) settings.names=['Default']; if(!settings.nameRates) settings.nameRates={}; settings.names.forEach(n=>{if(settings.nameRates[n]==null) settings.nameRates[n]=settings.commissionRate||20;});
  setVal('shopName',settings.shopName); setVal('commissionRate',settings.commissionRate); setVal('payoutRate',settings.payoutRate); setVal('defaultLimit',settings.defaultLimit); setVal('amClose',settings.amClose); setVal('pmClose',settings.pmClose); syncLimitInputs();
  setVal('settingsPDate', today()); setVal('settingsPSession', 'AM'); loadSettingsPNumber(); loadManualDealerInputs();
  const keys=['A','Z','B','//','//-3355','*2','*12','1*','1ပါ','7ပါတ်ပူးပါ','12*','1234**','12345 အခွေ','3/8ဘရိတ်','2ထိပ် 500 R 200','++','--','+-','-+','/9','9/','+/','-/','/+','/-','+1','-1','1+','1-'];
  document.getElementById('formulaChips').innerHTML=keys.map(k=>`<span class="chip" onclick="go('entry');insertKey('${k}')">${k}</span>`).join('');
  refreshNameSelects();
  applyTheme(settings.theme||'system');
  setLang(settings.lang||'my');
  applyTopbarState();
  renderMiniTopInfo();
  renderAll();
  renderDiagnostics();
}
async function bootstrapCloudFirstApp(){
  await initializeCloudFirstSync();
  init();
  cloudSyncState.uiReady=true;
  setTimeout(()=>flushParserReportQueue(),700);
  if(cloudSyncState.needsInitialUpload || cloudSyncState.dirty){
    setTimeout(()=>flushCloudWorkspace({showMsg:false,reason:'initial-auto-sync'}),350);
  }else{
    setCloudSyncStatus(cloudSyncState.conflictData?'conflict':(navigator.onLine?'synced':'offline'));
  }
  return true;
}
if(CURRENT_USER){
  window.V2D_APP_READY_PROMISE=bootstrapCloudFirstApp().catch(error=>{
    console.error('Cloud-first bootstrap failed',error);
    setCloudSyncStatus('error','App Start Error',error?.message||String(error));
    init();
    cloudSyncState.uiReady=true;
    return false;
  });
}

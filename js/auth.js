const AUTH_UI={
  my:{language:'ဘာသာ',theme:'Theme',login:'ဝင်မည်',register:'အကောင့်ဖွင့်မည်',forgot:'Password မေ့နေသည်',email:'Email',password:'Password',name:'အမည်',shop:'Shop / Workspace အမည်',confirmPassword:'Password အတည်ပြု',loginButton:'ဝင်မည်',registerButton:'အကောင့်ဖွင့်မည်',resetButton:'Reset Email ပို့မည်',system:'System',light:'Light',dark:'Dark'},
  en:{language:'Language',theme:'Theme',login:'Login',register:'Register',forgot:'Forgot Password',email:'Email',password:'Password',name:'Your Name',shop:'Shop / Workspace Name',confirmPassword:'Confirm Password',loginButton:'Login',registerButton:'Create Account',resetButton:'Send Reset Email',system:'System',light:'Light',dark:'Dark'}
};
function authLanguage(){return localStorage.getItem('v2d_ui_language')||'my';}
function authResolvedTheme(theme){if(theme==='system')return window.matchMedia?.('(prefers-color-scheme: light)').matches?'light':'dark';return theme==='light'?'light':'dark';}
function applyAuthTheme(theme){theme=['light','dark','system'].includes(theme)?theme:'system';localStorage.setItem('v2d_ui_theme',theme);document.documentElement.dataset.theme=theme;document.documentElement.dataset.resolvedTheme=authResolvedTheme(theme);const sel=document.getElementById('authThemeSelect');if(sel)sel.value=theme;}
function setAuthTheme(theme){applyAuthTheme(theme);}
function applyAuthLanguage(lang){
  lang=lang==='en'?'en':'my';localStorage.setItem('v2d_ui_language',lang);document.documentElement.lang=lang==='en'?'en':'my';const d=AUTH_UI[lang];
  const set=(id,text)=>{const e=document.getElementById(id);if(e)e.textContent=text;};
  set('authLanguageLabel',d.language);set('authThemeLabel',d.theme);set('authTabLogin',d.login);set('authTabRegister',d.register);set('authTabForgot',d.forgot);
  const labels=document.querySelectorAll('#authGate label');
  labels.forEach(label=>{const txt=label.childNodes[0];if(!txt||txt.nodeType!==Node.TEXT_NODE)return;const v=txt.nodeValue.trim();const map=lang==='en'?{'အမည်':'Your Name','Your Name / အမည်':'Your Name','Shop / Workspace Name':'Shop / Workspace Name','Password အတည်ပြု':'Confirm Password'}:{'Your Name / အမည်':'အမည်','Your Name':'အမည်','Shop / Workspace Name':'Shop / Workspace အမည်','Confirm Password':'Password အတည်ပြု'};if(map[v])txt.nodeValue='\n      '+map[v]+'\n      ';});
  set('loginSubmitBtn',d.loginButton);set('registerSubmitBtn',d.registerButton);set('forgotSubmitBtn',d.resetButton);
  const ls=document.getElementById('authLangSelect');if(ls)ls.value=lang;
  const ts=document.getElementById('authThemeSelect');if(ts){ts.options[0].textContent=d.system;ts.options[1].textContent=d.light;ts.options[2].textContent=d.dark;}
  window.v2dRefreshPwaUi?.();
  const active=document.querySelector('.authTab.active')?.id||'authTabLogin';showAuthPanel(active==='authTabRegister'?'register':active==='authTabForgot'?'forgot':'login');
}
function setAuthLanguage(lang){applyAuthLanguage(lang);window.v2dRefreshPwaUi?.();}
function authMsg(my,en){return authLanguage()==='en'?en:my;}

const AUTH_STAGE_VERSION = "4.7A.2";
let v2dAppScriptLoaded = false;

function authEl(id){ return document.getElementById(id); }

function setAuthMessage(message, type=""){
  const box=authEl("authMessage");
  if(!box) return;
  box.textContent=message;
  box.className="authMessage"+(type?` ${type}`:"");
}

function setAuthBusy(buttonId,busy,busyText){
  const button=authEl(buttonId);
  if(!button) return;
  button.disabled=!!busy;
  if(busy){button.textContent=busyText||authMsg("ခဏစောင့်ပါ…","Please wait…");return;}
  const d=AUTH_UI[authLanguage()];
  button.textContent=buttonId==="loginSubmitBtn"?d.loginButton:buttonId==="registerSubmitBtn"?d.registerButton:buttonId==="forgotSubmitBtn"?d.resetButton:button.textContent;
}

function showAuthPanel(panel){
  const names=["login","register","forgot"];
  names.forEach(name=>{
    const panelEl=authEl(`auth${name[0].toUpperCase()+name.slice(1)}Panel`);
    const tabEl=authEl(`authTab${name[0].toUpperCase()+name.slice(1)}`);
    if(panelEl) panelEl.style.display=name===panel?"grid":"none";
    if(tabEl) tabEl.classList.toggle("active",name===panel);
  });
  setAuthMessage(
    panel==="login"?authMsg("Email နှင့် Password ဖြင့် Login ဝင်ပါ။","Sign in with your email and password."):
    panel==="register"?authMsg("ကိုယ်ပိုင် Workspace Account ဖွင့်ပါ။","Create your personal workspace account."):
    authMsg("Password reset email တောင်းပါ။","Request a password reset email.")
  );
}

function friendlyAuthError(error){
  const code=String(error?.code||"");
  const map={
    "auth/invalid-credential":"Email သို့မဟုတ် Password မမှန်ပါ။",
    "auth/invalid-login-credentials":"Email သို့မဟုတ် Password မမှန်ပါ။",
    "auth/user-not-found":"ဒီ Email ဖြင့် Account မရှိသေးပါ။",
    "auth/wrong-password":"Password မမှန်ပါ။",
    "auth/email-already-in-use":"ဒီ Email ကို Account ဖွင့်ထားပြီးသားပါ။",
    "auth/invalid-email":"Email ပုံစံမမှန်ပါ။",
    "auth/weak-password":"Password အနည်းဆုံး ၆ လုံးထားပါ။",
    "auth/too-many-requests":"ကြိမ်များစွာကြိုးစားထားပါတယ်။ ခဏစောင့်ပြီး ပြန်လုပ်ပါ။",
    "auth/network-request-failed":"Internet connection ကိုစစ်ပါ။",
    "auth/operation-not-allowed":"Firebase မှ Email/Password Sign-in ကို Enable လုပ်ပါ။",
    "auth/unauthorized-domain":"Firebase Authorized Domains ကိုစစ်ပါ။"
  };
  if(authLanguage()==='en'){
    const enMap={
      "auth/invalid-credential":"Incorrect email or password.","auth/invalid-login-credentials":"Incorrect email or password.","auth/user-not-found":"No account exists for this email.","auth/wrong-password":"Incorrect password.","auth/email-already-in-use":"This email is already registered.","auth/invalid-email":"Invalid email format.","auth/weak-password":"Password must be at least 6 characters.","auth/too-many-requests":"Too many attempts. Please wait and try again.","auth/network-request-failed":"Check your internet connection.","auth/operation-not-allowed":"Enable Email/Password sign-in in Firebase.","auth/unauthorized-domain":"Check Firebase Authorized Domains."
    };
    return enMap[code]||error?.message||"Authentication error.";
  }
  return map[code]||error?.message||"Authentication error ဖြစ်နေပါတယ်။";
}

async function ensureUserProfile(user, extra={}){
  const coreProfile={
    uid:user.uid,
    email:user.email||"",
    displayName:extra.displayName||user.displayName||"",
    shopName:extra.shopName||"",
    role:"user",
    status:"active"
  };

  try{
    const db=window.v2dDb;
    if(!db) throw new Error("Firestore မချိတ်မိသေးပါ");
    const ref=db.collection("users").doc(user.uid);
    const existing=await ref.get();

    if(existing.exists){
      const previous=existing.data()||{};
      const patch={
        email:user.email||previous.email||"",
        displayName:extra.displayName||user.displayName||previous.displayName||"",
        lastLoginAt:firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      };
      if(extra.shopName) patch.shopName=extra.shopName;
      await ref.set(patch,{merge:true});
      window.V2D_CURRENT_PROFILE={...coreProfile,...previous,...patch};
    }else{
      const profile={
        ...coreProfile,
        plan:"standard",
        licenseStatus:"active",
        expiresAt:null,
        expiryNotice:"",
        disabledNotice:""
      };
      await ref.set({
        ...profile,
        createdAt:firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
        lastLoginAt:firebase.firestore.FieldValue.serverTimestamp()
      },{merge:true});
      window.V2D_CURRENT_PROFILE=profile;
    }
  }catch(error){
    console.warn("User profile cloud write skipped",error);
    window.V2D_CURRENT_PROFILE={...coreProfile,plan:"standard",licenseStatus:"active",expiresAt:null};
  }
  return window.V2D_CURRENT_PROFILE;
}

function updateSignedInHeader(user,profile={}){
  const name=profile.displayName||user.displayName||"User";
  const email=user.email||"";
  if(authEl("authUserName")) authEl("authUserName").textContent=name;
  if(authEl("authUserEmail")) authEl("authUserEmail").textContent=email;
}

function loadAuthenticatedApp(){
  if(v2dAppScriptLoaded) return;
  v2dAppScriptLoaded=true;

  const script=document.createElement("script");
  script.src=`js/app.js?v=${AUTH_STAGE_VERSION}`;
  script.onload=async()=>{
    try{
      setAuthMessage(authMsg("Cloud workspace ကို Auto Load လုပ်နေပါသည်…","Auto-loading cloud workspace…"),"good");
      if(window.V2D_APP_READY_PROMISE) await window.V2D_APP_READY_PROMISE;
      const gate=authEl("authGate");
      const app=authEl("mainApp");
      if(gate) gate.hidden=true;
      if(app) app.hidden=false;
    }catch(error){
      v2dAppScriptLoaded=false;
      setAuthMessage("Cloud workspace ဖွင့်မရပါ။ "+(error?.message||error),"bad");
    }
  };
  script.onerror=()=>{
    v2dAppScriptLoaded=false;
    setAuthMessage("App JavaScript ကို load မရပါ။ Live Server နှင့် js/app.js ကိုစစ်ပါ။","bad");
  };
  document.body.appendChild(script);
}

async function loginWithEmail(event){
  event.preventDefault();
  const email=String(authEl("loginEmail")?.value||"").trim();
  const password=String(authEl("loginPassword")?.value||"");
  setAuthBusy("loginSubmitBtn",true,authMsg("Login ဝင်နေပါသည်…","Logging in…"));
  setAuthMessage(authMsg("Login စစ်နေပါသည်…","Checking login…"));

  try{
    await window.v2dAuth.signInWithEmailAndPassword(email,password);
    setAuthMessage(authMsg("Login အောင်မြင်ပါပြီ။","Login successful."),"good");
  }catch(error){
    setAuthMessage(friendlyAuthError(error),"bad");
  }finally{
    setAuthBusy("loginSubmitBtn",false);
  }
}

async function registerWithEmail(event){
  event.preventDefault();
  const displayName=String(authEl("registerName")?.value||"").trim();
  const shopName=String(authEl("registerShopName")?.value||"").trim();
  const email=String(authEl("registerEmail")?.value||"").trim();
  const password=String(authEl("registerPassword")?.value||"");
  const confirmPassword=String(authEl("registerConfirmPassword")?.value||"");

  if(password!==confirmPassword){
    setAuthMessage("Password နှစ်ခု မတူပါ။","bad");
    return;
  }
  if(password.length<6){
    setAuthMessage("Password အနည်းဆုံး ၆ လုံးထားပါ။","bad");
    return;
  }

  setAuthBusy("registerSubmitBtn",true,authMsg("Account ဖွင့်နေပါသည်…","Creating account…"));
  setAuthMessage(authMsg("Account ဖွင့်နေပါသည်…","Creating account…"));

  try{
    const credential=await window.v2dAuth.createUserWithEmailAndPassword(email,password);
    await credential.user.updateProfile({displayName});
    await ensureUserProfile(credential.user,{displayName,shopName});

    const shopClaimKey=`v2d_user_${credential.user.uid}__initial_shop_name`;
    localStorage.setItem(shopClaimKey,shopName);
    setAuthMessage(authMsg("Account ဖွင့်ပြီး Login ဝင်ထားပါပြီ။","Account created and signed in."),"good");
  }catch(error){
    setAuthMessage(friendlyAuthError(error),"bad");
  }finally{
    setAuthBusy("registerSubmitBtn",false);
  }
}

async function sendPasswordReset(event){
  event.preventDefault();
  const email=String(authEl("forgotEmail")?.value||"").trim();
  setAuthBusy("forgotSubmitBtn",true,authMsg("ပို့နေပါသည်…","Sending…"));
  setAuthMessage(authMsg("Password reset email ပို့နေပါသည်…","Sending password reset email…"));

  try{
    await window.v2dAuth.sendPasswordResetEmail(email);
    setAuthMessage(authMsg("Reset Email ပို့ပြီးပါပြီ။ Inbox/Spam ကိုစစ်ပါ။","Reset email sent. Check your Inbox/Spam."),"good");
  }catch(error){
    setAuthMessage(friendlyAuthError(error),"bad");
  }finally{
    setAuthBusy("forgotSubmitBtn",false);
  }
}

async function logoutUser(){
  const ok=confirm(authMsg("Logout ထွက်မလား?","Log out?"));
  if(!ok) return;
  try{
    await window.v2dAuth.signOut();
  }catch(error){
    alert(friendlyAuthError(error));
  }finally{
    location.reload();
  }
}


let v2dLicenseProfileUnsub=null;
let v2dAuthOwnerBypass=false;
let v2dLastLicenseState='';

async function checkAuthOwnerBypass(user){
  try{
    const snap=await window.v2dDb.collection('appOwners').doc(user.uid).get();
    return !!snap.exists && snap.data()?.active===true;
  }catch(_e){ return false; }
}
function licenseExpiryMs(profile){
  const raw=profile?.expiresAt;
  if(!raw) return 0;
  try{ if(raw?.toDate) return raw.toDate().getTime(); }catch(_e){}
  const ms=Date.parse(String(raw));
  return Number.isFinite(ms)?ms:0;
}
function userLicenseState(profile){
  if(v2dAuthOwnerBypass) return {state:'active',reason:'owner'};
  const status=String(profile?.licenseStatus||'active').toLowerCase();
  if(status==='disabled') return {state:'disabled',reason:'disabled'};
  const exp=licenseExpiryMs(profile);
  if(exp && Date.now()>=exp) return {state:'expired',reason:'expired',expiresAt:exp};
  return {state:'active',reason:'active',expiresAt:exp};
}
function showLicenseBlocked(user,profile,state){
  const gate=authEl('authGate'), app=authEl('mainApp'), panel=authEl('licenseBlockedPanel');
  if(app) app.hidden=true;
  if(gate) gate.hidden=false;
  document.querySelector('.authTabs')?.setAttribute('hidden','');
  ['authLoginPanel','authRegisterPanel','authForgotPanel'].forEach(id=>{const el=authEl(id);if(el)el.style.display='none';});
  if(panel) panel.hidden=false;
  const isExpired=state.state==='expired';
  const fallback=isExpired
    ? authMsg('သင့်အကောင့် အသုံးပြုခွင့် သက်တမ်းကုန်ဆုံးသွားပါပြီ။ ဆက်လက်အသုံးပြုရန် App Owner ထံ ဆက်သွယ်ပါ။','Your account access has expired. Please contact the App Owner to continue using the app.')
    : authMsg('သင့်အကောင့် အသုံးပြုခွင့်ကို App Owner မှ ခေတ္တပိတ်ထားပါသည်။ App Owner ထံ ဆက်သွယ်ပါ။','Your account access has been disabled by the App Owner. Please contact the App Owner.');
  const custom=isExpired?String(profile?.expiryNotice||'').trim():String(profile?.disabledNotice||'').trim();
  if(authEl('licenseBlockedTitle')) authEl('licenseBlockedTitle').textContent=isExpired?authMsg('အကောင့်သက်တမ်းကုန်ဆုံး','Account Expired'):authMsg('အကောင့်အသုံးပြုခွင့်ပိတ်ထားသည်','Account Disabled');
  if(authEl('licenseBlockedMessage')) authEl('licenseBlockedMessage').textContent=custom||fallback;
  const exp=licenseExpiryMs(profile);
  if(authEl('licenseBlockedMeta')) authEl('licenseBlockedMeta').textContent=[user.email||'',isExpired&&exp?new Date(exp).toLocaleString():''].filter(Boolean).join(' · ');
  setAuthMessage(custom||fallback,'bad');
}
function hideLicenseBlocked(){
  const panel=authEl('licenseBlockedPanel'); if(panel)panel.hidden=true;
  document.querySelector('.authTabs')?.removeAttribute('hidden');
}
async function applyLicenseProfile(user,profile){
  window.V2D_CURRENT_PROFILE={...(window.V2D_CURRENT_PROFILE||{}),...(profile||{})};
  updateSignedInHeader(user,window.V2D_CURRENT_PROFILE);
  const state=userLicenseState(profile||{});
  if(state.state!=='active'){
    const changed=v2dLastLicenseState && v2dLastLicenseState!==state.state;
    v2dLastLicenseState=state.state;
    showLicenseBlocked(user,profile||{},state);
    if(changed && v2dAppScriptLoaded) setTimeout(()=>location.reload(),250);
    return false;
  }
  const wasBlocked=v2dLastLicenseState && v2dLastLicenseState!=='active';
  v2dLastLicenseState='active';
  hideLicenseBlocked();
  if(wasBlocked && v2dAppScriptLoaded){ location.reload(); return true; }
  loadAuthenticatedApp();
  return true;
}
function startLicenseProfileWatch(user){
  try{ v2dLicenseProfileUnsub?.(); }catch(_e){}
  v2dLicenseProfileUnsub=window.v2dDb.collection('users').doc(user.uid).onSnapshot(snap=>{
    if(!snap.exists) return;
    applyLicenseProfile(user,snap.data()||{});
  },error=>{
    console.warn('License profile realtime failed',error);
    applyLicenseProfile(user,window.V2D_CURRENT_PROFILE||{});
  });
}

function initializeAuthFoundation(){
  if(window.v2dFirebaseInitError){
    setAuthMessage("Firebase initialization မအောင်မြင်ပါ။ "+window.v2dFirebaseInitError.message,"bad");
    return;
  }
  if(!window.v2dAuth){
    setAuthMessage("Firebase Authentication SDK မချိတ်မိသေးပါ။","bad");
    return;
  }

  window.v2dAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(error=>{
    console.warn("Auth persistence warning",error);
  });

  window.v2dAuth.onAuthStateChanged(async user=>{
    if(!user){
      const app=authEl("mainApp");
      const gate=authEl("authGate");
      if(app) app.hidden=true;
      if(gate) gate.hidden=false;
      showAuthPanel("login");
      setAuthMessage(authMsg("Login ဝင်ပါ သို့မဟုတ် Account အသစ်ဖွင့်ပါ။","Sign in or create a new account."));
      return;
    }

    setAuthMessage(authMsg("User workspace ဖွင့်နေပါသည်…","Opening user workspace…"),"good");
    const profile=await ensureUserProfile(user);
    window.V2D_CURRENT_USER=user;
    updateSignedInHeader(user,profile);
    v2dAuthOwnerBypass=await checkAuthOwnerBypass(user);
    startLicenseProfileWatch(user);
  },error=>{
    setAuthMessage(friendlyAuthError(error),"bad");
  });
}

window.showAuthPanel=showAuthPanel;
window.loginWithEmail=loginWithEmail;
window.registerWithEmail=registerWithEmail;
window.sendPasswordReset=sendPasswordReset;
window.logoutUser=logoutUser;
window.setAuthLanguage=setAuthLanguage;
window.setAuthTheme=setAuthTheme;

applyAuthTheme(localStorage.getItem('v2d_ui_theme')||'system');
applyAuthLanguage(authLanguage());
if(window.matchMedia){window.matchMedia('(prefers-color-scheme: light)').addEventListener?.('change',()=>{if((localStorage.getItem('v2d_ui_theme')||'system')==='system')applyAuthTheme('system');});}

initializeAuthFoundation();

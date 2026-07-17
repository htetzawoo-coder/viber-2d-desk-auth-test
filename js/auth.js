const AUTH_STAGE_VERSION = "4.2B.1";
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
  if(!button.dataset.originalText) button.dataset.originalText=button.textContent;
  button.disabled=!!busy;
  button.textContent=busy?(busyText||"Please wait…"):button.dataset.originalText;
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
    panel==="login"?"Email နှင့် Password ဖြင့် Login ဝင်ပါ။":
    panel==="register"?"ကိုယ်ပိုင် Workspace Account ဖွင့်ပါ။":
    "Password reset email တောင်းပါ။"
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
  return map[code]||error?.message||"Authentication error ဖြစ်နေပါတယ်။";
}

async function ensureUserProfile(user, extra={}){
  const profile={
    uid:user.uid,
    email:user.email||"",
    displayName:extra.displayName||user.displayName||"",
    shopName:extra.shopName||"",
    role:"user",
    status:"active",
    updatedAt:new Date().toISOString()
  };

  try{
    const db=window.v2dDb;
    if(!db) throw new Error("Firestore မချိတ်မိသေးပါ");
    const ref=db.collection("users").doc(user.uid);
    const existing=await ref.get();

    if(existing.exists){
      const previous=existing.data()||{};
      await ref.set({
        email:user.email||previous.email||"",
        displayName:user.displayName||previous.displayName||"",
        lastLoginAt:firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      },{merge:true});
      window.V2D_CURRENT_PROFILE={...previous,...profile};
    }else{
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
    window.V2D_CURRENT_PROFILE=profile;
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
      setAuthMessage("Cloud workspace ကို Auto Load လုပ်နေပါသည်…","good");
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
  setAuthBusy("loginSubmitBtn",true,"Logging in…");
  setAuthMessage("Login စစ်နေပါသည်…");

  try{
    await window.v2dAuth.signInWithEmailAndPassword(email,password);
    setAuthMessage("Login အောင်မြင်ပါပြီ။","good");
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

  setAuthBusy("registerSubmitBtn",true,"Creating account…");
  setAuthMessage("Account ဖွင့်နေပါသည်…");

  try{
    const credential=await window.v2dAuth.createUserWithEmailAndPassword(email,password);
    await credential.user.updateProfile({displayName});
    await ensureUserProfile(credential.user,{displayName,shopName});

    const shopClaimKey=`v2d_user_${credential.user.uid}__initial_shop_name`;
    localStorage.setItem(shopClaimKey,shopName);
    setAuthMessage("Account ဖွင့်ပြီး Login ဝင်ထားပါပြီ။","good");
  }catch(error){
    setAuthMessage(friendlyAuthError(error),"bad");
  }finally{
    setAuthBusy("registerSubmitBtn",false);
  }
}

async function sendPasswordReset(event){
  event.preventDefault();
  const email=String(authEl("forgotEmail")?.value||"").trim();
  setAuthBusy("forgotSubmitBtn",true,"Sending…");
  setAuthMessage("Password reset email ပို့နေပါသည်…");

  try{
    await window.v2dAuth.sendPasswordResetEmail(email);
    setAuthMessage("Reset Email ပို့ပြီးပါပြီ။ Inbox/Spam ကိုစစ်ပါ။","good");
  }catch(error){
    setAuthMessage(friendlyAuthError(error),"bad");
  }finally{
    setAuthBusy("forgotSubmitBtn",false);
  }
}

async function logoutUser(){
  const ok=confirm("Logout ထွက်မလား?");
  if(!ok) return;
  try{
    await window.v2dAuth.signOut();
  }catch(error){
    alert(friendlyAuthError(error));
  }finally{
    location.reload();
  }
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
      setAuthMessage("Login ဝင်ပါ သို့မဟုတ် Account အသစ်ဖွင့်ပါ။");
      return;
    }

    setAuthMessage("User workspace ဖွင့်နေပါသည်…","good");
    const profile=await ensureUserProfile(user);
    window.V2D_CURRENT_USER=user;
    updateSignedInHeader(user,profile);
    loadAuthenticatedApp();
  },error=>{
    setAuthMessage(friendlyAuthError(error),"bad");
  });
}

window.showAuthPanel=showAuthPanel;
window.loginWithEmail=loginWithEmail;
window.registerWithEmail=registerWithEmail;
window.sendPasswordReset=sendPasswordReset;
window.logoutUser=logoutUser;

initializeAuthFoundation();

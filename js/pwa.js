(() => {
  "use strict";
  let deferredInstallPrompt = null;
  const SW_VERSION = "4.7A.4";
  const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const lang = () => localStorage.getItem("v2d_ui_language") === "en" ? "en" : "my";
  const copy = (my,en) => lang() === "en" ? en : my;

  function baseShareUrl(){
    const url = new URL(location.href);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/(?:dev|index)\.html$/i,"");
    return url.toString();
  }

  function notify(message,type="good"){
    if(typeof window.toast === "function"){
      try{ window.toast(message,type); return; }catch(_){ }
    }
    const authBox = document.getElementById("authMessage");
    if(authBox && !document.getElementById("authGate")?.hidden){
      authBox.textContent = message;
      authBox.className = "authMessage " + (type === "bad" ? "bad" : "good");
      return;
    }
    window.alert(message);
  }

  function updateButtons(){
    const installed = isStandalone();
    document.querySelectorAll("[data-pwa-install]").forEach(btn => {
      btn.hidden = installed;
      btn.disabled = installed;
      btn.textContent = installed ? copy("App တင်ပြီး","Installed") : copy("App ထည့်မည်","Install App");
    });
    document.querySelectorAll("[data-pwa-share]").forEach(btn => {
      btn.textContent = copy("App Link မျှဝေမည်","Share App Link");
    });
  }

  async function installApp(){
    if(isStandalone()){
      notify(copy("App ကို တင်ပြီးသားဖြစ်ပါတယ်။","The app is already installed."));
      return;
    }
    if(deferredInstallPrompt){
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      updateButtons();
      if(choice?.outcome === "accepted") notify(copy("App install စတင်ပါပြီ။","App installation started."));
      return;
    }
    const ua = navigator.userAgent || "";
    const isiOS = /iPhone|iPad|iPod/i.test(ua);
    const msg = isiOS
      ? copy("Safari မှ Share ခလုတ်ကိုနှိပ်ပြီး Add to Home Screen ကိုရွေးပါ။","In Safari, tap Share and choose Add to Home Screen.")
      : copy("Browser menu (⋮) ကိုနှိပ်ပြီး Install app သို့မဟုတ် Add to Home screen ကိုရွေးပါ။","Open the browser menu (⋮) and choose Install app or Add to Home screen.");
    notify(msg,"warn");
  }

  async function shareApp(){
    const data = {
      title:"Viber 2D Desk",
      text:copy("Viber 2D Desk App — Link ဖွင့်ပြီး Register လုပ်ကာ အသုံးပြုနိုင်ပါသည်။","Viber 2D Desk — open the link, register, and sign in."),
      url:baseShareUrl()
    };
    try{
      if(navigator.share){
        await navigator.share(data);
      }else{
        await navigator.clipboard.writeText(data.url);
        notify(copy("App Link ကို Copy လုပ်ပြီးပါပြီ။","App link copied."));
      }
    }catch(error){
      if(error?.name !== "AbortError"){
        try{
          await navigator.clipboard.writeText(data.url);
          notify(copy("App Link ကို Copy လုပ်ပြီးပါပြီ။","App link copied."));
        }catch(_){ notify(data.url); }
      }
    }
  }

  window.installV2DApp = installApp;
  window.shareV2DApp = shareApp;
  window.v2dRefreshPwaUi = updateButtons;

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateButtons();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    updateButtons();
    notify(copy("Viber 2D Desk App တင်ပြီးပါပြီ။","Viber 2D Desk installed."));
  });

  window.V2D_SW_READY = Promise.resolve(false);
  if("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost","127.0.0.1"].includes(location.hostname))){
    window.V2D_SW_READY = (async () => {
      try{
        const reg = await navigator.serviceWorker.register(`service-worker.js?v=${SW_VERSION}`,{scope:"./"});
        try{ await reg.update(); }catch(_){ }
        if(reg.waiting) reg.waiting.postMessage("SKIP_WAITING");
        return true;
      }catch(error){
        console.warn("PWA service worker registration failed",error);
        return false;
      }
    })();
  }

  document.addEventListener("DOMContentLoaded",updateButtons);
  window.addEventListener("pageshow",updateButtons);
})();

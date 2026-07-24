(() => {
  "use strict";

  const VERSION = "4.7A.4";
  const FIREBASE_VERSION = "10.12.5";
  const statusBox = () => document.getElementById("authMessage");

  // Stage 4.7A.4: do not depend on a single CDN/DNS provider.
  // Firebase's official gstatic CDN is tried first, followed by public mirrors
  // of the same Firebase npm package build.
  const SDK_SOURCES = [
    {
      name: "Google Firebase CDN",
      build: file => `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/${file}`
    },
    {
      name: "UNPKG",
      build: file => `https://unpkg.com/firebase@${FIREBASE_VERSION}/${file}`
    },
    {
      name: "jsDelivr",
      build: file => `https://cdn.jsdelivr.net/npm/firebase@${FIREBASE_VERSION}/${file}`
    },
    {
      name: "cdnjs",
      build: file => `https://cdnjs.cloudflare.com/ajax/libs/firebase/10.12.5-20240730204232/${file}`
    }
  ];

  function setStatus(message, type="") {
    const box = statusBox();
    if (!box) return;
    box.textContent = message;
    box.className = "authMessage" + (type ? ` ${type}` : "");
  }

  function delay(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

  function loadScript(src, timeoutMs=10000) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      let finished = false;
      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        script.remove();
        reject(new Error(`Timeout loading ${src}`));
      }, timeoutMs);
      script.src = src;
      script.async = false;
      script.crossOrigin = "anonymous";
      script.onload = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve();
      };
      script.onerror = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        script.remove();
        reject(new Error(`Failed loading ${src}`));
      };
      document.head.appendChild(script);
    });
  }

  async function loadFirebaseLibrary(file, readyCheck, label) {
    if (readyCheck()) return "already-ready";
    const errors = [];

    for (let i = 0; i < SDK_SOURCES.length; i++) {
      const source = SDK_SOURCES[i];
      const baseUrl = source.build(file);
      const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}v2d=${VERSION}_${Date.now()}_${i+1}`;
      try {
        setStatus(`Firebase ${label} SDK loading via ${source.name}… (${i+1}/${SDK_SOURCES.length})`);
        await loadScript(url, 10000);
        if (!readyCheck()) throw new Error(`${label} loaded from ${source.name}, but API is unavailable`);
        window.V2D_FIREBASE_SDK_SOURCE = source.name;
        return source.name;
      } catch (error) {
        console.warn(`[V2D] ${label} SDK failed via ${source.name}`, error);
        errors.push(`${source.name}: ${error?.message || error}`);
        await delay(250);
      }
    }

    throw new Error(`${label} SDK failed on all CDN sources. ${errors.join(" | ")}`);
  }

  async function waitForServiceWorkerUpdate() {
    try {
      if (window.V2D_SW_READY && typeof window.V2D_SW_READY.then === "function") {
        await Promise.race([window.V2D_SW_READY, delay(2500)]);
      }
    } catch (_) {}
  }

  async function bootstrap() {
    try {
      await waitForServiceWorkerUpdate();

      const appSource = await loadFirebaseLibrary(
        "firebase-app-compat.js",
        () => !!window.firebase,
        "App"
      );
      await loadFirebaseLibrary(
        "firebase-firestore-compat.js",
        () => !!window.firebase?.firestore,
        "Firestore"
      );
      await loadFirebaseLibrary(
        "firebase-auth-compat.js",
        () => !!window.firebase?.auth,
        "Auth"
      );

      setStatus(`Firebase SDK ready (${window.V2D_FIREBASE_SDK_SOURCE || appSource}). Initializing app…`, "good");
      await loadScript(`js/firebase-config.js?v=${VERSION}`);
      if (window.v2dFirebaseInitError) throw window.v2dFirebaseInitError;
      if (!window.v2dAuth || !window.v2dDb) throw new Error("Firebase services were not initialized");
      await loadScript(`js/auth.js?v=${VERSION}`);
    } catch (error) {
      console.error("Firebase bootstrap failed", error);
      window.v2dFirebaseBootstrapError = error;
      setStatus(
        "Firebase SDK Load မအောင်မြင်သေးပါ။ CDN 4 ခုလုံးကို စမ်းပြီးပါပြီ။ Internet/DNS/VPN/Firewall ကိုစစ်ပါ။ Error: " + (error?.message || error),
        "bad"
      );
    }
  }

  window.V2D_FIREBASE_BOOTSTRAP_READY = bootstrap();
})();

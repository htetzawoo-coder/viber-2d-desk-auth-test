const V2D_CACHE = "v2d-desk-shell-v4.6.0";
const V2D_RUNTIME = "v2d-desk-runtime-v4.6.0";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./js/firebase-config.js",
  "./js/auth.js",
  "./js/app.js",
  "./js/pwa.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.ico"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(V2D_CACHE).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("v2d-desk-") && ![V2D_CACHE,V2D_RUNTIME].includes(key)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirst(request){
  const cache = await caches.open(V2D_RUNTIME);
  try{
    const response = await fetch(request);
    if(response && (response.ok || response.type === "opaque")) cache.put(request,response.clone());
    return response;
  }catch(error){
    return (await cache.match(request,{ignoreSearch:true})) || (await caches.match(request,{ignoreSearch:true})) || Promise.reject(error);
  }
}

async function staleWhileRevalidate(request){
  const cache = await caches.open(V2D_RUNTIME);
  const cached = await cache.match(request,{ignoreSearch:true});
  const network = fetch(request).then(response => {
    if(response && (response.ok || response.type === "opaque")) cache.put(request,response.clone());
    return response;
  }).catch(() => null);
  return cached || network || new Response("Offline",{status:503,statusText:"Offline"});
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if(request.method !== "GET") return;
  const url = new URL(request.url);

  if(request.mode === "navigate"){
    event.respondWith(networkFirst(request).catch(() => caches.match("./index.html")));
    return;
  }

  if(url.origin === self.location.origin){
    event.respondWith(networkFirst(request));
    return;
  }

  if(url.hostname === "www.gstatic.com" && url.pathname.includes("/firebasejs/")){
    event.respondWith(staleWhileRevalidate(request));
  }
});

self.addEventListener("message", event => {
  if(event.data === "SKIP_WAITING") self.skipWaiting();
});

# Stage 4.7A.3 — Firebase Online Load Fix

Purpose: fix online Login/Register when Firebase SDK scripts fail to initialize under an older PWA service worker or transient CDN load failure.

Changes:
- Firebase SDKs now load through js/firebase-bootstrap.js with 3 retries and cache-busting.
- Service worker no longer intercepts cross-origin Firebase CDN requests.
- PWA cache version bumped to 4.7A.3.
- Existing Stage 4.7A.2 Report JPG features are preserved.
- No Firestore Rules changes.

Online update: upload ALL files/folders from online/, including js/firebase-bootstrap.js and service-worker.js.
After deployment, refresh twice if the old service worker still controls the first load.

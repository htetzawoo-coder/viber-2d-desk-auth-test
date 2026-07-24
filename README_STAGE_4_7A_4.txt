# Stage 4.7A.4 — Multi-CDN Firebase SDK Load Fix

Reason
- Stage 4.7A.3 proved the browser cannot resolve/load www.gstatic.com on the current network.
- Stage 4.7A.4 removes the single-CDN dependency.

Firebase SDK load order
1. Google Firebase CDN (gstatic)
2. UNPKG
3. jsDelivr
4. cdnjs

Only the SDK-loading layer changed. Firestore rules, parser logic, JPG export, cloud data, owner/user permissions are unchanged.

Test
- Replace all project/online files.
- Hard refresh.
- Login notice should show the CDN being tried.
- Success notice says Firebase SDK ready (...).

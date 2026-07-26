Viber 2D Desk — Stage 4.7C.0 Cloud Sync Safety & Conflict Protection

Main additions
1. Pending Sync Journal: local edits made before a successful cloud commit are counted and shown as Pending N.
2. Auto Retry: failed online sync retries with 2s / 5s / 15s / 30s / 60s backoff.
3. Offline Queue: local cache remains only a temporary fallback; reconnect triggers cloud sync automatically.
4. Record Revision Metadata: each Firestore record write stores _revision, _deviceId and client/server timestamps.
5. Conflict Analysis: compares base/local/cloud record hashes. Non-overlapping record changes are auto-merged.
6. True Conflict UI: overlapping record edits or simultaneous workspace-state edits open Compare / Use Cloud / Keep Mine.
7. Keep Mine Safe Replace: reads current cloud record IDs, writes the local set and deletes cloud-only IDs so the cloud manifest remains consistent.
8. Close/Logout Protection: unsynced data triggers browser close warning and logout confirmation.
9. Last successful sync time remains visible in the Cloud status pill.
10. Existing Parser, Card Edit, Reports/JPG, Owner controls, PWA and Cloud-first paths are retained.

Firestore Rules
- No new collection is required. Stage 4.7C uses the same users/{uid}/workspace and users/{uid}/records paths.
- firestore.rules.stage4_7C_required.txt is included as the matching reference. If Stage 4.7B rules are already published, the permissions are functionally unchanged.

Recommended live test
A. Offline: disable internet -> add/edit a record -> Pending count should appear -> reconnect -> Synced and Pending clears.
B. Non-overlap: Laptop A edits Card 1 while Laptop B edits Card 2 from the same base -> system should auto-merge and sync.
C. True conflict: both devices edit the same record before either receives the other's change -> Conflict modal should appear; Compare then choose Use Cloud or Keep Mine.
D. Close protection: make an offline edit and try closing/reloading -> browser warning should appear.
E. Logout protection: with pending changes, Logout should warn before signing out.

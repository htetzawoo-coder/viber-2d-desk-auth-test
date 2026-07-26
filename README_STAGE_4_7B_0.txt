Viber 2D Desk — Stage 4.7B.0 Full Cloud-First Save System
==========================================================

GOAL
----
Firestore Cloud is now the main business-data source.
LocalStorage is retained only as a best-effort cache/fallback for fast UI/offline continuity.
A LocalStorage quota/write failure no longer blocks a Cloud save attempt.

NEW CLOUD STRUCTURE
-------------------
users/{uid}/workspace/state
  - settings
  - over deductions
  - global view
  - P memory
  - dealer manual memory
  - compact audit trail
  - sync/content metadata

users/{uid}/records/{recordId}
  - one Firestore document per Entry Record
  - card/source metadata stays with the record

LEGACY MIGRATION
----------------
The old users/{uid}/snapshots/current_workspace document is NOT deleted.
On first 4.7B start, when the new structured Cloud data does not exist, the app reads the old Cloud workspace and migrates it automatically into workspace/state + records documents.

SYNC BEHAVIOR
-------------
- Login: Cloud structured data is loaded first.
- Entry add/edit/delete: auto sync to Cloud.
- Settings/P/Over/Dealer/Audit changes: auto sync to Cloud.
- Other device changes: state listener triggers an automatic Cloud refresh.
- Offline: changes remain in memory/local cache and are marked pending; sync resumes when internet returns.
- Restore JSON: remains an explicit overwrite workflow and uploads restored data on reboot.
- Manual Sync Now / Cloud Refresh remain available.
- Conflict protection remains: newer data written from another device blocks silent overwrite.

LOCAL-ONLY TEMPORARY ITEMS
--------------------------
Undo stack and minor UI-only state remain device-local because they are temporary operational state, not primary business data.

REQUIRED FIRESTORE RULES
------------------------
Publish: firestore.rules.stage4_7B_required.txt
This adds private per-user access to:
- users/{uid}/workspace/{docId}
- users/{uid}/records/{recordId}
Legacy snapshots are retained for migration/rollback.
Owner cannot read user business subcollections merely because they are App Owner.

IMPORTANT TEST
--------------
1. Publish Stage 4.7B rules.
2. Replace project files and hard refresh.
3. Login on Laptop A; wait for green Cloud Synced / Cloud Main.
4. Add one new test record; wait for Cloud Synced.
5. Login with the same account on Laptop B / incognito; the new record should appear automatically.
6. Edit on Laptop B; Laptop A should receive the Cloud update.
7. Check Firestore Data: users/{uid}/workspace/state and users/{uid}/records should exist.

Retained features: Parser, Card Navigator/Edit, Reports, Card/P Breakdown, JPG export with full source + P highlight, Owner Parser, Owner Users/License, Language/Theme, PWA, Multi-CDN Firebase bootstrap.

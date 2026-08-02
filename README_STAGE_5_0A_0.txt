Viber 2D Desk — Stage 5.0A.0
Parser Rule Version History + Safe Rollback Foundation

NEW
- Every existing rule is archived before Draft save, Activate, Disable, or Rollback.
- Parser Rules list has a History button.
- History panel shows current version and archived versions.
- Archived rule snapshots are stored in parserRuleVersions.
- Old Stage 4.4 version snapshots are read through a backward-compatible legacy query.
- Rollback never deletes history: current version is archived, then selected old content is written as a NEW version.
- Previous ACTIVE snapshot -> Rollback & Activate.
- Previous DRAFT/DISABLED snapshot -> Restore as Draft.
- Rollback is blocked if core regression or active-rule signature conflict checks fail.
- Owner-only. User business records remain private.

FIRESTORE RULES
No new rule publication is required when Stage 4.9A/4.7B rules are already published. They already allow App Owner read/create on parserRuleVersions and prohibit update/delete.

TEST FLOW
1. Owner Parser -> edit an existing rule -> Save Draft or Activate to create an archived previous version.
2. Parser Rules -> History.
3. Verify Current vN and archived vN-1.
4. Choose Rollback & Activate / Restore as Draft.
5. Confirm that the restored content becomes NEW current vN+1 and old current stays in history.

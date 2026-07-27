Viber 2D Desk — Stage 5.0A.1
Rule Version History + Safe Rollback + Mobile Report Integration

BASE
- Stage 4.8E.0 Mobile Report JPG Optimization
- Stage 4.9A Owner Dashboard retained
- Stage 4.7C.1 Cloud sync safety retained

NEW
1. Parser Rules list: Rule History button.
2. Each edit/draft/activation/disable archives the previous rule version in parserRuleVersions.
3. History shows Current + Archived versions with type/scope/target/expected details.
4. Rollback never deletes history. Old content is restored as a NEW version.
5. Active historical version => Rollback & Activate. Draft/disabled historical version => Restore as Draft.
6. Rollback runs existing regression + active-rule conflict safety checks before writing.
7. Legacy Stage 4.4 parserRuleVersions documents remain readable.
8. Stage 4.8E Mobile JPG / Share / Owner Dashboard are retained.

FIRESTORE
- No new collection is required. parserRuleVersions already exists in current Owner Parser security structure.
- Do not republish Firestore Rules if Stage 4.9A / current secure rules are already working.

LIVE TEST
A. Owner Parser -> edit an existing rule -> Save Draft/Activate.
B. Rule History -> Current v2 + Archived v1 should appear.
C. Open v1 -> Rollback & Activate (or Restore as Draft).
D. Current should become v3; v1 and v2 remain archived.
E. Confirm Mobile JPG / Owner Dashboard still work.

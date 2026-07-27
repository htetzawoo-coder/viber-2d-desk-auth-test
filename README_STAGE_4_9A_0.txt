Viber 2D Desk — Stage 4.9A.0
Owner Dashboard Overview + User Management Consolidation

ADDED
- App Owner Dashboard tab (owner-only)
- User overview: Registered / Active / Disabled / Expired / Expiring Soon (7 days)
- Parser overview: New Reports / In Review / Active Rules / Draft Rules
- Expiring Soon attention list with direct User open
- Parser Attention list with direct Report open
- User Management consolidated inside Owner Dashboard
- Status + Plan + Search filters
- User list shows expiry and last-login metadata
- Owner Users legacy navigation aliases to Owner Dashboard

PRIVACY
- Owner Dashboard reads account/license profile metadata only.
- User business records under users/{uid}/records and users/{uid}/workspace remain private to that user under the existing Firestore rules.

FIRESTORE
- No rules change required from Stage 4.7B / 4.7C.
- No new collection and no new composite index are required.

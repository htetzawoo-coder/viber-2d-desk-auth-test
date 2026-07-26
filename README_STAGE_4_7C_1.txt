Viber 2D Desk — Stage 4.7C.1 True Conflict Filter

Purpose
- Fix false Cloud Sync conflicts where Local and Cloud records are already identical.
- Keep real same-card / same-record conflicts protected.

Changes
1. Records changed on both sides but with identical final hashes are ignored as converged.
2. Same-card conflict is raised only when the final card contents differ.
3. If the full Local and Cloud business content is identical, the conflict auto-resolves and refreshes the cloud baseline.
4. Conflict Compare lists only true differing records.
5. Firestore rules are unchanged from Stage 4.7B/4.7C.0.

Safety
- Do not choose Keep Mine / Use Cloud on the old 4.7C.0 false-conflict screen when visible rows are identical. Close it, deploy 4.7C.1, then retest.

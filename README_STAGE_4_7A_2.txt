STAGE 4.7A.2 — FULL CARD SOURCE + P NUMBER HIGHLIGHT JPG

Changes
1. Name Summary > JPG keeps the complete raw Viber body for each Card in Source.
2. Source is no longer limited to three unique snippets. Explicit line breaks are preserved and wrapped.
3. A Card containing the selected AM/PM P Number is highlighted with an amber row and P badge.
4. DAILY report resolves the correct P Number separately by each Card session.
5. Dynamic row heights and dynamic pagination prevent Source detail truncation.
6. Parser, Firestore rules, cloud sync and business calculations are unchanged.

Test
Reports > Name Summary > JPG. Check full Source for every Card and compare P-highlight rows with the stored P Number.

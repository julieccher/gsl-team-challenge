# ATUSRUN – Spielerprofile

## Enthalten
- Teamübersicht mit anklickbaren Spielerprofil-Karten
- Profilbild (JPG/PNG/WEBP, max. 5 MB)
- Position im Team und persönlicher „Über mich“-Text
- Teamprofil zeigt Gesamt-km und Anzahl der erfassten Läufe
- Spieler können nur ihr eigenes Profil bearbeiten; andere Teamprofile sind lesbar
- Bestehende Rangliste, Laufprüfung, Wochenwertung und Entschuldigungen bleiben im Projekt enthalten

## Einmalige Supabase-Einrichtung
1. Supabase öffnen → SQL Editor → New query.
2. Inhalt von `SUPABASE-ATUSRUN-SPIELERPROFILE.sql` einfügen und ausführen.
3. Danach App neu veröffentlichen.

Der SQL-Schritt ergänzt drei Profilspalten und richtet den Storage-Bucket `player-avatars` samt Policies ein. Bestehende Profile und Läufe werden nicht gelöscht.

## Lokal testen
`npm install`
`npm run build`

Danach Änderungen zu GitHub pushen. Vercel startet das Production-Deployment automatisch.

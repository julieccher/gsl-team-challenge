# ATUSRUN 2.0 – Arbeitsstand

## In dieser Version ergänzt
- Eigenständiges responsives Login-Layout und Schutz vor horizontalem Überlaufen auf kleinen Bildschirmen.
- iPhone-Safe-Area-Berücksichtigung und 16px Eingabeschrift gegen automatisches iOS-Zoomverhalten.
- Filter im Laufbereich nach Spieler, Status sowie Von-/Bis-Datum.
- Teammitteilungen: Trainer können Nachrichten veröffentlichen und löschen; angemeldete Spieler können sie lesen.
- Änderungsprotokoll für Lauf-Anlage, -Änderung und -Löschung. Das Protokoll wird serverseitig per Datenbank-Trigger erzeugt und ist nur für Trainer lesbar.
- Mobile Navigation ist horizontal scrollbar, damit zusätzliche Bereiche auf schmalen Displays erreichbar bleiben.

## Aus dem bisherigen Projekt übernommen
- Spielerprofile, Profilbild, Position und Kurzbeschreibung.
- Bestehende Lauf- und Challenge-Daten, Wochenpläne, Wochenentschuldigungen und Trainerfunktionen.
- Bestehende Profil- und Statistikansichten.

## Supabase – vor dem Test ausführen
1. Supabase öffnen → SQL Editor → New query.
2. Den Inhalt von `SUPABASE-ATUSRUN-2.0.sql` vollständig einfügen und ausführen.
3. Falls die Spielerprofil- und Laufprüfungs-SQLs aus den früheren Updates noch nicht ausgeführt wurden, diese ebenfalls ausführen: zuerst `SUPABASE-LAUFPRUEFUNG.sql`, danach `SUPABASE-ATUSRUN-SPIELERPROFILE.sql`. Bereits erfolgreich ausgeführte Skripte müssen nicht erneut manuell ausgeführt werden; sie verwenden überwiegend `if not exists` bzw. ersetzen benannte Policies/Trigger.

## Lokal testen
- `.env.local` mit den bereits verwendeten `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` beibehalten bzw. eintragen.
- Im Projektordner `npm ci` und danach `npm run build` ausführen.
- Trainerkonto testen: Mitteilung veröffentlichen/löschen, Läufe filtern, Lauf ändern und löschen, Änderungsprotokoll öffnen.
- Spielerkonto testen: Mitteilung lesen, keine Trainerverwaltung oder Audit-Ansicht erreichbar.
- iPhone/Safari testen: Login, Dashboard, Läufe und Navigation ohne horizontales Scrollen.

## Wichtiger Prüfhinweis
Der TypeScript/JSX-Quelltext wurde syntaktisch transpiliert. Ein vollständiger `npm run build` konnte in dieser Arbeitsumgebung nicht abgeschlossen werden, weil `npm ci` hier beim Paketbezug in einen Timeout lief. Deshalb ist diese ZIP noch **nicht als fehlerfrei gebaut oder produktionsfertig zertifiziert**. Vor Veröffentlichung muss der Build lokal oder in Vercel erfolgreich durchlaufen.

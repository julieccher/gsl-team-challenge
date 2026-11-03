# ATUSRUN 2.0 – Update und Einrichtung

Diese Version baut auf dem zuletzt bereitgestellten ATUSRUN-Spielerprofile-Projekt auf. Bestehende Spieler- und Laufdaten werden durch die enthaltenen Migrationen nicht absichtlich gelöscht.

## Enthalten

- Überarbeitetes Login-Layout für schmale Smartphone-Bildschirme und iPhone-Safe-Areas
- Schutz vor horizontalem Überlaufen in der App
- Trainerfilter für Spieler, Status und Datumsbereich
- Übersicht der noch offenen Laufprüfungen
- Teammitteilungen (Trainer veröffentlichen, angemeldete Spieler lesen)
- Änderungsprotokoll für Laufanlage, -bearbeitung und -löschung
- Spielerprofile mit Profilbild, Position und Kurzbeschreibung
- Spielerübersicht mit Profilkarten
- Persönliche Kennzahlen: Laufanzahl, Durchschnittsdistanz, längster Lauf und Kilometerentwicklung
- PWA-/iPhone-Home-Bildschirm-Symbole mit Läufer und Fußball

## Vor dem Update: Sicherung

1. In Supabase ein Datenbank-Backup erstellen bzw. vorab die vorhandenen Tabellen sichern.
2. In der bisherigen App unter Verwaltung ein JSON-Backup exportieren.
3. Die bisherige Projektversion lokal unverändert aufbewahren.

## Supabase-Migrationen

Im Supabase Dashboard das richtige ATUSRUN-Projekt öffnen → SQL Editor → New query. Die folgenden Dateien jeweils vollständig und in dieser Reihenfolge ausführen:

1. `SUPABASE-ATUSRUN-SPIELERPROFILE.sql`
2. `SUPABASE-LAUFPRUEFUNG.sql`
3. `SUPABASE-ATUSRUN-2.0.sql`

Die Migrationen ergänzen Profilfelder und Storage, die Entschuldigungs-/Laufprüfungsfunktionen sowie Teammitteilungen und das Lauf-Änderungsprotokoll. Nicht ausführen, wenn du nicht im richtigen ATUSRUN-Projekt bist.

## Lokal prüfen

Im Projektordner:

```bash
npm install
npm run build
npm run dev
```

Vor dem Veröffentlichen in Vercel müssen die bestehenden Umgebungsvariablen `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` unverändert vorhanden sein.

## Testliste vor Veröffentlichung

- Login auf iPhone (hochkant und quer) und Desktop
- keine horizontale Seitenverschiebung auf dem iPhone
- Spieler kann Mitteilungen lesen, aber nicht veröffentlichen oder löschen
- Trainer kann Mitteilungen veröffentlichen und löschen
- Spieler kann nur das eigene Profil bearbeiten
- Trainer kann Läufe nach Spieler, Status und Zeitraum filtern
- neuer Spieler-Lauf erscheint als offen und kann freigegeben/abgelehnt werden
- Traineränderung und Löschung erscheinen im Änderungsprotokoll
- Entschuldigung verändert nur die Wochenpunkt-Regel, nicht die Kilometer
- Profilbild wird hochgeladen und nach erneutem Login angezeigt
- Home-Bildschirm-Icon wird nach erneutem Hinzufügen der PWA angezeigt

## Hinweis zur technischen Abnahme

Der Quellcode und die Paketdateien sind enthalten. In der Erstellungsumgebung war die Paketinstallation zeitlich begrenzt; deshalb konnte hier kein erfolgreicher vollständiger `npm run build` bestätigt werden. Bitte vor dem Vercel-Deploy lokal `npm install` und `npm run build` erfolgreich ausführen. Erst danach veröffentlichen.

# Neue Laufprüfung und iPhone-Ansicht

## Enthalten
- Neue Spielereinreichungen werden mit `status = pending` angelegt.
- Spieler können Kilometer und Datum in der Einreichungsmaske nicht bearbeiten.
- Ein Screenshot wird im privaten Supabase-Storage-Bucket `run-screenshots` abgelegt.
- Trainer sehen ausstehende Einreichungen, können den Screenshot über eine zeitlich begrenzte URL öffnen und freigeben oder ablehnen.
- Nur `status = approved` fließt in Kilometer, Wochenwertung und Teamprämie ein.
- Alte Datensätze ohne Status werden in der App als `approved` interpretiert.
- Mobile Navigation und Formular-/Kartenlayouts sind für schmale iPhone-Ansichten angepasst.

## Wichtig: OCR ist keine KI-Echtheitsprüfung
Die App verwendet Tesseract.js zur Texterkennung (OCR), um Kilometer und ein mögliches Datum aus dem Screenshot vorzulesen. Die Erkennung kann falsch liegen und beweist nicht, dass ein Screenshot echt oder unverändert ist. Deshalb ist die Trainerfreigabe zwingend. Wenn Kilometer oder Datum nicht erkannt werden, soll der Spieler einen klareren Screenshot hochladen und der Trainer prüft das Original.

## Supabase vorbereiten
1. Supabase → SQL Editor → New query.
2. Den Inhalt von `SUPABASE-LAUFPRUEFUNG.sql` ausführen.
3. Prüfen, dass `runs.status`, `runs.screenshot_path` und `runs.rejection_reason` existieren. Die zuvor ausgeführte Migration sollte diese Felder bereits angelegt haben.
4. Bucket `run-screenshots` muss privat sein.

## Konfiguration
Die ZIP enthält keine persönlichen Zugangsdaten. Kopiere deine bisherige `.env.local` in den Projektordner und prüfe, dass sie die korrekte Projekt-URL und den Publishable Key enthält.

## Lokal starten
```bash
npm install
npm run dev
```

## Vor Live-Betrieb zwingend testen
- Spieler reicht Screenshot ein → Datensatz hat `pending`.
- Spieler sieht Status „Wird geprüft“ und kann den Datensatz nicht bearbeiten.
- Trainer sieht den ausstehenden Lauf und kann das Originalbild öffnen.
- Freigabe → Lauf zählt in Teamkilometer und Wertung.
- Ablehnung → Lauf zählt nicht.
- Spieler kann per direktem Supabase-Aufruf weder `status` ändern noch vorhandene Läufe aktualisieren/löschen.

Hinweis: Die App-Oberfläche ist clientseitig. Die eigentliche Sicherheit hängt von den Supabase-RLS-Policies ab. Nicht veröffentlichen, bevor die obigen Tests mit zwei getrennten Konten erfolgreich waren.

# Neue Trainerfunktionen – Installation

## Enthalten
- Trainer können in der Laufhistorie jeden Lauf bearbeiten und löschen.
- Beim Löschen wird auch der zugehörige Screenshot aus dem privaten Storage entfernt.
- In der Wochenübersicht gibt es für Trainer die Verwaltung „Entschuldigungen“.
- Eine Entschuldigung gilt für einen Spieler und eine Challenge-Woche. Sie hebt ausschließlich den Wochen-Minuspunkt unter 16 km auf. Kilometer, mögliche +1 Punkte bei mehr als 20 km und Podiumsboni bleiben erhalten.
- Spieler sehen keine Schaltflächen zum Bearbeiten/Löschen und können Entschuldigungen nicht verwalten.

## 1. Supabase SQL ausführen
1. Supabase öffnen → SQL Editor → New query.
2. Den Inhalt aus `SUPABASE-LAUFPRUEFUNG.sql` vollständig ausführen.
   Das Skript enthält die Tabelle `weekly_excuses` sowie Trainer-Policies für das Löschen von Läufen und Screenshots.

## 2. App lokal testen
```bash
npm install
npm run build
npm run dev
```

## 3. GitHub aktualisieren
Im Projektordner:
```bash
git add .
git commit -m "Trainer: Läufe bearbeiten und löschen, Wochen entschuldigen"
git push
```
Vercel startet danach automatisch ein neues Production-Deployment.

## Wichtige Hinweise
- `.env.local` ist absichtlich nicht im ZIP enthalten. Deine bestehenden Vercel-Umgebungsvariablen bleiben unverändert.
- Die App-Version in diesem ZIP basiert auf dem hochgeladenen Projektstand und enthält weiterhin die bisher fest eingestellte Challenge 2026/27.
- Die SQL-Änderungen müssen vor dem Live-Test in Supabase ausgeführt werden.

# Laufchallenge GSL – Redesign

## Start
1. ZIP entpacken.
2. Den Ordner `Laufchallenge-Redesign` in Visual Studio Code öffnen.
3. Terminal → New Terminal.
4. `npm install`
5. `npm run dev`
6. Die angezeigte Adresse öffnen (lokal meist http://localhost:5173).

## Enthalten
- Apple-inspiriertes, schlichtes rotes Design
- Dashboard mit Teamkilometern und animiertem Fortschrittsbalken
- Prämienstufen: >2300 €100, >2600 €200, >2850 €300, >3100 €400, >3300 €500
  (Schwellen werden streng überschritten gewertet)
- Wochenübersicht für 30.11.2026 bis 10.01.2027 (6 Wochen)
- Persönliche Spieleransicht und Trainer-Gesamtübersicht
- Wochenpunkte: unter 16 km -1, über 20 km +1, sonst 0
- Top-3-Wochenbonus und Abschlussbonus: Platz 1 +4, Platz 2 +3, Platz 3 +2
- Läufe vor dem Challenge-Zeitraum bleiben in der Historie, zählen aber nicht in GSL-Punkte oder Mannschaftsprämie
- Screenshot-Upload mit Tesseract OCR, manuelle Korrektur, Läufe bearbeiten/löschen
- 20 Demo-Spieler als Platzhalter, in Verwaltung umbenennen
- lokale Speicherung im Browser und JSON-Backup

## Wichtige fachliche Annahmen
- Wochen laufen Montag bis Sonntag: 30.11.–06.12., 07.12.–13.12., 14.12.–20.12.,
  21.12.–27.12., 28.12.–03.01. und 04.01.–10.01.
- Wochenbonus wird zusätzlich zum Schwellenwert-Punkt (+1 bzw. -1) vergeben.
- Bei Kilometer-Gleichstand erhalten alle Spieler denselben Rangbonus; der nächste Rang wird übersprungen.
- Die Prämienstufen werden bei strengem Überschreiten der jeweiligen Schwelle gutgeschrieben.
- Abschlussbonus basiert auf den gesamten Kilometern innerhalb der sechs Challenge-Wochen.
- Startwerte der Spieler sind Platzhalter. Bitte vor echtem Einsatz umbenennen.

## Noch nicht produktionsbereit
Diese Version speichert Daten lokal im Browser. Sie synchronisiert noch nicht zwischen mehreren Geräten.
Die Auswahl „Spieler/Trainer“ ist in dieser Vorschau kein sicherer Login. Für echte Privatsphäre und Mannschaftsbetrieb brauchen wir danach Firebase Auth und Security Rules (oder eine gleichwertige Backend-Lösung).
OCR erkennt nicht jeden Screenshot fehlerfrei; erkannte Distanz immer kontrollieren.


## Supabase-Online-Version (Anmeldung und Lauf-Synchronisierung)

Die App verwendet Supabase Auth und lädt Spielerprofile sowie Läufe aus der zentralen Datenbank.
- Anmeldung: E-Mail + Passwort (Zugänge legt der Trainer vorerst in Supabase unter Authentication → Users an).
- Profile entstehen automatisch über den eingerichteten Trigger `handle_new_user`.
- Die Rolle wird aus `profiles.role` gelesen (`player` oder `trainer`).
- Läufe werden in `public.runs` gespeichert.

### Umgebungsvariablen
Die Datei `.env.local` muss im Projektstamm liegen und diese Werte enthalten:
`VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` (Publishable Key).

### Start
`npm install`
`npm run dev`

Hinweis: Das Anlegen von Spielerkonten direkt im Trainerbereich ist noch nicht enthalten. Dafür wird eine geschützte Serverfunktion benötigt; niemals den Supabase-Secret-/service_role-Key im Frontend hinterlegen.

## Wochenplan (Trainer-Posts)

Für den neuen Wochenplan muss einmalig die Tabelle `public.weekly_plans` in Supabase angelegt werden. Im SQL Editor diesen SQL-Block ausführen:

```sql
create table if not exists public.weekly_plans (
  id uuid primary key default gen_random_uuid(),
  week_number integer not null unique check (week_number between 1 and 6),
  title text not null,
  content text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.weekly_plans enable row level security;
grant select, insert, update, delete on public.weekly_plans to authenticated;

drop policy if exists "Members can read weekly plans" on public.weekly_plans;
create policy "Members can read weekly plans"
on public.weekly_plans for select to authenticated using (true);

drop policy if exists "Trainers can insert weekly plans" on public.weekly_plans;
create policy "Trainers can insert weekly plans"
on public.weekly_plans for insert to authenticated
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'trainer'));

drop policy if exists "Trainers can update weekly plans" on public.weekly_plans;
create policy "Trainers can update weekly plans"
on public.weekly_plans for update to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'trainer'))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'trainer'));

drop policy if exists "Trainers can delete weekly plans" on public.weekly_plans;
create policy "Trainers can delete weekly plans"
on public.weekly_plans for delete to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'trainer'));
```

Alle angemeldeten Mannschaftsmitglieder können veröffentlichte Wochenpläne lesen. Nur Profile mit `role = 'trainer'` dürfen Beiträge erstellen, bearbeiten oder löschen. Die App zeigt im Menü einen eigenen Punkt „Wochenplan“; Trainer sehen dort das Eingabeformular.


## Safari-Fix
Die Erzeugung der Lauf-ID verwendet jetzt einen Safari-kompatiblen Fallback, wenn `crypto.randomUUID()` in einer lokalen HTTP-Umgebung nicht verfügbar ist. Das betrifft insbesondere Tests über eine lokale Netzwerkadresse wie `http://10.x.x.x`.

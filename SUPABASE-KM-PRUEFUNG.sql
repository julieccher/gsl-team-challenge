-- ATUSRUN: Läufe ohne erkannte Kilometer einreichen
-- Im Supabase SQL Editor ausführen.
--
-- Spieler können einen Screenshot auch dann einreichen, wenn die Texterkennung
-- keine Distanz sicher lesen konnte. Die Kilometer bleiben leer, bis der Trainer
-- sie bei der Freigabe einträgt. Ein freigegebener Lauf braucht immer km > 0.
--
-- km_check hält fest, woher der Wert stammt:
--   verified = automatisch gelesen und mit Zeit ÷ Pace gegengeprüft
--   unsure   = automatisch gelesen, aber nicht gegengeprüft
--   missing  = nicht erkannt, Trainer muss eintragen
--   manual   = vom Trainer eingetragen oder korrigiert

alter table public.runs alter column distance_km drop not null;

alter table public.runs drop constraint if exists runs_distance_km_check;
alter table public.runs add constraint runs_distance_km_check
  check (distance_km > 0 or (distance_km is null and status <> 'approved'));

alter table public.runs add column if not exists km_check text;
alter table public.runs drop constraint if exists runs_km_check_check;
alter table public.runs add constraint runs_km_check_check
  check (km_check is null or km_check in ('verified','unsure','missing','manual'));

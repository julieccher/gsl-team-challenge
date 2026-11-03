-- Ergänzende Absicherung für Trainerprüfung und Screenshot-Uploads.
-- Die vorhandenen Spieler-INSERT-Policies für status='pending' bleiben bestehen.

-- Trainer dürfen Läufe für Spieler anlegen (z.B. manuell erfasste Alt-/Korrekturläufe).
drop policy if exists "Trainers can insert runs" on public.runs;
create policy "Trainers can insert runs"
on public.runs for insert to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'trainer'
  )
);

-- Nur Trainer dürfen eingereichte Läufe freigeben/ablehnen oder korrigieren.
drop policy if exists "Trainers can review runs" on public.runs;
create policy "Trainers can review runs"
on public.runs for update to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'trainer'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'trainer'
  )
);

-- Privater Bucket; falls er schon angelegt wurde, bleibt er unverändert.
insert into storage.buckets (id, name, public)
values ('run-screenshots', 'run-screenshots', false)
on conflict (id) do nothing;

-- Spieler können nur in ihrem eigenen Benutzerordner hochladen.
drop policy if exists "Players upload own run screenshots" on storage.objects;
create policy "Players upload own run screenshots"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'run-screenshots'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Nur Trainer können Original-Screenshots lesen.
drop policy if exists "Trainers view run screenshots" on storage.objects;
create policy "Trainers view run screenshots"
on storage.objects for select to authenticated
using (
  bucket_id = 'run-screenshots'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'trainer'
  )
);

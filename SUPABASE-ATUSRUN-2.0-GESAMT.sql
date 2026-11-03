-- ATUSRUN 2.0 – Gesamtmigration
-- Im Supabase SQL Editor im richtigen Projekt ausführen.
-- Die drei Teile wurden bewusst in der empfohlenen Reihenfolge zusammengeführt.

-- 1) Spielerprofile und Avatar-Storage
-- ATUSRUN: Spielerprofile erweitern
-- Einmalig im Supabase SQL Editor ausführen.

alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists position text,
  add column if not exists bio text;

-- Öffentlicher Lesezugriff auf Profilbilder, Upload bleibt auf den eigenen Ordner beschränkt.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('player-avatars', 'player-avatars', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "Players upload own profile avatar" on storage.objects;
create policy "Players upload own profile avatar" on storage.objects
for insert to authenticated
with check (bucket_id='player-avatars' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists "Players update own profile avatar" on storage.objects;
create policy "Players update own profile avatar" on storage.objects
for update to authenticated
using (bucket_id='player-avatars' and (storage.foldername(name))[1]=auth.uid()::text)
with check (bucket_id='player-avatars' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists "Team can view profile avatars" on storage.objects;
create policy "Team can view profile avatars" on storage.objects
for select to authenticated using (bucket_id='player-avatars');

-- Spieler dürfen nur ihre eigenen Profilfelder ändern.
-- Bestehende Trainer-Update-Policies bleiben bestehen.
drop policy if exists "Players update own profile details" on public.profiles;
create policy "Players update own profile details" on public.profiles
for update to authenticated
using (id=auth.uid())
with check (id=auth.uid());

-- 2) Laufprüfung, Trainerrechte, Screenshot-Storage und Wochenentschuldigungen
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

-- Trainer-Entschuldigungen für einzelne Spieler und Challenge-Wochen.
-- Eine Entschuldigung hebt ausschließlich den Wochen-Minuspunkt auf.
create table if not exists public.weekly_excuses (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  week_number integer not null check (week_number between 1 and 6),
  reason text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (player_id, week_number)
);
alter table public.weekly_excuses enable row level security;
drop policy if exists "Team can read weekly excuses" on public.weekly_excuses;
create policy "Team can read weekly excuses" on public.weekly_excuses
for select to authenticated using (true);
drop policy if exists "Trainers manage weekly excuses" on public.weekly_excuses;
create policy "Trainers manage weekly excuses" on public.weekly_excuses
for all to authenticated
using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='trainer'))
with check (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='trainer') and created_by=auth.uid());

-- Trainer dürfen Läufe bearbeiten und löschen. Spieler dürfen dies nicht.
drop policy if exists "Trainers can delete runs" on public.runs;
create policy "Trainers can delete runs" on public.runs for delete to authenticated
using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='trainer'));

drop policy if exists "Trainers delete run screenshots" on storage.objects;
create policy "Trainers delete run screenshots" on storage.objects
for delete to authenticated
using (
  bucket_id = 'run-screenshots'
  and exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='trainer')
);

-- 3) Teammitteilungen und Lauf-Änderungsprotokoll
-- ATUSRUN 2.0: Teammitteilungen und revisionssicheres Lauf-Änderungsprotokoll
-- Im Supabase SQL Editor als Projekt-Owner ausführen.

create table if not exists public.team_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 100),
  message text not null check (char_length(trim(message)) between 1 and 4000),
  author_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.team_announcements enable row level security;
drop policy if exists "Authenticated users can read team announcements" on public.team_announcements;
create policy "Authenticated users can read team announcements"
  on public.team_announcements for select to authenticated using (true);
drop policy if exists "Trainers can publish team announcements" on public.team_announcements;
create policy "Trainers can publish team announcements"
  on public.team_announcements for insert to authenticated
  with check (author_id = auth.uid() and exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'trainer'
  ));
drop policy if exists "Trainers can delete team announcements" on public.team_announcements;
create policy "Trainers can delete team announcements"
  on public.team_announcements for delete to authenticated using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'trainer'
  ));

create table if not exists public.run_audit_log (
  id bigint generated always as identity primary key,
  run_id uuid,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  actor_id uuid,
  changed_at timestamptz not null default now(),
  old_data jsonb,
  new_data jsonb
);
create index if not exists run_audit_log_changed_at_idx on public.run_audit_log(changed_at desc);
create index if not exists run_audit_log_run_id_idx on public.run_audit_log(run_id);
alter table public.run_audit_log enable row level security;
drop policy if exists "Trainers can read run audit log" on public.run_audit_log;
create policy "Trainers can read run audit log" on public.run_audit_log
  for select to authenticated using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'trainer'
  ));

create or replace function public.log_run_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.run_audit_log(run_id,action,actor_id,new_data)
    values (NEW.id,'INSERT',auth.uid(),to_jsonb(NEW));
    return NEW;
  elsif TG_OP = 'UPDATE' then
    insert into public.run_audit_log(run_id,action,actor_id,old_data,new_data)
    values (NEW.id,'UPDATE',auth.uid(),to_jsonb(OLD),to_jsonb(NEW));
    return NEW;
  else
    insert into public.run_audit_log(run_id,action,actor_id,old_data)
    values (OLD.id,'DELETE',auth.uid(),to_jsonb(OLD));
    return OLD;
  end if;
end;
$$;

drop trigger if exists runs_audit_trigger on public.runs;
create trigger runs_audit_trigger
after insert or update or delete on public.runs
for each row execute function public.log_run_change();

-- Audit-Logs sind bewusst nicht für Clients schreibbar oder löschbar.
revoke insert, update, delete on public.run_audit_log from anon, authenticated;
grant select on public.run_audit_log to authenticated;
revoke update on public.team_announcements from anon, authenticated;
grant select, insert, delete on public.team_announcements to authenticated;

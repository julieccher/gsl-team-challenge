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

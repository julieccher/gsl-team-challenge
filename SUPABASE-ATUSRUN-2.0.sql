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

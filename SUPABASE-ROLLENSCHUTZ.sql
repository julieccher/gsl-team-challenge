-- ATUSRUN: Rollenschutz für Spielerprofile
-- Im Supabase SQL Editor ausführen.
--
-- Hintergrund: Die Policy "Users can update own name" erlaubt Spielern, die
-- gesamte eigene Profilzeile zu ändern – auch role, active und number.
-- Dieser Trigger lässt Spieler weiterhin Name, Profilbild, Position und
-- Beschreibung ändern; role, active und number dürfen nur Trainer ändern.
-- Änderungen ohne angemeldeten App-Nutzer (SQL Editor, Service-Role) bleiben erlaubt.

create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return NEW;
  end if;

  if (NEW.role is distinct from OLD.role
      or NEW.active is distinct from OLD.active
      or NEW.number is distinct from OLD.number)
     and not exists (
       select 1 from public.profiles p
       where p.id = auth.uid() and p.role = 'trainer'
     ) then
    raise exception 'Nur Trainer dürfen Rolle, Status oder Rückennummer ändern.'
      using errcode = '42501';
  end if;

  return NEW;
end;
$$;

drop trigger if exists profiles_protect_privileged_columns on public.profiles;
create trigger profiles_protect_privileged_columns
before update on public.profiles
for each row execute function public.protect_profile_privileged_columns();

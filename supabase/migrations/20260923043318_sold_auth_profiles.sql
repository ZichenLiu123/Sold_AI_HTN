-- Profiles + RLS (applied on Sold project pffqsmeiengvignkbntq)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, ''), '@', 1), '')
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon, authenticated;
grant execute on function public.handle_new_user() to postgres, service_role;

create or replace function public.auto_confirm_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update auth.users
  set email_confirmed_at = coalesce(email_confirmed_at, now())
  where id = new.id
    and email_confirmed_at is null;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_confirm on auth.users;
create trigger on_auth_user_created_confirm
  after insert on auth.users
  for each row execute function public.auto_confirm_user();

revoke all on function public.auto_confirm_user() from public;
revoke all on function public.auto_confirm_user() from anon, authenticated;
grant execute on function public.auto_confirm_user() to postgres, service_role;

-- Free notes: not tied to a time, an activity or a pain. Write anything.
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null check (length(body) between 1 and 10000),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notes_user_idx on public.notes (user_id, pinned desc, updated_at desc);

alter table public.notes enable row level security;
create policy "own_select" on public.notes for select to authenticated using ((select auth.uid()) = user_id);
create policy "own_insert" on public.notes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own_update" on public.notes for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own_delete" on public.notes for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger notes_updated_at before update on public.notes
  for each row execute function public.touch_updated_at();

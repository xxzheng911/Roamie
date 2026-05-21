
-- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  travel_personality jsonb default '{}'::jsonb,
  ai_preferences jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles self select" on public.profiles for select using (auth.uid() = id);
create policy "profiles self insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles self update" on public.profiles for update using (auth.uid() = id);
create policy "profiles self delete" on public.profiles for delete using (auth.uid() = id);

-- saved_trips
create table public.saved_trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mood text,
  title text not null,
  cover_image text,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.saved_trips enable row level security;
create policy "trips self all" on public.saved_trips for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- chat_messages
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
alter table public.chat_messages enable row level security;
create policy "chat self all" on public.chat_messages for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- itineraries
create table public.itineraries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  city text,
  mood text,
  blocks jsonb default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.itineraries enable row level security;
create policy "itin self all" on public.itineraries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at trigger for profiles
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

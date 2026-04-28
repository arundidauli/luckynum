create table if not exists public.shared_rounds (
  round_no bigint primary key,
  starts_at timestamptz not null,
  betting_closes_at timestamptz not null,
  reveal_at timestamptz not null,
  ends_at timestamptz not null,
  commit_hash text not null,
  reveal_seed text not null,
  winning_number smallint,
  revealed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  check (winning_number is null or winning_number between 1 and 10),
  check (starts_at < betting_closes_at),
  check (betting_closes_at < reveal_at),
  check (reveal_at < ends_at)
);

create table if not exists public.round_bets (
  round_no bigint not null references public.shared_rounds (round_no) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  picked_number smallint not null check (picked_number between 1 and 10),
  amount integer not null check (amount > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (round_no, user_id)
);

drop trigger if exists set_round_bets_updated_at on public.round_bets;
create trigger set_round_bets_updated_at
before update on public.round_bets
for each row execute procedure public.set_updated_at();

alter table public.shared_rounds enable row level security;
alter table public.round_bets enable row level security;

drop policy if exists "shared_rounds_select_all" on public.shared_rounds;
create policy "shared_rounds_select_all"
on public.shared_rounds
for select
to authenticated
using (true);

drop policy if exists "round_bets_select_own" on public.round_bets;
create policy "round_bets_select_own"
on public.round_bets
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "round_bets_insert_own" on public.round_bets;
create policy "round_bets_insert_own"
on public.round_bets
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "round_bets_update_own" on public.round_bets;
create policy "round_bets_update_own"
on public.round_bets
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.sync_shared_rounds()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  round_epoch constant timestamptz := '2026-01-01 00:00:00+00'::timestamptz;
  round_span constant interval := interval '70 second';
  betting_span constant interval := interval '45 second';
  reveal_delay constant interval := interval '6 second';
  now_ts timestamptz := timezone('utc', now());
  current_round_no bigint;
  target_round_no bigint;
  round_start timestamptz;
  round_seed text;
begin
  current_round_no :=
    greatest(1, floor(extract(epoch from (now_ts - round_epoch)) / 70)::bigint + 1);

  for target_round_no in current_round_no..current_round_no + 1 loop
    round_start := round_epoch + ((target_round_no - 1) * round_span);
    round_seed := encode(gen_random_bytes(24), 'hex');

    insert into public.shared_rounds (
      round_no,
      starts_at,
      betting_closes_at,
      reveal_at,
      ends_at,
      commit_hash,
      reveal_seed
    )
    values (
      target_round_no,
      round_start,
      round_start + betting_span,
      round_start + betting_span + reveal_delay,
      round_start + round_span,
      encode(digest(round_seed, 'sha256'), 'hex'),
      round_seed
    )
    on conflict (round_no) do nothing;
  end loop;

  update public.shared_rounds
  set
    winning_number = (
      (
        (
          (get_byte(digest(reveal_seed, 'sha256'), 0)::bigint << 24) +
          (get_byte(digest(reveal_seed, 'sha256'), 1)::bigint << 16) +
          (get_byte(digest(reveal_seed, 'sha256'), 2)::bigint << 8) +
          get_byte(digest(reveal_seed, 'sha256'), 3)::bigint
        ) % 10
      ) + 1
    )::smallint,
    revealed_at = coalesce(revealed_at, now_ts)
  where winning_number is null
    and now_ts >= reveal_at;

  return current_round_no;
end;
$$;

grant execute on function public.sync_shared_rounds() to authenticated;

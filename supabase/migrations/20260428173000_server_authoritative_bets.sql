alter table public.profiles
  add column if not exists balance integer not null default 500,
  add column if not exists wins integer not null default 0,
  add column if not exists losses integer not null default 0;

alter table public.round_bets
  add column if not exists is_winner boolean,
  add column if not exists payout integer not null default 0,
  add column if not exists settled_at timestamptz;

create or replace function public.place_round_bet(
  input_round_no bigint,
  input_picked_number smallint,
  input_amount integer
)
returns table (
  round_no bigint,
  picked_number smallint,
  amount integer,
  balance integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  round_row public.shared_rounds%rowtype;
  profile_balance integer;
  previous_amount integer := 0;
  next_balance integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if input_picked_number < 1 or input_picked_number > 10 then
    raise exception 'Pick a number from 1 to 10';
  end if;

  if input_amount <= 0 then
    raise exception 'Bet amount must be positive';
  end if;

  select *
  into round_row
  from public.shared_rounds
  where shared_rounds.round_no = input_round_no
  for update;

  if not found then
    raise exception 'Round not found';
  end if;

  if timezone('utc', now()) >= round_row.betting_closes_at then
    raise exception 'Betting closed for this round';
  end if;

  select p.balance
  into profile_balance
  from public.profiles p
  where p.id = current_user_id
  for update;

  if not found then
    raise exception 'Profile not found';
  end if;

  select rb.amount
  into previous_amount
  from public.round_bets rb
  where rb.round_no = input_round_no
    and rb.user_id = current_user_id
  for update;

  previous_amount := coalesce(previous_amount, 0);
  next_balance := profile_balance + previous_amount - input_amount;

  if next_balance < 0 then
    raise exception 'Balance too low';
  end if;

  update public.profiles p
  set
    balance = next_balance,
    updated_at = timezone('utc', now())
  where p.id = current_user_id;

  insert into public.round_bets (
    round_no,
    user_id,
    picked_number,
    amount
  )
  values (
    input_round_no,
    current_user_id,
    input_picked_number,
    input_amount
  )
  on conflict (round_no, user_id) do update
  set
    picked_number = excluded.picked_number,
    amount = excluded.amount,
    updated_at = timezone('utc', now());

  return query
  select
    input_round_no,
    input_picked_number,
    input_amount,
    next_balance;
end;
$$;

create or replace function public.get_recent_round_history(limit_count integer default 12)
returns table (
  round_no bigint,
  winning_number smallint,
  winner_names text,
  winner_count integer
)
language sql
security definer
set search_path = public
as $$
  select
    sr.round_no,
    sr.winning_number,
    coalesce(string_agg(p.username, ', ' order by p.username) filter (where rb.is_winner), 'No winners') as winner_names,
    count(*) filter (where rb.is_winner)::integer as winner_count
  from public.shared_rounds sr
  left join public.round_bets rb
    on rb.round_no = sr.round_no
   and rb.settled_at is not null
  left join public.profiles p
    on p.id = rb.user_id
  where sr.winning_number is not null
  group by sr.round_no, sr.winning_number
  order by sr.round_no desc
  limit greatest(limit_count, 1);
$$;

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

  with unsettled as (
    select
      rb.round_no,
      rb.user_id,
      rb.amount,
      rb.picked_number,
      sr.winning_number,
      (rb.picked_number = sr.winning_number) as is_winner,
      case
        when rb.picked_number = sr.winning_number then round(rb.amount * 1.8)::integer
        else 0
      end as payout
    from public.round_bets rb
    join public.shared_rounds sr
      on sr.round_no = rb.round_no
    where rb.settled_at is null
      and sr.winning_number is not null
    for update of rb skip locked
  ),
  profile_updates as (
    update public.profiles p
    set
      balance = p.balance + unsettled.payout,
      wins = p.wins + case when unsettled.is_winner then 1 else 0 end,
      losses = p.losses + case when unsettled.is_winner then 0 else 1 end,
      updated_at = timezone('utc', now())
    from unsettled
    where p.id = unsettled.user_id
    returning
      unsettled.round_no,
      unsettled.user_id,
      unsettled.is_winner,
      unsettled.payout
  )
  update public.round_bets rb
  set
    is_winner = profile_updates.is_winner,
    payout = profile_updates.payout,
    settled_at = now_ts
  from profile_updates
  where rb.round_no = profile_updates.round_no
    and rb.user_id = profile_updates.user_id
    and rb.settled_at is null;

  return current_round_no;
end;
$$;

grant execute on function public.place_round_bet(bigint, smallint, integer) to authenticated;
grant execute on function public.get_recent_round_history(integer) to authenticated;
grant execute on function public.sync_shared_rounds() to authenticated;

drop function if exists public.place_round_bet(bigint, smallint, integer);

create or replace function public.place_round_bet(
  input_round_no bigint,
  input_picked_number smallint,
  input_amount integer
)
returns table (
  _round_no bigint,
  _picked_number smallint,
  _amount integer,
  _balance integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  round_row public.shared_rounds%rowtype;
  v_profile_balance integer;
  v_previous_amount integer := 0;
  v_next_balance integer;
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
  from public.shared_rounds sr
  where sr.round_no = input_round_no
  for update;

  if not found then
    raise exception 'Round not found';
  end if;

  if timezone('utc', now()) >= round_row.betting_closes_at then
    raise exception 'Betting closed for this round';
  end if;

  select p.balance
  into v_profile_balance
  from public.profiles p
  where p.id = current_user_id
  for update;

  if not found then
    raise exception 'Profile not found';
  end if;

  select rb.amount
  into v_previous_amount
  from public.round_bets rb
  where rb.round_no = input_round_no
    and rb.user_id = current_user_id
  for update;

  v_previous_amount := coalesce(v_previous_amount, 0);
  v_next_balance := v_profile_balance + v_previous_amount - input_amount;

  if v_next_balance < 0 then
    raise exception 'Balance too low';
  end if;

  update public.profiles p
  set
    balance = v_next_balance,
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
    v_next_balance;
end;
$$;

grant execute on function public.place_round_bet(bigint, smallint, integer) to authenticated;

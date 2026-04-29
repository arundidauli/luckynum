create or replace function public.cleanup_previous_day_rounds()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  utc_day_start timestamptz := date_trunc('day', timezone('utc', now()));
begin
  delete from public.shared_rounds sr
  where sr.ends_at < utc_day_start;
end;
$$;

grant execute on function public.cleanup_previous_day_rounds() to authenticated;

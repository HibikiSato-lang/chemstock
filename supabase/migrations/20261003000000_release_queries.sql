-- Only the settings needed for daily operation are visible to every account.
create function private.read_app_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not exists (select 1 from public.accounts where id = auth.uid()) then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  select pg_catalog.jsonb_build_object(
    'unitGalToL', (select value::numeric from public.settings where key = 'unit_gal_to_l'),
    'unitTokanToL', (select value::numeric from public.settings where key = 'unit_tokan_to_l'),
    'forecastWindowDays', (select value::integer from public.settings where key = 'forecast_window_days')
  ) into v_result;
  if v_result->'unitGalToL' = 'null'::jsonb or
     v_result->'unitTokanToL' = 'null'::jsonb or
     v_result->'forecastWindowDays' = 'null'::jsonb then
    raise exception 'REQUIRED_SETTING_MISSING' using errcode = '23514';
  end if;
  return v_result;
end;
$$;
revoke all on function private.read_app_settings() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.read_app_settings() to authenticated;

create function public.app_settings()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.read_app_settings(); $$;
revoke all on function public.app_settings() from public, anon, authenticated;
grant execute on function public.app_settings() to authenticated;

-- Forecasts are scoped to the caller's own research room. A global admin may
-- choose a room in the UI; that role can inspect all rooms for support work.
create function private.read_inventory_forecasts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_account public.accounts%rowtype;
  v_days integer;
  v_result jsonb;
begin
  select * into v_account from public.accounts where id = auth.uid();
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  select value::integer into v_days from public.settings where key = 'forecast_window_days';
  if v_days is null or v_days not between 1 and 365 then
    raise exception 'REQUIRED_SETTING_MISSING' using errcode = '23514';
  end if;

  with consumption as (
    select i.id, i.amount, i.low_stock_threshold, i.is_active,
           coalesce(-sum(l.change_amount) filter (
             where l.status = 'active' and l.change_amount < 0
               and l.occurred_at >= pg_catalog.now() - v_days * interval '1 day'
               and l.occurred_at <= pg_catalog.now()
           ), 0)::numeric as used
    from public.inventory i
    left join public.inventory_logs l on l.inventory_id = i.id
    where v_account.role = 'global_admin' or i.room_id = v_account.room_id
    group by i.id
  ), scored as (
    select id, amount, low_stock_threshold, is_active,
           used / v_days as daily_use,
           case when used > 0 and low_stock_threshold is not null and amount > low_stock_threshold
                then (amount - low_stock_threshold) / (used / v_days)
                else null end as days_until
    from consumption
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'inventoryId', id,
    'dailyUse', daily_use,
    'daysUntilLow', case when days_until <= 365 then days_until else null end,
    'forecastAt', case when days_until <= 365
                       then pg_catalog.now() + days_until * interval '1 day'
                       else null end,
    'status', case when not is_active then 'inactive'
                   when low_stock_threshold is null then 'threshold_not_set'
                   when amount <= low_stock_threshold then 'already_below_threshold'
                   when daily_use <= 0 then 'no_outbound_history'
                   when days_until > 365 then 'beyond_horizon'
                   else 'forecast' end
  ) order by id), '[]'::jsonb) into v_result
  from scored;
  return v_result;
end;
$$;
revoke all on function private.read_inventory_forecasts() from public, anon, authenticated;
grant execute on function private.read_inventory_forecasts() to authenticated;

create function public.inventory_forecasts()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.read_inventory_forecasts(); $$;
revoke all on function public.inventory_forecasts() from public, anon, authenticated;
grant execute on function public.inventory_forecasts() to authenticated;

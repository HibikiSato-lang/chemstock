-- The only public read path for global designated quantities and notices.
create function private.read_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_total numeric;
  v_warning numeric;
  v_breakdown jsonb;
  v_unconfigured jsonb;
  v_notices jsonb;
  v_unread integer;
begin
  select role into v_role from public.accounts where id = auth.uid();
  if v_role is null or v_role not in ('solvent_room_admin', 'global_admin') then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  select total_ratio into v_total from private.designated_quantity_status;
  select value::numeric into v_warning from public.settings where key = 'warning_ratio';
  if v_warning is null then
    raise exception 'warning_ratio setting is missing';
  end if;

  with totals as (
    select s.id, s.name, s.designated_quantity, sum(i.amount) as amount
    from public.inventory i
    join public.solvents s on s.id = i.solvent_id
    where i.is_active and i.amount > 0
    group by s.id, s.name, s.designated_quantity
  )
  select
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'solventId', id, 'solventName', name, 'amount', amount,
      'baseUnit', 'L', 'designatedQuantity', designated_quantity,
      'ratio', amount / designated_quantity
    ) order by name) filter (where designated_quantity is not null), '[]'::jsonb),
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'solventId', id, 'solventName', name, 'amount', amount
    ) order by name) filter (where designated_quantity is null), '[]'::jsonb)
  into v_breakdown, v_unconfigured
  from totals;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(n) order by n.notified_at desc), '[]'::jsonb),
         count(*) filter (where n.status = 'unread')
    into v_notices, v_unread
  from public.notifications n;

  return pg_catalog.jsonb_build_object(
    'totalRatio', v_total,
    'warningRatio', v_warning,
    'state', case when v_total >= 1 then 'exceeded'
                  when v_total >= v_warning then 'warning' else 'normal' end,
    'breakdown', v_breakdown,
    'unconfiguredSolvents', v_unconfigured,
    'unreadNotificationCount', v_unread,
    'notifications', v_notices
  );
end;
$$;

revoke all on function private.read_admin_overview() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.read_admin_overview() to authenticated;

create function public.admin_overview()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.read_admin_overview();
$$;

revoke all on function public.admin_overview() from public, anon, authenticated;
grant execute on function public.admin_overview() to authenticated;

-- All inventories belong to the single solvent room. Only trusted commands
-- may write these tables, and each such command takes the shared lock first.
create view private.designated_quantity_status as
select coalesce(sum(i.amount / s.designated_quantity), 0)::numeric as total_ratio
from public.inventory i
join public.solvents s on s.id = i.solvent_id
where i.is_active and s.designated_quantity is not null;

revoke all on private.designated_quantity_status from public, anon, authenticated;

create function private.recheck_designated_quantity()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ratio numeric;
  v_armed boolean;
begin
  select total_ratio into v_ratio from private.designated_quantity_status;

  if v_ratio < 1 then
    update public.settings set value = 'true' where key = 'dq_arm_over';
    if not found then
      raise exception 'dq_arm_over setting is missing';
    end if;
    return null;
  end if;

  select value::boolean into v_armed from public.settings where key = 'dq_arm_over';
  if not found then
    raise exception 'dq_arm_over setting is missing';
  end if;

  if v_armed then
    insert into public.notifications (type, ratio, message, status)
    values (
      'designated_quantity_exceeded',
      round(v_ratio, 3),
      pg_catalog.format('指定数量の倍数が %s になり、1.0以上となりました', round(v_ratio, 2)),
      'unread'
    ) on conflict do nothing;
    update public.settings set value = 'false' where key = 'dq_arm_over';
  end if;
  return null;
end;
$$;

revoke all on function private.recheck_designated_quantity() from public, anon, authenticated;

create trigger recheck_designated_quantity_inventory_insert
after insert on public.inventory
for each statement execute function private.recheck_designated_quantity();

create trigger recheck_designated_quantity_inventory_update
after update of amount, is_active, solvent_id on public.inventory
for each statement execute function private.recheck_designated_quantity();

create trigger recheck_designated_quantity_solvents
after update of designated_quantity on public.solvents
for each statement execute function private.recheck_designated_quantity();

-- Daily room-solvent management and global administration. Every write
-- rechecks the authenticated account before taking the designated-quantity lock.

create function private.activate_room_solvent(
  p_room_id uuid, p_solvent_id uuid, p_operator_name text,
  p_reason text, p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_account public.accounts%rowtype;
  v_stock public.inventory%rowtype;
  v_existing public.command_requests%rowtype;
  v_request_id uuid;
  v_args jsonb;
  v_before jsonb;
  v_result jsonb;
  v_action text;
  v_operator text := pg_catalog.btrim(coalesce(p_operator_name, ''));
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
begin
  if p_room_id is null or p_solvent_id is null or p_idempotency_key is null
     or pg_catalog.char_length(v_operator) not between 1 and 100
     or pg_catalog.char_length(v_reason) not between 1 and 200 then
    raise exception 'INVALID_COMMAND' using errcode = '22023';
  end if;
  select * into v_account from public.accounts where id = auth.uid() for share;
  if not found or (v_account.role <> 'global_admin' and v_account.room_id <> p_room_id) then
    raise exception 'TARGET_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.rooms where id = p_room_id)
     or not exists (select 1 from public.solvents where id = p_solvent_id) then
    raise exception 'TARGET_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(1128813396, 1);
  v_args := pg_catalog.jsonb_build_object('roomId', p_room_id,
    'solventId', p_solvent_id, 'operatorName', v_operator, 'reason', v_reason);
  insert into public.command_requests
    (account_id, idempotency_key, operation, target_id, arguments)
  values (v_account.id, p_idempotency_key, 'activate_room_solvent',
          p_room_id::text || '/' || p_solvent_id::text, v_args)
  on conflict (account_id, idempotency_key) do nothing
  returning id into v_request_id;
  if v_request_id is null then
    select * into v_existing from public.command_requests
      where account_id = v_account.id and idempotency_key = p_idempotency_key;
    if not found or v_existing.operation <> 'activate_room_solvent'
       or v_existing.target_id <> p_room_id::text || '/' || p_solvent_id::text
       or v_existing.arguments <> v_args then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '23505';
    end if;
    return v_existing.result;
  end if;
  select * into v_stock from public.inventory
    where room_id = p_room_id and solvent_id = p_solvent_id for update;
  v_before := case when found then pg_catalog.to_jsonb(v_stock) else '{}'::jsonb end;
  if found and v_stock.is_active then
    raise exception 'ALREADY_ACTIVE' using errcode = '23514';
  end if;
  if v_stock.id is null then
    insert into public.inventory (room_id, solvent_id)
      values (p_room_id, p_solvent_id) returning * into v_stock;
    v_action := 'activate';
  else
    update public.inventory set is_active = true where id = v_stock.id
      returning * into v_stock;
    v_action := 'reactivate';
  end if;
  insert into public.operation_audits
    (account_id, command_request_id, target_type, target_id, action,
     operator_name, reason, before_value, after_value)
  values (v_account.id, v_request_id, 'inventory', v_stock.id::text, v_action,
          v_operator, v_reason, v_before, pg_catalog.to_jsonb(v_stock));
  v_result := pg_catalog.jsonb_build_object('inventory', pg_catalog.to_jsonb(v_stock));
  update public.command_requests set result = v_result where id = v_request_id;
  return v_result;
end;
$$;
revoke all on function private.activate_room_solvent(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.activate_room_solvent(uuid, uuid, text, text, uuid)
  to authenticated;

create function public.activate_room_solvent(
  p_room_id uuid, p_solvent_id uuid, p_operator_name text,
  p_reason text, p_idempotency_key uuid
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.activate_room_solvent(p_room_id, p_solvent_id,
                                          p_operator_name, p_reason, p_idempotency_key); $$;
revoke all on function public.activate_room_solvent(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.activate_room_solvent(uuid, uuid, text, text, uuid)
  to authenticated;

create function private.read_admin_management()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role text;
  v_result jsonb;
begin
  select role into v_role from public.accounts where id = auth.uid();
  if v_role not in ('solvent_room_admin', 'global_admin') or v_role is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  select pg_catalog.jsonb_build_object(
    'solvents', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', id, 'designatedQuantity', designated_quantity) order by name), '[]'::jsonb)
      from public.solvents),
    'warningRatio', (select value::numeric from public.settings where key = 'warning_ratio'),
    'forecastWindowDays', (select value::integer from public.settings where key = 'forecast_window_days')
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function private.read_admin_management() from public, anon, authenticated;
grant execute on function private.read_admin_management() to authenticated;
create function public.admin_management()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.read_admin_management(); $$;
revoke all on function public.admin_management() from public, anon, authenticated;
grant execute on function public.admin_management() to authenticated;

create function private.execute_admin_management(
  p_operation text, p_target_id text, p_payload jsonb, p_idempotency_key uuid
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_account public.accounts%rowtype;
  v_existing public.command_requests%rowtype;
  v_solvent public.solvents%rowtype;
  v_request_id uuid;
  v_args jsonb;
  v_result jsonb;
  v_before jsonb;
  v_target text;
  v_operator text;
  v_reason text;
  v_quantity numeric;
  v_value text;
  v_setting text;
  v_name text;
  v_cas text;
begin
  if p_operation not in ('create_solvent', 'update_designated', 'update_setting')
     or p_operation is null or p_idempotency_key is null
     or p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_COMMAND' using errcode = '22023';
  end if;
  select * into v_account from public.accounts where id = auth.uid() for share;
  if not found or v_account.role <> 'global_admin' then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  v_operator := pg_catalog.btrim(coalesce(p_payload->>'operatorName', ''));
  v_reason := pg_catalog.btrim(coalesce(p_payload->>'reason', ''));
  if pg_catalog.char_length(v_operator) not between 1 and 100
     or pg_catalog.char_length(v_reason) not between 1 and 200 then
    raise exception 'INVALID_OPERATOR_OR_REASON' using errcode = '22023';
  end if;
  case p_operation
    when 'create_solvent' then
      v_name := pg_catalog.btrim(coalesce(p_payload->>'name', ''));
      v_cas := pg_catalog.btrim(coalesce(p_payload->>'casNumber', ''));
      if v_name = '' or v_cas = '' or pg_catalog.char_length(v_name) > 200
         or pg_catalog.char_length(v_cas) > 100 then
        raise exception 'INVALID_SOLVENT' using errcode = '22023';
      end if;
      v_quantity := nullif(p_payload->>'designatedQuantity', '')::numeric;
      if v_quantity is not null and
         (v_quantity <= 0 or v_quantity >= 100000000 or v_quantity <> pg_catalog.round(v_quantity, 2)) then
        raise exception 'INVALID_DESIGNATED_QUANTITY' using errcode = '22023';
      end if;
      v_target := 'new:' || v_cas;
      v_args := pg_catalog.jsonb_build_object('name', v_name, 'casNumber', v_cas,
        'formula', nullif(pg_catalog.btrim(coalesce(p_payload->>'formula', '')), ''),
        'molecularWeight', nullif(pg_catalog.btrim(coalesce(p_payload->>'molecularWeight', '')), ''),
        'designatedQuantity', v_quantity, 'operatorName', v_operator, 'reason', v_reason);
    when 'update_designated' then
      if p_target_id is null then raise exception 'INVALID_COMMAND' using errcode = '22023'; end if;
      v_quantity := nullif(p_payload->>'designatedQuantity', '')::numeric;
      if v_quantity is not null and
         (v_quantity <= 0 or v_quantity >= 100000000 or v_quantity <> pg_catalog.round(v_quantity, 2)) then
        raise exception 'INVALID_DESIGNATED_QUANTITY' using errcode = '22023';
      end if;
      v_target := p_target_id;
      v_args := pg_catalog.jsonb_build_object('designatedQuantity', v_quantity,
        'operatorName', v_operator, 'reason', v_reason);
    when 'update_setting' then
      if p_target_id not in ('warning_ratio', 'forecast_window_days') or p_target_id is null then
        raise exception 'INVALID_SETTING' using errcode = '22023';
      end if;
      v_setting := p_target_id;
      v_value := p_payload->>'value';
      if not private.valid_setting_value(v_setting, v_value) then
        raise exception 'INVALID_SETTING' using errcode = '22023';
      end if;
      v_target := v_setting;
      v_args := pg_catalog.jsonb_build_object('value', v_value,
        'operatorName', v_operator, 'reason', v_reason);
  end case;

  perform pg_catalog.pg_advisory_xact_lock(1128813396, 1);
  insert into public.command_requests
    (account_id, idempotency_key, operation, target_id, arguments)
  values (v_account.id, p_idempotency_key, p_operation, v_target, v_args)
  on conflict (account_id, idempotency_key) do nothing
  returning id into v_request_id;
  if v_request_id is null then
    select * into v_existing from public.command_requests
      where account_id = v_account.id and idempotency_key = p_idempotency_key;
    if not found or v_existing.operation <> p_operation
       or v_existing.target_id <> v_target or v_existing.arguments <> v_args then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '23505';
    end if;
    return v_existing.result;
  end if;

  case p_operation
    when 'create_solvent' then
      insert into public.solvents (name, cas_number, formula, molecular_weight,
                                   designated_quantity)
        values (v_name, v_cas, v_args->>'formula', v_args->>'molecularWeight', v_quantity)
        returning * into v_solvent;
      v_result := pg_catalog.to_jsonb(v_solvent);
      insert into public.operation_audits
        (account_id, command_request_id, target_type, target_id, action,
         operator_name, reason, before_value, after_value)
        values (v_account.id, v_request_id, 'solvent', v_solvent.id::text, 'create',
                v_operator, v_reason, '{}'::jsonb, v_result);
    when 'update_designated' then
      select * into v_solvent from public.solvents where id = v_target::uuid for update;
      if not found then raise exception 'TARGET_NOT_FOUND' using errcode = 'P0002'; end if;
      v_before := pg_catalog.to_jsonb(v_solvent);
      update public.solvents set designated_quantity = v_quantity where id = v_solvent.id
        returning * into v_solvent;
      v_result := pg_catalog.to_jsonb(v_solvent);
      insert into public.operation_audits
        (account_id, command_request_id, target_type, target_id, action,
         operator_name, reason, before_value, after_value)
        values (v_account.id, v_request_id, 'solvent', v_solvent.id::text, 'update_designated',
                v_operator, v_reason, v_before, v_result);
    when 'update_setting' then
      select value into v_before from public.settings where key = v_setting for update;
      if not found then raise exception 'TARGET_NOT_FOUND' using errcode = 'P0002'; end if;
      update public.settings set value = v_value where key = v_setting;
      v_result := pg_catalog.jsonb_build_object('key', v_setting, 'value', v_value);
      insert into public.operation_audits
        (account_id, command_request_id, target_type, target_id, action,
         operator_name, reason, before_value, after_value)
        values (v_account.id, v_request_id, 'setting', v_setting, 'update_setting',
                v_operator, v_reason,
                pg_catalog.jsonb_build_object('key', v_setting, 'value', v_before), v_result);
  end case;
  update public.command_requests set result = v_result where id = v_request_id;
  return v_result;
end;
$$;
revoke all on function private.execute_admin_management(text, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function private.execute_admin_management(text, text, jsonb, uuid)
  to authenticated;

create function public.admin_management_command(
  p_operation text, p_target_id text, p_payload jsonb, p_idempotency_key uuid
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.execute_admin_management(p_operation, p_target_id,
                                               p_payload, p_idempotency_key); $$;
revoke all on function public.admin_management_command(text, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_management_command(text, text, jsonb, uuid)
  to authenticated;

-- The public entry point uses the caller's role. The private implementation
-- owns the atomic write and repeats authorization from auth.uid().
-- The deferred constraint runs at COMMIT, after the caller's role is restored.
alter function private.ensure_command_result() security definer;

create function private.execute_inventory_command(
  p_operation text,
  p_target_id uuid,
  p_payload jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_account public.accounts%rowtype;
  v_inventory public.inventory%rowtype;
  v_log public.inventory_logs%rowtype;
  v_existing public.command_requests%rowtype;
  v_room_id uuid;
  v_request_id uuid;
  v_audit_id uuid;
  v_arguments jsonb;
  v_result jsonb;
  v_before jsonb;
  v_operator text;
  v_log_operator text;
  v_reason text;
  v_purpose text;
  v_change numeric;
  v_next_amount numeric;
  v_threshold numeric;
  v_occurred_input timestamptz;
  v_occurred_at timestamptz;
  v_expected_updated timestamptz;
begin
  if p_operation is null or p_operation not in ('movement', 'cancel', 'correct', 'threshold', 'deactivate')
     or p_target_id is null or p_idempotency_key is null
     or p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_COMMAND' using errcode = '22023';
  end if;

  select * into v_account from public.accounts where id = auth.uid() for share;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  -- Check ownership before the shared lock and again after row locking.
  if p_operation in ('cancel', 'correct') then
    select i.room_id into v_room_id
    from public.inventory_logs l
    join public.inventory i on i.id = l.inventory_id
    where l.id = p_target_id;
  else
    select room_id into v_room_id from public.inventory where id = p_target_id;
  end if;
  if v_room_id is null or (v_account.role <> 'global_admin' and v_account.room_id <> v_room_id) then
    raise exception 'TARGET_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_operation = 'correct' then
    v_operator := pg_catalog.btrim(coalesce(p_payload->>'changedByName', ''));
    v_log_operator := pg_catalog.btrim(coalesce(p_payload->>'operatorName', ''));
  else
    v_operator := pg_catalog.btrim(coalesce(p_payload->>'operatorName', ''));
  end if;
  if pg_catalog.char_length(v_operator) not between 1 and 100 then
    raise exception 'INVALID_OPERATOR' using errcode = '22023';
  end if;

  if p_operation <> 'movement' then
    v_reason := pg_catalog.btrim(coalesce(p_payload->>'reason', ''));
    if pg_catalog.char_length(v_reason) not between 1 and 200 then
      raise exception 'INVALID_REASON' using errcode = '22023';
    end if;
  end if;

  if p_operation in ('movement', 'correct') then
    v_change := (p_payload->>'changeAmount')::numeric;
    if v_change is null or v_change = 0 or v_change <> pg_catalog.round(v_change, 2)
       or pg_catalog.abs(v_change) >= 100000000 then
      raise exception 'INVALID_AMOUNT' using errcode = '22023';
    end if;
    if p_payload->>'occurredAt' is not null then
      v_occurred_input := (p_payload->>'occurredAt')::timestamptz;
    elsif p_operation = 'correct' then
      raise exception 'INVALID_OCCURRED_AT' using errcode = '22023';
    end if;
    if v_occurred_input > pg_catalog.statement_timestamp() then
      raise exception 'INVALID_OCCURRED_AT' using errcode = '22023';
    end if;
  end if;

  case p_operation
    when 'movement' then
      v_purpose := nullif(pg_catalog.btrim(coalesce(p_payload->>'purpose', '')), '');
      if pg_catalog.char_length(coalesce(v_purpose, '')) > 500 then
        raise exception 'INVALID_PURPOSE' using errcode = '22023';
      end if;
      v_arguments := pg_catalog.jsonb_build_object(
        'changeAmount', v_change, 'operatorName', v_operator,
        'purpose', v_purpose, 'occurredAt', v_occurred_input
      );
    when 'cancel' then
      v_arguments := pg_catalog.jsonb_build_object('operatorName', v_operator, 'reason', v_reason);
    when 'correct' then
      if pg_catalog.char_length(v_log_operator) not between 1 and 100 then
        raise exception 'INVALID_OPERATOR' using errcode = '22023';
      end if;
      v_arguments := pg_catalog.jsonb_build_object(
        'changeAmount', v_change, 'operatorName', v_log_operator,
        'occurredAt', v_occurred_input, 'changedByName', v_operator, 'reason', v_reason
      );
    when 'threshold' then
      if not p_payload ? 'threshold' or p_payload->>'expectedLastUpdated' is null then
        raise exception 'INVALID_THRESHOLD' using errcode = '22023';
      end if;
      if pg_catalog.jsonb_typeof(p_payload->'threshold') <> 'null' then
        v_threshold := (p_payload->>'threshold')::numeric;
        if v_threshold < 0 or v_threshold <> pg_catalog.round(v_threshold, 2)
           or v_threshold >= 100000000 then
          raise exception 'INVALID_THRESHOLD' using errcode = '22023';
        end if;
      end if;
      v_expected_updated := (p_payload->>'expectedLastUpdated')::timestamptz;
      v_arguments := pg_catalog.jsonb_build_object(
        'threshold', v_threshold, 'operatorName', v_operator, 'reason', v_reason,
        'expectedLastUpdated', v_expected_updated
      );
    when 'deactivate' then
      v_arguments := pg_catalog.jsonb_build_object('operatorName', v_operator, 'reason', v_reason);
  end case;

  if p_operation <> 'threshold' then
    perform pg_catalog.pg_advisory_xact_lock(1128813396, 1);
  end if;

  insert into public.command_requests
    (account_id, idempotency_key, operation, target_id, arguments)
  values (v_account.id, p_idempotency_key, p_operation, p_target_id::text, v_arguments)
  on conflict (account_id, idempotency_key) do nothing
  returning id into v_request_id;

  if v_request_id is null then
    select * into v_existing from public.command_requests
    where account_id = v_account.id and idempotency_key = p_idempotency_key;
    if not found or v_existing.operation is distinct from p_operation
       or v_existing.target_id is distinct from p_target_id::text
       or v_existing.arguments is distinct from v_arguments then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '23505';
    end if;
    return v_existing.result;
  end if;

  if p_operation in ('cancel', 'correct') then
    select * into v_log from public.inventory_logs where id = p_target_id for update;
    if not found then
      raise exception 'TARGET_NOT_FOUND' using errcode = 'P0002';
    end if;
    select * into v_inventory from public.inventory where id = v_log.inventory_id for update;
  else
    select * into v_inventory from public.inventory where id = p_target_id for update;
  end if;
  if not found or (v_account.role <> 'global_admin' and v_account.room_id <> v_inventory.room_id) then
    raise exception 'TARGET_NOT_FOUND' using errcode = 'P0002';
  end if;

  case p_operation
    when 'movement' then
      if not v_inventory.is_active then
        raise exception 'INACTIVE_INVENTORY' using errcode = '23514';
      end if;
      v_next_amount := v_inventory.amount + v_change;
      if v_next_amount < 0 then
        raise exception 'INSUFFICIENT_STOCK' using errcode = '23514';
      end if;
      v_occurred_at := coalesce(v_occurred_input, pg_catalog.statement_timestamp());
      if v_occurred_at < v_inventory.opened_at then
        raise exception 'INVALID_OCCURRED_AT' using errcode = '22023';
      end if;
      update public.inventory set amount = v_next_amount where id = v_inventory.id
        returning * into v_inventory;
      insert into public.inventory_logs
        (inventory_id, command_request_id, created_by_account_id,
         change_amount, operator_name, purpose, occurred_at)
      values (v_inventory.id, v_request_id, v_account.id, v_change,
              v_operator, v_purpose, v_occurred_at)
      returning * into v_log;
      v_result := pg_catalog.jsonb_build_object('inventory', pg_catalog.to_jsonb(v_inventory),
                                                 'log', pg_catalog.to_jsonb(v_log));

    when 'cancel' then
      if v_log.status <> 'active' or not v_inventory.is_active then
        raise exception 'INVALID_LOG_STATE' using errcode = '23514';
      end if;
      v_next_amount := v_inventory.amount - v_log.change_amount;
      if v_next_amount < 0 then
        raise exception 'INSUFFICIENT_STOCK' using errcode = '23514';
      end if;
      v_before := pg_catalog.jsonb_build_object('log', pg_catalog.to_jsonb(v_log),
                                                 'inventoryAmount', v_inventory.amount);
      update public.inventory set amount = v_next_amount where id = v_inventory.id
        returning * into v_inventory;
      update public.inventory_logs set status = 'cancelled', updated_at = pg_catalog.clock_timestamp()
        where id = v_log.id returning * into v_log;
      insert into public.operation_audits
        (account_id, command_request_id, target_type, target_id, action,
         operator_name, reason, before_value, after_value)
      values (v_account.id, v_request_id, 'log', v_log.id::text, 'cancel',
              v_operator, v_reason, v_before,
              pg_catalog.jsonb_build_object('log', pg_catalog.to_jsonb(v_log),
                                            'inventoryAmount', v_inventory.amount))
      returning id into v_audit_id;
      v_result := pg_catalog.jsonb_build_object('inventory', pg_catalog.to_jsonb(v_inventory),
                                                 'log', pg_catalog.to_jsonb(v_log), 'auditId', v_audit_id);

    when 'correct' then
      if v_log.status <> 'active' or not v_inventory.is_active then
        raise exception 'INVALID_LOG_STATE' using errcode = '23514';
      end if;
      v_occurred_at := v_occurred_input;
      if v_occurred_at < v_inventory.opened_at then
        raise exception 'INVALID_OCCURRED_AT' using errcode = '22023';
      end if;
      v_next_amount := v_inventory.amount - v_log.change_amount + v_change;
      if v_next_amount < 0 then
        raise exception 'INSUFFICIENT_STOCK' using errcode = '23514';
      end if;
      v_before := pg_catalog.jsonb_build_object('log', pg_catalog.to_jsonb(v_log),
                                                 'inventoryAmount', v_inventory.amount);
      update public.inventory set amount = v_next_amount where id = v_inventory.id
        returning * into v_inventory;
      update public.inventory_logs
        set change_amount = v_change, operator_name = v_log_operator,
            occurred_at = v_occurred_at, updated_at = pg_catalog.clock_timestamp()
        where id = v_log.id returning * into v_log;
      insert into public.operation_audits
        (account_id, command_request_id, target_type, target_id, action,
         operator_name, reason, before_value, after_value)
      values (v_account.id, v_request_id, 'log', v_log.id::text, 'correct',
              v_operator, v_reason, v_before,
              pg_catalog.jsonb_build_object('log', pg_catalog.to_jsonb(v_log),
                                            'inventoryAmount', v_inventory.amount))
      returning id into v_audit_id;
      v_result := pg_catalog.jsonb_build_object('inventory', pg_catalog.to_jsonb(v_inventory),
                                                 'log', pg_catalog.to_jsonb(v_log), 'auditId', v_audit_id);

    when 'threshold' then
      if v_inventory.last_updated is distinct from v_expected_updated then
        raise exception 'VERSION_CONFLICT' using errcode = '23514';
      end if;
      v_before := pg_catalog.to_jsonb(v_inventory);
      update public.inventory set low_stock_threshold = v_threshold where id = v_inventory.id
        returning * into v_inventory;
      insert into public.operation_audits
        (account_id, command_request_id, target_type, target_id, action,
         operator_name, reason, before_value, after_value)
      values (v_account.id, v_request_id, 'inventory', v_inventory.id::text, 'threshold',
              v_operator, v_reason, v_before, pg_catalog.to_jsonb(v_inventory))
      returning id into v_audit_id;
      v_result := pg_catalog.jsonb_build_object('inventory', pg_catalog.to_jsonb(v_inventory),
                                                 'auditId', v_audit_id);

    when 'deactivate' then
      if not v_inventory.is_active or v_inventory.amount <> 0 then
        raise exception 'INVALID_INVENTORY_STATE' using errcode = '23514';
      end if;
      v_before := pg_catalog.to_jsonb(v_inventory);
      update public.inventory set is_active = false where id = v_inventory.id
        returning * into v_inventory;
      insert into public.operation_audits
        (account_id, command_request_id, target_type, target_id, action,
         operator_name, reason, before_value, after_value)
      values (v_account.id, v_request_id, 'inventory', v_inventory.id::text, 'deactivate',
              v_operator, v_reason, v_before, pg_catalog.to_jsonb(v_inventory))
      returning id into v_audit_id;
      v_result := pg_catalog.jsonb_build_object('inventory', pg_catalog.to_jsonb(v_inventory),
                                                 'auditId', v_audit_id);
  end case;

  update public.command_requests set result = v_result where id = v_request_id;
  return v_result;
end;
$$;

revoke all on function private.execute_inventory_command(text, uuid, jsonb, uuid)
  from public, anon, authenticated;

create function public.inventory_command(
  p_operation text,
  p_target_id uuid,
  p_payload jsonb,
  p_idempotency_key uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.execute_inventory_command(p_operation, p_target_id, p_payload, p_idempotency_key);
$$;

revoke all on function public.inventory_command(text, uuid, jsonb, uuid)
  from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.execute_inventory_command(text, uuid, jsonb, uuid)
  to authenticated;
grant execute on function public.inventory_command(text, uuid, jsonb, uuid)
  to authenticated;

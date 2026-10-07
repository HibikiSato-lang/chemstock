-- Review fixes: compare the version the operator actually inspected.
-- Existing command receipts are replayed before version checks.

create or replace function private.execute_inventory_command(
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
  v_expected_log_updated timestamptz;
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

  if p_operation in ('cancel', 'correct') then
    v_expected_log_updated := (p_payload->>'expectedLogUpdated')::timestamptz;
    if v_expected_log_updated is null then
      raise exception 'INVALID_LOG_VERSION' using errcode = '22023';
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
      v_arguments := pg_catalog.jsonb_build_object('operatorName', v_operator, 'reason', v_reason,
        'expectedLogUpdated', v_expected_log_updated);
    when 'correct' then
      if pg_catalog.char_length(v_log_operator) not between 1 and 100 then
        raise exception 'INVALID_OPERATOR' using errcode = '22023';
      end if;
      v_arguments := pg_catalog.jsonb_build_object(
        'changeAmount', v_change, 'operatorName', v_log_operator,
        'occurredAt', v_occurred_input, 'changedByName', v_operator, 'reason', v_reason,
        'expectedLogUpdated', v_expected_log_updated
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
    if v_log.updated_at is distinct from v_expected_log_updated then
      raise exception 'VERSION_CONFLICT' using errcode = '40001';
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


create or replace function private.stock_risk_command(p_operation text, p_inventory_id uuid, p_payload jsonb, p_idempotency_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_account public.accounts%rowtype; v_stock public.inventory%rowtype; v_existing public.command_requests%rowtype;
  v_request uuid; v_target text; v_operator text; v_reason text; v_args jsonb; v_before jsonb; v_after jsonb;
  v_result jsonb; v_flag boolean; v_from timestamptz; v_revision timestamptz; v_stamp timestamptz; v_audit uuid; v_expected_review uuid; v_previous_review uuid;
begin
  select * into v_account from public.accounts where id = auth.uid() for share;
  if not found or v_account.role <> 'global_admin' then raise exception 'UNAUTHORIZED' using errcode = '28000'; end if;
  if p_operation is null or p_operation not in ('enable', 'quality') or p_idempotency_key is null
    or p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then raise exception 'INVALID_COMMAND' using errcode = '22023'; end if;
  v_operator := pg_catalog.btrim(coalesce(p_payload->>'operatorName', ''));
  v_reason := pg_catalog.btrim(coalesce(p_payload->>'reason', ''));
  if pg_catalog.char_length(v_operator) not between 1 and 100 or pg_catalog.char_length(v_reason) not between 1 and 200 then
    raise exception 'INVALID_COMMAND' using errcode = '22023'; end if;
  if p_operation = 'enable' then
    if p_inventory_id is not null or pg_catalog.jsonb_typeof(p_payload->'enabled') is distinct from 'boolean' then raise exception 'INVALID_COMMAND' using errcode = '22023'; end if;
    v_flag := (p_payload->>'enabled')::boolean; v_target := 'stock_risk_enabled';
    v_args := pg_catalog.jsonb_build_object('enabled', v_flag, 'operatorName', v_operator, 'reason', v_reason);
  else
    if p_inventory_id is null or pg_catalog.jsonb_typeof(p_payload->'eligible') is distinct from 'boolean' then raise exception 'INVALID_COMMAND' using errcode = '22023'; end if;
    v_flag := (p_payload->>'eligible')::boolean; v_target := p_inventory_id::text;
    v_from := case when v_flag then (p_payload->>'verifiedFrom')::timestamptz else null end;
    if not p_payload ? 'expectedReviewAuditId' then raise exception 'INVALID_COMMAND' using errcode = '22023'; end if;
    v_expected_review := (p_payload->>'expectedReviewAuditId')::uuid;
    v_revision := (p_payload->>'expectedLastUpdated')::timestamptz;
    if v_revision is null or (v_flag and v_from is null) then raise exception 'INVALID_COMMAND' using errcode = '22023'; end if;
    v_args := pg_catalog.jsonb_build_object('eligible', v_flag, 'verifiedFrom', v_from,
      'expectedReviewAuditId', v_expected_review, 'expectedLastUpdated', v_revision, 'operatorName', v_operator, 'reason', v_reason);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(1128813396, 1);
  insert into public.command_requests(account_id, idempotency_key, operation, target_id, arguments)
    values (v_account.id, p_idempotency_key, 'stock_risk_' || p_operation, v_target, v_args)
    on conflict (account_id, idempotency_key) do nothing returning id into v_request;
  if v_request is null then
    select * into v_existing from public.command_requests where account_id = v_account.id and idempotency_key = p_idempotency_key;
    if v_existing.operation <> 'stock_risk_' || p_operation or v_existing.target_id <> v_target or v_existing.arguments is distinct from v_args then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '23505'; end if;
    return v_existing.result;
  end if;
  v_stamp := pg_catalog.clock_timestamp();
  if p_operation = 'enable' then
    select pg_catalog.jsonb_build_object('enabled', value::boolean) into v_before from public.settings where key = v_target for update;
    if not found then raise exception 'REQUIRED_SETTING_MISSING' using errcode = '23514'; end if;
    update public.settings set value = v_flag::text where key = v_target;
    v_after := pg_catalog.jsonb_build_object('enabled', v_flag);
  else
    select * into v_stock from public.inventory where id = p_inventory_id for update;
    if not found then raise exception 'TARGET_NOT_FOUND' using errcode = 'P0002'; end if;
    if v_stock.last_updated is distinct from v_revision then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
    if v_flag and (not v_stock.is_active or v_from < v_stock.opened_at or v_from > v_stamp) then raise exception 'INVALID_COMMAND' using errcode = '22023'; end if;
    select id, after_value into v_previous_review, v_before from public.operation_audits where target_type = 'inventory'
      and target_id = v_target and action = 'stock_risk_quality' order by created_at desc, id desc limit 1;
    if v_previous_review is distinct from v_expected_review then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
    v_after := pg_catalog.jsonb_build_object('eligible', v_flag, 'verifiedFrom', v_from, 'verifiedAt', v_stamp);
  end if;
  insert into public.operation_audits(account_id, command_request_id, target_type, target_id, action,
    operator_name, reason, before_value, after_value, created_at)
    values (v_account.id, v_request, case when p_operation = 'enable' then 'setting' else 'inventory' end,
      v_target, case when p_operation = 'enable' then 'stock_risk_enable' else 'stock_risk_quality' end,
      v_operator, v_reason, coalesce(v_before, '{}'::jsonb), v_after, v_stamp) returning id into v_audit;
  v_result := pg_catalog.jsonb_build_object('value', v_after, 'auditId', v_audit);
  update public.command_requests set result = v_result where id = v_request;
  return v_result;
end; $$;

-- Confirmation metadata remains available to global admins when risk is disabled.
-- Include the stock revision from the same statement snapshot as the audit ID.
create function private.read_stock_risk_reviews()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not exists (select 1 from public.accounts where id = auth.uid() and role = 'global_admin') then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'inventoryId', i.id, 'inventoryLastUpdated', i.last_updated, 'auditId', q.id,
    'eligible', coalesce((q.after_value->>'eligible')::boolean, false),
    'verifiedFrom', q.after_value->>'verifiedFrom', 'verifiedAt', q.after_value->>'verifiedAt',
    'operatorName', q.operator_name, 'reason', q.reason) order by i.id), '[]'::jsonb)
  into v_result from public.inventory i
  left join lateral (select id, after_value, operator_name, reason from public.operation_audits
    where target_type = 'inventory' and target_id = i.id::text and action = 'stock_risk_quality'
    order by created_at desc, id desc limit 1) q on true;
  return v_result;
end; $$;
revoke all on function private.read_stock_risk_reviews() from public, anon, authenticated;
grant execute on function private.read_stock_risk_reviews() to authenticated;
create function public.stock_risk_reviews()
returns jsonb language sql stable security invoker set search_path = '' as $$ select private.read_stock_risk_reviews(); $$;
revoke all on function public.stock_risk_reviews() from public, anon, authenticated;
grant execute on function public.stock_risk_reviews() to authenticated;

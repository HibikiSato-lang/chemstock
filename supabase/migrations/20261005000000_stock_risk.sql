-- Experimental stock risk: disabled until the institution validates the policy.
-- Verification is an audited inventory operation; no new business table is used.
create or replace function private.valid_setting_value(p_key text, p_value text)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if p_key in ('dq_arm_over', 'stock_risk_enabled') then return p_value in ('true', 'false'); end if;
  if p_value is null or length(p_value) > 32 or p_value !~ '^[0-9]+(\.[0-9]+)?$' then return false; end if;
  case p_key
    when 'warning_ratio' then return p_value::numeric > 0 and p_value::numeric < 1;
    when 'forecast_window_days' then return p_value ~ '^[0-9]{1,3}$' and p_value::integer between 1 and 365;
    when 'unit_gal_to_l' then return p_value::numeric = 3.8;
    when 'unit_tokan_to_l' then return p_value::numeric = 18;
    else return false;
  end case;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end; $$;

insert into public.settings(key, value, description)
values ('stock_risk_enabled', 'false', '検証中の下限到達リスク表示。初期無効');

create or replace function private.read_app_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb; v_enabled text;
begin
  if not exists (select 1 from public.accounts where id = auth.uid()) then raise exception 'UNAUTHORIZED' using errcode = '28000'; end if;
  select value into v_enabled from public.settings where key = 'stock_risk_enabled';
  if v_enabled is null or v_enabled not in ('true', 'false') then raise exception 'REQUIRED_SETTING_MISSING' using errcode = '23514'; end if;
  select pg_catalog.jsonb_build_object(
    'unitGalToL', (select value::numeric from public.settings where key = 'unit_gal_to_l'),
    'unitTokanToL', (select value::numeric from public.settings where key = 'unit_tokan_to_l'),
    'forecastWindowDays', (select value::integer from public.settings where key = 'forecast_window_days'),
    'stockRiskAvailable', true, 'stockRiskEnabled', v_enabled::boolean
  ) into v_result;
  if v_result->'unitGalToL' = 'null'::jsonb or v_result->'unitTokanToL' = 'null'::jsonb or v_result->'forecastWindowDays' = 'null'::jsonb then
    raise exception 'REQUIRED_SETTING_MISSING' using errcode = '23514';
  end if;
  return v_result;
end; $$;

create function private.risk_interval_available(p_periods jsonb, p_start timestamptz, p_end timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select not exists (select 1 from pg_catalog.jsonb_array_elements(p_periods) z
    where (z->>0)::timestamptz < p_end and (z->>1)::timestamptz > p_start);
$$;
revoke all on function private.risk_interval_available(jsonb, timestamptz, timestamptz) from public, anon, authenticated;

-- Internal engine accepts a fixed clock for reproducible isolated tests. It is
-- never granted to API roles; only the authorized reader supplies its inputs.
create function private.calculate_stock_risk(p_stock public.inventory, p_logs jsonb, p_review jsonb, p_t timestamptz)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_result jsonb; v_reason text[] := '{}'; v_margin numeric; v_from timestamptz; v_verified timestamptz;
  v_resumed timestamptz; v_balance numeric; v_cursor timestamptz; v_log record;
  v_zero jsonb := '[]'; v_samples numeric[] := '{}'; v_sorted numeric[];
  v_w integer; v_h integer := 7; v_start timestamptz; v_end timestamptz;
  v_used numeric; v_n integer := 0; v_k integer := 0; v_days integer := 0; v_nonoverlap integer := 0; v_candidate integer; j integer;
begin
  v_margin := p_stock.amount - p_stock.low_stock_threshold;
  v_result := pg_catalog.jsonb_build_object(
    'inventoryId', p_stock.id, 'status', 'data_quality_issue', 'currentAmount', p_stock.amount,
    'lowStockThreshold', p_stock.low_stock_threshold, 'marginAmount', v_margin, 'baseUnit', 'L',
    'horizonDays', v_h, 'referenceDays', null, 'historyStartAt', null, 'historyEndAt', p_t,
    'candidateWindowCount', null, 'sampleWindowCount', null, 'excludedWindowCount', null,
    'reachedWindowCount', null, 'historicalReachRate', null, 'outboundDayCount', null,
    'nonOverlappingWindowCount', null, 'windowOutbound', null, 'needsAttention', null,
    'reasonCodes', '[]'::jsonb, 'exclusionReasonCodes', '[]'::jsonb,
    'assumptions', pg_catalog.jsonb_build_array('no_inbound', 'similar_outbound_pattern'),
    'generatedAt', p_t, 'methodVersion', 'empirical_outbound_window_v1');
  if not p_stock.is_active then return v_result || '{"status":"inactive"}'; end if;
  if p_stock.low_stock_threshold is null then return v_result || '{"status":"threshold_not_set"}'; end if;
  if v_margin <= 0 then return v_result || '{"status":"already_below_threshold"}'; end if;
  if p_stock.opened_at is null or p_stock.opened_at > p_t then return v_result || '{"reasonCodes":["invalid_history_start"]}'; end if;
  if p_review is null or (p_review->>'eligible')::boolean is distinct from true or p_review->>'verifiedFrom' is null then
    return v_result || '{"reasonCodes":["history_quality_unverified"]}';
  end if;
  v_verified := (p_review->>'verifiedAt')::timestamptz;
  v_from := (p_review->>'verifiedFrom')::timestamptz;
  v_resumed := coalesce((p_review->>'resumedAt')::timestamptz, p_stock.opened_at);
  if v_verified is null or v_from < p_stock.opened_at or v_from > v_verified or v_verified > p_t or v_resumed > p_t then
    return v_result || '{"reasonCodes":["invalid_quality_review"]}';
  end if;
  if (p_review->>'lastInvalidatedAt')::timestamptz > v_verified or exists (
    select 1 from pg_catalog.jsonb_to_recordset(p_logs) as l(occurred_at timestamptz, created_at timestamptz, updated_at timestamptz)
    where l.updated_at > v_verified and (l.created_at <= v_verified or l.occurred_at <= v_verified or l.updated_at > l.created_at)
  ) then return v_result || '{"reasonCodes":["history_changed_since_review"]}'; end if;

  v_balance := p_stock.opening_amount; v_cursor := p_stock.opened_at;
  for v_log in select * from pg_catalog.jsonb_to_recordset(p_logs)
    as l(id uuid, change_amount numeric, status text, occurred_at timestamptz, created_at timestamptz)
    where status = 'active' order by occurred_at, created_at, id
  loop
    if v_log.occurred_at < p_stock.opened_at or v_log.occurred_at > p_t or v_log.change_amount is null or v_log.change_amount = 0 then
      return v_result || '{"reasonCodes":["invalid_history_log"]}';
    end if;
    if v_balance = 0 and v_log.occurred_at > v_cursor then
      v_zero := v_zero || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_array(v_cursor, v_log.occurred_at));
    end if;
    v_balance := v_balance + v_log.change_amount;
    if v_balance < 0 then return v_result || '{"reasonCodes":["invalid_history_balance"]}'; end if;
    v_cursor := v_log.occurred_at;
  end loop;
  if v_balance <> p_stock.amount then return v_result || '{"reasonCodes":["ledger_mismatch"]}'; end if;
  if v_balance = 0 and p_t > v_cursor then v_zero := v_zero || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_array(v_cursor, p_t)); end if;
  v_w := least(180, floor(extract(epoch from p_t - greatest(p_stock.opened_at, v_from, v_resumed)) / 86400)::integer);
  v_candidate := greatest(0, v_w - v_h + 1);
  if v_w >= v_h then
    for j in 0..v_w - v_h loop
      v_end := p_t - j * interval '24 hours'; v_start := v_end - v_h * interval '24 hours';
      if not private.risk_interval_available(v_zero, v_start, v_end) then continue; end if;
      select coalesce(-sum(change_amount), 0) into v_used from pg_catalog.jsonb_to_recordset(p_logs)
        as l(change_amount numeric, status text, occurred_at timestamptz)
        where status = 'active' and change_amount < 0 and occurred_at > v_start and occurred_at <= v_end;
      v_samples := pg_catalog.array_append(v_samples, v_used);
      if j % v_h = 0 then v_nonoverlap := v_nonoverlap + 1; end if;
    end loop;
  end if;
  if v_w > 0 then
    for j in 0..v_w - 1 loop
      v_end := p_t - j * interval '24 hours'; v_start := v_end - interval '24 hours';
      if private.risk_interval_available(v_zero, v_start, v_end) and exists (
        select 1 from pg_catalog.jsonb_to_recordset(p_logs) as l(change_amount numeric, status text, occurred_at timestamptz)
        where status = 'active' and change_amount < 0 and occurred_at > v_start and occurred_at <= v_end
      ) then v_days := v_days + 1; end if;
    end loop;
  end if;
  v_n := pg_catalog.cardinality(v_samples);
  v_result := v_result || pg_catalog.jsonb_build_object('referenceDays', v_w, 'historyStartAt', p_t - v_w * interval '24 hours',
    'candidateWindowCount', v_candidate, 'sampleWindowCount', v_n, 'excludedWindowCount', v_candidate - v_n,
    'outboundDayCount', v_days, 'nonOverlappingWindowCount', v_nonoverlap,
    'exclusionReasonCodes', case when v_candidate > v_n then '["stockout_period"]'::jsonb else '[]'::jsonb end);
  if v_w < 90 then return v_result || '{"status":"insufficient_history","reasonCodes":["history_too_short"]}'; end if;
  if not exists (select 1 from pg_catalog.jsonb_to_recordset(p_logs) as l(change_amount numeric, status text, occurred_at timestamptz)
    where status = 'active' and change_amount < 0 and occurred_at > p_t - v_w * interval '24 hours' and occurred_at <= p_t)
  then return v_result || '{"status":"no_outbound_history"}'; end if;
  if v_days < 10 then v_reason := pg_catalog.array_append(v_reason, 'too_few_outbound_days'); end if;
  if v_nonoverlap < 12 then v_reason := pg_catalog.array_append(v_reason, 'too_few_non_overlapping_windows'); end if;
  if v_n = 0 then v_reason := pg_catalog.array_append(v_reason, 'no_usable_windows'); end if;
  if pg_catalog.cardinality(v_reason) > 0 then return v_result || pg_catalog.jsonb_build_object('status', 'sparse_history', 'reasonCodes', v_reason); end if;
  select pg_catalog.array_agg(x order by x), count(*) filter (where x >= v_margin) into v_sorted, v_k from pg_catalog.unnest(v_samples) x;
  return v_result || pg_catalog.jsonb_build_object('status', 'ready', 'reachedWindowCount', v_k,
    'historicalReachRate', round(v_k::numeric / v_n, 6), 'needsAttention', v_k * 5 >= v_n,
    'windowOutbound', pg_catalog.jsonb_build_object('median', v_sorted[ceil(v_n * 0.5)::integer],
      'p95', v_sorted[ceil(v_n * 0.95)::integer], 'max', v_sorted[v_n]));
end; $$;
revoke all on function private.calculate_stock_risk(public.inventory, jsonb, jsonb, timestamptz) from public, anon, authenticated;

create function private.read_stock_risks(p_room_id uuid, p_inventory_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_account public.accounts%rowtype; v_result jsonb; v_enabled text; v_t timestamptz := pg_catalog.statement_timestamp();
begin
  select * into v_account from public.accounts where id = auth.uid();
  if not found then raise exception 'UNAUTHORIZED' using errcode = '28000'; end if;
  if p_room_id is not null and (not exists (select 1 from public.rooms where id = p_room_id)
    or (v_account.role <> 'global_admin' and p_room_id <> v_account.room_id)) then
    raise exception 'TARGET_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_inventory_id is not null and not exists (select 1 from public.inventory i where i.id = p_inventory_id
    and (p_room_id is null or i.room_id = p_room_id) and (v_account.role = 'global_admin' or i.room_id = v_account.room_id)) then
    raise exception 'TARGET_NOT_FOUND' using errcode = 'P0002';
  end if;
  select value into v_enabled from public.settings where key = 'stock_risk_enabled';
  if v_enabled is null or v_enabled not in ('true', 'false') then raise exception 'REQUIRED_SETTING_MISSING' using errcode = '23514'; end if;
  if v_enabled = 'false' then return '[]'::jsonb; end if;
  select coalesce(pg_catalog.jsonb_agg(private.calculate_stock_risk(i, l.logs,
    q.review || pg_catalog.jsonb_build_object('resumedAt', a.resumed_at), v_t) order by i.id), '[]'::jsonb) into v_result
  from public.inventory i
  left join lateral (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.occurred_at, x.created_at, x.id), '[]'::jsonb) logs
    from public.inventory_logs x where x.inventory_id = i.id) l on true
  left join lateral (select after_value review from public.operation_audits
    where target_type = 'inventory' and target_id = i.id::text and action = 'stock_risk_quality'
    order by created_at desc, id desc limit 1) q on true
  left join lateral (select max(created_at) resumed_at from public.operation_audits
    where target_type = 'inventory' and target_id = i.id::text and action = 'reactivate') a on true
  where (p_room_id is null or i.room_id = p_room_id) and (p_inventory_id is null or i.id = p_inventory_id)
    and (v_account.role = 'global_admin' or i.room_id = v_account.room_id);
  return v_result;
end; $$;
revoke all on function private.read_stock_risks(uuid, uuid) from public, anon, authenticated;
grant execute on function private.read_stock_risks(uuid, uuid) to authenticated;
create function public.fn_stock_risk(p_room_id uuid default null, p_inventory_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$ select private.read_stock_risks(p_room_id, p_inventory_id); $$;
revoke all on function public.fn_stock_risk(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_stock_risk(uuid, uuid) to authenticated;

create function private.stock_risk_command(p_operation text, p_inventory_id uuid, p_payload jsonb, p_idempotency_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_account public.accounts%rowtype; v_stock public.inventory%rowtype; v_existing public.command_requests%rowtype;
  v_request uuid; v_target text; v_operator text; v_reason text; v_args jsonb; v_before jsonb; v_after jsonb;
  v_result jsonb; v_flag boolean; v_from timestamptz; v_revision timestamptz; v_stamp timestamptz; v_audit uuid;
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
    v_revision := (p_payload->>'expectedLastUpdated')::timestamptz;
    if v_revision is null or (v_flag and v_from is null) then raise exception 'INVALID_COMMAND' using errcode = '22023'; end if;
    v_args := pg_catalog.jsonb_build_object('eligible', v_flag, 'verifiedFrom', v_from,
      'expectedLastUpdated', v_revision, 'operatorName', v_operator, 'reason', v_reason);
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
    select after_value into v_before from public.operation_audits where target_type = 'inventory'
      and target_id = v_target and action = 'stock_risk_quality' order by created_at desc, id desc limit 1;
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
revoke all on function private.stock_risk_command(text, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function private.stock_risk_command(text, uuid, jsonb, uuid) to authenticated;
create function public.stock_risk_command(p_operation text, p_inventory_id uuid, p_payload jsonb, p_idempotency_key uuid)
returns jsonb language sql volatile security invoker set search_path = '' as $$ select private.stock_risk_command(p_operation, p_inventory_id, p_payload, p_idempotency_key); $$;
revoke all on function public.stock_risk_command(text, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.stock_risk_command(text, uuid, jsonb, uuid) to authenticated;

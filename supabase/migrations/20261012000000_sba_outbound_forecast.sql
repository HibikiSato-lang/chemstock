-- Replace empirical window proportions with the literature-defined SBA point forecast.
-- RPC authorization, feature flag, review auditing and snapshot reader are unchanged.
create or replace function private.calculate_stock_risk(p_stock public.inventory, p_logs jsonb, p_review jsonb, p_t timestamptz)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_result jsonb; v_margin numeric; v_from timestamptz; v_verified timestamptz;
  v_resumed timestamptz; v_balance numeric; v_cursor timestamptz; v_log record;
  v_zero jsonb := '[]'; v_zero_end timestamptz; v_raw_start timestamptz;
  v_w integer; v_h integer := 7; v_start timestamptz; v_end timestamptz; v_day timestamptz;
  v_used numeric; v_days integer := 0; v_last_day integer := -1; j integer;
  v_z numeric := 0; v_p numeric := 0; v_alpha numeric := 0.1; v_rate numeric; v_forecast numeric;
  v_last_at timestamptz;

begin
  v_margin := p_stock.amount - p_stock.low_stock_threshold;
  v_result := pg_catalog.jsonb_build_object(
    'inventoryId', p_stock.id, 'status', 'data_quality_issue', 'currentAmount', p_stock.amount,
    'lowStockThreshold', p_stock.low_stock_threshold, 'marginAmount', v_margin, 'baseUnit', 'L',
    'horizonDays', v_h, 'referenceDays', null, 'historyStartAt', null, 'historyEndAt', (date_trunc('day', p_t at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo'),
    'outboundDayCount', null, 'dailyOutboundForecast', null, 'forecastOutboundAmount', null,
    'forecastMarginAmount', null, 'smoothedOutboundSize', null, 'smoothedIntervalDays', null,
    'lastOutboundAt', null, 'smoothingAlpha', v_alpha, 'needsAttention', null,
    'reasonCodes', '[]'::jsonb, 'exclusionReasonCodes', '[]'::jsonb,
    'assumptions', pg_catalog.jsonb_build_array('no_inbound', 'similar_outbound_pattern'),
    'generatedAt', p_t, 'methodVersion', 'sba_daily_outbound_v1');
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
  -- Complete JST calendar days; restart after censored stockout periods.
  v_end := date_trunc('day', p_t at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  select max((z->>1)::timestamptz) into v_zero_end from pg_catalog.jsonb_array_elements(v_zero) z
    where (z->>0)::timestamptz < v_end and (z->>1)::timestamptz > v_end - interval '8760 hours';
  v_raw_start := greatest(p_stock.opened_at, v_from, v_resumed, v_zero_end, v_end - interval '8760 hours');
  v_start := date_trunc('day', v_raw_start at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  if v_start < v_raw_start then v_start := v_start + interval '24 hours'; end if;
  v_start := least(v_start, v_end);
  v_w := round(extract(epoch from v_end - v_start) / 86400)::integer;
  if v_w > 0 then
    for j in 0..v_w - 1 loop
      v_day := v_start + j * interval '24 hours';
      select coalesce(-sum(change_amount), 0), max(occurred_at) into v_used, v_cursor
        from pg_catalog.jsonb_to_recordset(p_logs) as l(change_amount numeric, status text, occurred_at timestamptz)
        where status = 'active' and change_amount < 0 and occurred_at >= v_day and occurred_at < v_day + interval '24 hours';
      if v_used = 0 then continue; end if;
      v_days := v_days + 1; v_last_at := v_cursor;
      if v_last_day < 0 then v_z := v_used;
      else
        v_z := v_z + v_alpha * (v_used - v_z);
        if v_p = 0 then v_p := j - v_last_day;
        else v_p := v_p + v_alpha * (j - v_last_day - v_p); end if;
      end if;
      v_last_day := j;
    end loop;
  end if;
  v_result := v_result || pg_catalog.jsonb_build_object('referenceDays', v_w, 'historyStartAt', v_start,
    'outboundDayCount', v_days, 'lastOutboundAt', v_last_at,
    'exclusionReasonCodes', case when v_zero_end is not null then '["stockout_restart"]'::jsonb else '[]'::jsonb end);
  if v_w < 2 then return v_result || '{"status":"insufficient_history","reasonCodes":["history_too_short"]}'; end if;
  if v_days = 0 then return v_result || '{"status":"no_outbound_history"}'; end if;
  if v_days < 2 then return v_result || '{"status":"sparse_history","reasonCodes":["too_few_outbound_days"]}'; end if;
  -- SBA correction. Initialization: first positive size and first complete interval.
  v_rate := (1 - v_alpha / 2) * v_z / v_p;
  v_forecast := round(v_rate * v_h, 6);
  return v_result || pg_catalog.jsonb_build_object('status', 'ready', 'dailyOutboundForecast', round(v_rate, 6),
    'forecastOutboundAmount', v_forecast, 'forecastMarginAmount', round(v_margin - v_forecast, 6),
    'smoothedOutboundSize', round(v_z, 6), 'smoothedIntervalDays', round(v_p, 6),
    'needsAttention', v_forecast >= v_margin);
end; $$;
revoke all on function private.calculate_stock_risk(public.inventory, jsonb, jsonb, timestamptz) from public, anon, authenticated;

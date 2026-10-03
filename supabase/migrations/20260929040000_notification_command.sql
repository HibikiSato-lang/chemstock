create function private.change_notification_status(
  p_notification_id uuid,
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
  v_notification public.notifications%rowtype;
  v_existing public.command_requests%rowtype;
  v_request_id uuid;
  v_audit_id uuid;
  v_status text;
  v_operator text;
  v_reason text;
  v_arguments jsonb;
  v_before jsonb;
  v_result jsonb;
begin
  if p_notification_id is null or p_idempotency_key is null
     or p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_COMMAND' using errcode = '22023';
  end if;

  select * into v_account from public.accounts where id = auth.uid() for share;
  if not found or v_account.role not in ('solvent_room_admin', 'global_admin') then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.notifications where id = p_notification_id) then
    raise exception 'TARGET_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_status := p_payload->>'status';
  v_operator := pg_catalog.btrim(coalesce(p_payload->>'operatorName', ''));
  v_reason := nullif(pg_catalog.btrim(coalesce(p_payload->>'reason', '')), '');
  if v_status is null or v_status not in ('acknowledged', 'resolved')
     or pg_catalog.char_length(v_operator) not between 1 and 100
     or pg_catalog.char_length(coalesce(v_reason, '')) > 200
     or (v_status = 'resolved' and v_reason is null) then
    raise exception 'INVALID_COMMAND' using errcode = '22023';
  end if;
  v_arguments := pg_catalog.jsonb_build_object(
    'status', v_status, 'operatorName', v_operator, 'reason', v_reason
  );

  perform pg_catalog.pg_advisory_xact_lock(1128813396, 1);

  insert into public.command_requests
    (account_id, idempotency_key, operation, target_id, arguments)
  values (v_account.id, p_idempotency_key, 'notification_status',
          p_notification_id::text, v_arguments)
  on conflict (account_id, idempotency_key) do nothing
  returning id into v_request_id;

  if v_request_id is null then
    select * into v_existing from public.command_requests
    where account_id = v_account.id and idempotency_key = p_idempotency_key;
    if not found or v_existing.operation <> 'notification_status'
       or v_existing.target_id <> p_notification_id::text
       or v_existing.arguments is distinct from v_arguments then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '23505';
    end if;
    return v_existing.result;
  end if;

  select * into v_notification from public.notifications
    where id = p_notification_id for update;
  if not found then
    raise exception 'TARGET_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (v_notification.status = 'unread'
      or (v_notification.status = 'acknowledged' and v_status = 'resolved')) then
    raise exception 'INVALID_NOTIFICATION_STATE' using errcode = '23514';
  end if;

  v_before := pg_catalog.to_jsonb(v_notification);
  update public.notifications set status = v_status where id = p_notification_id
    returning * into v_notification;
  insert into public.operation_audits
    (account_id, command_request_id, target_type, target_id, action,
     operator_name, reason, before_value, after_value)
  values (v_account.id, v_request_id, 'notification', p_notification_id::text,
          'status_change', v_operator, v_reason,
          v_before, pg_catalog.to_jsonb(v_notification))
  returning id into v_audit_id;
  v_result := pg_catalog.jsonb_build_object(
    'notification', pg_catalog.to_jsonb(v_notification), 'auditId', v_audit_id
  );
  update public.command_requests set result = v_result where id = v_request_id;
  return v_result;
end;
$$;

revoke all on function private.change_notification_status(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function private.change_notification_status(uuid, jsonb, uuid)
  to authenticated;

create function public.notification_command(
  p_notification_id uuid,
  p_payload jsonb,
  p_idempotency_key uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.change_notification_status(p_notification_id, p_payload, p_idempotency_key);
$$;

revoke all on function public.notification_command(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.notification_command(uuid, jsonb, uuid)
  to authenticated;

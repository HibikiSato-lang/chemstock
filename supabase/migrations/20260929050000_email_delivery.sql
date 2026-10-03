-- Optional designated-quantity email delivery. Disabled until a confirmed
-- shared address and an approved HTTPS mail provider are configured.
create table private.email_notification_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  enabled_at timestamptz,
  recipient_email text check (
    recipient_email is null or
    (char_length(recipient_email) between 3 and 254 and
     recipient_email = btrim(recipient_email) and
     recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+$')
  ),
  recipient_confirmed_at timestamptz,
  sender_email text check (
    sender_email is null or
    (char_length(sender_email) between 3 and 254 and
     sender_email = btrim(sender_email) and
     sender_email ~ '^[^[:space:]@]+@[^[:space:]@]+$')
  ),
  sender_confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint email_requires_confirmed_addresses check (
    not enabled or
    (enabled_at is not null and recipient_email is not null
     and recipient_confirmed_at is not null and sender_email is not null
     and sender_confirmed_at is not null)
  )
);
insert into private.email_notification_config (singleton) values (true);

create table private.email_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique references public.notifications(id) on delete restrict,
  recipient_email text not null,
  sender_email text not null,
  event_ratio numeric(10, 3) not null,
  event_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'retry', 'accepted', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  provider_message_id text,
  last_error_code text,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_lease_shape check (
    (status = 'sending' and lease_token is not null and lease_until is not null)
    or (status <> 'sending' and lease_token is null and lease_until is null)
  )
);
create index email_notification_deliveries_due_idx
  on private.email_notification_deliveries (next_attempt_at, id)
  where status in ('pending', 'retry', 'sending');

revoke all on private.email_notification_config,
  private.email_notification_deliveries
  from public, anon, authenticated, service_role;

-- The worker never calls the mail provider while holding a DB transaction.
create function public.email_worker_claim(p_limit integer default 10)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_config private.email_notification_config%rowtype;
  v_limit integer;
  v_result jsonb;
begin
  v_limit := least(greatest(coalesce(p_limit, 10), 1), 20);
  select * into v_config from private.email_notification_config where singleton;
  if not found or not v_config.enabled then
    return '[]'::jsonb;
  end if;

  -- notifications is the durable source. Polling after commit means an email
  -- service outage cannot roll back inventory or the in-app notification.
  insert into private.email_notification_deliveries
    (notification_id, recipient_email, sender_email, event_ratio, event_at)
  select n.id, v_config.recipient_email, v_config.sender_email, n.ratio, n.notified_at
  from public.notifications n
  where n.type = 'designated_quantity_exceeded'
    and n.notified_at >= v_config.enabled_at
    and not exists (
      select 1 from private.email_notification_deliveries d
      where d.notification_id = n.id
    )
  order by n.notified_at, n.id
  limit v_limit
  on conflict (notification_id) do nothing;

  -- Graph sendMail has no documented idempotency key. An expired lease may
  -- have sent successfully, so never send it again automatically.
  update private.email_notification_deliveries d
     set status = 'failed', last_error_code = 'UNKNOWN_SEND_OUTCOME',
         lease_token = null, lease_until = null,
         updated_at = pg_catalog.clock_timestamp()
   where d.status = 'sending' and d.lease_until < pg_catalog.clock_timestamp();

  update private.email_notification_deliveries d
     set status = 'failed', last_error_code = 'ENABLE_EPOCH_CHANGED',
         updated_at = pg_catalog.clock_timestamp()
   where d.status in ('pending', 'retry') and d.event_at < v_config.enabled_at;

  update private.email_notification_deliveries d
     set status = 'failed', last_error_code = 'EVENT_EXPIRED',
         lease_token = null, lease_until = null,
         updated_at = pg_catalog.clock_timestamp()
   where d.status in ('pending', 'retry')
     and d.event_at < pg_catalog.clock_timestamp() - interval '24 hours';

  with due as (
    select d.id
    from private.email_notification_deliveries d
    where d.status in ('pending', 'retry')
      and d.next_attempt_at <= pg_catalog.clock_timestamp()
      and d.event_at >= v_config.enabled_at
    order by d.next_attempt_at, d.id
    for update skip locked
    limit v_limit
  ), claimed as (
    update private.email_notification_deliveries d
       set status = 'sending', attempt_count = d.attempt_count + 1,
           lease_token = gen_random_uuid(),
           lease_until = pg_catalog.clock_timestamp() + interval '2 minutes',
           updated_at = pg_catalog.clock_timestamp()
      from due
     where d.id = due.id
     returning d.id, d.notification_id, d.recipient_email, d.sender_email,
               d.event_ratio, d.event_at, d.lease_token
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', id, 'notificationId', notification_id,
    'recipientEmail', recipient_email, 'senderEmail', sender_email,
    'eventRatio', event_ratio,
    'eventAt', event_at, 'leaseToken', lease_token
  )), '[]'::jsonb) into v_result from claimed;
  return v_result;
end;
$$;

create function public.email_worker_accept(
  p_delivery_id uuid, p_lease_token uuid, p_provider_message_id text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_provider_message_id is not null and
     pg_catalog.char_length(p_provider_message_id) not between 1 and 255 then
    raise exception 'INVALID_PROVIDER_MESSAGE_ID' using errcode = '22023';
  end if;
  update private.email_notification_deliveries
     set status = 'accepted', provider_message_id = p_provider_message_id,
         accepted_at = pg_catalog.clock_timestamp(),
         lease_token = null, lease_until = null, last_error_code = null,
         updated_at = pg_catalog.clock_timestamp()
   where id = p_delivery_id and status = 'sending' and lease_token = p_lease_token;
  return found;
end;
$$;

create function public.email_worker_fail(
  p_delivery_id uuid, p_lease_token uuid,
  p_error_code text, p_permanent boolean default false
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_attempt integer;
  v_event_at timestamptz;
begin
  if p_error_code is null or p_error_code !~ '^[A-Z0-9_]{1,60}$' then
    raise exception 'INVALID_EMAIL_ERROR_CODE' using errcode = '22023';
  end if;
  select attempt_count, event_at into v_attempt, v_event_at
    from private.email_notification_deliveries
   where id = p_delivery_id and status = 'sending' and lease_token = p_lease_token
   for update;
  if not found then
    return false;
  end if;
  update private.email_notification_deliveries
     set status = case when coalesce(p_permanent, false) or v_attempt >= 5
                        or v_event_at < pg_catalog.clock_timestamp() - interval '24 hours'
                       then 'failed' else 'retry' end,
         next_attempt_at = pg_catalog.clock_timestamp()
           + pg_catalog.make_interval(secs => least(3600,
               60 * pg_catalog.power(3, v_attempt - 1)::integer)),
         lease_token = null, lease_until = null,
         last_error_code = p_error_code,
         updated_at = pg_catalog.clock_timestamp()
   where id = p_delivery_id;
  return true;
end;
$$;

revoke all on function public.email_worker_claim(integer) from public, anon, authenticated;
revoke all on function public.email_worker_accept(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.email_worker_fail(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.email_worker_claim(integer) to service_role;
grant execute on function public.email_worker_accept(uuid, uuid, text) to service_role;
grant execute on function public.email_worker_fail(uuid, uuid, text, boolean) to service_role;

-- Read-only operational status for the same roles that see notifications.
create function public.admin_email_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_result jsonb;
begin
  select role into v_role from public.accounts where id = auth.uid();
  if v_role is null or v_role not in ('solvent_room_admin', 'global_admin') then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  select pg_catalog.jsonb_build_object(
    'enabled', c.enabled,
    'recipientEmail', c.recipient_email,
    'senderEmail', c.sender_email,
    'pendingCount', (select count(*) from private.email_notification_deliveries d
                     where d.status in ('pending', 'sending', 'retry')),
    'acceptedCount', (select count(*) from private.email_notification_deliveries d
                      where d.status = 'accepted'),
    'failedCount', (select count(*) from private.email_notification_deliveries d
                    where d.status = 'failed'),
    'recentFailures', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'notificationId', recent.notification_id,
        'errorCode', recent.last_error_code,
        'updatedAt', recent.updated_at
      ) order by recent.updated_at desc)
      from (select notification_id, last_error_code, updated_at
            from private.email_notification_deliveries
            where status = 'failed'
            order by updated_at desc limit 10) recent
    ), '[]'::jsonb)
  ) into v_result
  from private.email_notification_config c where c.singleton;
  return v_result;
end;
$$;
revoke all on function public.admin_email_status() from public, anon, authenticated;
grant execute on function public.admin_email_status() to authenticated;

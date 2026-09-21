-- Admin pages for the tag kill switch and the sync history (T019).
--
-- Same shape as the user functions in 20260918000100_platform_admins.sql: every function is security definer, opens
-- with require_platform_admin() so a non-admin gets insufficient_privilege, sorts with per-type keys rather than
-- dynamic SQL, and returns its page and total in one round trip.

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------

-- The tag list behind /admin/tags. `is_functional` says whether a tag feeds "does the same job" (the allowlist minus
-- the denylist), counting disabled tags too, so an admin can see which switches actually change recommendations.
-- Reads functional_tags_all once per call, not once per row.
create function public.admin_list_tags(
  p_tag_id uuid default null,
  p_search text default null,
  p_disabled_only boolean default false,
  p_functional_only boolean default false,
  p_sort text default 'card_count',
  p_ascending boolean default false,
  p_offset integer default 0,
  p_limit integer default 25
)
returns table (
  id uuid,
  slug text,
  label text,
  description text,
  card_count integer,
  idf real,
  is_functional boolean,
  disabled boolean,
  disabled_reason text,
  disabled_by_email text,
  disabled_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public.require_platform_admin();

  return query
  with functional as materialized (
    select f.tag_id from public.functional_tags_all f
  ),
  base as (
    select
      t.id,
      t.slug,
      t.label,
      t.description,
      t.card_count,
      t.idf,
      (fn.tag_id is not null) as is_functional,
      t.disabled,
      t.disabled_reason,
      u.email::text as disabled_by_email,
      t.disabled_at
    from public.tags t
    left join functional fn on fn.tag_id = t.id
    left join auth.users u on u.id = t.disabled_by
    where t.deleted_at is null
      and (p_tag_id is null or t.id = p_tag_id)
      and (not coalesce(p_disabled_only, false) or t.disabled)
      and (not coalesce(p_functional_only, false) or fn.tag_id is not null)
      and (
        v_search is null
        or t.label ilike '%' || v_search || '%'
        or t.slug ilike '%' || v_search || '%'
        or t.id::text = v_search
      )
  ),
  keyed as (
    select
      base.*,
      count(*) over () as total_count,
      case p_sort when 'label' then lower(base.label) when 'slug' then base.slug end as sort_text,
      case p_sort when 'card_count' then base.card_count::real when 'idf' then base.idf end as sort_num,
      case p_sort when 'disabled_at' then base.disabled_at end as sort_time
    from base
  )
  select
    keyed.id, keyed.slug, keyed.label, keyed.description, keyed.card_count, keyed.idf, keyed.is_functional,
    keyed.disabled, keyed.disabled_reason, keyed.disabled_by_email, keyed.disabled_at, keyed.total_count
  from keyed
  order by
    case when p_ascending then keyed.sort_text end asc nulls last,
    case when not p_ascending then keyed.sort_text end desc nulls last,
    case when p_ascending then keyed.sort_num end asc nulls last,
    case when not p_ascending then keyed.sort_num end desc nulls last,
    case when p_ascending then keyed.sort_time end asc nulls last,
    case when not p_ascending then keyed.sort_time end desc nulls last,
    keyed.label,
    keyed.id
  offset v_offset
  limit v_limit;
end;
$$;

revoke execute on function public.admin_list_tags(uuid, text, boolean, boolean, text, boolean, integer, integer) from public, anon;
grant execute on function public.admin_list_tags(uuid, text, boolean, boolean, text, boolean, integer, integer) to authenticated, service_role;

-- The kill switch. Turning a tag off records who and why; turning it back on clears all three, so a re-enabled tag
-- looks like one that was never touched. Only a real change is written and audited: saving the form unchanged is a
-- no-op rather than a new row version and a misleading audit entry. Tag syncs never touch these columns.
create function public.admin_set_tag_disabled(p_tag_id uuid, p_disabled boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_platform_admin();
  v_reason text := case when p_disabled then nullif(btrim(coalesce(p_reason, '')), '') end;
begin
  if p_disabled is null then
    raise exception 'Say whether the tag is on or off.' using errcode = 'check_violation';
  end if;
  if v_reason is not null and char_length(v_reason) > 200 then
    raise exception 'A reason is at most 200 characters.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.tags where id = p_tag_id and deleted_at is null) then
    raise exception 'No such tag.' using errcode = 'no_data_found';
  end if;

  update public.tags
  set disabled = p_disabled,
      disabled_reason = v_reason,
      -- Who and when describe the switch being thrown, so a reason edit on an already-disabled tag keeps them.
      disabled_by = case when not p_disabled then null when disabled then disabled_by else v_actor end,
      disabled_at = case when not p_disabled then null when disabled then disabled_at else now() end
  where id = p_tag_id
    and (disabled, disabled_reason) is distinct from (p_disabled, v_reason);

  if found then
    insert into public.audit_log (actor, action, payload)
    values (
      v_actor,
      case when p_disabled then 'admin.tag_disable' else 'admin.tag_enable' end,
      jsonb_build_object('tag_id', p_tag_id, 'reason', v_reason)
    );
  end if;
end;
$$;

revoke execute on function public.admin_set_tag_disabled(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_tag_disabled(uuid, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Sync runs
-- ---------------------------------------------------------------------------

-- The sync history behind /admin/sync-runs, newest first by default. Job and status arrive as text and are compared
-- as text, so an unknown value filters to nothing instead of failing an enum cast. `checkpoint` is left out: it is
-- resume state for the worker, not something a person reads.
create function public.admin_list_sync_runs(
  p_run_id bigint default null,
  p_job text default null,
  p_status text default null,
  p_ascending boolean default false,
  p_offset integer default 0,
  p_limit integer default 25
)
returns table (
  id bigint,
  job text,
  status text,
  source_uri text,
  source_updated_at timestamptz,
  worker_id text,
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  rows_read bigint,
  rows_changed bigint,
  metrics jsonb,
  error text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform public.require_platform_admin();

  return query
  select
    r.id, r.job::text, r.status::text, r.source_uri, r.source_updated_at, r.worker_id, r.started_at, r.heartbeat_at,
    r.finished_at, r.rows_read, r.rows_changed, r.metrics, r.error,
    count(*) over () as total_count
  from public.sync_runs r
  where (p_run_id is null or r.id = p_run_id)
    and (p_job is null or r.job::text = p_job)
    and (p_status is null or r.status::text = p_status)
  order by
    case when p_ascending then r.started_at end asc,
    case when not p_ascending then r.started_at end desc,
    r.id desc
  offset v_offset
  limit v_limit;
end;
$$;

revoke execute on function public.admin_list_sync_runs(bigint, text, text, boolean, integer, integer) from public, anon;
grant execute on function public.admin_list_sync_runs(bigint, text, text, boolean, integer, integer) to authenticated, service_role;

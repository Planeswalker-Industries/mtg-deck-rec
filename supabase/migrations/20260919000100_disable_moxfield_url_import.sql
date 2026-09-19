-- Disable Moxfield URL imports: Moxfield's API requires authentication (Bearer token,
-- X-Session-User, x-moxfield-version headers) on every endpoint. Text/CSV paste import
-- is the supported path.
update public.share_import_sources
set enabled = false,
    disabled_at = now(),
    disabled_reason = 'Moxfield API requires authentication',
    updated_at = now()
where source = 'moxfield';

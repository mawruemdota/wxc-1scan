-- 1scan registration link setting. Isolated to the existing shared 1xb Supabase project.
-- Only the server-side service_role can read/write settings; the public UI receives
-- solely the configured registration URL through /api/registration.
create table if not exists public.one_scan_settings (
  setting_key text primary key check (setting_key = 'registration_url'),
  setting_value text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.one_scan_settings enable row level security;
revoke all on table public.one_scan_settings from public, anon, authenticated;
grant select, insert, update on table public.one_scan_settings to service_role;
insert into public.one_scan_settings (setting_key, setting_value)
values ('registration_url', '')
on conflict (setting_key) do nothing;

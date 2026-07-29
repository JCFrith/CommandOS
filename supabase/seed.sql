-- Local development seed (applied by `supabase db reset`).
-- Creates one personal workspace + membership so the console is usable against a
-- local Supabase without going through OAuth. NEVER used in production (seed runs
-- only on a local reset). The user id matches the dev-operator convention.

insert into workspaces (id, name, slug, kind)
values ('00000000-0000-0000-0000-000000000001', 'Local workspace', 'personal', 'personal')
on conflict do nothing;

insert into workspace_members (workspace_id, user_id, role)
values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', 'owner')
on conflict do nothing;

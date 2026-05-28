-- Task Board v1 migration
-- Tables: tasks, task_activities, task_attachments
-- + RLS scoped via is_workspace_member()
-- + storage bucket task-attachments

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.leads(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'todo'
    check (status in ('todo','in_progress','blocked','done')),
  priority text not null default 'medium'
    check (priority in ('low','medium','high','urgent')),
  assignee_id uuid references public.profiles(id) on delete set null,
  due_date date,
  position double precision not null default 0,
  tags text[] not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists tasks_ws_status_pos_idx on public.tasks (workspace_id, status, position);
create index if not exists tasks_project_idx on public.tasks (project_id);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id);
create index if not exists tasks_due_idx on public.tasks (due_date);

create table if not exists public.task_activities (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  type text not null,
  content text,
  user_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists task_act_task_created_idx on public.task_activities (task_id, created_at desc);

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  file_name text not null,
  file_size bigint,
  file_type text,
  file_path text not null,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists task_att_task_idx on public.task_attachments (task_id);

alter table public.tasks            enable row level security;
alter table public.task_activities  enable row level security;
alter table public.task_attachments enable row level security;

drop policy if exists "ws members read tasks" on public.tasks;
drop policy if exists "ws members write tasks" on public.tasks;
create policy "ws members read tasks" on public.tasks for select
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "ws members write tasks" on public.tasks for all
  using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "ws members read task_activities" on public.task_activities;
drop policy if exists "ws members write task_activities" on public.task_activities;
create policy "ws members read task_activities" on public.task_activities for select
  using (exists (select 1 from public.tasks t
                 where t.id = task_id and public.is_workspace_member(t.workspace_id, auth.uid())));
create policy "ws members write task_activities" on public.task_activities for all
  using (exists (select 1 from public.tasks t
                 where t.id = task_id and public.is_workspace_member(t.workspace_id, auth.uid())))
  with check (exists (select 1 from public.tasks t
                 where t.id = task_id and public.is_workspace_member(t.workspace_id, auth.uid())));

drop policy if exists "ws members read task_attachments" on public.task_attachments;
drop policy if exists "ws members write task_attachments" on public.task_attachments;
create policy "ws members read task_attachments" on public.task_attachments for select
  using (exists (select 1 from public.tasks t
                 where t.id = task_id and public.is_workspace_member(t.workspace_id, auth.uid())));
create policy "ws members write task_attachments" on public.task_attachments for all
  using (exists (select 1 from public.tasks t
                 where t.id = task_id and public.is_workspace_member(t.workspace_id, auth.uid())))
  with check (exists (select 1 from public.tasks t
                 where t.id = task_id and public.is_workspace_member(t.workspace_id, auth.uid())));

-- Storage bucket
insert into storage.buckets (id, name, public)
  values ('task-attachments','task-attachments', false)
  on conflict (id) do nothing;

-- Storage policies: path = <workspace_id>/<task_id>/<filename>
drop policy if exists "task-attachments read" on storage.objects;
drop policy if exists "task-attachments write" on storage.objects;
drop policy if exists "task-attachments update" on storage.objects;
drop policy if exists "task-attachments delete" on storage.objects;

create policy "task-attachments read" on storage.objects for select
  using (
    bucket_id = 'task-attachments'
    and public.is_workspace_member(((string_to_array(name, '/'))[1])::uuid, auth.uid())
  );

create policy "task-attachments write" on storage.objects for insert
  with check (
    bucket_id = 'task-attachments'
    and public.is_workspace_member(((string_to_array(name, '/'))[1])::uuid, auth.uid())
  );

create policy "task-attachments update" on storage.objects for update
  using (
    bucket_id = 'task-attachments'
    and public.is_workspace_member(((string_to_array(name, '/'))[1])::uuid, auth.uid())
  );

create policy "task-attachments delete" on storage.objects for delete
  using (
    bucket_id = 'task-attachments'
    and public.is_workspace_member(((string_to_array(name, '/'))[1])::uuid, auth.uid())
  );

-- updated_at trigger
create or replace function public.tasks_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  if new.status = 'done' and (old.status is distinct from 'done') then
    new.completed_at = now();
  elsif new.status <> 'done' and (old.status = 'done') then
    new.completed_at = null;
  end if;
  return new;
end $$;

drop trigger if exists tasks_updated_at on public.tasks;
create trigger tasks_updated_at
  before update on public.tasks
  for each row execute function public.tasks_set_updated_at();

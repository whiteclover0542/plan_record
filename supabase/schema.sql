-- T06 플랜두씨 다이어리 1 — Plan/Do/See 스키마
-- Supabase SQL 편집기(Dashboard > SQL Editor)에서 그대로 실행한다.
-- 기준 시간대: Asia/Seoul. date 컬럼은 시간 없이 Asia/Seoul 달력 날짜를 의미하고,
-- timestamptz 컬럼은 UTC로 저장하고 화면에서 Asia/Seoul로 변환해 보여준다.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- plans (계획)
-- carried_note_id는 retrospective_notes가 아직 없어 FK 없이 컬럼만 두고,
-- retrospective_notes 생성 뒤 아래에서 ALTER TABLE로 FK를 추가한다.
-- ---------------------------------------------------------------------
create table plans (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  period_start date not null,
  period_end date not null,
  priority text not null check (priority in ('high', 'medium', 'low')),
  success_criteria text not null,
  estimated_minutes int not null check (estimated_minutes >= 0),
  carried_note_id uuid,
  color_border text not null default '#8a8a8f',
  color_text text not null default '#f2f2f2',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- plan_revisions (계획 수정 이력 — 수정 직전 스냅샷)
-- ---------------------------------------------------------------------
create table plan_revisions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  prev_title text not null,
  prev_period_start date not null,
  prev_period_end date not null,
  prev_priority text not null,
  prev_success_criteria text not null,
  prev_estimated_minutes int not null,
  replaced_at timestamptz not null default now()
);

-- plans가 UPDATE되기 직전 OLD row를 자동으로 plan_revisions에 적재한다.
-- 앱 코드가 이력 저장을 깜빡해도 DB가 항상 보존한다.
-- security definer로 실행해야 한다: 트리거는 호출한 쪽(anon)의 권한으로 도니까,
-- anon에게 plan_revisions INSERT 권한을 직접 주지 않은 채로도(클라이언트가 이력을
-- 조작 못 하게) 트리거만 안전하게 적재할 수 있다.
create or replace function snapshot_plan_before_update()
returns trigger as $$
begin
  insert into plan_revisions (
    plan_id, prev_title, prev_period_start, prev_period_end,
    prev_priority, prev_success_criteria, prev_estimated_minutes
  ) values (
    old.id, old.title, old.period_start, old.period_end,
    old.priority, old.success_criteria, old.estimated_minutes
  );
  new.updated_at := now();
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

create trigger trg_snapshot_plan_before_update
  before update on plans
  for each row
  execute function snapshot_plan_before_update();

-- ---------------------------------------------------------------------
-- todos (할 일)
-- ---------------------------------------------------------------------
create table todos (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  title text not null,
  due_date date not null,
  priority text not null check (priority in ('high', 'medium', 'low')),
  tags text[] not null default '{}',
  estimated_minutes int not null check (estimated_minutes >= 0),
  status text not null default 'open' check (status in ('open', 'done')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index idx_todos_plan_id on todos(plan_id);
create index idx_todos_status on todos(status);
create index idx_todos_due_date on todos(due_date);

-- ---------------------------------------------------------------------
-- execution_logs (실행 기록 / Do)
-- ---------------------------------------------------------------------
create table execution_logs (
  id uuid primary key default gen_random_uuid(),
  todo_id uuid not null references todos(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  actual_minutes int not null check (actual_minutes >= 0),
  blocked_reason text,
  created_at timestamptz not null default now()
);

create index idx_execution_logs_todo_id on execution_logs(todo_id);

-- ---------------------------------------------------------------------
-- retrospective_notes (돌아보기 → 다음 계획으로 넘기는 한 줄)
-- ---------------------------------------------------------------------
create table retrospective_notes (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now()
);

alter table plans
  add constraint fk_plans_carried_note
  foreign key (carried_note_id) references retrospective_notes(id) on delete set null;

-- ---------------------------------------------------------------------
-- complete_todo(todo_id) — 멱등 완료 처리
-- 이미 done이면 아무 것도 갱신되지 않고 execution_logs도 늘지 않는다.
-- 연달아 두 번 호출해도 완료 기록/집계가 한 번만 늘어남을 이 함수 하나가 보장한다.
-- ---------------------------------------------------------------------
create or replace function complete_todo(
  p_todo_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_actual_minutes int,
  p_blocked_reason text default null
)
returns table (todo_id uuid, execution_log_id uuid, newly_completed boolean) as $$
declare
  v_updated_id uuid;
  v_log_id uuid;
begin
  update todos
  set status = 'done', completed_at = now()
  where id = p_todo_id and status <> 'done'
  returning id into v_updated_id;

  if v_updated_id is not null then
    insert into execution_logs (todo_id, started_at, ended_at, actual_minutes, blocked_reason)
    values (p_todo_id, p_started_at, p_ended_at, p_actual_minutes, p_blocked_reason)
    returning id into v_log_id;
  end if;

  return query select p_todo_id, v_log_id, (v_updated_id is not null);
end;
$$ language plpgsql;

-- 완료 상태가 아니어도 실행 기록만 남기고 싶을 때(막힘 기록 등) 쓰는 일반 삽입 경로.
-- complete_todo와 별개로 존재 — todos.status는 건드리지 않는다.

-- ---------------------------------------------------------------------
-- reopen_todo(todo_id) — 완료를 진행 중으로 되돌리기 (T06-C12)
-- ---------------------------------------------------------------------
create or replace function reopen_todo(p_todo_id uuid)
returns void as $$
begin
  update todos set status = 'open', completed_at = null where id = p_todo_id;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- Row Level Security — 로그인이 없으므로 anon 롤에 필요한 권한만 명시적으로 부여
-- ---------------------------------------------------------------------
alter table plans enable row level security;
alter table plan_revisions enable row level security;
alter table todos enable row level security;
alter table execution_logs enable row level security;
alter table retrospective_notes enable row level security;

create policy plans_select on plans for select using (true);
create policy plans_insert on plans for insert with check (true);
create policy plans_update on plans for update using (true) with check (true);

create policy plan_revisions_select on plan_revisions for select using (true);

create policy todos_select on todos for select using (true);
create policy todos_insert on todos for insert with check (true);
create policy todos_update on todos for update using (true) with check (true);
create policy todos_delete on todos for delete using (true);

create policy execution_logs_select on execution_logs for select using (true);
create policy execution_logs_insert on execution_logs for insert with check (true);

create policy retrospective_notes_select on retrospective_notes for select using (true);
create policy retrospective_notes_insert on retrospective_notes for insert with check (true);

grant usage on schema public to anon;
grant select, insert, update on plans to anon;
grant select on plan_revisions to anon;
grant select, insert, update, delete on todos to anon;
grant select, insert on execution_logs to anon;
grant select, insert on retrospective_notes to anon;
grant execute on function complete_todo(uuid, timestamptz, timestamptz, int, text) to anon;
grant execute on function reopen_todo(uuid) to anon;

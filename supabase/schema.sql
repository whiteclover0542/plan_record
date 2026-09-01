-- 플랜두씨 다이어리 — Plan/Do/See 스키마 (T07: 로그인 포함, 사용자별 소유권)
-- 이 파일은 "지금 새로 설치한다면" 만들어질 최종 스키마다. 이미 T06 데이터가 있는
-- 기존 프로젝트에 적용할 때는 이 파일 대신 supabase/migration-t07-auth.sql을 실행한다.
-- Supabase SQL 편집기(Dashboard > SQL Editor)에서 그대로 실행한다.
-- 기준 시간대: Asia/Seoul. date 컬럼은 시간 없이 Asia/Seoul 달력 날짜를 의미하고,
-- timestamptz 컬럼은 UTC로 저장하고 화면에서 Asia/Seoul로 변환해 보여준다.
-- 인증: Supabase Auth(이메일+비밀번호). 각 표의 user_id는 auth.users(id)를 가리키고,
-- Row Level Security로 "내 것만" 보이게 강제한다 — anon 롤에는 어떤 표 권한도 주지 않는다.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- plans (계획)
-- carried_note_id는 retrospective_notes가 아직 없어 FK 없이 컬럼만 두고,
-- retrospective_notes 생성 뒤 아래에서 ALTER TABLE로 FK를 추가한다.
-- ---------------------------------------------------------------------
create table plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
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

create index idx_plans_user_id on plans(user_id);

-- ---------------------------------------------------------------------
-- plan_revisions (계획 수정 이력 — 수정 직전 스냅샷)
-- ---------------------------------------------------------------------
create table plan_revisions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  prev_title text not null,
  prev_period_start date not null,
  prev_period_end date not null,
  prev_priority text not null,
  prev_success_criteria text not null,
  prev_estimated_minutes int not null,
  replaced_at timestamptz not null default now()
);

create index idx_plan_revisions_user_id on plan_revisions(user_id);

-- plans가 UPDATE되기 직전 OLD row를 자동으로 plan_revisions에 적재한다.
-- 앱 코드가 이력 저장을 깜빡해도 DB가 항상 보존한다.
-- security definer로 실행해야 한다: 트리거는 호출한 쪽(authenticated)의 권한으로 도니까,
-- 클라이언트에 plan_revisions INSERT 권한을 직접 주지 않은 채로도(클라이언트가 이력을
-- 조작 못 하게) 트리거만 안전하게 적재할 수 있다.
create or replace function snapshot_plan_before_update()
returns trigger as $$
begin
  insert into plan_revisions (
    plan_id, user_id, prev_title, prev_period_start, prev_period_end,
    prev_priority, prev_success_criteria, prev_estimated_minutes
  ) values (
    old.id, old.user_id, old.title, old.period_start, old.period_end,
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
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
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
create index idx_todos_user_id on todos(user_id);

-- ---------------------------------------------------------------------
-- execution_logs (실행 기록 / Do)
-- ---------------------------------------------------------------------
create table execution_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  todo_id uuid not null references todos(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  actual_minutes int not null check (actual_minutes >= 0),
  blocked_reason text,
  created_at timestamptz not null default now()
);

create index idx_execution_logs_todo_id on execution_logs(todo_id);
create index idx_execution_logs_user_id on execution_logs(user_id);

-- ---------------------------------------------------------------------
-- retrospective_notes (돌아보기 → 다음 계획으로 넘기는 한 줄)
-- ---------------------------------------------------------------------
create table retrospective_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_id uuid not null references plans(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now()
);

create index idx_retrospective_notes_user_id on retrospective_notes(user_id);

alter table plans
  add constraint fk_plans_carried_note
  foreign key (carried_note_id) references retrospective_notes(id) on delete set null;

-- ---------------------------------------------------------------------
-- complete_todo(todo_id) — 멱등 완료 처리 + 소유자 확인
-- 이미 done이거나 내 할 일이 아니면 아무 것도 갱신되지 않고 execution_logs도 늘지 않는다.
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
  v_owner_id uuid;
  v_log_id uuid;
begin
  update todos
  set status = 'done', completed_at = now()
  where id = p_todo_id and status <> 'done' and user_id = auth.uid()
  returning id, user_id into v_updated_id, v_owner_id;

  if v_updated_id is not null then
    insert into execution_logs (todo_id, user_id, started_at, ended_at, actual_minutes, blocked_reason)
    values (p_todo_id, v_owner_id, p_started_at, p_ended_at, p_actual_minutes, p_blocked_reason)
    returning id into v_log_id;
  end if;

  return query select p_todo_id, v_log_id, (v_updated_id is not null);
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- reopen_todo(todo_id) — 완료를 진행 중으로 되돌리기, 소유자 확인 포함
-- ---------------------------------------------------------------------
create or replace function reopen_todo(p_todo_id uuid)
returns void as $$
begin
  update todos set status = 'open', completed_at = null
  where id = p_todo_id and user_id = auth.uid();
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- delete_my_account() — 내 계정과 내 자료 전체 삭제(셀프서비스)
-- auth.users delete는 기본적으로 service_role만 가능해서, "내 id일 때만" 지우도록
-- 좁힌 security definer 함수로 노출한다. 삭제되면 각 표의 user_id FK(on delete cascade)로
-- 내 계획·할일·실행기록·돌아보기 메모가 함께 지워진다.
-- ---------------------------------------------------------------------
create or replace function delete_my_account()
returns void as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- ---------------------------------------------------------------------
-- Row Level Security — anon 롤에는 어떤 표 권한도 주지 않는다. 로그인(authenticated)한
-- 사용자만, 그것도 자기 user_id의 행만 볼 수 있다.
-- ---------------------------------------------------------------------
alter table plans enable row level security;
alter table plan_revisions enable row level security;
alter table todos enable row level security;
alter table execution_logs enable row level security;
alter table retrospective_notes enable row level security;

create policy plans_select on plans for select to authenticated using (user_id = auth.uid());
create policy plans_insert on plans for insert to authenticated with check (user_id = auth.uid());
-- update: using(true)로 대상 행 자체는 찾되(존재 여부는 가리지 않음), with check로 결과 행의
-- user_id가 내 것이 아니면 명시적으로 42501(HTTP 403)로 거절한다 — 남의 계획을 고치려는
-- 시도는 "조용히 0행" 대신 항상 뚜렷한 거절 응답으로 남는다.
create policy plans_update on plans for update to authenticated using (true) with check (user_id = auth.uid());
create policy plans_delete on plans for delete to authenticated using (user_id = auth.uid());

create policy plan_revisions_select on plan_revisions for select to authenticated using (user_id = auth.uid());

create policy todos_select on todos for select to authenticated using (user_id = auth.uid());
create policy todos_insert on todos for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from plans p where p.id = plan_id and p.user_id = auth.uid())
);
create policy todos_update on todos for update to authenticated using (true) with check (user_id = auth.uid());
create policy todos_delete on todos for delete to authenticated using (user_id = auth.uid());

create policy execution_logs_select on execution_logs for select to authenticated using (user_id = auth.uid());
create policy execution_logs_insert on execution_logs for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from todos t where t.id = todo_id and t.user_id = auth.uid())
);

create policy retrospective_notes_select on retrospective_notes for select to authenticated using (user_id = auth.uid());
create policy retrospective_notes_insert on retrospective_notes for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from plans p where p.id = plan_id and p.user_id = auth.uid())
);

grant usage on schema public to authenticated;
grant select, insert, update, delete on plans to authenticated;
grant select on plan_revisions to authenticated;
grant select, insert, update, delete on todos to authenticated;
grant select, insert on execution_logs to authenticated;
grant select, insert on retrospective_notes to authenticated;
grant execute on function complete_todo(uuid, timestamptz, timestamptz, int, text) to authenticated;
grant execute on function reopen_todo(uuid) to authenticated;
grant execute on function delete_my_account() to authenticated;

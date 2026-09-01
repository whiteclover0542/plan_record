-- T07 마이그레이션: 로그인 없는 공개 앱 → Supabase Auth 기반 사용자별 소유권
-- T06에서 이미 넣어 둔 실제 계획/할일/실행기록/돌아보기 자료를 지우지 않고 그대로 보존한 채 적용한다.
-- Supabase 대시보드 > SQL Editor에서 위에서부터 그대로 실행한다(대시보드 SQL Editor는
-- 로그인한 프로젝트 소유자 권한으로 실행되므로 auth.users 등 관리 스키마도 건드릴 수 있다).
--
-- 실행 순서 (자세한 클릭 단위 안내는 PROGRESS.md "다음 단계" 참고):
--   1) "-- ===== 여기까지 1차 =====" 표시가 나올 때까지(첫 commit;까지)만 복사해 SQL Editor에서 실행한다.
--   2) 화면에서 회원가입으로 내 실제 계정을 하나 만든다(이메일 확인이 켜져 있으면 메일함에서 확인까지).
--   3) 아래 STEP 4의 '내이메일@example.com' 한 군데를 방금 가입한 실제 이메일로 바꾼다.
--   4) "-- ===== 여기부터 2차 =====" 표시부터 파일 끝까지 복사해 실행한다.

begin;

-- ---------------------------------------------------------------------
-- STEP 1 — 소유권 컬럼 추가 (기존 행이 있으므로 우선 nullable로 추가한다)
-- ---------------------------------------------------------------------
alter table plans add column user_id uuid references auth.users(id) on delete cascade;
alter table todos add column user_id uuid references auth.users(id) on delete cascade;
alter table execution_logs add column user_id uuid references auth.users(id) on delete cascade;
alter table retrospective_notes add column user_id uuid references auth.users(id) on delete cascade;
alter table plan_revisions add column user_id uuid references auth.users(id) on delete cascade;

-- ---------------------------------------------------------------------
-- STEP 2 — 기존(로그인 없는 시절) 정책·권한 전부 제거
-- ---------------------------------------------------------------------
drop policy if exists plans_select on plans;
drop policy if exists plans_insert on plans;
drop policy if exists plans_update on plans;
drop policy if exists plan_revisions_select on plan_revisions;
drop policy if exists todos_select on todos;
drop policy if exists todos_insert on todos;
drop policy if exists todos_update on todos;
drop policy if exists todos_delete on todos;
drop policy if exists execution_logs_select on execution_logs;
drop policy if exists execution_logs_insert on execution_logs;
drop policy if exists retrospective_notes_select on retrospective_notes;
drop policy if exists retrospective_notes_insert on retrospective_notes;

revoke all on plans, plan_revisions, todos, execution_logs, retrospective_notes from anon;
revoke execute on function complete_todo(uuid, timestamptz, timestamptz, int, text) from anon;
revoke execute on function reopen_todo(uuid) from anon;

-- ---------------------------------------------------------------------
-- STEP 3 — 지금 이 시점의 anon 접근을 완전히 막아 둔다 (컬럼이 아직 nullable인 동안
-- 로그인 없는 쓰기가 뚫려 있으면 안 되므로, 소유자 계정을 만들기 전까지는 select만 postgres
-- 세션(SQL Editor)으로 직접 확인한다). 이 시점에는 authenticated 권한도 아직 열지 않는다.
-- ---------------------------------------------------------------------
-- (권한을 아무에게도 주지 않은 상태로 STEP 4까지 진행 — 화면은 이 구간 동안 잠시 접근 불가)

commit;

-- ===== 여기까지 1차 (여기까지만 복사해서 먼저 실행) =====

-- ---------------------------------------------------------------------
-- ※ 여기서 화면(배포 주소 또는 로컬)의 가입 화면으로 내 실제 계정을 하나 만든다.
--    그 다음 아래로 이어서 실행한다.
-- ---------------------------------------------------------------------

-- ===== 여기부터 2차 (STEP 4의 이메일을 바꾼 뒤, 여기부터 끝까지 복사해서 실행) =====

begin;

-- ---------------------------------------------------------------------
-- STEP 4 — 기존 T06 실데이터를 내 실제 계정으로 이관
--    '내이메일@example.com' 두 군데를 방금 가입한 실제 이메일로 바꿔서 실행한다.
--    (uuid를 직접 몰라도 된다 — 이메일로 auth.users에서 자동으로 찾는다)
-- ---------------------------------------------------------------------
update plans set user_id = (select id from auth.users where email = 'whiteclover0542@gmail.com') where user_id is null;
update todos set user_id = (select p.user_id from plans p where p.id = todos.plan_id) where user_id is null;
update execution_logs set user_id = (select t.user_id from todos t where t.id = execution_logs.todo_id) where user_id is null;
update retrospective_notes set user_id = (select p.user_id from plans p where p.id = retrospective_notes.plan_id) where user_id is null;
update plan_revisions set user_id = (select p.user_id from plans p where p.id = plan_revisions.plan_id) where user_id is null;

-- 확인: 아래 값이 0이 아니면(=방금 가입한 이메일을 못 찾으면) 위 이메일 오타를 의심한다.
-- select count(*) from auth.users where email = 'whiteclover0542@gmail.com';

-- ---------------------------------------------------------------------
-- STEP 5 — 이관 확인 후 NOT NULL로 잠그고, 앞으로의 insert는 auth.uid()가 기본값이 되게 한다
-- ---------------------------------------------------------------------
alter table plans alter column user_id set not null;
alter table todos alter column user_id set not null;
alter table execution_logs alter column user_id set not null;
alter table retrospective_notes alter column user_id set not null;
alter table plan_revisions alter column user_id set not null;

alter table plans alter column user_id set default auth.uid();
alter table todos alter column user_id set default auth.uid();
alter table execution_logs alter column user_id set default auth.uid();
alter table retrospective_notes alter column user_id set default auth.uid();

create index idx_plans_user_id on plans(user_id);
create index idx_todos_user_id on todos(user_id);
create index idx_execution_logs_user_id on execution_logs(user_id);
create index idx_retrospective_notes_user_id on retrospective_notes(user_id);
create index idx_plan_revisions_user_id on plan_revisions(user_id);

-- ---------------------------------------------------------------------
-- STEP 6 — 새 소유권 기반 권한·정책 (authenticated 롤에게만 부여, anon은 아무 권한도 없음)
-- ---------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on plans to authenticated;
grant select on plan_revisions to authenticated;
grant select, insert, update, delete on todos to authenticated;
grant select, insert on execution_logs to authenticated;
grant select, insert on retrospective_notes to authenticated;

create policy plans_select on plans for select to authenticated using (user_id = auth.uid());
create policy plans_insert on plans for insert to authenticated with check (user_id = auth.uid());
-- update: using(true)로 대상 행 자체는 찾되(존재 여부는 가리지 않음), with check로 결과 행의
-- user_id가 내 것이 아니면 명시적으로 42501(HTTP 403)로 거절한다. "조용히 0행" 대신
-- 남의 계획을 고치려는 시도는 항상 뚜렷한 거절 응답으로 남긴다.
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

-- ---------------------------------------------------------------------
-- STEP 7 — plan_revisions 스냅샷 트리거: user_id도 함께 적재하도록 갱신
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- STEP 8 — complete_todo / reopen_todo: 함수 안에서도 소유자 조건을 명시한다.
-- security invoker(기본값)라 RLS가 그대로 적용되지만, 조건을 직접 써서 "왜 막히는지"를
-- 함수 정의만 봐도 알 수 있게 한다. 남의 할 일 id를 넣으면 v_updated_id가 NULL로 남아
-- newly_completed=false로 조용히 실패한다(RPC라 200으로 응답하되 실제로는 아무 것도 바뀌지 않음).
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

create or replace function reopen_todo(p_todo_id uuid)
returns void as $$
begin
  update todos set status = 'open', completed_at = null
  where id = p_todo_id and user_id = auth.uid();
end;
$$ language plpgsql;

grant execute on function complete_todo(uuid, timestamptz, timestamptz, int, text) to authenticated;
grant execute on function reopen_todo(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- STEP 9 — 계정 삭제(카드5, T07-C134). auth.users 삭제는 기본적으로 service_role만
-- 가능하므로, "내 id일 때만" 지우도록 좁힌 security definer 함수로 셀프서비스를 연다.
-- auth.users가 지워지면 각 표의 user_id FK(on delete cascade)로 내 자료도 함께 지워진다.
-- ---------------------------------------------------------------------
create or replace function delete_my_account()
returns void as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function delete_my_account() to authenticated;

commit;

-- ---------------------------------------------------------------------
-- 확인용 쿼리 (실행 후 눈으로 확인)
-- ---------------------------------------------------------------------
-- select relname, relrowsecurity from pg_class where relname in
--   ('plans','plan_revisions','todos','execution_logs','retrospective_notes');
-- select tablename, policyname, cmd, roles from pg_policies where schemaname = 'public';
-- select count(*) filter (where user_id is null) as still_null, count(*) as total from plans;

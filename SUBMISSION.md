# T07 플랜두씨 다이어리 2 — 제출 문서 (작성 중)

> ⚠️ 아직 완성되지 않았다 — 5일 실사용 로그(카드5)가 끝나야 최종 수치·스크린샷을 확정할 수 있다.
> 작업 근거(curl 요청/응답 전문, 설계 결정, SQL 마이그레이션 과정)는 [PROGRESS.md](PROGRESS.md) 참고.
> T06(로그인 없는 버전) 최종 제출 문서는 [archive/t06/SUBMISSION.md](archive/t06/SUBMISSION.md).

## 결과물 주소

https://whiteclover0542.github.io/plan_record/

첫 화면은 로그인 화면이다. 로그인 없이는 자료 화면이 열리지 않고, 계정을 만들지 않아도 로그인 화면까지는 누구나 열린다.

## 소스 주소

*(제출 시점의 고정 commit URL로 채움 — 예: `https://github.com/whiteclover0542/plan_record/tree/<commit-sha>`)*

이어서 사용한 T06 최종 결과: [archive/t06/](archive/t06/) — T06 소스 이력이 이 브랜치의 조상 커밋으로 포함되어 있다(T07-C77/C78).

---

## 인증 구현 설명서

① **무엇으로 붙였나** — Supabase Auth(이메일+비밀번호), `@supabase/supabase-js@2.112.4`.

② **왜 그걸 골랐나** — 이미 Supabase Postgres + Row Level Security 위에서 이 앱이 동작 중이라 `auth.uid()`로 바로 연결됨. 검토했으나 고르지 않은 방법:
- 직접 구현(bcrypt+JWT) — 세션 무효화·토큰 재발급 등 보안 디테일을 직접 구현·검증하는 부담이 큼
- 별도 인증 서비스(Auth0/Clerk) — 인프라가 하나 더 늘고 DB RLS와의 연동 지점이 늘어남

③ **어디를 어떻게 고쳤나** — 가입·로그인·로그아웃·자료 조회 네 흐름:
- **가입**: `index.html`의 `#signup-form` → `pds-auth.js`(`signupForm` submit 핸들러) → `pds-app.js`(`Auth.signUp`, `sb.auth.signUp`) → Supabase Auth REST `POST /auth/v1/signup` → `auth.users`에 계정 생성(비밀번호는 bcrypt 해시로 저장)
- **로그인**: `#login-form` → `pds-auth.js`(`loginForm` submit) → `pds-app.js`(`Auth.signIn`, `sb.auth.signInWithPassword`) → `POST /auth/v1/token?grant_type=password` → JWT access/refresh token 발급
- **로그아웃**: `#logout-btn` → `pds-auth.js` → `pds-app.js`(`Auth.signOut`) → `POST /auth/v1/logout` → 세션 사라짐을 감지해 화면이 로그인 화면으로 복귀
- **자료 조회**: 로그인 성공 후 `pds-ui.js`의 `refreshPlans()` → `pds-app.js`(`Plans.list`) → PostgREST가 요청 JWT의 `auth.uid()`로 `supabase/schema.sql`의 `plans_select` 정책(`using (user_id = auth.uid())`)을 적용해 내 자료만 반환

DB 쪽: `supabase/migration-t07-auth.sql`로 기존 T06 데이터를 보존한 채 5개 표(`plans`/`plan_revisions`/`todos`/`execution_logs`/`retrospective_notes`) 전부에 `user_id`(auth.users 참조) 컬럼을 추가하고, RLS를 `authenticated` + `user_id = auth.uid()` 기준으로 재작성했다. `anon` 롤에는 이 5개 표 어떤 권한도 남기지 않았다.

④ **안 열리는 것을 확인한 기록** — anon key만으로 라이브 프로젝트에 curl로 직접 요청을 보내 확인(disposable 테스트 계정 사용, 비밀번호는 어디에도 남기지 않음). 아래 값은 실제 관측된 상태 코드다.

| 확인 | 성공 요청 | 거절/무효 요청 |
|---|---|---|
| 가입 중복 | 새 이메일 `POST /auth/v1/signup` → `200` | 같은 이메일 재가입 → `422 user_already_exists` |
| 로그인 문구 | 올바른 비밀번호 `POST /auth/v1/token?grant_type=password` → `200` | 틀린 비밀번호/존재 안 하는 이메일 → 둘 다 `400 {"error_code":"invalid_credentials","msg":"Invalid login credentials"}`(동일 문구) |
| 비밀번호 저장 | (해당 없음) | SQL Editor 조회: `encrypted_password` = `$2a$10$...`(bcrypt, 입력 글자와 무관) — 같은 비밀번호로 만든 두 계정도 서로 다른 값 |
| 세션 조회 | 로그인 상태로 `GET /rest/v1/plans` → `200` | 로그아웃 뒤 refresh token 재사용 → `400 refresh_token_not_found`(즉시 무효화) |
| 계정 간 읽기/수정/삭제 | 본인 자료 조회/수정 → `200`(정상 반영) | 남의 `plans`/`todos` 행에 대한 읽기·수정·삭제 시도(양방향) → `200`+빈 배열(값 변경 없음, 실제 대조로 확인), 소유권 위조·교차 INSERT 시도는 `403` |
| 비로그인 직접 요청 | (해당 없음) | `Authorization` 헤더 없이 `GET /rest/v1/plans` → `401 permission denied for table plans` |
| 계정 삭제 | `POST /rest/v1/rpc/delete_my_account` → `204` | 삭제 후 같은 계정으로 재로그인 → `400 invalid_credentials`, 자료도 FK cascade로 실제 삭제 |

⑤ **AI와 나** — 아래 "AI와 내 판단 3줄" 참고.

⑥ **아직 못 막은 것**
- 로그아웃·비밀번호 변경·계정 삭제 중 어느 것을 해도, 그 전에 이미 발급된 access token(JWT)은 자연 만료(최대 1시간) 전까지 계속 통한다. refresh token이나 계정 자체는 즉시 무효화되지만, access token은 서명·만료만으로 자체 검증되는 무상태 토큰이라 서버가 개별 취소를 기억하지 않기 때문이다. 토큰이 탈취됐을 때 최대 1시간의 위험 구간이 남는다.
- 남의 계획을 고치거나 지우려는 시도가 항상 명시적 403은 아니고, 경우에 따라 "조용한 무효 처리"(200+빈 배열)로 응답한다(원인: Postgres RLS가 UPDATE/DELETE 대상 행을 찾을 때도 SELECT 정책을 함께 적용하기 때문 — 데이터는 안전하지만 응답 형태가 균일하지 않다).
- 무차별 대입(brute-force) 로그인 시도 횟수 제한을 이 앱이 직접 만들지 않았다 — Supabase Auth 자체의 기본 rate limit에 의존한다.

---

## 짧은 확인 방법

① 어디로 가나요 — https://whiteclover0542.github.io/plan_record/ 접속(첫 화면이 로그인/가입 화면).
② 세 단계 안에 무엇을 하나요 — (1) 가입하기로 새 계정을 만들거나 기존 계정으로 로그인 (2) "1. 계획" 탭에서 계획 목록을 본다 (3) "3. 돌아보기" 탭에서 집계 숫자를 확인한다.
③ 무엇이 보이면 통과인가요 — 로그인 전에는 로그인 화면만 보이고, 로그인 후에는 그 계정에 속한 자료만 보인다(다른 계정 자료는 절대 섞이지 않는다).
④ 안 될 때는 무엇이 보이나요 — 로그인 없이 자료 화면 주소를 열면 계속 로그인 화면만 보이고, 개발자 콘솔에는 Supabase REST 요청이 401/403으로 거절된 로그가 찍힌다.

## AI와 내 판단 3줄

① AI에게 맡긴 일 — RLS·소유권 마이그레이션 SQL 설계·작성, 로그인 게이트 화면·코드 구현, anon key로 라이브 프로젝트에 curl 테스트를 직접 돌려 근거(성공/거절 요청·응답) 수집, 발견한 문제(토큰 잔존, 조용한 무효 처리)의 원인을 SQL로 규명, 문서 정리.

② 내가 직접 판단한 일 — 인증 방식(Supabase Auth) 최종 승인, 이메일 확인 정책 대시보드 설정, SQL 마이그레이션을 대시보드에서 직접 단계별 실행(실제 계정 생성 포함), 5일 로그의 1일차 관찰 포인트 제시, 계획 삭제 기능 필요성 판단, 실제 계획·할 일·실행 기록 입력.

③ AI 제안을 따르지 않은 일 — *(5일 로그를 진행하며 실제로 다른 판단을 하게 되면 여기에 구체적으로 남긴다. 지금까지는 AI가 제안한 방향을 그대로 받아들여 진행했다.)*

---

## 카드별 증거

*(5일 로그·최종 스크린샷 확보 후 채움 — [PROGRESS.md](PROGRESS.md)의 "마무리 체크리스트"·"curl 테스트 결과 요약"에 상세 근거가 이미 정리돼 있다.)*

### 카드 1 — 무엇으로 붙일지 고르고, 이유를 적기
### 카드 2 — 비밀번호를 어떻게 맡아 두는지 보이기
### 카드 3 — 들어온 사람을 어떻게 기억하는지 보이기
### 카드 4 — 남의 자료가 안 열리는 것을 보이기
### 카드 5 — 설명서로 묶고, 잠근 앱으로 5일 써 보기

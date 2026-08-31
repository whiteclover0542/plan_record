// Supabase 프로젝트 연결 정보.
// anon(public) key는 Supabase 설계상 브라우저에 노출되는 게 정상인 공개 키다 —
// 실제 접근 제어는 서버 쪽 RLS 정책(supabase/schema.sql)이 담당한다.
// service_role 키는 이 파일을 포함해 어디에도 절대 넣지 않는다.
window.PDS_CONFIG = {
  SUPABASE_URL: "https://wnpydszsoeegscgztpui.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InducHlkc3pzb2VlZ3NjZ3p0cHVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxNDg4MDgsImV4cCI6MjEwMzcyNDgwOH0.SEdL8Hhi1s5OeZt-YNZIWRATb_uNYLT1rvlCUCdgziM",
};

// 로그인 게이트 (T07). pds-app.js가 만든 window.PDS_SB / window.PDS.Auth를 그대로 쓴다.
// 로그인 전에는 auth-gate만 보이고, 나머지(모드 전환·습관 기록기·계획 다이어리)는 전부
// hidden으로 숨겨 둔다. 첫 화면이 로그인 화면이어야 하므로 index.html에도 hidden을
// 미리 박아 두고, 여기서는 세션이 확인된 뒤에만 연다.
(function () {
  const { Auth } = window.PDS;

  const authGate = document.getElementById("auth-gate");
  const modeSwitcher = document.querySelector(".mode-switcher");
  const pdsApp = document.getElementById("pds-app");

  const loginForm = document.getElementById("login-form");
  const signupForm = document.getElementById("signup-form");
  const showSignupBtn = document.getElementById("show-signup-btn");
  const showLoginBtn = document.getElementById("show-login-btn");
  const authError = document.getElementById("auth-error");
  const authNotice = document.getElementById("auth-notice");
  const currentUserEmailEl = document.getElementById("current-user-email");
  const logoutBtn = document.getElementById("logout-btn");
  const deleteAccountBtn = document.getElementById("delete-account-btn");

  function showError(msg) {
    authError.textContent = msg;
    authError.hidden = false;
    authNotice.hidden = true;
  }
  function showNotice(msg) {
    authNotice.textContent = msg;
    authNotice.hidden = false;
    authError.hidden = true;
  }
  function clearMessages() {
    authError.hidden = true;
    authNotice.hidden = true;
  }

  function toForm(which) {
    clearMessages();
    loginForm.hidden = which !== "login";
    signupForm.hidden = which !== "signup";
  }
  showSignupBtn.addEventListener("click", () => toForm("signup"));
  showLoginBtn.addEventListener("click", () => toForm("login"));

  function showApp(session) {
    authGate.hidden = true;
    modeSwitcher.hidden = false;
    pdsApp.hidden = false;
    currentUserEmailEl.textContent = session.user.email;
    if (window.PDS_UI && !window.PDS_UI.isStarted()) {
      window.PDS_UI.start();
    }
  }

  function showGate() {
    authGate.hidden = false;
    modeSwitcher.hidden = true;
    pdsApp.hidden = true;
    document.getElementById("habit-app").hidden = true;
    toForm("login");
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMessages();
    const email = loginForm.email.value.trim();
    const password = loginForm.password.value;
    try {
      await Auth.signIn(email, password);
      loginForm.reset();
      // 화면 전환은 onAuthStateChange 구독이 처리한다.
    } catch (err) {
      // Supabase Auth는 "비밀번호 틀림"과 "그런 아이디 없음"에 같은 문구
      // ("Invalid login credentials")를 준다 — 여기서 문구를 갈라 만들지 않고
      // 서버 응답을 그대로 보여준다(T07-C99).
      showError(err.message);
    }
  });

  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMessages();
    const email = signupForm.email.value.trim();
    const password = signupForm.password.value;
    try {
      const data = await Auth.signUp(email, password);
      signupForm.reset();
      if (data.session) {
        // 이메일 확인이 꺼져 있으면 가입과 동시에 로그인 세션이 생긴다.
        return;
      }
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        // 이미 등록된 이메일로 다시 가입을 시도한 경우(계정 존재 여부를 숨기는 응답).
        showNotice("이미 등록된 이메일일 수 있습니다. 이메일을 확인하거나 로그인해 보세요.");
        toForm("login");
        return;
      }
      showNotice("가입 확인 메일을 보냈습니다. 메일함에서 확인 링크를 눌러야 로그인할 수 있습니다.");
      toForm("login");
    } catch (err) {
      showError(err.message);
    }
  });

  logoutBtn.addEventListener("click", async () => {
    try {
      await Auth.signOut();
    } catch (err) {
      alert(err.message);
    }
  });

  deleteAccountBtn.addEventListener("click", async () => {
    if (!confirm("계정을 삭제하면 내 계획·할 일·실행 기록·돌아보기 메모가 모두 함께 삭제됩니다. 되돌릴 수 없습니다. 계속할까요?")) {
      return;
    }
    try {
      await Auth.deleteAccount();
      await Auth.signOut();
      showGate();
      showNotice("계정과 자료가 삭제되었습니다.");
    } catch (err) {
      alert(err.message);
    }
  });

  Auth.onAuthStateChange((session) => {
    if (session) showApp(session);
    else showGate();
  });

  Auth.getSession()
    .then((session) => {
      if (session) showApp(session);
      else showGate();
    })
    .catch(() => showGate());
})();

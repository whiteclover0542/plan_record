// 계획-할일-실행기록-돌아보기 렌더링 + 이벤트 계층.
// 옛 습관 기록기(ui.js/checklist.js)와 한 페이지에 공존하므로 전부 IIFE 안에 두고
// pds-app.js가 window.PDS에 내보낸 데이터 계층만 가져다 쓴다 — 전역 이름이 겹치지 않는다.
// DOM 생성은 항상 textContent 기반 el() 헬퍼를 거쳐 사용자 입력이 innerHTML로 들어가지
// 않게 한다(스크립트 모양 글자가 리터럴로만 보이게).
(function () {
  const {
    Plans, Todos, ExecutionLogs, RetroNotes, Aggregation,
    sortTodos, filterTodos, ExportAll,
    todayInSeoul, formatSeoulDateTime, seoulWallClockToUtcIso, nowIsoInSeoulInput, parseTags,
  } = window.PDS;

  const todayInit = new Date();
  const state = {
    currentPlanId: null,
    plans: [],
    calendarTodos: [],
    executionLogsByTodo: new Map(),
    expandedTodoId: null,
    completingTodoId: null,
    editingTodoId: null,
    openTodoId: null,
    calYear: todayInit.getFullYear(),
    calMonth: todayInit.getMonth(),
    todoView: "calendar",
    filters: { query: "", status: "all", tag: "all" },
    sortBy: "due_date",
    retroCache: { todos: [], logsByTodo: new Map() },
  };

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) node.setAttribute(k, v);
    }
    for (const child of [].concat(children)) {
      if (child === null || child === undefined) continue;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  function priorityLabel(p) {
    return { high: "높음", medium: "보통", low: "낮음" }[p] || p;
  }

  function setPlanFormDefaultDates() {
    const form = document.getElementById("plan-form");
    const today = todayInSeoul();
    form.period_start.value = today;
    form.period_end.value = today;
  }

  function setTodoFormDefaultDate() {
    document.getElementById("todo-form").due_date.value = todayInSeoul();
  }

  function planNameOf(planId) {
    const plan = state.plans.find((p) => p.id === planId);
    return plan ? plan.title : "삭제된 계획";
  }

  function showFieldError(errorEl, msg) {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }
  function hideFieldError(errorEl) {
    if (!errorEl) return;
    errorEl.hidden = true;
  }
  function reportError(err) {
    console.error(err);
    alert(err.message || String(err));
  }

  function labeledInput(labelText, name, type, value, required) {
    const input = el("input", { type, name, value: value ?? "", required: required ? "" : undefined });
    return el("label", {}, [labelText + " ", required ? el("span", { class: "req", text: "*" }) : null, input]);
  }

  function labeledSelect(labelText, name, options, selectedValue, required = true) {
    const select = el("select", { name, required: required ? "" : undefined });
    for (const [val, text] of options) {
      const opt = el("option", { value: val, text });
      if (val === selectedValue) opt.selected = true;
      select.appendChild(opt);
    }
    return el("label", {}, [labelText + " ", required ? el("span", { class: "req", text: "*" }) : null, select]);
  }

  function validatePlanInput(input, errorEl) {
    if (
      !input.title || !input.period_start || !input.period_end ||
      !input.priority || !input.success_criteria || Number.isNaN(input.estimated_minutes)
    ) {
      showFieldError(errorEl, "제목·기간·우선순위·성공 기준·예상 시간은 비워둘 수 없습니다.");
      return false;
    }
    if (input.period_start > input.period_end) {
      showFieldError(errorEl, "기간 시작이 종료보다 늦을 수 없습니다.");
      return false;
    }
    hideFieldError(errorEl);
    return true;
  }

  // ---------------------------------------------------------------------
  // 탭
  // ---------------------------------------------------------------------
  function initTabs() {
    document.querySelectorAll("#pds-app .tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
  }

  function switchTab(tab) {
    document.querySelectorAll("#pds-app .tab-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === tab));
    document.querySelectorAll("#pds-app .tab-panel").forEach((p) => p.classList.toggle("is-active", p.id === `tab-${tab}`));
    if (tab === "todo") renderTodoPlanContext();
    if (tab === "retro") {
      renderRetroTable().catch(reportError);
      renderRetroNoteContext();
    }
  }

  // ---------------------------------------------------------------------
  // 계획(Plan)
  // ---------------------------------------------------------------------
  async function refreshPlans() {
    state.plans = await Plans.list();
    renderPlanList();
    await renderCarriedNoteOptions();
    // 계획 기간 막대는 state.plans를 그려서 만들어지므로, 계획이 새로 생기거나
    // 기간이 바뀔 때마다 (다른 동작을 기다리지 않고) 캘린더도 바로 다시 그린다.
    renderTodoCalendar();
  }

  function renderPlanList() {
    const ul = document.getElementById("plan-list");
    ul.innerHTML = "";
    if (state.plans.length === 0) {
      ul.appendChild(el("li", { class: "muted", text: "아직 계획이 없습니다." }));
      return;
    }
    for (const p of state.plans) {
      const li = el("li", { class: "list-item" + (p.id === state.currentPlanId ? " is-selected" : "") });
      li.appendChild(
        el(
          "button",
          { class: "list-item-btn", type: "button", onclick: () => selectPlan(p.id) },
          [
            el("strong", { text: p.title }),
            el("span", {
              class: "meta",
              text: ` ${p.period_start} ~ ${p.period_end} · 우선순위 ${priorityLabel(p.priority)}`,
            }),
          ]
        )
      );
      ul.appendChild(li);
    }
  }

  async function selectPlan(id) {
    state.currentPlanId = id;
    state.editingTodoId = null;
    state.completingTodoId = null;
    state.expandedTodoId = null;
    renderPlanList();
    await renderPlanDetail(id);
    await renderPlanRevisions(id);
    renderTodoPlanContext();
    renderRetroNoteContext();
  }

  async function renderPlanDetail(id) {
    const container = document.getElementById("plan-detail");
    container.innerHTML = "";
    const plan = state.plans.find((p) => p.id === id);
    if (!plan) {
      container.appendChild(el("p", { class: "muted", text: "왼쪽에서 계획을 선택하세요." }));
      return;
    }
    const form = el("form", { class: "form-grid", onsubmit: (e) => onPlanEditSubmit(e, id) });
    form.appendChild(labeledInput("제목", "title", "text", plan.title, true));
    form.appendChild(labeledInput("기간 시작", "period_start", "date", plan.period_start, true));
    form.appendChild(labeledInput("기간 종료", "period_end", "date", plan.period_end, true));
    form.appendChild(
      labeledSelect("우선순위", "priority", [["high", "높음"], ["medium", "보통"], ["low", "낮음"]], plan.priority)
    );
    form.appendChild(labeledInput("성공 기준", "success_criteria", "text", plan.success_criteria, true));
    form.appendChild(labeledInput("예상 시간(분)", "estimated_minutes", "number", plan.estimated_minutes, true));
    const colorRow = el("div", { class: "color-picker-row" }, [
      labeledInput("캘린더 막대 테두리 색", "color_border", "color", plan.color_border || "#8a8a8f", false),
      labeledInput("캘린더 막대 글자 색", "color_text", "color", plan.color_text || "#f2f2f2", false),
    ]);
    form.appendChild(colorRow);
    form.appendChild(
      el("div", { class: "actions" }, [
        el("button", { type: "submit", text: "수정 저장" }),
        el("button", {
          type: "button",
          text: "계획 삭제",
          class: "danger-btn",
          onclick: () => onDeletePlan(id),
        }),
      ])
    );
    container.appendChild(form);
    container.appendChild(el("p", { class: "form-error", id: "plan-edit-error", hidden: "" }));
  }

  async function onDeletePlan(id) {
    const plan = state.plans.find((p) => p.id === id);
    const name = plan ? plan.title : "이 계획";
    if (!confirm(`"${name}"을(를) 지우면 딸린 할 일·실행 기록·수정 이력·돌아보기 메모도 함께 지워집니다. 되돌릴 수 없습니다. 계속할까요?`)) {
      return;
    }
    try {
      await Plans.remove(id);
      state.currentPlanId = null;
      state.expandedTodoId = null;
      state.completingTodoId = null;
      state.editingTodoId = null;
      await refreshPlans();
      await refreshCalendarTodos();
      renderPlanDetail(null);
      document.getElementById("plan-revision-list").innerHTML = "";
      renderTodoPlanContext();
      renderRetroNoteContext();
    } catch (err) {
      reportError(err);
    }
  }

  async function onPlanEditSubmit(e, id) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const input = {
      title: (fd.get("title") || "").trim(),
      period_start: fd.get("period_start"),
      period_end: fd.get("period_end"),
      priority: fd.get("priority"),
      success_criteria: (fd.get("success_criteria") || "").trim(),
      estimated_minutes: Number(fd.get("estimated_minutes")),
      color_border: fd.get("color_border") || "#8a8a8f",
      color_text: fd.get("color_text") || "#f2f2f2",
    };
    const errEl = document.getElementById("plan-edit-error");
    if (!validatePlanInput(input, errEl)) return;
    try {
      await Plans.update(id, input);
      await refreshPlans();
      await renderPlanDetail(id);
      await renderPlanRevisions(id);
      renderTodoPlanContext();
    } catch (err) {
      showFieldError(document.getElementById("plan-edit-error"), err.message);
    }
  }

  async function renderPlanRevisions(planId) {
    const ul = document.getElementById("plan-revision-list");
    ul.innerHTML = "";
    const revisions = await Plans.revisions(planId);
    if (revisions.length === 0) {
      ul.appendChild(el("li", { class: "muted", text: "아직 수정 이력이 없습니다." }));
      return;
    }
    for (const r of revisions) {
      ul.appendChild(
        el("li", { class: "list-item" }, [
          el("div", {}, [
            el("strong", { text: r.prev_title }),
            el("span", {
              class: "meta",
              text: ` ${r.prev_period_start} ~ ${r.prev_period_end} · ${priorityLabel(r.prev_priority)} · 예상 ${r.prev_estimated_minutes}분`,
            }),
          ]),
          el("div", { class: "meta", text: `성공 기준(수정 전): ${r.prev_success_criteria}` }),
          el("div", { class: "meta", text: `수정 시각: ${formatSeoulDateTime(r.replaced_at)}` }),
        ])
      );
    }
  }

  async function renderCarriedNoteOptions() {
    const select = document.getElementById("plan-carried-note-select");
    const carriedIds = new Set(state.plans.filter((p) => p.carried_note_id).map((p) => p.carried_note_id));
    const notes = await RetroNotes.listUncarried(carriedIds);
    select.innerHTML = "";
    select.appendChild(el("option", { value: "", text: "없음" }));
    for (const n of notes) {
      select.appendChild(el("option", { value: n.id, text: n.note.slice(0, 40) }));
    }
  }

  document.getElementById("plan-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const input = {
      title: (fd.get("title") || "").trim(),
      period_start: fd.get("period_start"),
      period_end: fd.get("period_end"),
      priority: fd.get("priority"),
      success_criteria: (fd.get("success_criteria") || "").trim(),
      estimated_minutes: Number(fd.get("estimated_minutes")),
      carried_note_id: fd.get("carried_note_id") || null,
      color_border: fd.get("color_border") || "#8a8a8f",
      color_text: fd.get("color_text") || "#f2f2f2",
    };
    const errEl = document.getElementById("plan-form-error");
    if (!validatePlanInput(input, errEl)) return;
    try {
      const plan = await Plans.create(input);
      e.target.reset();
      setPlanFormDefaultDates();
      await refreshPlans();
      await selectPlan(plan.id);
    } catch (err) {
      showFieldError(errEl, err.message);
    }
  });

  // ---------------------------------------------------------------------
  // 할 일(Todo)
  // ---------------------------------------------------------------------
  function renderTodoPlanContext() {
    const container = document.getElementById("todo-plan-context");
    const area = document.getElementById("todo-area");
    container.innerHTML = "";
    const plan = state.plans.find((p) => p.id === state.currentPlanId);
    if (!plan) {
      container.appendChild(el("p", { class: "muted", text: '먼저 "계획" 탭에서 계획을 선택하세요.' }));
      area.hidden = true;
      return;
    }
    container.appendChild(
      el("p", {}, ["현재 계획: ", el("strong", { text: plan.title }), ` (${plan.period_start} ~ ${plan.period_end})`])
    );
    area.hidden = false;
  }

  // 캘린더는 계획 선택과 무관하게 항상 모든 계획의 할 일을 보여준다(화면 상단, 탭 밖).
  async function refreshCalendarTodos() {
    const planIds = state.plans.map((p) => p.id);
    state.calendarTodos = await Todos.listAllOpenForPlans(planIds);
    renderTagFilterOptions();
    renderTodoCalendar();
    if (state.openTodoId) renderTodoDetailModal(state.openTodoId);
  }

  function renderTagFilterOptions() {
    const select = document.getElementById("todo-filter-tag");
    const current = select.value;
    const tagSet = new Set();
    state.calendarTodos.forEach((t) => (t.tags || []).forEach((tag) => tagSet.add(tag)));
    select.innerHTML = "";
    select.appendChild(el("option", { value: "all", text: "전체 태그" }));
    for (const tag of [...tagSet].sort()) {
      select.appendChild(el("option", { value: tag, text: tag }));
    }
    if ([...tagSet].includes(current)) select.value = current;
  }

  // ---------------------------------------------------------------------
  // 할 일 캘린더 (옛 습관 기록기의 월간 캘린더 그리드·클래스를 그대로 재사용)
  // ---------------------------------------------------------------------
  const TODO_WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

  function buildTodoMonthGrid(year, month) {
    const startDow = 1; // 월요일 시작 고정
    const firstOfMonth = new Date(Date.UTC(year, month, 1));
    const daysFromStart = (firstOfMonth.getUTCDay() - startDow + 7) % 7;
    const gridStart = new Date(firstOfMonth);
    gridStart.setUTCDate(firstOfMonth.getUTCDate() - daysFromStart);

    const lastOfMonth = new Date(Date.UTC(year, month + 1, 0));
    const daysUntilEnd = (startDow + 6 - lastOfMonth.getUTCDay() + 7) % 7;
    const gridEnd = new Date(lastOfMonth);
    gridEnd.setUTCDate(lastOfMonth.getUTCDate() + daysUntilEnd);

    const days = [];
    const cur = new Date(gridStart);
    while (cur <= gridEnd) {
      days.push({
        dateStr: cur.toISOString().slice(0, 10),
        inMonth: cur.getUTCMonth() === month,
      });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return days;
  }

  // 같은 주(week) 안에서 기간이 겹치는 계획들을 서로 다른 "레인"에 배정한다(겹치지 않는
  // 계획은 같은 레인을 나눠 써도 된다). 기간이 이른 계획부터 채워 넣는 표준 구간 스케줄링.
  function assignPlanLanes(plans, weekStart, weekEnd) {
    const relevant = plans
      .filter((p) => p.period_end >= weekStart && p.period_start <= weekEnd)
      .sort((a, b) => (a.period_start < b.period_start ? -1 : a.period_start > b.period_start ? 1 : (a.id < b.id ? -1 : 1)));
    const laneEnds = [];
    const laneOf = new Map();
    for (const p of relevant) {
      let placed = false;
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] < p.period_start) {
          laneEnds[i] = p.period_end;
          laneOf.set(p.id, i);
          placed = true;
          break;
        }
      }
      if (!placed) {
        laneEnds.push(p.period_end);
        laneOf.set(p.id, laneEnds.length - 1);
      }
    }
    return { laneOf, laneCount: laneEnds.length };
  }

  function renderTodoCalendarWeekdayHeader() {
    const header = document.getElementById("todo-calendar-weekdays");
    header.innerHTML = "";
    for (const label of TODO_WEEKDAY_LABELS) {
      header.appendChild(el("span", { text: label }));
    }
  }

  function renderTodoCalendar() {
    document.getElementById("todo-cal-month-label").textContent = `${state.calYear}년 ${state.calMonth + 1}월`;
    renderTodoCalendarWeekdayHeader();

    const grid = document.getElementById("todo-calendar-grid");
    grid.innerHTML = "";

    const filtered = filterTodos(state.calendarTodos, state.filters);
    const sorted = sortTodos(filtered, state.sortBy);
    const todosByDate = new Map();
    for (const t of sorted) {
      if (!todosByDate.has(t.due_date)) todosByDate.set(t.due_date, []);
      todosByDate.get(t.due_date).push(t);
    }

    const today = todayInSeoul();
    const days = buildTodoMonthGrid(state.calYear, state.calMonth);
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

    // 계획 막대가 들어갈 자리(레인)를 주 단위로 배정하되, 달 전체에서 가장 많이 겹친
    // 주의 레인 수만큼 모든 칸에 똑같이 자리를 비워 둔다 — 그래야 겹친 계획이 적은 날짜도
    // 다른 날짜와 세로 높이가 어긋나지 않고, 그 아래 할 일 목록이 항상 같은 위치에서 시작한다.
    const weekLanes = weeks.map((week) => assignPlanLanes(state.plans, week[0].dateStr, week[6].dateStr));
    const maxLanes = Math.max(0, ...weekLanes.map((w) => w.laneCount));

    weeks.forEach((week, weekIdx) => {
      const { laneOf } = weekLanes[weekIdx];
      const plansThisWeek = state.plans.filter((p) => laneOf.has(p.id));

      for (const day of week) {
        const cell = el("div", {
          class: "calendar-day" + (!day.inMonth ? " out-month" : "") + (day.dateStr === today ? " today" : ""),
        });
        cell.appendChild(el("span", { class: "day-number", text: String(Number(day.dateStr.slice(8, 10))) }));

        // 그 날짜가 계획 기간(period_start~period_end) 안이면, 날짜 숫자 바로 아래 칸 안에
        // 그 계획의 막대 조각을 넣는다. 시작일·종료일이 아닌 칸에서는 좌우 모서리를 각지게
        // 두어(둥근 모서리 없음) 옆 칸과 이어진 것처럼 보이게 한다. 이 날짜에 없는 레인은
        // 빈 자리(placeholder)로 채워 높이를 맞춘다.
        for (let lane = 0; lane < maxLanes; lane++) {
          const p = plansThisWeek.find(
            (pp) => laneOf.get(pp.id) === lane && day.dateStr >= pp.period_start && day.dateStr <= pp.period_end
          );
          if (!p) {
            cell.appendChild(el("div", { class: "plan-strip-placeholder" }));
            continue;
          }
          const isStart = day.dateStr === p.period_start;
          const isEnd = day.dateStr === p.period_end;
          cell.appendChild(
            el("div", {
              class: "plan-strip" + (isStart ? " is-start" : "") + (isEnd ? " is-end" : ""),
              text: p.title,
              title: `계획: ${p.title} (${p.period_start} ~ ${p.period_end})`,
              style: `--plan-border: ${p.color_border || "#8a8a8f"}; --plan-text: ${p.color_text || "#f2f2f2"};`,
              onclick: () => {
                document.querySelector('#pds-app [data-tab="plan"]').click();
                selectPlan(p.id);
              },
            })
          );
        }

        const dayItems = el("div", { class: "day-records" });
        for (const t of todosByDate.get(day.dateStr) || []) {
          const overdue = t.status !== "done" && t.due_date < today;
          dayItems.appendChild(
            el("div", {
              class:
                "day-record-item todo-cal-item priority-" + t.priority +
                (t.status === "done" ? " status-done" : "") +
                (overdue ? " status-overdue" : ""),
              text: (t.status === "done" ? "✓ " : "") + t.title,
              title: `${t.title} (${planNameOf(t.plan_id)})`,
              onclick: () => openTodoDetail(t.id),
            })
          );
        }
        cell.appendChild(dayItems);
        grid.appendChild(cell);
      }
    });

    renderTodoTable(sorted);
  }

  function renderTodoTable(sorted) {
    const tbody = document.getElementById("todo-record-tbody");
    tbody.innerHTML = "";
    const today = todayInSeoul();

    for (const t of sorted) {
      const overdue = t.status !== "done" && t.due_date < today;
      const tr = el("tr");

      tr.appendChild(el("td", { text: t.due_date }));
      tr.appendChild(el("td", { text: (t.status === "done" ? "✓ " : "") + t.title, class: t.status === "done" ? "done-text" : "" }));
      tr.appendChild(el("td", { text: planNameOf(t.plan_id) }));
      tr.appendChild(el("td", { text: priorityLabel(t.priority), class: "priority-" + t.priority }));
      tr.appendChild(el("td", { text: (t.tags || []).join(", ") }));
      tr.appendChild(el("td", { text: String(t.estimated_minutes) }));
      tr.appendChild(
        el("td", {}, [
          el("span", {
            class: "badge" + (t.status === "done" ? " badge-done" : overdue ? " badge-overdue" : ""),
            text: t.status === "done" ? "완료" : overdue ? "지연" : "진행 중",
          }),
        ])
      );

      const actionTd = el("td");
      actionTd.appendChild(el("button", { type: "button", text: "상세", onclick: () => openTodoDetail(t.id) }));
      tr.appendChild(actionTd);

      tbody.appendChild(tr);
    }

    document.getElementById("todo-table-empty").hidden = !(state.todoView === "table" && sorted.length === 0);
  }

  function setTodoView(view) {
    state.todoView = view;
    document.getElementById("todo-calendar-view").hidden = view !== "calendar";
    document.getElementById("todo-record-table").hidden = view !== "table";
    document.getElementById("todo-view-toggle-btn").textContent = view === "calendar" ? "📋 테이블로 보기" : "🗓 캘린더로 보기";
  }

  document.getElementById("todo-view-toggle-btn").addEventListener("click", () => {
    setTodoView(state.todoView === "calendar" ? "table" : "calendar");
    renderTodoTable(sortTodos(filterTodos(state.calendarTodos, state.filters), state.sortBy));
  });

  document.getElementById("todo-cal-prev-btn").addEventListener("click", () => {
    state.calMonth -= 1;
    if (state.calMonth < 0) { state.calMonth = 11; state.calYear -= 1; }
    renderTodoCalendar();
  });
  document.getElementById("todo-cal-next-btn").addEventListener("click", () => {
    state.calMonth += 1;
    if (state.calMonth > 11) { state.calMonth = 0; state.calYear += 1; }
    renderTodoCalendar();
  });
  document.getElementById("todo-cal-today-btn").addEventListener("click", () => {
    const d = new Date();
    state.calYear = d.getFullYear();
    state.calMonth = d.getMonth();
    renderTodoCalendar();
  });

  // ---------------------------------------------------------------------
  // 할 일 상세 모달 (캘린더 칩을 클릭하면 열림)
  // ---------------------------------------------------------------------
  const todoDetailOverlay = document.getElementById("todo-detail-overlay");
  const todoDetailBody = document.getElementById("todo-detail-body");

  document.getElementById("todo-detail-close-btn").addEventListener("click", closeTodoDetail);
  todoDetailOverlay.addEventListener("click", (e) => {
    if (e.target === todoDetailOverlay) closeTodoDetail();
  });

  function openTodoDetail(id) {
    state.openTodoId = id;
    state.editingTodoId = null;
    state.completingTodoId = null;
    renderTodoDetailModal(id);
    todoDetailOverlay.hidden = false;
  }

  function closeTodoDetail() {
    state.openTodoId = null;
    state.editingTodoId = null;
    state.completingTodoId = null;
    todoDetailOverlay.hidden = true;
  }

  function renderTodoDetailModal(id) {
    const t = state.calendarTodos.find((x) => x.id === id);
    todoDetailBody.innerHTML = "";
    if (!t) {
      closeTodoDetail();
      return;
    }

    if (state.editingTodoId === t.id) {
      todoDetailBody.appendChild(renderTodoEditForm(t));
      return;
    }

    const overdue = t.status !== "done" && t.due_date < todayInSeoul();
    const header = el("div", { class: "todo-header" }, [
      el("strong", { text: t.title, class: t.status === "done" ? "done-text" : "" }),
      el("span", {
        class: "badge" + (t.status === "done" ? " badge-done" : overdue ? " badge-overdue" : ""),
        text: t.status === "done" ? "완료" : overdue ? "지연" : "진행 중",
      }),
    ]);
    const meta = el("div", {
      class: "meta",
      text:
        `계획: ${planNameOf(t.plan_id)} · 마감 ${t.due_date} · 우선순위 ${priorityLabel(t.priority)} · 예상 ${t.estimated_minutes}분` +
        (t.tags && t.tags.length ? ` · 태그 ${t.tags.join(", ")}` : ""),
    });

    const actions = el("div", { class: "actions" });
    if (t.status !== "done") {
      actions.appendChild(el("button", { type: "button", text: "완료 처리", onclick: () => toggleCompleteForm(t.id) }));
    } else {
      actions.appendChild(el("button", { type: "button", text: "되돌리기", onclick: () => onReopenTodo(t.id) }));
    }
    actions.appendChild(
      el("button", { type: "button", text: "수정", onclick: () => { state.editingTodoId = t.id; renderTodoDetailModal(t.id); } })
    );
    actions.appendChild(el("button", { type: "button", text: "삭제", onclick: () => onDeleteTodo(t.id) }));
    actions.appendChild(
      el("button", {
        type: "button",
        text: state.expandedTodoId === t.id ? "실행기록 접기" : "실행기록 보기",
        onclick: () => toggleExpandTodo(t.id),
      })
    );

    todoDetailBody.appendChild(header);
    todoDetailBody.appendChild(meta);
    todoDetailBody.appendChild(actions);
    if (state.completingTodoId === t.id) todoDetailBody.appendChild(renderCompleteForm(t));
    if (state.expandedTodoId === t.id) todoDetailBody.appendChild(renderExecutionLogList(t.id));
  }

  function renderTodoEditForm(t) {
    const form = el("form", { class: "form-grid inline-form", onsubmit: (e) => onTodoEditSubmit(e, t.id) });
    form.appendChild(labeledInput("제목", "title", "text", t.title, true));
    form.appendChild(labeledInput("마감일", "due_date", "date", t.due_date, true));
    form.appendChild(labeledSelect("우선순위", "priority", [["high", "높음"], ["medium", "보통"], ["low", "낮음"]], t.priority));
    form.appendChild(labeledInput("태그(쉼표)", "tags", "text", (t.tags || []).join(", "), false));
    form.appendChild(labeledInput("예상 시간(분)", "estimated_minutes", "number", t.estimated_minutes, true));
    form.appendChild(
      el("div", { class: "actions" }, [
        el("button", { type: "submit", text: "저장" }),
        el("button", { type: "button", text: "취소", onclick: () => { state.editingTodoId = null; renderTodoDetailModal(t.id); } }),
      ])
    );
    return form;
  }

  async function onTodoEditSubmit(e, id) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const input = {
      title: (fd.get("title") || "").trim(),
      due_date: fd.get("due_date"),
      priority: fd.get("priority"),
      tags: parseTags(fd.get("tags") || ""),
      estimated_minutes: Number(fd.get("estimated_minutes")),
    };
    if (!input.title || !input.due_date || Number.isNaN(input.estimated_minutes)) {
      alert("제목·마감일·예상 시간은 비워둘 수 없습니다.");
      return;
    }
    try {
      await Todos.update(id, input);
      state.editingTodoId = null;
      await refreshCalendarTodos();
    } catch (err) {
      reportError(err);
    }
  }

  function toggleCompleteForm(id) {
    state.completingTodoId = state.completingTodoId === id ? null : id;
    renderTodoDetailModal(id);
  }

  function renderCompleteForm(t) {
    const form = el("form", { class: "form-grid inline-form", onsubmit: (e) => onCompleteSubmit(e, t.id) });
    const now = nowIsoInSeoulInput();
    form.appendChild(labeledInput("시작 시각", "started_at", "datetime-local", now, true));
    form.appendChild(labeledInput("끝난 시각", "ended_at", "datetime-local", now, true));
    form.appendChild(labeledInput("실제 걸린 시간(분)", "actual_minutes", "number", t.estimated_minutes, true));
    form.appendChild(labeledInput("막혔던 이유(선택)", "blocked_reason", "text", "", false));
    form.appendChild(
      el("div", { class: "actions" }, [
        el("button", { type: "submit", text: "완료 저장" }),
        el("button", { type: "button", text: "취소", onclick: () => toggleCompleteForm(t.id) }),
      ])
    );
    return form;
  }

  async function onCompleteSubmit(e, id) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const fd = new FormData(e.target);
      const started_at = seoulWallClockToUtcIso(fd.get("started_at"));
      const ended_at = seoulWallClockToUtcIso(fd.get("ended_at"));
      const actual_minutes = Number(fd.get("actual_minutes"));
      const blocked_reason = (fd.get("blocked_reason") || "").trim();
      await Todos.complete(id, { started_at, ended_at, actual_minutes, blocked_reason });
      state.completingTodoId = null;
      state.executionLogsByTodo.delete(id);
      await refreshCalendarTodos();
    } catch (err) {
      reportError(err);
      submitBtn.disabled = false;
    }
  }

  async function onReopenTodo(id) {
    try {
      await Todos.reopen(id);
      await refreshCalendarTodos();
    } catch (err) {
      reportError(err);
    }
  }

  async function onDeleteTodo(id) {
    if (!confirm("이 할 일을 지울까요?")) return;
    try {
      await Todos.remove(id);
      if (state.openTodoId === id) closeTodoDetail();
      await refreshCalendarTodos();
    } catch (err) {
      reportError(err);
    }
  }

  async function toggleExpandTodo(id) {
    if (state.expandedTodoId === id) {
      state.expandedTodoId = null;
      renderTodoDetailModal(id);
      return;
    }
    if (!state.executionLogsByTodo.has(id)) {
      const logs = await ExecutionLogs.listByTodo(id);
      state.executionLogsByTodo.set(id, logs);
    }
    state.expandedTodoId = id;
    renderTodoDetailModal(id);
  }

  function renderExecutionLogList(todoId) {
    const box = el("div", { class: "execution-log-box" });
    const logs = state.executionLogsByTodo.get(todoId) || [];
    if (logs.length === 0) {
      box.appendChild(el("p", { class: "muted", text: "실행 기록이 없습니다." }));
      return box;
    }
    const ul = el("ul", { class: "item-list" });
    for (const log of logs) {
      ul.appendChild(
        el("li", {
          class: "meta",
          text:
            `${formatSeoulDateTime(log.started_at)} ~ ${formatSeoulDateTime(log.ended_at)} · 실제 ${log.actual_minutes}분` +
            (log.blocked_reason ? ` · 막힘: ${log.blocked_reason}` : ""),
        })
      );
    }
    box.appendChild(ul);
    return box;
  }

  document.getElementById("todo-search").addEventListener("input", (e) => {
    state.filters.query = e.target.value;
    renderTodoCalendar();
  });
  document.getElementById("todo-filter-status").addEventListener("change", (e) => {
    state.filters.status = e.target.value;
    renderTodoCalendar();
  });
  document.getElementById("todo-filter-tag").addEventListener("change", (e) => {
    state.filters.tag = e.target.value;
    renderTodoCalendar();
  });
  document.getElementById("todo-sort").addEventListener("change", (e) => {
    state.sortBy = e.target.value;
    renderTodoCalendar();
  });

  document.getElementById("todo-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.currentPlanId) return;
    const fd = new FormData(e.target);
    const input = {
      plan_id: state.currentPlanId,
      title: (fd.get("title") || "").trim(),
      due_date: fd.get("due_date"),
      priority: fd.get("priority"),
      tags: parseTags(fd.get("tags") || ""),
      estimated_minutes: Number(fd.get("estimated_minutes")),
    };
    const errEl = document.getElementById("todo-form-error");
    if (!input.title || !input.due_date || !input.priority || Number.isNaN(input.estimated_minutes)) {
      showFieldError(errEl, "제목·마감일·우선순위·예상 시간은 비워둘 수 없습니다.");
      return;
    }
    hideFieldError(errEl);
    try {
      await Todos.create(input);
      e.target.reset();
      setTodoFormDefaultDate();
      await refreshCalendarTodos();
    } catch (err) {
      showFieldError(errEl, err.message);
    }
  });

  // ---------------------------------------------------------------------
  // 돌아보기(See)
  // ---------------------------------------------------------------------
  async function renderRetroTable() {
    const tbody = document.getElementById("retro-table-body");
    tbody.innerHTML = "";
    document.getElementById("retro-drilldown").hidden = true;
    if (state.plans.length === 0) {
      tbody.appendChild(el("tr", {}, [el("td", { colspan: "8", class: "muted", text: "계획이 없습니다." })]));
      return;
    }
    const planIds = state.plans.map((p) => p.id);
    const todos = await Todos.listAllOpenForPlans(planIds);
    const todoIds = todos.map((t) => t.id);
    const logs = await ExecutionLogs.listByTodos(todoIds);
    const logsByTodo = new Map();
    for (const log of logs) {
      if (!logsByTodo.has(log.todo_id)) logsByTodo.set(log.todo_id, []);
      logsByTodo.get(log.todo_id).push(log);
    }
    state.retroCache = { todos, logsByTodo };

    for (const plan of state.plans) {
      const planTodos = todos.filter((t) => t.plan_id === plan.id);
      const agg = Aggregation.computeForPlan(planTodos, logsByTodo);
      const tr = el("tr", {});
      tr.appendChild(el("td", { text: plan.title }));
      tr.appendChild(numberCell(agg.total, () => showDrilldown(plan.id, "total")));
      tr.appendChild(numberCell(agg.done, () => showDrilldown(plan.id, "done")));
      tr.appendChild(numberCell(agg.overdue, () => showDrilldown(plan.id, "overdue")));
      tr.appendChild(numberCell(agg.blocked, () => showDrilldown(plan.id, "blocked")));
      tr.appendChild(el("td", { text: String(agg.estimatedMinutes) }));
      tr.appendChild(el("td", { text: String(agg.actualMinutes) }));
      tr.appendChild(el("td", { text: (agg.diffMinutes >= 0 ? "+" : "") + agg.diffMinutes }));
      tbody.appendChild(tr);
    }
  }

  function numberCell(value, onClick) {
    const td = el("td", {});
    td.appendChild(el("button", { class: "num-btn", type: "button", text: String(value), onclick: onClick }));
    return td;
  }

  function showDrilldown(planId, kind) {
    const { todos, logsByTodo } = state.retroCache;
    const planTodos = todos.filter((t) => t.plan_id === planId);
    const today = todayInSeoul();
    let list = [];
    let title = "";
    if (kind === "total") {
      list = planTodos;
      title = "전체 할 일";
    } else if (kind === "done") {
      list = planTodos.filter((t) => t.status === "done");
      title = "완료한 할 일";
    } else if (kind === "overdue") {
      list = planTodos.filter((t) => t.status !== "done" && t.due_date < today);
      title = "지연된 할 일";
    } else if (kind === "blocked") {
      list = planTodos.filter((t) => (logsByTodo.get(t.id) || []).some((l) => l.blocked_reason));
      title = "막힌 할 일";
    }
    const plan = state.plans.find((p) => p.id === planId);
    document.getElementById("drilldown-title").textContent = `${plan.title} — ${title} (${list.length}건)`;
    const ul = document.getElementById("drilldown-list");
    ul.innerHTML = "";
    if (list.length === 0) {
      ul.appendChild(el("li", { class: "muted", text: "해당하는 할 일이 없습니다." }));
    }
    for (const t of list) {
      ul.appendChild(
        el("li", { class: "list-item" }, [
          el("strong", { text: t.title }),
          el("span", {
            class: "meta",
            text: ` 마감 ${t.due_date} · 우선순위 ${priorityLabel(t.priority)} · 상태 ${t.status === "done" ? "완료" : "진행 중"}`,
          }),
        ])
      );
    }
    document.getElementById("retro-drilldown").hidden = false;
  }

  function renderRetroNoteContext() {
    const container = document.getElementById("retro-note-context");
    const form = document.getElementById("retro-note-form");
    container.innerHTML = "";
    const plan = state.plans.find((p) => p.id === state.currentPlanId);
    if (!plan) {
      container.appendChild(el("p", { class: "muted", text: '먼저 "계획" 탭에서 계획을 선택하세요.' }));
      form.hidden = true;
      document.getElementById("retro-note-list").innerHTML = "";
      return;
    }
    container.appendChild(el("p", {}, ["현재 계획: ", el("strong", { text: plan.title })]));
    form.hidden = false;
    renderRetroNotes(plan.id).catch(reportError);
  }

  async function renderRetroNotes(planId) {
    const ul = document.getElementById("retro-note-list");
    ul.innerHTML = "";
    const notes = await RetroNotes.listByPlan(planId);
    for (const n of notes) {
      ul.appendChild(el("li", { class: "meta", text: `${formatSeoulDateTime(n.created_at)} — ${n.note}` }));
    }
  }

  document.getElementById("retro-note-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.currentPlanId) return;
    const fd = new FormData(e.target);
    const note = (fd.get("note") || "").trim();
    if (!note) return;
    try {
      await RetroNotes.create(state.currentPlanId, note);
      e.target.reset();
      await renderRetroNotes(state.currentPlanId);
      await renderCarriedNoteOptions();
    } catch (err) {
      reportError(err);
    }
  });

  // ---------------------------------------------------------------------
  // 내보내기
  // ---------------------------------------------------------------------
  document.getElementById("pds-export-btn").addEventListener("click", async () => {
    const status = document.getElementById("pds-export-status");
    status.textContent = "내보내는 중...";
    try {
      await ExportAll.run();
      status.textContent = "내보내기 완료.";
    } catch (err) {
      status.textContent = "내보내기 실패: " + err.message;
    }
  });

  // ---------------------------------------------------------------------
  // 모드 전환(습관 기록 ↔ 계획 다이어리) + 시작
  // ---------------------------------------------------------------------
  const habitApp = document.getElementById("habit-app");
  const pdsApp = document.getElementById("pds-app");
  const modeHabitBtn = document.getElementById("mode-habit-btn");
  const modePdsBtn = document.getElementById("mode-pds-btn");

  function setMode(mode) {
    habitApp.hidden = mode !== "habit";
    pdsApp.hidden = mode !== "pds";
    modeHabitBtn.classList.toggle("is-active", mode === "habit");
    modePdsBtn.classList.toggle("is-active", mode === "pds");
  }
  modeHabitBtn.addEventListener("click", () => setMode("habit"));
  modePdsBtn.addEventListener("click", () => setMode("pds"));

  let started = false;
  async function init() {
    // pds-auth.js가 로그인 확인 후 호출한다(T07) — 로그인 전에는 서버에 아무 권한도
    // 없으므로(RLS), 여기서 미리 호출하지 않는다. 다시 호출돼도 tab/폼 초기화만
    // 반복되고 목록은 새로 받아오므로 안전하다.
    started = true;
    initTabs();
    setPlanFormDefaultDates();
    setTodoFormDefaultDate();
    setTodoView(state.todoView);
    try {
      await refreshPlans();
      await refreshCalendarTodos();
    } catch (err) {
      reportError(err);
    }
  }

  window.PDS_UI = { start: init, isStarted: () => started };
})();

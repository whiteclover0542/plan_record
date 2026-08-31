// 계획(Plan)-할일(Todo)-실행기록(Do)-돌아보기(See) 데이터 계층.
// 옛 습관 기록기(app.js/checklist.js/ui.js)와 한 페이지에 공존하므로 전역 이름이
// 겹치지 않도록 전부 IIFE 안에 두고 window.PDS에만 필요한 것을 내보낸다.
(function () {
  const sb = window.supabase.createClient(
    window.PDS_CONFIG.SUPABASE_URL,
    window.PDS_CONFIG.SUPABASE_ANON_KEY
  );

  function todayInSeoul() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  }

  function nowIsoInSeoulInput() {
    // <input type="datetime-local">에 넣기 좋은 "YYYY-MM-DDTHH:mm" (Asia/Seoul 벽시계 기준)
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t).value;
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
  }

  function seoulWallClockToUtcIso(localDatetimeValue) {
    // <input type="datetime-local"> 값("YYYY-MM-DDTHH:mm")을 Asia/Seoul 벽시계 시각으로 간주해
    // UTC ISO 문자열로 바꾼다. 한국은 DST가 없어 UTC+9 고정으로 계산한다.
    const [datePart, timePart] = localDatetimeValue.split("T");
    const [y, m, d] = datePart.split("-").map(Number);
    const [hh, mm] = timePart.split(":").map(Number);
    return new Date(Date.UTC(y, m - 1, d, hh - 9, mm)).toISOString();
  }

  function formatSeoulDateTime(isoString) {
    if (!isoString) return "-";
    const parts = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(isoString));
    const get = (t) => parts.find((p) => p.type === t).value;
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
  }

  function parseTags(rawText) {
    return rawText
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }

  function throwIfError({ data, error }) {
    if (error) throw new Error(error.message);
    return data;
  }

  // ---------------------------------------------------------------------
  // Plans
  // ---------------------------------------------------------------------
  const Plans = {
    async list() {
      return throwIfError(
        await sb.from("plans").select("*").order("created_at", { ascending: false })
      );
    },
    async get(id) {
      return throwIfError(await sb.from("plans").select("*").eq("id", id).single());
    },
    async create(input) {
      return throwIfError(await sb.from("plans").insert(input).select().single());
    },
    async update(id, input) {
      return throwIfError(
        await sb.from("plans").update(input).eq("id", id).select().single()
      );
    },
    async revisions(planId) {
      return throwIfError(
        await sb
          .from("plan_revisions")
          .select("*")
          .eq("plan_id", planId)
          .order("replaced_at", { ascending: false })
      );
    },
  };

  // ---------------------------------------------------------------------
  // Todos
  // ---------------------------------------------------------------------
  const Todos = {
    async listByPlan(planId) {
      return throwIfError(
        await sb
          .from("todos")
          .select("*")
          .eq("plan_id", planId)
          .is("deleted_at", null)
          .order("created_at", { ascending: true })
      );
    },
    async listAllOpenForPlans(planIds) {
      if (planIds.length === 0) return [];
      return throwIfError(
        await sb.from("todos").select("*").in("plan_id", planIds).is("deleted_at", null)
      );
    },
    async create(input) {
      return throwIfError(await sb.from("todos").insert(input).select().single());
    },
    async update(id, input) {
      return throwIfError(
        await sb.from("todos").update(input).eq("id", id).select().single()
      );
    },
    async remove(id) {
      return throwIfError(
        await sb.from("todos").update({ deleted_at: new Date().toISOString() }).eq("id", id)
      );
    },
    async complete(id, { started_at, ended_at, actual_minutes, blocked_reason }) {
      return throwIfError(
        await sb.rpc("complete_todo", {
          p_todo_id: id,
          p_started_at: started_at,
          p_ended_at: ended_at,
          p_actual_minutes: actual_minutes,
          p_blocked_reason: blocked_reason || null,
        })
      );
    },
    async reopen(id) {
      return throwIfError(await sb.rpc("reopen_todo", { p_todo_id: id }));
    },
  };

  // ---------------------------------------------------------------------
  // Execution logs
  // ---------------------------------------------------------------------
  const ExecutionLogs = {
    async listByTodo(todoId) {
      return throwIfError(
        await sb
          .from("execution_logs")
          .select("*")
          .eq("todo_id", todoId)
          .order("created_at", { ascending: false })
      );
    },
    async listByTodos(todoIds) {
      if (todoIds.length === 0) return [];
      return throwIfError(
        await sb.from("execution_logs").select("*").in("todo_id", todoIds)
      );
    },
  };

  // ---------------------------------------------------------------------
  // Retrospective notes
  // ---------------------------------------------------------------------
  const RetroNotes = {
    async listByPlan(planId) {
      return throwIfError(
        await sb
          .from("retrospective_notes")
          .select("*")
          .eq("plan_id", planId)
          .order("created_at", { ascending: false })
      );
    },
    async listUncarried(carriedIds) {
      const notes = throwIfError(
        await sb.from("retrospective_notes").select("*").order("created_at", { ascending: false })
      );
      return notes.filter((n) => !carriedIds.has(n.id));
    },
    async create(planId, note) {
      return throwIfError(
        await sb.from("retrospective_notes").insert({ plan_id: planId, note }).select().single()
      );
    },
  };

  // ---------------------------------------------------------------------
  // 돌아보기 집계 — T06-C28~C32. plans/todos/execution_logs 원본에서 매번 계산한다
  // (별도 요약 테이블을 두지 않아 숫자와 근거 기록이 항상 일치한다).
  // ---------------------------------------------------------------------
  const Aggregation = {
    computeForPlan(todos, executionLogsByTodoId) {
      const today = todayInSeoul();
      const total = todos.length;
      const done = todos.filter((t) => t.status === "done").length;
      const overdue = todos.filter((t) => t.status !== "done" && t.due_date < today).length;
      const blocked = todos.filter((t) => {
        const logs = executionLogsByTodoId.get(t.id) || [];
        return logs.some((l) => l.blocked_reason && l.blocked_reason.trim().length > 0);
      }).length;
      const estimatedMinutes = todos.reduce((sum, t) => sum + (t.estimated_minutes || 0), 0);
      const actualMinutes = todos.reduce((sum, t) => {
        const logs = executionLogsByTodoId.get(t.id) || [];
        return sum + logs.reduce((s, l) => s + (l.actual_minutes || 0), 0);
      }, 0);
      return {
        total,
        done,
        overdue,
        blocked,
        estimatedMinutes,
        actualMinutes,
        diffMinutes: actualMinutes - estimatedMinutes,
      };
    },
  };

  // ---------------------------------------------------------------------
  // 정렬 — T06-C20. 선택한 기준 → 마감일 → id 순으로 동률을 깬다(화면에 문구로도 표시).
  // ---------------------------------------------------------------------
  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

  function sortTodos(todos, sortBy) {
    const arr = [...todos];
    arr.sort((a, b) => {
      let primary = 0;
      if (sortBy === "due_date") primary = a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
      else if (sortBy === "priority") primary = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      else if (sortBy === "created_at") primary = new Date(a.created_at) - new Date(b.created_at);
      if (primary !== 0) return primary;
      const byDue = a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
      if (byDue !== 0) return byDue;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return arr;
  }

  function filterTodos(todos, { query, status, tag }) {
    return todos.filter((t) => {
      if (query && !t.title.toLowerCase().includes(query.toLowerCase())) return false;
      if (status !== "all" && t.status !== status) return false;
      if (tag !== "all" && !(t.tags || []).includes(tag)) return false;
      return true;
    });
  }

  // ---------------------------------------------------------------------
  // 내보내기 — T06-C36. 계획+할일+실행기록+돌아보기 메모 전체를 파일 하나로.
  // ---------------------------------------------------------------------
  const ExportAll = {
    async run() {
      const [plans, todos, notes] = await Promise.all([
        throwIfError(await sb.from("plans").select("*")),
        throwIfError(await sb.from("todos").select("*")),
        throwIfError(await sb.from("retrospective_notes").select("*")),
      ]);
      const todoIds = todos.map((t) => t.id);
      const executionLogs = await ExecutionLogs.listByTodos(todoIds);
      const revisions = throwIfError(await sb.from("plan_revisions").select("*"));

      const payload = {
        exportedAt: new Date().toISOString(),
        schema: "pds-schema-v2",
        plans,
        plan_revisions: revisions,
        todos,
        execution_logs: executionLogs,
        retrospective_notes: notes,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pds-export-${todayInSeoul()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  };

  window.PDS = {
    Plans, Todos, ExecutionLogs, RetroNotes, Aggregation,
    sortTodos, filterTodos, ExportAll,
    todayInSeoul, formatSeoulDateTime, seoulWallClockToUtcIso, nowIsoInSeoulInput, parseTags,
  };
})();

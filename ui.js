// 화면 렌더링 + 이벤트 바인딩

const form = document.getElementById("record-form");
const idField = document.getElementById("record-id");
const dateField = document.getElementById("field-date");
const itemField = document.getElementById("field-item");
const valueField = document.getElementById("field-value");
const unitField = document.getElementById("field-unit");
const tagsField = document.getElementById("field-tags");
const memoField = document.getElementById("field-memo");
const errorEl = document.getElementById("form-error");
const tbody = document.getElementById("record-tbody");
const emptyMsg = document.getElementById("empty-msg");
const summaryTotal = document.getElementById("summary-total");
const formTitle = document.getElementById("form-title");
const submitBtn = document.getElementById("submit-btn");
const cancelEditBtn = document.getElementById("cancel-edit-btn");
const seedBtn = document.getElementById("seed-btn");
const exportBtn = document.getElementById("export-btn");
const importInput = document.getElementById("import-input");
const deleteAllBtn = document.getElementById("delete-all-btn");
const importError = document.getElementById("import-error");
const schemaStatus = document.getElementById("schema-status");
const weeklyTbody = document.getElementById("weekly-tbody");
const weeklyEmpty = document.getElementById("weekly-empty");
const weeklySkipped = document.getElementById("weekly-skipped");
const viewToggleBtn = document.getElementById("view-toggle-btn");
const calendarView = document.getElementById("calendar-view");
const recordTable = document.getElementById("record-table");
const checklistTableEl = document.getElementById("checklist-table");
const checklistTableTitleEl = document.getElementById("checklist-table-title");
const checklistTableEmptyEl = document.getElementById("checklist-table-empty");
const calendarGrid = document.getElementById("calendar-grid");
const calendarWeekdaysEl = document.getElementById("calendar-weekdays");
const calMonthLabel = document.getElementById("cal-month-label");
const calPrevBtn = document.getElementById("cal-prev-btn");
const calNextBtn = document.getElementById("cal-next-btn");
const calTodayBtn = document.getElementById("cal-today-btn");
const calWeekStartSelect = document.getElementById("cal-week-start-select");
const detailOverlay = document.getElementById("record-detail-overlay");
const detailCloseBtn = document.getElementById("detail-close-btn");
const detailEditBtn = document.getElementById("detail-edit-btn");
const detailDeleteBtn = document.getElementById("detail-delete-btn");
const detailDate = document.getElementById("detail-date");
const detailItem = document.getElementById("detail-item");
const detailValue = document.getElementById("detail-value");
const detailUnit = document.getElementById("detail-unit");
const detailTags = document.getElementById("detail-tags");
const detailMemo = document.getElementById("detail-memo");

let currentDetailRecord = null;
let currentView = "calendar";
let lastRecordCount = 0;
const todayInit = new Date();
let calYear = todayInit.getFullYear();
let calMonth = todayInit.getMonth(); // 0-indexed

const CAL_WEEK_START_KEY = "plandoc_cal_week_start";
let calWeekStart = localStorage.getItem(CAL_WEEK_START_KEY) === "sun" ? "sun" : "mon";
calWeekStartSelect.value = calWeekStart;

function clearError() {
  errorEl.textContent = "";
}

function showError(message) {
  errorEl.textContent = message;
}

function resetForm() {
  form.reset();
  idField.value = "";
  dateField.value = todayDateString();
  formTitle.textContent = "기록 추가";
  submitBtn.textContent = "추가";
  cancelEditBtn.hidden = true;
  clearError();
}

function enterEditMode(record) {
  idField.value = record.id;
  dateField.value = record.date;
  itemField.value = record.item;
  valueField.value = record.value;
  unitField.value = record.unit;
  tagsField.value = (record.tags || []).join(", ");
  memoField.value = record.memo || "";
  formTitle.textContent = "기록 수정";
  submitBtn.textContent = "저장";
  cancelEditBtn.hidden = false;
  clearError();
}

function openRecordDetail(record) {
  currentDetailRecord = record;
  detailDate.textContent = record.date || "";
  detailItem.textContent = record.item || "";
  detailValue.textContent = record.value ?? "";
  detailUnit.textContent = record.unit || "";
  detailTags.textContent = (record.tags || []).join(", ") || "-";
  detailMemo.textContent = record.memo || "-";
  detailOverlay.hidden = false;
}

function closeRecordDetail() {
  detailOverlay.hidden = true;
  currentDetailRecord = null;
}

detailCloseBtn.addEventListener("click", closeRecordDetail);

detailOverlay.addEventListener("click", (e) => {
  if (e.target === detailOverlay) closeRecordDetail();
});

detailEditBtn.addEventListener("click", () => {
  if (!currentDetailRecord) return;
  enterEditMode(currentDetailRecord);
  closeRecordDetail();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
});

detailDeleteBtn.addEventListener("click", () => {
  if (!currentDetailRecord) return;
  Records.remove(currentDetailRecord.id);
  closeRecordDetail();
  render();
});

function render() {
  const records = Records.getAll()
    .slice()
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  lastRecordCount = records.length;
  renderTable(records);
  renderCalendar(records);

  summaryTotal.textContent = `전체 기록: ${records.length}건`;
  schemaStatus.textContent = `데이터 형식: schemaVersion v${CURRENT_SCHEMA_VERSION} · v1 형식(태그 필드 없음)으로 저장·가져오기된 기록은 불러오는 즉시 자동으로 v${CURRENT_SCHEMA_VERSION}로 변환됩니다 (id·날짜·값·단위는 그대로 유지).`;

  renderWeeklySummary(records);
  refreshChecklistTableVisibility();
}

function renderTable(records) {
  tbody.innerHTML = "";
  emptyMsg.hidden = !(currentView === "table" && records.length === 0);

  for (const r of records) {
    const tr = document.createElement("tr");

    const cells = [r.date, r.item, r.value, r.unit, (r.tags || []).join(", "), r.memo || ""];
    for (const text of cells) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    }

    const actionTd = document.createElement("td");

    const editBtn = document.createElement("button");
    editBtn.textContent = "수정";
    editBtn.type = "button";
    editBtn.addEventListener("click", () => enterEditMode(r));

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "삭제";
    deleteBtn.type = "button";
    deleteBtn.addEventListener("click", () => {
      Records.remove(r.id);
      render();
    });

    actionTd.appendChild(editBtn);
    actionTd.appendChild(deleteBtn);
    tr.appendChild(actionTd);

    tbody.appendChild(tr);
  }
}

const WEEKDAY_LABELS = {
  mon: ["월", "화", "수", "목", "금", "토", "일"],
  sun: ["일", "월", "화", "수", "목", "금", "토"],
};

function renderCalendarWeekdayHeader() {
  calendarWeekdaysEl.innerHTML = "";
  for (const label of WEEKDAY_LABELS[calWeekStart]) {
    const span = document.createElement("span");
    span.textContent = label;
    calendarWeekdaysEl.appendChild(span);
  }
}

// weekStart("mon" 또는 "sun") 시작 기준으로 해당 월을 덮는 전체 주(week) 단위 날짜 목록을 만든다.
// UTC 기반으로 계산해 로컬 시간대의 자정 부근 날짜 이동 문제를 피한다.
function buildMonthGrid(year, month, weekStart) {
  const startDow = weekStart === "sun" ? 0 : 1; // getUTCDay() 기준: 0=일, 1=월

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

function renderCalendar(records) {
  const recordsByDate = new Map();
  for (const r of records) {
    if (!recordsByDate.has(r.date)) recordsByDate.set(r.date, []);
    recordsByDate.get(r.date).push(r);
  }

  calMonthLabel.textContent = `${calYear}년 ${calMonth + 1}월`;
  renderCalendarWeekdayHeader();
  calendarGrid.innerHTML = "";

  const today = todayDateString();
  const days = buildMonthGrid(calYear, calMonth, calWeekStart);
  const checklistItems = ChecklistItems.getAll();

  for (const day of days) {
    const cell = document.createElement("div");
    cell.className = "calendar-day";
    if (!day.inMonth) cell.classList.add("out-month");
    if (day.dateStr === today) cell.classList.add("today");

    const dayNumber = document.createElement("span");
    dayNumber.className = "day-number";
    dayNumber.textContent = String(Number(day.dateStr.slice(8, 10)));
    cell.appendChild(dayNumber);

    const dayRecords = document.createElement("div");
    dayRecords.className = "day-records";

    const dueChecklist = checklistItems.filter((item) => isChecklistDue(item, day.dateStr));
    const dayRecordList = recordsByDate.get(day.dateStr) || [];

    // 체크리스트를 위쪽에 먼저 보여주고, 넘치는 항목은 칸 안에서 스크롤(스크롤바는 숨김)로 본다.
    for (const c of dueChecklist) {
      const chip = document.createElement("label");
      chip.className = "day-checklist-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      const done = c.completedDates.includes(day.dateStr);
      checkbox.checked = done;
      checkbox.addEventListener("change", () => {
        ChecklistItems.toggle(c.id, day.dateStr);
        render();
        renderChecklist();
      });

      const text = document.createElement("span");
      text.className = "day-checklist-label";
      if (done) text.classList.add("done");
      text.textContent = c.title;
      text.title = c.title;

      chip.append(checkbox, text);
      dayRecords.appendChild(chip);
    }

    for (const r of dayRecordList) {
      const item = document.createElement("div");
      item.className = "day-record-item";
      const hasValue = !isBlank(r.value) || !isBlank(r.unit);
      item.textContent = hasValue ? `${r.item} · ${r.value}${r.unit}` : r.item;
      item.title = item.textContent;

      // 칸이 작아 목록에서는 요약만 보여주고, 클릭하면 상세 모달에서 전체 정보 + 수정·삭제를 보여준다.
      item.addEventListener("click", () => openRecordDetail(r));

      dayRecords.appendChild(item);
    }

    cell.appendChild(dayRecords);
    calendarGrid.appendChild(cell);
  }
}

// 체크리스트는 기록(Records)과 별개인 checklist.js 소관 데이터라 여기서는
// 표시 여부(hidden)만 켜고 끄고, 실제 행 렌더링은 renderChecklistTable()이 담당한다.
function refreshChecklistTableVisibility() {
  const isTableView = currentView === "table";
  checklistTableEl.hidden = !isTableView;
  checklistTableTitleEl.hidden = !isTableView;
  checklistTableEmptyEl.hidden = !(isTableView && lastChecklistCount === 0);
}

function setView(view) {
  currentView = view;
  calendarView.hidden = view !== "calendar";
  recordTable.hidden = view !== "table";
  viewToggleBtn.textContent = view === "calendar" ? "📋 테이블로 보기" : "🗓 캘린더로 보기";
  emptyMsg.hidden = !(view === "table" && lastRecordCount === 0);
  refreshChecklistTableVisibility();
}

viewToggleBtn.addEventListener("click", () => {
  setView(currentView === "calendar" ? "table" : "calendar");
});

calPrevBtn.addEventListener("click", () => {
  calMonth -= 1;
  if (calMonth < 0) {
    calMonth = 11;
    calYear -= 1;
  }
  render();
});

calNextBtn.addEventListener("click", () => {
  calMonth += 1;
  if (calMonth > 11) {
    calMonth = 0;
    calYear += 1;
  }
  render();
});

calTodayBtn.addEventListener("click", () => {
  const d = new Date();
  calYear = d.getFullYear();
  calMonth = d.getMonth();
  render();
});

calWeekStartSelect.addEventListener("change", () => {
  calWeekStart = calWeekStartSelect.value === "sun" ? "sun" : "mon";
  localStorage.setItem(CAL_WEEK_START_KEY, calWeekStart);
  render();
});

function renderWeeklySummary(records) {
  const { weeks, skipped } = WeeklySummary.compute(records);
  weeklyTbody.innerHTML = "";
  weeklyEmpty.hidden = weeks.length > 0;

  for (const w of weeks) {
    const tr = document.createElement("tr");

    const periodTd = document.createElement("td");
    periodTd.textContent = `${w.weekStart} ~ ${w.weekEnd}`;

    const countTd = document.createElement("td");
    countTd.textContent = `${w.count}건`;

    const itemsTd = document.createElement("td");
    itemsTd.textContent = Object.entries(w.sumByItem)
      .map(([item, sum]) => `${item}: ${sum}`)
      .join(", ");

    tr.append(periodTd, countTd, itemsTd);
    weeklyTbody.appendChild(tr);
  }

  weeklySkipped.textContent =
    skipped.length > 0
      ? `집계에서 제외된 기록 ${skipped.length}건 (${skipped.map((s) => s.reason).join(", ")}) — 목록·요약에 섞이지 않습니다.`
      : "";
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  clearError();

  const payload = {
    date: dateField.value,
    item: itemField.value,
    value: valueField.value,
    unit: unitField.value,
    tags: tagsField.value,
    memo: memoField.value,
  };

  try {
    if (idField.value) {
      Records.update(idField.value, payload);
    } else {
      Records.create(payload);
    }
    resetForm();
    render();
  } catch (err) {
    showError(err.message);
  }
});

cancelEditBtn.addEventListener("click", resetForm);

seedBtn.addEventListener("click", () => {
  const samples = [
    { date: "2026-08-24", item: "운동", value: 30, unit: "분", tags: "실내, 아침", memo: "홈트레이닝" },
    { date: "2026-08-25", item: "독서", value: 20, unit: "페이지", tags: "", memo: "" },
    { date: "2026-08-26", item: "게임 기록", value: 5, unit: "회", tags: "저녁", memo: "연습 매치" },
  ];
  for (const s of samples) Records.create(s);
  render();
});

exportBtn.addEventListener("click", () => {
  const json = ImportExport.exportJSON();
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `plandoc_records_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

importInput.addEventListener("change", async () => {
  const file = importInput.files[0];
  importInput.value = "";
  if (!file) return;

  importError.textContent = "";
  try {
    const text = await file.text();
    const records = ImportExport.parseImport(text);
    Records.replaceAll(records);
    render();
  } catch (err) {
    importError.textContent = `가져오기 실패: ${err.message} (기존 기록은 그대로 유지됩니다.)`;
  }
});

deleteAllBtn.addEventListener("click", () => {
  if (!confirm("모든 기록을 삭제합니다. 되돌릴 수 없습니다. 계속할까요?")) return;
  Records.removeAll();
  importError.textContent = "";
  render();
});

setView(currentView);
dateField.value = todayDateString();
render();

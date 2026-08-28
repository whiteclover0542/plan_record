// 반복 체크리스트 — 카드1~5의 기록(Records)과는 별도인 부가 기능.
// 별도 저장소를 쓰며 기록 스키마·마이그레이션과 전혀 얽히지 않는다.
//
// 반복 종류(repeat.type):
//   once    - 특정 날짜 하루만(기본값, 생성 시점의 오늘 날짜로 고정)
//   daily   - 매일
//   weekly  - 지정한 요일마다 (days: 0=월 ... 6=일)
//   monthly - 지정한 매월 날짜마다 (days: 1~31)

const CHECKLIST_STORAGE_KEY = "plandoc_checklist_v1";
const CHECKLIST_WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

const ChecklistStorage = {
  load() {
    const raw = localStorage.getItem(CHECKLIST_STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },
  save(items) {
    localStorage.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify(items));
  },
};

// 월요일=0 ... 일요일=6 (캘린더 요일 표기·주 시작 요일과 동일한 기준)
function mondayIndexOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (jsDay + 6) % 7;
}

function dayOfMonthOf(dateStr) {
  return Number(dateStr.split("-")[2]);
}

function isWithinRange(item, dateStr) {
  const range = item.range || {};
  if (range.start && dateStr < range.start) return false;
  if (range.end && dateStr > range.end) return false;
  return true;
}

function isChecklistDue(item, dateStr) {
  if (!isWithinRange(item, dateStr)) return false;

  switch (item.repeat.type) {
    case "once":
      return item.repeat.date === dateStr;
    case "daily":
      return true;
    case "weekly":
      return item.repeat.days.includes(mondayIndexOf(dateStr));
    case "monthly":
      return item.repeat.days.includes(dayOfMonthOf(dateStr));
    default:
      return false;
  }
}

const ChecklistItems = {
  getAll() {
    return ChecklistStorage.load();
  },

  create(title, repeat, range, color) {
    const trimmed = String(title || "").trim();
    if (!trimmed) throw new Error("할 일을 입력해주세요.");
    if (repeat.type === "weekly" && (!Array.isArray(repeat.days) || repeat.days.length === 0)) {
      throw new Error("반복할 요일을 하나 이상 선택해주세요.");
    }
    if (repeat.type === "monthly" && (!Array.isArray(repeat.days) || repeat.days.length === 0)) {
      throw new Error("반복할 날짜(1~31)를 입력해주세요.");
    }
    if (range && range.start && range.end && range.start > range.end) {
      throw new Error("시작일은 종료일보다 늦을 수 없습니다.");
    }

    const item = {
      id: crypto.randomUUID(),
      title: trimmed,
      repeat,
      range: { start: (range && range.start) || null, end: (range && range.end) || null },
      color: normalizeColor(color),
      completedDates: [],
    };

    const items = ChecklistStorage.load();
    items.push(item);
    ChecklistStorage.save(items);
    return item;
  },

  remove(id) {
    const items = ChecklistStorage.load().filter((i) => i.id !== id);
    ChecklistStorage.save(items);
  },

  toggle(id, dateStr) {
    const items = ChecklistStorage.load();
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const idx = item.completedDates.indexOf(dateStr);
    if (idx === -1) item.completedDates.push(dateStr);
    else item.completedDates.splice(idx, 1);
    ChecklistStorage.save(items);
  },

  replaceAll(items) {
    ChecklistStorage.save(items);
  },
};

// 기록(Records)의 ImportExport와 동일한 방식: 이미 파싱된 배열을 검증·정규화해 반환한다.
// 형식이 잘못되면 이유를 담은 Error를 던지고, 호출부에서 검증 통과 후에만 저장한다.
const ChecklistImportExport = {
  parseItems(data) {
    if (!Array.isArray(data)) {
      throw new Error("체크리스트 형식이 배열이 아닙니다.");
    }

    const seenIds = new Set();
    for (let i = 0; i < data.length; i++) {
      const it = data[i];
      const pos = i + 1;
      if (!it || typeof it !== "object") {
        throw new Error(`체크리스트 ${pos}번째 항목이 올바른 형식이 아닙니다.`);
      }
      if (isBlank(it.id)) {
        throw new Error(`체크리스트 ${pos}번째 항목에 id가 없습니다.`);
      }
      if (seenIds.has(it.id)) {
        throw new Error(`체크리스트 ${pos}번째 항목의 id(${it.id})가 중복됩니다.`);
      }
      seenIds.add(it.id);
      if (isBlank(it.title)) {
        throw new Error(`체크리스트 ${pos}번째 항목에 title이 없습니다.`);
      }
      const repeatType = it.repeat && it.repeat.type;
      if (!["once", "daily", "weekly", "monthly"].includes(repeatType)) {
        throw new Error(`체크리스트 ${pos}번째 항목의 반복 설정이 올바르지 않습니다.`);
      }
      if ((repeatType === "weekly" || repeatType === "monthly") && !Array.isArray(it.repeat.days)) {
        throw new Error(`체크리스트 ${pos}번째 항목의 반복 요일/날짜가 올바르지 않습니다.`);
      }
    }

    return data.map((it) => ({
      id: it.id,
      title: String(it.title).trim(),
      repeat: it.repeat,
      range: { start: (it.range && it.range.start) || null, end: (it.range && it.range.end) || null },
      color: normalizeColor(it.color),
      completedDates: Array.isArray(it.completedDates) ? it.completedDates.filter((d) => typeof d === "string") : [],
    }));
  },
};

function parseMonthDays(text) {
  const days = String(text || "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 31);
  return [...new Set(days)];
}

// ---- 화면 ----

const checklistList = document.getElementById("checklist-list");
const checklistEmpty = document.getElementById("checklist-empty");
const checklistDateLabel = document.getElementById("checklist-date-label");
const checklistForm = document.getElementById("checklist-form");
const checklistTitleField = document.getElementById("checklist-title");
const checklistWeekdayPicker = document.getElementById("checklist-weekday-picker");
const checklistMonthdayPicker = document.getElementById("checklist-monthday-picker");
const checklistMonthdaysField = document.getElementById("checklist-monthdays");
const checklistRangePicker = document.getElementById("checklist-range-picker");
const checklistStartDateField = document.getElementById("checklist-start-date");
const checklistEndDateField = document.getElementById("checklist-end-date");
const checklistBorderColorField = document.getElementById("checklist-border-color");
const checklistTextColorField = document.getElementById("checklist-text-color");
const checklistError = document.getElementById("checklist-error");
const checklistTableTitle = document.getElementById("checklist-table-title");
const checklistTableTbody = document.getElementById("checklist-table-tbody");
const checklistTableEmpty = document.getElementById("checklist-table-empty");
let lastChecklistCount = 0;

function formatRepeatBadge(repeat) {
  if (repeat.type === "once") return repeat.date;
  if (repeat.type === "daily") return "매일";
  if (repeat.type === "weekly") {
    return repeat.days
      .slice()
      .sort((a, b) => a - b)
      .map((d) => CHECKLIST_WEEKDAY_LABELS[d])
      .join("");
  }
  if (repeat.type === "monthly") {
    return `매월 ${repeat.days
      .slice()
      .sort((a, b) => a - b)
      .join(",")}일`;
  }
  return "";
}

function formatRangeSuffix(range) {
  if (!range) return "";
  const { start, end } = range;
  if (start && end) return ` (${start}~${end})`;
  if (start) return ` (${start}~)`;
  if (end) return ` (~${end})`;
  return "";
}

function renderChecklist() {
  const today = todayDateString();
  checklistDateLabel.textContent = `오늘(${today}) 기준`;

  const items = ChecklistItems.getAll().filter((item) => isChecklistDue(item, today));
  checklistList.innerHTML = "";
  checklistEmpty.hidden = items.length > 0;

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "checklist-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const done = item.completedDates.includes(today);
    checkbox.checked = done;
    checkbox.addEventListener("change", () => {
      ChecklistItems.toggle(item.id, today);
      renderChecklist();
      render();
    });

    const label = document.createElement("span");
    label.className = "checklist-item-title";
    if (done) label.classList.add("done");
    label.textContent = item.title;
    label.title = item.title;

    const repeatBadge = document.createElement("span");
    repeatBadge.className = "checklist-item-repeat";
    repeatBadge.textContent = formatRepeatBadge(item.repeat) + formatRangeSuffix(item.range);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "checklist-delete-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", () => {
      ChecklistItems.remove(item.id);
      renderChecklist();
      render();
    });

    li.append(checkbox, label, repeatBadge, deleteBtn);
    checklistList.appendChild(li);
  }

  renderChecklistTable();
}

// 테이블(목록) 보기에서는 오늘 해당 여부와 상관없이 등록된 체크리스트 전체를 보여준다 —
// 캘린더는 날짜별로만 보이므로, 반복 규칙 자체를 관리하려면 전체 목록이 필요하다.
function renderChecklistTable() {
  const today = todayDateString();
  const items = ChecklistItems.getAll();
  lastChecklistCount = items.length;

  checklistTableTbody.innerHTML = "";

  for (const item of items) {
    const tr = document.createElement("tr");
    tr.style.color = item.color?.text || "#ffffff";

    const titleTd = document.createElement("td");
    titleTd.textContent = item.title;
    titleTd.style.borderLeft = `3px solid ${item.color?.border || "#ffffff"}`;

    const repeatTd = document.createElement("td");
    repeatTd.textContent = formatRepeatBadge(item.repeat);

    const rangeTd = document.createElement("td");
    const rangeText = formatRangeSuffix(item.range).trim();
    rangeTd.textContent = rangeText ? rangeText.slice(1, -1) : "-";

    const doneTd = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.completedDates.includes(today);
    checkbox.disabled = !isChecklistDue(item, today);
    checkbox.title = checkbox.disabled ? "오늘은 해당하지 않는 항목입니다." : "";
    checkbox.addEventListener("change", () => {
      ChecklistItems.toggle(item.id, today);
      renderChecklist();
      render();
    });
    doneTd.appendChild(checkbox);

    const actionTd = document.createElement("td");
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "삭제";
    deleteBtn.addEventListener("click", () => {
      ChecklistItems.remove(item.id);
      renderChecklist();
      render();
    });
    actionTd.appendChild(deleteBtn);

    tr.append(titleTd, repeatTd, rangeTd, doneTd, actionTd);
    checklistTableTbody.appendChild(tr);
  }
}

document.querySelectorAll('input[name="checklist-repeat"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const selected = document.querySelector('input[name="checklist-repeat"]:checked').value;
    checklistWeekdayPicker.hidden = selected !== "weekly";
    checklistMonthdayPicker.hidden = selected !== "monthly";
    // "오늘만"은 이미 날짜 하나로 고정이라 기간 설정이 의미 없다.
    checklistRangePicker.hidden = selected === "once";
  });
});

checklistForm.addEventListener("submit", (e) => {
  e.preventDefault();
  checklistError.textContent = "";

  const repeatType = document.querySelector('input[name="checklist-repeat"]:checked').value;
  let repeat;
  if (repeatType === "once") {
    repeat = { type: "once", date: todayDateString() };
  } else if (repeatType === "daily") {
    repeat = { type: "daily" };
  } else if (repeatType === "weekly") {
    repeat = {
      type: "weekly",
      days: Array.from(checklistWeekdayPicker.querySelectorAll('input[type="checkbox"]:checked')).map((cb) =>
        Number(cb.value)
      ),
    };
  } else {
    repeat = { type: "monthly", days: parseMonthDays(checklistMonthdaysField.value) };
  }

  const range = {
    start: checklistStartDateField.value || null,
    end: checklistEndDateField.value || null,
  };

  const color = { border: checklistBorderColorField.value, text: checklistTextColorField.value };

  try {
    ChecklistItems.create(checklistTitleField.value, repeat, range, color);
    checklistForm.reset();
    checklistWeekdayPicker.hidden = true;
    checklistMonthdayPicker.hidden = true;
    checklistRangePicker.hidden = true;
    renderChecklist();
    render();
  } catch (err) {
    checklistError.textContent = err.message;
  }
});

renderChecklist();

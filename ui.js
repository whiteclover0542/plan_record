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

function clearError() {
  errorEl.textContent = "";
}

function showError(message) {
  errorEl.textContent = message;
}

function resetForm() {
  form.reset();
  idField.value = "";
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

function render() {
  const records = Records.getAll()
    .slice()
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  tbody.innerHTML = "";
  emptyMsg.hidden = records.length > 0;

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

  summaryTotal.textContent = `전체 기록: ${records.length}건`;
  schemaStatus.textContent = `데이터 형식: schemaVersion v${CURRENT_SCHEMA_VERSION} · v1 형식(태그 필드 없음)으로 저장·가져오기된 기록은 불러오는 즉시 자동으로 v${CURRENT_SCHEMA_VERSION}로 변환됩니다 (id·날짜·값·단위는 그대로 유지).`;

  renderWeeklySummary(records);
}

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

render();

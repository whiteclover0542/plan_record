// 플랜두씨 다이어리 — storage + CRUD 로직
// 기준 시간대: Asia/Seoul (고정) · 주 시작 요일: 월요일

const TIMEZONE = "Asia/Seoul";
const STORAGE_KEY = "plandoc_records_v1";
const CURRENT_SCHEMA_VERSION = 1;

const Storage = {
  load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  save(records) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  },
};

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

function validateRecordInput({ date, item, value, unit }) {
  if (isBlank(date) || isBlank(item) || isBlank(value) || isBlank(unit)) {
    return "날짜, 항목, 값, 단위는 비워둘 수 없습니다.";
  }
  if (Number.isNaN(Number(value))) {
    return "값은 숫자여야 합니다.";
  }
  if (Number.isNaN(Date.parse(date))) {
    return "날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)";
  }
  return null;
}

const Records = {
  getAll() {
    return Storage.load();
  },

  create({ date, item, value, unit, memo }) {
    const error = validateRecordInput({ date, item, value, unit });
    if (error) throw new Error(error);

    const record = {
      id: crypto.randomUUID(),
      date,
      timezone: TIMEZONE,
      item: String(item).trim(),
      value: Number(value),
      unit: String(unit).trim(),
      memo: memo ? String(memo).trim() : "",
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };

    const records = Storage.load();
    records.push(record);
    Storage.save(records);
    return record;
  },

  update(id, patch) {
    const records = Storage.load();
    const index = records.findIndex((r) => r.id === id);
    if (index === -1) throw new Error("해당 ID의 기록을 찾을 수 없습니다.");

    const merged = { ...records[index], ...patch };
    const error = validateRecordInput(merged);
    if (error) throw new Error(error);

    merged.value = Number(merged.value);
    records[index] = merged;
    Storage.save(records);
    return merged;
  },

  remove(id) {
    const records = Storage.load();
    const next = records.filter((r) => r.id !== id);
    if (next.length === records.length) {
      throw new Error("해당 ID의 기록을 찾을 수 없습니다.");
    }
    Storage.save(next);
  },

  removeAll() {
    Storage.save([]);
  },

  replaceAll(records) {
    Storage.save(records);
  },
};

const ImportExport = {
  exportJSON() {
    return JSON.stringify(Records.getAll(), null, 2);
  },

  // 문자열을 검증해 기록 배열을 반환한다. 형식이 잘못되면 이유를 담은 Error를 던지고
  // 기존 저장 데이터는 건드리지 않는다(호출부에서 검증 통과 후에만 저장한다).
  parseImport(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("JSON 형식이 올바르지 않습니다.");
    }

    if (!Array.isArray(data)) {
      throw new Error("최상위 형식이 배열이 아닙니다.");
    }

    const seenIds = new Set();
    for (let i = 0; i < data.length; i++) {
      const r = data[i];
      const pos = i + 1;
      if (!r || typeof r !== "object") {
        throw new Error(`${pos}번째 항목이 올바른 기록 형식이 아닙니다.`);
      }
      if (isBlank(r.id)) {
        throw new Error(`${pos}번째 기록에 id가 없습니다.`);
      }
      if (seenIds.has(r.id)) {
        throw new Error(`${pos}번째 기록의 id(${r.id})가 중복됩니다.`);
      }
      seenIds.add(r.id);

      const error = validateRecordInput(r);
      if (error) {
        throw new Error(`${pos}번째 기록 오류: ${error}`);
      }
    }

    return data.map((r) => ({
      id: r.id,
      date: r.date,
      timezone: r.timezone || TIMEZONE,
      item: String(r.item).trim(),
      value: Number(r.value),
      unit: String(r.unit).trim(),
      memo: r.memo ? String(r.memo).trim() : "",
      schemaVersion: r.schemaVersion || CURRENT_SCHEMA_VERSION,
    }));
  },
};

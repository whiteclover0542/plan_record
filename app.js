// 플랜두씨 다이어리 — storage + CRUD 로직
// 기준 시간대: Asia/Seoul (고정) · 주 시작 요일: 월요일

const TIMEZONE = "Asia/Seoul";
const STORAGE_KEY = "plandoc_records_v1";
const CURRENT_SCHEMA_VERSION = 2;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// v1(schemaVersion 없음 또는 1): id·date·timezone·item·value·unit·memo
// v2(schemaVersion 2): v1 필드 + tags(문자열 배열). 이미 v2면 그대로 반환(멱등).
function migrateRecordToV2(record) {
  if (record.schemaVersion === 2) return record;
  return {
    ...record,
    tags: Array.isArray(record.tags) ? record.tags : [],
    schemaVersion: 2,
  };
}

function migrateAllToV2(records) {
  let migratedCount = 0;
  const next = records.map((r) => {
    const upgraded = migrateRecordToV2(r);
    if (upgraded !== r) migratedCount++;
    return upgraded;
  });
  return { records: next, migratedCount };
}

const Storage = {
  lastMigratedCount: 0,

  load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      this.lastMigratedCount = 0;
      return [];
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) parsed = [];
    } catch {
      parsed = [];
    }

    const { records, migratedCount } = migrateAllToV2(parsed);
    this.lastMigratedCount = migratedCount;
    if (migratedCount > 0) this.save(records);
    return records;
  },

  save(records) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  },
};

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

// "YYYY-MM-DD" 형식이면서 실존하는 달력 날짜인지 확인한다.
// Date.parse는 2026-02-30 같은 값을 3월로 밀어서 받아들이므로 직접 왕복 검증한다.
function isValidDateString(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function validateRecordInput({ date, item, value, unit }) {
  if (isBlank(date) || isBlank(item)) {
    return "날짜, 항목은 비워둘 수 없습니다.";
  }
  if (!isBlank(value) && Number.isNaN(Number(value))) {
    return "값은 숫자여야 합니다.";
  }
  if (!isValidDateString(date)) {
    return "날짜 형식이 올바르지 않습니다. (YYYY-MM-DD, 실존하는 날짜)";
  }
  return null;
}

// 월요일(00:00)~일요일(23:59, Asia/Seoul) 기준 주 경계를 계산한다.
// 날짜만 저장하므로 달력일 단위로 계산하면 시간대 경계 문제가 생기지 않는다.
function getWeekRange(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  const weekday = day.getUTCDay(); // 0=일, 1=월, ... 6=토
  const daysSinceMonday = (weekday + 6) % 7;
  const start = new Date(day);
  start.setUTCDate(day.getUTCDate() - daysSinceMonday);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

  const fmt = (dt) => dt.toISOString().slice(0, 10);
  return { weekStart: fmt(start), weekEnd: fmt(end) };
}

const WeeklySummary = {
  // records: 저장소의 원본 배열(오염 가능성 있음). 유효하지 않은 항목은 집계에서 제외하고
  // 이유와 함께 skipped 목록으로 반환한다 — 절대 예외를 던지거나 잘못된 값을 합계에 섞지 않는다.
  compute(records) {
    const seenIds = new Set();
    const skipped = [];
    const valid = [];

    for (const r of records) {
      if (!r || typeof r !== "object") {
        skipped.push({ id: undefined, reason: "형식 오류" });
        continue;
      }
      if (!isBlank(r.id) && seenIds.has(r.id)) {
        skipped.push({ id: r.id, reason: "중복 id" });
        continue;
      }
      if (!isBlank(r.id)) seenIds.add(r.id);

      if (isBlank(r.date) || isBlank(r.item)) {
        skipped.push({ id: r.id, reason: "필수값 누락" });
        continue;
      }
      if (!isValidDateString(r.date)) {
        skipped.push({ id: r.id, reason: "잘못된 날짜" });
        continue;
      }
      if (!isBlank(r.value) && Number.isNaN(Number(r.value))) {
        skipped.push({ id: r.id, reason: "숫자가 아닌 값" });
        continue;
      }

      valid.push(r);
    }

    const weekMap = new Map();
    for (const r of valid) {
      const { weekStart, weekEnd } = getWeekRange(r.date);
      const key = weekStart;
      if (!weekMap.has(key)) {
        weekMap.set(key, { weekStart, weekEnd, count: 0, sumByItem: {}, sumByTag: {} });
      }
      const bucket = weekMap.get(key);
      bucket.count += 1;
      const numValue = isBlank(r.value) ? 0 : Number(r.value);
      bucket.sumByItem[r.item] = (bucket.sumByItem[r.item] || 0) + numValue;
      for (const t of Array.isArray(r.tags) ? r.tags : []) {
        bucket.sumByTag[t] = (bucket.sumByTag[t] || 0) + numValue;
      }
    }

    const weeks = Array.from(weekMap.values()).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    return { weeks, skipped };
  },
};

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

const DEFAULT_CHIP_COLOR = "#ffffff";

function isValidHexColor(s) {
  return typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s);
}

// 캘린더 칩의 테두리/글자 색(선택 커스터마이즈). 값이 없거나 형식이 잘못되면 기본 흰색을 쓴다.
function normalizeColor(color) {
  const c = color || {};
  return {
    border: isValidHexColor(c.border) ? c.border : DEFAULT_CHIP_COLOR,
    text: isValidHexColor(c.text) ? c.text : DEFAULT_CHIP_COLOR,
  };
}

const Records = {
  getAll() {
    return Storage.load();
  },

  create({ date, item, value, unit, memo, tags, color }) {
    const error = validateRecordInput({ date, item, value, unit });
    if (error) throw new Error(error);

    const record = {
      id: crypto.randomUUID(),
      date,
      timezone: TIMEZONE,
      item: String(item).trim(),
      value: isBlank(value) ? "" : Number(value),
      unit: isBlank(unit) ? "" : String(unit).trim(),
      memo: memo ? String(memo).trim() : "",
      tags: normalizeTags(tags),
      color: normalizeColor(color),
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

    merged.value = isBlank(merged.value) ? "" : Number(merged.value);
    merged.unit = isBlank(merged.unit) ? "" : String(merged.unit).trim();
    merged.tags = normalizeTags(patch.tags !== undefined ? patch.tags : merged.tags);
    merged.color = normalizeColor(patch.color !== undefined ? patch.color : merged.color);
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

    const normalized = data.map((r) => ({
      id: r.id,
      date: r.date,
      timezone: r.timezone || TIMEZONE,
      item: String(r.item).trim(),
      value: isBlank(r.value) ? "" : Number(r.value),
      unit: isBlank(r.unit) ? "" : String(r.unit).trim(),
      memo: r.memo ? String(r.memo).trim() : "",
      tags: normalizeTags(r.tags),
      color: normalizeColor(r.color),
      schemaVersion: r.schemaVersion || 1,
    }));

    // v1 형식으로 가져온 파일은 이 시점에 v2로 자동 변환된다(이미 v2면 그대로 유지).
    const { records } = migrateAllToV2(normalized);
    return records;
  },
};

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data.json");

const VALID_SECTORS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const DEFAULT_TEAM_COUNT = 50;

function defaultSectors() {
  return {
    A: { code: "A", name: "Sektor A", visible: true },
    B: { code: "B", name: "Sektor B", visible: true },
    C: { code: "C", name: "Sektor C", visible: true },
    D: { code: "D", name: "Sektor D", visible: true },
    E: { code: "E", name: "Sektor E", visible: false },
    F: { code: "F", name: "Sektor F", visible: false },
    G: { code: "G", name: "Sektor G", visible: false },
    H: { code: "H", name: "Sektor H", visible: false }
  };
}

function buildDefaultTeams() {
  return Array.from({ length: DEFAULT_TEAM_COUNT }, (_, i) => ({
    id: i + 1,
    name: `Tím ${i + 1}`,
    sector: VALID_SECTORS[Math.floor(i / 7)] || "A",
    peg: String(i + 1),
    active: i < 20,
    photo: null
  }));
}

function defaultData() {
  return {
    sectors: defaultSectors(),
    teams: buildDefaultTeams(),
    catches: [],
    meta: {
      nextTeamId: DEFAULT_TEAM_COUNT + 1
    }
  };
}

function writeJsonAtomic(filePath, data) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    writeJsonAtomic(DATA_FILE, defaultData());
  }
}

function normalizeSectorCode(value, fallback = "A") {
  const code = String(value || "").toUpperCase();
  return VALID_SECTORS.includes(code) ? code : fallback;
}

function normalizeSectors(input, fallback) {
  const base = defaultSectors();
  const current = fallback && typeof fallback === "object" ? fallback : {};
  const out = {};

  for (const code of VALID_SECTORS) {
    const fromInput = input && typeof input[code] === "object" ? input[code] : null;
    const fromCurrent = current && typeof current[code] === "object" ? current[code] : null;
    const source = fromInput || fromCurrent || base[code];

    out[code] = {
      code,
      name: typeof source.name === "string" && source.name.trim() !== ""
        ? String(source.name)
        : base[code].name,
      visible: source.visible !== undefined
        ? Boolean(source.visible)
        : Boolean(base[code].visible)
    };
  }

  return out;
}

function normalizeTeam(raw, fallback = {}) {
  const id = Number(raw?.id ?? fallback?.id ?? 0);

  return {
    id,
    name: typeof raw?.name === "string" && raw.name.trim() !== ""
      ? String(raw.name)
      : (typeof fallback?.name === "string" && fallback.name.trim() !== "" ? String(fallback.name) : `Tím ${id}`),
    sector: normalizeSectorCode(raw?.sector, normalizeSectorCode(fallback?.sector, "A")),
    peg: raw?.peg !== undefined && raw?.peg !== null
      ? String(raw.peg)
      : String(fallback?.peg ?? id),
    active: raw?.active !== undefined
      ? Boolean(raw.active)
      : Boolean(fallback?.active),
    photo: raw?.photo !== undefined
      ? (raw.photo || null)
      : (fallback?.photo || null)
  };
}

function normalizeCatch(raw) {
  const id = Number(raw?.id || 0);
  const teamId = Number(raw?.teamId || 0);
  const weight = Number(raw?.weight || 0);

  if (!id || !teamId || !weight) {
    return null;
  }

  return {
    id,
    teamId,
    weight,
    time: raw?.time || new Date().toISOString(),
    photo: raw?.photo || null
  };
}

function loadData() {
  ensureDataFile();

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw || "{}");
    const base = defaultData();

    const sectors = normalizeSectors(parsed.sectors, base.sectors);

    const incomingTeams = Array.isArray(parsed.teams) && parsed.teams.length
      ? parsed.teams
      : base.teams;

    const teams = [];
    const usedIds = new Set();

    for (const item of incomingTeams) {
      const id = Number(item?.id || 0);
      if (!id || usedIds.has(id)) continue;

      usedIds.add(id);
      teams.push(normalizeTeam(item, { id }));
    }

    if (!teams.length) {
      for (const t of base.teams) {
        teams.push({ ...t });
      }
    }

    teams.sort((a, b) => Number(a.id) - Number(b.id));

    const catches = Array.isArray(parsed.catches)
      ? parsed.catches.map(normalizeCatch).filter(Boolean)
      : [];

    const maxTeamId = teams.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0);

    const meta = {
      nextTeamId: Math.max(
        Number(parsed?.meta?.nextTeamId || 0),
        maxTeamId + 1,
        DEFAULT_TEAM_COUNT + 1
      )
    };

    return { sectors, teams, catches, meta };
  } catch (e) {
    console.error("Chyba pri loadData, obnovujem defaultData:", e);
    const data = defaultData();
    writeJsonAtomic(DATA_FILE, data);
    return data;
  }
}

function saveData(data, options = {}) {
  const current = loadData();

  if ((current.catches?.length || 0) > 0 && (data?.catches?.length || 0) === 0) {
    data.catches = current.catches;
  }

  const safeTeams = Array.isArray(data?.teams)
    ? data.teams
        .map(t => normalizeTeam(t, t))
        .filter(t => Number(t.id) > 0)
        .sort((a, b) => Number(a.id) - Number(b.id))
    : current.teams;

  const safeCatches = Array.isArray(data?.catches)
    ? data.catches.map(normalizeCatch).filter(Boolean)
    : current.catches;

  const maxTeamId = safeTeams.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0);

  const safeData = {
    sectors: normalizeSectors(data?.sectors, current.sectors || defaultSectors()),
    teams: safeTeams,
    catches: safeCatches,
    meta: {
      nextTeamId: Math.max(
        Number(data?.meta?.nextTeamId || 0),
        maxTeamId + 1,
        DEFAULT_TEAM_COUNT + 1
      )
    }
  };

  writeJsonAtomic(DATA_FILE, safeData);

  if (typeof options.onAfterSave === "function") {
    options.onAfterSave(safeData);
  }

  return safeData;
}

module.exports = {
  VALID_SECTORS,
  DEFAULT_TEAM_COUNT,
  defaultSectors,
  buildDefaultTeams,
  defaultData,
  writeJsonAtomic,
  ensureDataFile,
  normalizeSectorCode,
  normalizeSectors,
  normalizeTeam,
  normalizeCatch,
  loadData,
  saveData
};
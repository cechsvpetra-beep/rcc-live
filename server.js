const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 10000;

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_FILE = path.join(__dirname, "data.json");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");
const BACKUP_DIR = path.join(__dirname, "backup");

const VALID_SECTORS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const DEFAULT_TEAM_COUNT = 50;
const BACKUP_INTERVAL_MS = 60 * 1000;
const MAX_BACKUPS = 50;

if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

app.use(session({
  secret: "rcc_secret_123",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax"
  }
}));

const USERS = [
  { username: "admin", password: "admin123", role: "admin" },
  { username: "judge1", password: "1234", role: "judge" },
  { username: "judge2", password: "1234", role: "judge" },
  { username: "judge3", password: "1234", role: "judge" }
];

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use(express.static(PUBLIC_DIR));

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

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData(), null, 2), "utf8");
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
    const data = defaultData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
    return data;
  }
}

function saveData(data) {
  const safeTeams = Array.isArray(data?.teams)
    ? data.teams
        .map(t => normalizeTeam(t, t))
        .filter(t => Number(t.id) > 0)
        .sort((a, b) => Number(a.id) - Number(b.id))
    : [];

  const safeCatches = Array.isArray(data?.catches)
    ? data.catches.map(normalizeCatch).filter(Boolean)
    : [];

  const maxTeamId = safeTeams.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0);

  const safeData = {
    sectors: normalizeSectors(data?.sectors, defaultSectors()),
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

  fs.writeFileSync(DATA_FILE, JSON.stringify(safeData, null, 2), "utf8");
}

function createBackup() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const backupName = `data-${timestamp}.json`;
    const backupPath = path.join(BACKUP_DIR, backupName);

    fs.copyFileSync(DATA_FILE, backupPath);

    const files = fs.readdirSync(BACKUP_DIR)
      .filter(name => name.startsWith("data-") && name.endsWith(".json"))
      .sort();

    if (files.length > MAX_BACKUPS) {
      const toDelete = files.slice(0, files.length - MAX_BACKUPS);
      for (const file of toDelete) {
        try {
          fs.unlinkSync(path.join(BACKUP_DIR, file));
        } catch (e) {
          console.error("Mazanie starej zálohy zlyhalo:", e);
        }
      }
    }

    console.log("Backup uložený:", backupName);
  } catch (e) {
    console.error("Backup chyba:", e);
  }
}

function getTeamById(data, id) {
  return (data.teams || []).find(t => Number(t.id) === Number(id));
}

function getCatchById(data, id) {
  return (data.catches || []).find(c => Number(c.id) === Number(id));
}

function deletePhysicalFileFromPublic(publicPath) {
  try {
    if (!publicPath || typeof publicPath !== "string") return;
    if (!publicPath.startsWith("/uploads/")) return;

    const fullPath = path.join(PUBLIC_DIR, publicPath.replace(/^\//, ""));
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (e) {
    console.error("Mazanie súboru zlyhalo:", e);
  }
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login.html");
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/login.html");
  }
  next();
}

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = USERS.find(u => u.username === username && u.password === password);

  if (!user) {
    return res.json({ ok: false });
  }

  req.session.user = {
    username: user.username,
    role: user.role
  };

  res.json({ ok: true, role: user.role });
});

app.get("/api/me", (req, res) => {
  res.json(req.session.user || null);
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/admin.html", requireAdmin, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

app.get("/judge.html", requireLogin, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "judge.html"));
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const safeName = String(file.originalname || "file").replace(/[^\w.\-]+/g, "_");
    cb(null, `${Date.now()}_${safeName}`);
  }
});

const upload = multer({ storage });

const uploadJson = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.post("/api/team-photo/:id", requireAdmin, upload.single("photo"), (req, res) => {
  try {
    const teamId = Number(req.params.id);
    const data = loadData();
    const team = getTeamById(data, teamId);

    if (!team) {
      return res.json({ ok: false, error: "Tím neexistuje" });
    }

    if (!req.file) {
      return res.json({ ok: false, error: "Chýba súbor" });
    }

    const oldPhoto = team.photo || null;
    const newPhoto = "/uploads/" + req.file.filename;

    team.photo = newPhoto;
    saveData(data);

    if (oldPhoto && oldPhoto !== newPhoto) {
      deletePhysicalFileFromPublic(oldPhoto);
    }

    res.json({
      ok: true,
      path: team.photo
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Upload fotky zlyhal" });
  }
});

app.post("/api/catch", requireLogin, upload.single("photo"), (req, res) => {
  try {
    const data = loadData();

    const teamId = Number(req.body.teamId || 0);
    const weight = Number(req.body.weight || 0);

    if (!teamId || !weight) {
      return res.json({ ok: false, error: "Chýba tím alebo váha" });
    }

    const team = getTeamById(data, teamId);
    if (!team) {
      return res.json({ ok: false, error: "Tím neexistuje" });
    }

    const newCatch = {
      id: Date.now(),
      teamId,
      weight,
      time: new Date().toISOString(),
      photo: req.file ? "/uploads/" + req.file.filename : null
    };

    data.catches.push(newCatch);
    saveData(data);

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Ukladanie úlovku zlyhalo" });
  }
});

app.get("/api/admin/setup", requireAdmin, (req, res) => {
  const data = loadData();
  res.json(data);
});

app.post("/api/admin/setup", requireAdmin, (req, res) => {
  try {
    const current = loadData();
    const incoming = req.body || {};

    const sectors = normalizeSectors(incoming.sectors, current.sectors);

    const currentTeams = Array.isArray(current.teams) ? current.teams : [];
    const incomingTeams = Array.isArray(incoming.teams) ? incoming.teams : [];

    const currentById = new Map(
      currentTeams.map(team => [Number(team.id), { ...team }])
    );

    const mergedById = new Map(
      currentTeams.map(team => [Number(team.id), { ...team }])
    );

    for (const rawTeam of incomingTeams) {
      const id = Number(rawTeam?.id || 0);
      if (!id) continue;

      const existing = currentById.get(id);

      if (existing) {
        mergedById.set(id, normalizeTeam(rawTeam, existing));
      } else {
        mergedById.set(id, normalizeTeam(rawTeam, {
          id,
          name: `Tím ${id}`,
          sector: "A",
          peg: String(id),
          active: false,
          photo: null
        }));
      }
    }

    const teams = Array.from(mergedById.values())
      .filter(t => Number(t.id) > 0)
      .sort((a, b) => Number(a.id) - Number(b.id));

    saveData({
      sectors,
      teams,
      catches: current.catches || [],
      meta: current.meta || {}
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Ukladanie admin dát zlyhalo" });
  }
});

app.post("/api/admin/restore-backup", requireAdmin, uploadJson.single("backup"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Chýba JSON súbor" });
    }

    const rawText = req.file.buffer.toString("utf8");
    let parsed;

    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      return res.status(400).json({ ok: false, error: "Súbor nie je platný JSON" });
    }

    if (!parsed || typeof parsed !== "object") {
      return res.status(400).json({ ok: false, error: "Neplatná štruktúra dát" });
    }

    const safeData = {
      sectors: normalizeSectors(parsed.sectors, defaultSectors()),
      teams: Array.isArray(parsed.teams)
        ? parsed.teams
            .map(t => normalizeTeam(t, t))
            .filter(t => Number(t.id) > 0)
            .sort((a, b) => Number(a.id) - Number(b.id))
        : buildDefaultTeams(),
      catches: Array.isArray(parsed.catches)
        ? parsed.catches.map(normalizeCatch).filter(Boolean)
        : [],
      meta: parsed.meta || {}
    };

    if (!safeData.teams.length) {
      safeData.teams = buildDefaultTeams();
    }

    const maxTeamId = safeData.teams.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0);
    safeData.meta.nextTeamId = Math.max(
      Number(safeData.meta.nextTeamId || 0),
      maxTeamId + 1,
      DEFAULT_TEAM_COUNT + 1
    );

    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    if (fs.existsSync(DATA_FILE)) {
      const emergencyName = `pre-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const emergencyPath = path.join(BACKUP_DIR, emergencyName);
      fs.copyFileSync(DATA_FILE, emergencyPath);
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify(safeData, null, 2), "utf8");

    return res.json({
      ok: true,
      message: "Dáta boli obnovené zo zálohy"
    });
  } catch (e) {
    console.error("Restore backup chyba:", e);
    return res.status(500).json({ ok: false, error: "Obnova zo zálohy zlyhala" });
  }
});

app.get("/api/admin/download-data", requireAdmin, (req, res) => {
  try {
    ensureDataFile();
    const filename = `rcc-data-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    res.download(DATA_FILE, filename);
  } catch (e) {
    console.error("Download data chyba:", e);
    res.status(500).json({ ok: false, error: "Stiahnutie dát zlyhalo" });
  }
});

/* =========================
   ADMIN CATCHES
========================= */

app.get("/api/admin/catches", requireAdmin, (req, res) => {
  try {
    const data = loadData();

    const catches = [...(data.catches || [])]
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .map(c => {
        const team = getTeamById(data, c.teamId);

        return {
          id: c.id,
          teamId: Number(c.teamId),
          teamName: team?.name || `Tím ${c.teamId}`,
          teamSector: team?.sector || "-",
          teamPeg: team?.peg || "-",
          weight: Number(c.weight || 0),
          time: c.time,
          photo: c.photo || null
        };
      });

    res.json({ ok: true, catches });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, catches: [], error: "Načítanie úlovkov zlyhalo" });
  }
});

app.post("/api/admin/catch-update/:id", requireAdmin, (req, res) => {
  try {
    const catchId = Number(req.params.id);
    const teamId = Number(req.body.teamId || 0);
    const weight = Number(req.body.weight || 0);

    if (!catchId || !teamId || !weight) {
      return res.json({ ok: false, error: "Chýba ID úlovku, tím alebo váha" });
    }

    const data = loadData();
    const catchItem = getCatchById(data, catchId);

    if (!catchItem) {
      return res.json({ ok: false, error: "Úlovok neexistuje" });
    }

    const team = getTeamById(data, teamId);
    if (!team) {
      return res.json({ ok: false, error: "Tím neexistuje" });
    }

    catchItem.teamId = teamId;
    catchItem.weight = weight;

    saveData(data);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Úprava úlovku zlyhala" });
  }
});

app.post("/api/admin/catch-delete/:id", requireAdmin, (req, res) => {
  try {
    const catchId = Number(req.params.id);
    const data = loadData();

    const index = data.catches.findIndex(c => Number(c.id) === catchId);
    if (index === -1) {
      return res.json({ ok: false, error: "Úlovok neexistuje" });
    }

    const catchItem = data.catches[index];

    if (catchItem.photo) {
      deletePhysicalFileFromPublic(catchItem.photo);
    }

    data.catches.splice(index, 1);
    saveData(data);

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Mazanie úlovku zlyhalo" });
  }
});

/* =========================
   PUBLIC API
========================= */

app.get("/api/sectors", (req, res) => {
  const data = loadData();
  const sectors = Object.values(data.sectors || {})
    .filter(s => s && s.visible)
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));

  res.json(sectors);
});

app.get("/api/state", (req, res) => {
  try {
    const data = loadData();

    const teams = Array.isArray(data.teams) ? data.teams : [];
    const catches = Array.isArray(data.catches) ? data.catches : [];

    const lb = teams
      .filter(team => team.active)
      .map(team => {
        const teamCatches = catches.filter(c => Number(c.teamId) === Number(team.id));

        const total = teamCatches.reduce((sum, c) => sum + Number(c.weight || 0), 0);

        const biggest = teamCatches.length
          ? Math.max(...teamCatches.map(c => Number(c.weight || 0)))
          : 0;

        const sortedTop = [...teamCatches]
          .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0))
          .slice(0, 3)
          .map(c => Number(c.weight || 0));

        while (sortedTop.length < 3) sortedTop.push(0);

        const top3sum = sortedTop.reduce((a, b) => a + b, 0);

        return {
          id: team.id,
          name: team.name,
          sector: team.sector,
          sectorCode: team.sector,
          peg: team.peg,
          photo: team.photo || null,
          total,
          count: teamCatches.length,
          biggest,
          top3: sortedTop,
          top3sum
        };
      });

    lb.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.biggest !== a.biggest) return b.biggest - a.biggest;
      return a.id - b.id;
    });

    const top3teams = [...lb].sort((a, b) => {
      if (b.top3sum !== a.top3sum) return b.top3sum - a.top3sum;
      if (b.biggest !== a.biggest) return b.biggest - a.biggest;
      return a.id - b.id;
    });

    const topFishCatch = catches.length
      ? catches.reduce((max, c) => Number(c.weight || 0) > Number(max.weight || 0) ? c : max)
      : null;

    const topFish = topFishCatch
      ? {
          weight: Number(topFishCatch.weight || 0),
          team: teams.find(t => Number(t.id) === Number(topFishCatch.teamId))?.name || ""
        }
      : null;

    const teamCatches = Object.fromEntries(
      teams.map(team => [
        team.id,
        catches
          .filter(c => Number(c.teamId) === Number(team.id))
          .map((c, index) => ({
            id: c.id,
            number: index + 1,
            weight: Number(c.weight || 0),
            time: c.time,
            photo: c.photo || null
          }))
      ])
    );

    res.json({
      lb,
      totalWeight: lb.reduce((sum, t) => sum + Number(t.total || 0), 0),
      totalFish: catches.length,
      topFish,
      teamCatches,
      top3teams
    });
  } catch (e) {
    console.error("API /api/state chyba:", e);
    res.status(500).json({
      lb: [],
      totalWeight: 0,
      totalFish: 0,
      topFish: null,
      teamCatches: {},
      top3teams: []
    });
  }
});

app.get("/", (req, res) => {
  res.redirect("/live.html");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log("Server beží na porte", PORT);
  createBackup();
  setInterval(createBackup, BACKUP_INTERVAL_MS);
});
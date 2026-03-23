const http = require("http");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const fileStore = require("./storage/fileStore");
const backupService = require("./services/backupService");
const stateService = require("./services/stateService");
const catchService = require("./services/catchService");

const {
  DATA_ROOT,
  DATA_FILE,
  DEFAULT_TEAM_COUNT,
  defaultSectors,
  buildDefaultTeams,
  writeJsonAtomic,
  ensureDataFile,
  normalizeSectors,
  normalizeTeam,
  normalizeCatch,
  loadData,
  saveData
} = fileStore;

const app = express();
app.set("trust proxy", 1);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true
  }
});

const PORT = process.env.PORT || 10000;

const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOADS_DIR = path.join(DATA_ROOT, "uploads");

if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

ensureDataFile();

const isProduction = process.env.NODE_ENV === "production";
const SESSION_SECRET = process.env.SESSION_SECRET || "rcc_secret_123";

app.use(session({
  name: "rcc.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

const ADMIN_USER = {
  username: "admin",
  password: "admin123",
  role: "admin"
};

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use(express.static(PUBLIC_DIR));
app.use("/uploads", express.static(UPLOADS_DIR));

function buildAndBroadcastLiveState() {
  try {
    const data = loadData();
    const publicState = stateService.buildPublicState(data);
    io.emit("state:update", publicState);
    console.log("WebSocket broadcast: state:update");
  } catch (e) {
    console.error("WebSocket broadcast chyba:", e);
  }
}

io.on("connection", (socket) => {
  console.log("WebSocket client connected:", socket.id);

  try {
    const data = loadData();
    const publicState = stateService.buildPublicState(data);
    socket.emit("state:update", publicState);
  } catch (e) {
    console.error("Initial socket state chyba:", e);
  }

  socket.on("disconnect", () => {
    console.log("WebSocket client disconnected:", socket.id);
  });
});

function getTeamById(data, id) {
  return (data.teams || []).find(t => Number(t.id) === Number(id));
}

function deletePhysicalFileFromPublic(publicPath) {
  try {
    if (!publicPath || typeof publicPath !== "string") return;
    if (!publicPath.startsWith("/uploads/")) return;

    const fullPath = path.join(UPLOADS_DIR, path.basename(publicPath));
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (e) {
    console.error("Mazanie súboru zlyhalo:", e);
  }
}

function requireLogin(req, res, next) {
  if (req.session.user) {
    return next();
  }

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({
      ok: false,
      error: "Neprihlásený používateľ",
      code: "AUTH_REQUIRED"
    });
  }

  return res.redirect("/login.html");
}

function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === "admin") {
    return next();
  }

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({
      ok: false,
      error: "Admin prístup vyžadovaný",
      code: "ADMIN_REQUIRED"
    });
  }

  return res.redirect("/login.html");
}

function ensureMeta(data) {
  if (!data.meta || typeof data.meta !== "object") {
    data.meta = {};
  }

  if (!Array.isArray(data.meta.processedSubmissionIds)) {
    data.meta.processedSubmissionIds = [];
  }

  if (!Array.isArray(data.meta.judges)) {
    data.meta.judges = [];
  }

  if (!Number.isFinite(Number(data.meta.nextJudgeId))) {
    data.meta.nextJudgeId = 1;
  }

  return data.meta;
}

function cleanupProcessedSubmissionIds(data, maxItems = 5000) {
  const meta = ensureMeta(data);

  if (meta.processedSubmissionIds.length > maxItems) {
    meta.processedSubmissionIds = meta.processedSubmissionIds.slice(-maxItems);
  }
}

function hasProcessedSubmissionId(data, clientSubmissionId) {
  if (!clientSubmissionId) return false;
  const meta = ensureMeta(data);
  return meta.processedSubmissionIds.includes(clientSubmissionId);
}

function markProcessedSubmissionId(data, clientSubmissionId) {
  if (!clientSubmissionId) return;

  const meta = ensureMeta(data);

  if (!meta.processedSubmissionIds.includes(clientSubmissionId)) {
    meta.processedSubmissionIds.push(clientSubmissionId);
    cleanupProcessedSubmissionIds(data);
  }
}

function normalizeCatchTime(value) {
  const raw = String(value || "").trim();

  if (!raw) return null;

  const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;

  return `${match[1]}:${match[2]}`;
}

function normalizeJudge(rawJudge, fallback = {}) {
  const id = Number(rawJudge?.id || fallback?.id || 0);
  const username = String(rawJudge?.username || fallback?.username || "").trim();
  const password = String(rawJudge?.password || fallback?.password || "").trim();

  return {
    id,
    username,
    password,
    active: rawJudge?.active !== undefined
      ? Boolean(rawJudge.active)
      : Boolean(fallback?.active)
  };
}

function getJudgesFromData(data) {
  const meta = ensureMeta(data);

  return (meta.judges || [])
    .map(j => normalizeJudge(j, j))
    .filter(j => Number(j.id) > 0 && j.username && j.password);
}

function findJudgeUser(username, password) {
  const data = loadData();
  const judges = getJudgesFromData(data);

  const judge = judges.find(j =>
    j.active &&
    j.username === username &&
    j.password === password
  );

  if (!judge) return null;

  return {
    username: judge.username,
    role: "judge"
  };
}

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};

  let user = null;

  if (username === ADMIN_USER.username && password === ADMIN_USER.password) {
    user = {
      username: ADMIN_USER.username,
      role: ADMIN_USER.role
    };
  } else {
    user = findJudgeUser(String(username || ""), String(password || ""));
  }

  if (!user) {
    return res.json({ ok: false });
  }

  req.session.regenerate((err) => {
    if (err) {
      console.error("Session regenerate chyba:", err);
      return res.status(500).json({ ok: false, error: "Login zlyhal" });
    }

    req.session.user = {
      username: user.username,
      role: user.role
    };

    req.session.save((saveErr) => {
      if (saveErr) {
        console.error("Session save chyba:", saveErr);
        return res.status(500).json({ ok: false, error: "Login zlyhal" });
      }

      return res.json({ ok: true, role: user.role });
    });
  });
});

app.get("/api/me", (req, res) => {
  res.json(req.session.user || null);
});

app.get("/api/session-status", (req, res) => {
  if (!req.session.user) {
    return res.json({
      ok: true,
      loggedIn: false,
      user: null
    });
  }

  return res.json({
    ok: true,
    loggedIn: true,
    user: req.session.user,
    expiresAt: req.session.cookie?.expires || null
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("rcc.sid");
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

    saveData(data, {
      onAfterSave: (savedData) => {
        backupService.createBackupFromData(savedData, "data");
        buildAndBroadcastLiveState();
      }
    });

    if (oldPhoto && oldPhoto !== newPhoto) {
      deletePhysicalFileFromPublic(oldPhoto);
    }

    return res.json({
      ok: true,
      path: team.photo
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Upload fotky zlyhal" });
  }
});

app.post("/api/catch", requireLogin, upload.single("photo"), (req, res) => {
  try {
    const data = loadData();

    const teamId = Number(req.body.teamId || 0);
    const weight = Number(req.body.weight || 0);
    const clientSubmissionId = String(req.body.clientSubmissionId || "").trim();
    const catchTime = normalizeCatchTime(req.body.catchTime);

    if (clientSubmissionId && hasProcessedSubmissionId(data, clientSubmissionId)) {
      return res.json({
        ok: true,
        duplicate: true,
        message: "Úlovok už bol spracovaný",
        clientSubmissionId
      });
    }

    const result = catchService.addCatch(data, {
      teamId,
      weight,
      photo: req.file ? "/uploads/" + req.file.filename : null
    });

    if (result.error) {
      return res.json({ ok: false, error: result.error });
    }

    const newCatch = result.newCatch;
    newCatch.catchTime = catchTime;

    if (clientSubmissionId) {
      markProcessedSubmissionId(data, clientSubmissionId);
    }

    const saved = saveData(data, {
      onAfterSave: (savedData) => {
        backupService.createBackupFromData(savedData, "data");
        buildAndBroadcastLiveState();
      }
    });

    console.log("Úlovok uložený:", {
      catchId: newCatch.id,
      teamId,
      weight,
      catchTime,
      totalCatches: saved.catches.length,
      clientSubmissionId: clientSubmissionId || null
    });

    return res.json({
      ok: true,
      catchId: newCatch.id,
      totalCatches: saved.catches.length,
      clientSubmissionId: clientSubmissionId || null
    });
  } catch (e) {
    console.error("API /api/catch chyba:", e);
    return res.status(500).json({
      ok: false,
      error: "Ukladanie úlovku zlyhalo"
    });
  }
});

app.get("/api/admin/setup", requireAdmin, (req, res) => {
  const data = loadData();
  const meta = ensureMeta(data);

  res.json({
    sectors: data.sectors || {},
    teams: data.teams || [],
    catches: data.catches || [],
    meta: {
      ...meta,
      judges: getJudgesFromData(data)
    }
  });
});

app.post("/api/admin/setup", requireAdmin, (req, res) => {
  try {
    const current = loadData();
    const currentMeta = ensureMeta(current);
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

    const incomingJudges = Array.isArray(incoming?.meta?.judges) ? incoming.meta.judges : [];
    const usedJudgeUsernames = new Set();
    const judges = [];

    for (const rawJudge of incomingJudges) {
      const judge = normalizeJudge(rawJudge, rawJudge);

      if (!Number(judge.id)) continue;
      if (!judge.username) continue;
      if (!judge.password) continue;

      const usernameKey = judge.username.toLowerCase();

      if (usernameKey === ADMIN_USER.username.toLowerCase()) {
        continue;
      }

      if (usedJudgeUsernames.has(usernameKey)) {
        return res.status(400).json({
          ok: false,
          error: `Duplicitné meno rozhodcu: ${judge.username}`
        });
      }

      usedJudgeUsernames.add(usernameKey);
      judges.push(judge);
    }

    const nextJudgeId = judges.reduce((max, j) => Math.max(max, Number(j.id) || 0), 0) + 1;

    saveData({
      sectors,
      teams,
      catches: current.catches || [],
      meta: {
        ...currentMeta,
        judges,
        nextJudgeId
      }
    }, {
      onAfterSave: (savedData) => {
        backupService.createBackupFromData(savedData, "data");
        buildAndBroadcastLiveState();
      }
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Ukladanie admin dát zlyhalo" });
  }
});

app.post("/api/admin/reset-catches", requireAdmin, (req, res) => {
  try {
    const confirmText = String(req.body?.confirmText || "").trim();

    if (confirmText !== "RESET") {
      return res.status(400).json({
        ok: false,
        error: "Pre reset musíš napísať presne RESET"
      });
    }

    const data = loadData();
    const currentCatches = Array.isArray(data.catches) ? data.catches : [];

    backupService.createBackupFromData(data, "pre-reset-catches");

    for (const item of currentCatches) {
      if (item?.photo) {
        deletePhysicalFileFromPublic(item.photo);
      }
    }

    data.catches = [];

    saveData(data, {
      onAfterSave: (savedData) => {
        backupService.createBackupFromData(savedData, "data");
        buildAndBroadcastLiveState();
      }
    });

    return res.json({
      ok: true,
      deletedCount: currentCatches.length,
      message: "Všetky úlovky boli vymazané"
    });
  } catch (e) {
    console.error("Reset catches chyba:", e);
    return res.status(500).json({
      ok: false,
      error: "Reset úlovkov zlyhal"
    });
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

    if (!Array.isArray(parsed.teams) || !Array.isArray(parsed.catches)) {
      return res.status(400).json({ ok: false, error: "Záloha nemá platnú RCC štruktúru" });
    }

    const safeData = {
      sectors: normalizeSectors(parsed.sectors, defaultSectors()),
      teams: parsed.teams
        .map(t => normalizeTeam(t, t))
        .filter(t => Number(t.id) > 0)
        .sort((a, b) => Number(a.id) - Number(b.id)),
      catches: parsed.catches
        .map(normalizeCatch)
        .filter(Boolean)
        .map(c => ({
          ...c,
          catchTime: normalizeCatchTime(c.catchTime)
        })),
      meta: parsed.meta || {}
    };

    ensureMeta(safeData);

    safeData.meta.judges = getJudgesFromData(safeData);
    safeData.meta.nextJudgeId = safeData.meta.judges.reduce((max, j) => Math.max(max, Number(j.id) || 0), 0) + 1;

    if (!safeData.teams.length) {
      return res.status(400).json({ ok: false, error: "Záloha neobsahuje žiadne tímy" });
    }

    const current = loadData();

    if ((current.catches?.length || 0) > 0 && (safeData.catches?.length || 0) === 0) {
      return res.status(400).json({
        ok: false,
        error: "Záloha neobsahuje úlovky – obnova zablokovaná (ochrana dát)"
      });
    }

    const maxTeamId = safeData.teams.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0);
    safeData.meta.nextTeamId = Math.max(
      Number(safeData.meta.nextTeamId || 0),
      maxTeamId + 1,
      DEFAULT_TEAM_COUNT + 1
    );

    cleanupProcessedSubmissionIds(safeData);

    backupService.createBackupFromData(current, "pre-restore");
    writeJsonAtomic(DATA_FILE, safeData);
    backupService.createBackupFromData(safeData, "data");
    buildAndBroadcastLiveState();

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

    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw || "{}");
    const normalized = {
      sectors: normalizeSectors(parsed.sectors, defaultSectors()),
      teams: Array.isArray(parsed.teams)
        ? parsed.teams
            .map(t => normalizeTeam(t, t))
            .filter(t => Number(t.id) > 0)
            .sort((a, b) => Number(a.id) - Number(b.id))
        : buildDefaultTeams(),
      catches: Array.isArray(parsed.catches)
        ? parsed.catches
            .map(normalizeCatch)
            .filter(Boolean)
            .map(c => ({
              ...c,
              catchTime: normalizeCatchTime(c.catchTime)
            }))
        : [],
      meta: parsed.meta || {}
    };

    ensureMeta(normalized);
    normalized.meta.judges = getJudgesFromData(normalized);
    normalized.meta.nextJudgeId = normalized.meta.judges.reduce((max, j) => Math.max(max, Number(j.id) || 0), 0) + 1;

    const maxTeamId = normalized.teams.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0);
    normalized.meta.nextTeamId = Math.max(
      Number(normalized.meta.nextTeamId || 0),
      maxTeamId + 1,
      DEFAULT_TEAM_COUNT + 1
    );

    cleanupProcessedSubmissionIds(normalized);

    const filename = `rcc-data-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(JSON.stringify(normalized, null, 2));
  } catch (e) {
    console.error("Download data chyba:", e);
    return res.status(500).json({ ok: false, error: "Stiahnutie dát zlyhalo" });
  }
});

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
          catchTime: normalizeCatchTime(c.catchTime),
          photo: c.photo || null
        };
      });

    return res.json({ ok: true, catches });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, catches: [], error: "Načítanie úlovkov zlyhalo" });
  }
});

app.post("/api/admin/catch-update/:id", requireAdmin, (req, res) => {
  try {
    const catchId = Number(req.params.id);
    const teamId = Number(req.body.teamId || 0);
    const weight = Number(req.body.weight || 0);
    const catchTime = normalizeCatchTime(req.body.catchTime);

    const data = loadData();

    const result = catchService.updateCatch(data, catchId, { teamId, weight });

    if (result.error) {
      return res.json({ ok: false, error: result.error });
    }

    const catchItem = (data.catches || []).find(c => Number(c.id) === catchId);
    if (catchItem) {
      catchItem.catchTime = catchTime;
    }

    saveData(data, {
      onAfterSave: (savedData) => {
        backupService.createBackupFromData(savedData, "data");
        buildAndBroadcastLiveState();
      }
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Úprava úlovku zlyhala" });
  }
});

app.post("/api/admin/catch-delete/:id", requireAdmin, (req, res) => {
  try {
    const catchId = Number(req.params.id);
    const data = loadData();

    const result = catchService.deleteCatch(data, catchId);

    if (result.error) {
      return res.json({ ok: false, error: result.error });
    }

    const catchItem = result.deleted;

    if (catchItem.photo) {
      deletePhysicalFileFromPublic(catchItem.photo);
    }

    saveData(data, {
      onAfterSave: (savedData) => {
        backupService.createBackupFromData(savedData, "data");
        buildAndBroadcastLiveState();
      }
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Mazanie úlovku zlyhalo" });
  }
});

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
    const publicState = stateService.buildPublicState(data);
    return res.json(publicState);
  } catch (e) {
    console.error("API /api/state chyba:", e);
    return res.status(500).json({
      lb: [],
      totalWeight: 0,
      totalFish: 0,
      topFish: null,
      lastCatch: null,
      teamCatches: {},
      top3teams: []
    });
  }
});

app.get("/", (req, res) => {
  res.redirect("/live.html");
});

app.get("/health", (req, res) => {
  return res.json({
    ok: true,
    time: new Date().toISOString(),
    dataRoot: DATA_ROOT,
    dataFile: DATA_FILE,
    uploadsDir: UPLOADS_DIR
  });
});

server.listen(PORT, () => {
  console.log("Server beží na porte", PORT);
  console.log("NODE_ENV =", process.env.NODE_ENV || "undefined");
  console.log("DATA_ROOT =", DATA_ROOT);
  console.log("DATA_FILE =", DATA_FILE);
  console.log("UPLOADS_DIR =", UPLOADS_DIR);
});
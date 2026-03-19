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

if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
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
  { username: "admin",  password: "admin123", role: "admin" },
  { username: "judge1", password: "1234", role: "judge" },
  { username: "judge2", password: "1234", role: "judge" },
  { username: "judge3", password: "1234", role: "judge" }
];

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use(express.static(PUBLIC_DIR));

function defaultData() {
  return {
    sectors: {
      A: { code: "A", name: "Sektor A", visible: true },
      B: { code: "B", name: "Sektor B", visible: true },
      C: { code: "C", name: "Sektor C", visible: true },
      D: { code: "D", name: "Sektor D", visible: true },
      E: { code: "E", name: "Sektor E", visible: false },
      F: { code: "F", name: "Sektor F", visible: false },
      G: { code: "G", name: "Sektor G", visible: false },
      H: { code: "H", name: "Sektor H", visible: false }
    },
    teams: Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      name: `Tím ${i + 1}`,
      sector: ["A", "B", "C", "D", "E", "F", "G", "H"][Math.floor(i / 7)] || "A",
      peg: String(i + 1),
      active: i < 20,
      photo: null
    })),
    catches: []
  };
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData(), null, 2), "utf8");
  }
}

function loadData() {
  ensureDataFile();

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw || "{}");
    const base = defaultData();

    const sectors = { ...base.sectors, ...(parsed.sectors || {}) };

    const teamsSource = Array.isArray(parsed.teams) ? parsed.teams : base.teams;
    const teams = Array.from({ length: 50 }, (_, i) => {
      const found = teamsSource.find(t => Number(t?.id) === i + 1) || base.teams[i];
      return {
        id: i + 1,
        name: String(found?.name || `Tím ${i + 1}`),
        sector: ["A", "B", "C", "D", "E", "F", "G", "H"].includes(found?.sector) ? found.sector : "A",
        peg: String(found?.peg ?? (i + 1)),
        active: Boolean(found?.active),
        photo: found?.photo || null
      };
    });

    const catches = Array.isArray(parsed.catches) ? parsed.catches : [];

    return { sectors, teams, catches };
  } catch (e) {
    const data = defaultData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
    return data;
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

function getTeamById(data, id) {
  return data.teams.find(t => Number(t.id) === Number(id));
}

function getCatchById(data, id) {
  return data.catches.find(c => Number(c.id) === Number(id));
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

    if (team.photo) {
      deletePhysicalFileFromPublic(team.photo);
    }

    team.photo = "/uploads/" + req.file.filename;
    saveData(data);

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

    const sectors = incoming.sectors || current.sectors;
    const teamsRaw = Array.isArray(incoming.teams) ? incoming.teams : current.teams;

    const teams = Array.from({ length: 50 }, (_, i) => {
      const found = teamsRaw.find(t => Number(t?.id) === i + 1) || current.teams[i];
      return {
        id: i + 1,
        name: String(found?.name || `Tím ${i + 1}`),
        sector: ["A", "B", "C", "D", "E", "F", "G", "H"].includes(found?.sector) ? found.sector : "A",
        peg: String(found?.peg ?? (i + 1)),
        active: Boolean(found?.active),
        photo: found?.photo || null
      };
    });

    saveData({
      sectors,
      teams,
      catches: current.catches || []
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Ukladanie admin dát zlyhalo" });
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
});

app.get("/", (req, res) => {
  res.redirect("/live.html");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log("Server beží na porte", PORT);
});
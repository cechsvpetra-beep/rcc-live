const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const DATA_FILE = path.join(__dirname, "data.json");
const TEAM_PHOTO_DIR = path.join(__dirname, "public", "teamphotos");
const CATCH_PHOTO_DIR = path.join(__dirname, "public", "uploads");

if (!fs.existsSync(TEAM_PHOTO_DIR)) fs.mkdirSync(TEAM_PHOTO_DIR, { recursive: true });
if (!fs.existsSync(CATCH_PHOTO_DIR)) fs.mkdirSync(CATCH_PHOTO_DIR, { recursive: true });

function defaultData() {
  return {
    sectors: {
      A: { code: "A", name: "Sektor A" },
      B: { code: "B", name: "Sektor B" },
      C: { code: "C", name: "Sektor C" },
      D: { code: "D", name: "Sektor D" },
      E: { code: "E", name: "Sektor E" }
    },
    teams: Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      name: `Tím ${i + 1}`,
      sector: i < 10 ? "A" : i < 20 ? "B" : i < 30 ? "C" : i < 40 ? "D" : "E",
      peg: String(i + 1),
      active: i < 20,
      photo: null
    })),
    catches: []
  };
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const data = defaultData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
    return data;
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw || "{}");
    const base = defaultData();

    const parsedTeams = Array.isArray(parsed.teams) ? parsed.teams : base.teams;
    const parsedCatches = Array.isArray(parsed.catches) ? parsed.catches : [];

    return {
      sectors: parsed.sectors || base.sectors,
      teams: Array.from({ length: 50 }, (_, index) => {
        const found = parsedTeams.find(t => Number(t?.id) === index + 1) || base.teams[index];
        return {
          id: index + 1,
          name: String(found?.name || `Tím ${index + 1}`),
          sector: ["A", "B", "C", "D", "E"].includes(found?.sector) ? found.sector : "A",
          peg: String(found?.peg ?? (index + 1)),
          active: Boolean(found?.active),
          photo: found?.photo || null
        };
      }),
      catches: parsedCatches.filter(Boolean)
    };
  } catch (e) {
    const data = defaultData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
    return data;
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

function getTeamById(data, teamId) {
  return data.teams.find(t => Number(t.id) === Number(teamId));
}

function getSectorDisplayName(data, sectorCode) {
  return data.sectors?.[sectorCode]?.name || `Sektor ${sectorCode || "-"}`;
}

function getCatchTeamId(catchItem) {
  if (!catchItem || typeof catchItem !== "object") return 0;
  return Number(catchItem.teamId ?? catchItem.team ?? 0);
}

function getCatchWeight(catchItem) {
  if (!catchItem || typeof catchItem !== "object") return 0;
  return Number(catchItem.weight ?? 0);
}

function getCatchPhoto(catchItem) {
  if (!catchItem || typeof catchItem !== "object") return null;
  return catchItem.photo || null;
}

function getCatchTime(catchItem) {
  if (!catchItem || typeof catchItem !== "object") return null;
  return catchItem.time || null;
}

function getActiveTeams(data) {
  return data.teams.filter(t => t.active);
}

function normalizeCatches(data) {
  if (!Array.isArray(data.catches)) return [];

  return data.catches
    .filter(Boolean)
    .filter(c => typeof c === "object")
    .map(c => ({
      teamId: getCatchTeamId(c),
      team: getCatchTeamId(c),
      weight: getCatchWeight(c),
      photo: getCatchPhoto(c),
      time: getCatchTime(c) || new Date().toISOString()
    }))
    .filter(c => Number(c.teamId) > 0 && Number(c.weight) > 0);
}

function buildState(data) {
  const activeTeams = getActiveTeams(data);
  const activeTeamIds = new Set(activeTeams.map(t => Number(t.id)));
  const catches = normalizeCatches(data);

  const stats = {};
  const teamCatches = {};

  activeTeams.forEach(team => {
    stats[team.id] = {
      id: Number(team.id),
      name: team.name,
      sector: getSectorDisplayName(data, team.sector),
      sectorCode: team.sector,
      peg: team.peg,
      photo: team.photo || null,
      total: 0,
      count: 0,
      biggest: 0,
      top3: [],
      top3sum: 0
    };
    teamCatches[team.id] = [];
  });

  catches.forEach(c => {
    const teamId = Number(c.teamId);
    if (!activeTeamIds.has(teamId)) return;
    if (!stats[teamId]) return;

    const weight = Number(c.weight || 0);

    stats[teamId].total += weight;
    stats[teamId].count += 1;

    if (weight > stats[teamId].biggest) {
      stats[teamId].biggest = weight;
    }

    teamCatches[teamId].push({
      number: teamCatches[teamId].length + 1,
      weight,
      photo: c.photo || null,
      time: c.time || null
    });
  });

  Object.keys(teamCatches).forEach(teamId => {
    const sorted = [...teamCatches[teamId]].sort((a, b) => Number(b.weight) - Number(a.weight));
    const top3 = sorted.slice(0, 3).map(x => Number(x.weight || 0));
    stats[teamId].top3 = top3;
    stats[teamId].top3sum = top3.reduce((a, b) => a + b, 0);
  });

  const leaderboard = Object.values(stats).sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (b.biggest !== a.biggest) return b.biggest - a.biggest;
    return a.id - b.id;
  });

  const top3teams = [...Object.values(stats)].sort((a, b) => {
    if (b.top3sum !== a.top3sum) return b.top3sum - a.top3sum;
    if (b.biggest !== a.biggest) return b.biggest - a.biggest;
    return a.id - b.id;
  });

  let topFish = null;

  catches.forEach(c => {
    const teamId = Number(c.teamId);
    if (!activeTeamIds.has(teamId)) return;

    const weight = Number(c.weight || 0);
    const team = getTeamById(data, teamId);

    if (!topFish || weight > Number(topFish.weight || 0)) {
      topFish = {
        weight,
        team: team ? team.name : `Tím ${teamId}`
      };
    }
  });

  const totalWeight = leaderboard.reduce((sum, t) => sum + Number(t.total || 0), 0);
  const totalFish = leaderboard.reduce((sum, t) => sum + Number(t.count || 0), 0);

  return {
    lb: leaderboard,
    teamCatches,
    topFish,
    totalWeight,
    totalFish,
    top3teams
  };
}

const teamPhotoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, TEAM_PHOTO_DIR);
  },
  filename: function (req, file, cb) {
    const teamId = Number(req.body.teamId || 0);
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    cb(null, `team-${teamId}-${Date.now()}${ext}`);
  }
});

const catchPhotoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, CATCH_PHOTO_DIR);
  },
  filename: function (req, file, cb) {
    const teamId = Number(req.body.teamId || req.body.team || 0);
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    cb(null, `catch-${teamId}-${Date.now()}${ext}`);
  }
});

const uploadTeamPhoto = multer({ storage: teamPhotoStorage });
const uploadCatchPhoto = multer({ storage: catchPhotoStorage });

app.get("/", (req, res) => {
  res.redirect("/live.html");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/api/sectors", (req, res) => {
  const data = loadData();
  res.json(data.sectors);
});

app.get("/api/teams", (req, res) => {
  const data = loadData();
  const teams = getActiveTeams(data).map(t => ({
    id: t.id,
    name: t.name,
    sector: t.sector,
    sectorName: getSectorDisplayName(data, t.sector),
    peg: t.peg,
    photo: t.photo || null
  }));
  res.json(teams);
});

app.get("/api/admin/setup", (req, res) => {
  const data = loadData();
  res.json({
    sectors: data.sectors,
    teams: data.teams
  });
});

app.post("/api/admin/setup", (req, res) => {
  const current = loadData();

  const incomingSectors = req.body.sectors || {};
  const incomingTeams = Array.isArray(req.body.teams) ? req.body.teams : current.teams;

  const sectors = {
    A: { code: "A", name: String(incomingSectors?.A?.name || current.sectors.A.name || "Sektor A") },
    B: { code: "B", name: String(incomingSectors?.B?.name || current.sectors.B.name || "Sektor B") },
    C: { code: "C", name: String(incomingSectors?.C?.name || current.sectors.C.name || "Sektor C") },
    D: { code: "D", name: String(incomingSectors?.D?.name || current.sectors.D.name || "Sektor D") },
    E: { code: "E", name: String(incomingSectors?.E?.name || current.sectors.E.name || "Sektor E") }
  };

  const teams = Array.from({ length: 50 }, (_, index) => {
    const existing =
      incomingTeams.find(t => Number(t?.id) === index + 1) ||
      current.teams.find(t => Number(t?.id) === index + 1) ||
      {};

    const currentTeam = current.teams.find(t => Number(t.id) === index + 1);

    return {
      id: index + 1,
      name: String(existing?.name || `Tím ${index + 1}`),
      sector: ["A", "B", "C", "D", "E"].includes(existing?.sector) ? existing.sector : "A",
      peg: String(existing?.peg || (index + 1)),
      active: Boolean(existing?.active),
      photo: existing?.photo || currentTeam?.photo || null
    };
  });

  const data = {
    sectors,
    teams,
    catches: normalizeCatches(current)
  };

  saveData(data);
  res.json({ ok: true });
});

app.post("/api/admin/team-photo", uploadTeamPhoto.single("photo"), (req, res) => {
  const data = loadData();
  const teamId = Number(req.body.teamId || 0);

  if (!teamId) {
    return res.status(400).json({ ok: false, error: "missing teamId" });
  }

  const team = getTeamById(data, teamId);
  if (!team) {
    return res.status(404).json({ ok: false, error: "team not found" });
  }

  if (!req.file) {
    return res.status(400).json({ ok: false, error: "missing photo" });
  }

  if (team.photo) {
    const oldPath = path.join(__dirname, "public", team.photo.replace(/^\//, ""));
    if (fs.existsSync(oldPath)) {
      try { fs.unlinkSync(oldPath); } catch (e) {}
    }
  }

  team.photo = "/teamphotos/" + req.file.filename;
  saveData(data);

  res.json({ ok: true, photo: team.photo });
});

app.post("/api/admin/reset-catches", (req, res) => {
  const data = loadData();
  data.catches = [];
  saveData(data);
  res.json({ ok: true });
});

app.post("/api/catch", uploadCatchPhoto.single("photo"), (req, res) => {
  const data = loadData();

  const teamId = Number(req.body.teamId || req.body.team || 0);
  const weight = Number(req.body.weight || 0);

  if (!teamId || !weight) {
    return res.status(400).json({ ok: false, error: "missing team or weight" });
  }

  const team = getTeamById(data, teamId);
  if (!team || !team.active) {
    return res.status(400).json({ ok: false, error: "team is not active" });
  }

  let photoPath = null;
  if (req.file) {
    photoPath = "/uploads/" + req.file.filename;
  }

  data.catches = normalizeCatches(data);
  data.catches.push({
    teamId,
    team: teamId,
    weight,
    photo: photoPath,
    time: new Date().toISOString()
  });

  saveData(data);

  res.json({ ok: true });
});

app.get("/api/state", (req, res) => {
  const data = loadData();
  res.json(buildState(data));
});

app.listen(PORT, () => {
  console.log("Server beží na porte", PORT);
});
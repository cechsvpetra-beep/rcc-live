const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const DATA_FILE = path.join(__dirname, "data.json");

/* ===============================
   POMOCNÉ FUNKCIE
================================ */

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
      active: i < 20
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
    const parsed = JSON.parse(raw);
    const base = defaultData();

    return {
      sectors: parsed.sectors || base.sectors,
      teams: Array.isArray(parsed.teams) ? parsed.teams : base.teams,
      catches: Array.isArray(parsed.catches) ? parsed.catches : []
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

function getCatchTeamId(c) {
  return Number(c.team ?? c.teamId ?? 0);
}

function getActiveTeams(data) {
  return data.teams.filter(t => t.active);
}

function getTeamById(data, teamId) {
  return data.teams.find(t => Number(t.id) === Number(teamId));
}

function getSectorDisplayName(data, sectorCode) {
  return data.sectors?.[sectorCode]?.name || sectorCode || "-";
}

function buildState(data) {
  const activeTeams = getActiveTeams(data);
  const activeTeamIds = new Set(activeTeams.map(t => Number(t.id)));

  const stats = {};
  const teamCatches = {};

  activeTeams.forEach(team => {
    stats[team.id] = {
      id: Number(team.id),
      name: team.name,
      sector: getSectorDisplayName(data, team.sector),
      sectorCode: team.sector,
      peg: team.peg,
      total: 0,
      count: 0,
      biggest: 0
    };
    teamCatches[team.id] = [];
  });

  data.catches.forEach((c) => {
    const teamId = getCatchTeamId(c);
    if (!activeTeamIds.has(teamId)) return;

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

  const leaderboard = Object.values(stats).sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (b.biggest !== a.biggest) return b.biggest - a.biggest;
    return a.id - b.id;
  });

  let topFish = null;

  data.catches.forEach((c) => {
    const teamId = getCatchTeamId(c);
    if (!activeTeamIds.has(teamId)) return;

    const weight = Number(c.weight || 0);
    const team = getTeamById(data, teamId);

    if (!topFish || weight > Number(topFish.weight || 0)) {
      topFish = {
        weight,
        team: team ? team.name : ("Tím " + teamId)
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
    totalFish
  };
}

/* ===============================
   ROUTES
================================ */

app.get("/", (req, res) => {
  res.redirect("/live.html");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/api/teams", (req, res) => {
  const data = loadData();
  const teams = getActiveTeams(data).map(t => ({
    id: t.id,
    name: t.name,
    sector: t.sector,
    sectorName: getSectorDisplayName(data, t.sector),
    peg: t.peg
  }));
  res.json(teams);
});

app.get("/api/sectors", (req, res) => {
  const data = loadData();
  res.json(data.sectors);
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
    A: {
      code: "A",
      name: String(incomingSectors?.A?.name || current.sectors.A.name || "Sektor A")
    },
    B: {
      code: "B",
      name: String(incomingSectors?.B?.name || current.sectors.B.name || "Sektor B")
    },
    C: {
      code: "C",
      name: String(incomingSectors?.C?.name || current.sectors.C.name || "Sektor C")
    },
    D: {
      code: "D",
      name: String(incomingSectors?.D?.name || current.sectors.D.name || "Sektor D")
    },
    E: {
      code: "E",
      name: String(incomingSectors?.E?.name || current.sectors.E.name || "Sektor E")
    }
  };

  const teams = Array.from({ length: 50 }, (_, index) => {
    const existing = incomingTeams.find(t => Number(t.id) === index + 1) || current.teams.find(t => Number(t.id) === index + 1) || {};
    return {
      id: index + 1,
      name: String(existing.name || `Tím ${index + 1}`),
      sector: ["A", "B", "C", "D", "E"].includes(existing.sector) ? existing.sector : "A",
      peg: String(existing.peg || (index + 1)),
      active: Boolean(existing.active)
    };
  });

  const data = {
    sectors,
    teams,
    catches: current.catches
  };

  saveData(data);
  res.json({ ok: true });
});

app.post("/api/admin/reset-catches", (req, res) => {
  const data = loadData();
  data.catches = [];
  saveData(data);
  res.json({ ok: true });
});

app.post("/api/catch", (req, res) => {
  const data = loadData();

  const teamValue = Number(req.body.team ?? req.body.teamId);
  const weightValue = Number(req.body.weight);

  if (!teamValue || !weightValue) {
    return res.status(400).json({ ok: false, error: "missing team or weight" });
  }

  const team = getTeamById(data, teamValue);
  if (!team || !team.active) {
    return res.status(400).json({ ok: false, error: "team is not active" });
  }

  data.catches.push({
    team: teamValue,
    weight: weightValue,
    photo: req.body.photo || null,
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
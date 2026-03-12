const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

const uploadDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const dataFile = path.join(__dirname, "data.json");
const ALL_SECTORS = ["A", "B", "C", "D", "E"];

function defaultData() {
  return {
    catches: [],
    settings: {
      activeSectors: ["A", "B", "C", "D", "E"],
      nextCatchNumber: 1
    },
    teams: Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      name: "Tím " + (i + 1),
      sector: ALL_SECTORS[Math.floor(i / 10)],
      peg: i + 1
    }))
  };
}

function loadData() {
  if (fs.existsSync(dataFile)) {
    try {
      const raw = fs.readFileSync(dataFile, "utf8");
      const parsed = JSON.parse(raw);

      return {
        catches: parsed.catches || [],
        teams: parsed.teams || defaultData().teams,
        settings: {
          activeSectors:
            parsed.settings?.activeSectors && parsed.settings.activeSectors.length
              ? parsed.settings.activeSectors
              : ["A", "B", "C", "D", "E"],
          nextCatchNumber:
            typeof parsed.settings?.nextCatchNumber === "number"
              ? parsed.settings.nextCatchNumber
              : ((parsed.catches?.length || 0) + 1)
        }
      };
    } catch (e) {
      console.log("Chyba pri načítaní data.json");
    }
  }

  return defaultData();
}

let loaded = loadData();
let catches = loaded.catches || [];
let teams = loaded.teams || [];
let settings = loaded.settings || {
  activeSectors: ["A", "B", "C", "D", "E"],
  nextCatchNumber: 1
};

function saveData() {
  fs.writeFileSync(
    dataFile,
    JSON.stringify({ catches, teams, settings }, null, 2),
    "utf8"
  );
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  }
});

const upload = multer({ storage });

app.use(express.static(path.join(__dirname, "public")));

// Hlavná adresa otvorí live tabuľku
app.get("/", (req, res) => {
  res.redirect("/live.html");
});

function getActiveSectors() {
  return settings.activeSectors || ["A", "B", "C", "D", "E"];
}

function leaderboard() {
  const active = getActiveSectors();

  return teams
    .filter(t => active.includes(t.sector))
    .map(t => {
      const c = catches.filter(x => x.teamId === t.id);
      const total = c.reduce((a, b) => a + b.weight, 0);
      const biggest = c.reduce((a, b) => Math.max(a, b.weight), 0);

      return {
        ...t,
        total,
        count: c.length,
        biggest
      };
    })
    .sort((a, b) => b.total - a.total || b.biggest - a.biggest);
}

function filteredLeaderboard(sector = "ALL") {
  const data = leaderboard();
  if (sector === "ALL") return data;
  return data.filter(t => t.sector === sector);
}

function sectorRankings() {
  const result = {};
  const active = getActiveSectors();

  const overallTop3 = leaderboard().slice(0, 3);
  const blockedIds = new Set(overallTop3.map(t => t.id));

  active.forEach(sector => {
    const raw = filteredLeaderboard(sector);
    let officialRank = 0;

    result[sector] = raw.map((t, i) => {
      let officialSectorRank = null;

      if (!blockedIds.has(t.id)) {
        officialRank += 1;
        officialSectorRank = officialRank;
      }

      return {
        ...t,
        rawRank: i + 1,
        sectorRank: officialSectorRank
      };
    });
  });

  return result;
}

function topFish() {
  const activeTeamIds = new Set(
    teams.filter(t => getActiveSectors().includes(t.sector)).map(t => t.id)
  );

  const filtered = catches.filter(c => activeTeamIds.has(c.teamId));
  if (filtered.length === 0) return null;

  let top = filtered[0];
  for (const c of filtered) {
    if (c.weight > top.weight) top = c;
  }

  const team = teams.find(t => t.id === top.teamId);

  return {
    number: top.number,
    weight: top.weight,
    team: team.name,
    sector: team.sector,
    peg: team.peg,
    photo: top.photo || null,
    time: top.time
  };
}

function recentCatches() {
  const activeTeamIds = new Set(
    teams.filter(t => getActiveSectors().includes(t.sector)).map(t => t.id)
  );

  return catches
    .filter(c => activeTeamIds.has(c.teamId))
    .slice(0, 12)
    .map(c => {
      const team = teams.find(t => t.id === c.teamId);
      return {
        number: c.number,
        weight: c.weight,
        team: team.name,
        sector: team.sector,
        peg: team.peg,
        photo: c.photo || null,
        time: c.time
      };
    });
}

function broadcast() {
  const data = JSON.stringify({
    lb: leaderboard(),
    topFish: topFish(),
    recent: recentCatches(),
    teams: teams,
    sectorRankings: sectorRankings(),
    activeSectors: getActiveSectors()
  });

  wss.clients.forEach(c => {
    if (c.readyState === 1) c.send(data);
  });
}

app.get("/teams", (req, res) => {
  res.json(teams);
});

app.get("/settings", (req, res) => {
  res.json(settings);
});

app.post("/settings/sectors", (req, res) => {
  const activeSectors = req.body.activeSectors;

  if (!Array.isArray(activeSectors) || activeSectors.length === 0) {
    return res.status(400).json({ ok: false, error: "bad sectors" });
  }

  const cleaned = activeSectors.filter(s => ALL_SECTORS.includes(s));

  if (!cleaned.length) {
    return res.status(400).json({ ok: false, error: "no valid sectors" });
  }

  settings.activeSectors = cleaned;
  saveData();
  broadcast();

  res.json({ ok: true });
});

app.post("/teams/update", (req, res) => {
  const { id, name, sector, peg } = req.body;

  const team = teams.find(t => t.id === Number(id));
  if (!team) {
    return res.status(404).json({ ok: false });
  }

  team.name = name;
  team.sector = sector;
  team.peg = Number(peg);

  saveData();
  broadcast();
  res.json({ ok: true });
});

app.post("/catch", upload.single("photo"), (req, res) => {
  const teamId = Number(req.body.team);
  const weight = Number(req.body.weight);

  if (!teamId || !weight) {
    return res.status(400).send("missing data");
  }

  const team = teams.find(t => t.id === teamId);
  if (!team || !getActiveSectors().includes(team.sector)) {
    return res.status(400).send("inactive sector");
  }

  const photo = req.file ? "/uploads/" + req.file.filename : null;

  catches.unshift({
    number: settings.nextCatchNumber,
    teamId,
    weight,
    photo,
    time: new Date().toISOString()
  });

  settings.nextCatchNumber += 1;

  saveData();
  broadcast();
  res.send("ok");
});

app.post("/reset", (req, res) => {
  catches = [];
  settings.nextCatchNumber = 1;
  saveData();
  broadcast();
  res.json({ ok: true });
});

app.get("/export/pdf", (req, res) => {
  const sector = req.query.sector || "ALL";
  const rows = filteredLeaderboard(sector);
  const top = topFish();

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="rcc-${sector.toLowerCase()}-vysledky.pdf"`
  );

  const doc = new PDFDocument({ margin: 40, size: "A4" });
  doc.pipe(res);

  doc.fontSize(20).text("RCC Ružín Carp Classic 2026", { align: "center" });
  doc.moveDown(0.5);

  const title = sector === "ALL" ? "Celkové poradie" : `Sektor ${sector}`;
  doc.fontSize(14).text(title, { align: "center" });
  doc.moveDown(0.5);

  doc.fontSize(10).text("Exportované: " + new Date().toLocaleString("sk-SK"));
  doc.moveDown(0.5);

  if (top) {
    doc.fontSize(11).text(
      `Najväčšia ryba preteku: ${top.weight.toFixed(2)} kg – ${top.team} – sektor ${top.sector} – stanovište ${top.peg}`
    );
  } else {
    doc.fontSize(11).text("Najväčšia ryba preteku: zatiaľ bez úlovku");
  }

  doc.moveDown(1);

  const startX = 40;
  let y = doc.y;

  const cols = {
    rank: startX,
    team: 75,
    sector: 240,
    peg: 290,
    total: 340,
    count: 410,
    biggest: 460
  };

  doc.fontSize(10);
  doc.text("#", cols.rank, y);
  doc.text("Tím", cols.team, y);
  doc.text("Sektor", cols.sector, y);
  doc.text("Stan.", cols.peg, y);
  doc.text("kg", cols.total, y);
  doc.text("Kusy", cols.count, y);
  doc.text("Najväčšia", cols.biggest, y);

  y += 18;
  doc.moveTo(startX, y - 4).lineTo(555, y - 4).stroke();

  rows.forEach((r, i) => {
    if (y > 760) {
      doc.addPage();
      y = 50;
    }

    doc.text(String(i + 1), cols.rank, y);
    doc.text(r.name, cols.team, y, { width: 150 });
    doc.text(r.sector, cols.sector, y);
    doc.text(String(r.peg), cols.peg, y);
    doc.text(r.total.toFixed(2), cols.total, y);
    doc.text(String(r.count), cols.count, y);
    doc.text(r.biggest.toFixed(2), cols.biggest, y);

    y += 18;
  });

  doc.end();
});

wss.on("connection", ws => {
  ws.send(JSON.stringify({
    lb: leaderboard(),
    topFish: topFish(),
    recent: recentCatches(),
    teams: teams,
    sectorRankings: sectorRankings(),
    activeSectors: getActiveSectors()
  }));
});

const PORT = process.env.PORT || 5173;

server.listen(PORT, () => {
  console.log("Server beží na porte " + PORT);
});
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DATA_FILE = path.join(__dirname, "data.json");

/* ===============================
   ZOZNAM TÍMOV
================================ */

const teams = {
  1: { name: "CT Mr. Fishing I.", sector: "Palkov", peg: "Palkov 1" },
  2: { name: "CT Zemník – Bodovka Slovakia", sector: "Palkov", peg: "Palkov 2" },
  3: { name: "CT MIKBAITS SK", sector: "Kamenec", peg: "Kamenec 4" },
  4: { name: "CT Starfishing / Munch Baits", sector: "Hôrka", peg: "Hôrka 1" },
  5: { name: "CT Squama / MsO SRZ Lučenec", sector: "Palkov", peg: "Palkov 3" },
  6: { name: "CT Carp Servis Václavík II.", sector: "Palkov", peg: "Palkov 7" },
  7: { name: "CT AKBAITS III. Karp Klub Bytom", sector: "Palkov", peg: "Palkov 5" },
  8: { name: "CT Dr. Baits I.", sector: "Kamenec", peg: "Kamenec 5" },
  9: { name: "CT Fishing Star CZ", sector: "Palkov", peg: "Palkov 4" },

  10: { name: "Tím 10", sector: "A", peg: "10" },
  11: { name: "Tím 11", sector: "A", peg: "11" },
  12: { name: "Tím 12", sector: "A", peg: "12" },
  13: { name: "Tím 13", sector: "B", peg: "13" },
  14: { name: "Tím 14", sector: "B", peg: "14" },
  15: { name: "Tím 15", sector: "B", peg: "15" },
  16: { name: "Tím 16", sector: "B", peg: "16" },
  17: { name: "Tím 17", sector: "C", peg: "17" },
  18: { name: "Tím 18", sector: "C", peg: "18" },
  19: { name: "Tím 19", sector: "C", peg: "19" },
  20: { name: "Tím 20", sector: "C", peg: "20" },
  21: { name: "Tím 21", sector: "C", peg: "21" },
  22: { name: "Tím 22", sector: "C", peg: "22" },
  23: { name: "Tím 23", sector: "C", peg: "23" },
  24: { name: "Tím 24", sector: "C", peg: "24" },
  25: { name: "Tím 25", sector: "C", peg: "25" },
  26: { name: "Tím 26", sector: "C", peg: "26" },
  27: { name: "Tím 27", sector: "C", peg: "27" },
  28: { name: "Tím 28", sector: "C", peg: "28" }
};

/* ===============================
   POMOCNÉ FUNKCIE
================================ */

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { catches: [] };
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed.catches || !Array.isArray(parsed.catches)) {
      return { catches: [] };
    }

    return parsed;
  } catch (e) {
    return { catches: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

function getCatchTeamId(c) {
  return Number(c.team ?? c.teamId ?? 0);
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

/* ===============================
   ZÁPIS ÚLOVKU
================================ */

app.post("/api/catch", (req, res) => {
  const data = loadData();

  const teamValue = Number(req.body.team ?? req.body.teamId);
  const weightValue = Number(req.body.weight);

  if (!teamValue || !weightValue) {
    return res.status(400).json({ ok: false, error: "missing team or weight" });
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

/* ===============================
   LIVE STAV
================================ */

app.get("/api/state", (req, res) => {
  const data = loadData();

  const stats = {};
  const teamCatches = {};

  data.catches.forEach((c) => {
    const teamId = getCatchTeamId(c);
    if (!teamId) return;

    if (!stats[teamId]) {
      stats[teamId] = {
        id: teamId,
        name: teams[teamId]?.name || ("Tím " + teamId),
        sector: teams[teamId]?.sector || "-",
        peg: teams[teamId]?.peg || "-",
        total: 0,
        count: 0,
        biggest: 0
      };
    }

    stats[teamId].total += Number(c.weight || 0);
    stats[teamId].count += 1;

    if (Number(c.weight || 0) > stats[teamId].biggest) {
      stats[teamId].biggest = Number(c.weight || 0);
    }

    if (!teamCatches[teamId]) {
      teamCatches[teamId] = [];
    }

    teamCatches[teamId].push({
      number: teamCatches[teamId].length + 1,
      weight: Number(c.weight || 0),
      photo: c.photo || null,
      time: c.time || null
    });
  });

  const leaderboard = Object.values(stats).sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return b.biggest - a.biggest;
  });

  let topFish = null;

  data.catches.forEach((c) => {
    const teamId = getCatchTeamId(c);
    const weight = Number(c.weight || 0);

    if (!topFish || weight > Number(topFish.weight || 0)) {
      topFish = {
        weight,
        team: teams[teamId]?.name || ("Tím " + teamId)
      };
    }
  });

  const totalWeight = data.catches.reduce((sum, c) => sum + Number(c.weight || 0), 0);
  const totalFish = data.catches.length;

  res.json({
    lb: leaderboard,
    teamCatches,
    topFish,
    totalWeight,
    totalFish
  });
});

/* ===============================
   SERVER
================================ */

app.listen(PORT, () => {
  console.log("Server beží na porte", PORT);
});
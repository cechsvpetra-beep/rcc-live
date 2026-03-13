const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DATA_FILE = path.join(__dirname, "data.json");


/* =========================
   ZOZNAM TÍMOV
========================= */

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


/* =========================
   DATA FUNCTIONS
========================= */

function loadData() {

  if (!fs.existsSync(DATA_FILE)) {
    return { catches: [] };
  }

  return JSON.parse(fs.readFileSync(DATA_FILE));

}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}


/* =========================
   ZÁPIS ÚLOVKU
========================= */

app.post("/api/catch", (req, res) => {

  const data = loadData();

  data.catches.push({
    team: req.body.team,
    weight: Number(req.body.weight),
    photo: req.body.photo || null,
    time: new Date().toISOString()
  });

  saveData(data);

  res.json({ status: "ok" });

});


/* =========================
   LIVE DATA
========================= */

app.get("/api/state", (req, res) => {

  const data = loadData();

  const teamStats = {};

  data.catches.forEach(c => {

    if (!teamStats[c.team]) {

      teamStats[c.team] = {
        id: c.team,
        name: teams[c.team]?.name || ("Tím " + c.team),
        sector: teams[c.team]?.sector || "-",
        peg: teams[c.team]?.peg || "-",
        total: 0,
        count: 0,
        biggest: 0
      };

    }

    teamStats[c.team].total += Number(c.weight);
    teamStats[c.team].count++;

    if (Number(c.weight) > teamStats[c.team].biggest) {
      teamStats[c.team].biggest = Number(c.weight);
    }

  });


  /* leaderboard */

  const leaderboard = Object.values(teamStats)
    .sort((a,b) => b.total - a.total);


  /* úlovky tímu */

  const teamCatches = {};

  data.catches.forEach(c => {

    if (!teamCatches[c.team]) {
      teamCatches[c.team] = [];
    }

    teamCatches[c.team].push({
      weight: c.weight,
      photo: c.photo,
      time: c.time
    });

  });


  /* najväčšia ryba */

  let topFish = null;

  data.catches.forEach(c => {

    if (!topFish || Number(c.weight) > Number(topFish.weight)) {

      topFish = {
        weight: c.weight,
        team: teams[c.team]?.name || ("Tím " + c.team)
      };

    }

  });


  /* celkové štatistiky */

  const totalWeight = data.catches.reduce((sum,c) => sum + Number(c.weight),0);
  const totalFish = data.catches.length;


  res.json({

    lb: leaderboard,
    teamCatches: teamCatches,
    topFish: topFish,
    totalWeight: totalWeight,
    totalFish: totalFish

  });

});


/* =========================
   SERVER
========================= */

app.listen(PORT, () => {
  console.log("Server beží na porte", PORT);
});
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// statické stránky
app.use(express.static(path.join(__dirname, "public")));

const DATA_FILE = path.join(__dirname, "data.json");

// načítanie dát
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { catches: [] };
  }
  return JSON.parse(fs.readFileSync(DATA_FILE));
}

// uloženie dát
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// uloženie úlovku
app.post("/api/catch", (req, res) => {
  const data = loadData();

  data.catches.push({
    ...req.body,
    time: new Date().toISOString()
  });

  saveData(data);

  res.json({ status: "ok" });
});

// live stav
app.get("/api/state", (req, res) => {

  const data = loadData();

  const teams = {};

  data.catches.forEach(c => {

    if (!teams[c.team]) {
      teams[c.team] = {
        id: c.team,
        name: "Tím " + c.team,
        sector: "-",
        peg: "-",
        total: 0,
        count: 0,
        biggest: 0
      };
    }

    teams[c.team].total += Number(c.weight);
    teams[c.team].count++;

    if (Number(c.weight) > teams[c.team].biggest) {
      teams[c.team].biggest = Number(c.weight);
    }

  });

  const leaderboard = Object.values(teams)
    .sort((a,b) => b.total - a.total);

  const teamCatches = {};

  data.catches.forEach(c => {

    if (!teamCatches[c.team]) {
      teamCatches[c.team] = [];
    }

    teamCatches[c.team].push({
      number: teamCatches[c.team].length + 1,
      weight: c.weight,
      photo: c.photo || null,
      time: c.time
    });

  });

  let topFish = null;

  data.catches.forEach(c => {

    if (!topFish || Number(c.weight) > Number(topFish.weight)) {
      topFish = {
        weight: c.weight,
        team: "Tím " + c.team
      };
    }

  });

  res.json({
    lb: leaderboard,
    teamCatches: teamCatches,
    topFish: topFish
  });

});

app.listen(PORT, () => {
  console.log("Server beží na porte", PORT);
});
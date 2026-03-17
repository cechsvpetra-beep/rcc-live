const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 10000;

/* =====================
   SESSION (LOGIN)
===================== */

app.use(session({
    secret: "rcc_secret_123",
    resave: false,
    saveUninitialized: false
}));

/* =====================
   USERS
===================== */

const USERS = [
    { username: "admin", password: "admin123", role: "admin" },
    { username: "judge1", password: "1234", role: "judge" },
    { username: "judge2", password: "1234", role: "judge" }
];

/* =====================
   MIDDLEWARE
===================== */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* =====================
   LOGIN API
===================== */

app.post("/api/login", (req, res) => {
    const { username, password } = req.body;

    const user = USERS.find(u =>
        u.username === username && u.password === password
    );

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

/* =====================
   AUTH GUARD
===================== */

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

/* =====================
   PROTECTED PAGES
===================== */

app.get("/admin.html", requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, "public/admin.html"));
});

app.get("/judge.html", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "public/judge.html"));
});

/* =====================
   DATA STORAGE
===================== */

const DATA_FILE = path.join(__dirname, "data.json");

function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        return {
            teams: [],
            catches: []
        };
    }
    return JSON.parse(fs.readFileSync(DATA_FILE));
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/* =====================
   UPLOAD (FOTO)
===================== */

const storage = multer.diskStorage({
    destination: "public/uploads",
    filename: (req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({ storage });

/* =====================
   ADD CATCH
===================== */

app.post("/api/catch", requireLogin, upload.single("photo"), (req, res) => {
    const data = loadData();

    const { teamId, weight } = req.body;

    const newCatch = {
        id: Date.now(),
        teamId: Number(teamId),
        weight: Number(weight),
        time: new Date().toISOString(),
        photo: req.file ? "/uploads/" + req.file.filename : null
    };

    data.catches.push(newCatch);
    saveData(data);

    res.json({ ok: true });
});

/* =====================
   STATE (LIVE DATA)
===================== */

app.get("/api/state", (req, res) => {
    const data = loadData();

    const teams = data.teams || [];
    const catches = data.catches || [];

    const lb = teams.map(team => {
        const teamCatches = catches.filter(c => c.teamId === team.id);

        const total = teamCatches.reduce((s, c) => s + c.weight, 0);

        const biggest = teamCatches.length
            ? Math.max(...teamCatches.map(c => c.weight))
            : 0;

        const sorted = [...teamCatches]
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 3)
            .map(c => c.weight);

        while (sorted.length < 3) sorted.push(0);

        const top3sum = sorted.reduce((a, b) => a + b, 0);

        return {
            id: team.id,
            name: team.name,
            sector: team.sector,
            peg: team.peg,
            total,
            count: teamCatches.length,
            biggest,
            top3: sorted,
            top3sum
        };
    });

    lb.sort((a, b) => b.total - a.total);

    const topFish = catches.length
        ? catches.reduce((max, c) => c.weight > max.weight ? c : max)
        : null;

    res.json({
        lb,
        totalWeight: lb.reduce((s, t) => s + t.total, 0),
        totalFish: catches.length,
        topFish: topFish
            ? {
                weight: topFish.weight,
                team: teams.find(t => t.id === topFish.teamId)?.name || ""
            }
            : null,
        teamCatches: Object.fromEntries(
            teams.map(t => [
                t.id,
                catches.filter(c => c.teamId === t.id)
            ])
        ),
        top3teams: [...lb].sort((a, b) => b.top3sum - a.top3sum)
    });
});

/* =====================
   ADMIN SETUP
===================== */

app.get("/api/admin/setup", requireAdmin, (req, res) => {
    const data = loadData();
    res.json(data);
});

app.post("/api/admin/setup", requireAdmin, (req, res) => {
    saveData(req.body);
    res.json({ ok: true });
});

/* =====================
   START SERVER
===================== */

app.listen(PORT, () => {
    console.log("Server beží na porte", PORT);
});
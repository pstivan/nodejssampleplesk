// app.js — CommonJS (Passenger-friendly) Node app
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const APP_ROOT = process.env.APP_ROOT || __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(APP_ROOT, "data");
const PUBLIC_DIR = path.join(APP_ROOT, "public");
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(PUBLIC_DIR, "uploads");
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
// Simple file DB (JSON)
const DB_FILE = path.join(DATA_DIR, "db.json");
async function ensureDataDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  // create db.json if missing
  if (!fsSync.existsSync(DB_FILE)) {
    const initial = { users: [], tasks: [] };
    await fs.writeFile(DB_FILE, JSON.stringify(initial, null, 2), "utf8");
  }
}
async function readDB() {
  const raw = await fs.readFile(DB_FILE, "utf8");
  return JSON.parse(raw);
}
async function writeDB(data) {
  await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), "utf8");
}
const upload = multer({ dest: path.join(APP_ROOT, "tmp_uploads") });
async function start() {
  try {
    await ensureDataDirs();
  } catch (err) {
    console.error("Failed to prepare data directories:", err);
    process.exit(1);
  }
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(morgan("dev"));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  // Serve public static files
  app.use(express.static(PUBLIC_DIR));
  // --- Auth helpers ---
  function signToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
  }
  async function requireAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) return res.status(401).json({ error: "Missing token" });
    const token = auth.split(" ")[1];
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const db = await readDB();
      const user = db.users.find((u) => u.id === payload.id);
      if (!user) return res.status(401).json({ error: "Invalid token (user not found)" });
      req.user = { id: user.id, username: user.username };
      next();
    } catch (err) {
      return res.status(401).json({ error: "Invalid token" });
    }
  }
  // --- Routes: Auth ---
  app.post("/api/auth/register", async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "username and password required" });
    const db = await readDB();
    if (db.users.find((u) => u.username === username)) return res.status(409).json({ error: "username taken" });
    const hashed = await bcrypt.hash(password, 8);
    const user = { id: uuidv4(), username, password: hashed, createdAt: Date.now() };
    db.users.push(user);
    await writeDB(db);
    const token = signToken({ id: user.id });
    res.json({ token, user: { id: user.id, username: user.username } });
  });
  app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "username and password required" });
    const db = await readDB();
    const user = db.users.find((u) => u.username === username);
    if (!user) return res.status(401).json({ error: "invalid credentials" });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: "invalid credentials" });
    const token = signToken({ id: user.id });
    res.json({ token, user: { id: user.id, username: user.username } });
  });
  // --- Routes: Tasks ---
  app.get("/api/tasks", requireAuth, async (req, res) => {
    const db = await readDB();
    const tasks = db.tasks.filter((t) => t.userId === req.user.id);
    res.json(tasks);
  });
  app.post("/api/tasks", requireAuth, upload.single("attachment"), async (req, res) => {
    const { title = "", description = "" } = req.body || {};
    const db = await readDB();
    const task = {
      id: uuidv4(),
      title,
      description,
      userId: req.user.id,
      createdAt: Date.now(),
      attachment: null
    };
    if (req.file) {
      // Move tmp upload into public uploads folder under user id
      const userDir = path.join(UPLOADS_DIR, req.user.id);
      await fs.mkdir(userDir, { recursive: true });
      const target = path.join(userDir, req.file.originalname);
      await fs.rename(req.file.path, target);
      task.attachment = `/uploads/${req.user.id}/${req.file.originalname}`;
    }
    db.tasks.push(task);
    await writeDB(db);
    res.status(201).json(task);
  });
  app.put("/api/tasks/:id", requireAuth, async (req, res) => {
    const id = req.params.id;
    const { title, description } = req.body || {};
    const db = await readDB();
    const task = db.tasks.find((t) => t.id === id && t.userId === req.user.id);
    if (!task) return res.status(404).json({ error: "not found" });
    if (title !== undefined) task.title = title;
    if (description !== undefined) task.description = description;
    task.updatedAt = Date.now();
    await writeDB(db);
    res.json(task);
  });
  app.delete("/api/tasks/:id", requireAuth, async (req, res) => {
    const id = req.params.id;
    const db = await readDB();
    const idx = db.tasks.findIndex((t) => t.id === id && t.userId === req.user.id);
    if (idx === -1) return res.status(404).json({ error: "not found" });
    const [deleted] = db.tasks.splice(idx, 1);
    await writeDB(db);
    res.json({ ok: true, deleted });
  });
  // Health
  app.get("/api/health", (req, res) => res.json({ ok: true, env: process.env.NODE_ENV || "production" }));
  // SPA fallback
  app.get("*", (req, res) => {
    const index = path.join(PUBLIC_DIR, "index.html");
    if (fsSync.existsSync(index)) return res.sendFile(index);
    res.status(404).send("404 - Not Found (no index.html)");
  });
  app.use((err, req, res, next) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Server error" });
  });
  app.listen(PORT, HOST, () => {
    console.log(`Server listening on http://${HOST}:${PORT}`);
    console.log(`Public dir: ${PUBLIC_DIR}`);
    console.log(`DB file: ${DB_FILE}`);
  });
}
// start the server (no top-level await)
start().catch((err) => {
  console.error("Failed to start app:", err);
  process.exit(1);
});

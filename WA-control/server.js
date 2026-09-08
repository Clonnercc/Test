require("dotenv").config();

const express = require("express");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Client, LocalAuth } = require("whatsapp-web.js");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";
const ROOT = process.env.PERSISTENT_ROOT || path.join(__dirname, "storage");
const DATA_DIR = path.join(ROOT, "data");
const AUTH_DIR = path.join(ROOT, "whatsapp");
const PUBLIC_DIR = path.join(__dirname, "public");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(AUTH_DIR, { recursive: true });

const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

if (!fs.existsSync(CONFIG_FILE)) {
  writeJson(CONFIG_FILE, {
    campaignName: "Minha campanha",
    message: "",
    numbers: [],
    intervalSeconds: 30,
    requireOptIn: true
  });
}
if (!fs.existsSync(HISTORY_FILE)) writeJson(HISTORY_FILE, []);

let config = readJson(CONFIG_FILE, {
  campaignName: "Minha campanha",
  message: "",
  numbers: [],
  intervalSeconds: 30,
  requireOptIn: true
});
let history = readJson(HISTORY_FILE, []);

const state = {
  ready: false,
  initializing: false,
  qr: null,
  status: "Iniciando WhatsApp...",
  sending: false,
  paused: false,
  current: null,
  sent: 0,
  failed: 0
};

let queue = [];
let client = null;

const PANEL_USER = process.env.PAINEL_USUARIO || "admin";
const PANEL_PASSWORD = process.env.PAINEL_SENHA || "admin123";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-secret-in-render";

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function makeToken(username) {
  const payload = `${username}|${Date.now()}`;
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}|${signature}`).toString("base64url");
}

function validToken(token) {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parts = decoded.split("|");
    if (parts.length !== 3) return false;
    const [username, timestamp, signature] = parts;
    if (!safeEqual(username, PANEL_USER)) return false;
    const age = Date.now() - Number(timestamp);
    if (!Number.isFinite(age) || age < 0 || age > 8 * 60 * 60 * 1000) return false;
    const expected = crypto.createHmac("sha256", SESSION_SECRET)
      .update(`${username}|${timestamp}`)
      .digest("hex");
    return safeEqual(signature, expected);
  } catch (_) {
    return false;
  }
}

function getCookie(req, name) {
  const header = req.headers.cookie || "";
  const found = header.split(";").map(x => x.trim()).find(x => x.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

function auth(req, res, next) {
  const token = getCookie(req, "wa_auth");
  if (token && validToken(token)) return next();
  return res.status(401).json({ error: "Não autenticado." });
}

function addHistory(item) {
  history.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, time: new Date().toISOString(), ...item });
  if (history.length > 5000) history = history.slice(-5000);
  writeJson(HISTORY_FILE, history);
}

function normalizeNumber(value) {
  let number = String(value || "").replace(/\D/g, "");
  if (number.length === 10 || number.length === 11) number = `55${number}`;
  return number.length >= 12 && number.length <= 15 ? `${number}@c.us` : null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processQueue() {
  while (state.sending && queue.length) {
    if (state.paused) {
      await sleep(1000);
      continue;
    }

    const raw = queue.shift();
    const chatId = normalizeNumber(raw);
    state.current = raw;

    if (!chatId) {
      state.failed++;
      addHistory({ number: raw, status: "erro", detail: "Número inválido" });
      continue;
    }

    try {
      const registered = await client.isRegisteredUser(chatId);
      if (!registered) throw new Error("Número não registrado no WhatsApp.");
      const text = config.message.replaceAll("{numero}", String(raw));
      await client.sendMessage(chatId, text);
      state.sent++;
      addHistory({ number: raw, status: "enviado", detail: "Mensagem enviada" });
    } catch (error) {
      state.failed++;
      addHistory({ number: raw, status: "erro", detail: error?.message || "Falha ao enviar" });
    }

    if (queue.length && state.sending) await sleep(config.intervalSeconds * 1000);
  }

  if (state.sending) {
    state.sending = false;
    state.current = null;
    state.status = "Campanha concluída";
  }
}

async function createWhatsAppClient() {
  if (client) return client;
  client = new Client({
    authStrategy: new LocalAuth({ clientId: "wa-control", dataPath: AUTH_DIR }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--disable-extensions"
      ]
    }
  });

  client.on("qr", async qr => {
    state.qr = await QRCode.toDataURL(qr);
    state.ready = false;
    state.initializing = false;
    state.status = "Aguardando leitura do QR Code";
  });
  client.on("authenticated", () => {
    state.qr = null;
    state.status = "WhatsApp autenticado";
  });
  client.on("ready", () => {
    state.qr = null;
    state.ready = true;
    state.initializing = false;
    state.status = "WhatsApp conectado";
  });
  client.on("auth_failure", message => {
    state.ready = false;
    state.initializing = false;
    state.status = `Falha de autenticação: ${message}`;
  });
  client.on("disconnected", reason => {
    state.ready = false;
    state.status = `WhatsApp desconectado: ${reason || "sem motivo informado"}`;
  });

  return client;
}

async function initializeWhatsApp() {
  if (state.initializing || state.ready) return;
  state.initializing = true;
  state.status = "Inicializando WhatsApp Web...";
  try {
    const wa = await createWhatsAppClient();
    await wa.initialize();
  } catch (error) {
    state.initializing = false;
    state.status = `Erro ao iniciar WhatsApp: ${error?.message || error}`;
    console.error(error);
  }
}

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

app.get("/health", (req, res) => {
  res.json({ ok: true, status: state.status, whatsappReady: state.ready });
});

app.post("/api/login", (req, res) => {
  const username = String(req.body?.username || "");
  const password = String(req.body?.password || "");
  if (!safeEqual(username, PANEL_USER) || !safeEqual(password, PANEL_PASSWORD)) {
    return res.status(401).json({ error: "Usuário ou senha inválidos." });
  }
  const token = makeToken(username);
  res.setHeader("Set-Cookie", `wa_auth=${encodeURIComponent(token)}; Max-Age=28800; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  return res.json({ ok: true });
});

app.post("/api/logout", auth, (req, res) => {
  res.setHeader("Set-Cookie", "wa_auth=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax");
  res.json({ ok: true });
});

app.get("/api/state", auth, (req, res) => {
  res.json({ ...state, numbers: config.numbers.length });
});

app.get("/api/config", auth, (req, res) => res.json(config));
app.get("/api/history", auth, (req, res) => res.json(history.slice(-500).reverse()));

app.post("/api/config", auth, (req, res) => {
  const numbers = Array.isArray(req.body?.numbers)
    ? [...new Set(req.body.numbers.map(x => String(x).trim()).filter(Boolean))]
    : [];

  config = {
    campaignName: String(req.body?.campaignName || "Minha campanha").slice(0, 100),
    message: String(req.body?.message || ""),
    numbers,
    intervalSeconds: Math.max(15, Math.min(3600, Number(req.body?.intervalSeconds) || 30)),
    requireOptIn: req.body?.requireOptIn !== false
  };
  writeJson(CONFIG_FILE, config);
  res.json({ ok: true, config });
});

app.post("/api/connect", auth, async (req, res) => {
  initializeWhatsApp().catch(console.error);
  res.json({ ok: true, message: "Inicialização solicitada." });
});

app.post("/api/start", auth, (req, res) => {
  if (!state.ready) return res.status(400).json({ error: "Conecte o WhatsApp primeiro." });
  if (!config.requireOptIn) return res.status(400).json({ error: "Confirme o opt-in dos contatos." });
  if (!config.message.trim()) return res.status(400).json({ error: "Informe a mensagem." });
  if (!config.numbers.length) return res.status(400).json({ error: "Adicione números." });
  if (state.sending) return res.status(400).json({ error: "Já existe uma campanha em execução." });

  queue = [...config.numbers];
  state.sending = true;
  state.paused = false;
  state.current = null;
  state.sent = 0;
  state.failed = 0;
  state.status = "Campanha em execução";
  processQueue().catch(error => {
    state.sending = false;
    state.status = `Erro na campanha: ${error?.message || error}`;
    console.error(error);
  });
  res.json({ ok: true });
});

app.post("/api/pause", auth, (req, res) => {
  if (state.sending) {
    state.paused = !state.paused;
    state.status = state.paused ? "Campanha pausada" : "Campanha em execução";
  }
  res.json({ ok: true });
});

app.post("/api/stop", auth, (req, res) => {
  queue = [];
  state.sending = false;
  state.paused = false;
  state.current = null;
  state.status = "Campanha parada";
  res.json({ ok: true });
});

app.use(express.static(PUBLIC_DIR));
app.use((req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

app.listen(PORT, HOST, () => {
  console.log(`WA Control ouvindo em http://${HOST}:${PORT}`);
  initializeWhatsApp().catch(console.error);
});

#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR_DEFAULT = path.join(ROOT, "data");

const RESPONSE_CHOICES = {
  okay_whats_next: "okay whats next",
  lets_do_that: "lets do that"
};

main().catch((error) => {
  logError(error);
  process.exitCode = 1;
});

async function main() {
  loadEnvFile(path.join(ROOT, ".env"));
  const [command = "help", ...args] = process.argv.slice(2);

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "setup") {
    await setup();
    return;
  }

  if (command === "hook") {
    await handleHook();
    return;
  }

  if (command === "notify") {
    await handleNotify(args);
    return;
  }

  if (command === "server") {
    await startServer();
    return;
  }

  if (command === "replies") {
    printRecent("replies.jsonl");
    return;
  }

  if (command === "tasks") {
    printRecent("tasks.jsonl");
    return;
  }

  if (command === "reply") {
    await recordReplyFromCli(args);
    return;
  }

  if (command === "run") {
    await runAndNotify(args);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function config() {
  const env = process.env;
  const port = Number(env.WATCH_BRIDGE_PORT || "8765");
  const host = env.WATCH_BRIDGE_HOST || "127.0.0.1";
  const publicUrl = trimTrailingSlash(
    env.WATCH_BRIDGE_PUBLIC_URL || `http://${host}:${port}`
  );
  const homeAssistantUrl = trimTrailingSlash(env.HOME_ASSISTANT_URL || "");
  const provider =
    env.WATCH_BRIDGE_PROVIDER ||
    (homeAssistantUrl && env.HOME_ASSISTANT_TOKEN ? "home-assistant" : "pushcut");

  return {
    provider,
    pushcutWebhookUrl: env.PUSHCUT_WEBHOOK_URL || "",
    homeAssistantUrl,
    homeAssistantToken: env.HOME_ASSISTANT_TOKEN || "",
    homeAssistantNotifyService: env.HOME_ASSISTANT_NOTIFY_SERVICE || "",
    homeAssistantInterruptionLevel:
      env.HOME_ASSISTANT_INTERRUPTION_LEVEL || "time-sensitive",
    publicUrl,
    token: env.WATCH_BRIDGE_TOKEN || "",
    host,
    port,
    dataDir: env.WATCH_BRIDGE_DATA_DIR || DATA_DIR_DEFAULT,
    pushcutSound: env.PUSHCUT_SOUND || "jobDone",
    pushcutTimeSensitive: parseBoolean(env.PUSHCUT_TIME_SENSITIVE, true),
    autoResume: parseBoolean(env.WATCH_BRIDGE_AUTO_RESUME, false),
    codexBin:
      env.CODEX_BIN || "/Applications/Codex.app/Contents/Resources/codex"
  };
}

async function setup() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) {
    const token = crypto.randomBytes(24).toString("hex");
    const example = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
    fs.writeFileSync(envPath, example.replace("WATCH_BRIDGE_TOKEN=change-me", `WATCH_BRIDGE_TOKEN=${token}`));
    fs.chmodSync(envPath, 0o600);
    console.log(`Created ${envPath}`);
  } else {
    console.log(`${envPath} already exists`);
  }

  console.log("");
  console.log("Next:");
  console.log("1. Choose pushcut or home-assistant in .env");
  console.log("2. Run: npm run server");
  console.log("3. In Codex, open /hooks and trust the WatchDex hook");
  console.log("4. Run: npm run test-notify");
}

async function handleHook() {
  const cfg = config();
  ensureDataDir(cfg.dataDir);

  const rawInput = await readStdin();
  const payload = parseMaybeJson(rawInput);
  const cwd = process.cwd();
  const projectName = path.basename(cwd) || "Codex";
  const sessionId = findFirstKey(payload, [
    "sessionId",
    "session_id",
    "threadId",
    "thread_id",
    "conversationId",
    "conversation_id"
  ]);

  const title = `Codex done: ${projectName}`;
  const text = buildTaskMessage(payload);
  const task = createTask({
    source: "codex-stop-hook",
    title,
    text,
    cwd,
    sessionId,
    hookPayload: summarizePayload(payload),
    rawHookInputBytes: Buffer.byteLength(rawInput || "")
  });

  appendJsonl(cfg.dataDir, "tasks.jsonl", task);
  await sendWatchNotification(cfg, task);
}

async function handleNotify(args) {
  const cfg = config();
  ensureDataDir(cfg.dataDir);
  const flags = parseFlags(args);
  const task = createTask({
    source: "manual-notify",
    title: flags.title || "Codex done",
    text: flags.text || flags.body || "Task completed",
    cwd: flags.cwd || process.cwd(),
    sessionId: flags.session || flags.sessionId || ""
  });

  appendJsonl(cfg.dataDir, "tasks.jsonl", task);
  await sendWatchNotification(cfg, task);
}

async function sendWatchNotification(cfg, task) {
  const event = {
    at: new Date().toISOString(),
    type: "notification-attempt",
    taskId: task.id,
    provider: cfg.provider,
    hasPushcutWebhook: Boolean(cfg.pushcutWebhookUrl),
    hasHomeAssistant: Boolean(
      cfg.homeAssistantUrl &&
      cfg.homeAssistantToken &&
      cfg.homeAssistantNotifyService
    )
  };

  if (cfg.provider === "home-assistant") {
    await sendHomeAssistantNotification(cfg, task, event);
    return;
  }

  if (!cfg.pushcutWebhookUrl) {
    appendJsonl(cfg.dataDir, "events.jsonl", {
      ...event,
      skipped: true,
      reason: "PUSHCUT_WEBHOOK_URL is not configured"
    });
    return;
  }

  const body = buildPushcutBody(cfg, task);
  const response = await fetch(cfg.pushcutWebhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  const responseText = await response.text();
  appendJsonl(cfg.dataDir, "events.jsonl", {
    ...event,
    status: response.status,
    ok: response.ok,
    response: responseText.slice(0, 500)
  });

  if (!response.ok) {
    throw new Error(`Pushcut returned HTTP ${response.status}: ${responseText}`);
  }
}

async function sendHomeAssistantNotification(cfg, task, event) {
  if (!cfg.homeAssistantUrl || !cfg.homeAssistantToken || !cfg.homeAssistantNotifyService) {
    appendJsonl(cfg.dataDir, "events.jsonl", {
      ...event,
      skipped: true,
      reason:
        "HOME_ASSISTANT_URL, HOME_ASSISTANT_TOKEN, and HOME_ASSISTANT_NOTIFY_SERVICE are required"
    });
    return;
  }

  const service = parseHomeAssistantNotifyService(cfg.homeAssistantNotifyService);
  const response = await fetch(`${cfg.homeAssistantUrl}/api/services/${service.domain}/${service.name}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.homeAssistantToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(buildHomeAssistantBody(cfg, task))
  });

  const responseText = await response.text();
  appendJsonl(cfg.dataDir, "events.jsonl", {
    ...event,
    status: response.status,
    ok: response.ok,
    response: responseText.slice(0, 500)
  });

  if (!response.ok) {
    throw new Error(`Home Assistant returned HTTP ${response.status}: ${responseText}`);
  }
}

function buildPushcutBody(cfg, task) {
  const actionPayloads = [
    ["Okay, what's next", "okay_whats_next"],
    ["Let's do that", "lets_do_that"]
  ];

  const actions = actionPayloads.map(([name, choice]) => {
    const prompt = RESPONSE_CHOICES[choice];
    const url = new URL(`${cfg.publicUrl}/reply`);
    url.searchParams.set("token", cfg.token);
    url.searchParams.set("taskId", task.id);
    url.searchParams.set("choice", choice);

    return {
      name,
      input: prompt,
      url: url.toString(),
      urlBackgroundOptions: {
        httpMethod: "POST",
        httpContentType: "application/json",
        httpBody: JSON.stringify({
          token: cfg.token,
          taskId: task.id,
          choice,
          prompt
        })
      }
    };
  });

  return {
    title: task.title,
    text: task.text,
    sound: cfg.pushcutSound,
    isTimeSensitive: cfg.pushcutTimeSensitive,
    threadId: "watchdex",
    id: task.id,
    input: JSON.stringify({
      taskId: task.id,
      cwd: task.cwd,
      sessionId: task.sessionId || ""
    }),
    actions
  };
}

function buildHomeAssistantBody(cfg, task) {
  const safeTaskId = task.id.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
  const actionPayloads = [
    {
      action: `WATCHDEX_OKAY_${safeTaskId}`,
      title: "Okay, what's next",
      choice: "okay_whats_next"
    },
    {
      action: `WATCHDEX_DO_THAT_${safeTaskId}`,
      title: "Let's do that",
      choice: "lets_do_that"
    }
  ];

  return {
    title: task.title,
    message: task.text,
    data: {
      tag: task.id,
      group: "watchdex",
      push: {
        "interruption-level": cfg.homeAssistantInterruptionLevel
      },
      actions: actionPayloads.map((payload) => ({
        action: payload.action,
        title: payload.title,
        activationMode: "background",
        action_data: {
          token: cfg.token,
          taskId: task.id,
          choice: payload.choice,
          prompt: RESPONSE_CHOICES[payload.choice]
        }
      }))
    }
  };
}

function parseHomeAssistantNotifyService(value) {
  const cleaned = String(value || "").trim();
  if (!cleaned) {
    throw new Error("HOME_ASSISTANT_NOTIFY_SERVICE is required");
  }

  if (cleaned.includes(".")) {
    const [domain, name] = cleaned.split(".", 2);
    return { domain, name };
  }

  return { domain: "notify", name: cleaned };
}

async function startServer() {
  const cfg = config();
  ensureDataDir(cfg.dataDir);

  if (!cfg.token) {
    console.warn("Warning: WATCH_BRIDGE_TOKEN is empty. /reply is not protected.");
  }

  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

      if (requestUrl.pathname === "/health") {
        return sendJson(res, 200, {
          ok: true,
          service: "watchdex",
          publicUrl: cfg.publicUrl
        });
      }

      if (requestUrl.pathname === "/reply") {
        return handleReplyRequest(req, res, requestUrl, cfg);
      }

      if (requestUrl.pathname === "/replies") {
        return sendJson(res, 200, readJsonl(cfg.dataDir, "replies.jsonl").slice(-25));
      }

      if (requestUrl.pathname === "/tasks") {
        return sendJson(res, 200, readJsonl(cfg.dataDir, "tasks.jsonl").slice(-25));
      }

      sendJson(res, 200, {
        service: "watchdex",
        endpoints: ["/health", "/reply", "/replies", "/tasks"]
      });
    } catch (error) {
      logError(error);
      sendJson(res, 500, { ok: false, error: error.message });
    }
  });

  await new Promise((resolve) => server.listen(cfg.port, cfg.host, resolve));
  console.log(`WatchDex listening on http://${cfg.host}:${cfg.port}`);
  console.log(`Watch reply callback public URL should be: ${cfg.publicUrl}/reply`);
}

async function handleReplyRequest(req, res, requestUrl, cfg) {
  const body = await readHttpBody(req);
  const fields = {
    ...Object.fromEntries(requestUrl.searchParams.entries()),
    ...parseBodyFields(body, req.headers["content-type"] || "")
  };

  if (cfg.token && fields.token !== cfg.token) {
    return sendJson(res, 401, { ok: false, error: "Invalid token" });
  }

  const latestTask = latestJsonl(cfg.dataDir, "tasks.jsonl");
  const taskId = fields.taskId || fields.task_id || latestTask?.id || "";
  const choice = normalizeChoice(fields.choice || "okay_whats_next");
  const prompt = fields.prompt || RESPONSE_CHOICES[choice] || choice;
  const task = taskId ? findTask(cfg.dataDir, taskId) || latestTask : latestTask;

  const reply = {
    id: makeId("reply"),
    at: new Date().toISOString(),
    taskId,
    choice,
    prompt,
    taskTitle: task?.title || "",
    sessionId: task?.sessionId || "",
    cwd: task?.cwd || "",
    userAgent: req.headers["user-agent"] || ""
  };

  appendJsonl(cfg.dataDir, "replies.jsonl", reply);

  if (cfg.autoResume) {
    attemptAutoResume(cfg, task, reply);
  }

  sendJson(res, 200, {
    ok: true,
    recorded: reply,
    autoResumeQueued: Boolean(cfg.autoResume && task?.sessionId)
  });
}

async function recordReplyFromCli(args) {
  const cfg = config();
  ensureDataDir(cfg.dataDir);
  const flags = parseFlags(args);
  const choice = normalizeChoice(flags.choice || args[0] || "okay_whats_next");
  const taskId = flags.task || flags.taskId || latestJsonl(cfg.dataDir, "tasks.jsonl")?.id || "";
  const task = taskId ? findTask(cfg.dataDir, taskId) : latestJsonl(cfg.dataDir, "tasks.jsonl");
  const reply = {
    id: makeId("reply"),
    at: new Date().toISOString(),
    taskId,
    choice,
    prompt: flags.prompt || RESPONSE_CHOICES[choice] || choice,
    taskTitle: task?.title || "",
    sessionId: task?.sessionId || "",
    cwd: task?.cwd || "",
    source: "cli"
  };
  appendJsonl(cfg.dataDir, "replies.jsonl", reply);
  console.log(JSON.stringify(reply, null, 2));
}

function attemptAutoResume(cfg, task, reply) {
  if (!task?.sessionId) {
    appendJsonl(cfg.dataDir, "events.jsonl", {
      at: new Date().toISOString(),
      type: "auto-resume-skipped",
      reason: "No sessionId found in task",
      taskId: reply.taskId
    });
    return;
  }

  const logPath = path.join(cfg.dataDir, "auto-resume.log");
  const out = fs.openSync(logPath, "a");
  const child = spawn(
    cfg.codexBin,
    ["exec", "resume", "--skip-git-repo-check", task.sessionId, reply.prompt],
    {
      cwd: task.cwd || ROOT,
      detached: true,
      stdio: ["ignore", out, out],
      env: {
        ...process.env,
        CODEX_WATCH_AUTO_RESUME: "1"
      }
    }
  );

  child.unref();
  appendJsonl(cfg.dataDir, "events.jsonl", {
    at: new Date().toISOString(),
    type: "auto-resume-started",
    taskId: reply.taskId,
    sessionId: task.sessionId,
    pid: child.pid
  });
}

async function runAndNotify(args) {
  const separatorIndex = args.indexOf("--");
  const commandArgs = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : args;
  if (commandArgs.length === 0) {
    throw new Error("Usage: watchdex run -- <command> [args...]");
  }

  const startedAt = Date.now();
  const child = spawn(commandArgs[0], commandArgs.slice(1), { stdio: "inherit" });
  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  const cfg = config();
  ensureDataDir(cfg.dataDir);
  const task = createTask({
    source: "command-wrapper",
    title: exitCode === 0 ? "Command finished" : "Command failed",
    text: `${commandArgs.join(" ")} exited ${exitCode} after ${elapsed}s`,
    cwd: process.cwd()
  });
  appendJsonl(cfg.dataDir, "tasks.jsonl", task);
  await sendWatchNotification(cfg, task);
  process.exitCode = exitCode;
}

function createTask(fields) {
  return {
    id: makeId("task"),
    at: new Date().toISOString(),
    source: fields.source || "unknown",
    title: fields.title || "Codex done",
    text: fields.text || "Task completed",
    cwd: fields.cwd || process.cwd(),
    sessionId: fields.sessionId || "",
    hookPayload: fields.hookPayload,
    rawHookInputBytes: fields.rawHookInputBytes
  };
}

function buildTaskMessage(payload) {
  const message = findFirstKey(payload, [
    "last_assistant_message",
    "lastAssistantMessage",
    "assistant_message",
    "assistantMessage"
  ]);

  if (!message) return "Tap a response: okay whats next / lets do that";

  const cleaned = redactSensitiveText(message)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/g, "$1")
    .replace(/[`*_>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return truncate(cleaned || "Tap a response: okay whats next / lets do that", 220);
}

function printRecent(fileName) {
  const cfg = config();
  const entries = readJsonl(cfg.dataDir, fileName).slice(-20);
  if (entries.length === 0) {
    console.log(`No entries in ${path.join(cfg.dataDir, fileName)}`);
    return;
  }
  for (const entry of entries) {
    console.log(JSON.stringify(entry, null, 2));
  }
}

function printHelp() {
  console.log(`WatchDex

Usage:
  watchdex setup
  watchdex server
  watchdex hook
  watchdex notify --title "Codex done" --text "Task completed"
  watchdex reply --choice okay_whats_next
  watchdex replies
  watchdex run -- <command> [args...]
`);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquote(rawValue.trim());
  }
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      flags[key] = inlineValue;
    } else if (args[i + 1] && !args[i + 1].startsWith("--")) {
      flags[key] = args[i + 1];
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function normalizeChoice(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/['?]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function ensureDataDir(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function appendJsonl(dataDir, fileName, value) {
  ensureDataDir(dataDir);
  fs.appendFileSync(path.join(dataDir, fileName), `${JSON.stringify(value)}\n`);
}

function readJsonl(dataDir, fileName) {
  const filePath = path.join(dataDir, fileName);
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { parseError: true, line };
      }
    });
}

function latestJsonl(dataDir, fileName) {
  const entries = readJsonl(dataDir, fileName);
  return entries[entries.length - 1];
}

function findTask(dataDir, taskId) {
  return readJsonl(dataDir, "tasks.jsonl").find((task) => task.id === taskId);
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function readHttpBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function parseMaybeJson(raw) {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw: raw.slice(0, 1000) };
  }
}

function parseBodyFields(body, contentType) {
  if (!body) return {};
  if (contentType.includes("application/json")) {
    return parseMaybeJson(body);
  }
  return Object.fromEntries(new URLSearchParams(body).entries());
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const summary = {};
  for (const key of Object.keys(payload).slice(0, 20)) {
    const value = payload[key];
    if (typeof value === "string") summary[key] = value.slice(0, 500);
    else if (typeof value === "number" || typeof value === "boolean") summary[key] = value;
    else if (value == null) summary[key] = value;
    else summary[key] = `[${Array.isArray(value) ? "array" : "object"}]`;
  }
  return summary;
}

function findFirstKey(value, keys) {
  const seen = new Set();
  const wanted = new Set(keys);
  const queue = [value];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    for (const [key, child] of Object.entries(current)) {
      if (wanted.has(key) && typeof child === "string" && child) return child;
      if (child && typeof child === "object") queue.push(child);
    }
  }
  return "";
}

function redactSensitiveText(value) {
  return String(value).replace(
    /\b(password|token|secret|api[_ -]?key)\b\s*:?\s*([^\s`"'<>]{8,})/gi,
    "$1: [redacted]"
  );
}

function truncate(value, maxLength) {
  const text = String(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function logError(error) {
  const cfg = config();
  try {
    appendJsonl(cfg.dataDir, "errors.jsonl", {
      at: new Date().toISOString(),
      message: error.message,
      stack: error.stack
    });
  } catch {
    // Ignore logging failures; hooks should not break Codex turns.
  }
  console.error(error.stack || error.message);
}

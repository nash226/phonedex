#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR_DEFAULT = path.join(ROOT, "data");
const SESSION_WATCH_STATE = "session-watch-state.json";
const APP_SERVER_RESUME_TIMEOUT_MS = 30 * 60 * 1000;

const RESPONSE_CHOICES = {
  okay_whats_next: "okay whats next",
  lets_do_that: "lets do that",
  custom: ""
};

const CODEX_RESUME_PROMPTS = {
  okay_whats_next:
    "The user tapped the WatchDex quick reply: okay whats next. Provide a concise status update and the next recommended action only. Do not run tools, edit files, or start new work.",
  lets_do_that:
    "The user tapped the WatchDex quick reply: lets do that. Continue with the previously recommended next step, keeping the scope tight and reporting back when done."
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

  if (command === "watch-sessions") {
    await watchSessions(args);
    return;
  }

  if (command === "scan-sessions") {
    await scanSessionsCommand(args);
    return;
  }

  if (command === "reply") {
    await recordReplyFromCli(args);
    return;
  }

  if (command === "app-server-resume") {
    await appServerResumeCommand(args);
    return;
  }

  if (command === "foreground-submit") {
    await foregroundSubmitCommand(args);
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
  const machineName = env.WATCHDEX_MACHINE_NAME || os.hostname();
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
    homeAssistantCustomReplyMode: normalizeCustomReplyMode(
      env.HOME_ASSISTANT_CUSTOM_REPLY_MODE
    ),
    shortcutName: env.WATCHDEX_SHORTCUT_NAME || "WatchDex Reply",
    machineName,
    publicUrl,
    replyUrl: `${publicUrl}/reply`,
    token: env.WATCH_BRIDGE_TOKEN || "",
    host,
    port,
    dataDir: env.WATCH_BRIDGE_DATA_DIR || DATA_DIR_DEFAULT,
    pushcutSound: env.PUSHCUT_SOUND || "jobDone",
    pushcutTimeSensitive: parseBoolean(env.PUSHCUT_TIME_SENSITIVE, true),
    autoResume: parseBoolean(env.WATCH_BRIDGE_AUTO_RESUME, false),
    autoResumeMode: env.WATCH_BRIDGE_AUTO_RESUME_MODE || "cli",
    codexHome: env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    sessionWatchIntervalMs: Number(env.WATCHDEX_SESSION_WATCH_INTERVAL_MS || "5000"),
    sessionWatchDebounceMs: Number(env.WATCHDEX_SESSION_WATCH_DEBOUNCE_MS || "8000"),
    codexBin:
      env.CODEX_BIN || "/Applications/Codex.app/Contents/Resources/codex",
    codexAppServerBin:
      env.CODEX_APP_SERVER_BIN ||
      env.CODEX_BIN ||
      defaultAppServerCodexBin()
  };
}

function defaultAppServerCodexBin() {
  const standaloneBin = path.join(os.homedir(), ".local", "bin", "codex");
  if (fs.existsSync(standaloneBin)) return standaloneBin;
  return "/Applications/Codex.app/Contents/Resources/codex";
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
          prompt,
          machineName: cfg.machineName
        })
      }
    };
  });

  return {
    title: formatNotificationTitle(cfg, task),
    text: task.text,
    sound: cfg.pushcutSound,
    isTimeSensitive: cfg.pushcutTimeSensitive,
    threadId: "watchdex",
    id: task.id,
    input: JSON.stringify({
      taskId: task.id,
      cwd: task.cwd,
      sessionId: task.sessionId || "",
      machineName: cfg.machineName,
      replyUrl: cfg.replyUrl
    }),
    actions
  };
}

function buildHomeAssistantBody(cfg, task) {
  const safeTaskId = task.id.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
  const customAction =
    cfg.homeAssistantCustomReplyMode === "shortcut"
      ? {
          action: `WATCHDEX_SHORTCUT_${safeTaskId}`,
          title: "Custom reply",
          uri: buildShortcutReplyUrl(cfg, task)
        }
      : {
          action: "REPLY",
          title: "Custom reply",
          choice: "custom",
          behavior: "textInput",
          textInputButtonTitle: "Send",
          textInputPlaceholder: "Type reply to Codex"
        };
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
    },
    customAction
  ];

  return {
    title: formatNotificationTitle(cfg, task),
    message: task.text,
    data: {
      tag: task.id,
      group: "watchdex",
      url: "noAction",
      subtitle: cfg.machineName,
      subject: task.text,
      push: {
        "interruption-level": cfg.homeAssistantInterruptionLevel
      },
      actions: actionPayloads.map((payload) => ({
        action: payload.action,
        title: payload.title,
        ...(payload.uri ? { uri: payload.uri } : { activationMode: "background" }),
        ...(payload.behavior ? { behavior: payload.behavior } : {}),
        ...(payload.textInputButtonTitle ? { textInputButtonTitle: payload.textInputButtonTitle } : {}),
        ...(payload.textInputPlaceholder ? { textInputPlaceholder: payload.textInputPlaceholder } : {}),
        ...(payload.uri
          ? {}
          : {
              action_data: {
                token: cfg.token,
                taskId: task.id,
                choice: payload.choice,
                prompt: RESPONSE_CHOICES[payload.choice],
                replyUrl: cfg.replyUrl,
                machineName: cfg.machineName
              }
            })
      }))
    }
  };
}

function buildTaskViewUrl(cfg, task) {
  const url = new URL(`${cfg.publicUrl}/task`);
  url.searchParams.set("id", task.id);
  url.searchParams.set("token", cfg.token);
  return url.toString();
}

function buildShortcutReplyUrl(cfg, task) {
  const replyUrl = new URL(cfg.replyUrl);
  replyUrl.searchParams.set("token", cfg.token);
  replyUrl.searchParams.set("taskId", task.id);
  replyUrl.searchParams.set("choice", "custom");
  replyUrl.searchParams.set("machineName", cfg.machineName);

  const shortcutUrl = new URL("shortcuts://run-shortcut");
  shortcutUrl.searchParams.set("name", cfg.shortcutName);
  shortcutUrl.searchParams.set("input", "text");
  shortcutUrl.searchParams.set("text", replyUrl.toString());
  return shortcutUrl.toString();
}

function formatNotificationTitle(cfg, task) {
  if (!cfg.machineName) return task.title;
  return `${task.title} @ ${cfg.machineName}`;
}

function normalizeCustomReplyMode(value) {
  const mode = String(value || "reply").trim().toLowerCase();
  if (mode === "shortcut") return "shortcut";
  return "reply";
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
          machineName: cfg.machineName,
          publicUrl: cfg.publicUrl,
          replyUrl: cfg.replyUrl
        });
      }

      if (requestUrl.pathname === "/reply") {
        return handleReplyRequest(req, res, requestUrl, cfg);
      }

      if (requestUrl.pathname === "/task") {
        return handleTaskPageRequest(req, res, requestUrl, cfg);
      }

      if (requestUrl.pathname === "/ha-action-event") {
        return handleHomeAssistantActionEvent(req, res, requestUrl, cfg);
      }

      if (requestUrl.pathname === "/replies") {
        return sendJson(res, 200, readJsonl(cfg.dataDir, "replies.jsonl").slice(-25));
      }

      if (requestUrl.pathname === "/tasks") {
        return sendJson(res, 200, readJsonl(cfg.dataDir, "tasks.jsonl").slice(-25));
      }

      sendJson(res, 200, {
        service: "watchdex",
        endpoints: ["/health", "/reply", "/task", "/ha-action-event", "/replies", "/tasks"]
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

async function handleTaskPageRequest(req, res, requestUrl, cfg) {
  const token = requestUrl.searchParams.get("token") || "";
  if (cfg.token && token !== cfg.token) {
    return sendHtml(res, 401, renderMessagePage("WatchDex", "Invalid token."));
  }

  const latestTask = latestJsonl(cfg.dataDir, "tasks.jsonl");
  const taskId = requestUrl.searchParams.get("id") || requestUrl.searchParams.get("taskId") || "";
  const task = taskId ? findTask(cfg.dataDir, taskId) : latestTask;

  if (!task) {
    return sendHtml(res, 404, renderMessagePage("WatchDex", "Task not found."));
  }

  return sendHtml(res, 200, renderTaskPage(task));
}

async function handleHomeAssistantActionEvent(req, res, requestUrl, cfg) {
  const body = await readHttpBody(req);
  const fields = {
    ...Object.fromEntries(requestUrl.searchParams.entries()),
    ...parseBodyFields(body, req.headers["content-type"] || "")
  };
  const event = fields.event && typeof fields.event === "object" ? fields.event : fields;
  const token = fields.token || event?.action_data?.token || "";

  if (cfg.token && token !== cfg.token) {
    return sendJson(res, 401, { ok: false, error: "Invalid token" });
  }

  appendJsonl(cfg.dataDir, "action-events.jsonl", {
    at: new Date().toISOString(),
    source: "home-assistant-action-event",
    event: redactActionEvent(event),
    userAgent: req.headers["user-agent"] || ""
  });

  sendJson(res, 200, { ok: true });
}

function redactActionEvent(event) {
  if (!event || typeof event !== "object") return event;
  const clone = JSON.parse(JSON.stringify(event));
  if (clone.action_data?.token) clone.action_data.token = "[redacted]";
  if (clone.token) clone.token = "[redacted]";
  return clone;
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
  const prompt =
    fields.prompt ||
    fields.reply_text ||
    fields.replyText ||
    RESPONSE_CHOICES[choice] ||
    choice;
  const task = taskId ? findTask(cfg.dataDir, taskId) || latestTask : latestTask;

  const reply = {
    id: makeId("reply"),
    at: new Date().toISOString(),
    taskId,
    choice,
    prompt,
    action: fields.action || "",
    replyText: fields.reply_text || fields.replyText || "",
    taskTitle: task?.title || "",
    sessionId: task?.sessionId || "",
    cwd: task?.cwd || "",
    machineName: fields.machineName || fields.machine || task?.machineName || "",
    userAgent: req.headers["user-agent"] || ""
  };

  const duplicate = findRecentDuplicateReply(cfg.dataDir, reply);
  if (duplicate) {
    appendJsonl(cfg.dataDir, "events.jsonl", {
      at: new Date().toISOString(),
      type: "duplicate-reply-ignored",
      duplicateOf: duplicate.id,
      taskId: reply.taskId,
      choice: reply.choice,
      action: reply.action,
      prompt: reply.prompt.slice(0, 200)
    });

    return sendJson(res, 200, {
      ok: true,
      duplicate: true,
      duplicateOf: duplicate.id,
      recorded: duplicate,
      autoResumeQueued: false
    });
  }

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

function findRecentDuplicateReply(dataDir, reply) {
  const replyAt = Date.parse(reply.at);
  return readJsonl(dataDir, "replies.jsonl")
    .slice(-20)
    .find((candidate) => {
      if (!candidate?.at || Number.isNaN(replyAt)) return false;
      const candidateAt = Date.parse(candidate.at);
      return (
        !Number.isNaN(candidateAt) &&
        Math.abs(replyAt - candidateAt) <= 3000 &&
        candidate.taskId === reply.taskId &&
        candidate.choice === reply.choice &&
        candidate.action === reply.action &&
        candidate.prompt === reply.prompt
      );
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

  if (cfg.autoResumeMode === "app-server") {
    attemptAppServerAutoResume(cfg, task, reply);
    return;
  }

  if (cfg.autoResumeMode === "foreground") {
    attemptForegroundAutoResume(cfg, task, reply);
    return;
  }

  const logPath = path.join(cfg.dataDir, "auto-resume.log");
  const out = fs.openSync(logPath, "a");
  const child = spawn(
    cfg.codexBin,
    ["exec", "resume", "--skip-git-repo-check", task.sessionId, buildCodexResumePrompt(reply)],
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
    mode: "cli",
    taskId: reply.taskId,
    sessionId: task.sessionId,
    pid: child.pid
  });
}

function attemptAppServerAutoResume(cfg, task, reply) {
  const logPath = path.join(cfg.dataDir, "app-server-resume.log");
  const out = fs.openSync(logPath, "a");
  const child = spawn(
    process.execPath,
    [
      __filename,
      "app-server-resume",
      "--taskId",
      reply.taskId,
      "--prompt",
      buildCodexResumePrompt(reply)
    ],
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
    mode: "app-server",
    taskId: reply.taskId,
    sessionId: task.sessionId,
    pid: child.pid
  });
}

function attemptForegroundAutoResume(cfg, task, reply) {
  const logPath = path.join(cfg.dataDir, "foreground-resume.log");
  const out = fs.openSync(logPath, "a");
  const child = spawn(
    process.execPath,
    [
      __filename,
      "foreground-submit",
      "--taskId",
      reply.taskId,
      "--prompt",
      buildVisibleReplyPrompt(reply)
    ],
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
    mode: "foreground",
    taskId: reply.taskId,
    sessionId: task.sessionId,
    pid: child.pid
  });
}

async function appServerResumeCommand(args) {
  const cfg = config();
  ensureDataDir(cfg.dataDir);
  const flags = parseFlags(args);
  const taskId = flags.taskId || flags.task || "";
  const task = taskId ? findTask(cfg.dataDir, taskId) : latestJsonl(cfg.dataDir, "tasks.jsonl");
  if (!task) throw new Error(`No task found for app-server resume: ${taskId || "(latest)"}`);
  if (!task.sessionId) throw new Error(`Task ${task.id} does not have a Codex session id`);

  const prompt = flags.prompt || buildCodexResumePrompt({ choice: flags.choice || "" });
  if (!prompt) throw new Error("Missing --prompt for app-server resume");

  await runAppServerTurn(cfg, task, prompt);
}

async function foregroundSubmitCommand(args) {
  const cfg = config();
  ensureDataDir(cfg.dataDir);
  const flags = parseFlags(args);
  const taskId = flags.taskId || flags.task || "";
  const task = taskId ? findTask(cfg.dataDir, taskId) : latestJsonl(cfg.dataDir, "tasks.jsonl");
  if (!task) throw new Error(`No task found for foreground submit: ${taskId || "(latest)"}`);

  const prompt = flags.prompt || buildCodexResumePrompt({ choice: flags.choice || "" });
  if (!prompt) throw new Error("Missing --prompt for foreground submit");

  await submitPromptToForegroundCodex(cfg, task, prompt);
}

function buildCodexResumePrompt(reply) {
  const choice = normalizeChoice(reply.choice || "");
  return CODEX_RESUME_PROMPTS[choice] || reply.prompt || RESPONSE_CHOICES[choice] || choice;
}

function buildVisibleReplyPrompt(reply) {
  const choice = normalizeChoice(reply.choice || "");
  return reply.prompt || RESPONSE_CHOICES[choice] || choice;
}

async function submitPromptToForegroundCodex(cfg, task, prompt) {
  appendJsonl(cfg.dataDir, "events.jsonl", {
    at: new Date().toISOString(),
    type: "foreground-resume-worker-started",
    taskId: task.id,
    sessionId: task.sessionId || "",
    cwd: task.cwd || ROOT
  });

  const script = `
on run argv
  set promptText to item 1 of argv
  set previousClipboard to the clipboard
  tell application "Codex" to activate
  delay 0.6
  set the clipboard to promptText
  tell application "System Events"
    tell process "Codex"
      set frontmost to true
      keystroke "v" using {command down}
      delay 0.2
      key code 36
    end tell
  end tell
  delay 0.5
  set the clipboard to previousClipboard
end run
`;

  try {
    await runChild("osascript", ["-e", script, prompt], {
      cwd: task.cwd || ROOT
    });
    appendJsonl(cfg.dataDir, "events.jsonl", {
      at: new Date().toISOString(),
      type: "foreground-resume-submitted",
      taskId: task.id,
      sessionId: task.sessionId || ""
    });
  } catch (error) {
    appendJsonl(cfg.dataDir, "events.jsonl", {
      at: new Date().toISOString(),
      type: "foreground-resume-failed",
      taskId: task.id,
      sessionId: task.sessionId || "",
      error: error.message
    });
    throw error;
  }
}

async function runAppServerTurn(cfg, task, prompt) {
  const startedAt = new Date().toISOString();
  const cwd = task.cwd || ROOT;
  const logPath = path.join(cfg.dataDir, "app-server-resume.log");
  fs.appendFileSync(logPath, `[${startedAt}] starting ${task.id} ${task.sessionId}\n`);

  appendJsonl(cfg.dataDir, "events.jsonl", {
    at: startedAt,
    type: "app-server-resume-worker-started",
    taskId: task.id,
    sessionId: task.sessionId,
    cwd,
    codexBin: cfg.codexAppServerBin
  });

  const child = spawn(cfg.codexAppServerBin, ["app-server", "--stdio"], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      CODEX_WATCH_AUTO_RESUME: "1"
    }
  });

  let nextId = 1;
  let stdoutBuffer = "";
  let completed = false;
  const pending = new Map();

  const send = (method, params, wantsResponse = true) => {
    const message = wantsResponse
      ? { id: nextId++, method, params }
      : { method, params };
    fs.appendFileSync(logPath, `> ${formatAppServerLogMessage(message)}\n`);
    child.stdin.write(`${JSON.stringify(message)}\n`);
    if (!wantsResponse) return Promise.resolve();
    return new Promise((resolve, reject) => {
      pending.set(message.id, { method, resolve, reject });
    });
  };

  const cleanup = () => {
    clearTimeout(timer);
    for (const { reject, method } of pending.values()) {
      reject(new Error(`app-server exited before ${method} completed`));
    }
    pending.clear();
  };

  const timer = setTimeout(() => {
    child.kill("SIGTERM");
    appendJsonl(cfg.dataDir, "events.jsonl", {
      at: new Date().toISOString(),
      type: "app-server-resume-timeout",
      taskId: task.id,
      sessionId: task.sessionId
    });
  }, APP_SERVER_RESUME_TIMEOUT_MS);

  child.stderr.on("data", (chunk) => {
    fs.appendFileSync(logPath, chunk);
  });

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    let newlineIndex;
    while ((newlineIndex = stdoutBuffer.indexOf("\n")) >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      const message = parseMaybeJson(line);
      fs.appendFileSync(logPath, `< ${formatAppServerLogMessage(message)}\n`);
      if (message.id && pending.has(message.id)) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
        else waiter.resolve(message.result);
      }

      if (message.method === "turn/started" && message.params?.threadId === task.sessionId) {
        appendJsonl(cfg.dataDir, "events.jsonl", {
          at: new Date().toISOString(),
          type: "app-server-resume-turn-started",
          taskId: task.id,
          sessionId: task.sessionId
        });
      }

      if (message.method === "turn/completed" && message.params?.threadId === task.sessionId) {
        completed = true;
        appendJsonl(cfg.dataDir, "events.jsonl", {
          at: new Date().toISOString(),
          type: "app-server-resume-completed",
          taskId: task.id,
          sessionId: task.sessionId,
          turnId: message.params?.turn?.id || ""
        });
        child.kill("SIGTERM");
      }
    }
  });

  const exitPromise = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      cleanup();
      if (completed || signal === "SIGTERM") resolve({ code, signal });
      else reject(new Error(`app-server exited with code ${code || ""} signal ${signal || ""}`));
    });
  });

  try {
    await send("initialize", {
      clientInfo: {
        name: "watchdex",
        title: "WatchDex",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false
      }
    });
    await send("initialized", {}, false);
    await send("thread/resume", {
      threadId: task.sessionId,
      cwd
    });
    appendJsonl(cfg.dataDir, "events.jsonl", {
      at: new Date().toISOString(),
      type: "app-server-resume-thread-resumed",
      taskId: task.id,
      sessionId: task.sessionId
    });
    await send("turn/start", {
      threadId: task.sessionId,
      cwd,
      input: [
        {
          type: "text",
          text: prompt,
          text_elements: []
        }
      ]
    });
    await exitPromise;
  } catch (error) {
    child.kill("SIGTERM");
    appendJsonl(cfg.dataDir, "events.jsonl", {
      at: new Date().toISOString(),
      type: "app-server-resume-failed",
      taskId: task.id,
      sessionId: task.sessionId,
      error: error.message
    });
    throw error;
  }
}

function formatAppServerLogMessage(message) {
  if (!message || typeof message !== "object" || message.raw) {
    return redactSensitiveText(JSON.stringify(message)).slice(0, 1000);
  }

  const summary = {
    id: message.id,
    method: message.method
  };

  if (message.error) {
    summary.error = message.error;
    return redactSensitiveText(JSON.stringify(summary)).slice(0, 1000);
  }

  const params = message.params || {};
  const result = message.result || {};
  const thread = result.thread || {};
  const turn = result.turn || params.turn || {};
  const item = params.item || {};

  if (params.threadId || thread.id) summary.threadId = params.threadId || thread.id;
  if (params.turnId || turn.id) summary.turnId = params.turnId || turn.id;
  if (params.itemId || item.id) summary.itemId = params.itemId || item.id;
  if (item.type) summary.itemType = item.type;
  if (turn.status) summary.turnStatus = turn.status;
  if (thread.status) summary.threadStatus = thread.status;
  if (message.method === "turn/start") {
    const text = message.params?.input?.find((part) => part.type === "text")?.text || "";
    summary.input = truncate(redactSensitiveText(text).replace(/\s+/g, " ").trim(), 160);
  }
  if (message.method === "item/agentMessage/delta") {
    summary.deltaLength = String(params.delta || "").length;
  }
  if (message.method === "item/completed" && item.type === "agentMessage") {
    summary.text = truncate(redactSensitiveText(item.text || "").replace(/\s+/g, " ").trim(), 160);
  }
  if (message.id && result.userAgent) summary.userAgent = result.userAgent;

  return JSON.stringify(summary);
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

function runChild(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} exited ${code || ""} ${signal || ""}: ${stderr || stdout}`));
    });
  });
}

function createTask(fields) {
  return {
    id: makeId("task"),
    at: new Date().toISOString(),
    source: fields.source || "unknown",
    title: fields.title || "Codex done",
    text: fields.text || "Task completed",
    cwd: fields.cwd || process.cwd(),
    machineName: fields.machineName || process.env.WATCHDEX_MACHINE_NAME || os.hostname(),
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
  watchdex watch-sessions
  watchdex scan-sessions --notify-existing
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

function readJsonFile(dataDir, fileName, fallback) {
  const filePath = path.join(dataDir, fileName);
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(dataDir, fileName, value) {
  ensureDataDir(dataDir);
  fs.writeFileSync(path.join(dataDir, fileName), `${JSON.stringify(value, null, 2)}\n`);
}

function latestJsonl(dataDir, fileName) {
  const entries = readJsonl(dataDir, fileName);
  return entries[entries.length - 1];
}

function findTask(dataDir, taskId) {
  return readJsonl(dataDir, "tasks.jsonl").find((task) => task.id === taskId);
}

async function watchSessions(args) {
  const cfg = config();
  ensureDataDir(cfg.dataDir);
  const flags = parseFlags(args);
  const notifyExisting = Boolean(flags.notifyExisting || flags["notify-existing"]);

  await scanSessions({ cfg, notify: notifyExisting });
  console.log(`Watching Codex sessions in ${path.join(cfg.codexHome, "sessions")}`);

  setInterval(() => {
    scanSessions({ cfg, notify: true }).catch(logError);
  }, cfg.sessionWatchIntervalMs);
}

async function scanSessionsCommand(args) {
  const cfg = config();
  ensureDataDir(cfg.dataDir);
  const flags = parseFlags(args);
  const notified = await scanSessions({
    cfg,
    notify: Boolean(flags.notifyExisting || flags["notify-existing"])
  });
  console.log(JSON.stringify({ notified }, null, 2));
}

async function scanSessions({ cfg, notify }) {
  const state = readJsonFile(cfg.dataDir, SESSION_WATCH_STATE, { seen: {} });
  state.seen ||= {};

  const existingTasks = readJsonl(cfg.dataDir, "tasks.jsonl");
  const now = Date.now();
  let notified = 0;

  for (const filePath of recentSessionFiles(cfg.codexHome)) {
    for (const item of readFinalSessionMessages(filePath)) {
      if (state.seen[item.id]) continue;
      if (now - Date.parse(item.at) < cfg.sessionWatchDebounceMs) continue;

      state.seen[item.id] = new Date().toISOString();

      if (!notify || hasMatchingTask(existingTasks, item)) continue;

      const task = createTask({
        source: "codex-session-watch",
        title: `Codex done: ${path.basename(item.cwd || ROOT)}`,
        text: truncate(redactSensitiveText(item.text).replace(/\s+/g, " ").trim(), 220),
        cwd: item.cwd || ROOT,
        sessionId: item.sessionId,
        hookPayload: {
          session_file: filePath,
          message_id: item.messageId,
          fallback: true
        }
      });

      appendJsonl(cfg.dataDir, "tasks.jsonl", task);
      await sendWatchNotification(cfg, task);
      notified += 1;
    }
  }

  state.seen = Object.fromEntries(Object.entries(state.seen).slice(-1000));
  writeJsonFile(cfg.dataDir, SESSION_WATCH_STATE, state);
  return notified;
}

function recentSessionFiles(codexHome) {
  const sessionsDir = path.join(codexHome, "sessions");
  if (!fs.existsSync(sessionsDir)) return [];
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const files = [];
  walk(sessionsDir, files);
  return files
    .filter((filePath) => filePath.endsWith(".jsonl"))
    .map((filePath) => ({ filePath, stat: fs.statSync(filePath) }))
    .filter(({ stat }) => stat.mtimeMs >= cutoff)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, 80)
    .map(({ filePath }) => filePath);
}

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else files.push(fullPath);
  }
}

function readFinalSessionMessages(filePath) {
  const sessionId = path.basename(filePath).match(/(019[a-z0-9-]+)/i)?.[1] || "";
  const messages = [];
  let cwd = "";

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    const payload = record.payload || {};
    if (record.type === "session_meta" && payload.cwd) {
      cwd = payload.cwd;
    }

    if (payload.type === "function_call" && payload.arguments) {
      try {
        const args = JSON.parse(payload.arguments);
        if (args.workdir) cwd = args.workdir;
      } catch {
        // Ignore malformed tool arguments from older session records.
      }
    }

    if (record.type === "event_msg" && payload.type === "task_complete") {
      const text = String(payload.last_agent_message || "").trim();
      if (!text) continue;

      messages.push({
        id: `${filePath}:${payload.turn_id || record.timestamp}:task_complete`,
        messageId: payload.turn_id || "",
        at: sessionEventTimestamp(record, payload),
        text,
        cwd,
        sessionId
      });
      continue;
    }

    if (record.type !== "response_item") continue;
    if (payload.type !== "message" || payload.role !== "assistant") continue;
    if (payload.phase && payload.phase !== "final") continue;

    const text = extractMessageText(payload);
    if (!text) continue;

    messages.push({
      id: `${filePath}:${payload.id || record.timestamp}`,
      messageId: payload.id || "",
      at: record.timestamp || new Date().toISOString(),
      text,
      cwd,
      sessionId
    });
  }

  return messages;
}

function sessionEventTimestamp(record, payload) {
  if (Number.isFinite(payload.completed_at)) {
    return new Date(payload.completed_at * 1000).toISOString();
  }
  return record.timestamp || new Date().toISOString();
}

function extractMessageText(payload) {
  return (payload.content || [])
    .filter((part) => part && part.type === "output_text" && part.text)
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function hasMatchingTask(tasks, item) {
  const clean = truncate(redactSensitiveText(item.text).replace(/\s+/g, " ").trim(), 220);
  return tasks.some((task) =>
    task.sessionId === item.sessionId &&
    task.text === clean &&
    Math.abs(Date.parse(task.at) - Date.parse(item.at)) < 5 * 60 * 1000
  );
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

function renderTaskPage(task) {
  const title = escapeHtml(task.title || "WatchDex Task");
  const text = escapeHtml(task.text || "");
  const machineName = task.machineName ? escapeHtml(task.machineName) : "";
  const cwd = task.cwd ? escapeHtml(task.cwd) : "";
  const at = task.at ? escapeHtml(new Date(task.at).toLocaleString()) : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${title}</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
      background: Canvas;
      color: CanvasText;
    }
    main {
      max-width: 760px;
      margin: 0 auto;
      padding: max(18px, env(safe-area-inset-top)) 18px max(28px, env(safe-area-inset-bottom));
    }
    h1 {
      margin: 0 0 8px;
      font-size: clamp(1.35rem, 7vw, 2rem);
      line-height: 1.12;
      letter-spacing: 0;
    }
    .meta {
      display: grid;
      gap: 4px;
      margin-bottom: 18px;
      opacity: 0.68;
      font-size: 0.88rem;
      overflow-wrap: anywhere;
    }
    .response {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 1.02rem;
    }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <div class="meta">
      ${machineName ? `<div>${machineName}</div>` : ""}
      ${cwd ? `<div>${cwd}</div>` : ""}
      ${at ? `<div>${at}</div>` : ""}
    </div>
    <div class="response">${text}</div>
  </main>
</body>
</html>`;
}

function renderMessagePage(title, message) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function sendHtml(res, status, body) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
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

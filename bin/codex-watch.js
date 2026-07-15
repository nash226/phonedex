#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { createPhoneDexStore } = require("../lib/phonedex-store");
const {
  addDeviceProtocolFields,
  addTaskProtocolFields,
  defaultCapabilities,
  negotiateCapabilities,
  negotiateProtocolVersion,
  normalizeCaptureSources,
  normalizeTaskQuestion,
  protocolRecord
} = require("../lib/phonedex-protocol");
const {
  SYNC_SCHEMA,
  normalizeSyncLimit
} = require("../lib/phonedex-sync");
const {
  createCodexAdapter,
  supportsAdapterCapability
} = require("../lib/phonedex-adapter");
const {
  DELETE_CONFIRMATION,
  RETENTION_CONFIRMATION,
  createPhoneDexPrivacy,
  normalizeRetentionDays
} = require("../lib/phonedex-privacy");
const {
  DEFAULT_PAIRING_TTL_MS,
  assertSupportedScopes,
  createIdentity,
  createPairingGrant,
  hasScope,
  hashSecret,
  normalizeRole,
  publicIdentity,
  secretsMatch
} = require("../lib/phonedex-identity");
const {
  appendSecurityAudit,
  createRequestRateLimiter
} = require("../lib/phonedex-security");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR_DEFAULT = path.join(ROOT, "data");
const SESSION_WATCH_STATE = "session-watch-state.json";
const DEVICES_STATE_FILE = "devices.json";
const COVERAGE_ALERT_STATE_FILE = "coverage-alert-state.json";
const AGENT_INVITES_FILE = "agent-invites.json";
const AGENT_INSTALLS_FILE = "agent-installs.jsonl";
const AGENT_BOOTSTRAP_DIR_DEFAULT = path.join(ROOT, ".local", "agent-bootstrap");
const APP_SERVER_RESUME_TIMEOUT_MS = 30 * 60 * 1000;
const PHONE_NOTIFICATION_TEXT_MAX = 1800;
const DEFAULT_SESSION_WATCH_LOOKBACK_HOURS = 168;
const DEFAULT_SESSION_WATCH_FILE_LIMIT = 500;
const DEFAULT_DEVICE_HEARTBEAT_INTERVAL_MS = 30 * 1000;
const DEFAULT_DEVICE_STALE_MS = 2 * 60 * 1000;
const DEFAULT_COVERAGE_ALERT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_AGENT_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_AGENT_INVITE_MAX_ACTIVE = 5;
const DEFAULT_PAIRING_ATTEMPTS = 5;
const PAIRING_ATTEMPT_WINDOW_MS = 60 * 1000;
const DEFAULT_AUTH_RATE_LIMIT = 120;
const DEFAULT_AUTH_RATE_WINDOW_MS = 60 * 1000;
const DURABLE_STORE_CACHE = new Map();

const RESPONSE_CHOICES = {
  okay_whats_next: "okay whats next",
  lets_do_that: "lets do that",
  custom: ""
};

const CODEX_RESUME_PROMPTS = {
  okay_whats_next:
    "The user tapped the PhoneDex quick reply: okay whats next. Provide a concise status update and the next recommended action only. Do not run tools, edit files, or start new work.",
  lets_do_that:
    "The user tapped the PhoneDex quick reply: lets do that. Continue with the previously recommended next step, keeping the scope tight and reporting back when done."
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

  if (command === "service") {
    await startService(args);
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

  if (command === "devices") {
    printKnownDevices();
    return;
  }

  if (command === "verify-devices") {
    verifyDeviceCoverageCommand(args);
    return;
  }

  if (command === "notify-coverage") {
    await notifyCoverageCommand(args);
    return;
  }

  if (command === "enroll-agent") {
    enrollAgentCommand(args);
    return;
  }

  if (command === "agent-self-test") {
    await agentSelfTestCommand(args);
    return;
  }

  if (command === "agent-bundle") {
    agentBundleCommand(args);
    return;
  }

  if (command === "agent-invite") {
    agentInviteCommand(args);
    return;
  }

  if (command === "pair:create") {
    createPairingGrantCommand(args);
    return;
  }

  if (command === "pair:list") {
    listPairingIdentitiesCommand(args);
    return;
  }

  if (command === "pair:revoke") {
    revokePairingIdentityCommand(args);
    return;
  }

  if (command === "pair:rotate") {
    rotatePairingIdentityCommand(args);
    return;
  }

  if (command === "agent-installs") {
    printAgentInstalls(args);
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
  const machineName = env.PHONEDEX_MACHINE_NAME || env.WATCHDEX_MACHINE_NAME || os.hostname();
  const deviceId = env.PHONEDEX_DEVICE_ID || env.WATCHDEX_DEVICE_ID || os.hostname();
  const provider = env.WATCH_BRIDGE_PROVIDER || "pushcut";
  const hubUrl = trimTrailingSlash(env.PHONEDEX_HUB_URL || "");
  const codexBin = env.CODEX_BIN || defaultCodexBin();
  const codexAppServerBin = env.CODEX_APP_SERVER_BIN || codexBin || defaultAppServerCodexBin();
  const adapterMode = env.PHONEDEX_ADAPTER_MODE || env.WATCH_BRIDGE_AUTO_RESUME_MODE || "cli";
  const adapter = createCodexAdapter({
    platform: env.PHONEDEX_ADAPTER_PLATFORM || process.platform,
    mode: adapterMode,
    codexBin,
    appServerBin: codexAppServerBin
  });

  return {
    provider,
    pushcutWebhookUrl: env.PUSHCUT_WEBHOOK_URL || "",
    machineName,
    deviceId,
    publicUrl,
    replyUrl: `${publicUrl}/reply`,
    token: env.WATCH_BRIDGE_TOKEN || "",
    hubUrl,
    hubToken: env.PHONEDEX_HUB_TOKEN || env.WATCH_BRIDGE_TOKEN || "",
    agentMode: parseBoolean(env.PHONEDEX_AGENT_MODE, false),
    expectedDevices: parseExpectedDevices(env.PHONEDEX_EXPECTED_DEVICES || ""),
    deviceHeartbeatIntervalMs: positiveNumber(
      env.PHONEDEX_HEARTBEAT_INTERVAL_MS,
      DEFAULT_DEVICE_HEARTBEAT_INTERVAL_MS
    ),
    deviceStaleMs: positiveNumber(env.PHONEDEX_DEVICE_STALE_MS, DEFAULT_DEVICE_STALE_MS),
    coverageAlerts: parseBoolean(env.PHONEDEX_COVERAGE_ALERTS, true),
    coverageAlertIntervalMs: positiveNumber(
      env.PHONEDEX_COVERAGE_ALERT_INTERVAL_MS,
      DEFAULT_COVERAGE_ALERT_INTERVAL_MS
    ),
    agentInviteTtlMs: positiveNumber(
      env.PHONEDEX_AGENT_INVITE_TTL_MS,
      DEFAULT_AGENT_INVITE_TTL_MS
    ),
    agentInviteMaxActive: positiveNumber(
      env.PHONEDEX_AGENT_INVITE_MAX_ACTIVE,
      DEFAULT_AGENT_INVITE_MAX_ACTIVE
    ),
    pairingTtlMs: positiveNumber(env.PHONEDEX_PAIRING_TTL_MS, DEFAULT_PAIRING_TTL_MS),
    authRateLimit: Math.floor(positiveNumber(env.PHONEDEX_AUTH_RATE_LIMIT, DEFAULT_AUTH_RATE_LIMIT)),
    authRateLimitWindowMs: Math.floor(
      positiveNumber(env.PHONEDEX_AUTH_RATE_WINDOW_MS, DEFAULT_AUTH_RATE_WINDOW_MS)
    ),
    host,
    port,
    dataDir: env.WATCH_BRIDGE_DATA_DIR || DATA_DIR_DEFAULT,
    agentBundleDir: path.resolve(ROOT, env.PHONEDEX_AGENT_BUNDLE_DIR || AGENT_BOOTSTRAP_DIR_DEFAULT),
    pushcutSound: env.PUSHCUT_SOUND || "jobDone",
    pushcutTimeSensitive: parseBoolean(env.PUSHCUT_TIME_SENSITIVE, true),
    autoResume: parseBoolean(env.WATCH_BRIDGE_AUTO_RESUME, false),
    autoResumeMode: adapter.mode,
    adapter,
    codexHome: env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    sessionWatchIntervalMs: Number(env.WATCHDEX_SESSION_WATCH_INTERVAL_MS || "5000"),
    sessionWatchDebounceMs: Number(env.WATCHDEX_SESSION_WATCH_DEBOUNCE_MS || "8000"),
    codexBin,
    codexAppServerBin,
    sessionWatchLookbackHours: Number(
      env.WATCHDEX_SESSION_WATCH_LOOKBACK_HOURS || DEFAULT_SESSION_WATCH_LOOKBACK_HOURS
    ),
    sessionWatchFileLimit: Number(
      env.WATCHDEX_SESSION_WATCH_FILE_LIMIT || DEFAULT_SESSION_WATCH_FILE_LIMIT
    ),
    retentionDays: normalizeConfiguredRetentionDays(env.PHONEDEX_RETENTION_DAYS)
  };
}

function defaultCodexBin() {
  if (process.platform === "win32") return "codex.exe";
  return "/Applications/Codex.app/Contents/Resources/codex";
}

function defaultAppServerCodexBin() {
  const standaloneBin = path.join(os.homedir(), ".local", "bin", "codex");
  if (fs.existsSync(standaloneBin)) return standaloneBin;
  if (process.platform === "win32") return "codex.exe";
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
  console.log("1. Configure the native iOS app, or set pushcut in .env as a fallback");
  console.log("2. Run: npm run server");
  console.log("3. In Codex, open /hooks and trust the PhoneDex hook");
  console.log("4. Run: npm run test-notify");
}

function createPairingGrantCommand(args) {
  const cfg = config();
  ensureDataDir(cfg.dataDir);
  const flags = parseFlags(args);
  const role = normalizeRole(flags.role || "phone");
  const scopes = flags.scopes === undefined
    ? undefined
    : assertSupportedScopes(String(flags.scopes).split(",").map((scope) => scope.trim()).filter(Boolean));
  const grant = createPairingGrant({
    role,
    name: flags.name || (role === "phone" ? "PhoneDex iPhone" : "PhoneDex agent"),
    platform: flags.platform || (role === "phone" ? "ios" : "unknown"),
    scopes,
    ttlMs: positiveNumber(flags.ttlMs || flags["ttl-ms"] || flags.ttl, cfg.pairingTtlMs)
  });
  durableStore(cfg.dataDir).createPairingGrant(grant.stored);
  console.log(JSON.stringify({
    bridgeUrl: cfg.publicUrl,
    ...grant.public,
    instructions: "Enter the grant and verification code in the PhoneDex app. Keep both private."
  }, null, 2));
}

function listPairingIdentitiesCommand(args) {
  const cfg = config();
  ensureDataDir(cfg.dataDir);
  const identities = durableStore(cfg.dataDir)
    .listIdentities()
    .map(publicIdentity);
  const flags = parseFlags(args);

  if (flags.json) {
    console.log(JSON.stringify(identities, null, 2));
    return;
  }

  if (identities.length === 0) {
    console.log("No paired PhoneDex identities.");
    return;
  }

  for (const identity of identities) {
    console.log(`${identity.id} ${identity.status} ${identity.name} (${identity.role})`);
    console.log(`  device: ${identity.deviceId} · platform: ${identity.platform}`);
    console.log(`  scopes: ${identity.scopes.join(", ") || "none"}`);
    console.log(`  last seen: ${identity.lastSeenAt}`);
    if (identity.revokedAt) console.log(`  revoked: ${identity.revokedAt}`);
  }
}

function revokePairingIdentityCommand(args) {
  const cfg = config();
  ensureDataDir(cfg.dataDir);
  const flags = parseFlags(args);
  const identityId = String(flags.identity || flags["identity-id"] || "").trim();
  const deviceId = String(flags.device || flags["device-id"] || "").trim();
  if (!identityId && !deviceId) {
    throw new Error("Pass --identity ID or --device-id DEVICE_ID to revoke a paired identity.");
  }

  const result = durableStore(cfg.dataDir).revokeIdentity({
    identityId: identityId || undefined,
    deviceId: deviceId || undefined,
    reason: flags.reason || "hub-owner-revoked"
  });
  if (!result.found) {
    throw new Error(`No paired identity matched ${identityId || deviceId}.`);
  }

  const output = {
    ok: true,
    changed: result.changed,
    identity: publicIdentity(result.identity)
  };
  appendSecurityAudit(cfg.dataDir, {
    action: "identity.revoke",
    outcome: result.changed ? "success" : "already-revoked",
    identityId: result.identity.id,
    role: result.identity.role,
    reason: flags.reason || "hub-owner-revoked"
  });
  if (flags.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(result.changed
    ? `Revoked PhoneDex identity ${result.identity.id} (${result.identity.name}).`
    : `PhoneDex identity ${result.identity.id} is already revoked.`);
}

function rotatePairingIdentityCommand(args) {
  const cfg = config();
  ensureDataDir(cfg.dataDir);
  const flags = parseFlags(args);
  const identityId = String(flags.identity || flags["identity-id"] || "").trim();
  const deviceId = String(flags.device || flags["device-id"] || "").trim();
  if (!identityId && !deviceId) {
    throw new Error("Pass --identity ID or --device-id DEVICE_ID to rotate a paired identity.");
  }

  const result = durableStore(cfg.dataDir).rotateIdentity({
    identityId: identityId || undefined,
    deviceId: deviceId || undefined
  });
  if (!result.found) {
    throw new Error(`No paired identity matched ${identityId || deviceId}.`);
  }
  if (!result.changed) {
    throw new Error("Revoked PhoneDex identities cannot be rotated; pair the device again.");
  }

  appendSecurityAudit(cfg.dataDir, {
    action: "identity.rotate",
    outcome: "success",
    identityId: result.identity.id,
    role: result.identity.role
  });
  const output = {
    ok: true,
    credential: result.credential,
    identity: publicIdentity(result.identity),
    instructions: "Store this credential in the paired client now. It will not be shown again."
  };
  if (flags.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  console.log(`Rotated PhoneDex identity ${result.identity.id}.`);
  console.log(`New credential: ${result.credential}`);
  console.log(output.instructions);
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
  const messageId = findFirstKey(payload, [
    "messageId",
    "message_id",
    "turnId",
    "turn_id",
    "eventId",
    "event_id"
  ]);

  const title = `Codex done: ${projectName}`;
  const text = buildTaskMessage(payload);
  const task = createTask({
    source: "codex-stop-hook",
    title,
    text,
    cwd,
    sessionId,
    messageId,
    hookPayload: summarizePayload(payload),
    rawHookInputBytes: Buffer.byteLength(rawInput || "")
  });

  await recordTaskAndDispatch(cfg, task);
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

  await recordTaskAndDispatch(cfg, task);
}

async function recordTaskAndDispatch(cfg, task, options = {}) {
  const result = durableStore(cfg.dataDir).appendTask(task, (candidate) =>
    isDuplicateTask(candidate, task),
    mergeTaskCaptures
  );
  if (!result.created) {
    const duplicate = result.task;
    return { task: duplicate, created: false, merged: Boolean(result.merged) };
  }

  // Keep the legacy file for existing local tooling while the transactional
  // snapshot is the source of truth for bridge reads and writes.
  appendJsonl(cfg.dataDir, "tasks.jsonl", task);

  const forward =
    options.forward !== false
      ? await maybeForwardTaskToHub(cfg, task)
      : { ok: true, skipped: true, reason: "forward disabled" };

  const shouldNotify = options.notify !== false && !cfg.agentMode;
  if (shouldNotify) {
    await sendWatchNotification(cfg, task);
  }

  return { task, created: true, forward };
}

function mergeTaskCaptures(existing, incoming) {
  const merged = {
    ...existing,
    captureSources: normalizeCaptureSources([
      ...(Array.isArray(existing.captureSources) ? existing.captureSources : []),
      ...(Array.isArray(incoming.captureSources) ? incoming.captureSources : [])
    ])
  };

  if (!merged.question && incoming.question) merged.question = incoming.question;

  for (const field of ["logicalEventId", "messageId", "sessionId", "cwd"]) {
    if (!merged[field] && incoming[field]) merged[field] = incoming[field];
  }
  if ((!merged.text || merged.text === "Task completed") && incoming.text) {
    merged.text = incoming.text;
  }
  if (!merged.hookPayload && incoming.hookPayload) merged.hookPayload = incoming.hookPayload;
  return merged;
}

function isDuplicateTask(candidate, task) {
  const taskAt = Date.parse(task.at || task.createdAt || "");
  const sameOrigin = (candidate) => {
    const originTaskId = task.originTaskId || task.id || "";
    if (!originTaskId) return false;
    return (
      candidate.originTaskId === originTaskId ||
      candidate.id === originTaskId ||
      candidate.originTaskId === task.id
    );
  };
  const sameDevice = (candidate) => {
    if (task.deviceId && candidate.deviceId) return task.deviceId === candidate.deviceId;
    if (task.machineName && candidate.machineName) return task.machineName === candidate.machineName;
    return true;
  };

  if (!candidate || candidate.parseError) return false;
  if (
    task.logicalEventId &&
    candidate.logicalEventId === task.logicalEventId &&
    sameDevice(candidate)
  ) {
    return true;
  }
  if (sameOrigin(candidate) && sameDevice(candidate)) return true;
  if (
    task.messageId &&
    candidate.messageId === task.messageId &&
    task.sessionId &&
    candidate.sessionId === task.sessionId
  ) {
    return true;
  }
  if (!task.sessionId || candidate.sessionId !== task.sessionId) return false;
  if (candidate.text !== task.text) return false;
  const candidateAt = Date.parse(candidate.at || candidate.createdAt || "");
  return (
    !Number.isNaN(taskAt) &&
    !Number.isNaN(candidateAt) &&
    Math.abs(taskAt - candidateAt) < 5 * 60 * 1000
  );
}

async function maybeForwardTaskToHub(cfg, task) {
  if (!cfg.hubUrl || isSameBaseUrl(cfg.hubUrl, cfg.publicUrl)) {
    return {
      ok: true,
      skipped: true,
      reason: !cfg.hubUrl ? "PHONEDEX_HUB_URL is not configured" : "hubUrl matches publicUrl"
    };
  }

  const event = {
    at: new Date().toISOString(),
    type: "hub-forward-attempt",
    taskId: task.id,
    hubUrl: redactSensitiveText(cfg.hubUrl),
    machineName: task.machineName || cfg.machineName
  };

  try {
    const response = await fetch(`${cfg.hubUrl}/tasks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cfg.hubToken ? { authorization: `Bearer ${cfg.hubToken}` } : {}),
        "x-phonedex-device-id": cfg.deviceId
      },
      body: JSON.stringify({
        token: cfg.hubToken,
        task: {
          ...task,
          deviceId: task.deviceId || cfg.deviceId,
          machineName: task.machineName || cfg.machineName,
          replyUrl: cfg.replyUrl,
          publicUrl: cfg.publicUrl,
          replyToken: cfg.token
        }
      })
    });
    const responseText = await response.text();
    appendJsonl(cfg.dataDir, "events.jsonl", {
      ...event,
      status: response.status,
      ok: response.ok,
      response: redactSensitiveText(responseText).slice(0, 500)
    });
    return {
      ok: response.ok,
      status: response.status,
      response: redactSensitiveText(responseText).slice(0, 500)
    };
  } catch (error) {
    appendJsonl(cfg.dataDir, "events.jsonl", {
      ...event,
      ok: false,
      error: redactSensitiveText(error.message)
    });
    return {
      ok: false,
      error: redactSensitiveText(error.message)
    };
  }
}

async function sendWatchNotification(cfg, task) {
  const event = {
    at: new Date().toISOString(),
    type: "notification-attempt",
    taskId: task.id,
    provider: cfg.provider,
    hasPushcutWebhook: Boolean(cfg.pushcutWebhookUrl)
  };

  if (cfg.provider !== "pushcut") {
    appendJsonl(cfg.dataDir, "events.jsonl", {
      ...event,
      skipped: true,
      reason: `Unsupported notification provider: ${cfg.provider}`
    });
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
    response: redactSensitiveText(responseText).slice(0, 500)
  });

  if (!response.ok) {
    throw new Error(`Pushcut returned HTTP ${response.status}: ${redactSensitiveText(responseText)}`);
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
          machineName: task.machineName || cfg.machineName
        })
      }
    };
  });

  return {
    title: formatNotificationTitle(cfg, task),
    text: formatPhoneNotificationMessage(task),
    sound: cfg.pushcutSound,
    isTimeSensitive: cfg.pushcutTimeSensitive,
    threadId: "phonedex",
    id: task.id,
    input: JSON.stringify({
      taskId: task.id,
      cwd: task.cwd,
      sessionId: task.sessionId || "",
      machineName: task.machineName || cfg.machineName,
      replyUrl: cfg.replyUrl
    }),
    actions
  };
}

function isScopedBearerAuthorized(req, cfg, scope) {
  if (!cfg.token) return true;
  const authHeader = req.headers.authorization || "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const bearerToken = bearerMatch ? bearerMatch[1].trim() : "";
  if (bearerToken === cfg.token) return true;

  return hasScope(findIdentityForRequest(req, cfg), scope);
}

function isRequestAuthorized(req, requestUrl, cfg, scope) {
  if (!cfg.token) return true;
  if (requestUrl.searchParams.get("token") === cfg.token) return true;

  const authHeader = req.headers.authorization || "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const bearerToken = bearerMatch ? bearerMatch[1].trim() : "";
  if (bearerToken === cfg.token) return true;

  const identity = findIdentityForRequest(req, cfg);
  return Boolean(identity && (!scope || hasScope(identity, scope)));
}

function findIdentityForRequest(req, cfg) {
  const authHeader = req.headers.authorization || "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const bearerToken = bearerMatch ? bearerMatch[1].trim() : "";
  if (!bearerToken) return null;
  return durableStore(cfg.dataDir).findIdentityByCredentialHash(hashSecret(bearerToken)) || null;
}

function formatNotificationTitle(cfg, task) {
  const machineName = task.machineName || cfg.machineName;
  if (!machineName) return task.title;
  return `${task.title} @ ${machineName}`;
}

function formatPhoneNotificationMessage(task) {
  const text = normalizeNotificationText(task.text || "Task completed");
  if (task.source === "agent-install-report") return text;
  if (/^completed[:\s]/i.test(text)) return text;
  return `Completed: ${text}`;
}

async function startServer(providedCfg) {
  const cfg = providedCfg || config();
  ensureDataDir(cfg.dataDir);
  const pairingAttempts = new Map();
  const requestRateLimiter = createRequestRateLimiter({
    limit: cfg.authRateLimit,
    windowMs: cfg.authRateLimitWindowMs
  });

  if (cfg.retentionDays > 0) {
    try {
      createPhoneDexPrivacy(cfg.dataDir).applyRetention(cfg.retentionDays, { audit: false });
    } catch (error) {
      console.warn(`Warning: PhoneDex retention was not applied: ${error.message}`);
    }
  }

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
          deviceId: cfg.deviceId,
          publicUrl: cfg.publicUrl,
          replyUrl: cfg.replyUrl,
          role: cfg.agentMode ? "agent" : "hub",
          hubUrl: cfg.hubUrl || "",
          protocolVersion: 1,
          supportedProtocolVersions: [1],
          capabilities: defaultCapabilities(cfg.agentMode ? "agent" : "hub"),
          adapter: cfg.adapter
        });
      }

      if (requestUrl.pathname === "/pair") {
        return handlePairRequest(req, res, cfg, pairingAttempts);
      }

      if (requestUrl.pathname !== "/health") {
        const rateLimit = requestRateLimiter.consume(requestRateLimitKey(req, cfg));
        if (!rateLimit.allowed) {
          appendSecurityAudit(cfg.dataDir, {
            action: "request.rate-limit",
            outcome: "blocked",
            identityId: findIdentityForRequest(req, cfg)?.id,
            route: requestUrl.pathname,
            reason: "authenticated request window exceeded"
          });
          return sendJson(res, 429, {
            ok: false,
            code: "rate_limited",
            error: "Too many PhoneDex requests. Wait briefly and try again."
          }, { "retry-after": String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))) });
        }
      }

      if (
        requestUrl.pathname === "/privacy" ||
        requestUrl.pathname === "/privacy/export" ||
        requestUrl.pathname === "/privacy/retention" ||
        requestUrl.pathname === "/privacy/delete"
      ) {
        return handlePrivacyRequest(req, res, requestUrl, cfg);
      }

      if (requestUrl.pathname === "/reply") {
        return handleReplyRequest(req, res, requestUrl, cfg);
      }

      if (requestUrl.pathname === "/task") {
        return handleTaskPageRequest(req, res, requestUrl, cfg);
      }

      if (requestUrl.pathname === "/replies") {
        if (!isRequestAuthorized(req, requestUrl, cfg, "tasks.read")) {
          return sendJson(res, 401, { ok: false, error: "Invalid token" });
        }
        return sendJson(res, 200, readJsonl(cfg.dataDir, "replies.jsonl").slice(-25));
      }

      if (requestUrl.pathname === "/tasks") {
        if (req.method === "POST") {
          return handleTaskIngestRequest(req, res, requestUrl, cfg);
        }
        if (!isRequestAuthorized(req, requestUrl, cfg, "tasks.read")) {
          return sendJson(res, 401, { ok: false, error: "Invalid token" });
        }
        const tasks = readJsonl(cfg.dataDir, "tasks.jsonl");
        const requestedLimit = requestUrl.searchParams.get("limit");
        const visibleTasks = requestedLimit === "all"
          ? tasks
          : tasks.slice(-parseTaskListLimit(requestedLimit));
        return sendJson(res, 200, visibleTasks.map(publicTask));
      }

      if (requestUrl.pathname === "/sync") {
        if (req.method !== "GET") {
          return sendJson(res, 405, { ok: false, error: "GET required" });
        }
        if (!isRequestAuthorized(req, requestUrl, cfg, "tasks.read")) {
          return sendJson(res, 401, { ok: false, error: "Invalid token" });
        }

        try {
          negotiateProtocolVersion(req.headers["x-phonedex-protocol-version"]);
          negotiateCapabilities(req.headers["x-phonedex-capabilities"]);
        } catch (error) {
          if (error.code === "protocol_incompatible" || error.code === "capability_unsupported") {
            return sendJson(res, error.statusCode || 426, {
              ok: false,
              code: error.code,
              error: error.message,
              supportedProtocolVersions: error.supportedVersions || [1],
              ...(error.unsupportedCapabilities
                ? { unsupportedCapabilities: error.unsupportedCapabilities }
                : {})
            });
          }
          throw error;
        }

        try {
          const page = durableStore(cfg.dataDir).readSync({
            cursor: requestUrl.searchParams.get("cursor") || "",
            limit: normalizeSyncLimit(requestUrl.searchParams.get("limit"))
          });
          return sendJson(res, 200, publicSyncPage(page));
        } catch (error) {
          if (error.code === "sync_cursor_invalid") {
            return sendJson(res, 400, { ok: false, error: error.message, code: error.code });
          }
          if (error.code === "sync_snapshot_changed") {
            return sendJson(res, 409, { ok: false, error: error.message, code: error.code });
          }
          throw error;
        }
      }

      if (requestUrl.pathname === "/devices/heartbeat") {
        return handleDeviceHeartbeatRequest(req, res, requestUrl, cfg);
      }

      if (requestUrl.pathname === "/agent-installs") {
        if (req.method === "POST") {
          return handleAgentInstallReportRequest(req, res, requestUrl, cfg);
        }
        if (!isRequestAuthorized(req, requestUrl, cfg, "admin")) {
          return sendJson(res, 401, { ok: false, error: "Invalid token" });
        }
        return sendJson(
          res,
          200,
          readJsonl(cfg.dataDir, AGENT_INSTALLS_FILE).slice(-50).map(publicAgentInstallReport)
        );
      }

      if (requestUrl.pathname === "/devices") {
        if (!isRequestAuthorized(req, requestUrl, cfg, "tasks.read")) {
          return sendJson(res, 401, { ok: false, error: "Invalid token" });
        }
        return sendJson(res, 200, listDeviceCoverage(cfg));
      }

      if (
        requestUrl.pathname === "/agent-bootstrap" ||
        requestUrl.pathname === "/agent-bootstrap/" ||
        requestUrl.pathname.startsWith("/agent-bootstrap/")
      ) {
        return handleAgentBootstrapRequest(req, res, requestUrl, cfg);
      }

      sendJson(res, 200, {
        service: "watchdex",
        endpoints: [
          "/health",
          "/pair",
          "/privacy",
          "/privacy/export",
          "/privacy/retention",
          "/privacy/delete",
          "/reply",
          "/task",
          "/replies",
          "/tasks",
          "/sync",
          "/devices",
          "/devices/heartbeat",
          "/agent-installs",
          "/agent-bootstrap"
        ]
      });
    } catch (error) {
      logError(error);
      sendJson(res, 500, { ok: false, error: error.message });
    }
  });

  await new Promise((resolve) => server.listen(cfg.port, cfg.host, resolve));
  console.log(`PhoneDex listening on http://${cfg.host}:${cfg.port}`);
  console.log(`Phone reply callback public URL should be: ${cfg.publicUrl}/reply`);
  if (cfg.hubUrl) {
    console.log(`Forwarding local Codex completions to PhoneDex hub: ${cfg.hubUrl}`);
  }

  return server;
}

async function handlePrivacyRequest(req, res, requestUrl, cfg) {
  const requiredScope = req.method === "GET" ? "privacy.read" : "privacy.manage";
  if (!isScopedBearerAuthorized(req, cfg, requiredScope)) {
    return sendJson(res, 401, { ok: false, error: "Invalid token" });
  }

  const privacy = createPhoneDexPrivacy(cfg.dataDir);
  if (req.method === "GET" && requestUrl.pathname === "/privacy") {
    return sendJson(res, 200, privacy.summary());
  }
  if (req.method === "GET" && requestUrl.pathname === "/privacy/export") {
    return sendJson(res, 200, privacy.exportData());
  }
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "GET or POST required" });
  }

  const body = parseBodyFields(await readHttpBody(req), req.headers["content-type"] || "");
  try {
    if (requestUrl.pathname === "/privacy/retention") {
      if (body.confirmation !== RETENTION_CONFIRMATION) {
        return sendJson(res, 400, {
          ok: false,
          code: "privacy_confirmation_required",
          error: `Confirmation must be ${RETENTION_CONFIRMATION}.`
        });
      }
      const result = privacy.applyRetention(normalizeRetentionDays(body.retentionDays));
      return sendJson(res, 200, { ok: true, ...result });
    }
    if (requestUrl.pathname === "/privacy/delete") {
      const result = privacy.deleteHistory({ confirmation: body.confirmation });
      return sendJson(res, 200, { ok: true, ...result });
    }
    return sendJson(res, 404, { ok: false, error: "Unknown privacy endpoint" });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      ok: false,
      code: error.code || "privacy_request_failed",
      error: error.message
    });
  }
}

async function handlePairRequest(req, res, cfg, pairingAttempts) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "POST required" });
  }

  const remoteAddress = req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const recentAttempts = (pairingAttempts.get(remoteAddress) || [])
    .filter((timestamp) => now - timestamp < PAIRING_ATTEMPT_WINDOW_MS);
  if (recentAttempts.length >= DEFAULT_PAIRING_ATTEMPTS) {
    pairingAttempts.set(remoteAddress, recentAttempts);
    return sendJson(res, 429, {
      ok: false,
      code: "pairing_rate_limited",
      error: "Too many pairing attempts. Wait a minute and try again."
    });
  }
  recentAttempts.push(now);
  pairingAttempts.set(remoteAddress, recentAttempts);

  const body = await readHttpBody(req);
  const fields = parseBodyFields(body, req.headers["content-type"] || "");
  const grant = typeof fields.grant === "string" ? fields.grant.trim() : "";
  const verificationCode = typeof fields.verificationCode === "string"
    ? fields.verificationCode.trim()
    : "";
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(grant) || !/^\d{6}$/.test(verificationCode)) {
    return sendJson(res, 400, {
      ok: false,
      code: "pairing_invalid",
      error: "Enter the complete pairing grant and six-digit verification code."
    });
  }

  const store = durableStore(cfg.dataDir);
  const storedGrant = store.listPairingGrants().find(
    (candidate) => secretsMatch(candidate.grantHash, hashSecret(grant))
  );
  const nowISO = new Date(now).toISOString();
  if (!storedGrant) {
    return sendJson(res, 400, {
      ok: false,
      code: "pairing_invalid",
      error: "That pairing grant is not valid. Generate a new grant on the hub."
    });
  }
  if (storedGrant.usedAt) {
    return sendJson(res, 410, {
      ok: false,
      code: "pairing_used",
      error: "That pairing grant was already used. Generate a new grant on the hub."
    });
  }
  if (Date.parse(storedGrant.expiresAt || "") <= now) {
    return sendJson(res, 410, {
      ok: false,
      code: "pairing_expired",
      error: "That pairing grant expired. Generate a new grant on the hub."
    });
  }

  const deviceName = normalizePairingField(fields.deviceName || fields.name, storedGrant.name, 160);
  const deviceId = normalizePairingField(fields.deviceId, `${storedGrant.role}-${crypto.randomBytes(6).toString("hex")}`, 120);
  const platform = normalizePairingField(
    fields.platform,
    storedGrant.platform || (storedGrant.role === "phone" ? "ios" : "unknown"),
    40
  );
  const credentials = createIdentity({
    grant: storedGrant,
    deviceId,
    name: deviceName,
    platform,
    now: new Date(now)
  });
  const redemption = store.redeemPairingGrant({
    grantHash: storedGrant.grantHash,
    verificationCodeHash: hashSecret(verificationCode),
    identity: credentials.identity,
    now: nowISO
  });
  if (!redemption.ok) {
    const status = redemption.code === "pairing_used" || redemption.code === "pairing_expired" ? 410 : 400;
    return sendJson(res, status, {
      ok: false,
      code: redemption.code,
      error: status === 410
        ? "That pairing grant is no longer available. Generate a new grant on the hub."
        : "The verification code does not match this pairing grant."
    });
  }

  recordDeviceHeartbeat(cfg.dataDir, addDeviceProtocolFields({
    deviceId: credentials.identity.deviceId,
    machineName: credentials.identity.name,
    platform: credentials.identity.platform,
    role: credentials.identity.role,
    status: "online",
    health: { agent: "unknown", adapter: "unknown" },
    lastSeenAt: nowISO
  }));
  appendSecurityAudit(cfg.dataDir, {
    action: "identity.pair",
    outcome: "success",
    identityId: credentials.identity.id,
    role: credentials.identity.role,
    route: "/pair"
  });

  return sendJson(res, 201, {
    ok: true,
    credential: credentials.credential,
    identity: publicIdentity(credentials.identity)
  }, { "cache-control": "no-store" });
}

function normalizePairingField(value, fallback, maxLength) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return (normalized || fallback).slice(0, maxLength);
}

function normalizeConfiguredRetentionDays(value) {
  if (value === undefined || value === "") return 0;
  return normalizeRetentionDays(value);
}

function parseTaskListLimit(value) {
  if (value === null || value === "") return 25;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 25;
  return Math.min(parsed, 500);
}

function publicSyncPage(page) {
  return {
    schema: SYNC_SCHEMA,
    protocolVersion: 1,
    protocol: {
      negotiatedVersion: 1,
      supportedVersions: [1],
      capabilities: defaultCapabilities("hub")
    },
    revision: page.revision,
    position: page.position,
    snapshot: page.snapshot
      ? {
          ...page.snapshot,
          tasks: page.snapshot.tasks.map(publicSyncTask),
          devices: page.snapshot.devices.map(publicDevice)
        }
      : null,
    changes: page.changes.map((change) => ({
      position: change.position,
      kind: change.kind,
      id: change.id,
      deleted: change.deleted,
      ...(change.deleted
        ? {}
        : { record: change.kind === "task" ? publicSyncTask(change.record) : publicDevice(change.record) })
    })),
    cursor: page.cursor,
    hasMore: page.hasMore,
    updatedAt: page.updatedAt
  };
}

async function startService(args) {
  const cfg = config();
  ensureDataDir(cfg.dataDir);
  await startServer(cfg);
  await startDeviceHeartbeat(cfg);
  await startCoverageWatcher(cfg);
  await startSessionWatcher(cfg, args);
  console.log(`PhoneDex service running as ${cfg.agentMode ? "agent" : "hub"}.`);
}

async function handleTaskIngestRequest(req, res, requestUrl, cfg) {
  const body = await readHttpBody(req);
  const fields = {
    ...Object.fromEntries(requestUrl.searchParams.entries()),
    ...parseBodyFields(body, req.headers["content-type"] || "")
  };
  const token = fields.token || "";

  if (cfg.token && token !== cfg.token && !isRequestAuthorized(req, requestUrl, cfg, "tasks.ingest")) {
    return sendJson(res, 401, { ok: false, error: "Invalid token" });
  }

  const incoming = fields.task && typeof fields.task === "object" ? fields.task : fields;
  let task;
  try {
    task = createIngestedTask(incoming, cfg, req);
  } catch (error) {
    if (Array.isArray(error.validationErrors)) {
      return sendJson(res, 400, {
        ok: false,
        code: "invalid_task_question",
        error: "The task question is invalid.",
        details: error.validationErrors
      });
    }
    throw error;
  }
  const result = await recordTaskAndDispatch(cfg, task, {
    forward: false,
    notify: !cfg.agentMode
  });

  sendJson(res, result.created ? 201 : 200, {
    ok: true,
    duplicate: !result.created,
    task: publicTask(result.task)
  });
}

async function handleDeviceHeartbeatRequest(req, res, requestUrl, cfg) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "POST required" });
  }

  const body = await readHttpBody(req);
  const fields = {
    ...Object.fromEntries(requestUrl.searchParams.entries()),
    ...parseBodyFields(body, req.headers["content-type"] || "")
  };
  const token = fields.token || "";

  if (cfg.token && token !== cfg.token && !isRequestAuthorized(req, requestUrl, cfg, "devices.heartbeat")) {
    return sendJson(res, 401, { ok: false, error: "Invalid token" });
  }

  const incoming = fields.device && typeof fields.device === "object" ? fields.device : fields;
  const device = normalizeDeviceHeartbeat(incoming, req);
  recordDeviceHeartbeat(cfg.dataDir, device);
  sendJson(res, 200, { ok: true, device });
}

async function handleAgentInstallReportRequest(req, res, requestUrl, cfg) {
  const body = await readHttpBody(req);
  const fields = {
    ...Object.fromEntries(requestUrl.searchParams.entries()),
    ...parseBodyFields(body, req.headers["content-type"] || "")
  };
  const token = fields.token || "";

  if (cfg.token && token !== cfg.token && !isRequestAuthorized(req, requestUrl, cfg, "devices.heartbeat")) {
    return sendJson(res, 401, { ok: false, error: "Invalid token" });
  }

  const report = createAgentInstallReport(fields, req);
  appendJsonl(cfg.dataDir, AGENT_INSTALLS_FILE, report);
  const notification = await maybeNotifyAgentInstallReport(cfg, report);
  sendJson(res, 201, {
    ok: true,
    report: publicAgentInstallReport(report),
    notification
  });
}

async function handleAgentBootstrapRequest(req, res, requestUrl, cfg) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { ok: false, error: "GET required" });
  }

  if (!cfg.token) {
    return sendJson(res, 403, {
      ok: false,
      error: "WATCH_BRIDGE_TOKEN is required to serve agent bootstrap files"
    });
  }

  const inviteRequest = agentBootstrapInviteRequest(requestUrl.pathname);
  if (inviteRequest) {
    if (inviteRequest.invalid) {
      return sendHtml(
        res,
        401,
        renderMessagePage("PhoneDex Agent Setup", "Invite link not found or expired."),
        { "cache-control": "no-store" }
      );
    }

    const invite = validateAgentInvite(cfg, inviteRequest.code);
    if (!invite.ok) {
      return sendHtml(
        res,
        401,
        renderMessagePage("PhoneDex Agent Setup", invite.error),
        { "cache-control": "no-store" }
      );
    }

    if (inviteRequest.fileName) {
      recordAgentInviteUse(cfg, invite.invite, {
        type: "download",
        fileName: inviteRequest.fileName,
        userAgent: req.headers["user-agent"] || ""
      });
      return sendAgentBootstrapFile(res, cfg, inviteRequest.fileName);
    }

    recordAgentInviteUse(cfg, invite.invite, {
      type: "page",
      userAgent: req.headers["user-agent"] || ""
    });
    const setup = {
      ...readAgentBootstrapSetup(cfg, { inviteCode: inviteRequest.code }),
      inviteExpiresAt: invite.invite.expiresAt,
      inviteCode: inviteRequest.code
    };
    return sendHtml(res, 200, renderAgentBootstrapSetupPage(setup), {
      "cache-control": "no-store"
    });
  }

  if (!isRequestAuthorized(req, requestUrl, cfg, "admin")) {
    return sendJson(res, 401, { ok: false, error: "Invalid token" });
  }

  if (
    requestUrl.pathname === "/agent-bootstrap/setup" ||
    requestUrl.pathname === "/agent-bootstrap/setup/"
  ) {
    const setup = readAgentBootstrapSetup(cfg);
    return sendHtml(res, 200, renderAgentBootstrapSetupPage(setup), {
      "cache-control": "no-store"
    });
  }

  if (requestUrl.pathname === "/agent-bootstrap/setup.json") {
    return sendJson(res, 200, readAgentBootstrapSetup(cfg));
  }

  const fileName = agentBootstrapFileName(requestUrl.pathname);
  if (!fileName) {
    return sendJson(res, 400, { ok: false, error: "Invalid bootstrap filename" });
  }

  return sendAgentBootstrapFile(res, cfg, fileName);
}

function agentBootstrapFileName(pathname) {
  const prefix = "/agent-bootstrap";
  if (pathname === prefix || pathname === `${prefix}/`) return "manifest.json";
  if (!pathname.startsWith(`${prefix}/`)) return "";

  const rawName = pathname.slice(prefix.length + 1);
  if (!rawName || rawName.includes("/")) return "";

  let fileName;
  try {
    fileName = decodeURIComponent(rawName);
  } catch {
    return "";
  }

  if (!/^[A-Za-z0-9._-]+$/.test(fileName)) return "";
  if (fileName === "." || fileName === "..") return "";
  return fileName;
}

function sendAgentBootstrapFile(res, cfg, fileName) {
  const baseDir = path.resolve(cfg.agentBundleDir);
  const filePath = path.resolve(baseDir, fileName);
  if (!filePath.startsWith(`${baseDir}${path.sep}`)) {
    return sendJson(res, 400, { ok: false, error: "Invalid bootstrap path" });
  }

  let body;
  try {
    body = fs.readFileSync(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return sendJson(res, 404, { ok: false, error: "Bootstrap file not found" });
    }
    throw error;
  }

  return sendBuffer(res, 200, body, contentTypeForAgentBootstrapFile(fileName), {
    "cache-control": "no-store"
  });
}

function contentTypeForAgentBootstrapFile(fileName) {
  if (fileName.endsWith(".json")) return "application/json; charset=utf-8";
  if (fileName.endsWith(".sh")) return "text/x-shellscript; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function agentBootstrapInviteRequest(pathname) {
  const prefix = "/agent-bootstrap/invite/";
  if (!pathname.startsWith(prefix)) return null;
  const rawCode = pathname.slice(prefix.length).replace(/\/+$/, "");
  if (!rawCode) return { invalid: true };
  const parts = rawCode.split("/");
  if (parts.length > 2) return { invalid: true };

  let code;
  let fileName = "";
  try {
    code = decodeURIComponent(parts[0]);
    if (parts[1]) fileName = decodeURIComponent(parts[1]);
  } catch {
    return { invalid: true };
  }

  if (!/^[A-Za-z0-9_-]{12,80}$/.test(code)) return { invalid: true };
  if (fileName && !/^[A-Za-z0-9._-]+$/.test(fileName)) return { invalid: true };
  if (fileName === "." || fileName === "..") return { invalid: true };
  return { code, fileName, invalid: false };
}

function createAgentInvite(cfg, options = {}) {
  const ttlMs = positiveNumber(options.ttlMs, cfg.agentInviteTtlMs);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const invite = {
    code: crypto.randomBytes(12).toString("base64url"),
    createdAt: now.toISOString(),
    expiresAt,
    uses: 0
  };
  const invites = pruneAgentInvites(readAgentInvites(cfg), cfg, now);
  invites.push(invite);
  writeAgentInvites(cfg, pruneAgentInvites(invites, cfg, now));
  return publicAgentInvite(cfg, invite);
}

function validateAgentInvite(cfg, code) {
  const now = new Date();
  const invites = pruneAgentInvites(readAgentInvites(cfg), cfg, now);
  writeAgentInvites(cfg, invites);

  const invite = invites.find((candidate) => candidate.code === code);
  if (!invite) return { ok: false, error: "Invite link not found or expired." };
  if (Date.parse(invite.expiresAt || "") <= now.getTime()) {
    return { ok: false, error: "Invite link expired." };
  }
  return { ok: true, invite };
}

function recordAgentInviteUse(cfg, invite, event = {}) {
  const invites = readAgentInvites(cfg);
  const index = invites.findIndex((candidate) => candidate.code === invite.code);
  if (index < 0) return;
  const now = new Date().toISOString();
  const events = Array.isArray(invites[index].events) ? invites[index].events : [];
  const nextEvent = {
    at: now,
    type: event.type || "use",
    fileName: event.fileName || "",
    userAgent: String(event.userAgent || "").slice(0, 200)
  };
  invites[index] = {
    ...invites[index],
    uses: Number(invites[index].uses || 0) + 1,
    lastUsedAt: now,
    lastEventType: nextEvent.type,
    lastFileName: nextEvent.fileName,
    events: [...events.slice(-19), nextEvent]
  };
  writeAgentInvites(cfg, pruneAgentInvites(invites, cfg));
}

function readAgentInvites(cfg) {
  const state = readJsonFile(cfg.dataDir, AGENT_INVITES_FILE, { invites: [] });
  return Array.isArray(state.invites) ? state.invites : [];
}

function writeAgentInvites(cfg, invites) {
  writeJsonFile(cfg.dataDir, AGENT_INVITES_FILE, {
    updatedAt: new Date().toISOString(),
    invites
  });
}

function pruneAgentInvites(invites, cfg = {}, now = new Date()) {
  const nowMs = now.getTime();
  const active = invites.filter((invite) => Date.parse(invite.expiresAt || "") > nowMs);
  const maxActive = positiveNumber(cfg.agentInviteMaxActive, DEFAULT_AGENT_INVITE_MAX_ACTIVE);
  if (active.length <= maxActive) return active;

  const sorted = active.slice().sort(compareAgentInviteCreatedAt);
  const newest = sorted[sorted.length - 1];
  const selected = [newest];
  const remainingSlots = maxActive - selected.length;
  const used = sorted
    .slice(0, -1)
    .filter(agentInviteHasActivity)
    .slice(-remainingSlots);
  selected.push(...used);

  const stillAvailable = maxActive - selected.length;
  if (stillAvailable > 0) {
    const selectedCodes = new Set(selected.map((invite) => invite.code));
    selected.push(
      ...sorted
        .slice(0, -1)
        .filter((invite) => !selectedCodes.has(invite.code))
        .slice(-stillAvailable)
    );
  }

  return selected.sort(compareAgentInviteCreatedAt);
}

function compareAgentInviteCreatedAt(left, right) {
  const leftAt = Date.parse(left.createdAt || "");
  const rightAt = Date.parse(right.createdAt || "");
  return (Number.isNaN(leftAt) ? 0 : leftAt) - (Number.isNaN(rightAt) ? 0 : rightAt);
}

function agentInviteHasActivity(invite) {
  return Number(invite.uses || 0) > 0 || Boolean(invite.lastUsedAt);
}

function publicAgentInvite(cfg, invite) {
  return {
    code: invite.code,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    uses: Number(invite.uses || 0),
    lastUsedAt: invite.lastUsedAt || "",
    lastEventType: invite.lastEventType || "",
    lastFileName: invite.lastFileName || "",
    events: Array.isArray(invite.events) ? invite.events : [],
    setupUrl: `${cfg.publicUrl}/agent-bootstrap/invite/${encodeURIComponent(invite.code)}`
  };
}

function createAgentInstallReport(fields, req) {
  return {
    id: makeId("install"),
    at: new Date().toISOString(),
    deviceId: String(fields.deviceId || fields.device_id || "").slice(0, 120),
    machineName: String(fields.machineName || fields.machine || "").slice(0, 160),
    platform: String(fields.platform || "").slice(0, 40),
    stage: String(fields.stage || "unknown").slice(0, 80),
    ok: parseBoolean(fields.ok, true),
    message: String(fields.message || "").slice(0, 500),
    source: String(fields.source || "bootstrap-script").slice(0, 80),
    fileName: String(fields.fileName || fields.file_name || "").slice(0, 160),
    inviteCode: String(fields.inviteCode || fields.invite_code || "").slice(0, 120),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 200),
    receivedFrom: req.socket.remoteAddress || ""
  };
}

async function maybeNotifyAgentInstallReport(cfg, report) {
  const notifyStages = new Set(["started", "failed", "completed"]);
  if (cfg.agentMode || !notifyStages.has(report.stage)) {
    return { attempted: false, reason: "stage-not-notifiable" };
  }

  const task = createTask({
    source: "agent-install-report",
    title: `PhoneDex agent ${report.stage}`,
    text: formatAgentInstallNotificationText(report),
    cwd: ROOT,
    machineName: report.machineName || report.deviceId || "PhoneDex agent",
    deviceId: report.deviceId || report.machineName || "unknown-agent",
    sessionId: `agent-install:${report.deviceId || report.machineName || "unknown"}`,
    messageId: agentInstallNotificationMessageId(report),
    hookPayload: {
      installReportId: report.id,
      stage: report.stage,
      ok: report.ok,
      source: report.source
    }
  });

  try {
    const result = await recordTaskAndDispatch(cfg, task, { forward: false, notify: true });
    return {
      attempted: true,
      ok: true,
      created: result.created,
      taskId: result.task?.id || ""
    };
  } catch (error) {
    appendJsonl(cfg.dataDir, "events.jsonl", {
      at: new Date().toISOString(),
      type: "agent-install-notification-failed",
      installReportId: report.id,
      deviceId: report.deviceId,
      stage: report.stage,
      error: error.message
    });
    return {
      attempted: true,
      ok: false,
      error: error.message
    };
  }
}

function formatAgentInstallNotificationText(report) {
  const label = report.machineName || report.deviceId || "PhoneDex agent";
  const status = report.ok ? "OK" : "FAILED";
  const message = report.message ? `\n${report.message}` : "";
  let next = "\nNext: keep the setup page open; it will refresh as the install advances.";
  if (report.stage === "completed") {
    next = "\nNext: run npm run devices:verify on the hub.";
  } else if (report.stage === "failed") {
    next = "\nNext: open the setup page for the failing device and rerun the bootstrap command.";
  }

  return `Install ${report.stage} on ${label} [${report.deviceId || "unknown"}]: ${status}${message}${next}`;
}

function agentInstallNotificationMessageId(report) {
  const material = [
    report.deviceId || "",
    report.stage || "",
    report.ok ? "ok" : "failed",
    report.stage === "failed" ? report.message || "" : ""
  ].join("|");
  const digest = crypto.createHash("sha256").update(material).digest("hex").slice(0, 12);
  return `agent-install:${digest}`;
}

function publicAgentInstallReport(report) {
  if (!report || typeof report !== "object") return report;
  const {
    token,
    hubToken,
    hub_token,
    ...safeReport
  } = report;
  return safeReport;
}

function readAgentBootstrapSetup(cfg, options = {}) {
  const manifestPath = path.join(path.resolve(cfg.agentBundleDir), "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Agent bootstrap manifest not found at ${manifestPath}`);
    }
    throw error;
  }

  const hubUrl = trimTrailingSlash(manifest.hubUrl || cfg.publicUrl);
  const installReports = latestAgentInstallReportsByDevice(cfg.dataDir);
  const targets = (manifest.targets || []).map((target) => {
    const platform = target.platform || guessAgentPlatform(target);
    const downloadUrl = options.inviteCode
      ? agentBootstrapInviteDownloadUrl(hubUrl, options.inviteCode, target.fileName)
      : agentBootstrapDownloadUrl(hubUrl, target.fileName, cfg.token);
    return {
      deviceId: target.deviceId || "",
      machineName: target.machineName || target.deviceId || "",
      status: target.status || "",
      platform,
      fileName: target.fileName || "",
      downloadUrl,
      install: installReports.get(target.deviceId || "") || null,
      commands: agentBootstrapInstallCommands({ ...target, platform }, downloadUrl)
    };
  });

  return {
    generatedAt: manifest.generatedAt || "",
    hubUrl,
    setupUrl: options.inviteCode
      ? `${hubUrl}/agent-bootstrap/invite/${encodeURIComponent(options.inviteCode)}`
      : `${hubUrl}/agent-bootstrap/setup?token=${encodeURIComponent(cfg.token)}`,
    expectedDevices: manifest.expectedDevices || "",
    targets
  };
}

function latestAgentInstallReportsByDevice(dataDir) {
  const reports = readJsonl(dataDir, AGENT_INSTALLS_FILE).filter(
    (report) => report && !report.parseError
  );
  const byDevice = new Map();

  for (const report of reports) {
    const deviceId = report.deviceId || "";
    if (!deviceId) continue;
    const previous = byDevice.get(deviceId);
    const previousAt = Date.parse(previous?.at || "");
    const currentAt = Date.parse(report.at || "");
    const previousTime = Number.isNaN(previousAt) ? 0 : previousAt;
    const currentTime = Number.isNaN(currentAt) ? 0 : currentAt;
    if (!previous || currentTime >= previousTime) {
      byDevice.set(deviceId, publicAgentInstallReport(report));
    }
  }

  return byDevice;
}

function agentBootstrapDownloadUrl(hubUrl, fileName, token) {
  return `${hubUrl}/agent-bootstrap/${encodeURIComponent(fileName)}?token=${encodeURIComponent(token)}`;
}

function agentBootstrapInviteDownloadUrl(hubUrl, inviteCode, fileName) {
  return `${hubUrl}/agent-bootstrap/invite/${encodeURIComponent(inviteCode)}/${encodeURIComponent(fileName)}`;
}

function agentBootstrapInstallCommands(target, downloadUrl) {
  const fileName = target.fileName || "phonedex-agent";
  if (target.platform === "windows") {
    return [
      `Invoke-WebRequest "${powershellDoubleQuote(downloadUrl)}" -OutFile "${powershellDoubleQuote(fileName)}"`,
      `powershell -ExecutionPolicy Bypass -File .\\${powershellDoubleQuote(fileName)}`
    ];
  }

  return [
    `curl -fsSL "${shellDoubleQuote(downloadUrl)}" -o "${shellDoubleQuote(fileName)}"`,
    `chmod +x ./${shellDoubleQuote(fileName)}`,
    `./${shellDoubleQuote(fileName)}`
  ];
}

async function handleTaskPageRequest(req, res, requestUrl, cfg) {
  const token = requestUrl.searchParams.get("token") || "";
  if (cfg.token && token !== cfg.token) {
    return sendHtml(res, 401, renderMessagePage("PhoneDex", "Invalid token."));
  }

  const latestTask = latestJsonl(cfg.dataDir, "tasks.jsonl");
  const taskId = requestUrl.searchParams.get("id") || requestUrl.searchParams.get("taskId") || "";
  const task = taskId ? findTask(cfg.dataDir, taskId) : latestTask;

  if (!task) {
    return sendHtml(res, 404, renderMessagePage("PhoneDex", "Task not found."));
  }

  return sendHtml(res, 200, renderTaskPage(task));
}

async function handleReplyRequest(req, res, requestUrl, cfg) {
  const body = await readHttpBody(req);
  const fields = {
    ...Object.fromEntries(requestUrl.searchParams.entries()),
    ...parseBodyFields(body, req.headers["content-type"] || "")
  };

  if (cfg.token && fields.token !== cfg.token && !isRequestAuthorized(req, requestUrl, cfg, "tasks.reply")) {
    return sendJson(res, 401, { ok: false, error: "Invalid token" });
  }

  const latestTask = latestJsonl(cfg.dataDir, "tasks.jsonl");
  const requestedTaskId = fields.taskId || fields.task_id || "";
  const requestedSessionId = fields.sessionId || fields.session_id || "";
  const task = requestedTaskId ? findTask(cfg.dataDir, requestedTaskId) : latestTask;
  if (!task) {
    return sendJson(res, 404, { ok: false, error: "The selected PhoneDex task no longer exists." });
  }
  if (requestedSessionId && task.sessionId !== requestedSessionId) {
    return sendJson(res, 409, {
      ok: false,
      error: "The selected task no longer matches its Codex thread. Refresh PhoneDex and try again."
    });
  }

  const taskId = task.id;
  const taskVersion = Number.isInteger(task.version) && task.version >= 1 ? task.version : 1;
  const expectedTaskVersion = parseExpectedTaskVersion(
    fields.expectedTaskVersion || fields.expected_task_version
  );
  if (expectedTaskVersion.error) {
    return sendJson(res, 400, { ok: false, code: "invalid_task_version", error: expectedTaskVersion.error });
  }
  if (expectedTaskVersion.value && expectedTaskVersion.value !== taskVersion) {
    return sendJson(res, 409, {
      ok: false,
      code: "task_stale",
      error: "The task changed before this reply arrived. Refresh PhoneDex and review the latest context.",
      currentTaskVersion: taskVersion,
      task: publicTask(task)
    });
  }

  const questionResponse = parseQuestionResponse(fields, task.question);
  if (questionResponse.error) {
    return sendJson(res, questionResponse.status, {
      ok: false,
      code: questionResponse.code,
      error: questionResponse.error
    });
  }

  const idempotencyKeyValue = fields.idempotencyKey || fields.idempotency_key || "";
  if (idempotencyKeyValue && String(idempotencyKeyValue).length > 240) {
    return sendJson(res, 400, { ok: false, code: "invalid_idempotency_key", error: "The idempotency key is too long." });
  }
  const idempotencyKey = String(idempotencyKeyValue || makeId("reply-key"));
  const commandId = String(fields.commandId || fields.command_id || makeId("reply-command")).slice(0, 160);
  const actor = String(fields.actor || fields.requestedBy || "iphone").slice(0, 160);
  const choice = normalizeChoice(fields.choice || "okay_whats_next");
  const prompt =
    questionResponse.prompt ||
    fields.prompt ||
    fields.reply_text ||
    fields.replyText ||
    RESPONSE_CHOICES[choice] ||
    choice;
  const replyText = fields.reply_text || fields.replyText || "";
  const requestFingerprint = hashSecret(JSON.stringify({
    taskId,
    sessionId: requestedSessionId,
    expectedTaskVersion: expectedTaskVersion.value || taskVersion,
    choice,
    prompt,
    replyText
  }));
  const existingByCommand = findReplyByCommandId(cfg.dataDir, commandId);
  if (existingByCommand && existingByCommand.idempotencyKey !== idempotencyKey) {
    appendSecurityAudit(cfg.dataDir, {
      action: "reply.replay",
      outcome: "blocked",
      route: "/reply",
      reason: "command id reused with a different idempotency key"
    });
    return sendJson(res, 409, {
      ok: false,
      code: "command_replay_conflict",
      error: "The command id was already used for another reply. Create a new command."
    });
  }
  const existing = findReplyByIdempotencyKey(cfg.dataDir, idempotencyKey);
  if (existing) {
    if (existing.taskId !== taskId) {
      return sendJson(res, 409, {
        ok: false,
        code: "idempotency_conflict",
        error: "The idempotency key is already bound to another task."
      });
    }
    const existingFingerprint = existing.requestFingerprint || fingerprintReply(existing);
    if (existingFingerprint !== requestFingerprint) {
      appendSecurityAudit(cfg.dataDir, {
        action: "reply.replay",
        outcome: "blocked",
        route: "/reply",
        reason: "idempotency key reused with a different payload"
      });
      return sendJson(res, 409, {
        ok: false,
        code: "replay_conflict",
        error: "The idempotency key was already used for different reply content. Create a new command."
      });
    }
    const delivery = existing.deliveryState === "completed"
      ? { state: "completed", message: "Reply was already accepted by the originating agent.", originForward: { attempted: false, ok: true } }
      : await deliverReply(cfg, task, existing);
    const receipt = appendReplyReceipt(cfg, existing, delivery.state === "completed" ? "duplicate" : "failed", delivery.message, delivery.state === "completed" ? existing.id : undefined);
    if (delivery.state === "completed" && existing.deliveryState !== "completed") {
      appendJsonl(cfg.dataDir, "events.jsonl", {
        at: new Date().toISOString(),
        type: "reply-delivery-retried",
        commandId: existing.commandId,
        idempotencyKey,
        taskId: existing.taskId,
        deliveryState: delivery.state
      });
    }
    return sendJson(res, 200, {
      ok: true,
      duplicate: true,
      duplicateOf: existing.id,
      recorded: { ...existing, deliveryState: delivery.state },
      receipt
    });
  }

  const reply = {
    id: makeId("reply"),
    at: new Date().toISOString(),
    commandId,
    idempotencyKey,
    expectedTaskVersion: expectedTaskVersion.value || taskVersion,
    taskVersion,
    taskId,
    choice,
    prompt,
    action: fields.action || "",
    replyText,
    requestFingerprint,
    ...(questionResponse.value
      ? {
          questionId: questionResponse.value.questionId,
          questionResponse: questionResponse.value.response
        }
      : {}),
    taskTitle: task?.title || "",
    sessionId: task?.sessionId || "",
    cwd: task?.cwd || "",
    machineName: fields.machineName || fields.machine || task?.machineName || "",
    userAgent: req.headers["user-agent"] || ""
  };

  appendJsonl(cfg.dataDir, "commands.jsonl", createReplyCommand(reply, actor, "sent"));
  appendJsonl(cfg.dataDir, "replies.jsonl", reply);

  const delivery = await deliverReply(cfg, task, reply);
  reply.deliveryState = delivery.state;
  reply.deliveryMessage = delivery.message;
  appendJsonl(cfg.dataDir, "commands.jsonl", createReplyCommand(reply, actor, delivery.state === "completed" ? "acknowledged" : "failed"));
  const receipt = appendReplyReceipt(cfg, reply, delivery.state, delivery.message);
  appendSecurityAudit(cfg.dataDir, {
    action: "reply.accept",
    outcome: delivery.state,
    route: "/reply"
  });

  if (cfg.autoResume && !delivery.originForward.attempted) {
    attemptAutoResume(cfg, task, reply);
  }

  sendJson(res, 200, {
    ok: true,
    recorded: reply,
    receipt,
    forwardedToOrigin: delivery.originForward.ok,
    originForwardAttempted: delivery.originForward.attempted,
    autoResumeQueued: Boolean(cfg.autoResume && !delivery.originForward.attempted && task?.sessionId)
  });
}

function parseExpectedTaskVersion(value) {
  if (value === undefined || value === null || value === "") return { value: undefined };
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return { error: "expectedTaskVersion must be a positive integer." };
  }
  return { value: parsed };
}

function parseQuestionResponse(fields, taskQuestion) {
  const questionId = String(fields.questionId || fields.question_id || "").trim();
  const rawResponse = fields.response || fields.questionResponse || fields.question_response;
  const hasQuestionFields = Boolean(
    questionId || rawResponse || fields.choiceId || fields.choice_id || fields.responseText || fields.response_text
  );

  if (!taskQuestion) {
    return hasQuestionFields
      ? {
          status: 400,
          code: "question_not_available",
          error: "This task does not have a structured question to answer."
        }
      : { value: null, prompt: "" };
  }
  if (!questionId) {
    return {
      status: 400,
      code: "question_required",
      error: "questionId is required when answering a structured question."
    };
  }
  if (questionId !== taskQuestion.id) {
    return {
      status: 409,
      code: "question_stale",
      error: "This question changed before the response arrived. Refresh PhoneDex and review the latest context."
    };
  }

  let response = rawResponse;
  if (typeof response === "string") {
    try {
      response = JSON.parse(response);
    } catch {
      response = null;
    }
  }
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    const choiceId = fields.choiceId || fields.choice_id;
    const text = fields.responseText || fields.response_text;
    response = choiceId ? { kind: "choice", choiceId } : text ? { kind: "text", text } : null;
  }
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return {
      status: 400,
      code: "question_response_required",
      error: "Choose an answer or provide a text response."
    };
  }

  const kind = String(response.kind || "").trim();
  const choiceId = String(response.choiceId || response.choice_id || "").trim();
  const text = String(response.text || response.responseText || "").trim();
  if (!["choice", "text"].includes(kind)) {
    return {
      status: 400,
      code: "question_response_invalid",
      error: "A structured response must declare kind 'choice' or 'text'."
    };
  }
  if ((kind === "choice" && !choiceId) || (kind === "text" && !text)) {
    return {
      status: 400,
      code: "question_response_required",
      error: kind === "choice" ? "Choose one of the available options." : "Provide a non-empty text response."
    };
  }
  if ((kind === "choice" && text) || (kind === "text" && choiceId)) {
    return {
      status: 400,
      code: "question_response_ambiguous",
      error: "A structured response must match its declared kind."
    };
  }
  if (choiceId && text) {
    return {
      status: 400,
      code: "question_response_ambiguous",
      error: "A structured response must contain either a choice or text, not both."
    };
  }
  if (choiceId) {
    const choice = taskQuestion.choices.find((candidate) => candidate.id === choiceId);
    if (!choice) {
      return {
        status: 422,
        code: "question_choice_invalid",
        error: "That choice is not available for this question."
      };
    }
    return {
      value: {
        questionId,
        response: { kind: "choice", choiceId }
      },
      prompt: choice.label
    };
  }
  if (text && taskQuestion.allowsFreeText) {
    return {
      value: {
        questionId,
        response: { kind: "text", text: text.slice(0, 10000) }
      },
      prompt: text.slice(0, 10000)
    };
  }
  return {
    status: 422,
    code: "question_text_unavailable",
    error: taskQuestion.allowsFreeText
      ? "Provide a non-empty text response."
      : "This question only accepts one of its listed choices."
  };
}

function findReplyByIdempotencyKey(dataDir, idempotencyKey) {
  const reply = readJsonl(dataDir, "replies.jsonl")
    .slice()
    .reverse()
    .find((candidate) => candidate?.idempotencyKey === idempotencyKey);
  if (!reply) return undefined;

  const latestReceipt = readJsonl(dataDir, "command-receipts.jsonl")
    .slice()
    .reverse()
    .find((candidate) => candidate?.idempotencyKey === idempotencyKey);
  if (latestReceipt?.state === "completed" || latestReceipt?.state === "duplicate") {
    return { ...reply, deliveryState: "completed" };
  }
  return reply;
}

function findReplyByCommandId(dataDir, commandId) {
  if (!commandId) return undefined;
  return readJsonl(dataDir, "replies.jsonl")
    .slice()
    .reverse()
    .find((candidate) => candidate?.commandId === commandId);
}

function fingerprintReply(reply) {
  return hashSecret(JSON.stringify({
    taskId: reply.taskId || "",
    sessionId: reply.sessionId || "",
    expectedTaskVersion: reply.expectedTaskVersion || reply.taskVersion || 1,
    choice: reply.choice || "",
    prompt: reply.prompt || "",
    replyText: reply.replyText || reply.reply_text || ""
  }));
}

function requestRateLimitKey(req, cfg) {
  const identity = findIdentityForRequest(req, cfg);
  if (identity) return `identity:${identity.id}`;
  const authHeader = req.headers.authorization || "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) return `credential:${hashSecret(bearerMatch[1].trim())}`;
  return `network:${hashSecret(req.socket.remoteAddress || "unknown")}`;
}

function createReplyCommand(reply, actor, state) {
  return protocolRecord("command", {
    commandId: reply.commandId,
    createdAt: reply.at,
    kind: "reply",
    target: { taskId: reply.taskId },
    idempotencyKey: reply.idempotencyKey,
    state,
    payload: {
      choice: reply.choice,
      prompt: reply.prompt,
      replyText: reply.replyText || "",
      ...(reply.questionId
        ? { questionId: reply.questionId, response: reply.questionResponse }
        : {})
    },
    requestedBy: actor,
    actor,
    expectedTaskVersion: reply.expectedTaskVersion,
    expiresAt: new Date(Date.parse(reply.at) + 24 * 60 * 60 * 1000).toISOString(),
    requestedCapability: "task.reply.v1"
  });
}

function appendReplyReceipt(cfg, reply, state, message, duplicateOf) {
  const receipt = protocolRecord("commandReceipt", {
    commandId: reply.commandId,
    createdAt: new Date().toISOString(),
    state,
    taskId: reply.taskId,
    taskVersion: reply.taskVersion,
    idempotencyKey: reply.idempotencyKey,
    ...(message ? { message } : {}),
    ...(duplicateOf ? { duplicateOf } : {})
  });
  appendJsonl(cfg.dataDir, "command-receipts.jsonl", receipt);
  return receipt;
}

async function deliverReply(cfg, task, reply) {
  const originForward = await maybeForwardReplyToOrigin(cfg, task, reply);
  if (originForward.attempted && !originForward.ok) {
    return {
      state: "failed",
      message: "PhoneDex saved the reply, but the originating agent did not accept it. Retry when that device is reachable.",
      originForward
    };
  }
  return { state: "completed", message: "Reply accepted by the originating agent.", originForward };
}

async function maybeForwardReplyToOrigin(cfg, task, reply) {
  const originReplyUrl = task?.originReplyUrl || task?.replyUrl || "";
  if (!originReplyUrl || isSameBaseUrl(originReplyUrl, cfg.replyUrl)) {
    return { attempted: false, ok: false };
  }

  const event = {
    at: new Date().toISOString(),
    type: "origin-reply-forward-attempt",
    taskId: reply.taskId,
    originTaskId: task.originTaskId || "",
    originReplyUrl: redactSensitiveText(originReplyUrl),
    machineName: task.machineName || ""
  };

  try {
    const response = await fetch(originReplyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: task.originToken || task.replyToken || "",
        commandId: reply.commandId,
        idempotencyKey: reply.idempotencyKey,
        expectedTaskVersion: reply.expectedTaskVersion,
        actor: "phonedex-hub",
        taskId: task.originTaskId || task.id,
        choice: reply.choice,
        prompt: reply.prompt,
        reply_text: reply.replyText || "",
        ...(reply.questionId
          ? { questionId: reply.questionId, response: reply.questionResponse }
          : {}),
        machineName: task.machineName || ""
      })
    });
    const responseText = await response.text();
    appendJsonl(cfg.dataDir, "events.jsonl", {
      ...event,
      status: response.status,
      ok: response.ok,
      response: redactSensitiveText(responseText).slice(0, 500)
    });
    return { attempted: true, ok: response.ok };
  } catch (error) {
    appendJsonl(cfg.dataDir, "events.jsonl", {
      ...event,
      ok: false,
      error: redactSensitiveText(error.message)
    });
    return { attempted: true, ok: false };
  }
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

  if (!supportsAdapterCapability(cfg.adapter, "task.reply")) {
    appendJsonl(cfg.dataDir, "events.jsonl", {
      at: new Date().toISOString(),
      type: "auto-resume-skipped",
      reason: "Adapter does not support task replies",
      adapter: cfg.adapter,
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
  const foregroundApp =
    process.env.PHONEDEX_FOREGROUND_APP ||
    (fs.existsSync("/Applications/ChatGPT.app") ? "ChatGPT" : "Codex");
  const threadUrl = codexThreadUrl(task.sessionId);
  appendJsonl(cfg.dataDir, "events.jsonl", {
    at: new Date().toISOString(),
    type: "foreground-resume-worker-started",
    taskId: task.id,
    sessionId: task.sessionId || "",
    cwd: task.cwd || ROOT,
    foregroundApp,
    threadUrl
  });

  const script = `
on run argv
  set promptText to item 1 of argv
  set foregroundApp to item 2 of argv
  set previousClipboard to the clipboard
  delay 0.6
  set the clipboard to promptText
  tell application "System Events"
    tell process foregroundApp
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
    await runChild("open", threadUrl ? [threadUrl] : ["-a", foregroundApp], {
      cwd: task.cwd || ROOT
    });
    if (threadUrl) {
      const delayMs = Math.max(
        0,
        Number(process.env.PHONEDEX_FOREGROUND_THREAD_OPEN_DELAY_MS || "1200") || 0
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    await runChild("osascript", ["-e", script, prompt, foregroundApp], {
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

function codexThreadUrl(sessionId) {
  const value = String(sessionId || "").trim();
  return value ? `codex://threads/${encodeURIComponent(value)}` : "";
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
        name: "phonedex",
        title: "PhoneDex",
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
  await recordTaskAndDispatch(cfg, task);
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
  return addTaskProtocolFields({
    id: makeId("task"),
    at: new Date().toISOString(),
    source: fields.source || "unknown",
    title: fields.title || "Codex done",
    text: fields.text || "Task completed",
    cwd: fields.cwd || process.cwd(),
    machineName:
      fields.machineName ||
      process.env.PHONEDEX_MACHINE_NAME ||
      process.env.WATCHDEX_MACHINE_NAME ||
      os.hostname(),
    deviceId:
      fields.deviceId ||
      process.env.PHONEDEX_DEVICE_ID ||
      process.env.WATCHDEX_DEVICE_ID ||
      os.hostname(),
    sessionId: fields.sessionId || "",
    messageId: fields.messageId || "",
    hookPayload: fields.hookPayload,
    rawHookInputBytes: fields.rawHookInputBytes,
    ...(fields.question ? { question: normalizeTaskQuestion(fields.question) } : {})
  });
}

function createIngestedTask(fields, cfg, req) {
  const originTaskId = fields.id || fields.taskId || fields.task_id || "";
  const machineName = fields.machineName || fields.machine || fields.host || "Unknown device";
  const deviceId =
    fields.deviceId ||
    fields.machineId ||
    fields.host ||
    req.headers["x-phonedex-device-id"] ||
    machineName;

  return addTaskProtocolFields({
    id: makeId("task"),
    at: fields.at || new Date().toISOString(),
    source: fields.source ? `remote-${fields.source}` : "remote-agent",
    title: fields.title || "Codex done",
    text: normalizeNotificationText(fields.text || fields.body || fields.message || "Task completed"),
    status: fields.status,
    version: fields.version,
    updatedAt: fields.updatedAt,
    cwd: fields.cwd || "",
    machineName,
    deviceId,
    sessionId: fields.sessionId || fields.session_id || "",
    messageId: fields.messageId || fields.message_id || "",
    logicalEventId: fields.logicalEventId || fields.logical_event_id || "",
    captureSources: fields.captureSources,
    originTaskId,
    originReplyUrl: fields.replyUrl || fields.reply_url || "",
    originPublicUrl: fields.publicUrl || fields.public_url || "",
    originToken: fields.replyToken || fields.reply_token || "",
    ...(fields.question ? { question: normalizeTaskQuestion(fields.question) } : {}),
    receivedAt: new Date().toISOString(),
    receivedFrom: req.socket.remoteAddress || "",
    hookPayload: fields.hookPayload,
    rawHookInputBytes: fields.rawHookInputBytes
  });
}

function buildTaskMessage(payload) {
  const message = findFirstKey(payload, [
    "last_assistant_message",
    "lastAssistantMessage",
    "assistant_message",
    "assistantMessage"
  ]);

  if (!message) return "Tap a response: okay whats next / lets do that";

  return (
    normalizeNotificationText(message) ||
    "Tap a response: okay whats next / lets do that"
  );
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

function printAgentInstalls(args) {
  const cfg = config();
  const flags = parseFlags(args);
  const limit = Number(flags.limit || 50);
  const entries = readJsonl(cfg.dataDir, AGENT_INSTALLS_FILE)
    .slice(-positiveNumber(limit, 50))
    .map(publicAgentInstallReport);

  if (flags.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  if (entries.length === 0) {
    console.log(`No entries in ${path.join(cfg.dataDir, AGENT_INSTALLS_FILE)}`);
    return;
  }

  for (const entry of entries) {
    const label = entry.machineName || entry.deviceId || "unknown agent";
    const status = entry.ok ? "OK" : "FAILED";
    const suffix = entry.message ? ` - ${entry.message}` : "";
    console.log(`${entry.at} ${label} [${entry.deviceId}] ${entry.stage}: ${status}${suffix}`);
  }
}

function printKnownDevices() {
  const cfg = config();
  const devices = listDeviceCoverage(cfg);
  if (devices.length === 0) {
    console.log(`No devices in ${cfg.dataDir}`);
    return;
  }
  console.log(JSON.stringify(devices, null, 2));
}

function verifyDeviceCoverageCommand(args) {
  const cfg = config();
  const flags = parseFlags(args);
  const report = buildDeviceCoverageReport(cfg, {
    failOnUnexpected: parseBoolean(flags.failOnUnexpected || flags["fail-on-unexpected"], false)
  });

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printDeviceCoverageReport(report);
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

async function notifyCoverageCommand(args) {
  const cfg = config();
  ensureDataDir(cfg.dataDir);
  const flags = parseFlags(args);
  const result = await maybeSendCoverageAlert(cfg, {
    force: true,
    reason: "manual"
  });

  if (flags.json) {
    console.log(JSON.stringify(publicCoverageAlertResult(result), null, 2));
    return;
  }

  printCoverageAlertResult(result);
}

async function startCoverageWatcher(cfg) {
  if (cfg.agentMode || !cfg.coverageAlerts) return null;

  try {
    await maybeSendCoverageAlert(cfg, { reason: "startup" });
  } catch (error) {
    logError(error);
  }

  const timer = setInterval(() => {
    maybeSendCoverageAlert(cfg, { reason: "interval" }).catch(logError);
  }, cfg.coverageAlertIntervalMs);
  timer.unref?.();
  console.log(`PhoneDex coverage alerts enabled every ${cfg.coverageAlertIntervalMs}ms.`);
  return timer;
}

function enrollAgentCommand(args) {
  const cfg = config();
  const flags = parseFlags(args);
  const enrollment = buildAgentEnrollment(cfg, flags);

  if (flags.script) {
    console.log(buildEnrollmentScript(enrollment));
    return;
  }

  if (flags.json) {
    console.log(JSON.stringify(enrollment, null, 2));
    return;
  }

  printAgentEnrollment(enrollment);
}

async function agentSelfTestCommand(args) {
  const cfg = config();
  ensureDataDir(cfg.dataDir);
  const flags = parseFlags(args);
  const report = await runAgentSelfTest(cfg);

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printAgentSelfTestReport(report);
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

function agentBundleCommand(args) {
  const cfg = config();
  ensureDataDir(cfg.dataDir);
  const flags = parseFlags(args);
  const bundle = buildAgentBundle(cfg, flags);
  writeAgentBundle(bundle);

  if (flags.json) {
    console.log(JSON.stringify(publicAgentBundle(bundle), null, 2));
    return;
  }

  printAgentBundle(bundle);
}

function agentInviteCommand(args) {
  const cfg = config();
  ensureDataDir(cfg.dataDir);
  const flags = parseFlags(args);

  if (flags.list) {
    const invites = listAgentInvites(cfg);
    if (flags.json) {
      console.log(JSON.stringify(invites, null, 2));
      return;
    }
    printAgentInvites(invites);
    return;
  }

  if (!cfg.token) {
    throw new Error("WATCH_BRIDGE_TOKEN is required to create an agent invite.");
  }

  const invite = createAgentInvite(cfg, {
    ttlMs: flags.ttlMs || flags["ttl-ms"]
  });

  if (flags.json) {
    console.log(JSON.stringify(invite, null, 2));
    return;
  }

  console.log("PhoneDex agent invite created.");
  console.log(`Setup URL: ${invite.setupUrl}`);
  console.log(`Expires: ${invite.expiresAt}`);
  console.log("Treat this URL as secret; it opens token-bearing agent install commands.");
}

function listAgentInvites(cfg) {
  const invites = pruneAgentInvites(readAgentInvites(cfg), cfg);
  writeAgentInvites(cfg, invites);
  return invites.map((invite) => publicAgentInvite(cfg, invite));
}

function printAgentInvites(invites) {
  if (invites.length === 0) {
    console.log("No active PhoneDex agent invites.");
    return;
  }

  for (const invite of invites) {
    console.log(`${invite.setupUrl}`);
    console.log(`  expires: ${invite.expiresAt}`);
    console.log(`  uses: ${invite.uses}`);
    if (invite.lastUsedAt) {
      const file = invite.lastFileName ? ` ${invite.lastFileName}` : "";
      console.log(`  last use: ${invite.lastUsedAt} ${invite.lastEventType}${file}`);
    }
  }
}

function printHelp() {
  console.log(`PhoneDex

Usage:
  phonedex setup
  phonedex server
  phonedex service
  phonedex hook
  phonedex notify --title "Codex done" --text "Task completed"
  phonedex watch-sessions
  phonedex scan-sessions --notify-existing
  phonedex reply --choice okay_whats_next
  phonedex devices
  phonedex verify-devices
  phonedex notify-coverage
  phonedex pair:create --name "My iPhone"
  phonedex pair:list
  phonedex pair:revoke --identity ID
  phonedex pair:rotate --identity ID
  phonedex enroll-agent --device-id macbook-air --name "MacBook Air" --platform macos
  phonedex enroll-agent --device-id windows-desktop --name "Windows Desktop" --platform windows --script
  phonedex agent-self-test
  phonedex agent-bundle
  phonedex agent-invite
  phonedex agent-invite --list
  phonedex agent-installs
  phonedex replies
  phonedex run -- <command> [args...]

Compatibility aliases:
  watchdex setup
  watchdex server
  watchdex service
  watchdex hook
  watchdex notify --title "Codex done" --text "Task completed"
  watchdex watch-sessions
  watchdex scan-sessions --notify-existing
  watchdex reply --choice okay_whats_next
  watchdex devices
  watchdex verify-devices
  watchdex notify-coverage
  watchdex pair:create --name "My iPhone"
  watchdex enroll-agent --device-id macbook-air --name "MacBook Air" --platform macos
  watchdex enroll-agent --device-id windows-desktop --name "Windows Desktop" --platform windows --script
  watchdex agent-self-test
  watchdex agent-bundle
  watchdex agent-invite
  watchdex agent-invite --list
  watchdex agent-installs
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
  if (fileName === "tasks.jsonl") return durableStore(dataDir).listTasks();
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

function publicTask(task) {
  if (!task || typeof task !== "object") return task;
  const {
    cwd,
    hookPayload,
    rawHookInputBytes,
    receivedFrom,
    originReplyUrl,
    originPublicUrl,
    originToken,
    replyToken,
    token,
    replyUrl,
    publicUrl,
    ...safeTask
  } = task;
  const workspaceName = safeTask.workspaceName || workspaceNameFromPath(cwd);
  return workspaceName
    ? redactPublicStrings({ ...safeTask, workspaceName })
    : redactPublicStrings(safeTask);
}

function publicSyncTask(task) {
  if (!task || typeof task !== "object") return task;
  const {
    cwd,
    hookPayload,
    rawHookInputBytes,
    receivedFrom,
    originReplyUrl,
    originPublicUrl,
    originToken,
    replyToken,
    token,
    replyUrl,
    publicUrl,
    ...safeTask
  } = task;
  const workspaceName =
    task.workspaceName || workspaceNameFromPath(cwd);
  return workspaceName
    ? redactPublicStrings({ ...safeTask, workspaceName })
    : redactPublicStrings(safeTask);
}

function redactPublicStrings(value) {
  if (Array.isArray(value)) return value.map(redactPublicStrings);
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? redactSensitiveText(value) : value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, childValue]) => [
      key,
      redactPublicStrings(childValue)
    ])
  );
}

function workspaceNameFromPath(value) {
  if (typeof value !== "string" || !value) return "";
  const parts = value.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) || "";
}

function publicDevice(device) {
  if (!device || typeof device !== "object") return device;
  const safeDevice = {
    deviceId: device.deviceId,
    machineName: device.machineName,
    platform: device.platform,
    role: device.role,
    status: device.status,
    lastSeenAt: device.lastSeenAt,
    agentVersion: device.agentVersion || device.version,
    adapterVersion: device.adapterVersion,
    adapterId: device.adapterId,
    adapterMode: device.adapterMode,
    adapterState: device.adapterState,
    adapterLimitations: Array.isArray(device.adapterLimitations) ? device.adapterLimitations : [],
    adapter: device.adapter,
    capabilities: Array.isArray(device.capabilities) ? device.capabilities : [],
    capabilityDetails: Array.isArray(device.capabilityDetails) ? device.capabilityDetails : [],
    health: device.health
  };
  return Object.fromEntries(
    Object.entries(safeDevice).filter(([, value]) => value !== undefined)
  );
}

async function startDeviceHeartbeat(cfg) {
  const beat = async () => {
    const device = buildLocalDeviceHeartbeat(cfg);
    recordDeviceHeartbeat(cfg.dataDir, device);
    await maybeForwardDeviceHeartbeatToHub(cfg, device);
  };

  await beat();
  setInterval(() => {
    beat().catch(logError);
  }, cfg.deviceHeartbeatIntervalMs);
}

function buildLocalDeviceHeartbeat(cfg) {
  const capabilities = defaultCapabilities("agent").map((capability) => {
    const adapterCapability = cfg.adapter.capabilities.find((candidate) => candidate.id === capability.id);
    return adapterCapability || capability;
  });
  return addDeviceProtocolFields({
    deviceId: cfg.deviceId,
    machineName: cfg.machineName,
    role: cfg.agentMode ? "agent" : "hub",
    publicUrl: cfg.publicUrl,
    replyUrl: cfg.replyUrl,
    hubUrl: cfg.hubUrl || "",
    codexHome: cfg.codexHome,
    platform: process.platform,
    hostname: os.hostname(),
    pid: process.pid,
    version: "0.1.0",
    health: {
      agent: "healthy",
      adapter: cfg.adapter.state === "ready" ? "healthy" : "degraded"
    },
    adapterId: cfg.adapter.id,
    adapterVersion: cfg.adapter.version,
    adapterMode: cfg.adapter.mode,
    adapterState: cfg.adapter.state,
    adapterLimitations: cfg.adapter.limitations,
    adapter: cfg.adapter,
    capabilities: capabilities.map((capability) => `${capability.id}.v${capability.version}`),
    capabilityDetails: capabilities,
    lastSeenAt: new Date().toISOString()
  });
}

async function maybeForwardDeviceHeartbeatToHub(cfg, device) {
  if (!cfg.hubUrl || isSameBaseUrl(cfg.hubUrl, cfg.publicUrl)) {
    return {
      ok: true,
      skipped: true,
      reason: !cfg.hubUrl ? "PHONEDEX_HUB_URL is not configured" : "hubUrl matches publicUrl"
    };
  }

  try {
    const response = await fetch(`${cfg.hubUrl}/devices/heartbeat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cfg.hubToken ? { authorization: `Bearer ${cfg.hubToken}` } : {})
      },
      body: JSON.stringify({
        token: cfg.hubToken,
        device
      })
    });
    const responseText = await response.text();
    if (!response.ok) {
      appendJsonl(cfg.dataDir, "events.jsonl", {
        at: new Date().toISOString(),
        type: "hub-heartbeat-attempt",
        hubUrl: redactSensitiveText(cfg.hubUrl),
        deviceId: device.deviceId,
        status: response.status,
        ok: false,
        response: redactSensitiveText(responseText).slice(0, 500)
      });
    }
    return {
      ok: response.ok,
      status: response.status,
      response: redactSensitiveText(responseText).slice(0, 500)
    };
  } catch (error) {
    appendJsonl(cfg.dataDir, "events.jsonl", {
      at: new Date().toISOString(),
      type: "hub-heartbeat-attempt",
      hubUrl: redactSensitiveText(cfg.hubUrl),
      deviceId: device.deviceId,
      ok: false,
      error: redactSensitiveText(error.message)
    });
    return {
      ok: false,
      error: redactSensitiveText(error.message)
    };
  }
}

function normalizeDeviceHeartbeat(fields, req) {
  const now = new Date().toISOString();
  const machineName = fields.machineName || fields.machine || fields.hostname || "Unknown device";
  return addDeviceProtocolFields({
    deviceId: fields.deviceId || fields.id || fields.machineId || machineName,
    machineName,
    role: fields.role || "agent",
    publicUrl: fields.publicUrl || fields.public_url || "",
    replyUrl: fields.replyUrl || fields.reply_url || "",
    hubUrl: fields.hubUrl || fields.hub_url || "",
    codexHome: fields.codexHome || fields.codex_home || "",
    platform: fields.platform || "",
    hostname: fields.hostname || "",
    pid: fields.pid || "",
    version: fields.version || "",
    health: fields.health || {
      reachability: fields.reachability || fields.reachabilityStatus,
      agent: fields.agentHealth || fields.agent_health,
      adapter: fields.adapterHealth || fields.adapter_health
    },
    capabilities: fields.capabilities,
    capabilityDetails: fields.capabilityDetails || fields.capability_details,
    adapterId: fields.adapterId || fields.adapter_id,
    adapterVersion: fields.adapterVersion || fields.adapter_version,
    adapterMode: fields.adapterMode || fields.adapter_mode,
    adapterState: fields.adapterState || fields.adapter_state,
    adapterLimitations: fields.adapterLimitations || fields.adapter_limitations,
    adapter: fields.adapter,
    lastSeenAt: fields.lastSeenAt || fields.at || now,
    receivedAt: now,
    receivedFrom: req?.socket?.remoteAddress || ""
  });
}

function recordDeviceHeartbeat(dataDir, device) {
  const next = durableStore(dataDir).upsertDevice(device);
  const devices = durableStore(dataDir).listDevices();
  // Keep the legacy file for older diagnostics and installed agents.
  writeJsonFile(dataDir, DEVICES_STATE_FILE, {
    updatedAt: new Date().toISOString(),
    devices
  });
  return next;
}

function listDeviceCoverage(cfg) {
  const devices = new Map();
  for (const device of readDeviceHeartbeats(cfg.dataDir)) {
    if (!device?.deviceId) continue;
    const status = device.status === "revoked"
      ? "revoked"
      : heartbeatStatus(device.lastSeenAt, cfg.deviceStaleMs);
    devices.set(device.deviceId, {
      ...device,
      lastHeartbeatAt: device.lastSeenAt || "",
      status,
      health: {
        ...(device.health || {}),
        reachability: status
      }
    });
  }

  for (const taskDevice of listTaskDevices(cfg.dataDir)) {
    const current = devices.get(taskDevice.deviceId);
    devices.set(taskDevice.deviceId, {
      ...taskDevice,
      ...current,
      deviceId: current?.deviceId || taskDevice.deviceId,
      machineName: current?.machineName || taskDevice.machineName,
      lastTaskAt: taskDevice.lastTaskAt,
      lastTaskId: taskDevice.lastTaskId,
      lastSessionId: taskDevice.lastSessionId,
      lastCwd: taskDevice.lastCwd,
      source: taskDevice.source,
      status: current?.status || "task-only"
    });
  }

  for (const expected of cfg.expectedDevices) {
    const current = devices.get(expected.deviceId);
    if (current) {
      devices.set(expected.deviceId, {
        ...current,
        expected: true,
        machineName: current.machineName || expected.machineName || expected.deviceId
      });
      continue;
    }

    devices.set(expected.deviceId, {
      deviceId: expected.deviceId,
      machineName: expected.machineName || expected.deviceId,
      expected: true,
      status: "missing",
      lastHeartbeatAt: "",
      lastTaskAt: "",
      health: { reachability: "missing", agent: "unknown", adapter: "unknown" }
    });
  }

  return [...devices.values()].sort(compareDeviceCoverage);
}

function buildDeviceCoverageReport(cfg, options = {}) {
  const devices = listDeviceCoverage(cfg);
  const expectedDevices = devices.filter((device) => device.expected);
  const unexpectedDevices = devices.filter((device) => !device.expected);
  const failingExpectedDevices = expectedDevices.filter(
    (device) => device.status !== "online"
  );
  const issues = [];

  if (cfg.expectedDevices.length === 0) {
    issues.push({
      code: "expected-devices-empty",
      message:
        "PHONEDEX_EXPECTED_DEVICES is empty, so PhoneDex cannot prove account-wide coverage."
    });
  }

  for (const device of failingExpectedDevices) {
    issues.push({
      code: `device-${device.status}`,
      deviceId: device.deviceId,
      machineName: device.machineName || device.deviceId,
      status: device.status,
      message: `${device.machineName || device.deviceId} is ${device.status}.`
    });
  }

  if (options.failOnUnexpected && unexpectedDevices.length > 0) {
    for (const device of unexpectedDevices) {
      issues.push({
        code: "unexpected-device",
        deviceId: device.deviceId,
        machineName: device.machineName || device.deviceId,
        status: device.status,
        message:
          `${device.machineName || device.deviceId} is reporting but is not listed ` +
          "in PHONEDEX_EXPECTED_DEVICES."
      });
    }
  }

  return {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    expectedCount: cfg.expectedDevices.length,
    onlineExpectedCount: expectedDevices.filter((device) => device.status === "online")
      .length,
    failingExpectedCount: failingExpectedDevices.length,
    unexpectedCount: unexpectedDevices.length,
    staleMs: cfg.deviceStaleMs,
    devices,
    issues
  };
}

async function maybeSendCoverageAlert(cfg, options = {}) {
  if (cfg.agentMode) {
    return {
      sent: false,
      reason: "agent-mode",
      report: buildDeviceCoverageReport(cfg)
    };
  }

  const report = buildDeviceCoverageReport(cfg);
  const signature = coverageAlertSignature(report);

  if (report.ok) {
    writeJsonFile(cfg.dataDir, COVERAGE_ALERT_STATE_FILE, {
      ok: true,
      signature,
      lastOkAt: new Date().toISOString()
    });
    return { sent: false, reason: "coverage-ok", report, signature };
  }

  const state = readJsonFile(cfg.dataDir, COVERAGE_ALERT_STATE_FILE, {});
  const now = Date.now();
  const lastAlertAt = Date.parse(state.lastAlertAt || "");
  const intervalElapsed =
    Number.isNaN(lastAlertAt) || now - lastAlertAt >= cfg.coverageAlertIntervalMs;
  const due = options.force || state.signature !== signature || intervalElapsed;

  if (!due) {
    return {
      sent: false,
      reason: "alert-throttled",
      report,
      signature,
      nextAlertAt: new Date(lastAlertAt + cfg.coverageAlertIntervalMs).toISOString()
    };
  }

  const invite = createAgentInvite(cfg, { reason: "coverage-alert" });
  const task = createTask({
    source: "device-coverage-alert",
    title: "PhoneDex coverage needs setup",
    text: buildCoverageAlertText(cfg, report, invite),
    cwd: ROOT,
    machineName: cfg.machineName,
    deviceId: cfg.deviceId
  });

  await recordTaskAndDispatch(cfg, task, { forward: false, notify: true });

  writeJsonFile(cfg.dataDir, COVERAGE_ALERT_STATE_FILE, {
    ok: false,
    signature,
    lastAlertAt: new Date().toISOString(),
    reason: options.reason || "",
    taskId: task.id,
    inviteUrl: invite.setupUrl,
    inviteExpiresAt: invite.expiresAt,
    issues: report.issues.map((issue) => ({
      code: issue.code,
      deviceId: issue.deviceId || "",
      status: issue.status || "",
      message: issue.message
    }))
  });

  return {
    sent: true,
    reason: options.reason || "coverage-incomplete",
    report,
    signature,
    invite,
    task
  };
}

function buildCoverageAlertText(cfg, report, invite) {
  const issueLines = report.issues.map((issue) => `- ${issue.message}`).join("\n");
  const setupUrl = `${cfg.publicUrl}/agent-bootstrap/setup`;

  return [
    `PhoneDex is receiving ${report.onlineExpectedCount}/${report.expectedCount} expected devices.`,
    issueLines,
    "",
    invite
      ? "Open this short-lived setup link from the missing Mac or Windows device:"
      : "On the hub, run npm run agent:invite for a short-lived setup link.",
    invite ? invite.setupUrl : setupUrl,
    invite
      ? `Invite expires: ${invite.expiresAt}`
      : "Add ?token=YOUR_WATCH_BRIDGE_TOKEN from the hub .env.",
    "",
    "After each missing agent installs, run npm run devices:verify on the hub."
  ]
    .filter(Boolean)
    .join("\n");
}

function coverageAlertSignature(report) {
  const material = report.issues
    .map((issue) => `${issue.code}:${issue.deviceId || ""}:${issue.status || ""}`)
    .sort()
    .join("|");
  return crypto.createHash("sha256").update(material || "ok").digest("hex").slice(0, 16);
}

function publicCoverageAlertResult(result) {
  return {
    sent: result.sent,
    reason: result.reason,
    signature: result.signature || "",
    nextAlertAt: result.nextAlertAt || "",
    invite: result.invite || null,
    task: result.task ? publicTask(result.task) : null,
    report: result.report
  };
}

function printCoverageAlertResult(result) {
  if (result.sent) {
    console.log(`PhoneDex coverage alert sent: ${result.task.id}`);
    return;
  }

  if (result.reason === "coverage-ok") {
    console.log("PhoneDex coverage is OK. No alert sent.");
    return;
  }

  if (result.reason === "alert-throttled") {
    console.log(`PhoneDex coverage alert skipped until ${result.nextAlertAt}.`);
    return;
  }

  console.log(`PhoneDex coverage alert skipped: ${result.reason}`);
}

async function runAgentSelfTest(cfg) {
  const startedAt = new Date().toISOString();
  const issues = [];
  const hubReady = Boolean(cfg.hubUrl) && !isSameBaseUrl(cfg.hubUrl, cfg.publicUrl);

  if (!hubReady) {
    issues.push({
      code: "hub-url-missing",
      message: "PHONEDEX_HUB_URL must point at the hub from an agent device."
    });
  }

  const device = buildLocalDeviceHeartbeat(cfg);
  recordDeviceHeartbeat(cfg.dataDir, device);
  const heartbeatForward = await maybeForwardDeviceHeartbeatToHub(cfg, device);

  const task = createTask({
    source: "agent-self-test",
    title: "PhoneDex agent self-test",
    text: `Agent self-test from ${cfg.machineName} at ${startedAt}`,
    cwd: process.cwd(),
    sessionId: `agent-self-test-${cfg.deviceId}-${Date.now()}`
  });
  const taskResult = await recordTaskAndDispatch(cfg, task, { notify: false });
  const taskForward = taskResult.forward || {
    ok: false,
    skipped: true,
    reason: "task forwarding result was not recorded"
  };
  const sessionWatch = await runAgentSessionWatchSelfTest(cfg, startedAt);

  const devicesCheck = hubReady
    ? await fetchHubJson(cfg, "/devices")
    : { ok: false, skipped: true, reason: "hub unavailable" };
  const tasksCheck = hubReady
    ? await fetchHubJson(cfg, "/tasks")
    : { ok: false, skipped: true, reason: "hub unavailable" };

  const hubDevice = Array.isArray(devicesCheck.json)
    ? devicesCheck.json.find((candidate) => candidate.deviceId === cfg.deviceId)
    : null;
  const hubTask = Array.isArray(tasksCheck.json)
    ? tasksCheck.json.find(
        (candidate) =>
          candidate.originTaskId === task.id ||
          candidate.id === task.id ||
          candidate.sessionId === task.sessionId
      )
    : null;
  const hubSessionTask = Array.isArray(tasksCheck.json)
    ? tasksCheck.json.find(
        (candidate) =>
          candidate.originTaskId === sessionWatch.taskId ||
          candidate.sessionId === sessionWatch.sessionId
      )
    : null;

  if (!heartbeatForward.ok || heartbeatForward.skipped) {
    issues.push({
      code: "heartbeat-forward-failed",
      message: heartbeatForward.reason || heartbeatForward.error || "Heartbeat did not reach hub."
    });
  }

  if (!taskForward.ok || taskForward.skipped) {
    issues.push({
      code: "task-forward-failed",
      message: taskForward.reason || taskForward.error || "Self-test task did not reach hub."
    });
  }

  if (!sessionWatch.ok) {
    issues.push({
      code: "session-watch-self-test-failed",
      message: sessionWatch.error || "Session watcher did not capture the fixture response."
    });
  }

  if (!devicesCheck.ok) {
    issues.push({
      code: "hub-devices-check-failed",
      message: devicesCheck.error || devicesCheck.response || "Could not read hub /devices."
    });
  } else if (!hubDevice) {
    issues.push({
      code: "hub-device-not-visible",
      message: `${cfg.deviceId} was not visible in hub /devices after heartbeat.`
    });
  }

  if (!tasksCheck.ok) {
    issues.push({
      code: "hub-tasks-check-failed",
      message: tasksCheck.error || tasksCheck.response || "Could not read hub /tasks."
    });
  } else if (!hubTask) {
    issues.push({
      code: "hub-task-not-visible",
      message: `${task.id} was not visible in hub /tasks after forwarding.`
    });
  } else if (!hubSessionTask) {
    issues.push({
      code: "hub-session-watch-task-not-visible",
      message:
        `${sessionWatch.taskId || sessionWatch.sessionId} was not visible in hub /tasks ` +
        "after session watcher self-test."
    });
  }

  return {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    deviceId: cfg.deviceId,
    machineName: cfg.machineName,
    hubUrl: cfg.hubUrl || "",
    publicUrl: cfg.publicUrl,
    heartbeatForward,
    taskForward,
    sessionWatch,
    hubDevice: hubDevice || null,
    hubTask: hubTask || null,
    hubSessionTask: hubSessionTask || null,
    task: publicTask(task),
    issues
  };
}

async function runAgentSessionWatchSelfTest(cfg, startedAt) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-agent-session-"));
  const codexHome = path.join(tmp, "codex-home");
  const sessionsDir = path.join(codexHome, "sessions", "2026", "06", "30");
  const sessionId = `019fself-${crypto.randomBytes(2).toString("hex")}-7333-8444-555555555555`;
  const text = `Agent session watcher self-test from ${cfg.machineName} at ${startedAt}`;

  try {
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sessionFile = path.join(
      sessionsDir,
      `rollout-2026-06-30T03-00-00-${sessionId}.jsonl`
    );
    fs.writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "session_meta",
          timestamp: "2026-06-30T03:00:00.000Z",
          payload: { cwd: process.cwd() }
        }),
        JSON.stringify({
          type: "event_msg",
          timestamp: "2026-06-30T03:01:00.000Z",
          payload: {
            type: "agent_message",
            phase: "final_answer",
            message: text
          }
        })
      ].join("\n") + "\n"
    );

    const originalCodexHome = cfg.codexHome;
    const originalDebounceMs = cfg.sessionWatchDebounceMs;
    const originalLookbackHours = cfg.sessionWatchLookbackHours;
    const originalFileLimit = cfg.sessionWatchFileLimit;
    cfg.codexHome = codexHome;
    cfg.sessionWatchDebounceMs = 0;
    cfg.sessionWatchLookbackHours = 87600;
    cfg.sessionWatchFileLimit = 20;

    try {
      const notified = await scanSessions({ cfg, notify: true });
      const task = readJsonl(cfg.dataDir, "tasks.jsonl")
        .slice()
        .reverse()
        .find(
          (candidate) =>
            candidate &&
            !candidate.parseError &&
            candidate.source === "codex-session-watch" &&
            candidate.sessionId === sessionId &&
            candidate.text === text
        );

      return {
        ok: notified === 1 && Boolean(task),
        notified,
        taskId: task?.id || "",
        sessionId,
        text,
        error:
          notified === 1 && task
            ? ""
            : `Expected one session watcher task for ${sessionId}, got ${notified}.`
      };
    } finally {
      cfg.codexHome = originalCodexHome;
      cfg.sessionWatchDebounceMs = originalDebounceMs;
      cfg.sessionWatchLookbackHours = originalLookbackHours;
      cfg.sessionWatchFileLimit = originalFileLimit;
    }
  } catch (error) {
    return {
      ok: false,
      notified: 0,
      taskId: "",
      sessionId,
      text,
      error: error.message
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function fetchHubJson(cfg, pathname) {
  try {
    const response = await fetch(`${cfg.hubUrl}${pathname}`, {
      headers: {
        ...(cfg.hubToken ? { authorization: `Bearer ${cfg.hubToken}` } : {})
      }
    });
    const responseText = await response.text();
    let json = null;
    try {
      json = responseText ? JSON.parse(responseText) : null;
    } catch {
      // Keep the raw response below for diagnostics.
    }

    return {
      ok: response.ok,
      status: response.status,
      response: redactSensitiveText(responseText).slice(0, 500),
      json
    };
  } catch (error) {
    return {
      ok: false,
      error: redactSensitiveText(error.message)
    };
  }
}

function printAgentSelfTestReport(report) {
  console.log(`PhoneDex agent self-test: ${report.ok ? "OK" : "NOT OK"}`);
  console.log(`Device: ${report.machineName} [${report.deviceId}]`);
  console.log(`Hub: ${report.hubUrl || "(not configured)"}`);
  console.log(
    `Heartbeat forward: ${report.heartbeatForward.ok ? "OK" : "FAILED"} ` +
      statusSuffix(report.heartbeatForward)
  );
  console.log(
    `Task forward: ${report.taskForward.ok ? "OK" : "FAILED"} ${statusSuffix(report.taskForward)}`
  );
  console.log(
    `Session watcher capture: ${report.sessionWatch.ok ? "OK" : "FAILED"} ` +
      `(${report.sessionWatch.notified || 0} fixture task)`
  );
  console.log(`Hub device visible: ${report.hubDevice ? "yes" : "no"}`);
  console.log(`Hub task visible: ${report.hubTask ? "yes" : "no"}`);
  console.log(`Hub session watcher task visible: ${report.hubSessionTask ? "yes" : "no"}`);

  if (report.issues.length > 0) {
    console.log("");
    console.log("Issues:");
    for (const issue of report.issues) {
      console.log(`- ${issue.message}`);
    }
  }
}

function statusSuffix(result) {
  if (!result) return "";
  if (result.status) return `(HTTP ${result.status})`;
  if (result.reason) return `(${result.reason})`;
  if (result.error) return `(${result.error})`;
  return "";
}

function buildAgentEnrollment(cfg, flags) {
  const deviceId = String(flags.deviceId || flags["device-id"] || "").trim();
  if (!deviceId) {
    throw new Error("enroll-agent requires --device-id");
  }

  const machineName = String(
    flags.name || flags.machineName || flags["machine-name"] || deviceId
  ).trim();
  const platform = normalizeEnrollmentPlatform(flags.platform || "macos");
  const callbackUrl = trimTrailingSlash(
    flags.callbackUrl || flags["callback-url"] || "http://THIS_AGENT_LAN_IP:8765"
  );
  const hubUrl = trimTrailingSlash(flags.hubUrl || flags["hub-url"] || cfg.publicUrl);
  const installDir = String(
    flags.installDir || flags["install-dir"] || defaultEnrollmentInstallDir(platform)
  ).trim();
  const hubToken = String(flags.hubToken || flags["hub-token"] || cfg.token || "").trim();
  const agentToken = String(
    flags.agentToken ||
      flags["agent-token"] ||
      flags.replyToken ||
      flags["reply-token"] ||
      crypto.randomBytes(24).toString("hex")
  ).trim();

  if (!hubUrl) {
    throw new Error("enroll-agent requires WATCH_BRIDGE_PUBLIC_URL or --hub-url");
  }

  const env = {
    PHONEDEX_HUB_URL: hubUrl,
    PHONEDEX_HUB_TOKEN: hubToken,
    PHONEDEX_AGENT_MODE: "true",
    PHONEDEX_DEVICE_ID: deviceId,
    PHONEDEX_MACHINE_NAME: machineName,
    WATCH_BRIDGE_PUBLIC_URL: callbackUrl,
    WATCH_BRIDGE_HOST: "0.0.0.0",
    WATCH_BRIDGE_TOKEN: agentToken
  };

  return {
    deviceId,
    machineName,
    platform,
    hubUrl,
    callbackUrl,
    installDir,
    env,
    envLines: Object.entries(env).map(([key, value]) => `${key}=${value}`),
    commands: enrollmentCommands(platform),
    hubExpectedDevices: formatExpectedDevices(
      recommendedExpectedDevices(cfg, { deviceId, machineName })
    )
  };
}

function buildAgentBundle(cfg, flags) {
  const outputDir = path.resolve(
    ROOT,
    flags.outputDir || flags["output-dir"] || cfg.agentBundleDir
  );
  const includeAll = parseBoolean(flags.all, false);
  const coverage = listDeviceCoverage(cfg);
  const targets = coverage
    .filter((device) => device.expected)
    .filter((device) => device.deviceId !== cfg.deviceId)
    .filter((device) => includeAll || device.status !== "online")
    .map((device) => buildAgentBundleTarget(cfg, device, flags));

  return {
    outputDir,
    generatedAt: new Date().toISOString(),
    hubUrl: cfg.publicUrl,
    expectedDevices: formatExpectedDevices(cfg.expectedDevices),
    targets
  };
}

function buildAgentBundleTarget(cfg, device, flags) {
  const platform = guessAgentPlatform(device);
  const callbackUrl =
    flags.callbackUrl ||
    flags["callback-url"] ||
    defaultAgentCallbackUrl(device.deviceId);
  const enrollment = buildAgentEnrollment(cfg, {
    deviceId: device.deviceId,
    name: device.machineName || device.deviceId,
    platform,
    callbackUrl
  });
  const extension = platform === "windows" ? "ps1" : "sh";
  const fileName = `${safeFileStem(device.deviceId)}.${extension}`;

  return {
    deviceId: device.deviceId,
    machineName: device.machineName || device.deviceId,
    status: device.status || "missing",
    platform,
    fileName,
    filePath: path.join(cfg.dataDir, "..", ".local", "agent-bootstrap", fileName),
    script: buildEnrollmentScript(enrollment),
    enrollment
  };
}

function writeAgentBundle(bundle) {
  fs.mkdirSync(bundle.outputDir, { recursive: true });
  const manifestTargets = [];

  for (const target of bundle.targets) {
    const filePath = path.join(bundle.outputDir, target.fileName);
    fs.writeFileSync(filePath, target.script);
    if (target.platform === "macos") fs.chmodSync(filePath, 0o700);
    target.filePath = filePath;
    manifestTargets.push({
      deviceId: target.deviceId,
      machineName: target.machineName,
      status: target.status,
      platform: target.platform,
      fileName: target.fileName,
      filePath
    });
  }

  const manifest = {
    generatedAt: bundle.generatedAt,
    hubUrl: bundle.hubUrl,
    expectedDevices: bundle.expectedDevices,
    targets: manifestTargets
  };
  const readme = renderAgentBundleReadme(manifest);
  fs.writeFileSync(path.join(bundle.outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(bundle.outputDir, "README.txt"), readme);
  bundle.manifestPath = path.join(bundle.outputDir, "manifest.json");
  bundle.readmePath = path.join(bundle.outputDir, "README.txt");
}

function publicAgentBundle(bundle) {
  return {
    outputDir: bundle.outputDir,
    generatedAt: bundle.generatedAt,
    hubUrl: bundle.hubUrl,
    expectedDevices: bundle.expectedDevices,
    manifestPath: bundle.manifestPath,
    readmePath: bundle.readmePath,
    targets: bundle.targets.map((target) => ({
      deviceId: target.deviceId,
      machineName: target.machineName,
      status: target.status,
      platform: target.platform,
      fileName: target.fileName,
      filePath: target.filePath
    }))
  };
}

function printAgentBundle(bundle) {
  const safe = publicAgentBundle(bundle);
  console.log(`PhoneDex agent bootstrap bundle written to ${safe.outputDir}`);
  console.log(`Manifest: ${safe.manifestPath}`);
  console.log(`Readme: ${safe.readmePath}`);
  console.log(`Setup page: ${safe.hubUrl}/agent-bootstrap/setup?token=HUB_TOKEN`);
  if (safe.targets.length === 0) {
    console.log("No missing expected agents need bootstrap scripts right now.");
    return;
  }

  for (const target of safe.targets) {
    console.log(`- ${target.machineName} [${target.deviceId}] ${target.platform}: ${target.filePath}`);
    console.log(`  Hub download: ${safe.hubUrl}/agent-bootstrap/${target.fileName}?token=HUB_TOKEN`);
  }
}

function renderAgentBundleReadme(manifest) {
  const lines = [
    "PhoneDex agent bootstrap bundle",
    "",
    `Generated: ${manifest.generatedAt}`,
    `Hub URL: ${manifest.hubUrl}`,
    `Expected devices: ${manifest.expectedDevices || "(none)"}`,
    "",
    "Download or copy each script to its matching target device and run it there.",
    "The hub serves these private files from /agent-bootstrap/<file>?token=HUB_TOKEN.",
    `Setup page: ${manifest.hubUrl}/agent-bootstrap/setup?token=HUB_TOKEN`,
    "Each script contains local tokens from this hub. Treat the files as private.",
    ""
  ];

  for (const target of manifest.targets) {
    lines.push(`${target.machineName} [${target.deviceId}]`);
    lines.push(`  Script: ${target.fileName}`);
    lines.push(`  Hub download: ${manifest.hubUrl}/agent-bootstrap/${target.fileName}?token=HUB_TOKEN`);
    lines.push(
      target.platform === "windows"
        ? `  Run on Windows PowerShell: powershell -ExecutionPolicy Bypass -File .\\${target.fileName}`
        : `  Run on macOS: chmod +x ./${target.fileName} && ./${target.fileName}`
    );
    lines.push("");
  }

  lines.push("After every target script passes, run on the hub:");
  lines.push("  npm run devices");
  lines.push("  npm run devices:verify");
  return `${lines.join("\n")}\n`;
}

function guessAgentPlatform(device) {
  const value = `${device.deviceId || ""} ${device.machineName || ""}`.toLowerCase();
  if (/\bwin|windows/.test(value)) return "windows";
  return "macos";
}

function defaultAgentCallbackUrl(deviceId) {
  return `http://${safeFileStem(deviceId)}.local:8765`;
}

function safeFileStem(value) {
  return String(value || "agent")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "agent";
}

function normalizeEnrollmentPlatform(value) {
  const platform = String(value || "macos").trim().toLowerCase();
  if (["mac", "macos", "darwin"].includes(platform)) return "macos";
  if (["win", "windows", "windows-desktop"].includes(platform)) return "windows";
  throw new Error("enroll-agent --platform must be macos or windows");
}

function defaultEnrollmentInstallDir(platform) {
  if (platform === "windows") return "$env:USERPROFILE\\phonedex";
  return "$HOME/phonedex";
}

function enrollmentCommands(platform) {
  if (platform === "windows") {
    return [
      "git clone https://github.com/nash226/phonedex.git",
      "cd phonedex",
      "node .\\bin\\codex-watch.js setup",
      "npm run install-hook",
      "npm run windows:install",
      "npm run agent:self-test",
      "npm run windows:status"
    ];
  }

  return [
    "git clone https://github.com/nash226/phonedex.git",
    "cd phonedex",
    "node ./bin/codex-watch.js setup",
    "npm run install-hook",
    "npm run services:install",
    "npm run agent:self-test",
    "npm run services:status"
  ];
}

function buildEnrollmentScript(enrollment) {
  if (enrollment.platform === "windows") return buildWindowsEnrollmentScript(enrollment);
  return buildMacEnrollmentScript(enrollment);
}

function buildMacEnrollmentScript(enrollment) {
  return `#!/usr/bin/env bash
set -Eeuo pipefail

${macInstallDirAssignment(enrollment.installDir)}
REPO_URL="https://github.com/nash226/phonedex.git"
REPORT_URL="${shellDoubleQuote(enrollment.hubUrl)}/agent-installs"
REPORT_TOKEN="${shellDoubleQuote(enrollment.env.PHONEDEX_HUB_TOKEN || "")}"
DEVICE_ID="${shellDoubleQuote(enrollment.deviceId)}"
MACHINE_NAME="${shellDoubleQuote(enrollment.machineName)}"

report_stage() {
  local stage="$1"
  local ok="\${2:-true}"
  local message="\${3:-}"

  curl -fsS -X POST "$REPORT_URL" \\
    --data-urlencode "token=$REPORT_TOKEN" \\
    --data-urlencode "deviceId=$DEVICE_ID" \\
    --data-urlencode "machineName=$MACHINE_NAME" \\
    --data-urlencode "platform=macos" \\
    --data-urlencode "stage=$stage" \\
    --data-urlencode "ok=$ok" \\
    --data-urlencode "message=$message" \\
    --data-urlencode "source=bootstrap-script" >/dev/null 2>&1 || true
}

trap 'report_stage failed false "line $LINENO"' ERR
report_stage started true

if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$INSTALL_DIR"
fi
report_stage repo-ready true

cd "$INSTALL_DIR"
cat > .env <<'EOF'
${enrollment.envLines.join("\n")}
EOF
chmod 600 .env
report_stage env-written true
npm run install-hook
report_stage hook-installed true
npm run services:install
report_stage service-installed true
npm run agent:self-test
report_stage self-test-passed true
npm run services:status
report_stage status-checked true
report_stage completed true
trap - ERR

echo ""
echo "PhoneDex agent ${shellEscapePlain(enrollment.machineName)} is installed."
echo "On the hub, set:"
echo "PHONEDEX_EXPECTED_DEVICES=${shellEscapePlain(enrollment.hubExpectedDevices)}"
echo "Then run: npm run devices:verify"
`;
}

function buildWindowsEnrollmentScript(enrollment) {
  return `$ErrorActionPreference = "Stop"

${windowsInstallDirAssignment(enrollment.installDir)}
$RepoUrl = "https://github.com/nash226/phonedex.git"
$ReportUrl = "${powershellDoubleQuote(enrollment.hubUrl)}/agent-installs"
$ReportToken = "${powershellDoubleQuote(enrollment.env.PHONEDEX_HUB_TOKEN || "")}"
$DeviceId = "${powershellDoubleQuote(enrollment.deviceId)}"
$MachineName = "${powershellDoubleQuote(enrollment.machineName)}"

function Report-Stage {
  param(
    [string]$Stage,
    [string]$Ok = "true",
    [string]$Message = ""
  )

  try {
    Invoke-WebRequest -UseBasicParsing -Method Post -Uri $ReportUrl -Body @{
      token = $ReportToken
      deviceId = $DeviceId
      machineName = $MachineName
      platform = "windows"
      stage = $Stage
      ok = $Ok
      message = $Message
      source = "bootstrap-script"
    } | Out-Null
  } catch {}
}

try {
  Report-Stage "started"

  if (Test-Path (Join-Path $InstallDir ".git")) {
    git -C $InstallDir pull --ff-only
  } else {
    git clone $RepoUrl $InstallDir
  }
  Report-Stage "repo-ready"

  Set-Location $InstallDir
$EnvContent = @'
${enrollment.envLines.join("\n")}
'@
  $EnvContent | Set-Content -NoNewline -Encoding utf8 .env
  Report-Stage "env-written"
  npm run install-hook
  Report-Stage "hook-installed"
  npm run windows:install
  Report-Stage "service-installed"
  npm run agent:self-test
  Report-Stage "self-test-passed"
  npm run windows:status
  Report-Stage "status-checked"
  Report-Stage "completed"
} catch {
  Report-Stage "failed" "false" $_.Exception.Message
  throw
}

Write-Host ""
Write-Host "PhoneDex agent ${powershellDoubleQuote(enrollment.machineName)} is installed."
Write-Host "On the hub, set:"
Write-Host "PHONEDEX_EXPECTED_DEVICES=${powershellDoubleQuote(enrollment.hubExpectedDevices)}"
Write-Host "Then run: npm run devices:verify"
`;
}

function macInstallDirAssignment(installDir) {
  if (installDir === "$HOME/phonedex") return 'INSTALL_DIR="$HOME/phonedex"';
  return `INSTALL_DIR="${shellDoubleQuote(installDir)}"`;
}

function windowsInstallDirAssignment(installDir) {
  if (installDir === "$env:USERPROFILE\\phonedex") {
    return '$InstallDir = "$env:USERPROFILE\\phonedex"';
  }
  return `$InstallDir = "${powershellDoubleQuote(installDir)}"`;
}

function shellDoubleQuote(value) {
  return String(value).replace(/["\\$`]/g, "\\$&");
}

function shellEscapePlain(value) {
  return String(value).replace(/[$`\\"]/g, "\\$&");
}

function powershellDoubleQuote(value) {
  return String(value).replace(/[`"$]/g, "`$&");
}

function recommendedExpectedDevices(cfg, enrollingDevice) {
  const devices = new Map();
  for (const expected of cfg.expectedDevices) {
    devices.set(expected.deviceId, expected);
  }

  for (const device of listDeviceCoverage(cfg)) {
    if (!device?.deviceId || device.deviceId === "unknown") continue;
    if (device.status !== "online" && !device.expected) continue;
    devices.set(device.deviceId, {
      deviceId: device.deviceId,
      machineName: device.machineName || device.deviceId
    });
  }

  devices.set(enrollingDevice.deviceId, enrollingDevice);
  return [...devices.values()].sort((left, right) =>
    left.deviceId.localeCompare(right.deviceId)
  );
}

function formatExpectedDevices(devices) {
  return devices
    .map((device) =>
      device.machineName && device.machineName !== device.deviceId
        ? `${device.deviceId}:${device.machineName}`
        : device.deviceId
    )
    .join(",");
}

function printAgentEnrollment(enrollment) {
  console.log(`PhoneDex agent enrollment for ${enrollment.machineName}`);
  console.log("");
  console.log("Run these commands on the target device:");
  for (const command of enrollment.commands) {
    console.log(`  ${command}`);
  }

  console.log("");
  console.log("Put this in the target device .env:");
  console.log(enrollment.envLines.join("\n"));

  console.log("");
  console.log("Set this on the hub .env so devices:verify can prove coverage:");
  console.log(`PHONEDEX_EXPECTED_DEVICES=${enrollment.hubExpectedDevices}`);

  console.log("");
  console.log("After the agent starts, run on the hub:");
  console.log("  npm run devices");
  console.log("  npm run devices:verify");
}

function printDeviceCoverageReport(report) {
  console.log(
    `PhoneDex device coverage: ${report.ok ? "OK" : "NOT OK"} ` +
      `(${report.onlineExpectedCount}/${report.expectedCount} expected online)`
  );

  if (report.expectedCount === 0) {
    console.log("No expected devices configured.");
  }

  for (const device of report.devices) {
    const expected = device.expected ? "expected" : "unlisted";
    const label = device.machineName || device.deviceId;
    const lastSeen = device.lastHeartbeatAt || device.lastTaskAt || "never";
    console.log(
      `- ${label} [${device.deviceId}] ${device.status} ${expected}; last seen ${lastSeen}`
    );
  }

  if (report.issues.length > 0) {
    console.log("");
    console.log("Issues:");
    for (const issue of report.issues) {
      console.log(`- ${issue.message}`);
    }
  }
}

function readDeviceHeartbeats(dataDir) {
  return durableStore(dataDir).listDevices();
}

function durableStore(dataDir) {
  const key = path.resolve(dataDir);
  let store = DURABLE_STORE_CACHE.get(key);
  if (!store) {
    store = createPhoneDexStore(key);
    DURABLE_STORE_CACHE.set(key, store);
  }
  return store;
}

function listTaskDevices(dataDir) {
  const devices = new Map();
  for (const task of readJsonl(dataDir, "tasks.jsonl")) {
    if (!task || task.parseError) continue;
    const key = task.deviceId || task.machineName || "unknown";
    const previous = devices.get(key);
    const at = task.at || "";
    if (previous && Date.parse(previous.lastTaskAt || "") >= Date.parse(at || "")) continue;
    devices.set(key, {
      deviceId: task.deviceId || task.machineName || "unknown",
      machineName: task.machineName || "",
      lastTaskAt: at,
      lastTaskId: task.id || "",
      lastSessionId: task.sessionId || "",
      lastCwd: task.cwd || "",
      source: task.source || ""
    });
  }

  return [...devices.values()];
}

function heartbeatStatus(lastSeenAt, staleMs) {
  const lastSeen = Date.parse(lastSeenAt || "");
  if (Number.isNaN(lastSeen)) return "missing";
  return Date.now() - lastSeen <= staleMs ? "online" : "stale";
}

function compareDeviceCoverage(a, b) {
  const statusRank = {
    online: 0,
    stale: 1,
    "task-only": 2,
    missing: 3
  };
  const rankDelta = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
  if (rankDelta !== 0) return rankDelta;
  const aSeen = Date.parse(a.lastHeartbeatAt || a.lastTaskAt || "");
  const bSeen = Date.parse(b.lastHeartbeatAt || b.lastTaskAt || "");
  return (Number.isNaN(bSeen) ? 0 : bSeen) - (Number.isNaN(aSeen) ? 0 : aSeen);
}

function isSameBaseUrl(left, right) {
  if (!left || !right) return false;
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return (
      leftUrl.protocol === rightUrl.protocol &&
      leftUrl.hostname === rightUrl.hostname &&
      effectivePort(leftUrl) === effectivePort(rightUrl)
    );
  } catch {
    return trimTrailingSlash(left) === trimTrailingSlash(right);
  }
}

function effectivePort(url) {
  if (url.port) return url.port;
  if (url.protocol === "https:") return "443";
  if (url.protocol === "http:") return "80";
  return "";
}

async function watchSessions(args) {
  const cfg = config();
  ensureDataDir(cfg.dataDir);
  await startSessionWatcher(cfg, args);
}

async function startSessionWatcher(cfg, args = []) {
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
  const migratingLegacyState = !state.files && Object.keys(state.seen).length > 0;
  state.files ||= {};

  const now = Date.now();
  let notified = 0;

  for (const filePath of recentSessionFiles(cfg)) {
    const items = readFinalSessionMessages(filePath);
    const fileState = state.files[filePath];

    // Older releases tracked only a globally capped id set. Treat every
    // message currently in those files as processed during migration so ids
    // that fell out of the cap cannot replay forever.
    if (migratingLegacyState && !fileState) {
      state.files[filePath] = {
        messageCount: items.length,
        updatedAt: new Date().toISOString()
      };
      continue;
    }

    const previousCount = Number(fileState?.messageCount);
    const startIndex =
      Number.isInteger(previousCount) && previousCount >= 0 && previousCount <= items.length
        ? previousCount
        : 0;

    let processedCount = startIndex;
    for (let index = startIndex; index < items.length; index += 1) {
      const item = items[index];
      if (state.seen[item.id]) {
        processedCount = index + 1;
        continue;
      }
      if (now - Date.parse(item.at) < cfg.sessionWatchDebounceMs) break;

      state.seen[item.id] = new Date().toISOString();
      processedCount = index + 1;

      if (!notify || hasMatchingTask(readJsonl(cfg.dataDir, "tasks.jsonl"), item)) continue;

      const task = createTask({
        source: "codex-session-watch",
        title: `Codex done: ${path.basename(item.cwd || ROOT)}`,
        text: normalizeNotificationText(item.text),
        cwd: item.cwd || ROOT,
        sessionId: item.sessionId,
        messageId: item.messageId,
        hookPayload: {
          session_file: filePath,
          message_id: item.messageId,
          fallback: true
        }
      });

      const result = await recordTaskAndDispatch(cfg, task);
      if (result.created) notified += 1;
    }

    state.files[filePath] = {
      messageCount: processedCount,
      updatedAt: new Date().toISOString()
    };
  }

  state.seen = Object.fromEntries(Object.entries(state.seen).slice(-5000));
  state.files = Object.fromEntries(
    Object.entries(state.files)
      .sort(([, a], [, b]) => Date.parse(a.updatedAt || "") - Date.parse(b.updatedAt || ""))
      .slice(-1000)
  );
  writeJsonFile(cfg.dataDir, SESSION_WATCH_STATE, state);
  return notified;
}

function recentSessionFiles(cfg) {
  const codexHome = cfg.codexHome;
  const sessionsDir = path.join(codexHome, "sessions");
  if (!fs.existsSync(sessionsDir)) return [];
  const cutoff = Date.now() - cfg.sessionWatchLookbackHours * 60 * 60 * 1000;
  const files = [];
  walk(sessionsDir, files);
  return files
    .filter((filePath) => filePath.endsWith(".jsonl"))
    .map((filePath) => ({ filePath, stat: fs.statSync(filePath) }))
    .filter(({ stat }) => stat.mtimeMs >= cutoff)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, cfg.sessionWatchFileLimit)
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
  let sequence = 0;

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

    if (record.type === "event_msg" && payload.type === "agent_message") {
      const text = String(payload.message || "").trim();
      if (payload.phase !== "final_answer" || !text) continue;

      sequence += 1;
      messages.push({
        id: `${filePath}:${record.timestamp || sequence}:agent_message:${sequence}`,
        messageId: record.timestamp || "",
        at: record.timestamp || new Date().toISOString(),
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
  const clean = normalizeNotificationText(item.text);
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
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /\b(password|token|secret|api[_ -]?key)\b(?:\s*:\s*|\s+)([^\s`"'<>]{8,})/gi,
      "$1: [redacted]"
    )
    .replace(/([?&](?:token|secret|password|api[_-]?key)=)[^&#\s]+/gi, "$1[redacted]");
}

function normalizeNotificationText(value, maxLength = PHONE_NOTIFICATION_TEXT_MAX) {
  const text = redactSensitiveText(value)
    .replace(/\r\n/g, "\n")
    .replace(/```[A-Za-z0-9_-]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[`*_>#]/g, "")
    .trim();

  return truncate(text, maxLength);
}

function truncate(value, maxLength) {
  const text = String(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function renderTaskPage(task) {
  const title = escapeHtml(task.title || "PhoneDex Task");
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

function renderAgentBootstrapSetupPage(setup) {
  const targetHtml = setup.targets.length
    ? setup.targets.map(renderAgentBootstrapTarget).join("\n")
    : "<p>No missing expected agents need bootstrap scripts right now.</p>";
  const inviteMeta = setup.inviteExpiresAt
    ? `<br>Invite expires: ${escapeHtml(setup.inviteExpiresAt)}`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta http-equiv="refresh" content="15">
  <title>PhoneDex Agent Setup</title>
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
      max-width: 820px;
      margin: 0 auto;
      padding: max(20px, env(safe-area-inset-top)) 18px max(32px, env(safe-area-inset-bottom));
    }
    h1 {
      margin: 0 0 8px;
      font-size: clamp(1.55rem, 7vw, 2.35rem);
      line-height: 1.08;
      letter-spacing: 0;
    }
    .summary {
      margin: 0 0 22px;
      color: color-mix(in srgb, CanvasText 72%, transparent);
      overflow-wrap: anywhere;
    }
    section {
      border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
      border-radius: 8px;
      padding: 16px;
      margin: 14px 0;
      background: color-mix(in srgb, CanvasText 4%, Canvas);
    }
    h2 {
      margin: 0 0 4px;
      font-size: 1.05rem;
      letter-spacing: 0;
    }
    .meta {
      margin: 0 0 12px;
      color: color-mix(in srgb, CanvasText 68%, transparent);
      font-size: 0.92rem;
      overflow-wrap: anywhere;
    }
    .install {
      margin: 0 0 12px;
      padding: 9px 10px;
      border-radius: 6px;
      background: color-mix(in srgb, CanvasText 7%, Canvas);
      font-size: 0.92rem;
      overflow-wrap: anywhere;
    }
    .install.ok {
      background: color-mix(in srgb, #34c759 18%, Canvas);
    }
    .install.failed {
      background: color-mix(in srgb, #ff3b30 18%, Canvas);
    }
    pre {
      margin: 0;
      padding: 12px;
      overflow-x: auto;
      border-radius: 6px;
      background: color-mix(in srgb, CanvasText 9%, Canvas);
      font-size: 0.9rem;
      line-height: 1.45;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre;
    }
  </style>
</head>
<body>
  <main>
    <h1>PhoneDex Agent Setup</h1>
    <p class="summary">Hub: ${escapeHtml(setup.hubUrl)}<br>Generated: ${escapeHtml(setup.generatedAt || "unknown")}${inviteMeta}</p>
    ${targetHtml}
  </main>
</body>
</html>`;
}

function renderAgentBootstrapTarget(target) {
  const commandText = target.commands.join("\n");
  const installHtml = renderAgentBootstrapInstallStatus(target.install);
  return `<section>
    <h2>${escapeHtml(target.machineName || target.deviceId || "PhoneDex Agent")}</h2>
    <p class="meta">${escapeHtml(target.deviceId || "")} | ${escapeHtml(target.platform || "")} | ${escapeHtml(target.fileName || "")}</p>
    ${installHtml}
    <pre><code>${escapeHtml(commandText)}</code></pre>
  </section>`;
}

function renderAgentBootstrapInstallStatus(install) {
  if (!install || !install.stage) {
    return '<p class="install pending">Install: not started on this hub yet.</p>';
  }

  const state = install.ok ? "OK" : "FAILED";
  const className = install.ok ? "ok" : "failed";
  const at = install.at ? ` at ${install.at}` : "";
  const message = install.message ? ` - ${install.message}` : "";
  return `<p class="install ${className}">Install: ${escapeHtml(install.stage)} ${state}${escapeHtml(at)}${escapeHtml(message)}</p>`;
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

function sendHtml(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}

function sendJson(res, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}

function sendBuffer(res, status, body, contentType, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": body.length,
    ...extraHeaders
  });
  res.end(body);
}

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function positiveNumber(value, defaultValue) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function parseExpectedDevices(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [deviceId, machineName = ""] = part.split(":", 2).map((item) => item.trim());
      return { deviceId, machineName };
    })
    .filter((device) => device.deviceId);
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function logError(error) {
  const cfg = config();
  const message = redactSensitiveText(error.message || "Unknown error");
  const stack = redactSensitiveText(error.stack || message);
  try {
    appendJsonl(cfg.dataDir, "errors.jsonl", {
      at: new Date().toISOString(),
      message,
      stack
    });
  } catch {
    // Ignore logging failures; hooks should not break Codex turns.
  }
  console.error(stack);
}

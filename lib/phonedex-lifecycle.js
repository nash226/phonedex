"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { addTaskProtocolFields } = require("./phonedex-protocol");
const { supportsAdapterCapability } = require("./phonedex-adapter");

const PROMPT_MAX_LENGTH = 10_000;
const WORKSPACE_NAME_MAX_LENGTH = 240;
const LIFECYCLE_CAPABILITIES = Object.freeze([
  "task.cancel.v1",
  "task.retry.v1"
]);

function createPhoneDexLifecycleManager({ cfg, recordTask, updateTask, findTask, appendEvent }) {
  const activeRuns = new Map();

  return {
    capabilities() {
      return {
        create: supportsAdapterCapability(cfg.adapter, "task.create"),
        cancel: supportsAdapterCapability(cfg.adapter, "task.cancel"),
        retry: supportsAdapterCapability(cfg.adapter, "task.retry")
      };
    },

    workspaceNames() {
      return (cfg.workspaceRoots || []).map((root) => path.basename(root));
    },

    async execute(command) {
      const kind = String(command?.kind || "").trim();
      if (!["create_task", "cancel", "retry"].includes(kind)) {
        throw lifecycleError("unsupported_command", "This lifecycle command is not supported.", 422);
      }

      const capability = kind === "create_task" ? "create" : kind;
      if (!this.capabilities()[capability]) {
        throw lifecycleError(
          "capability_unsupported",
          `The selected agent does not support task ${kind === "create_task" ? "creation" : `${kind}ing`}.`,
          409
        );
      }

      if (kind === "create_task") return createTask(command);
      if (kind === "cancel") return cancelTask(command);
      return retryTask(command);
    }
  };

  async function createTask(command) {
    const prompt = normalizePrompt(command.payload?.prompt);
    const cwd = resolveWorkspace(command.payload || {});
    const now = new Date().toISOString();
    const task = addTaskProtocolFields({
      id: makeId("task"),
      at: now,
      createdAt: now,
      updatedAt: now,
      source: "phone-command",
      title: titleFromPrompt(prompt),
      text: "Waiting for the PhoneDex agent to start this task.",
      cwd,
      workspaceName: path.basename(cwd),
      machineName: cfg.machineName,
      deviceId: cfg.deviceId,
      status: "queued",
      lifecycleCapabilities: [...LIFECYCLE_CAPABILITIES],
      execution: {
        managed: true,
        prompt,
        cwd,
        state: "queued"
      }
    });

    await recordTask(task);
    startManagedRun(task);
    return { task, state: "accepted", message: "Task queued on the selected PhoneDex agent." };
  }

  async function cancelTask(command) {
    const task = requireTask(command);
    const run = activeRuns.get(task.id);
    if (!run) {
      throw lifecycleError(
        "task_not_managed",
        "This task is not an active PhoneDex-managed run, so it cannot be cancelled from iPhone.",
        409
      );
    }

    run.cancelRequested = true;
    await updateTask(task.id, {
      status: "canceling",
      updatedAt: new Date().toISOString(),
      version: nextVersion(task),
      text: "Cancellation requested. Waiting for the agent to stop the task.",
      execution: { ...task.execution, state: "canceling", processId: run.child.pid }
    });
    run.child.kill("SIGTERM");
    appendEvent({ type: "lifecycle-cancel-requested", taskId: task.id, pid: run.child.pid });
    return {
      task: findTask(task.id),
      state: "accepted",
      message: "Cancellation requested."
    };
  }

  async function retryTask(command) {
    const task = requireTask(command);
    if (activeRuns.has(task.id)) {
      throw lifecycleError("task_running", "This task is already running.", 409);
    }
    const prompt = task.execution?.prompt;
    if (!task.execution?.managed || typeof prompt !== "string" || !prompt.trim()) {
      throw lifecycleError(
        "task_not_managed",
        "Only tasks started and tracked by PhoneDex can be retried from iPhone.",
        409
      );
    }

    const current = await updateTask(task.id, {
      status: "queued",
      updatedAt: new Date().toISOString(),
      version: nextVersion(task),
      text: "Waiting for the PhoneDex agent to retry this task.",
      execution: { ...task.execution, state: "queued", processId: null }
    });
    startManagedRun(current || { ...task, status: "queued", execution: task.execution });
    return {
      task: findTask(task.id),
      state: "accepted",
      message: "Task queued for retry."
    };
  }

  function requireTask(command) {
    const taskId = String(command.target?.taskId || "").trim();
    const task = taskId ? findTask(taskId) : null;
    if (!task) throw lifecycleError("task_not_found", "The selected task no longer exists.", 404);
    if (command.expectedTaskVersion && command.expectedTaskVersion !== (task.version || 1)) {
      throw lifecycleError("task_stale", "The task changed before this command arrived. Refresh and try again.", 409, {
        currentTaskVersion: task.version || 1,
        task
      });
    }
    return task;
  }

  function resolveWorkspace(payload) {
    const roots = (cfg.workspaceRoots || []).map((root) => path.resolve(root));
    const requestedName = String(payload.workspaceName || "").trim().slice(0, WORKSPACE_NAME_MAX_LENGTH);
    const requestedPath = String(payload.workspacePath || "").trim();
    const exact = requestedPath ? roots.find((root) => root === path.resolve(requestedPath)) : null;
    const matches = requestedName
      ? roots.filter((root) => path.basename(root) === requestedName)
      : [];
    const cwd = exact || (matches.length === 1 ? matches[0] : null);
    if (!cwd) {
      throw lifecycleError(
        "workspace_unavailable",
        requestedName
          ? "Choose one of the workspaces advertised by the selected agent."
          : "A configured PhoneDex workspace is required to start a task.",
        422
      );
    }
    return cwd;
  }

  function startManagedRun(task) {
    const executable = cfg.autoResumeMode === "app-server" ? cfg.codexAppServerBin : cfg.codexBin;
    const child = spawn(executable, ["exec", "--skip-git-repo-check", task.execution.prompt], {
      cwd: task.execution.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const run = { child, cancelRequested: false, output: "", errorOutput: "" };
    activeRuns.set(task.id, run);
    appendEvent({ type: "lifecycle-started", taskId: task.id, pid: child.pid });
    void updateTask(task.id, {
      status: "running",
      updatedAt: new Date().toISOString(),
      version: nextVersion(task),
      text: "Codex is working on this task.",
      execution: { ...task.execution, state: "running", processId: child.pid }
    });

    child.stdout.on("data", (chunk) => {
      run.output = `${run.output}${chunk.toString("utf8")}`.slice(-PROMPT_MAX_LENGTH);
    });
    child.stderr.on("data", (chunk) => {
      run.errorOutput = `${run.errorOutput}${chunk.toString("utf8")}`.slice(-PROMPT_MAX_LENGTH);
    });
    child.on("error", (error) => {
      run.errorOutput = `${run.errorOutput}${error.message}`.slice(-PROMPT_MAX_LENGTH);
    });
    child.on("close", (code, signal) => {
      void finishManagedRun(task, run, code, signal);
    });
  }

  async function finishManagedRun(task, run, code, signal) {
    if (activeRuns.get(task.id) !== run) return;
    activeRuns.delete(task.id);
    const current = findTask(task.id) || task;
    const cancelled = run.cancelRequested;
    const succeeded = !cancelled && code === 0;
    const status = cancelled ? "cancelled" : succeeded ? "completed" : "failed";
    const output = run.output.trim() || run.errorOutput.trim();
    await updateTask(task.id, {
      status,
      updatedAt: new Date().toISOString(),
      version: nextVersion(current),
      text: output.slice(-PROMPT_MAX_LENGTH) || (cancelled ? "Task cancelled." : `Codex exited with ${signal || `code ${code}`}.`),
      execution: {
        ...current.execution,
        state: status,
        processId: null,
        lastExitCode: Number.isInteger(code) ? code : null
      }
    });
    appendEvent({ type: `lifecycle-${status}`, taskId: task.id, code, signal });
  }
}

function lifecycleError(code, message, statusCode, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
}

function normalizePrompt(value) {
  const prompt = typeof value === "string" ? value.trim() : "";
  if (!prompt) throw lifecycleError("prompt_required", "Enter a prompt before starting a task.", 422);
  if (prompt.length > PROMPT_MAX_LENGTH) {
    throw lifecycleError("prompt_too_long", `Prompts must be at most ${PROMPT_MAX_LENGTH} characters.`, 422);
  }
  return prompt;
}

function titleFromPrompt(prompt) {
  const firstLine = prompt.split(/\r?\n/, 1)[0].trim();
  return (firstLine || "PhoneDex task").slice(0, 120);
}

function nextVersion(task) {
  return (Number.isInteger(task?.version) ? task.version : 1) + 1;
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

module.exports = { LIFECYCLE_CAPABILITIES, createPhoneDexLifecycleManager };

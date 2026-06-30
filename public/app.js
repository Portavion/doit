const form = document.querySelector("#task-form");
const formLabel = form.querySelector("label");
const input = document.querySelector("#description");
const extraFieldsToggle = document.querySelector("#extra-fields-toggle");
const extraToggle = document.querySelector("#extra-toggle");
const extraFields = document.querySelector("#extra-fields");
const uriInput = document.querySelector("#uri-field");
const projectInput = document.querySelector("#project-field");
const waitInput = document.querySelector("#wait-field");
const submit = document.querySelector("#submit");
const refresh = document.querySelector("#refresh");
const sessionButton = document.querySelector("#session");
const luckyButton = document.querySelector("#lucky");
const declareBacklogButton = document.querySelector("#declare-backlog");
const resetCacheButton = document.querySelector("#reset-cache");
const settingsToggle = document.querySelector("#settings-toggle");
const settingsMenu = document.querySelector("#settings-menu");
const statusText = document.querySelector("#status");
const listCaption = document.querySelector("#list-caption");
const backlogStatus = document.querySelector("#backlog-status");
const tomorrowStatus = document.querySelector("#tomorrow-status");
const waitingStatus = document.querySelector("#waiting-status");
const modeToday = document.querySelector("#mode-today");
const modeBacklog = document.querySelector("#mode-backlog");
const modeFuture = document.querySelector("#mode-future");
const projectFilter = document.querySelector("#project-filter");
const todayPanel = document.querySelector("#today-panel");
const backlogPanel = document.querySelector("#backlog-panel");
const futurePanel = document.querySelector("#future-panel");
const list = document.querySelector("#tasks");
const backlogList = document.querySelector("#backlog-tasks");
const tomorrowList = document.querySelector("#tomorrow-tasks");
const waitingList = document.querySelector("#waiting-tasks");
const coarsePointer = window.matchMedia("(pointer: coarse)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const legacySessionStorageKey = "doit.fpvSession.v2";
const taskCacheStorageKey = "doit.taskCache.v1";
const colorschemeStorageKey = "doit.colorscheme.v1";
const projectFilterStorageKey = "doit.projectFilter.v1";
const completeHoldMs = 850;
let completingTaskKey = null;
let lastTouchedKey = "";
let latestTasks = loadTaskCache();
let latestWaitingTasks = [];
let activeProject = storedProjectFilter();
let sessions = {
  today: defaultSession("today"),
  backlog: defaultSession("backlog"),
};
let activeMode = "today";
let session = sessions.today;
let addingToday = false;
const openAnnotationKeys = new Set();
const openSplitKeys = new Set();
const openMoreKeys = new Set();
const openDeleteKeys = new Set();

const colorschemes = ["default", "dark"];
const legacyDarkColorschemes = ["everforest", "gruvbox", "rose-pine"];

const spriteVariants = {
  nodue: ["nodue-1", "nodue-2", "nodue-3", "nodue-4", "nodue-5"],
  overdue: ["angry-1", "angry-2", "angry-3", "angry-4", "angry-5"],
  today: ["today-1", "today-2", "today-3", "today-4", "today-5"],
  tomorrow: ["sleep-1", "sleep-2", "sleep-3", "sleep-4", "sleep-5"],
  default: ["sleep-1", "sleep-2", "sleep-3", "sleep-4", "sleep-5"],
};

function showStatus(message) {
  statusText.textContent = message;
}

function todayKey() {
  return localDateKey(new Date());
}

function tomorrowKey() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return localDateKey(tomorrow);
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function storageDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readStoredJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    if (value === null) {
      return fallback;
    }
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function writeStoredJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    showStatus("Browser storage is unavailable");
  }
}

function storedColorscheme() {
  try {
    const value = localStorage.getItem(colorschemeStorageKey);
    if (colorschemes.includes(value)) {
      return value;
    }
    if (legacyDarkColorschemes.includes(value)) {
      return "dark";
    }
  } catch {
    showStatus("Browser storage is unavailable");
  }
  return "default";
}

function applyColorscheme(colorscheme) {
  let selected = colorscheme;
  if (legacyDarkColorschemes.includes(selected)) {
    selected = "dark";
  }
  if (!colorschemes.includes(selected)) {
    selected = "default";
  }
  document.documentElement.classList.remove(
    "colorscheme-default",
    "colorscheme-dark",
    "colorscheme-everforest",
    "colorscheme-gruvbox",
    "colorscheme-rose-pine",
  );
  if (selected !== "default") {
    document.documentElement.classList.add(`colorscheme-${selected}`);
  }
  for (const option of settingsMenu.querySelectorAll("[name='colorscheme']")) {
    option.checked = option.value === selected;
  }
}

function saveColorscheme(colorscheme) {
  let selected = colorscheme;
  if (!colorschemes.includes(selected)) {
    selected = "default";
  }
  applyColorscheme(selected);
  try {
    localStorage.setItem(colorschemeStorageKey, selected);
  } catch {
    showStatus("Browser storage is unavailable");
  }
}

function storedProjectFilter() {
  try {
    const value = localStorage.getItem(projectFilterStorageKey);
    if (typeof value === "string") {
      return value.trim();
    }
  } catch {
    showStatus("Browser storage is unavailable");
  }
  return "";
}

function saveProjectFilter() {
  try {
    localStorage.setItem(projectFilterStorageKey, activeProject);
  } catch {
    showStatus("Browser storage is unavailable");
  }
}

function defaultSession(mode = "today") {
  return {
    date: storageDateKey(),
    mode,
    startedAt: "",
    entries: [],
    completedKeys: [],
    startedKeys: [],
    clearedKeys: [],
    progressKeys: [],
    scanMarkedKeys: [],
    scanCursorKey: "",
    runKeys: [],
  };
}

function normalizeKeyList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((key) => typeof key === "string" && key !== "");
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const description =
    typeof entry.description === "string" ? entry.description.trim() : "";
  if (description === "") {
    return null;
  }

  const next = {
    key: typeof entry.key === "string" ? entry.key : "",
    taskKey: typeof entry.taskKey === "string" ? entry.taskKey : "",
    id: typeof entry.id === "number" ? entry.id : null,
    uuid: typeof entry.uuid === "string" ? entry.uuid : null,
    description,
    project: typeof entry.project === "string" ? entry.project : null,
    due: typeof entry.due === "string" ? entry.due : null,
    wait: typeof entry.wait === "string" ? entry.wait : null,
    dueDay: typeof entry.dueDay === "string" ? entry.dueDay : "",
    uri: typeof entry.uri === "string" ? entry.uri : "",
    annotations: normalizeAnnotations(entry.annotations),
    fingerprint:
      typeof entry.fingerprint === "string" ? entry.fingerprint : "",
    readded: Boolean(entry.readded),
    extra: Boolean(entry.extra),
    backlog: Boolean(entry.backlog),
    waiting:
      typeof entry.waiting === "boolean" ? entry.waiting : Boolean(entry.readded),
  };

  if (next.fingerprint === "") {
    next.fingerprint = taskFingerprint(next);
  }
  if (next.taskKey === "") {
    next.taskKey = taskKey(next);
  }
  if (next.key === "") {
    next.key = next.taskKey;
  }
  if (next.dueDay === "") {
    next.dueDay = dueDateKey(next);
  }

  return next;
}

function normalizeSession(value, mode = "today") {
  if (!value || typeof value !== "object" || value.date !== storageDateKey()) {
    return defaultSession(mode);
  }

  const entries = Array.isArray(value.entries)
    ? value.entries.map(normalizeEntry).filter(Boolean)
    : [];
  return {
    ...defaultSession(mode),
    ...value,
    mode,
    entries,
    completedKeys: normalizeKeyList(value.completedKeys),
    startedKeys: normalizeKeyList(value.startedKeys),
    clearedKeys: normalizeKeyList(value.clearedKeys),
    progressKeys: normalizeKeyList(value.progressKeys),
    scanMarkedKeys: normalizeKeyList(value.scanMarkedKeys),
    scanCursorKey:
      typeof value.scanCursorKey === "string" ? value.scanCursorKey : "",
    runKeys: normalizeKeyList(value.runKeys),
  };
}

function normalizeWorkflowState(value) {
  if (value?.version === 2 && value.sessions && typeof value.sessions === "object") {
    const nextSessions = {
      today: normalizeSession(value.sessions.today, "today"),
      backlog: normalizeSession(value.sessions.backlog, "backlog"),
    };
    return {
      activeMode: ["today", "backlog", "future"].includes(value.activeMode)
        ? value.activeMode
        : "today",
      sessions: nextSessions,
    };
  }

  return {
    activeMode: "today",
    sessions: {
      today: normalizeSession(value, "today"),
      backlog: defaultSession("backlog"),
    },
  };
}

function workflowState() {
  return {
    version: 2,
    activeMode,
    sessions,
  };
}

function hasAnySession() {
  return hasSession(sessions.today) || hasSession(sessions.backlog);
}

function syncActiveSession() {
  if (activeMode === "backlog") {
    session = sessions.backlog;
    return;
  }
  session = sessions.today;
}

function saveSession() {
  clearLegacySession();
  void saveWorkflowSession();
}

function clearLegacySession() {
  try {
    localStorage.removeItem(legacySessionStorageKey);
  } catch {
    showStatus("Browser storage is unavailable");
  }
}

function resetSessionAfterIssue(message = "Workflow session reset") {
  sessions = {
    today: defaultSession("today"),
    backlog: defaultSession("backlog"),
  };
  syncActiveSession();
  lastTouchedKey = "";
  clearLegacySession();
  showStatus(message);
  renderApp({ animated: true });
}

async function loadWorkflowSession({ animated = true } = {}) {
  try {
    const response = await fetch("/api/workflow-session", { cache: "no-store" });
    const body = await parseResponse(response);
    clearLegacySession();
    const next = normalizeWorkflowState(body.session);
    sessions = next.sessions;
    activeMode = next.activeMode;
    syncActiveSession();
    if (body.session && !hasAnySession()) {
      await clearWorkflowSession();
      showStatus("Workflow session reset");
    }
    renderApp({ animated, focusKey: session.scanCursorKey });
  } catch {
    resetSessionAfterIssue();
  }
}

async function saveWorkflowSession() {
  if (!hasAnySession()) {
    await clearWorkflowSession();
    return;
  }

  try {
    const response = await fetch("/api/workflow-session", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: workflowState() }),
    });
    await parseResponse(response);
  } catch {
    resetSessionAfterIssue();
  }
}

async function clearWorkflowSession() {
  try {
    const response = await fetch("/api/workflow-session", {
      method: "DELETE",
    });
    await parseResponse(response);
  } catch {
    resetSessionAfterIssue();
  }
}

function loadTaskCache() {
  return normalizeTasks(readStoredJson(taskCacheStorageKey, []));
}

function saveTaskCache(tasks) {
  writeStoredJson(taskCacheStorageKey, tasks);
}

function clearTaskCache() {
  try {
    localStorage.removeItem(taskCacheStorageKey);
  } catch {
    showStatus("Browser storage is unavailable");
  }
}

function clearAppStorage() {
  try {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith("doit.") && key !== colorschemeStorageKey) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      localStorage.removeItem(key);
    }
    sessionStorage.clear();
  } catch {
    showStatus("Browser storage is unavailable");
  }
}

async function clearBrowserCaches() {
  if (!window.caches) {
    return;
  }

  const names = await caches.keys();
  await Promise.all(names.map((name) => caches.delete(name)));
}

function normalizeTasks(tasks) {
  if (!Array.isArray(tasks)) {
    return [];
  }

  return tasks
    .map((task) => {
      if (typeof task === "string") {
        return { description: task };
      }
      if (!task || typeof task !== "object") {
        return null;
      }
      return task;
    })
    .filter((task) => task && taskDescription(task) !== "");
}

function normalizeAnnotations(annotations) {
  if (!Array.isArray(annotations)) {
    return [];
  }

  return annotations
    .filter((annotation) => {
      return (
        annotation &&
        typeof annotation === "object" &&
        typeof annotation.description === "string" &&
        annotation.description.trim() !== ""
      );
    })
    .map((annotation) => {
      return {
        entry: typeof annotation.entry === "string" ? annotation.entry : "",
        description: annotation.description.trim(),
      };
    })
    .sort((first, second) => first.entry.localeCompare(second.entry));
}

function dueDateKey(task) {
  return taskDateKey(task?.due);
}

function waitDateKey(task) {
  return taskDateKey(task?.wait);
}

function taskDateKey(value) {
  if (typeof value !== "string") {
    return "";
  }

  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
  );
  if (!match) {
    const day = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (day) {
      return `${day[1]}${day[2]}${day[3]}`;
    }
    return value.slice(0, 8).replaceAll("-", "");
  }

  const [, year, month, day, hour, minute, second] = match;
  return localDateKey(
    new Date(Date.UTC(year, month - 1, day, hour, minute, second)),
  );
}

function taskDescription(task) {
  if (typeof task === "string") {
    return task.trim();
  }
  if (typeof task?.description === "string") {
    return task.description.trim();
  }
  if (typeof task?.line === "string") {
    return task.line.trim();
  }
  return "";
}

function taskUri(task) {
  return typeof task?.uri === "string" ? task.uri.trim() : "";
}

function taskExtra(task) {
  if (Array.isArray(task?.tags) && task.tags.includes("extra")) {
    return true;
  }
  return Boolean(task?.extra);
}

function taskBacklog(task) {
  if (Array.isArray(task?.tags) && task.tags.includes("backlog")) {
    return true;
  }
  return Boolean(task?.backlog);
}

function taskProject(task) {
  if (typeof task?.project === "string" && task.project.trim() !== "") {
    return task.project.trim();
  }
  return "Inbox";
}

function projectVisible(task) {
  if (activeProject === "") {
    return true;
  }
  return taskProject(task) === activeProject;
}

function visibleTasks(tasks) {
  const visible = [];
  for (const task of tasks) {
    if (projectVisible(task)) {
      visible.push(task);
    }
  }
  return visible;
}

function addProject(projects, task) {
  const project = taskProject(task);
  if (!projects.includes(project)) {
    projects.push(project);
  }
}

function availableProjects() {
  const projects = [];
  for (const task of latestTasks) {
    addProject(projects, task);
  }
  for (const task of latestWaitingTasks) {
    addProject(projects, task);
  }
  for (const mode of ["today", "backlog"]) {
    for (const entry of sessions[mode].entries) {
      addProject(projects, entry);
    }
  }
  projects.sort(function (first, second) {
    return first.localeCompare(second);
  });
  return projects;
}

function taskId(task) {
  return typeof task?.id === "number" ? task.id : null;
}

function taskUuid(task) {
  if (typeof task?.uuid === "string" && task.uuid.trim() !== "") {
    return task.uuid.trim();
  }
  return null;
}

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function taskFingerprint(task) {
  return JSON.stringify([taskDescription(task), dueDateKey(task), taskUri(task)]);
}

function taskKey(task) {
  const uuid = taskUuid(task);
  if (uuid !== null) {
    return `task:${uuid}`;
  }
  const id = taskId(task);
  if (id !== null) {
    return `task:${id}`;
  }
  return `draft:${hashText(taskFingerprint(task))}`;
}

function entryFromTask(task, key = taskKey(task)) {
  return {
    key,
    taskKey: taskKey(task),
    id: taskId(task),
    uuid: taskUuid(task),
    description: taskDescription(task),
    project: typeof task?.project === "string" ? task.project : null,
    due: typeof task?.due === "string" ? task.due : null,
    wait: typeof task?.wait === "string" ? task.wait : null,
    dueDay: dueDateKey(task),
    uri: taskUri(task),
    annotations: normalizeAnnotations(task?.annotations),
    fingerprint: taskFingerprint(task),
    readded: false,
    extra: taskExtra(task),
    backlog: taskBacklog(task),
    waiting: false,
  };
}

function readdedEntry(entry) {
  const suffix = `${Date.now()}-${hashText(`${entry.key}-${Math.random()}`)}`;
  return {
    ...entry,
    key: `${entry.taskKey}:again:${suffix}`,
    readded: true,
    extra: entry.extra,
    backlog: entry.backlog,
    waiting: true,
  };
}

function variantIndex(key, count) {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 9973;
  }
  return hash % count;
}

function spriteClass(task, dueDay, currentDay, nextDay, description) {
  let state = "default";
  if (dueDay === "") {
    state = "nodue";
  }
  if (dueDay !== "" && dueDay < currentDay) {
    state = "overdue";
  }
  if (dueDay === currentDay) {
    state = "today";
  }
  if (dueDay === nextDay) {
    state = "tomorrow";
  }

  const variants = spriteVariants[state];
  const key = `${taskId(task) ?? ""}-${description}-${dueDay}-${state}`;
  return `sprite ${variants[variantIndex(key, variants.length)]}`;
}

function todayWorkTasks(tasks) {
  return [...regularTodayWorkTasks(tasks), ...extraTodayTasks(tasks)];
}

function regularTodayWorkTasks(tasks) {
  const currentDay = todayKey();
  return tasks.filter((task) => {
    const dueDay = dueDateKey(task);
    return (
      dueDay !== "" &&
      dueDay <= currentDay &&
      !taskExtra(task) &&
      !taskBacklog(task)
    );
  });
}

function extraTodayTasks(tasks) {
  const currentDay = todayKey();
  return tasks.filter((task) => {
    const dueDay = dueDateKey(task);
    return (
      dueDay !== "" &&
      dueDay <= currentDay &&
      taskExtra(task) &&
      !taskBacklog(task)
    );
  });
}

function futureWorkTasks(tasks) {
  const currentDay = todayKey();
  return tasks.filter((task) => {
    const dueDay = dueDateKey(task);
    return !taskBacklog(task) && (dueDay === "" || dueDay > currentDay);
  });
}

function waitingWorkTasks(tasks) {
  return visibleTasks(tasks).sort(function (first, second) {
    const firstWait = waitDateKey(first);
    const secondWait = waitDateKey(second);
    if (firstWait !== secondWait) {
      return firstWait.localeCompare(secondWait);
    }
    return dueDateKey(first).localeCompare(dueDateKey(second));
  });
}

function backlogTasks(tasks) {
  return tasks.filter(taskBacklog);
}

function backlogCandidateTasks() {
  return visibleTasks(todayWorkTasks(latestTasks)).filter((task) => {
    return !taskBacklog(task) && Number.isInteger(taskId(task));
  });
}

function backlogCaption(tasks) {
  const declared = tasks
    .flatMap((task) => normalizeAnnotations(task.annotations))
    .map((annotation) => annotation.description.match(/^Declared backlog: (\d{4})-(\d{2})-(\d{2})$/))
    .filter(Boolean)
    .map((match) => `${match[1]}-${match[2]}-${match[3]}`)
    .sort()
    .pop();
  const count = `${tasks.length} backlog`;
  if (!declared) {
    return count;
  }

  return `${count} · declared ${shortDateLabel(declared)}`;
}

function shortDateLabel(date) {
  if (/^\d{8}$/.test(date)) {
    date = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  }
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) {
    return date;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(year, month - 1, day));
}

function hasSession(value = session) {
  return value.date === storageDateKey() && value.entries.length > 0;
}

function crossedKeySet() {
  return new Set([
    ...session.completedKeys,
    ...session.startedKeys,
    ...session.clearedKeys,
  ]);
}

function isCrossed(key) {
  return crossedKeySet().has(key);
}

function entryByKey(key) {
  return session.entries.find((entry) => entry.key === key) || null;
}

function openEntries() {
  const crossed = crossedKeySet();
  return session.entries.filter((entry) => !crossed.has(entry.key));
}

function extraLast(entries) {
  const regularEntries = [];
  const extraEntries = [];
  for (const entry of entries) {
    if (entry.extra) {
      extraEntries.push(entry);
    } else {
      regularEntries.push(entry);
    }
  }
  return [...regularEntries, ...extraEntries];
}

function orderedOpenEntries() {
  if (session.mode === "backlog") {
    return openEntries();
  }
  return extraLast(openEntries());
}

function scanActive() {
  return session.scanMarkedKeys.length > 0 && session.scanCursorKey !== "";
}

function activeRunKeys() {
  const crossed = crossedKeySet();
  return session.runKeys.filter((key) => entryByKey(key) && !crossed.has(key));
}

function runActive() {
  return activeRunKeys().length > 0;
}

function currentRunEntry() {
  const key = activeRunKeys()[0];
  return key ? entryByKey(key) : null;
}

function currentMarkedEntry() {
  for (let index = session.scanMarkedKeys.length - 1; index >= 0; index -= 1) {
    const entry = entryByKey(session.scanMarkedKeys[index]);
    if (entry && !isCrossed(entry.key)) {
      return entry;
    }
  }
  return null;
}

function scanCandidateEntry() {
  if (session.scanCursorKey === "") {
    return null;
  }
  const entry = entryByKey(session.scanCursorKey);
  if (!entry || isCrossed(entry.key)) {
    return null;
  }
  return entry;
}

function nextOpenKeyAfter(key) {
  const entries = orderedOpenEntries();
  const index = entries.findIndex((entry) => entry.key === key);
  if (index === -1) {
    return entries[0]?.key || "";
  }
  return entries[index + 1]?.key || "";
}

function uniqueKeys(keys) {
  return keys.filter((key, index) => key !== "" && keys.indexOf(key) === index);
}

function compactSession() {
  const entryKeys = new Set(session.entries.map((entry) => entry.key));
  session.completedKeys = uniqueKeys(session.completedKeys).filter((key) =>
    entryKeys.has(key),
  );
  session.startedKeys = uniqueKeys(session.startedKeys).filter((key) =>
    entryKeys.has(key),
  );
  session.clearedKeys = uniqueKeys(session.clearedKeys).filter((key) =>
    entryKeys.has(key),
  );
  session.progressKeys = uniqueKeys(session.progressKeys).filter(
    (key) => entryKeys.has(key) && !isCrossed(key),
  );
  session.runKeys = uniqueKeys(session.runKeys).filter((key) => {
    const entry = entryByKey(key);
    return entry && entryKeys.has(key) && !entry.waiting && !isCrossed(key);
  });
  session.scanMarkedKeys = uniqueKeys(session.scanMarkedKeys).filter((key) => {
    const entry = entryByKey(key);
    return entry && entryKeys.has(key) && !entry.waiting && !isCrossed(key);
  });
  if (
    session.scanCursorKey &&
    (!entryKeys.has(session.scanCursorKey) ||
      isCrossed(session.scanCursorKey) ||
      entryByKey(session.scanCursorKey)?.waiting)
  ) {
    const lastMarked =
      session.scanMarkedKeys[session.scanMarkedKeys.length - 1] || "";
    session.scanCursorKey = nextOpenKeyAfter(lastMarked);
  }
}

function reconcileSession(tasks) {
  if (!hasSession()) {
    return false;
  }

  let changed = false;
  const tasksByKey = new Map();
  const tasksByFingerprint = new Map();
  for (const task of tasks) {
    tasksByKey.set(taskKey(task), task);
    tasksByFingerprint.set(taskFingerprint(task), task);
  }

  for (const entry of session.entries) {
    if (isCrossed(entry.key)) {
      continue;
    }

    const task =
      tasksByKey.get(entry.taskKey) || tasksByFingerprint.get(entry.fingerprint);
    if (!task) {
      session.clearedKeys.push(entry.key);
      changed = true;
      continue;
    }
    if (session.mode !== "backlog" && taskBacklog(task)) {
      session.clearedKeys.push(entry.key);
      changed = true;
      continue;
    }
    if (session.mode === "backlog" && !taskBacklog(task)) {
      session.clearedKeys.push(entry.key);
      changed = true;
      continue;
    }

    const next = entryFromTask(task, entry.key);
    for (const field of [
      "taskKey",
      "id",
      "uuid",
      "description",
      "project",
      "due",
      "wait",
      "dueDay",
      "uri",
      "annotations",
      "fingerprint",
      "extra",
      "backlog",
    ]) {
      const current = field === "annotations" ? JSON.stringify(entry[field]) : entry[field];
      const value = field === "annotations" ? JSON.stringify(next[field]) : next[field];
      if (current !== value) {
        entry[field] = next[field];
        changed = true;
      }
    }
  }

  compactSession();
  return changed;
}

function reconcileSessions(tasks) {
  const mode = activeMode;
  let changed = false;
  for (const nextMode of ["today", "backlog"]) {
    activeMode = nextMode;
    syncActiveSession();
    if (reconcileSession(tasks)) {
      changed = true;
    }
  }
  activeMode = mode;
  syncActiveSession();
  return changed;
}

function handleSessionButton() {
  if (activeMode === "future") {
    return;
  }
  if (!hasSession()) {
    startSession();
    return;
  }

  if (scanActive() || runActive()) {
    stopSession();
    return;
  }

  const entries = orderedOpenEntries();
  if (entries.length > 0) {
    beginPass(entries, "Session started");
    return;
  }

  startSession();
}

function stopSession(message = "Stopped FPV session") {
  sessions[session.mode] = defaultSession(session.mode);
  syncActiveSession();
  lastTouchedKey = "";
  clearLegacySession();
  saveSession();
  showStatus(message);
  renderApp({ animated: true });
}

function startSession() {
  let tasks = visibleTasks(todayWorkTasks(latestTasks));
  if (activeMode === "backlog") {
    tasks = visibleTasks(backlogTasks(latestTasks));
  }
  const entries = tasks.map(function (task) {
    return entryFromTask(task);
  });
  if (entries.length === 0) {
    showStatus("No tasks are ready");
    renderApp({ animated: true });
    return;
  }

  sessions[activeMode] = {
    ...defaultSession(activeMode),
    startedAt: new Date().toISOString(),
    entries,
  };
  syncActiveSession();
  beginPass(entries, "Session started");
}

function startLuckySession() {
  if (activeMode !== "today" || scanActive() || runActive()) {
    return;
  }

  let entries = orderedOpenEntries();
  if (!hasSession()) {
    const tasks = visibleTasks(todayWorkTasks(latestTasks));
    entries = tasks.map(function (task) {
      return entryFromTask(task);
    });
    sessions.today = {
      ...defaultSession("today"),
      startedAt: new Date().toISOString(),
      entries,
    };
    syncActiveSession();
  }

  if (entries.length === 0) {
    showStatus("No tasks are ready");
    renderApp({ animated: true });
    return;
  }

  for (const entry of entries) {
    entry.waiting = false;
  }
  const luckyEntry = entries[Math.floor(Math.random() * entries.length)];
  session.scanMarkedKeys = [];
  session.scanCursorKey = "";
  session.runKeys = [luckyEntry.key];
  saveSession();
  showStatus("Picked a task");
  renderApp({ animated: true, focusKey: luckyEntry.key });
}

function beginPass(entries, message) {
  if (session.mode !== "backlog") {
    entries = extraLast(entries);
  }
  for (const entry of entries) {
    entry.waiting = false;
  }
  session.scanMarkedKeys = [];
  session.scanCursorKey = "";
  session.runKeys = [];

  if (entries.length === 0) {
    showStatus("No open tasks");
    saveSession();
    renderApp({ animated: true });
    return;
  }

  if (entries.length === 1) {
    session.runKeys = [entries[0].key];
    saveSession();
    showStatus("Dotted the only open task");
    renderApp({ animated: true, focusKey: entries[0].key });
    return;
  }

  session.scanMarkedKeys = [entries[0].key];
  session.scanCursorKey = entries[1].key;
  saveSession();
  showStatus(message);
  renderApp({ animated: true, focusKey: session.scanCursorKey });
}

function advanceScan(shouldMark) {
  const candidate = scanCandidateEntry();
  if (!candidate) {
    finishScan();
    return;
  }

  if (shouldMark && !session.scanMarkedKeys.includes(candidate.key)) {
    session.scanMarkedKeys.push(candidate.key);
  }

  const nextKey = nextOpenKeyAfter(candidate.key);
  if (nextKey === "") {
    finishScan(shouldMark ? candidate.key : "");
    return;
  }

  session.scanCursorKey = nextKey;
  showStatus(shouldMark ? "Dotted task" : "Skipped task");
  renderApp({ animated: true, focusKey: nextKey });
  saveSession();
}

function finishScan(markedKey = "") {
  const openKeys = new Set(openEntries().map((entry) => entry.key));
  const markedKeys = session.scanMarkedKeys.filter((key) => openKeys.has(key));
  if (session.mode === "backlog") {
    session.runKeys = markedKeys.slice().reverse();
    session.scanMarkedKeys = [];
    session.scanCursorKey = "";
    const focusKey = activeRunKeys()[0] || markedKey || session.runKeys[0] || "";
    showStatus("Dotted chain ready");
    renderApp({ animated: true, focusKey });
    saveSession();
    return;
  }

  session.runKeys = markedKeys.slice().reverse();
  session.scanMarkedKeys = [];
  session.scanCursorKey = "";
  const focusKey = activeRunKeys()[0] || markedKey || session.runKeys[0] || "";
  showStatus("Dotted chain ready");
  renderApp({ animated: true, focusKey });
  saveSession();
}

function crossOff(key, bucket) {
  if (!entryByKey(key)) {
    return false;
  }

  if (!session[bucket].includes(key)) {
    session[bucket].push(key);
  }
  lastTouchedKey = key;
  const runFinished =
    session.runKeys.includes(key) &&
    !session.runKeys.some((runKey) => {
      return runKey !== key && entryByKey(runKey) && !isCrossed(runKey);
    });
  compactSession();
  saveSession();
  return runFinished;
}

function clearActiveSession() {
  sessions[session.mode] = defaultSession(session.mode);
  syncActiveSession();
  lastTouchedKey = "";
  clearLegacySession();
  saveSession();
}

function hasProgressEvidence(key) {
  return session.progressKeys.includes(key);
}

function markProgressEvidence(key) {
  if (!session.progressKeys.includes(key)) {
    session.progressKeys.push(key);
  }
}

function startAgain(key) {
  const entry = entryByKey(key);
  if (!entry || isCrossed(key) || !hasProgressEvidence(key)) {
    return;
  }

  const nextEntry = readdedEntry(entry);
  session.entries.push(nextEntry);
  const runFinished = crossOff(key, "startedKeys");
  if (runFinished) {
    session.runKeys = [];
    session.scanMarkedKeys = [];
    session.scanCursorKey = "";
    lastTouchedKey = nextEntry.key;
    compactSession();
    saveSession();
    showStatus("Moved to end");
    renderApp({ animated: true, focusKey: nextEntry.key });
    return;
  }

  lastTouchedKey = nextEntry.key;
  saveSession();
  showStatus("Moved to end");
  renderApp({ animated: true, focusKey: activeRunKeys()[0] || "" });
}

function renderApp({ animated = false, focusKey = "" } = {}) {
  renderModeSwitch();
  renderProjectFilter();
  renderSessionButton();
  renderTasks({ animated });
  renderBacklogTasks({ animated });
  renderTomorrowTasks({ animated });
  renderWaitingTasks({ animated });
  if (animated) {
    scrollToTask(focusKey);
  }
}

function scrollToTask(key) {
  if (key === "") {
    return;
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const item = taskNodeByKey(key);
      if (!item) {
        return;
      }
      item.scrollIntoView({
        block: "center",
        behavior: reducedMotion.matches ? "auto" : "smooth",
      });
    });
  });
}

function taskNodeByKey(key) {
  return Array.from(document.querySelectorAll(".tasks [data-task-key]")).find(
    (node) => node.dataset.taskKey === key && !node.closest("[hidden]"),
  );
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function markCompletingCard(key) {
  const item = taskNodeByKey(key);
  if (!item) {
    return;
  }

  item.classList.add("completing", "complete-flash");
  const button = item.querySelector(".complete-button");
  if (button) {
    button.disabled = true;
  }
}

function createAction(label, className, handler, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", handler);
  return button;
}

function setActiveMode(mode) {
  activeMode = ["today", "backlog", "future"].includes(mode) ? mode : "today";
  syncActiveSession();
  saveSession();
  renderApp({ animated: true, focusKey: session.scanCursorKey });
}

function renderModeSwitch() {
  for (const [mode, button] of [
    ["today", modeToday],
    ["backlog", modeBacklog],
    ["future", modeFuture],
  ]) {
    const active = activeMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  todayPanel.hidden = activeMode !== "today";
  backlogPanel.hidden = activeMode !== "backlog";
  futurePanel.hidden = activeMode !== "future";
}

function renderProjectFilter() {
  const projects = availableProjects();
  if (activeProject !== "" && !projects.includes(activeProject)) {
    activeProject = "";
    saveProjectFilter();
  }

  projectFilter.textContent = "";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All projects";
  projectFilter.append(allOption);

  for (const project of projects) {
    const option = document.createElement("option");
    option.value = project;
    option.textContent = project;
    projectFilter.append(option);
  }

  projectFilter.value = activeProject;
  projectFilter.disabled = hasAnySession();
}

function renderSessionButton() {
  const readyCount = visibleTasks(todayWorkTasks(latestTasks)).length;
  const openCount = hasSession() ? openEntries().length : readyCount;
  const luckyCount = hasSession() ? orderedOpenEntries().length : readyCount;
  const active = scanActive() || runActive();
  sessionButton.classList.toggle("session-start", !active);
  sessionButton.classList.toggle("session-stop", active);
  sessionButton.hidden = activeMode !== "today";
  sessionButton.disabled =
    activeMode !== "today" || (openCount === 0 && readyCount === 0 && !active);
  luckyButton.hidden = activeMode !== "today";
  luckyButton.disabled = activeMode !== "today" || active || luckyCount === 0;
  declareBacklogButton.disabled = backlogCandidateTasks().length === 0;

  if (active) {
    sessionButton.textContent = "Stop";
    return;
  }
  sessionButton.textContent = "Start";
}

function renderTasks({ animated = false } = {}) {
  if (activeMode !== "today") {
    return;
  }

  if (!hasSession()) {
    renderReadyTasks({ animated });
    return;
  }

  compactSession();
  if (scanActive()) {
    const entries = extraLast(openEntries());
    const items = [];
    entries.forEach((entry, index) => {
      pushTaskItem(items, entry, { index, sessionTask: true });
    });
    listCaption.textContent = `${entries.length} task${
      entries.length === 1 ? "" : "s"
    }`;
    if (entries.length === 0) {
      items.push(emptyListItem("today-empty", "No open session tasks"));
    }
    renderKeyedList(list, items, animated);
    return;
  }

  if (session.runKeys.length > 0) {
    renderRunTasks({ animated });
    return;
  }

  const entries = extraLast(openEntries());
  const items = [];
  listCaption.textContent = `${entries.length} task${
    entries.length === 1 ? "" : "s"
  }`;
  if (entries.length === 0) {
    items.push(emptyListItem("today-empty", "No open session tasks"));
    renderKeyedList(list, items, animated);
    return;
  }
  entries.forEach((entry, index) => {
    pushTaskItem(items, entry, { index, sessionTask: true });
  });
  renderKeyedList(list, items, animated);
}

function renderReadyTasks({ animated = false } = {}) {
  const tasks = visibleTasks(todayWorkTasks(latestTasks));
  const items = [];
  listCaption.textContent = `${tasks.length} task${
    tasks.length === 1 ? "" : "s"
  }`;
  if (tasks.length === 0) {
    items.push(emptyListItem("today-empty", "Nothing due today"));
    renderKeyedList(list, items, animated);
    return;
  }
  tasks.forEach((task, index) => {
    pushTaskItem(items, entryFromTask(task), { index, preview: true });
  });
  renderKeyedList(list, items, animated);
}

function renderBacklogTasks({ animated = false } = {}) {
  if (activeMode !== "backlog") {
    return;
  }

  if (!hasSession()) {
    renderReadyBacklogTasks({ animated });
    return;
  }

  compactSession();
  if (scanActive()) {
    const items = [];
    let taskCount = 0;
    session.entries.forEach((entry, index) => {
      if (isCrossed(entry.key)) {
        return;
      }
      taskCount += 1;
      pushTaskItem(items, entry, { backlog: true, index, sessionTask: true });
    });
    backlogStatus.textContent = `${taskCount} backlog`;
    if (taskCount === 0) {
      items.push(emptyListItem("backlog-empty", "No backlog tasks"));
    }
    renderKeyedList(backlogList, items, animated);
    return;
  }

  if (session.runKeys.length > 0) {
    renderBacklogRunTasks({ animated });
    return;
  }

  const entries = openEntries();
  const items = [];
  backlogStatus.textContent = `${entries.length} backlog`;
  if (entries.length === 0) {
    items.push(emptyListItem("backlog-empty", "No backlog tasks"));
    renderKeyedList(backlogList, items, animated);
    return;
  }
  entries.forEach((entry, index) => {
    pushTaskItem(items, entry, { backlog: true, index, sessionTask: true });
  });
  renderKeyedList(backlogList, items, animated);
}

function renderReadyBacklogTasks({ animated = false } = {}) {
  const tasks = visibleTasks(backlogTasks(latestTasks));
  const items = [];
  backlogStatus.textContent = backlogCaption(tasks);
  if (tasks.length === 0) {
    items.push(emptyListItem("backlog-empty", "No backlog tasks"));
    renderKeyedList(backlogList, items, animated);
    return;
  }
  tasks.forEach((task, index) => {
    pushTaskItem(items, entryFromTask(task), {
      backlog: true,
      index,
      preview: true,
    });
  });
  renderKeyedList(backlogList, items, animated);
}

function renderBacklogRunTasks({ animated = false } = {}) {
  const runKeys = activeRunKeys();
  const runKeySet = new Set(runKeys);
  const items = [];
  let hiddenCount = 0;
  backlogStatus.textContent = `${runKeys.length} backlog`;

  session.entries.forEach((entry, index) => {
    if (isCrossed(entry.key)) {
      return;
    }

    if (runKeySet.has(entry.key)) {
      pushTaskItem(items, entry, { backlog: true, index, sessionTask: true });
      return;
    }

    hiddenCount += 1;
  });

  if (hiddenCount > 0) {
    items.push(hiddenListItem(hiddenCount));
  }
  if (items.length === 0) {
    items.push(emptyListItem("backlog-empty", "No open backlog tasks"));
  }
  renderKeyedList(backlogList, items, animated);
}

function renderRunTasks({ animated = false } = {}) {
  const runKeys = activeRunKeys();
  const runKeySet = new Set(runKeys);
  const items = [];
  let hiddenCount = 0;
  listCaption.textContent = `${runKeys.length} task${
    runKeys.length === 1 ? "" : "s"
  }`;

  extraLast(session.entries).forEach((entry, index) => {
    if (isCrossed(entry.key)) {
      return;
    }

    if (runKeySet.has(entry.key)) {
      pushTaskItem(items, entry, { index, sessionTask: true });
      return;
    }

    hiddenCount += 1;
  });

  if (hiddenCount > 0) {
    items.push(hiddenListItem(hiddenCount));
  }
  if (items.length === 0) {
    items.push(emptyListItem("today-empty", "No open session tasks"));
  }
  renderKeyedList(list, items, animated);
}

function renderTomorrowTasks({ animated = false } = {}) {
  if (activeMode !== "future") {
    return;
  }

  const sessionTaskKeys = new Set(session.entries.map((entry) => entry.taskKey));
  const tasks = [];
  for (const task of visibleTasks(futureWorkTasks(latestTasks))) {
    if (!sessionTaskKeys.has(taskKey(task))) {
      tasks.push(task);
    }
  }
  const items = [];
  tomorrowStatus.textContent = `${tasks.length} future`;
  if (tasks.length === 0) {
    items.push(emptyListItem("future-empty", "No future tasks"));
    renderKeyedList(tomorrowList, items, animated);
    return;
  }
  tasks.forEach((task, index) => {
    pushTaskItem(items, entryFromTask(task), {
      tomorrow: true,
      index,
    });
  });
  renderKeyedList(tomorrowList, items, animated);
}

function renderWaitingTasks({ animated = false } = {}) {
  if (activeMode !== "future") {
    waitingList.textContent = "";
    return;
  }

  const tasks = waitingWorkTasks(latestWaitingTasks);
  waitingStatus.textContent = `${tasks.length} waiting`;

  const items = [];
  if (tasks.length === 0) {
    items.push(emptyListItem("waiting-empty", "No waiting tasks"));
    renderKeyedList(waitingList, items, animated);
    return;
  }

  tasks.forEach(function (task, index) {
    items.push(waitingListItem(entryFromTask(task), index));
  });
  renderKeyedList(waitingList, items, animated);
}

function pushTaskItem(items, entry, options = {}) {
  const current = currentRunEntry();
  const candidate = scanCandidateEntry();
  const isCurrent = Boolean(options.sessionTask) && current?.key === entry.key;
  const isCandidate =
    Boolean(options.sessionTask) && candidate?.key === entry.key;
  items.push(taskListItem(entry, options));
  if (openAnnotationKeys.has(entry.taskKey)) {
    items.push(annotationListItem(entry));
  }
  if (isCandidate || isCurrent) {
    items.push(actionListItem(entry, { isCandidate, isCurrent }));
  }
}

function taskListItem(entry, options) {
  return {
    key: `task:${entry.taskKey || entry.key}`,
    type: "task",
    entry,
    options,
  };
}

function actionListItem(entry, state) {
  return {
    key: state.isCandidate ? "action:scan" : "action:current",
    type: "action",
    entry,
    state,
  };
}

function annotationListItem(entry) {
  return {
    key: `annotation:${entry.taskKey || entry.key}`,
    type: "annotation",
    entry,
  };
}

function emptyListItem(key, message) {
  return {
    key: `empty:${key}`,
    type: "empty",
    message,
  };
}

function hiddenListItem(count) {
  return {
    key: "hidden:undotted",
    type: "hidden",
    count,
  };
}

function waitingListItem(entry, index) {
  return {
    key: `waiting:${entry.taskKey || entry.key}`,
    type: "waiting",
    entry,
    index,
  };
}

function renderKeyedList(target, items, animated = false) {
  const before = animated ? measureListItems(target) : new Map();
  const existing = new Map();
  for (const node of Array.from(target.children)) {
    if (node.dataset.renderKey) {
      existing.set(node.dataset.renderKey, node);
    }
  }

  const nextKeys = new Set();
  for (const item of items) {
    nextKeys.add(item.key);
    let node = existing.get(item.key);
    let created = false;
    if (!node || node.dataset.renderType !== item.type) {
      if (node) {
        removeListNode(node, before.get(item.key), animated);
      }
      node = document.createElement("li");
      created = true;
    }

    node.dataset.renderKey = item.key;
    node.dataset.renderType = item.type;
    patchListNode(node, item);
    if (created && animated && !reducedMotion.matches) {
      node.classList.add("entering");
      node.addEventListener(
        "animationend",
        () => node.classList.remove("entering"),
        { once: true },
      );
    }
    target.append(node);
  }

  for (const node of Array.from(target.children)) {
    if (!nextKeys.has(node.dataset.renderKey)) {
      removeListNode(node, before.get(node.dataset.renderKey), animated);
    }
  }

  if (animated) {
    animateMovedItems(target, before);
  }
}

function patchListNode(node, item) {
  if (item.type === "task") {
    patchTaskItem(node, item.entry, item.options);
    return;
  }
  if (item.type === "action") {
    patchActionItem(node, item.entry, item.state);
    return;
  }
  if (item.type === "annotation") {
    patchAnnotationItem(node, item.entry);
    return;
  }
  if (item.type === "waiting") {
    patchWaitingItem(node, item.entry, item.index);
    return;
  }
  if (item.type === "hidden") {
    node.className = "hidden-summary";
    node.textContent = `${item.count} undotted task${
      item.count === 1 ? "" : "s"
    } hidden`;
    return;
  }
  node.className = "empty-state";
  node.textContent = item.message;
}

function measureListItems(target) {
  const items = new Map();
  for (const node of Array.from(target.children)) {
    if (node.dataset.renderKey) {
      items.set(node.dataset.renderKey, node.getBoundingClientRect());
    }
  }
  return items;
}

function animateMovedItems(target, before) {
  if (reducedMotion.matches) {
    return;
  }

  for (const node of Array.from(target.children)) {
    const previous = before.get(node.dataset.renderKey);
    if (!previous) {
      continue;
    }

    const next = node.getBoundingClientRect();
    const deltaX = previous.left - next.left;
    const deltaY = previous.top - next.top;
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
      continue;
    }

    node.animate(
      [
        { transform: `translate(${deltaX}px, ${deltaY}px)` },
        { transform: "translate(0, 0)" },
      ],
      {
        duration: 220,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    );
  }
}

function removeListNode(node, previous, animated) {
  if (!animated || reducedMotion.matches || !previous) {
    node.remove();
    return;
  }

  const layer = document.createElement("ul");
  const clone = node.cloneNode(true);
  layer.className = "tasks removal-layer";
  if (node.parentElement?.classList.contains("tomorrow-tasks")) {
    layer.classList.add("tomorrow-tasks");
  }
  clone.classList.add("removing");
  clone.removeAttribute("data-render-key");
  clone.removeAttribute("data-render-type");
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    margin: "0",
    padding: "0",
    pointerEvents: "none",
    zIndex: "20",
  });
  Object.assign(clone.style, {
    position: "fixed",
    left: `${previous.left}px`,
    top: `${previous.top}px`,
    width: `${previous.width}px`,
    height: `${previous.height}px`,
    margin: "0",
    pointerEvents: "none",
  });
  layer.append(clone);
  document.body.append(layer);
  node.remove();
  clone
    .animate(
      [
        { opacity: 1, transform: "scale(1)" },
        { opacity: 0, transform: "scale(0.96) translateY(-6px)" },
      ],
      {
        duration: 180,
        easing: "ease-out",
      },
    )
    .finished.then(
      () => layer.remove(),
      () => layer.remove(),
    );
}

function patchTaskItem(item, entry, options = {}) {
  const currentDay = todayKey();
  const nextDay = tomorrowKey();
  const description = entry.description;
  const dueDay = entry.dueDay || dueDateKey(entry);
  const inSession = Boolean(options.sessionTask);
  const marked = inSession && isMarked(entry.key);
  const crossed = inSession && isCrossed(entry.key);
  const completed = inSession && session.completedKeys.includes(entry.key);
  const started = inSession && session.startedKeys.includes(entry.key);
  const cleared = inSession && session.clearedKeys.includes(entry.key);
  const current = currentRunEntry();
  const isCurrent = inSession && current?.key === entry.key;
  const candidate = scanCandidateEntry();
  const isCandidate = inSession && candidate?.key === entry.key;
  const sessionActive = scanActive() || runActive();
  const canQuickComplete =
    entry.id !== null &&
    (!inSession || isCurrent || !sessionActive);
  const spriteClassName = spriteClass(
    entry,
    dueDay,
    currentDay,
    nextDay,
    description,
  );
  const contentKey = JSON.stringify([
    description,
    entry.project,
    entry.uri,
    entry.annotations,
    spriteClassName,
    canQuickComplete,
    openAnnotationKeys.has(entry.taskKey),
    entry.backlog,
  ]);

  item.className = "task-item";
  item.style.setProperty("--task-index", String(options.index || 0));
  item.classList.toggle("overdue", dueDay !== "" && dueDay < currentDay);
  item.classList.toggle("due-today", dueDay === currentDay);
  item.classList.toggle("preview-task", Boolean(options.preview));
  item.classList.toggle("extra-task", entry.extra || Boolean(options.extra));
  item.classList.toggle("backlog-task", entry.backlog || Boolean(options.backlog));
  item.classList.toggle("tomorrow-task", Boolean(options.tomorrow));
  item.classList.toggle("session-task", Boolean(options.sessionTask));
  item.classList.toggle("marked-task", marked);
  item.classList.toggle("scan-candidate", isCandidate);
  item.classList.toggle("current-task", isCurrent);
  item.classList.toggle("crossed-task", crossed);
  item.classList.toggle("done-task", completed);
  item.classList.toggle("started-task", started);
  item.classList.toggle("cleared-task", cleared);
  item.classList.toggle("just-touched", lastTouchedKey === entry.key);
  item.classList.toggle("can-complete", canQuickComplete);
  item.classList.toggle("completing", completingTaskKey === entry.key);
  item.dataset.taskKey = entry.key;
  if (item.dataset.contentKey === contentKey) {
    const button = item.querySelector(".complete-button");
    if (button) {
      button.disabled = completingTaskKey === entry.key;
    }
    return;
  }

  const dot = document.createElement("span");
  const sprite = document.createElement("span");
  const content = document.createElement("span");
  const title = document.createElement("span");
  item.dataset.contentKey = contentKey;
  item.textContent = "";

  dot.className = "task-dot";
  dot.setAttribute("aria-hidden", "true");
  sprite.className = spriteClassName;
  sprite.classList.add("annotation-character");
  sprite.classList.toggle("has-annotations", entry.annotations.length > 0);
  sprite.tabIndex = 0;
  sprite.setAttribute("role", "button");
  sprite.setAttribute(
    "aria-label",
    `${openAnnotationKeys.has(entry.taskKey) ? "Hide" : "Show"} annotations (${entry.annotations.length})`,
  );
  sprite.setAttribute(
    "aria-expanded",
    String(openAnnotationKeys.has(entry.taskKey)),
  );
  sprite.addEventListener("click", () => toggleAnnotationDrawer(entry.taskKey));
  sprite.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    toggleAnnotationDrawer(entry.taskKey);
  });
  sprite.append(document.createElement("i"), document.createElement("b"));
  sprite.append(document.createElement("em"));
  if (entry.annotations.length > 0) {
    const badge = document.createElement("span");
    badge.className = "annotation-badge";
    badge.setAttribute("aria-hidden", "true");
    sprite.append(badge);
  }

  content.className = "task-content";
  title.className = "task-title";
  if (entry.project !== null && entry.project !== "Inbox") {
    const project = document.createElement("span");
    project.className = "task-project-prefix";
    project.textContent = `${entry.project}:`;
    title.append(project, ` ${description}`);
  } else {
    title.textContent = description;
  }
  content.append(title);

  if (entry.uri !== "") {
    const link = document.createElement("a");
    link.className = "task-uri";
    link.href = entry.uri;
    link.textContent = entry.uri;
    link.title = entry.uri;
    link.target = "_blank";
    link.rel = "noreferrer";
    content.append(link);
  }
  item.append(dot, sprite, content);
  if (canQuickComplete) {
    item.append(completeButton(entry, completingTaskKey === entry.key));
  }
}

function patchWaitingItem(item, entry, index) {
  const description = entry.description;
  const waitDay = waitDateKey(entry);
  const dueDay = entry.dueDay || dueDateKey(entry);
  const contentKey = JSON.stringify([
    description,
    entry.project,
    entry.wait,
    entry.due,
  ]);

  item.className = "task-item waiting-task";
  item.style.setProperty("--task-index", String(index || 0));
  item.dataset.taskKey = entry.key;
  if (item.dataset.contentKey === contentKey) {
    return;
  }

  const dot = document.createElement("span");
  const content = document.createElement("span");
  const title = document.createElement("span");
  const meta = document.createElement("span");
  const controls = document.createElement("span");
  const release = document.createElement("button");

  item.dataset.contentKey = contentKey;
  item.textContent = "";

  dot.className = "task-dot";
  dot.setAttribute("aria-hidden", "true");

  content.className = "task-content";
  title.className = "task-title";
  if (entry.project !== null && entry.project !== "Inbox") {
    const project = document.createElement("span");
    project.className = "task-project-prefix";
    project.textContent = `${entry.project}:`;
    title.append(project, ` ${description}`);
  } else {
    title.textContent = description;
  }

  meta.className = "task-meta";
  meta.textContent = `Wait ${dateLabel(waitDay)} · Due ${dateLabel(dueDay)}`;
  content.append(title, meta);

  controls.className = "waiting-controls";
  release.type = "button";
  release.className = "secondary-action";
  release.textContent = "Release";
  release.disabled = entry.id === null;
  release.addEventListener("click", function () {
    clearTaskWait(entry);
  });

  controls.append(release);
  item.append(dot, content, controls);
}

function dateLabel(day) {
  if (day === "") {
    return "none";
  }
  return shortDateLabel(day);
}

function patchAnnotationItem(annotationItem, entry) {
  const panel = document.createElement("div");
  const form = document.createElement("form");
  const input = document.createElement("input");
  const add = document.createElement("button");
  const list = document.createElement("ul");

  annotationItem.className = "annotation-row";
  annotationItem.textContent = "";
  panel.className = "annotation-panel";
  form.className = "annotation-form";
  form.addEventListener("submit", (event) => addAnnotation(event, entry));

  input.name = "annotation";
  input.autocomplete = "off";
  input.placeholder = "Add annotation";

  add.type = "submit";
  add.textContent = "Add";
  add.disabled = entry.id === null;

  form.append(input, add);
  list.className = "annotation-list";
  for (const annotation of entry.annotations) {
    const item = document.createElement("li");
    item.textContent = annotation.description;
    list.append(item);
  }

  panel.append(form, list);
  annotationItem.append(panel);
}

function toggleAnnotationDrawer(taskKey) {
  if (openAnnotationKeys.has(taskKey)) {
    openAnnotationKeys.delete(taskKey);
  } else {
    openAnnotationKeys.add(taskKey);
  }
  renderApp({ animated: true });
  shakeAnnotationCharacter(taskKey);
}

function shakeAnnotationCharacter(taskKey) {
  if (reducedMotion.matches) {
    return;
  }

  requestAnimationFrame(() => {
    const item = taskNodeByKey(taskKey);
    const character = item?.querySelector(".annotation-character");
    if (!character) {
      return;
    }
    character.classList.remove("character-shaking");
    void character.offsetWidth;
    character.classList.add("character-shaking");
    character.addEventListener(
      "animationend",
      () => character.classList.remove("character-shaking"),
      { once: true },
    );
  });
}

function patchActionItem(actionItem, entry, state) {
  const actions = document.createElement("div");
  actionItem.className = "task-action-row";
  actionItem.textContent = "";
  actions.className = "task-actions";
  if (state.isCandidate) {
    const question = document.createElement("p");
    const marked = currentMarkedEntry();
    question.className = "choice-question";
    question.textContent = marked
      ? `Would you rather work on this than "${marked.description}"?`
      : "Would you rather work on this next?";
    actions.append(question);
    actions.append(
      createAction("Yes", "primary-action", () => advanceScan(true)),
      createAction("No", "secondary-action", () => advanceScan(false)),
    );
  }
  if (state.isCurrent) {
    const hasEvidence = hasProgressEvidence(entry.key);
    const splitButtonLabel = openSplitKeys.has(entry.key)
      ? "Hide split"
      : "Split task";
    const moreButtonLabel = openMoreKeys.has(entry.key) ? "Less" : "More";
    actions.append(
      createAction(splitButtonLabel, "secondary-action", () =>
        toggleSplitForm(entry.key),
      ),
      createAction(
        "Made progress",
        "secondary-action",
        () => startAgain(entry.key),
        !hasEvidence,
      ),
      createAction(moreButtonLabel, "secondary-action", () =>
        toggleMoreActions(entry.key),
      ),
    );
    if (entry.backlog) {
      actions.append(
        createAction("Release", "secondary-action", () => releaseTask(entry)),
      );
    }
    if (!hasEvidence) {
      const hint = document.createElement("p");
      hint.className = "progress-hint";
      hint.textContent = "Add a note or split this task first";
      actions.append(hint);
    }
    if (openMoreKeys.has(entry.key)) {
      actions.append(
        createAction("Delete task", "danger-action", function () {
          openDeleteForm(entry.key);
        }),
      );
    }
    if (openSplitKeys.has(entry.key)) {
      actions.append(splitForm(entry));
    }
    if (openDeleteKeys.has(entry.key)) {
      actions.append(deleteForm(entry));
    }
  }
  actionItem.append(actions);
}

function toggleSplitForm(key) {
  if (openSplitKeys.has(key)) {
    openSplitKeys.delete(key);
  } else {
    openSplitKeys.add(key);
    openDeleteKeys.delete(key);
  }
  renderApp({ animated: true, focusKey: key });
}

function toggleMoreActions(key) {
  if (openMoreKeys.has(key)) {
    openMoreKeys.delete(key);
    openDeleteKeys.delete(key);
  } else {
    openMoreKeys.add(key);
  }
  renderApp({ animated: true, focusKey: key });
}

function openDeleteForm(key) {
  openDeleteKeys.add(key);
  openSplitKeys.delete(key);
  renderApp({ animated: true, focusKey: key });
}

function splitForm(entry) {
  const form = document.createElement("form");
  const fields = document.createElement("div");
  const controls = document.createElement("div");
  const split = document.createElement("button");

  form.className = "split-form";
  form.addEventListener("submit", (event) => splitTask(event, entry));
  fields.className = "split-fields";
  controls.className = "split-controls";

  split.type = "submit";
  split.textContent = "split";

  appendSplitInput(fields);
  controls.append(split);
  form.append(fields, controls);
  return form;
}

function appendSplitInput(fields) {
  const previousRow = fields.querySelector(".split-row.has-add");
  const previousAdd = previousRow?.querySelector(".split-add");
  if (previousRow && previousAdd) {
    previousAdd.remove();
    previousRow.classList.remove("has-add");
  }

  const row = document.createElement("div");
  const input = document.createElement("input");
  const add = document.createElement("button");

  row.className = "split-row has-add";

  input.name = "description";
  input.maxLength = 500;
  input.autocomplete = "off";
  input.placeholder = "Smaller task";

  add.type = "button";
  add.className = "split-add";
  add.textContent = "+";
  add.setAttribute("aria-label", "Add another split task");
  add.addEventListener("click", () => appendSplitInput(fields));

  row.append(input, add);
  fields.append(row);
  input.focus();
}

function deleteForm(entry) {
  const form = document.createElement("form");
  const question = document.createElement("p");
  const reasonLabel = document.createElement("label");
  const reason = document.createElement("input");
  const confirmationLabel = document.createElement("label");
  const confirmation = document.createElement("input");
  const controls = document.createElement("div");
  const cancel = document.createElement("button");
  const submit = document.createElement("button");

  form.className = "delete-form";
  form.addEventListener("submit", (event) => deleteTask(event, entry));
  question.className = "delete-question";
  question.textContent = "Delete task?";

  reasonLabel.textContent = "Reason required";
  reason.name = "reason";
  reason.maxLength = 500;
  reason.autocomplete = "off";

  confirmationLabel.textContent = "Confirm by typing: delete";
  confirmation.name = "confirmation";
  confirmation.autocomplete = "off";

  controls.className = "delete-controls";
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    openDeleteKeys.delete(entry.key);
    renderApp({ animated: true, focusKey: entry.key });
  });

  submit.type = "submit";
  submit.className = "danger-action";
  submit.textContent = "Delete task";
  submit.disabled = true;

  function refreshSubmitState() {
    submit.disabled =
      reason.value.trim() === "" || confirmation.value !== "delete";
  }

  reason.addEventListener("input", refreshSubmitState);
  confirmation.addEventListener("input", refreshSubmitState);

  reasonLabel.append(reason);
  confirmationLabel.append(confirmation);
  controls.append(cancel, submit);
  form.append(question, reasonLabel, confirmationLabel, controls);
  requestAnimationFrame(() => reason.focus());
  return form;
}

function inputDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateAfterDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function refreshAddWaitMin() {
  waitInput.min = inputDateValue(dateAfterDays(0));
}

function isMarked(key) {
  if (session.scanMarkedKeys.includes(key)) {
    return true;
  }
  return session.runKeys.includes(key);
}

function completeButton(entry, disabled = false) {
  const button = document.createElement("button");
  button.className = "complete-button";
  button.type = "button";
  button.textContent = "✓";
  button.disabled = disabled;
  button.setAttribute("aria-label", `Complete task: ${entry.description}`);
  return button;
}

async function parseResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `request failed with ${response.status}`);
  }
  return body;
}

async function completeTaskByKey(key) {
  const pendingEntry = latestTasks
    .map((task) => entryFromTask(task))
    .find((task) => task.key === key);
  const entry = entryByKey(key) || pendingEntry;
  const id = entry?.id;
  if (!Number.isInteger(id) || completingTaskKey !== null) {
    return;
  }

  const previousTasks = latestTasks;
  const previousSession = normalizeSession(session);
  const sessionEntry = entryByKey(key);
  let nextFocusKey = activeRunKeys().find((runKey) => runKey !== key) || "";
  completingTaskKey = key;
  markCompletingCard(key);
  await nextFrame();
  await wait(90);
  latestTasks = latestTasks.filter((task) => taskKey(task) !== entry.taskKey);
  saveTaskCache(latestTasks);

  let completedSession = false;
  if (sessionEntry) {
    const runFinished = crossOff(key, "completedKeys");
    if (reconcileSessions(latestTasks)) {
      saveSession();
    }
    if (runFinished) {
      const entries = orderedOpenEntries();
      if (entries.length === 0) {
        completedSession = true;
        clearActiveSession();
      } else if (entries.length === 1) {
        session.runKeys = [entries[0].key];
        session.scanMarkedKeys = [];
        session.scanCursorKey = "";
        nextFocusKey = entries[0].key;
        saveSession();
      } else {
        for (const entry of entries) {
          entry.waiting = false;
        }
        session.scanMarkedKeys = [entries[0].key];
        session.scanCursorKey = entries[1].key;
        session.runKeys = [];
        nextFocusKey = session.scanCursorKey;
        saveSession();
      }
    }
  } else if (hasSession() && reconcileSessions(latestTasks)) {
    saveSession();
  }

  showStatus("Completing...");
  renderApp({ animated: true, focusKey: nextFocusKey });
  try {
    const response = await fetch(`/api/tasks/${id}/complete`, {
      method: "POST",
    });
    latestTasks = normalizeTasks(await parseResponse(response));
    saveTaskCache(latestTasks);
    if (hasSession()) {
      if (reconcileSessions(latestTasks)) {
        saveSession();
      }
    }
    completingTaskKey = null;
    showStatus(completedSession ? "FPV session complete" : "Completed");
    renderApp({ animated: true, focusKey: activeRunKeys()[0] || nextFocusKey });
  } catch (error) {
    latestTasks = previousTasks;
    sessions[previousSession.mode] = previousSession;
    syncActiveSession();
    saveTaskCache(latestTasks);
    if (hasSession()) {
      saveSession();
    }
    completingTaskKey = null;
    showStatus(error.message);
    renderApp({ animated: true, focusKey: key });
  }
}

async function addAnnotation(event, entry) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = form.elements.annotation;
  const annotation = input.value.trim();
  if (annotation === "" || entry.id === null) {
    return;
  }

  const button = form.querySelector("button");
  let annotated = false;
  button.disabled = true;
  showStatus("Annotating...");
  try {
    const response = await fetch(`/api/tasks/${entry.id}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ annotation }),
    });
    latestTasks = normalizeTasks(await parseResponse(response));
    saveTaskCache(latestTasks);
    reconcileSessions(latestTasks);
    markProgressEvidence(entry.key);
    saveSession();
    input.value = "";
    lastTouchedKey = entry.key;
    openAnnotationKeys.add(entry.taskKey);
    annotated = true;
    showStatus("Annotated");
    renderApp({ animated: true, focusKey: entry.key });
  } catch (error) {
    showStatus(error.message);
  } finally {
    button.disabled = false;
    if (!annotated) {
      input.focus();
    }
  }
}

async function splitTask(event, entry) {
  event.preventDefault();
  const form = event.currentTarget;
  const descriptions = Array.from(form.querySelectorAll(".split-fields input"))
    .map((input) => input.value.trim())
    .filter((description) => description !== "");
  if (descriptions.length === 0) {
    showStatus("Describe at least one smaller task first");
    return;
  }
  if (entry.id === null) {
    return;
  }

  for (const control of form.querySelectorAll("input, button")) {
    control.disabled = true;
  }
  showStatus("Splitting task...");
  try {
    const response = await fetch(`/api/tasks/${entry.id}/split`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ descriptions }),
    });
    latestTasks = normalizeTasks(await parseResponse(response));
    saveTaskCache(latestTasks);
    let completedSession = false;
    let nextFocusKey = "";
    if (hasSession()) {
      reconcileSessions(latestTasks);
      if (runActive() || scanActive()) {
        nextFocusKey = activeRunKeys()[0] || session.scanCursorKey;
        saveSession();
      } else {
        const entries = orderedOpenEntries();
        if (entries.length === 0) {
          completedSession = true;
          clearActiveSession();
        } else if (entries.length === 1) {
          session.runKeys = [entries[0].key];
          session.scanMarkedKeys = [];
          session.scanCursorKey = "";
          nextFocusKey = entries[0].key;
          saveSession();
        } else {
          for (const entry of entries) {
            entry.waiting = false;
          }
          session.scanMarkedKeys = [entries[0].key];
          session.scanCursorKey = entries[1].key;
          session.runKeys = [];
          nextFocusKey = session.scanCursorKey;
          saveSession();
        }
      }
    }
    openSplitKeys.delete(entry.key);
    showStatus(completedSession ? "FPV session complete" : "Task split");
    renderApp({ animated: true, focusKey: nextFocusKey });
  } catch (error) {
    showStatus(error.message);
    for (const control of form.querySelectorAll("input, button")) {
      control.disabled = false;
    }
    form.querySelector("input")?.focus();
  }
}

async function deleteTask(event, entry) {
  event.preventDefault();
  const form = event.currentTarget;
  const reason = form.elements.reason.value.trim();
  const confirmation = form.elements.confirmation.value;
  if (reason === "") {
    showStatus("Reason required");
    return;
  }
  if (confirmation !== "delete") {
    showStatus("Type delete to confirm");
    return;
  }
  if (entry.id === null) {
    return;
  }

  for (const control of form.querySelectorAll("input, button")) {
    control.disabled = true;
  }
  showStatus("Deleting task...");
  try {
    const response = await fetch(`/api/tasks/${entry.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, confirmation }),
    });
    latestTasks = normalizeTasks(await parseResponse(response));
    saveTaskCache(latestTasks);

    let completedSession = false;
    let nextFocusKey = "";
    if (hasSession()) {
      const runFinished = crossOff(entry.key, "clearedKeys");
      if (reconcileSessions(latestTasks)) {
        saveSession();
      }
      nextFocusKey = activeRunKeys()[0] || session.scanCursorKey;
      if (runFinished) {
        const entries = orderedOpenEntries();
        if (entries.length === 0) {
          completedSession = true;
          clearActiveSession();
        } else if (entries.length === 1) {
          session.runKeys = [entries[0].key];
          session.scanMarkedKeys = [];
          session.scanCursorKey = "";
          nextFocusKey = entries[0].key;
          saveSession();
        } else {
          for (const entry of entries) {
            entry.waiting = false;
          }
          session.scanMarkedKeys = [entries[0].key];
          session.scanCursorKey = entries[1].key;
          session.runKeys = [];
          nextFocusKey = session.scanCursorKey;
          saveSession();
        }
      }
    }

    openMoreKeys.delete(entry.key);
    openDeleteKeys.delete(entry.key);
    showStatus(completedSession ? "FPV session complete" : "Task deleted");
    renderApp({ animated: true, focusKey: nextFocusKey });
  } catch (error) {
    showStatus(error.message);
    for (const control of form.querySelectorAll("input, button")) {
      control.disabled = false;
    }
    form.elements.reason.focus();
  }
}

async function declareBacklog() {
  const tasks = backlogCandidateTasks();
  if (tasks.length === 0) {
    showStatus("No tasks to move");
    renderApp({ animated: true });
    return;
  }

  const confirmed = window.confirm(
    `Move ${tasks.length} overdue and due-today task${
      tasks.length === 1 ? "" : "s"
    } into Backlog?`,
  );
  if (!confirmed) {
    return;
  }

  closeSettings();
  declareBacklogButton.disabled = true;
  showStatus("Declaring backlog...");
  try {
    const response = await fetch("/api/backlog/declare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: tasks.map(taskId) }),
    });
    latestTasks = normalizeTasks(await parseResponse(response));
    saveTaskCache(latestTasks);
    reconcileSessions(latestTasks);
    saveSession();
    setActiveMode("backlog");
    showStatus("Backlog declared");
  } catch (error) {
    showStatus(error.message);
    renderApp({ animated: true });
  } finally {
    declareBacklogButton.disabled = false;
  }
}

async function releaseTask(entry) {
  if (entry.id === null) {
    return;
  }

  showStatus("Releasing task...");
  try {
    const response = await fetch(`/api/tasks/${entry.id}/release`, {
      method: "POST",
    });
    latestTasks = normalizeTasks(await parseResponse(response));
    saveTaskCache(latestTasks);
    if (hasSession()) {
      crossOff(entry.key, "clearedKeys");
      reconcileSessions(latestTasks);
      saveSession();
    }
    showStatus("Released for tomorrow");
    renderApp({ animated: true, focusKey: activeRunKeys()[0] || "" });
  } catch (error) {
    showStatus(error.message);
    renderApp({ animated: true, focusKey: entry.key });
  }
}

async function refreshWaitingTasks() {
  const response = await fetch("/api/waiting", { cache: "no-store" });
  latestWaitingTasks = normalizeTasks(await parseResponse(response));
}

async function clearTaskWait(entry) {
  if (entry.id === null) {
    return;
  }

  showStatus("Releasing waiting task...");
  try {
    const response = await fetch(`/api/tasks/${entry.id}/wait`, {
      method: "DELETE",
    });
    latestTasks = normalizeTasks(await parseResponse(response));
    saveTaskCache(latestTasks);
    await refreshWaitingTasks();
    showStatus("Released");
    renderApp({ animated: true, focusKey: entry.key });
  } catch (error) {
    showStatus(error.message);
    renderApp({ animated: true, focusKey: entry.key });
  }
}

async function loadTasks({ animated = true } = {}) {
  refresh.disabled = true;
  showStatus("Loading tasks...");
  try {
    const responses = await Promise.all([
      fetch("/api/tasks", { cache: "no-store" }),
      fetch("/api/waiting", { cache: "no-store" }),
    ]);
    latestTasks = normalizeTasks(await parseResponse(responses[0]));
    latestWaitingTasks = normalizeTasks(await parseResponse(responses[1]));
    saveTaskCache(latestTasks);
    if (reconcileSessions(latestTasks)) {
      saveSession();
    }
    showStatus("");
    renderApp({ animated, focusKey: session.scanCursorKey });
  } catch (error) {
    showStatus(error.message);
    renderApp();
  } finally {
    refresh.disabled = false;
  }
}

async function addTask(event) {
  event.preventDefault();
  const description = input.value.trim();
  const uri = uriInput.value.trim();
  const project = projectInput.value.trim();
  const wait = waitInput.value.trim();
  if (!description) {
    showStatus("Describe the task first");
    return;
  }

  submit.disabled = true;
  showStatus("Adding...");
  const body = { description };
  const submittedForToday = addingToday;
  if (uri !== "") {
    body.uri = uri;
  }
  if (project !== "") {
    body.project = project;
  }
  if (wait !== "") {
    body.wait = wait;
  }
  if (submittedForToday) {
    body.due = "today";
  }
  try {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    latestTasks = normalizeTasks(await parseResponse(response));
    saveTaskCache(latestTasks);
    if (wait !== "") {
      await refreshWaitingTasks();
    }
    if (reconcileSessions(latestTasks)) {
      saveSession();
    }
    input.value = "";
    uriInput.value = "";
    projectInput.value = "";
    waitInput.value = "";
    hideExtraFields();
    addingToday = false;
    refreshAddMode();
    if (wait !== "") {
      showStatus("Added waiting task");
    } else {
      showStatus(submittedForToday ? "Added for today" : "Added for tomorrow");
    }
    renderApp({ animated: true });
  } catch (error) {
    showStatus(error.message);
  } finally {
    submit.disabled = false;
    input.focus();
  }
}

function refreshAddMode() {
  formLabel.textContent = addingToday
    ? "Capture extra for today"
    : "Capture for tomorrow";
  extraToggle.classList.toggle("active", addingToday);
  extraToggle.setAttribute("aria-pressed", String(addingToday));
}

function toggleTodayMode() {
  addingToday = !addingToday;
  refreshAddMode();
  input.focus();
}

function showExtraFields() {
  extraFields.hidden = false;
  extraFieldsToggle.classList.add("active");
  extraFieldsToggle.setAttribute("aria-expanded", "true");
  uriInput.focus();
}

function hideExtraFields() {
  extraFields.hidden = true;
  extraFieldsToggle.classList.remove("active");
  extraFieldsToggle.setAttribute("aria-expanded", "false");
}

function toggleExtraFields() {
  if (extraFields.hidden) {
    showExtraFields();
    return;
  }

  if (
    uriInput.value.trim() === "" &&
    projectInput.value.trim() === "" &&
    waitInput.value.trim() === ""
  ) {
    hideExtraFields();
    input.focus();
    return;
  }

  uriInput.focus();
}

function openSettings() {
  settingsMenu.hidden = false;
  settingsToggle.setAttribute("aria-expanded", "true");
}

function closeSettings() {
  settingsMenu.hidden = true;
  settingsToggle.setAttribute("aria-expanded", "false");
}

function toggleSettings() {
  if (settingsMenu.hidden) {
    openSettings();
    return;
  }
  closeSettings();
}

function handleSettingsChange(event) {
  if (event.target.name !== "colorscheme") {
    return;
  }
  saveColorscheme(event.target.value);
}

function handleProjectFilterChange() {
  activeProject = projectFilter.value;
  saveProjectFilter();
  renderApp({ animated: true });
}

async function resetCache() {
  latestTasks = [];
  latestWaitingTasks = [];
  sessions = {
    today: defaultSession("today"),
    backlog: defaultSession("backlog"),
  };
  activeMode = "today";
  activeProject = "";
  syncActiveSession();
  lastTouchedKey = "";
  clearAppStorage();
  await clearBrowserCaches();
  await clearWorkflowSession();
  closeSettings();
  renderApp({ animated: true });
  await loadTasks();
}

function handleDocumentClick(event) {
  if (settingsMenu.hidden || event.target.closest(".settings")) {
    return;
  }
  closeSettings();
}

function handleDocumentKeydown(event) {
  if (event.key === "Escape") {
    closeSettings();
  }
}

function handleTaskClick(event) {
  const complete = event.target.closest(".complete-button");
  if (!complete || coarsePointer.matches) {
    return;
  }

  const item = complete.closest(".tasks li.can-complete");
  if (!item) {
    return;
  }
  completeTaskByKey(item.dataset.taskKey);
}

function handleTaskPointerdown(event) {
  const item = event.target.closest(".tasks li.can-complete");
  if (
    !item ||
    event.target.closest(".complete-button") ||
    event.target.closest(".annotation-character") ||
    event.target.closest("button") ||
    event.target.closest("a") ||
    !coarsePointer.matches ||
    event.pointerType === "mouse"
  ) {
    return;
  }

  const startX = event.clientX;
  const startY = event.clientY;
  let canceled = false;
  let timer = null;

  function cancelHold() {
    canceled = true;
    clearTimeout(timer);
    item.classList.remove("holding");
    cleanup();
  }

  function handlePointerMove(moveEvent) {
    const movedX = Math.abs(moveEvent.clientX - startX);
    const movedY = Math.abs(moveEvent.clientY - startY);
    if (movedX > 12 || movedY > 12) {
      cancelHold();
    }
  }

  function cleanup() {
    if (item.hasPointerCapture(event.pointerId)) {
      item.releasePointerCapture(event.pointerId);
    }
    item.removeEventListener("pointermove", handlePointerMove);
    item.removeEventListener("pointerup", cancelHold);
    item.removeEventListener("pointercancel", cancelHold);
    item.removeEventListener("lostpointercapture", cancelHold);
  }

  item.setPointerCapture(event.pointerId);
  item.classList.add("holding");
  item.addEventListener("pointermove", handlePointerMove);
  item.addEventListener("pointerup", cancelHold, { once: true });
  item.addEventListener("pointercancel", cancelHold, { once: true });
  item.addEventListener("lostpointercapture", cancelHold, { once: true });

  timer = setTimeout(() => {
    cleanup();
    item.classList.remove("holding");
    if (!canceled) {
      completeTaskByKey(item.dataset.taskKey);
    }
  }, completeHoldMs);
}

form.addEventListener("submit", addTask);
extraFieldsToggle.addEventListener("click", toggleExtraFields);
extraToggle.addEventListener("click", toggleTodayMode);
refresh.addEventListener("click", loadTasks);
sessionButton.addEventListener("click", handleSessionButton);
luckyButton.addEventListener("click", startLuckySession);
declareBacklogButton.addEventListener("click", declareBacklog);
modeToday.addEventListener("click", () => setActiveMode("today"));
modeBacklog.addEventListener("click", () => setActiveMode("backlog"));
modeFuture.addEventListener("click", () => setActiveMode("future"));
projectFilter.addEventListener("change", handleProjectFilterChange);
resetCacheButton.addEventListener("click", resetCache);
settingsToggle.addEventListener("click", toggleSettings);
settingsMenu.addEventListener("change", handleSettingsChange);
document.addEventListener("click", handleDocumentClick);
document.addEventListener("keydown", handleDocumentKeydown);
list.addEventListener("click", handleTaskClick);
list.addEventListener("pointerdown", handleTaskPointerdown);
backlogList.addEventListener("click", handleTaskClick);
backlogList.addEventListener("pointerdown", handleTaskPointerdown);
tomorrowList.addEventListener("click", handleTaskClick);
tomorrowList.addEventListener("pointerdown", handleTaskPointerdown);

async function initApp() {
  applyColorscheme(storedColorscheme());
  refreshAddWaitMin();
  refreshAddMode();
  renderApp();
  await loadWorkflowSession({ animated: false });
  await loadTasks({ animated: false });
}

void initApp();

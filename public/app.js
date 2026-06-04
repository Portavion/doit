const form = document.querySelector("#task-form");
const input = document.querySelector("#description");
const uriToggle = document.querySelector("#uri-toggle");
const uriInput = document.querySelector("#uri-field");
const submit = document.querySelector("#submit");
const refresh = document.querySelector("#refresh");
const sessionButton = document.querySelector("#session");
const statusText = document.querySelector("#status");
const listCaption = document.querySelector("#list-caption");
const tomorrowStatus = document.querySelector("#tomorrow-status");
const list = document.querySelector("#tasks");
const tomorrowList = document.querySelector("#tomorrow-tasks");
const coarsePointer = window.matchMedia("(pointer: coarse)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const legacySessionStorageKey = "doit.fpvSession.v2";
const taskCacheStorageKey = "doit.taskCache.v1";
const completeHoldMs = 850;
let completingTaskKey = null;
let lastTouchedKey = "";
let latestTasks = loadTaskCache();
let session = defaultSession();

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

function defaultSession() {
  return {
    date: storageDateKey(),
    startedAt: "",
    entries: [],
    completedKeys: [],
    startedKeys: [],
    clearedKeys: [],
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
    dueDay: typeof entry.dueDay === "string" ? entry.dueDay : "",
    uri: typeof entry.uri === "string" ? entry.uri : "",
    fingerprint:
      typeof entry.fingerprint === "string" ? entry.fingerprint : "",
    readded: Boolean(entry.readded),
    urgent: Boolean(entry.urgent),
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

function normalizeSession(value) {
  if (!value || typeof value !== "object" || value.date !== storageDateKey()) {
    return defaultSession();
  }

  const entries = Array.isArray(value.entries)
    ? value.entries.map(normalizeEntry).filter(Boolean)
    : [];
  return {
    ...defaultSession(),
    ...value,
    entries,
    completedKeys: normalizeKeyList(value.completedKeys),
    startedKeys: normalizeKeyList(value.startedKeys),
    clearedKeys: normalizeKeyList(value.clearedKeys),
    scanMarkedKeys: normalizeKeyList(value.scanMarkedKeys),
    scanCursorKey:
      typeof value.scanCursorKey === "string" ? value.scanCursorKey : "",
    runKeys: normalizeKeyList(value.runKeys),
  };
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
  session = defaultSession();
  lastTouchedKey = "";
  clearLegacySession();
  showStatus(message);
  renderApp({ animated: true });
}

async function loadWorkflowSession() {
  try {
    const response = await fetch("/api/workflow-session");
    const body = await parseResponse(response);
    clearLegacySession();
    session = normalizeSession(body.session);
    if (body.session && !hasSession()) {
      await clearWorkflowSession();
      showStatus("Workflow session reset");
    }
    renderApp({ animated: true, focusKey: session.scanCursorKey });
  } catch {
    resetSessionAfterIssue();
  }
}

async function saveWorkflowSession() {
  if (!hasSession()) {
    await clearWorkflowSession();
    return;
  }

  try {
    const response = await fetch("/api/workflow-session", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session }),
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

function dueDateKey(task) {
  if (typeof task?.due !== "string") {
    return "";
  }

  const match = task.due.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
  );
  if (!match) {
    return task.due.slice(0, 8);
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
    dueDay: dueDateKey(task),
    uri: taskUri(task),
    fingerprint: taskFingerprint(task),
    readded: false,
    urgent: false,
    waiting: false,
  };
}

function readdedEntry(entry) {
  const suffix = `${Date.now()}-${hashText(`${entry.key}-${Math.random()}`)}`;
  return {
    ...entry,
    key: `${entry.taskKey}:again:${suffix}`,
    readded: true,
    urgent: false,
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
  const currentDay = todayKey();
  return tasks.filter((task) => {
    const dueDay = dueDateKey(task);
    return dueDay !== "" && dueDay <= currentDay;
  });
}

function futureWorkTasks(tasks) {
  const currentDay = todayKey();
  return tasks.filter((task) => {
    const dueDay = dueDateKey(task);
    return dueDay === "" || dueDay > currentDay;
  });
}

function hasSession() {
  return session.date === storageDateKey() && session.entries.length > 0;
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
  const entries = openEntries();
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

    const next = entryFromTask(task, entry.key);
    for (const field of [
      "taskKey",
      "id",
      "uuid",
      "description",
      "project",
      "due",
      "dueDay",
      "uri",
      "fingerprint",
    ]) {
      if (entry[field] !== next[field]) {
        entry[field] = next[field];
        changed = true;
      }
    }
  }

  compactSession();
  return changed;
}

function handleSessionButton() {
  if (!hasSession()) {
    startSession();
    return;
  }

  if (scanActive() || runActive()) {
    stopSession();
    return;
  }

  const entries = openEntries();
  if (entries.length > 0) {
    beginPass(entries, "Session started");
    return;
  }

  startSession();
}

function stopSession(message = "Stopped FPV session") {
  session = defaultSession();
  lastTouchedKey = "";
  clearLegacySession();
  void clearWorkflowSession();
  showStatus(message);
  renderApp({ animated: true });
}

function startSession() {
  const entries = todayWorkTasks(latestTasks).map((task) => entryFromTask(task));
  if (entries.length === 0) {
    showStatus("No tasks are ready");
    renderApp({ animated: true });
    return;
  }

  session = {
    ...defaultSession(),
    startedAt: new Date().toISOString(),
    entries,
  };
  beginPass(entries, "Session started");
}

function beginPass(entries, message) {
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
  saveSession();
  showStatus(shouldMark ? "Dotted task" : "Skipped task");
  renderApp({ animated: true, focusKey: nextKey });
}

function finishScan(markedKey = "") {
  const openKeys = new Set(openEntries().map((entry) => entry.key));
  const markedKeys = session.scanMarkedKeys.filter((key) => openKeys.has(key));
  session.runKeys = markedKeys.slice().reverse();
  session.scanMarkedKeys = [];
  session.scanCursorKey = "";
  saveSession();
  const focusKey = activeRunKeys()[0] || markedKey || session.runKeys[0] || "";
  showStatus("Dotted chain ready");
  renderApp({ animated: true, focusKey });
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

function startAgain(key) {
  const entry = entryByKey(key);
  if (!entry || isCrossed(key)) {
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
  renderSessionButton();
  renderTasks();
  renderTomorrowTasks();
  if (animated) {
    scrollToTask(focusKey);
  }
}

function scrollToTask(key) {
  if (key === "") {
    return;
  }

  requestAnimationFrame(() => {
    const item = Array.from(list.querySelectorAll("[data-task-key]")).find(
      (node) => node.dataset.taskKey === key,
    );
    if (!item) {
      return;
    }
    item.scrollIntoView({
      block: "center",
      behavior: reducedMotion.matches ? "auto" : "smooth",
    });
  });
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

function renderSessionButton() {
  const readyCount = todayWorkTasks(latestTasks).length;
  const openCount = hasSession() ? openEntries().length : readyCount;
  const active = scanActive() || runActive();
  sessionButton.classList.toggle("session-start", !active);
  sessionButton.classList.toggle("session-stop", active);
  sessionButton.disabled = openCount === 0 && readyCount === 0 && !active;

  if (active) {
    sessionButton.textContent = "Stop";
    return;
  }
  sessionButton.textContent = "Start";
}

function renderTasks() {
  list.textContent = "";

  if (!hasSession()) {
    renderReadyTasks();
    return;
  }

  compactSession();
  if (scanActive()) {
    listCaption.textContent = "Scanning top to bottom";
    session.entries.forEach((entry, index) => {
      if (isCrossed(entry.key)) {
        return;
      }
      renderTaskItem(list, entry, { index, sessionTask: true });
    });
    return;
  }

  if (session.runKeys.length > 0) {
    renderRunTasks();
    return;
  }

  const entries = openEntries();
  listCaption.textContent =
    entries.length === 0 ? "Session clear" : "Ready for the next pass";
  if (entries.length === 0) {
    renderEmptyItem(list, "No open session tasks");
    return;
  }
  entries.forEach((entry, index) => {
    renderTaskItem(list, entry, { index, sessionTask: true });
  });
}

function renderReadyTasks() {
  const tasks = todayWorkTasks(latestTasks);
  listCaption.textContent = "Ready to start";
  if (tasks.length === 0) {
    renderEmptyItem(list, "Nothing due today");
    return;
  }
  tasks.forEach((task, index) => {
    renderTaskItem(list, entryFromTask(task), { index, preview: true });
  });
}

function renderRunTasks() {
  const runKeySet = new Set(session.runKeys);
  let hiddenCount = 0;
  listCaption.textContent = activeRunKeys().length > 0
    ? "Dotted tasks only"
    : "Dotted chain clear";

  session.entries.forEach((entry, index) => {
    if (isCrossed(entry.key)) {
      return;
    }

    if (runKeySet.has(entry.key)) {
      renderTaskItem(list, entry, { index, sessionTask: true });
      return;
    }

    hiddenCount += 1;
  });

  if (hiddenCount > 0) {
    renderHiddenSummary(hiddenCount);
  }
}

function renderTomorrowTasks() {
  tomorrowList.textContent = "";
  const sessionTaskKeys = new Set(session.entries.map((entry) => entry.taskKey));
  const tasks = futureWorkTasks(latestTasks).filter(
    (task) => !sessionTaskKeys.has(taskKey(task)),
  );
  tomorrowStatus.textContent = `${tasks.length} future`;
  if (tasks.length === 0) {
    renderEmptyItem(tomorrowList, "No future tasks");
    return;
  }
  tasks.forEach((task, index) => {
    renderTaskItem(tomorrowList, entryFromTask(task), {
      tomorrow: true,
      index,
    });
  });
}

function renderEmptyItem(target, message) {
  const item = document.createElement("li");
  item.className = "empty-state";
  item.textContent = message;
  target.append(item);
}

function renderHiddenSummary(count) {
  const item = document.createElement("li");
  item.className = "hidden-summary";
  item.textContent = `${count} undotted task${count === 1 ? "" : "s"} hidden`;
  list.append(item);
}

function renderTaskItem(target, entry, options = {}) {
  const currentDay = todayKey();
  const nextDay = tomorrowKey();
  const description = entry.description;
  const dueDay = entry.dueDay || dueDateKey(entry);
  const item = document.createElement("li");
  const dot = document.createElement("span");
  const sprite = document.createElement("span");
  const content = document.createElement("span");
  const title = document.createElement("span");
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

  item.className = "task-item";
  item.style.setProperty("--task-index", String(options.index || 0));
  item.classList.toggle("overdue", dueDay !== "" && dueDay < currentDay);
  item.classList.toggle("due-today", dueDay === currentDay);
  item.classList.toggle("preview-task", Boolean(options.preview));
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

  dot.className = "task-dot";
  dot.setAttribute("aria-hidden", "true");
  sprite.className = spriteClass(entry, dueDay, currentDay, nextDay, description);
  sprite.append(document.createElement("i"), document.createElement("b"));
  sprite.append(document.createElement("em"));

  content.className = "task-content";
  title.className = "task-title";
  title.textContent = description;
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
    item.append(completeButton(entry));
  }
  target.append(item);
  appendInlineActions(target, entry, { isCandidate, isCurrent });
}

function appendInlineActions(target, entry, state) {
  if (!state.isCandidate && !state.isCurrent) {
    return;
  }

  const actionItem = document.createElement("li");
  const actions = document.createElement("div");
  actionItem.className = "task-action-row";
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
    actions.append(
      createAction("Made progress", "secondary-action", () =>
        startAgain(entry.key),
      ),
    );
  }
  actionItem.append(actions);
  target.append(actionItem);
}

function isMarked(key) {
  if (session.scanMarkedKeys.includes(key)) {
    return true;
  }
  return session.runKeys.includes(key);
}

function completeButton(entry) {
  const button = document.createElement("button");
  button.className = "complete-button";
  button.type = "button";
  button.textContent = "✓";
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

  completingTaskKey = key;
  let sessionStopped = false;
  renderApp({ animated: true, focusKey: key });
  showStatus("Completing...");
  try {
    const response = await fetch(`/api/tasks/${id}/complete`, {
      method: "POST",
    });
    latestTasks = normalizeTasks(await parseResponse(response));
    saveTaskCache(latestTasks);
    if (hasSession()) {
      const runFinished = crossOff(key, "completedKeys");
      reconcileSession(latestTasks);
      saveSession();
      if (runFinished) {
        sessionStopped = true;
        stopSession("FPV session complete");
        return;
      }
    }
    showStatus("Completed");
    renderApp({ animated: true, focusKey: activeRunKeys()[0] || key });
  } catch (error) {
    showStatus(error.message);
  } finally {
    completingTaskKey = null;
    if (!sessionStopped) {
      renderApp({ animated: true, focusKey: activeRunKeys()[0] || "" });
    }
  }
}

async function loadTasks() {
  refresh.disabled = true;
  showStatus("Loading tasks...");
  try {
    const response = await fetch("/api/tasks");
    latestTasks = normalizeTasks(await parseResponse(response));
    saveTaskCache(latestTasks);
    if (reconcileSession(latestTasks)) {
      saveSession();
    }
    showStatus("");
    renderApp({ animated: true, focusKey: session.scanCursorKey });
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
  if (!description) {
    showStatus("Describe the task first");
    return;
  }

  submit.disabled = true;
  showStatus("Adding...");
  const body = { description };
  if (uri !== "") {
    body.uri = uri;
  }
  try {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    latestTasks = normalizeTasks(await parseResponse(response));
    saveTaskCache(latestTasks);
    if (reconcileSession(latestTasks)) {
      saveSession();
    }
    input.value = "";
    uriInput.value = "";
    hideUriField();
    showStatus("Added for tomorrow");
    renderApp({ animated: true });
  } catch (error) {
    showStatus(error.message);
  } finally {
    submit.disabled = false;
    input.focus();
  }
}

function showUriField() {
  uriInput.hidden = false;
  uriToggle.classList.add("active");
  uriToggle.setAttribute("aria-expanded", "true");
  uriInput.focus();
}

function hideUriField() {
  uriInput.hidden = true;
  uriToggle.classList.remove("active");
  uriToggle.setAttribute("aria-expanded", "false");
}

function toggleUriField() {
  if (uriInput.hidden) {
    showUriField();
    return;
  }

  if (uriInput.value.trim() === "") {
    hideUriField();
    input.focus();
    return;
  }

  uriInput.focus();
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
uriToggle.addEventListener("click", toggleUriField);
refresh.addEventListener("click", loadTasks);
sessionButton.addEventListener("click", handleSessionButton);
list.addEventListener("click", handleTaskClick);
list.addEventListener("pointerdown", handleTaskPointerdown);

async function initApp() {
  input.focus();
  renderApp();
  await loadWorkflowSession();
  await loadTasks();
}

void initApp();

const form = document.querySelector("#task-form");
const input = document.querySelector("#description");
const submit = document.querySelector("#submit");
const refresh = document.querySelector("#refresh");
const statusText = document.querySelector("#status");
const list = document.querySelector("#tasks");
const coarsePointer = window.matchMedia("(pointer: coarse)");
const completeHoldMs = 850;
let completingTaskId = null;
const spriteVariants = {
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

function taskId(task) {
  return typeof task?.id === "number" ? task.id : null;
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

function renderTasks(tasks) {
  list.textContent = "";

  if (tasks.length === 0) {
    showStatus("Inbox runway is clear");
    return;
  }

  showStatus(`${tasks.length} task${tasks.length === 1 ? "" : "s"} ready`);
  const currentDay = todayKey();
  const nextDay = tomorrowKey();
  for (const task of tasks) {
    const description =
      typeof task === "string" ? task : task.description || task.line || "";
    const item = document.createElement("li");
    const sprite = document.createElement("span");
    const text = document.createElement("span");
    const complete = document.createElement("button");
    const id = taskId(task);

    const dueDay = dueDateKey(task);
    sprite.className = spriteClass(
      task,
      dueDay,
      currentDay,
      nextDay,
      description,
    );
    sprite.append(document.createElement("i"), document.createElement("b"));
    sprite.append(document.createElement("em"));
    complete.className = "complete-button";
    complete.type = "button";
    complete.textContent = "✓";
    item.classList.toggle("overdue", dueDay !== "" && dueDay < currentDay);
    item.classList.toggle("due-today", dueDay === currentDay);
    item.classList.toggle("can-complete", id !== null);
    item.dataset.taskId = id === null ? "" : id;
    if (id !== null) {
      complete.setAttribute("aria-label", `Complete task: ${description}`);
    } else {
      complete.disabled = true;
    }
    text.textContent = description;
    item.append(sprite, text, complete);
    list.append(item);
  }
}

async function parseResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `request failed with ${response.status}`);
  }
  return body;
}

async function completeTask(item) {
  const id = Number(item.dataset.taskId);
  if (!Number.isInteger(id) || completingTaskId !== null) {
    return;
  }

  completingTaskId = id;
  item.classList.add("completing");
  showStatus("Completing...");
  try {
    const response = await fetch(`/api/tasks/${id}/complete`, {
      method: "POST",
    });
    renderTasks(await parseResponse(response));
  } catch (error) {
    showStatus(error.message);
    item.classList.remove("completing");
  } finally {
    completingTaskId = null;
  }
}

async function loadTasks() {
  refresh.disabled = true;
  showStatus("Loading tasks...");
  try {
    const response = await fetch("/api/tasks");
    renderTasks(await parseResponse(response));
  } catch (error) {
    showStatus(error.message);
  } finally {
    refresh.disabled = false;
  }
}

async function addTask(event) {
  event.preventDefault();
  const description = input.value.trim();
  if (!description) {
    showStatus("Describe the mission first");
    return;
  }

  submit.disabled = true;
  showStatus("Adding...");
  try {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
    input.value = "";
    renderTasks(await parseResponse(response));
  } catch (error) {
    showStatus(error.message);
  } finally {
    submit.disabled = false;
    input.focus();
  }
}

function handleTaskClick(event) {
  const complete = event.target.closest(".complete-button");
  if (!complete || coarsePointer.matches) {
    return;
  }

  const item = complete.closest(".tasks li.can-complete");
  completeTask(item);
}

function handleTaskPointerdown(event) {
  const item = event.target.closest(".tasks li.can-complete");
  if (
    !item ||
    event.target.closest(".complete-button") ||
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
      completeTask(item);
    }
  }, completeHoldMs);
}

form.addEventListener("submit", addTask);
refresh.addEventListener("click", loadTasks);
list.addEventListener("click", handleTaskClick);
list.addEventListener("pointerdown", handleTaskPointerdown);
loadTasks();

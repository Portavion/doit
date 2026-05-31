const form = document.querySelector("#task-form");
const input = document.querySelector("#description");
const submit = document.querySelector("#submit");
const refresh = document.querySelector("#refresh");
const statusText = document.querySelector("#status");
const list = document.querySelector("#tasks");
const coarsePointer = window.matchMedia("(pointer: coarse)");
const completeHoldMs = 850;
let completingTaskId = null;

function showStatus(message) {
  statusText.textContent = message;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

function dueDateKey(task) {
  return typeof task?.due === "string" ? task.due.slice(0, 8) : "";
}

function taskId(task) {
  return typeof task?.id === "number" ? task.id : null;
}

function renderTasks(tasks) {
  list.textContent = "";

  if (tasks.length === 0) {
    showStatus("Inbox runway is clear");
    return;
  }

  showStatus(`${tasks.length} task${tasks.length === 1 ? "" : "s"} ready`);
  const currentDay = todayKey();
  for (const task of tasks) {
    const description =
      typeof task === "string" ? task : task.description || task.line || "";
    const item = document.createElement("li");
    const sprite = document.createElement("span");
    const text = document.createElement("span");
    const complete = document.createElement("button");
    const id = taskId(task);

    sprite.className = "sprite";
    complete.className = "complete-button";
    complete.type = "button";
    complete.textContent = "✓";
    const dueDay = dueDateKey(task);
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

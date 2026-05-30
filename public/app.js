const form = document.querySelector("#task-form");
const input = document.querySelector("#description");
const submit = document.querySelector("#submit");
const refresh = document.querySelector("#refresh");
const statusText = document.querySelector("#status");
const list = document.querySelector("#tasks");

function showStatus(message) {
  statusText.textContent = message;
}

function renderTasks(tasks) {
  list.textContent = "";

  if (tasks.length === 0) {
    showStatus("Inbox runway is clear");
    return;
  }

  showStatus(`${tasks.length} task${tasks.length === 1 ? "" : "s"} ready`);
  for (const task of tasks) {
    const item = document.createElement("li");
    const sprite = document.createElement("span");
    const text = document.createElement("span");

    sprite.className = "sprite";
    text.textContent = task.line;
    item.append(sprite, text);
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

form.addEventListener("submit", addTask);
refresh.addEventListener("click", loadTasks);
loadTasks();

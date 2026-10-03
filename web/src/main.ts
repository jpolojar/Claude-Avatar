import { isLang, type Lang } from "../../shared/protocol";
import { fetchHealth } from "./api";
import { App } from "./app";
import { WebSpeechStt } from "./stt/webspeech";
import { ChatLog } from "./ui/chat-log";
import { strings } from "./ui/strings";

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from index.html`);
  return el as T;
}

const LANG_KEY = "avatar.lang";

function loadLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    return isLang(stored) ? stored : "fi";
  } catch {
    return "fi";
  }
}

function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Storage unavailable (private window): the choice just isn't remembered.
  }
}

const stage = byId("stage");
const statusEl = byId("status");
const interimEl = byId("interim");
const debugEl = byId("debug");
const noticeEl = byId("notice");
const langSelect = byId<HTMLSelectElement>("lang");
const newChatButton = byId<HTMLButtonElement>("new-chat");
const pttButton = byId<HTMLButtonElement>("ptt");
const textForm = byId<HTMLFormElement>("text-form");
const textInput = byId<HTMLInputElement>("text-input");

const showNotice = (text: string | null) => {
  noticeEl.hidden = !text;
  noticeEl.textContent = text ?? "";
};

const app = new App(
  {
    log: new ChatLog(byId("log")),
    setState: (state) => {
      stage.dataset.state = state;
      statusEl.dataset.state = state;
      statusEl.textContent = strings.status[state];
      pttButton.classList.toggle("active", state === "listening");
    },
    setInterim: (text) => {
      interimEl.textContent = text;
    },
    setDebug: (text) => {
      debugEl.textContent = text;
    },
    showNotice,
  },
  loadLang(),
);

langSelect.value = app.lang;
langSelect.addEventListener("change", () => {
  if (isLang(langSelect.value)) {
    app.setLanguage(langSelect.value);
    saveLang(langSelect.value);
  }
  langSelect.blur();
});

newChatButton.addEventListener("click", () => {
  app.newConversation();
  newChatButton.blur();
});

// Push-to-talk: hold Space anywhere except in form fields, or hold the button.
const isFormField = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;

window.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || isFormField(event.target)) return;
  event.preventDefault();
  if (!event.repeat) app.startListening();
});
window.addEventListener("keyup", (event) => {
  if (event.code !== "Space" || isFormField(event.target)) return;
  event.preventDefault();
  app.stopListening();
});
// Releasing the key in another window never reaches us.
window.addEventListener("blur", () => app.stopListening());

pttButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  pttButton.setPointerCapture(event.pointerId);
  app.startListening();
});
pttButton.addEventListener("pointerup", () => app.stopListening());
pttButton.addEventListener("pointercancel", () => app.stopListening());

textForm.addEventListener("submit", (event) => {
  event.preventDefault();
  app.sendText(textInput.value);
  textInput.value = "";
});

if (!WebSpeechStt.isSupported()) {
  pttButton.disabled = true;
  showNotice(strings.sttUnsupported);
}

void fetchHealth().then((health) => {
  if (!health) showNotice(strings.serverDown);
  else if (!health.hasKey) showNotice(strings.missingKey);
  else debugEl.textContent = `${health.model} · effort ${health.effort}`;
});

import { isLang, type TtsEngineId } from "../../shared/protocol";
import { fetchHealth, fetchVoices } from "./api";
import { App } from "./app";
import { unlockAudio } from "./audio/context";
import { Avatar } from "./avatar/avatar";
import { runEchoTest } from "./audio/echo-test";
import { loadSettings, saveSettings, setServerVoices, type Settings } from "./settings";
import { WebSpeechStt } from "./stt/webspeech";
import { waitForBrowserVoices } from "./tts/browser-tts";
import { Speaker } from "./tts/speaker";
import { ChatLog } from "./ui/chat-log";
import { byId } from "./ui/dom";
import { bindSettingsPanel } from "./ui/settings-panel";
import { strings } from "./ui/strings";

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

let settings = loadSettings();
const getSettings = () => settings;
const updateSettings = (patch: Partial<Settings>) => {
  settings = { ...settings, ...patch };
  saveSettings(settings);
};

// Tell about a failing server voice once, not on every sentence.
const reportedFallbacks = new Set<TtsEngineId>();
const speaker = new Speaker(getSettings, (from, error) => {
  console.warn(`TTS engine ${from} failed, using the browser voice`, error);
  if (reportedFallbacks.has(from)) return;
  reportedFallbacks.add(from);
  showNotice(strings.ttsFallback(from));
});

const avatar = new Avatar(stage);
avatar
  .load("/models/avatar.vrm")
  .then(() => stage.classList.add("has-avatar"))
  .catch((err: unknown) => {
    console.warn("Avatar model failed to load; showing the placeholder", err);
    stage.dataset.message = strings.avatarMissing;
  });
// Handy for poking at the avatar from the dev tools console.
if (import.meta.env.DEV) Object.assign(window, { avatar });

const app = new App(
  {
    log: new ChatLog(byId("log")),
    setState: (state) => {
      avatar.setState(state);
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
    setLanguage: (lang) => {
      updateSettings({ lang });
      langSelect.value = lang;
      settingsPanel.refresh();
    },
    // Server voices play through Web Audio and drive the lips from the signal;
    // the browser's own voice is out of reach, so its lips move procedurally.
    setSpeaking: (engine) => avatar.setMouthSource(engine === null ? null : engine === "browser" ? "procedural" : "audio"),
  },
  getSettings,
  speaker,
);

const settingsPanel = bindSettingsPanel({
  getSettings,
  update: updateSettings,
  onTestVoice: () => app.say(strings.voiceSample[settings.lang]),
  onEchoTest: async () => {
    app.stop();
    const lang = settings.lang;
    const clip = await speaker.prepare(strings.echo.sample[lang], lang, new AbortController().signal);
    const result = await runEchoTest((signal) => clip.play(signal));
    return strings.echo.describe(result, clip.engine);
  },
});

langSelect.value = settings.lang;
langSelect.addEventListener("change", () => {
  if (isLang(langSelect.value)) {
    updateSettings({ lang: langSelect.value });
    settingsPanel.refresh();
  }
  langSelect.blur();
});

newChatButton.addEventListener("click", () => {
  app.newConversation();
  newChatButton.blur();
});

// Browsers only allow audio after a user gesture; create the AudioContext on the first one.
window.addEventListener("pointerdown", unlockAudio, { capture: true });
window.addEventListener("keydown", unlockAudio, { capture: true });

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

void Promise.all([fetchVoices(), waitForBrowserVoices()]).then(([voices]) => {
  setServerVoices(voices);
  settingsPanel.refresh();
});

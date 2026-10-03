import type { TtsEngineId } from "../../../shared/protocol";
import { isEngineAvailable, resolveVoice, voiceOptions, type Settings } from "../settings";
import { byId } from "./dom";
import { strings } from "./strings";

export interface SettingsPanelDeps {
  getSettings(): Settings;
  update(patch: Partial<Settings>): void;
  onTestVoice(): void;
  /** Runs the echo test and returns a human-readable result. */
  onEchoTest(): Promise<string>;
}

export interface SettingsPanel {
  /** Re-renders engine availability and the voice list (after voices load or the language changes). */
  refresh(): void;
}

export function bindSettingsPanel(deps: SettingsPanelDeps): SettingsPanel {
  const engineSelect = byId<HTMLSelectElement>("tts-engine");
  const voiceSelect = byId<HTMLSelectElement>("tts-voice");
  const rateInput = byId<HTMLInputElement>("tts-rate");
  const rateOutput = byId<HTMLOutputElement>("tts-rate-value");
  const testButton = byId<HTMLButtonElement>("tts-test");
  const echoButton = byId<HTMLButtonElement>("echo-test");
  const echoResult = byId("echo-result");

  const renderEngines = () => {
    for (const option of engineSelect.options) {
      const engine = option.value as TtsEngineId;
      const available = isEngineAvailable(engine);
      option.textContent = available
        ? strings.engineNames[engine]
        : `${strings.engineNames[engine]} ${strings.settings.unavailable}`;
    }
    engineSelect.value = deps.getSettings().engine;
  };

  const renderVoices = () => {
    const settings = deps.getSettings();
    const options = voiceOptions(settings.engine, settings.lang);
    voiceSelect.replaceChildren(...options.map((o) => new Option(o.label, o.id)));
    if (options.length === 0) voiceSelect.append(new Option(strings.settings.noVoices, ""));
    voiceSelect.disabled = options.length === 0;
    voiceSelect.value = resolveVoice(settings, settings.engine, settings.lang) ?? "";
  };

  const renderRate = (rate: number) => {
    rateOutput.textContent = `${rate > 0 ? "+" : ""}${rate} %`;
  };

  engineSelect.addEventListener("change", () => {
    deps.update({ engine: engineSelect.value as TtsEngineId });
    renderVoices();
  });

  voiceSelect.addEventListener("change", () => {
    const settings = deps.getSettings();
    deps.update({ voices: { ...settings.voices, [`${settings.engine}:${settings.lang}`]: voiceSelect.value } });
  });

  rateInput.value = String(deps.getSettings().rate);
  renderRate(deps.getSettings().rate);
  rateInput.addEventListener("input", () => renderRate(Number(rateInput.value)));
  rateInput.addEventListener("change", () => deps.update({ rate: Number(rateInput.value) }));

  testButton.addEventListener("click", () => deps.onTestVoice());

  echoButton.addEventListener("click", async () => {
    echoButton.disabled = true;
    echoResult.textContent = strings.echo.running;
    try {
      echoResult.textContent = await deps.onEchoTest();
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? strings.sttErrors["not-allowed"]!
          : err instanceof Error
            ? err.message
            : String(err);
      echoResult.textContent = strings.echo.failed(message);
    } finally {
      echoButton.disabled = false;
    }
  });

  const refresh = () => {
    renderEngines();
    renderVoices();
  };
  refresh();
  return { refresh };
}

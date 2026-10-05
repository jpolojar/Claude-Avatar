<img src="assets/avatar-icon.png" width="128" align="right" alt="Avatar icon">

# Claude Avatar

A talking 3D avatar in the browser that you chat with by voice, in Finnish or English. Claude (Opus 5.5) is the brain; everything else (speech recognition, speech synthesis, the 3D avatar) is free. The API key stays on a small Node server and never reaches the browser.

The user interface and the avatar's persona are in Finnish; the avatar speaks both Finnish and English and switches when asked.

## Features

- **Voice chat:** push-to-talk (hold Space) or always-on listening, where talking over the avatar interrupts it.
- **Low latency:** Claude's reply is split into sentences while it streams, and speech starts with the first finished sentence.
- **3D avatar:** a VRM model with blinking, breathing, head and eye movement, state poses (listening, thinking, speaking) and lip sync from the audio signal.
- **Emotions:** Claude marks the mood of each sentence and the avatar's face follows it (happy, sad, surprised, relaxed, neutral).
- **Web search:** current information such as weather or news through Claude's web search tool.
- **Memory:** the avatar remembers you between conversations.
- **Interruptions:** Claude learns exactly how far you listened before cutting it off, down to the word, and does not repeat itself.

## Requirements

- Node.js 22.9 or newer (Node 24 tested)
- Microsoft Edge (Chrome also works for push-to-talk, but has no Finnish neural voice)
- A Claude API key
- Optional: an NVIDIA GPU for local Whisper (always-on listening)

The desktop shortcut and the Whisper instructions below are for Windows.

## Setup

1. Install the dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and put your Claude API key in `ANTHROPIC_API_KEY`.
3. Download an avatar model (see [Avatar](#avatar)).
4. Optional: install Whisper for always-on listening (see [Whisper](#whisper-always-on-listening)).
5. Start the server, the web app and Whisper (if installed):
   ```
   npm run dev
   ```
6. Open http://localhost:5173 in Edge and allow the microphone.

### Desktop shortcut (Windows)

`scripts\create-shortcut.ps1` creates `Avatar.lnk` in the project folder; copy it to your desktop:

```
powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1
```

- If the avatar isn't running, the shortcut starts `npm run dev` in a minimized "Avatar" console window, waits for the server and opens the page in Edge (about 10 seconds from cold).
- If it is already running, Edge opens right away.
- Closing the "Avatar" window stops everything.

The shortcut contains paths on your machine, so it is not committed. Its icon (`assets/avatar.ico`) is rendered from the avatar model.

## Usage

- **Listening mode** (top bar):
  - **Välilyönti (Space):** hold Space, speak, release. Recognition runs in the browser (Web Speech).
  - **Aina päällä (always on):** just talk. Voice activity detection (Silero VAD) notices speech and local Whisper transcribes it. Talking over the avatar stops it and it listens; Space or the Keskeytä (stop) button interrupts it too.
- **Typing:** you can always type a message instead.
- **Language:** the language menu switches speech recognition and Claude's reply language. You can also just ask, e.g. "can we speak English?".
- **Uusi keskustelu (new conversation)** clears the history and saves memory notes from the previous one.
- **Emotions:** Claude tags its sentences with a mood; the avatar's expression changes exactly when that sentence starts playing and fades back to neutral a few seconds after it stops talking. The tags are never shown or spoken.
- **Web search:**
  - When a search starts the avatar says a short filler ("Hetki, katson." / "One moment, let me check.") and waits in its thinking pose; the status line shows the query. The answer follows briefly once the search is done.
  - The app speaks the filler, not Claude: Opus 5.5 does not produce visible text before a tool call (it turns such text into hidden progress notes).
  - Uses Claude's web search tool, at most 3 searches per turn. Billed per Claude API pricing: about one cent per search plus the tokens of the results.
  - `AVATAR_WEB_SEARCH`: `fast` (default) is a plain search. `thorough` filters the results with code first, which is more accurate on messy pages but noticeably slower (in the first test the answer began only after 12.6 s). `off` disables search.
- **Memory:** when you start a new conversation, close the page or stay quiet for ten minutes, Claude folds what is worth remembering (at most 200 words) into `data/memory.json`. The note is given to the avatar at the start of the next conversation. The Muisti (memory) panel shows it and can clear it; you can also edit the file by hand.
- **Status line:** latencies measured from sending the message: speech recognition (STT), Claude's first word, the first finished sentence, start of audio (with the synthesis time of the first sentence), tokens and web searches.

### Keeping latency low

The server splits Claude's reply into sentences as soon as each one is certain (`server/sentences.ts`). The browser synthesizes the first sentence while Claude is still writing, and the next one while the previous one plays (`web/src/tts/queue.ts`).

- **Sentence boundaries:** abbreviations (esim., mm., klo, Dr., …), initials, dates and ordinals do not end a sentence.
- **Long sentences** are cut at a comma; the first one already after about 80 characters.
- **Stream pauses:** if Claude's text pauses after what looks like a finished sentence, it is spoken without waiting for the next word.
- **Silence trimming:** Edge's leading and trailing silence is trimmed, leaving a pause of about 0.2 s between sentences.

## Avatar

The avatar is a VRM model at `web/public/models/avatar.vrm`, rendered with [three-vrm](https://github.com/pixiv/three-vrm). The file is not committed. The default is three-vrm's sample character `VRM1_Constraint_Twist_Sample.vrm` (© pixiv Inc., [VRM Public License 1.0](https://vrm.dev/licenses/1.0/)):

```
curl -L -o web/public/models/avatar.vrm https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm
```

**Your own model:** save any VRM file (0.x or 1.0) under the same name and reload the page. You can find models on [VRoid Hub](https://hub.vroid.com/) (check each model's terms) or make one with the free [VRoid Studio](https://vroid.com/studio).

- **Idle life:** blinking, breathing, slow head drift and occasional eye saccades.
- **States:** listening tilts the head toward you with a smile; thinking looks up and to the side; speaking nods along with the voice.
- **Lip sync:** with the Edge and Piper voices the mouth follows the loudness of the audio, and the vowel shape (a, e, i, o, u) comes from its spectral brightness. The browser's own voice cannot be analysed, so its mouth movement is approximated.

## Voices

Open **Ääniasetukset** (voice settings) at the top of the page. Three speech engines:

| Engine | Description |
|---|---|
| **Edge neural voice** (default) | Microsoft's Noora (Finnish) and Ava or Emma (English) via the Node server ([msedge-tts](https://github.com/Migushthe2nd/MsEdgeTTS)). Audio arrives as a file with word timings, so lip sync and echo cancellation work. This is an unofficial Microsoft endpoint that may change; if it fails, the app falls back to the browser's own voice and says so. |
| **Browser voice** | Edge's own Noora Online (Natural) voice. Official and always available, but lip sync is approximate and echo cancellation does not cover it. |
| **Piper (offline)** | Optional local male voice (Harri) if you want to work entirely offline. Installed separately, see below. |

**Ava (monikielinen / multilingual)** speaks both Finnish and English in the same voice, if you want one voice for both languages.

**Kaikutesti (echo test)** plays a sample through the speakers twice and measures how much of the avatar's voice reaches the microphone with and without echo cancellation, which tells whether voice interruptions can work on speakers. Stay quiet during the test.

### Piper (optional)

```
pip install piper-tts[http]
python -m piper.download_voices fi_FI-harri-medium
python -m piper.http_server -m fi_FI-harri-medium
```

The server looks for Piper at `http://127.0.0.1:5000` (`AVATAR_PIPER_URL`). Reload the page and Piper becomes selectable.

## Whisper (always-on listening)

Always-on listening needs a local [whisper.cpp](https://github.com/ggml-org/whisper.cpp) server. The browser's Web Speech API won't do: it opens the microphone itself instead of using the app's echo-cancelled stream, so on speakers it would hear the avatar.

Install on Windows with an NVIDIA GPU (about 1.2 GB):

```
mkdir local\whisper\bin
curl -L -o local/whisper/whisper.zip https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-cublas-12.4.0-bin-x64.zip
tar -xf local/whisper/whisper.zip -C local/whisper/bin
curl -L -o local/whisper/ggml-large-v3-turbo-q5_0.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin
```

The server binary should end up at `local/whisper/bin/Release/whisper-server.exe`; otherwise set `AVATAR_WHISPER_BIN`.

`npm run dev` starts Whisper automatically when the files are there; without them everything else works as usual. Loading the model takes a few seconds, and "Aina päällä" becomes selectable once Whisper is ready. On an RTX 4070 SUPER a five-second Finnish sentence is transcribed in about 0.2 s.

Tuning lives in `web/src/stt/vad-listener.ts`:

- **End of speech:** 0.8 s of silence ends your turn.
- **While the avatar speaks:** interrupting needs clearer speech (threshold 0.75) for at least 0.4 s, so leftover echo cannot interrupt the avatar.

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Claude API key |
| `AVATAR_MODEL` | `claude-opus-5-5` | Claude model |
| `AVATAR_EFFORT` | `low` | `low` / `medium` / `high` / `xhigh` / `max`; low gives the fastest replies |
| `AVATAR_PORT` | `3001` | Port of the Node server |
| `AVATAR_PIPER_URL` | `http://127.0.0.1:5000` | Piper server (optional) |
| `AVATAR_DATA_DIR` | `data` | Folder for the memory file (`memory.json`) |
| `AVATAR_WEB_SEARCH` | `fast` | `fast` (plain search), `thorough` (results filtered by code, slower) or `off` |
| `AVATAR_COUNTRY` | `FI` | Approximate location for web search (country code) |
| `AVATAR_TIMEZONE` | `Europe/Helsinki` | Time zone for web search |
| `AVATAR_CITY` | – | Optional home city, e.g. `Tampere`, for local weather and search results |
| `AVATAR_WHISPER_PORT` | `8178` | Port of the Whisper server |
| `AVATAR_WHISPER_BIN` | `local/whisper/bin/Release/whisper-server.exe` | Path to whisper-server |
| `AVATAR_WHISPER_MODEL` | `local/whisper/ggml-large-v3-turbo-q5_0.bin` | Whisper model |

The variables have an `AVATAR_` prefix because Node's `--env-file` never overrides variables already set in the shell, and generic names such as `CLAUDE_EFFORT` are often set by other tools.

The server uses Claude's server-side fallbacks (`fallbacks: "default"`): if the model declines a request, the API retries it on another model.

## Development

```
npm run typecheck   # TypeScript checks for the server and the web app
npm test            # unit tests
npm run widget      # work in progress: the app in an Electron desktop window
```

`npm run widget` starts the same servers as `npm run dev` plus an Electron window (`desktop/main.ts`), so stop a running `npm run dev` first. It is the first step toward a desktop widget; push-to-talk does not work there yet (Electron has no Web Speech), use always-on listening or type.

Layout:

- `server/`: the Express server. `claude.ts` streams from Claude (with web search), `sentences.ts` splits the reply into sentences, `markers.ts` handles the language and emotion markers, `session.ts` keeps the conversation and interruptions, `memory.ts` the long-term memory, `stt.ts` talks to Whisper, `tts/` holds the speech engines (Edge, Piper), and `persona.md` is the avatar's persona (in Finnish).
- `scripts/`: `whisper.mjs` starts whisper.cpp as part of `npm run dev`; `start-avatar.ps1` and `create-shortcut.ps1` are the Windows launcher.
- `web/`: the Vite + TypeScript web app. `app.ts` is the state machine and conversation flow, `stt/` speech recognition (Web Speech, VAD + Whisper), `tts/` the speech engines, fallback and sentence queue, `audio/` the Web Audio graph, lip sync and echo test, `avatar/` the 3D avatar and its motion, and `ui/` the views and (Finnish) UI strings. In dev mode the avatar is available in the console as `avatar`, e.g. `avatar.setState("thinking")`.
- `shared/protocol.ts`: the wire format shared by the server and the browser (NDJSON).

## Credits

- [Claude](https://www.anthropic.com/claude) by Anthropic
- [three.js](https://threejs.org/) and [three-vrm](https://github.com/pixiv/three-vrm) (pixiv)
- Avatar sample model and icon source: `VRM1_Constraint_Twist_Sample` © pixiv Inc., VRM Public License 1.0
- [msedge-tts](https://github.com/Migushthe2nd/MsEdgeTTS), [vad-web / Silero VAD](https://github.com/ricky0123/vad), [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [Piper](https://github.com/OHF-Voice/piper1-gpl)

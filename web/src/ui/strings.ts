import type { ChatErrorCode, Lang, TtsEngineId } from "../../../shared/protocol";
import type { AppState } from "../app";
import type { EchoTestResult } from "../audio/echo-test";

/** Level relative to the room noise, e.g. "26 dB taustan yläpuolella". */
const relativeDb = (value: number) =>
  value >= 0
    ? `${Math.round(value)} dB taustan yläpuolella`
    : `${Math.round(-value)} dB taustan alapuolella`;

const engineNames: Record<TtsEngineId, string> = {
  edge: "Edge-neuroääni",
  piper: "Piper (offline)",
  browser: "Selaimen oma ääni",
};

// All user-facing text lives here (UI is Finnish regardless of conversation language).
export const strings = {
  status: {
    idle: "Valmis",
    listening: "Kuuntelee…",
    thinking: "Ajattelee…",
    speaking: "Puhuu…",
  } satisfies Record<AppState, string>,
  you: "Sinä",
  avatar: "Avatar",
  interrupted: "(keskeytetty)",
  truncated: "(vastaus katkesi pituusrajaan)",
  refusal: "Anteeksi, en pysty vastaamaan tuohon.",
  refusalSpoken: {
    fi: "Anteeksi, en pysty vastaamaan tuohon.",
    en: "Sorry, I can't answer that.",
  } satisfies Record<Lang, string>,
  noSpeech: "En kuullut mitään. Pidä välilyöntiä pohjassa koko puheen ajan.",
  avatarMissing: "Avatar-mallia ei löytynyt. Tallenna VRM-malli nimellä web/public/models/avatar.vrm.",
  missingKey: "API-avain puuttuu. Kopioi .env.example tiedostoksi .env, lisää avain ja käynnistä palvelin uudelleen.",
  serverDown: "Palvelimeen ei saada yhteyttä. Onko npm run dev käynnissä?",
  sttUnsupported: "Tämä selain ei tue puheentunnistusta. Käytä Edgeä tai Chromea, tai kirjoita viesti.",
  sttErrors: {
    "not-allowed": "Mikrofonin käyttö estettiin. Salli mikrofoni osoiterivin lukkokuvakkeesta.",
    "service-not-allowed": "Selain esti puheentunnistuspalvelun.",
    "audio-capture": "Mikrofonia ei löytynyt.",
    network: "Puheentunnistus ei saanut yhteyttä palveluun. Tarkista verkkoyhteys.",
    "language-not-supported": "Valittu kieli ei ole tuettu puheentunnistuksessa.",
    unsupported: "Tämä selain ei tue puheentunnistusta.",
  } as Record<string, string>,
  sttErrorFallback: (code: string) => `Puheentunnistuksen virhe: ${code}`,
  chatErrors: {
    auth: "API-avain puuttuu tai on virheellinen. Tarkista .env-tiedosto.",
    rate_limit: "Claude API:n käyttöraja tuli vastaan. Odota hetki ja yritä uudelleen.",
    overloaded: "Claude on juuri nyt ruuhkautunut. Yritä hetken päästä uudelleen.",
    network: "Yhteys Claude API:in katkesi.",
    bad_request: "Pyyntö hylättiin (virheellinen pyyntö).",
    api: "Claude API palautti virheen.",
  } satisfies Record<ChatErrorCode, string>,
  ttsFailed: "Puhesynteesi epäonnistui, joten vastaus näkyy vain tekstinä.",
  ttsFallback: (engine: TtsEngineId) => `${engineNames[engine]} ei vastannut, joten käytetään selaimen omaa ääntä.`,
  engineNames,
  settings: {
    unavailable: "(ei käytettävissä)",
    noVoices: "(ei ääniä tälle kielelle)",
  },
  voiceSample: {
    fi: "Hei! Tältä minä kuulostan. Kerro, jos haluat minun puhuvan nopeammin tai hitaammin.",
    en: "Hi! This is how I sound. Tell me if you'd like me to speak faster or slower.",
  } satisfies Record<Lang, string>,
  echo: {
    sample: {
      fi: "Tämä on kaikutesti. Puhun nyt muutaman sekunnin ajan, jotta voidaan mitata, kuinka paljon ääneni kuuluu kaiuttimista takaisin mikrofoniin. Pysy hetki hiljaa, testi on kohta valmis.",
      en: "This is an echo test. I will talk for a few seconds so we can measure how much of my voice travels from the speakers back into the microphone. Please stay quiet, it is almost done.",
    } satisfies Record<Lang, string>,
    running: "Kaikutesti käynnissä. Ole hiljaa noin 15 sekuntia, avatar puhuu näytteen kahdesti.",
    failed: (message: string) => `Kaikutesti epäonnistui: ${message}`,
    describe: (r: EchoTestResult, engine: TtsEngineId): string => {
      const on = r.aecOn.leakDb;
      const off = r.aecOff.leakDb;
      const numbers = `Mikrofonissa avatarin ääni on kaiunpoiston kanssa ${relativeDb(on)} ja ilman kaiunpoistoa ${relativeDb(off)} (${engineNames[engine]}).`;
      if (off < 6) {
        return `${numbers} Mikrofoni ei juuri kuule kaiuttimia, joten testi ei ole luotettava. Nosta äänenvoimakkuutta ja kokeile uudelleen.`;
      }
      if (on < 6) return `${numbers} Kaiunpoisto toimii hyvin, joten äänellä keskeyttäminen kaiuttimilla on realistista.`;
      if (on < 15) return `${numbers} Kaiunpoisto auttaa osittain, joten äänellä keskeyttäminen vaatii korkeamman kynnyksen.`;
      return `${numbers} Kaiunpoisto ei riitä. Keskeytä välilyönnillä tai käytä kuulokkeita.`;
    },
  },
  debug: {
    stt: "STT",
    firstWord: "ensimmäinen sana",
    firstSentence: "1. lause",
    audioStart: "ääni alkoi",
    tts: "TTS",
    tokens: "tokenit",
    cache: "välimuisti",
  },
};

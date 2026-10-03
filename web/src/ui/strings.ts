import type { ChatErrorCode } from "../../../shared/protocol";
import type { AppState } from "../app";

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
  noSpeech: "En kuullut mitään. Pidä välilyöntiä pohjassa koko puheen ajan.",
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
  debug: {
    stt: "STT",
    firstWord: "ensimmäinen sana",
    total: "yhteensä",
    tokens: "tokenit",
    cache: "välimuisti",
  },
};

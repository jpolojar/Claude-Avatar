# Avatar

Selainpohjainen puhuva avatar, jonka kanssa keskustellaan äänellä suomeksi tai englanniksi. Aivoina toimii Claude API (Opus 5.5). API-avain pysyy Node-palvelimella eikä päädy selaimeen.

Toteutussuunnitelma vaiheineen on tiedostossa `C:\Users\jpolo\.claude\plans\dreamy-weaving-otter.md`.

## Tila

| Vaihe | Sisältö | Tila |
|---|---|---|
| a | Mikki → teksti → Claude → teksti ruudulle | ✅ valmis |
| b | Clauden vastaus puheeksi (edge-tts Noora, varalla selaimen ääni) | ✅ valmis |
| c | 3D-avatar (VRM) ja huulisynkka | ✅ valmis |
| d | Streaming ja lausepätkitys | – |
| e | Barge-in, aina päällä -tila, muisti ja viimeistely | – |

## Käyttöönotto

Tarvitset Node.js 22.9:n tai uudemman (Node 24 on testattu) sekä Microsoft Edgen.

1. Asenna riippuvuudet:
   ```
   npm install
   ```
2. Kopioi `.env.example` tiedostoksi `.env` ja lisää Claude API -avain kohtaan `ANTHROPIC_API_KEY`.
3. Käynnistä palvelin ja käyttöliittymä:
   ```
   npm run dev
   ```
4. Avaa Edgessä osoite http://localhost:5173 ja salli mikrofoni, kun selain kysyy.

## Käyttö

- **Puhuminen:** pidä välilyöntiä pohjassa, puhu ja päästä irti. Voit myös pitää pohjassa ruudun puhepainiketta tai kirjoittaa viestin tekstikenttään.
- **Keskeytys:** välilyönnin painaminen kesken vastauksen katkaisee sen. Claude näkee seuraavalla vuorolla, että se keskeytettiin.
- **Kieli:** valinta vaihtaa puheentunnistuksen ja Clauden vastauskielen. Vaihto astuu voimaan seuraavasta vuorosta.
- **Uusi keskustelu** tyhjentää historian.
- **Tilarivi** näyttää viiveet: puheentunnistus, ensimmäinen sana, kokonaisaika ja tokenimäärät.

## Avatar

Avatar on VRM-malli tiedostossa `web/public/models/avatar.vrm`, ja se näytetään [three-vrm](https://github.com/pixiv/three-vrm)-kirjastolla. Tiedosto ei ole gitissä. Oletusmallina on three-vrm:n esimerkkihahmo `VRM1_Constraint_Twist_Sample.vrm` (© pixiv Inc., [VRM Public License 1.0](https://vrm.dev/licenses/1.0/)). Lataa se näin:

```
curl -L -o web/public/models/avatar.vrm https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm
```

**Oma malli:** tallenna mikä tahansa VRM-tiedosto (0.x tai 1.0) samalla nimellä ja lataa sivu uudelleen. Malleja saa esimerkiksi [VRoid Hubista](https://hub.vroid.com/), kun käyttöehdot sallivat sen, tai voit tehdä oman ilmaisella [VRoid Studiolla](https://vroid.com/studio).

Avatar toimii näin:

- **Elävyys:** silmät räpyttelevät, rintakehä hengittää, pää liikkuu hitaasti ja katse hypähtelee välillä.
- **Tilat:** kuunnellessa pää kallistuu kohti ja kasvoilla on hymy. Ajatellessa katse kääntyy ylös ja sivulle. Puhuessa pää nyökkäilee äänen tahdissa.
- **Huulisynkka:** Edge- ja Piper-äänillä suu liikkuu äänen voimakkuuden mukaan, ja vokaali (a, e, i, o, u) valitaan äänen kirkkaudesta. Selaimen oma ääni ei kulje sivun kautta, joten silloin suu liikkuu arvioidusti.

## Ääni

Avaa **Ääniasetukset** sivun yläosasta. Voit valita kolmesta puhemoottorista:

| Moottori | Kuvaus |
|---|---|
| **Edge-neuroääni** (oletus) | Microsoftin Noora (suomi) sekä Ava tai Emma (englanti) Node-palvelimen kautta ([msedge-tts](https://github.com/Migushthe2nd/MsEdgeTTS)). Ääni tulee tiedostona sanakohtaisine ajoituksineen, joten huulisynkka ja kaiunpoisto toimivat. Rajapinta on Microsoftin epävirallinen ja voi joskus muuttua. Silloin sovellus vaihtaa automaattisesti selaimen omaan ääneen ja kertoo siitä. |
| **Selaimen oma ääni** | Edgen oma Noora Online (Natural) -ääni. Virallinen ja aina saatavilla, mutta huulisynkka on vain arvio, eikä kaiunpoisto koske sitä. |
| **Piper (offline)** | Valinnainen. Paikallinen miesääni Harri, jos haluat toimia täysin ilman verkkoa. Asennus erikseen, katso alta. |

**Ava (monikielinen)** puhuu sekä suomea että englantia samalla äänellä, jos haluat avatarille yhden äänen kummallekin kielelle.

**Kaikutesti** soittaa näytteen kaiuttimista kahdesti ja mittaa, kuinka paljon avatarin ääni kuuluu mikrofoniin kaiunpoiston kanssa ja ilman. Tulos kertoo, toimiiko äänellä keskeyttäminen kaiuttimilla vaiheessa e. Ole testin ajan hiljaa.

### Piper (valinnainen)

```
pip install piper-tts[http]
python -m piper.download_voices fi_FI-harri-medium
python -m piper.http_server -m fi_FI-harri-medium
```

Palvelin löytää Piperin osoitteesta `http://127.0.0.1:5000` (muutettavissa muuttujalla `AVATAR_PIPER_URL`). Lataa sivu uudelleen, niin Piper tulee valittavaksi.

## Asetukset (`.env`)

| Muuttuja | Oletus | Selitys |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Claude API -avain |
| `AVATAR_MODEL` | `claude-opus-5-5` | Claude-malli |
| `AVATAR_EFFORT` | `low` | `low` / `medium` / `high` / `xhigh` / `max`. Matala effort antaa nopeimman vastauksen |
| `AVATAR_PORT` | `3001` | Node-palvelimen portti |
| `AVATAR_PIPER_URL` | `http://127.0.0.1:5000` | Piper-palvelimen osoite (valinnainen) |

Muuttujilla on `AVATAR_`-etuliite, koska Node ei ylikirjoita `.env`-tiedostosta muuttujia, jotka on jo asetettu komentotulkissa. Esimerkiksi `CLAUDE_EFFORT` voi olla jo valmiiksi asetettuna.

Palvelin käyttää Clauden palvelinpuolen varamallia (`fallbacks: "default"`). Jos malli kieltäytyy vastaamasta, API yrittää automaattisesti toisella mallilla.

## Kehitys

```
npm run typecheck   # TypeScript-tarkistus palvelimelle ja selaimelle
npm test            # yksikkötestit
```

Rakenne:

- `server/`: Express-palvelin. Tiedosto `claude.ts` hoitaa Claude-streamauksen, `session.ts` keskusteluhistorian ja `persona.md` persoonan. Kansiossa `tts/` ovat puhesynteesimoottorit (edge, piper).
- `web/`: Vite- ja TypeScript-käyttöliittymä. Tiedosto `app.ts` sisältää tilakoneen, `stt/` puheentunnistuksen, `tts/` puhemoottorit ja varaäänilogiikan, `audio/` Web Audio -ketjun, huulisynkan ja kaikutestin, `avatar/` 3D-avatarin ja sen liikkeet sekä `ui/` näkymät. Kehitystilassa avatar on konsolissa muuttujana `avatar`, esimerkiksi `avatar.setState("thinking")`.
- `shared/protocol.ts`: palvelimen ja selaimen yhteinen viestimuoto (NDJSON).

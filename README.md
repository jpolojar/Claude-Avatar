# Avatar

Selainpohjainen puhuva avatar, jonka kanssa keskustellaan äänellä suomeksi tai englanniksi. Aivoina toimii Claude API (Opus 5.5). API-avain pysyy Node-palvelimella eikä päädy selaimeen.

Toteutussuunnitelma vaiheineen on tiedostossa `C:\Users\jpolo\.claude\plans\dreamy-weaving-otter.md`.

## Tila

| Vaihe | Sisältö | Tila |
|---|---|---|
| a | Mikki → teksti → Claude → teksti ruudulle | ✅ valmis |
| b | Clauden vastaus puheeksi (edge-tts Noora, varalla selaimen ääni) | ✅ valmis |
| c | 3D-avatar (VRM) ja huulisynkka | ✅ valmis |
| d | Streaming ja lausepätkitys | ✅ valmis |
| e | Barge-in, aina päällä -tila, muisti ja viimeistely | ✅ valmis |

## Käyttöönotto

Tarvitset Node.js 22.9:n tai uudemman (Node 24 on testattu) sekä Microsoft Edgen.

1. Asenna riippuvuudet:
   ```
   npm install
   ```
2. Kopioi `.env.example` tiedostoksi `.env` ja lisää Claude API -avain kohtaan `ANTHROPIC_API_KEY`.
3. Valinnainen: aina päällä -kuuntelua varten asenna Whisper (katso alla).
4. Käynnistä palvelin, käyttöliittymä ja Whisper (jos se on asennettu):
   ```
   npm run dev
   ```
5. Avaa Edgessä osoite http://localhost:5173 ja salli mikrofoni, kun selain kysyy.

## Käyttö

- **Puhetapa** valitaan yläpalkista:
  - **Välilyönti:** pidä välilyöntiä pohjassa, puhu ja päästä irti. Tunnistus tapahtuu selaimessa (Web Speech).
  - **Aina päällä:** puhu milloin vain. Avatar huomaa puheen itse (Silero VAD) ja tunnistaa sen paikallisella Whisperillä. Kun aloitat puhumisen avatarin puheen päälle, se lopettaa ja kuuntelee. Välilyönti tai Keskeytä-painike keskeyttää avatarin myös tässä tilassa.
- **Kirjoittaminen:** voit aina kirjoittaa viestin myös tekstikenttään.
- **Keskeytys:** Claude saa seuraavalla vuorolla tiedon siitä, mihin kohtaan sen vastaus keskeytyi, sanan tarkkuudella, eikä se toista keskeytettyä vastausta.
- **Kieli:** valinta vaihtaa puheentunnistuksen ja Clauden vastauskielen. Kielen voi vaihtaa myös pyytämällä, esimerkiksi sanomalla "puhutaanko englantia".
- **Uusi keskustelu** tyhjentää historian ja tallentaa edellisestä keskustelusta muistiinpanot.
- **Muisti:** avatar muistaa sinut keskustelusta toiseen. Kun aloitat uuden keskustelun, suljet sivun tai olet kymmenen minuuttia hiljaa, Claude tiivistää olennaisen (enintään 200 sanaa) tiedostoon `data/memory.json`. Tiivistelmä annetaan avatarille seuraavan keskustelun alussa. Muisti-paneelista näet, mitä se muistaa, ja voit tyhjentää muistin. Tiedostoa voi myös muokata käsin.
- **Tilarivi** näyttää viiveet mitattuna siitä, kun viesti lähti: puheentunnistus (STT), Clauden ensimmäinen sana, ensimmäinen valmis lause, äänen alku (sekä ensimmäisen lauseen synteesiaika) ja tokenimäärät.

### Miten viive pidetään pienenä

Palvelin pilkkoo Clauden vastauksen lauseiksi heti, kun lause on valmis (`server/sentences.ts`). Selain syntetisoi ensimmäisen lauseen samalla, kun Claude vielä kirjoittaa, ja seuraavan lauseen sillä aikaa, kun edellinen soi (`web/src/tts/queue.ts`).

- **Lauseraja:** lyhenteet (esim., mm., klo, Dr. …), nimikirjaimet, päivämäärät ja järjestysluvut eivät katkaise lausetta.
- **Pitkät lauseet:** pitkä lause katkaistaan pilkun kohdalta, ensimmäinen jo noin 80 merkin jälkeen.
- **Hiljaisuuden leikkaus:** Edgen äänitiedostojen alku- ja loppuhiljaisuus leikataan pois, ja lauseiden väliin jätetään noin 0,2 sekunnin tauko.

Mockilla mitattuna (ensimmäinen sana 1,2 s) ääni alkaa noin 1,7 sekunnissa, kun aiemmin se alkoi vasta, kun koko vastaus oli valmis ja syntetisoitu.

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

## Whisper (aina päällä -kuuntelu)

Aina päällä -tila tarvitsee paikallisen [whisper.cpp](https://github.com/ggml-org/whisper.cpp)-palvelimen. Selaimen Web Speech ei käy tähän, koska se avaa mikrofonin itse eikä käytä sovelluksen kaiunpoistettua äänivirtaa. Kaiuttimilla avatarin oma ääni kuuluisi silloin tunnistukseen.

Asennus Windowsille ja NVIDIA-näytönohjaimelle (noin 1,2 Gt):

```
mkdir local\whisper\bin
curl -L -o local/whisper/whisper.zip https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-cublas-12.4.0-bin-x64.zip
tar -xf local/whisper/whisper.zip -C local/whisper/bin
curl -L -o local/whisper/ggml-large-v3-turbo-q5_0.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin
```

Purkamisen jälkeen ohjelman pitää löytyä polusta `local/whisper/bin/Release/whisper-server.exe`. Jos se on eri paikassa, aseta polku muuttujaan `AVATAR_WHISPER_BIN`.

`npm run dev` käynnistää Whisperin automaattisesti, jos tiedostot löytyvät. Ilman niitä kaikki muu toimii normaalisti. Mallin lataus kestää muutaman sekunnin, ja "Aina päällä" tulee valittavaksi, kun Whisper on valmis. RTX 4070 SUPERilla viiden sekunnin suomenkielinen lause tunnistuu noin 0,2 sekunnissa.

Säädöt löytyvät tiedostosta `web/src/stt/vad-listener.ts`:

- **Puheen loppu:** 0,8 sekunnin hiljaisuus päättää puheenvuoron.
- **Avatarin puhuessa:** keskeytykseen vaaditaan selvempää puhetta (kynnys 0,75) ja vähintään 0,4 sekuntia, ettei kaiun jäänne keskeytä avataria.

## Asetukset (`.env`)

| Muuttuja | Oletus | Selitys |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Claude API -avain |
| `AVATAR_MODEL` | `claude-opus-5-5` | Claude-malli |
| `AVATAR_EFFORT` | `low` | `low` / `medium` / `high` / `xhigh` / `max`. Matala effort antaa nopeimman vastauksen |
| `AVATAR_PORT` | `3001` | Node-palvelimen portti |
| `AVATAR_PIPER_URL` | `http://127.0.0.1:5000` | Piper-palvelimen osoite (valinnainen) |
| `AVATAR_DATA_DIR` | `data` | Kansio, jossa muisti (`memory.json`) on |
| `AVATAR_WHISPER_PORT` | `8178` | Whisper-palvelimen portti |
| `AVATAR_WHISPER_BIN` | `local/whisper/bin/Release/whisper-server.exe` | whisper-server-ohjelman polku |
| `AVATAR_WHISPER_MODEL` | `local/whisper/ggml-large-v3-turbo-q5_0.bin` | Whisper-malli |

Muuttujilla on `AVATAR_`-etuliite, koska Node ei ylikirjoita `.env`-tiedostosta muuttujia, jotka on jo asetettu komentotulkissa. Esimerkiksi `CLAUDE_EFFORT` voi olla jo valmiiksi asetettuna.

Palvelin käyttää Clauden palvelinpuolen varamallia (`fallbacks: "default"`). Jos malli kieltäytyy vastaamasta, API yrittää automaattisesti toisella mallilla.

## Kehitys

```
npm run typecheck   # TypeScript-tarkistus palvelimelle ja selaimelle
npm test            # yksikkötestit
```

Rakenne:

- `server/`: Express-palvelin. Tiedosto `claude.ts` hoitaa Claude-streamauksen, `sentences.ts` lausepilkkojan, `language-marker.ts` kielenvaihtomerkinnät, `session.ts` keskusteluhistorian ja keskeytykset, `memory.ts` muistin, `stt.ts` Whisper-tunnistuksen ja `persona.md` persoonan.
- `scripts/whisper.mjs` käynnistää whisper.cpp-palvelimen osana `npm run dev` -komentoa. Kansiossa `tts/` ovat puhesynteesimoottorit (edge, piper).
- `web/`: Vite- ja TypeScript-käyttöliittymä. Tiedosto `app.ts` sisältää tilakoneen ja keskustelun kulun, `stt/` puheentunnistuksen (Web Speech ja VAD + Whisper), `tts/` puhemoottorit ja varaäänilogiikan, `audio/` Web Audio -ketjun, huulisynkan ja kaikutestin, `avatar/` 3D-avatarin ja sen liikkeet sekä `ui/` näkymät. Kehitystilassa avatar on konsolissa muuttujana `avatar`, esimerkiksi `avatar.setState("thinking")`.
- `shared/protocol.ts`: palvelimen ja selaimen yhteinen viestimuoto (NDJSON).

# Avatar

Selainpohjainen puhuva avatar, jonka kanssa keskustellaan äänellä suomeksi tai englanniksi. Aivoina toimii Claude API (Opus 5.5). API-avain pysyy Node-palvelimella eikä päädy selaimeen.

Toteutussuunnitelma vaiheineen on tiedostossa `C:\Users\jpolo\.claude\plans\dreamy-weaving-otter.md`.

## Tila

| Vaihe | Sisältö | Tila |
|---|---|---|
| a | Mikki → teksti → Claude → teksti ruudulle | ✅ valmis |
| b | Clauden vastaus puheeksi (edge-tts Noora, varalla selaimen ääni) | – |
| c | 3D-avatar (VRM) ja huulisynkka | – |
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

## Asetukset (`.env`)

| Muuttuja | Oletus | Selitys |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Claude API -avain |
| `AVATAR_MODEL` | `claude-opus-5-5` | Claude-malli |
| `AVATAR_EFFORT` | `low` | `low` / `medium` / `high` / `xhigh` / `max`. Matala effort antaa nopeimman vastauksen |
| `AVATAR_PORT` | `3001` | Node-palvelimen portti |

Muuttujilla on `AVATAR_`-etuliite, koska Node ei ylikirjoita `.env`-tiedostosta muuttujia, jotka on jo asetettu komentotulkissa. Esimerkiksi `CLAUDE_EFFORT` voi olla jo valmiiksi asetettuna.

Palvelin käyttää Clauden palvelinpuolen varamallia (`fallbacks: "default"`). Jos malli kieltäytyy vastaamasta, API yrittää automaattisesti toisella mallilla.

## Kehitys

```
npm run typecheck   # TypeScript-tarkistus palvelimelle ja selaimelle
npm test            # yksikkötestit
```

Rakenne:

- `server/`: Express-palvelin. Tiedosto `claude.ts` hoitaa Claude-streamauksen, `session.ts` keskusteluhistorian ja `persona.md` persoonan.
- `web/`: Vite- ja TypeScript-käyttöliittymä. Tiedosto `app.ts` sisältää tilakoneen, `stt/` puheentunnistuksen ja `ui/` näkymät.
- `shared/protocol.ts`: palvelimen ja selaimen yhteinen viestimuoto (NDJSON).

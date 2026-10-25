# Tactical Airsoft Shot Timer & Drill Trainer (PWA)

An offline-capable Progressive Web App (PWA) designed for Android phones to assist with GBB/pistol airsoft drills, shot timing, and hands-free voice/audio command training.

## Features
- **Offline Caching (PWA)**: Precaches all assets via [`sw.js`](sw.js) and [`manifest.json`](manifest.json) so it can be installed to your Android home screen and used with zero internet connection.
- **Screen Wake Lock**: Uses the Screen Wake Lock API (`navigator.wakeLock`) plus an automatic re-acquire listener and Web Audio fallback to keep your screen awake while holstering and shooting.
- **GBB / Pistol Acoustic Shot Detection**: Uses the Web Audio API with raw transient capture (`echoCancellation: false, noiseSuppression: false, autoGainControl: false`), adjustable threshold slider, and GBB blowback echo lockout (debounce) so slide cycling doesn't double-count shots.
- **Hands-Free Control**:
  - **Voice Commands**: Say `"Ready"`, `"Start"`, `"Stop"`, `"Repeat"`, or `"Next"` via Web Speech API.
  - **Offline Double-Clap Trigger**: Double-clap or shout twice when idle to start the selected drill 100% offline.
  - **Auto-Repeat Loop**: Optional configurable rest timer to automatically cycle repetitions hands-free.
- **Audible Timer & Tactical Callouts**: Synthesizes competition piezo buzzers (`2400Hz` / `1800Hz` / `1000Hz`) and offline Text-to-Speech callouts (`"5, 4, 3, 2, 1"`, `"Ready"`, `"Standby"`, `"Draw!"`, `"Fire!"`, `"Reload!"`, `"Contact Front / Left / Right / Rear!"`).
- **Built-in Airsoft Drills**:
  1. **Exact `#`s Paced Draw**: Draw from holster in *exactly* `#` seconds (`5.0s` slow dexterity pacing down to max speed) with optional cadence ticks and pacing accuracy error readout.
  2. **Holster Shoot `#`**: Draw from holster and fire `#` shots on signal.
  3. **High Ready Shoot `#`**: Present from High Ready and fire `#` shots.
  4. **Low Ready Shoot `#`**: Snap up from Low Ready and fire `#` shots.
  5. **Shoot `#` + Reload + `#`**: Toggle a reload between shots on *any* drill or select the dedicated Reload preset. Calls out `"Reload!"` automatically after your pre-reload shots and tracks the reload split time.
  6. **Turned Away (`90° / 180° / 270° / 360°`)**: Start holstered turned away in multiples of 90° (fixed or random), turn on signal, draw, and shoot `#` times.
  7. **Walk + Two-Stage Signal**: Walk towards or away from target with a holstered pistol; at the 1st signal (`"Draw!"`) draw your pistol, and at the 2nd signal (`"Fire!"` + beep) shoot `#` times.
  8. **Contact Threat Callout**: Calls out a random threat direction (`Front`, `Left`, `Right`, `Rear`) and times `#` shots.
- **Shot & Split Logging**: Records 1st shot (draw/reaction), individual shot splits, reload splits, and target/par delta in `localStorage` with filtering and CSV export.

## Running & Caching on Android
Because Android Chrome requires a Secure Context (`HTTPS` or `localhost`) for Microphone (`getUserMedia`), Screen Wake Lock, and Service Worker caching:
1. **Quick Local Server**:
   ```bash
   python3 -m http.server 8080
   ```
2. **Access on Android**:
   - Host via GitHub Pages / Cloudflare Pages / Netlify (automatic HTTPS), **or**
   - Connect via USB debugging (`adb reverse tcp:8080 tcp:8080`) and open `http://localhost:8080` in Chrome on Android, then tap **"+ Install App"** (or Chrome Menu &rarr; **Add to Home screen**).

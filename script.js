/**
 * Tactical Airsoft Shot Timer & Drill Trainer
 * Offline-First PWA with Wake Lock, Web Audio GBB Shot Detection,
 * Hands-Free Voice / Clap Commands, Audible Timer Cues, and Split Logging.
 */

(() => {
  'use strict';

  // ==========================================
  // 1. DRILL DEFINITIONS & PRESETS
  // ==========================================
  const DRILL_DEFS = {
    draw_exact: {
      id: 'draw_exact',
      name: 'Exact #s Paced Draw',
      category: 'Dexterity & Pacing',
      defaultShots: 1,
      defaultTargetSec: 3.0,
      summary:
        'Draw from holster and break your shot in EXACTLY # seconds (5s slow-motion dexterity down to max speed). Optional cadence ticks pace your draw stroke so you finish right on the target mark.'
    },
    holster_shoot: {
      id: 'holster_shoot',
      name: 'Holster Shoot #',
      category: 'Holster Speed',
      defaultShots: 2,
      defaultTargetSec: 2.0,
      summary:
        'Start holstered. On the audible "Fire!" / buzzer signal, draw and fire # shots as fast and accurately as possible.'
    },
    high_ready: {
      id: 'high_ready',
      name: 'High Ready Shoot #',
      category: 'Ready Position',
      defaultShots: 2,
      defaultTargetSec: 1.2,
      summary:
        'Start at High Ready (muzzle slightly depressed, sights below eye line). On signal, punch out and fire # shots.'
    },
    low_ready: {
      id: 'low_ready',
      name: 'Low Ready Shoot #',
      category: 'Ready Position',
      defaultShots: 2,
      defaultTargetSec: 1.3,
      summary:
        'Start at Low Ready (45° down). On signal, snap sights to target and fire # shots.'
    },
    reload_drill: {
      id: 'reload_drill',
      name: 'Shoot # + Reload + #',
      category: 'Reload Transitions',
      defaultShots: 2,
      defaultPostReloadShots: 2,
      defaultTargetSec: 4.5,
      summary:
        'Fire # shots from Holster or Ready, perform a speed reload (app calls "Reload!" after your pre-reload shots), then fire # follow-up shots.'
    },
    turned_holster: {
      id: 'turned_holster',
      name: 'Turned Away (90°/180°/270°)',
      category: 'Pivot & Engage',
      defaultShots: 2,
      defaultTargetSec: 2.5,
      summary:
        'Start holstered turned away from target in multiples of 90° (90° L/R, 180° Rear, 270°). On signal, turn safely, draw, and fire # shots.'
    },
    walk_draw_shoot: {
      id: 'walk_draw_shoot',
      name: 'Walk: 1st Signal Draw, 2nd Shoot #',
      category: 'Movement & Two-Stage Signal',
      defaultShots: 2,
      defaultTargetSec: 1.5,
      summary:
        'Start holstered walking towards or away from target. At 1st signal ("Draw!"), draw to ready while moving/stabilizing. At 2nd signal ("Fire!" + Beep), shoot # times.'
    },
    contact_callout: {
      id: 'contact_callout',
      name: 'Contact Threat Callout',
      category: 'Reaction & Threat ID',
      defaultShots: 2,
      defaultTargetSec: 2.0,
      summary:
        'Audible timer calls out a random direction ("Contact Front / Left / Right / Rear!"). Orient, present, and fire # shots.'
    }
  };

  // ==========================================
  // 2. APPLICATION STATE
  // ==========================================
  const state = {
    selectedDrill: 'draw_exact',
    phase: 'IDLE', // 'IDLE' | 'COUNTDOWN' | 'WALKING' | 'DRAWN_WAITING' | 'LIVE'
    timers: [], // active setTimeout / setInterval IDs for current run
    rafId: null,

    // Run timing metrics
    signalTimestampMs: 0,
    firstSignalTimestampMs: 0,
    prematureShots: 0,
    shots: [], // Array of { shotNumber, elapsedSec, splitSec, isReloadSplit }
    expectedTotalShots: 1,
    preReloadShots: 1,
    includeReload: false,
    reloadCalled: false,
    activeContextLabel: '',

    // Wake Lock
    wakeLockSentinel: null,
    wakeLockActive: false,

    // Audio / Mic Detector
    audioCtx: null,
    micStream: null,
    analyser: null,
    timeDomainData: null,
    micEnabled: false,
    micRafId: null,
    currentPeak: 0,
    peakHold: 0,
    peakHoldDecayTime: 0,
    thresholdPercent: 62,
    debounceMs: 115,
    lastShotTimestampMs: 0,
    muteShotDetectionUntilMs: 0,

    // Double-clap offline start detector
    clapTimestamps: [],

    // Speech Recognition
    recognition: null,
    voiceCmdEnabled: false,
    isSpeakingTts: false,

    // Persisted Logs
    logs: []
  };

  const STORAGE_KEYS = {
    LOGS: 'airsoft_trainer_logs_v1',
    SETTINGS: 'airsoft_trainer_settings_v1'
  };

  // ==========================================
  // 3. DOM ELEMENTS
  // ==========================================
  const el = {
    offlineStatusText: document.getElementById('offlineStatusText'),
    installPwaBtn: document.getElementById('installPwaBtn'),
    wakeLockBtn: document.getElementById('wakeLockBtn'),
    wakeLockText: document.getElementById('wakeLockText'),
    micToggleBtn: document.getElementById('micToggleBtn'),
    micStatusText: document.getElementById('micStatusText'),
    voiceToggleBtn: document.getElementById('voiceToggleBtn'),
    voiceStatusText: document.getElementById('voiceStatusText'),

    peakValueLabel: document.getElementById('peakValueLabel'),
    thresholdValueLabel: document.getElementById('thresholdValueLabel'),
    meterFill: document.getElementById('meterFill'),
    meterPeakHold: document.getElementById('meterPeakHold'),
    meterThresholdLine: document.getElementById('meterThresholdLine'),
    voiceHeardBanner: document.getElementById('voiceHeardBanner'),

    tabBtns: document.querySelectorAll('.tab-btn'),
    tabPanels: document.querySelectorAll('.tab-panel'),
    logCountBadge: document.getElementById('logCountBadge'),

    timerCard: document.getElementById('timerCard'),
    drillPhaseBadge: document.getElementById('drillPhaseBadge'),
    activeCueBanner: document.getElementById('activeCueBanner'),
    clockDisplay: document.getElementById('clockDisplay'),
    shotsCounterDisplay: document.getElementById('shotsCounterDisplay'),
    firstShotDisplay: document.getElementById('firstShotDisplay'),
    lastSplitDisplay: document.getElementById('lastSplitDisplay'),
    parOrTargetLabel: document.getElementById('parOrTargetLabel'),
    parDeltaDisplay: document.getElementById('parDeltaDisplay'),
    liveSplitsStrip: document.getElementById('liveSplitsStrip'),

    startDrillBtn: document.getElementById('startDrillBtn'),
    manualShotBtn: document.getElementById('manualShotBtn'),
    stopDrillBtn: document.getElementById('stopDrillBtn'),

    drillCategoryTag: document.getElementById('drillCategoryTag'),
    drillTiles: document.querySelectorAll('.drill-tile'),
    drillSummaryBox: document.getElementById('drillSummaryBox'),

    paramTargetSecondsWrap: document.getElementById('paramTargetSecondsWrap'),
    targetSecondsLabel: document.getElementById('targetSecondsLabel'),
    targetSecondsInput: document.getElementById('targetSecondsInput'),
    dexterityQuickChips: document.getElementById('dexterityQuickChips'),

    paramShotsWrap: document.getElementById('paramShotsWrap'),
    shotsCountLabel: document.getElementById('shotsCountLabel'),
    shotsCountInput: document.getElementById('shotsCountInput'),

    paramStartPosWrap: document.getElementById('paramStartPosWrap'),
    startPosSelect: document.getElementById('startPosSelect'),

    paramReloadToggleWrap: document.getElementById('paramReloadToggleWrap'),
    includeReloadCheckbox: document.getElementById('includeReloadCheckbox'),
    paramPostReloadShotsWrap: document.getElementById('paramPostReloadShotsWrap'),
    postReloadShotsInput: document.getElementById('postReloadShotsInput'),

    paramTurnAngleWrap: document.getElementById('paramTurnAngleWrap'),
    turnAngleSelect: document.getElementById('turnAngleSelect'),

    paramWalkDirectionWrap: document.getElementById('paramWalkDirectionWrap'),
    walkDirectionSelect: document.getElementById('walkDirectionSelect'),
    paramSecondSignalWrap: document.getElementById('paramSecondSignalWrap'),
    secondSignalDelaySelect: document.getElementById('secondSignalDelaySelect'),

    countdownModeSelect: document.getElementById('countdownModeSelect'),
    paramPaceGuideWrap: document.getElementById('paramPaceGuideWrap'),
    pacedVoiceGuideCheckbox: document.getElementById('pacedVoiceGuideCheckbox'),

    autoRepeatCheckbox: document.getElementById('autoRepeatCheckbox'),
    paramAutoRepeatDelayWrap: document.getElementById('paramAutoRepeatDelayWrap'),
    autoRepeatSecInput: document.getElementById('autoRepeatSecInput'),

    // Audio Tab
    thresholdSlider: document.getElementById('thresholdSlider'),
    thresholdSliderVal: document.getElementById('thresholdSliderVal'),
    debounceSlider: document.getElementById('debounceSlider'),
    debounceSliderVal: document.getElementById('debounceSliderVal'),
    calibrateMicBtn: document.getElementById('calibrateMicBtn'),
    testBeepBtn: document.getElementById('testBeepBtn'),

    enableSpeechRecCheckbox: document.getElementById('enableSpeechRecCheckbox'),
    enableClapStartCheckbox: document.getElementById('enableClapStartCheckbox'),

    signalStyleSelect: document.getElementById('signalStyleSelect'),
    beepFreqSelect: document.getElementById('beepFreqSelect'),
    ttsRateSlider: document.getElementById('ttsRateSlider'),
    ttsRateVal: document.getElementById('ttsRateVal'),
    soundboardGrid: document.getElementById('soundboardGrid'),

    // Logs Tab
    logFilterSelect: document.getElementById('logFilterSelect'),
    statRunsCount: document.getElementById('statRunsCount'),
    statBestFirst: document.getElementById('statBestFirst'),
    statAvgFirst: document.getElementById('statAvgFirst'),
    statBestTotal: document.getElementById('statBestTotal'),
    exportCsvBtn: document.getElementById('exportCsvBtn'),
    clearLogsBtn: document.getElementById('clearLogsBtn'),
    logsListContainer: document.getElementById('logsListContainer')
  };

  // ==========================================
  // 4. PWA & OFFLINE CACHE INITIALIZATION
  // ==========================================
  let deferredInstallPrompt = null;

  function initPWA() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('./sw.js')
        .then(() => {
          updateOnlineStatus();
        })
        .catch((err) => {
          console.warn('ServiceWorker registration warning:', err);
        });
    }

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      el.installPwaBtn.classList.remove('hidden');
    });

    el.installPwaBtn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      el.installPwaBtn.classList.add('hidden');
    });
  }

  function updateOnlineStatus() {
    if (navigator.onLine) {
      el.offlineStatusText.textContent = 'Offline Cache Armed • Online';
    } else {
      el.offlineStatusText.textContent = 'Offline Mode Active (Cached)';
    }
  }

  // ==========================================
  // 5. SCREEN WAKE LOCK (HOLD SCREEN OPEN)
  // ==========================================
  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        state.wakeLockSentinel = await navigator.wakeLock.request('screen');
        state.wakeLockActive = true;
        updateWakeLockUI(true);

        state.wakeLockSentinel.addEventListener('release', () => {
          state.wakeLockActive = false;
          updateWakeLockUI(false);
        });
        return true;
      } catch (err) {
        console.warn('Wake Lock request deferred until interaction:', err.message);
        updateWakeLockUI(false);
        return false;
      }
    } else {
      // Fallback: keep AudioContext running silently so mobile browsers stay awake
      ensureAudioContext();
      state.wakeLockActive = true;
      updateWakeLockUI(true, 'Audio Keep-Awake');
      return true;
    }
  }

  async function toggleWakeLock() {
    if (state.wakeLockActive && state.wakeLockSentinel) {
      await state.wakeLockSentinel.release();
      state.wakeLockSentinel = null;
      state.wakeLockActive = false;
      updateWakeLockUI(false);
    } else {
      await requestWakeLock();
    }
  }

  function updateWakeLockUI(isActive, customLabel) {
    if (isActive) {
      el.wakeLockBtn.className = 'pill pill-on';
      el.wakeLockText.textContent = customLabel || 'Screen Lock: ON';
    } else {
      el.wakeLockBtn.className = 'pill pill-warn';
      el.wakeLockText.textContent = 'Screen Lock: Tap';
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestWakeLock();
    }
  });

  // Automatically arm Wake Lock on first user tap anywhere
  document.addEventListener(
    'pointerdown',
    () => {
      if (!state.wakeLockActive) {
        requestWakeLock();
      }
      ensureAudioContext();
    },
    { once: true }
  );

  // ==========================================
  // 6. WEB AUDIO API: PIEZO BEEPS & GBB MIC DETECTOR
  // ==========================================
  function ensureAudioContext() {
    if (!state.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      state.audioCtx = new AudioContextClass();
    }
    if (state.audioCtx.state === 'suspended') {
      state.audioCtx.resume();
    }
    return state.audioCtx;
  }

  /**
   * Plays a crisp competition shot-timer piezo buzzer or cadence tick.
   * Automatically mutes shot detection while the tone is sounding so the
   * phone speaker does not trigger a false shot.
   */
  function playTimerBeep(durationMs = 220, freqHz = null, gainLevel = 0.65) {
    const ctx = ensureAudioContext();
    const frequency = freqHz || Number(el.beepFreqSelect.value) || 2400;

    // Suppress shot detector during beep + 110ms acoustic ringdown
    const nowMs = performance.now();
    state.muteShotDetectionUntilMs = Math.max(
      state.muteShotDetectionUntilMs,
      nowMs + durationMs + 110
    );

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);

    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(gainLevel, ctx.currentTime + 0.01);
    gain.gain.setValueAtTime(gainLevel, ctx.currentTime + durationMs / 1000 - 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + durationMs / 1000 + 0.01);
  }

  /**
   * Speaks a tactical command using offline-capable Web Speech Synthesis.
   * Mutes GBB shot detector while speaking so voice prompts don't count as shots.
   */
  function speakCue(text, { onEnd = null, playBeepAfter = false } = {}) {
    if (!('speechSynthesis' in window)) {
      if (playBeepAfter) playTimerBeep(240);
      if (onEnd) setTimeout(onEnd, 250);
      return;
    }

    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = parseFloat(el.ttsRateSlider.value) || 1.15;
    utter.pitch = 0.95;
    utter.volume = 1.0;

    // Estimate speech duration for acoustic lockout
    const estimatedMs = Math.max(450, text.length * 65);
    state.isSpeakingTts = true;
    state.muteShotDetectionUntilMs = Math.max(
      state.muteShotDetectionUntilMs,
      performance.now() + estimatedMs + 150
    );

    let finished = false;
    const finishHandler = () => {
      if (finished) return;
      finished = true;
      state.isSpeakingTts = false;
      state.muteShotDetectionUntilMs = Math.max(
        state.muteShotDetectionUntilMs,
        performance.now() + 110
      );
      if (playBeepAfter) {
        playTimerBeep(240);
      }
      if (onEnd) onEnd();
    };

    utter.onend = finishHandler;
    utter.onerror = finishHandler;

    // Safety fallback timeout in case Android TTS engine doesn't fire onend
    setTimeout(finishHandler, estimatedMs + 800);
    window.speechSynthesis.speak(utter);
  }

  /**
   * Fires the primary "GO / FIRE" signal according to user's chosen style
   */
  function triggerGoSignal(customVoiceText = 'Fire!', callbackOnSignalStart = null) {
    const style = el.signalStyleSelect.value; // 'both' | 'beep' | 'voice'
    if (style === 'beep') {
      playTimerBeep(260);
      if (callbackOnSignalStart) callbackOnSignalStart();
    } else if (style === 'voice') {
      if (callbackOnSignalStart) callbackOnSignalStart();
      speakCue(customVoiceText);
    } else {
      // 'both': play crisp competition beep immediately so timer starts at 0.00s, followed by voice callout
      playTimerBeep(240);
      if (callbackOnSignalStart) callbackOnSignalStart();
      speakCue(customVoiceText);
    }
  }

  /**
   * Starts or stops the Web Audio microphone transient detector for GBB shots.
   */
  async function toggleMicDetector(forceEnable = null) {
    if (forceEnable === false || (forceEnable === null && state.micEnabled)) {
      stopMicDetector();
      return false;
    }

    try {
      const ctx = ensureAudioContext();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      state.micStream = stream;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.1;
      source.connect(analyser);

      state.analyser = analyser;
      state.timeDomainData = new Uint8Array(analyser.fftSize);
      state.micEnabled = true;

      el.micToggleBtn.className = 'pill pill-on';
      el.micStatusText.textContent = 'Shot Mic: ON';
      el.calibrateMicBtn.textContent = 'Disable Shot Mic';

      runMicLoop();
      return true;
    } catch (err) {
      console.error('Microphone access denied or unavailable:', err);
      el.activeCueBanner.textContent =
        'Mic permission needed for GBB detection (or use TAP SHOT button).';
      return false;
    }
  }

  function stopMicDetector() {
    if (state.micRafId) {
      cancelAnimationFrame(state.micRafId);
      state.micRafId = null;
    }
    if (state.micStream) {
      state.micStream.getTracks().forEach((t) => t.stop());
      state.micStream = null;
    }
    state.micEnabled = false;
    el.micToggleBtn.className = 'pill pill-off';
    el.micStatusText.textContent = 'Shot Mic: OFF';
    el.calibrateMicBtn.textContent = 'Enable / Test Shot Mic';
    el.meterFill.style.width = '0%';
    el.peakValueLabel.textContent = '0%';
  }

  function runMicLoop() {
    if (!state.micEnabled || !state.analyser) return;

    state.analyser.getByteTimeDomainData(state.timeDomainData);
    let maxDeviation = 0;
    const buf = state.timeDomainData;
    for (let i = 0; i < buf.length; i++) {
      const dev = Math.abs(buf[i] - 128);
      if (dev > maxDeviation) maxDeviation = dev;
    }

    // Normalize 0..128 -> 0..100%
    const peakPercent = Math.min(100, Math.round((maxDeviation / 128) * 100));
    state.currentPeak = peakPercent;

    const nowMs = performance.now();
    if (peakPercent >= state.peakHold || nowMs > state.peakHoldDecayTime) {
      state.peakHold = peakPercent;
      state.peakHoldDecayTime = nowMs + 900;
    }

    // Update UI meter bar
    el.meterFill.style.width = `${peakPercent}%`;
    el.meterPeakHold.style.left = `${Math.min(99, state.peakHold)}%`;
    el.peakValueLabel.textContent = `${peakPercent}%`;

    // Check if peak exceeds shot threshold and isn't locked out by TTS/Beep or GBB debounce
    if (
      peakPercent >= state.thresholdPercent &&
      nowMs > state.muteShotDetectionUntilMs &&
      !state.isSpeakingTts &&
      nowMs - state.lastShotTimestampMs >= state.debounceMs
    ) {
      state.lastShotTimestampMs = nowMs;
      handleAcousticSpikeDetected(nowMs, peakPercent);
    }

    state.micRafId = requestAnimationFrame(runMicLoop);
  }

  function handleAcousticSpikeDetected(nowMs, peakPercent) {
    if (state.phase === 'LIVE') {
      registerShot(nowMs, 'MIC');
    } else if (state.phase === 'WALKING' || state.phase === 'DRAWN_WAITING') {
      // Premature shot before the 2nd signal!
      state.prematureShots++;
      el.activeCueBanner.textContent = `EARLY SHOT DETECTED! Wait for 2nd "Fire!" signal!`;
    } else if (state.phase === 'IDLE' && el.enableClapStartCheckbox.checked) {
      // Check for double-clap (2 spikes within 220ms..700ms) to start drill hands-free offline
      state.clapTimestamps = state.clapTimestamps.filter((t) => nowMs - t < 750);
      state.clapTimestamps.push(nowMs);
      if (state.clapTimestamps.length >= 2) {
        const gap =
          state.clapTimestamps[state.clapTimestamps.length - 1] -
          state.clapTimestamps[state.clapTimestamps.length - 2];
        if (gap >= 160 && gap <= 720) {
          state.clapTimestamps = [];
          el.voiceHeardBanner.innerHTML = `Hands-Free Trigger: <strong>Double-Clap Detected &rarr; Starting Drill!</strong>`;
          startSelectedDrill();
        }
      }
    }
  }

  // ==========================================
  // 7. HANDS-FREE VOICE COMMANDS (WEB SPEECH API)
  // ==========================================
  function toggleVoiceCommands(forceState = null) {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      el.voiceHeardBanner.innerHTML =
        'Browser SpeechRecognition unavailable — <strong>Double-Clap to Start</strong> is active!';
      el.enableSpeechRecCheckbox.checked = false;
      return;
    }

    const shouldEnable =
      forceState !== null ? forceState : !state.voiceCmdEnabled;

    if (!shouldEnable) {
      state.voiceCmdEnabled = false;
      el.enableSpeechRecCheckbox.checked = false;
      if (state.recognition) {
        try {
          state.recognition.stop();
        } catch (_) {}
      }
      el.voiceToggleBtn.className = 'pill pill-off';
      el.voiceStatusText.textContent = 'Voice Cmd: OFF';
      return;
    }

    if (!state.recognition) {
      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';

      rec.onresult = (event) => {
        if (state.isSpeakingTts) return; // Ignore app's own TTS output
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript.trim().toLowerCase();
          if (transcript) {
            processVoiceCommand(transcript);
          }
        }
      };

      rec.onerror = () => {};

      rec.onend = () => {
        if (state.voiceCmdEnabled) {
          setTimeout(() => {
            if (state.voiceCmdEnabled) {
              try {
                rec.start();
              } catch (_) {}
            }
          }, 300);
        }
      };

      state.recognition = rec;
    }

    try {
      state.recognition.start();
      state.voiceCmdEnabled = true;
      el.enableSpeechRecCheckbox.checked = true;
      el.voiceToggleBtn.className = 'pill pill-on';
      el.voiceStatusText.textContent = 'Voice Cmd: ON';
    } catch (err) {
      console.warn('Speech recognition start error:', err);
    }
  }

  let lastVoiceCommandTime = 0;
  function processVoiceCommand(phrase) {
    const now = performance.now();
    if (now - lastVoiceCommandTime < 950) return;

    el.voiceHeardBanner.innerHTML = `Heard: <strong>"${phrase}"</strong>`;

    if (
      phrase.includes('stop') ||
      phrase.includes('cease') ||
      phrase.includes('cancel') ||
      phrase.includes('hold')
    ) {
      lastVoiceCommandTime = now;
      stopDrill('Stopped by voice command');
    } else if (
      state.phase === 'IDLE' &&
      (phrase.includes('start') ||
        phrase.includes('ready') ||
        phrase.includes('standby') ||
        phrase.includes('go') ||
        phrase.includes('repeat') ||
        phrase.includes('again'))
    ) {
      lastVoiceCommandTime = now;
      startSelectedDrill();
    } else if (state.phase === 'IDLE' && phrase.includes('next')) {
      lastVoiceCommandTime = now;
      cycleNextDrill();
    }
  }

  function cycleNextDrill() {
    const keys = Object.keys(DRILL_DEFS);
    const idx = keys.indexOf(state.selectedDrill);
    const nextKey = keys[(idx + 1) % keys.length];
    selectDrill(nextKey);
    speakCue(DRILL_DEFS[nextKey].name);
  }

  // ==========================================
  // 8. DRILL CONFIGURATION & UI UPDATER
  // ==========================================
  function selectDrill(drillId) {
    if (!DRILL_DEFS[drillId]) return;
    state.selectedDrill = drillId;
    const def = DRILL_DEFS[drillId];

    el.drillTiles.forEach((tile) => {
      tile.classList.toggle('active', tile.dataset.drill === drillId);
    });

    el.drillCategoryTag.textContent = def.category;
    el.drillSummaryBox.innerHTML = `<strong>How this drill works:</strong> ${def.summary}`;

    // Configure default inputs per drill
    el.shotsCountInput.value = def.defaultShots;
    el.targetSecondsInput.value = def.defaultTargetSec;

    const isExactDraw = drillId === 'draw_exact';
    const isReloadPreset = drillId === 'reload_drill';
    const isTurned = drillId === 'turned_holster';
    const isWalk = drillId === 'walk_draw_shoot';
    const isContact = drillId === 'contact_callout';

    el.targetSecondsLabel.textContent = isExactDraw
      ? 'Exact Draw Time (# sec)'
      : 'Target Par Time (sec)';
    el.parOrTargetLabel.textContent = isExactDraw ? 'TARGET PACE' : 'PAR / TARGET';
    el.dexterityQuickChips.classList.toggle('hidden', !isExactDraw);
    el.paramPaceGuideWrap.classList.toggle('hidden', !isExactDraw);

    el.paramStartPosWrap.classList.toggle('hidden', !(isReloadPreset || isContact));
    el.paramTurnAngleWrap.classList.toggle('hidden', !isTurned);
    el.paramWalkDirectionWrap.classList.toggle('hidden', !isWalk);
    el.paramSecondSignalWrap.classList.toggle('hidden', !isWalk);

    if (isReloadPreset) {
      el.includeReloadCheckbox.checked = true;
      el.postReloadShotsInput.value = def.defaultPostReloadShots || 2;
    }

    updateReloadVisibility();
    updateExpectedShotsPreview();
  }

  function updateReloadVisibility() {
    const hasReload = el.includeReloadCheckbox.checked;
    el.paramPostReloadShotsWrap.classList.toggle('hidden', !hasReload);
    el.shotsCountLabel.textContent = hasReload
      ? 'Shots Before Reload (#)'
      : 'Shots to Fire (#)';
    updateExpectedShotsPreview();
  }

  function updateExpectedShotsPreview() {
    const preShots = Math.max(1, parseInt(el.shotsCountInput.value, 10) || 1);
    const hasReload = el.includeReloadCheckbox.checked;
    const postShots = hasReload
      ? Math.max(1, parseInt(el.postReloadShotsInput.value, 10) || 1)
      : 0;
    const total = preShots + postShots;
    state.expectedTotalShots = total;
    state.preReloadShots = preShots;
    state.includeReload = hasReload;

    if (state.phase === 'IDLE') {
      el.shotsCounterDisplay.textContent = `0 / ${total}`;
      const targetSec = parseFloat(el.targetSecondsInput.value) || 2.0;
      el.parDeltaDisplay.textContent = `${targetSec.toFixed(2)}s`;
    }
  }

  // ==========================================
  // 9. DRILL EXECUTION ENGINE
  // ==========================================
  function clearAllDrillTimers() {
    state.timers.forEach((id) => clearTimeout(id));
    state.timers = [];
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
  }

  function scheduleTimeout(fn, delayMs) {
    const id = setTimeout(fn, delayMs);
    state.timers.push(id);
    return id;
  }

  async function startSelectedDrill() {
    clearAllDrillTimers();
    ensureAudioContext();
    if (!state.wakeLockActive) {
      requestWakeLock();
    }
    // Automatically enable shot mic if not yet enabled
    if (!state.micEnabled) {
      await toggleMicDetector(true);
    }

    updateExpectedShotsPreview();
    state.shots = [];
    state.prematureShots = 0;
    state.reloadCalled = false;
    state.activeContextLabel = '';

    // Reset UI Display
    el.clockDisplay.innerHTML = `0.00<span class="clock-unit">s</span>`;
    el.shotsCounterDisplay.textContent = `0 / ${state.expectedTotalShots}`;
    el.firstShotDisplay.textContent = '--';
    el.lastSplitDisplay.textContent = '--';
    const targetSec = parseFloat(el.targetSecondsInput.value) || 2.0;
    el.parDeltaDisplay.textContent = `${targetSec.toFixed(2)}s`;
    el.liveSplitsStrip.innerHTML = `<span class="splits-placeholder">Waiting for signal...</span>`;

    el.startDrillBtn.disabled = true;
    el.manualShotBtn.disabled = false;
    el.stopDrillBtn.disabled = false;

    setDrillPhaseUI('COUNTDOWN', 'PREPARING / STANDBY');

    const drillId = state.selectedDrill;
    let prepAnnouncement = '';

    // Build pre-standby orientation/position callout
    if (drillId === 'turned_holster') {
      const turnChoice = resolveTurnAngle();
      state.activeContextLabel = `Turn: ${turnChoice}`;
      prepAnnouncement = `Face ${turnChoice}. `;
    } else if (drillId === 'reload_drill' || drillId === 'contact_callout') {
      const pos = el.startPosSelect.value;
      state.activeContextLabel = pos;
      prepAnnouncement = `${pos}. `;
    } else if (drillId === 'high_ready') {
      state.activeContextLabel = 'High Ready';
    } else if (drillId === 'low_ready') {
      state.activeContextLabel = 'Low Ready';
    } else if (drillId === 'holster_shoot' || drillId === 'draw_exact') {
      state.activeContextLabel = 'Holster';
    }

    // Special flow for Walk & Two-Stage Signal Drill
    if (drillId === 'walk_draw_shoot') {
      runWalkTwoStageDrill();
      return;
    }

    // Standard Countdown / Standby modes
    const mode = el.countdownModeSelect.value;
    if (mode === 'countdown_5' || mode === 'countdown_5_instant') {
      runFiveSecondCountdown(prepAnnouncement, mode === 'countdown_5_instant');
    } else if (mode === 'instant') {
      el.activeCueBanner.textContent = `${prepAnnouncement}Get Ready...`;
      scheduleTimeout(() => beginLiveFirePhase(), 1000);
    } else {
      // "Ready" + Random Standby (1.5s - 3.5s)
      const cueText = `${prepAnnouncement}Shooter Ready... Standby`;
      el.activeCueBanner.textContent = cueText;
      speakCue(cueText, {
        onEnd: () => {
          if (state.phase !== 'COUNTDOWN') return;
          const randomDelayMs = Math.floor(1500 + Math.random() * 2000);
          el.activeCueBanner.textContent = 'Hold... Waiting for Signal...';
          scheduleTimeout(() => beginLiveFirePhase(), randomDelayMs);
        }
      });
    }
  }

  function runFiveSecondCountdown(prepPrefix, immediateFireAfterOne) {
    const startAnnouncement = prepPrefix ? `${prepPrefix}5` : '5';
    const steps = [
      { label: '5...', speak: startAnnouncement },
      { label: '4...', speak: '4' },
      { label: '3...', speak: '3' },
      { label: '2...', speak: '2' },
      { label: '1...', speak: '1' }
    ];

    steps.forEach((step, idx) => {
      scheduleTimeout(() => {
        if (state.phase !== 'COUNTDOWN') return;
        el.activeCueBanner.textContent = `Countdown: ${step.label}`;
        playTimerBeep(70, 1200, 0.3);
        speakCue(step.speak);
      }, idx * 1000);
    });

    scheduleTimeout(() => {
      if (state.phase !== 'COUNTDOWN') return;
      if (immediateFireAfterOne) {
        beginLiveFirePhase();
      } else {
        el.activeCueBanner.textContent = 'Ready... Standby...';
        speakCue('Ready', {
          onEnd: () => {
            if (state.phase !== 'COUNTDOWN') return;
            const randomDelayMs = Math.floor(1200 + Math.random() * 2000);
            scheduleTimeout(() => beginLiveFirePhase(), randomDelayMs);
          }
        });
      }
    }, 5000);
  }

  /**
   * Executes the Walk + 1st Signal (Draw) + 2nd Signal (Fire #) drill
   */
  function runWalkTwoStageDrill() {
    let dir = el.walkDirectionSelect.value;
    if (dir === 'random') {
      dir = Math.random() < 0.5 ? 'Walk Towards Target' : 'Walk Away From Target';
    }
    state.activeContextLabel = dir;
    setDrillPhaseUI('WALKING', 'STAGE 1: WALKING');
    el.activeCueBanner.textContent = `${dir} (Holstered)...`;

    speakCue(`Ready. ${dir}`, {
      onEnd: () => {
        if (state.phase !== 'WALKING') return;
        // Walk for 2.0s - 3.8s before 1st signal ("Draw!")
        const walkTimeMs = Math.floor(2000 + Math.random() * 1800);
        scheduleTimeout(() => {
          if (state.phase !== 'WALKING') return;
          setDrillPhaseUI('DRAWN_WAITING', '1ST SIGNAL: DRAW!');
          state.firstSignalTimestampMs = performance.now();
          el.activeCueBanner.textContent = '1ST SIGNAL: DRAW PISTOL! (Wait for 2nd signal to shoot)';
          playTimerBeep(140, 1500, 0.5);
          speakCue('Draw!');

          // Schedule 2nd signal ("Fire!")
          const delayChoice = el.secondSignalDelaySelect.value;
          const secondDelayMs =
            delayChoice === 'random'
              ? Math.floor(1200 + Math.random() * 1600)
              : Math.round(parseFloat(delayChoice) * 1000);

          scheduleTimeout(() => {
            if (state.phase !== 'DRAWN_WAITING') return;
            beginLiveFirePhase('Fire!');
          }, secondDelayMs);
        }, walkTimeMs);
      }
    });
  }

  function resolveTurnAngle() {
    const val = el.turnAngleSelect.value;
    if (val !== 'random') return val;
    const options = ['90 Left', '90 Right', '180 Rear', '270 Left', '270 Right'];
    return options[Math.floor(Math.random() * options.length)];
  }

  function resolveContactCallout() {
    const directions = [
      'Contact Front!',
      'Contact Left!',
      'Contact Right!',
      'Contact Rear!'
    ];
    return directions[Math.floor(Math.random() * directions.length)];
  }

  /**
   * Transitions into the LIVE timing phase, sounds the Go Signal, and starts the high-precision clock.
   */
  function beginLiveFirePhase(overrideVoiceText = null) {
    const drillId = state.selectedDrill;
    let voiceSignal = overrideVoiceText || 'Fire!';

    if (drillId === 'contact_callout') {
      voiceSignal = resolveContactCallout();
      state.activeContextLabel = `${state.activeContextLabel} • ${voiceSignal}`;
    } else if (drillId === 'turned_holster') {
      voiceSignal = `Turn and Fire!`;
    } else if (drillId === 'draw_exact') {
      const targetSec = parseFloat(el.targetSecondsInput.value) || 3.0;
      voiceSignal = targetSec >= 1.5 ? 'Draw!' : 'Fire!';
    }

    setDrillPhaseUI('LIVE', 'LIVE FIRE — SHOOT!');
    el.activeCueBanner.textContent = `SIGNAL: ${voiceSignal.toUpperCase()}`;
    el.liveSplitsStrip.innerHTML = '';

    triggerGoSignal(voiceSignal, () => {
      state.signalTimestampMs = performance.now();
    });
    if (!state.signalTimestampMs) {
      state.signalTimestampMs = performance.now();
    }

    // If Exact #s Paced Draw drill is selected, schedule pacing ticks & par beep
    const targetSec = parseFloat(el.targetSecondsInput.value) || 3.0;
    if (drillId === 'draw_exact') {
      scheduleExactDrawPacingCues(targetSec);
    } else if (targetSec > 0) {
      // Schedule subtle Par Time marker beep at targetSec if drill is still running
      scheduleTimeout(() => {
        if (state.phase === 'LIVE') {
          playTimerBeep(160, 1000, 0.45);
        }
      }, Math.round(targetSec * 1000));
    }

    startClockAnimationLoop();
  }

  /**
   * For "Draw from holster in exactly # seconds", provides audible pacing ticks/counts
   * so the user can train smooth dexterity across the entire # second window and break
   * the shot right on the final tone.
   */
  function scheduleExactDrawPacingCues(targetSec) {
    if (!el.pacedVoiceGuideCheckbox.checked) {
      // Only play the exact target mark beep at # seconds
      scheduleTimeout(() => {
        if (state.phase === 'LIVE') {
          playTimerBeep(220, 2600, 0.7);
        }
      }, Math.round(targetSec * 1000));
      return;
    }

    const wholeSeconds = Math.floor(targetSec);
    if (wholeSeconds >= 2) {
      for (let s = 1; s < wholeSeconds; s++) {
        const remaining = wholeSeconds - s;
        scheduleTimeout(() => {
          if (state.phase !== 'LIVE') return;
          el.activeCueBanner.textContent = `Pacing Draw... ${remaining}s to Break Shot`;
          playTimerBeep(55, 1400, 0.3);
        }, s * 1000);
      }
    }

    // Play the target mark tone right at # seconds
    scheduleTimeout(() => {
      if (state.phase !== 'LIVE') return;
      el.activeCueBanner.textContent = `TARGET MARK (${targetSec.toFixed(2)}s) — BREAK SHOT!`;
      playTimerBeep(220, 2600, 0.7);
    }, Math.round(targetSec * 1000));
  }

  function startClockAnimationLoop() {
    const tick = () => {
      if (state.phase !== 'LIVE') return;
      const elapsedSec = (performance.now() - state.signalTimestampMs) / 1000;
      el.clockDisplay.innerHTML = `${elapsedSec.toFixed(2)}<span class="clock-unit">s</span>`;
      state.rafId = requestAnimationFrame(tick);
    };
    state.rafId = requestAnimationFrame(tick);
  }

  /**
   * Records a shot from either the GBB Microphone Detector or the Manual "TAP SHOT" button.
   */
  function registerShot(timestampMs = performance.now(), source = 'MIC') {
    if (state.phase !== 'LIVE') return;

    const elapsedSec = Math.max(0.01, (timestampMs - state.signalTimestampMs) / 1000);
    const shotNumber = state.shots.length + 1;
    const prevElapsed =
      shotNumber === 1 ? 0 : state.shots[state.shots.length - 1].elapsedSec;
    const splitSec = elapsedSec - prevElapsed;

    const isReloadSplit =
      state.includeReload && shotNumber === state.preReloadShots + 1;

    const shotRecord = {
      shotNumber,
      elapsedSec: Number(elapsedSec.toFixed(2)),
      splitSec: Number(splitSec.toFixed(2)),
      isReloadSplit,
      source
    };

    state.shots.push(shotRecord);

    // Update live metrics
    el.clockDisplay.innerHTML = `${shotRecord.elapsedSec.toFixed(2)}<span class="clock-unit">s</span>`;
    el.shotsCounterDisplay.textContent = `${shotNumber} / ${state.expectedTotalShots}`;

    if (shotNumber === 1) {
      el.firstShotDisplay.textContent = `${shotRecord.elapsedSec.toFixed(2)}s`;
    }
    el.lastSplitDisplay.textContent =
      shotNumber === 1
        ? `${shotRecord.elapsedSec.toFixed(2)}s`
        : `+${shotRecord.splitSec.toFixed(2)}s`;

    // Render split chip
    const chip = document.createElement('span');
    chip.className = `split-chip${isReloadSplit ? ' reload-chip' : ''}`;
    chip.textContent = isReloadSplit
      ? `#${shotNumber} RELOAD: ${shotRecord.elapsedSec.toFixed(2)}s (+${shotRecord.splitSec.toFixed(2)}s)`
      : `#${shotNumber}: ${shotRecord.elapsedSec.toFixed(2)}s (${shotNumber === 1 ? '1st' : '+' + shotRecord.splitSec.toFixed(2) + 's'})`;
    el.liveSplitsStrip.appendChild(chip);

    // Check if it's time to call out "RELOAD!"
    if (
      state.includeReload &&
      !state.reloadCalled &&
      shotNumber === state.preReloadShots &&
      shotNumber < state.expectedTotalShots
    ) {
      state.reloadCalled = true;
      el.activeCueBanner.textContent = 'RELOAD! Perform Speed Reload & Fire Follow-Up Shots!';
      speakCue('Reload!');
      return;
    }

    // Check if drill string is complete
    if (shotNumber >= state.expectedTotalShots) {
      completeDrillRun();
    }
  }

  function completeDrillRun() {
    clearAllDrillTimers();
    state.phase = 'IDLE';

    const lastShot = state.shots[state.shots.length - 1];
    const totalSec = lastShot ? lastShot.elapsedSec : 0;
    const firstShotSec = state.shots[0] ? state.shots[0].elapsedSec : 0;
    const targetSec = parseFloat(el.targetSecondsInput.value) || 2.0;
    const deltaSec = totalSec - targetSec;
    const deltaSign = deltaSec >= 0 ? '+' : '';

    el.clockDisplay.innerHTML = `${totalSec.toFixed(2)}<span class="clock-unit">s</span>`;
    el.parDeltaDisplay.textContent = `${deltaSign}${deltaSec.toFixed(2)}s`;
    el.parDeltaDisplay.style.color =
      state.selectedDrill === 'draw_exact'
        ? Math.abs(deltaSec) <= 0.18
          ? 'var(--accent-green)'
          : 'var(--accent-amber)'
        : deltaSec <= 0
          ? 'var(--accent-green)'
          : 'var(--accent-amber)';

    setDrillPhaseUI('IDLE', 'DRILL COMPLETE');

    if (state.selectedDrill === 'draw_exact') {
      el.activeCueBanner.textContent = `Target: ${targetSec.toFixed(2)}s | Actual: ${totalSec.toFixed(2)}s | Error: ${deltaSign}${deltaSec.toFixed(2)}s`;
    } else {
      el.activeCueBanner.textContent = `Complete! Total: ${totalSec.toFixed(2)}s | 1st Shot: ${firstShotSec.toFixed(2)}s`;
    }

    el.startDrillBtn.disabled = false;
    el.manualShotBtn.disabled = true;
    el.stopDrillBtn.disabled = true;

    // Save to persistent drill log
    saveCompletedRunToLog({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      timestampIso: new Date().toISOString(),
      drillId: state.selectedDrill,
      drillName: DRILL_DEFS[state.selectedDrill].name,
      contextLabel: state.activeContextLabel,
      expectedShots: state.expectedTotalShots,
      includeReload: state.includeReload,
      targetSec: Number(targetSec.toFixed(2)),
      firstShotSec: Number(firstShotSec.toFixed(2)),
      totalSec: Number(totalSec.toFixed(2)),
      deltaSec: Number(deltaSec.toFixed(2)),
      prematureShots: state.prematureShots,
      shots: state.shots
    });

    // If Hands-Free Auto-Repeat Loop is enabled, schedule next run automatically
    if (el.autoRepeatCheckbox.checked) {
      const restSec = Math.max(3, parseInt(el.autoRepeatSecInput.value, 10) || 8);
      el.activeCueBanner.textContent += ` • Next rep in ${restSec}s...`;
      scheduleTimeout(() => {
        if (state.phase === 'IDLE' && el.autoRepeatCheckbox.checked) {
          startSelectedDrill();
        }
      }, restSec * 1000);
    }
  }

  function stopDrill(reason = 'Drill Stopped') {
    clearAllDrillTimers();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    state.isSpeakingTts = false;

    // If user had already fired at least 1 shot before pressing Stop, offer to log partial run
    if (state.phase === 'LIVE' && state.shots.length > 0) {
      completeDrillRun();
      return;
    }

    state.phase = 'IDLE';
    setDrillPhaseUI('IDLE', 'STANDBY / IDLE');
    el.activeCueBanner.textContent = reason;
    el.startDrillBtn.disabled = false;
    el.manualShotBtn.disabled = true;
    el.stopDrillBtn.disabled = true;
  }

  function setDrillPhaseUI(phase, badgeText) {
    state.phase = phase;
    el.drillPhaseBadge.textContent = badgeText;
    el.timerCard.classList.remove('phase-standby', 'phase-live');
    if (phase === 'COUNTDOWN' || phase === 'WALKING' || phase === 'DRAWN_WAITING') {
      el.timerCard.classList.add('phase-standby');
    } else if (phase === 'LIVE') {
      el.timerCard.classList.add('phase-live');
    }
  }

  // ==========================================
  // 10. PERSISTENT LOGGING & ANALYTICS
  // ==========================================
  function loadLogsFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LOGS);
      state.logs = raw ? JSON.parse(raw) : [];
    } catch (e) {
      state.logs = [];
    }
    renderLogsAndStats();
  }

  function saveCompletedRunToLog(entry) {
    state.logs.unshift(entry);
    if (state.logs.length > 500) {
      state.logs.length = 500;
    }
    try {
      localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(state.logs));
    } catch (e) {
      console.warn('Could not save logs to localStorage:', e);
    }
    renderLogsAndStats();
  }

  function renderLogsAndStats() {
    el.logCountBadge.textContent = state.logs.length;
    const filter = el.logFilterSelect.value;
    const filtered =
      filter === 'all'
        ? state.logs
        : state.logs.filter((l) => l.drillId === filter);

    el.statRunsCount.textContent = filtered.length;

    if (filtered.length === 0) {
      el.statBestFirst.textContent = '--';
      el.statAvgFirst.textContent = '--';
      el.statBestTotal.textContent = '--';
      el.logsListContainer.innerHTML = `<div class="card"><p class="helper-text" style="margin:0;text-align:center;">No logged runs yet. Complete a drill to see detailed shot timings and splits here.</p></div>`;
      return;
    }

    const firstShots = filtered.map((l) => l.firstShotSec).filter((n) => n > 0);
    const totals = filtered.map((l) => l.totalSec).filter((n) => n > 0);

    const bestFirst = Math.min(...firstShots);
    const avgFirst =
      firstShots.reduce((acc, v) => acc + v, 0) / (firstShots.length || 1);
    const bestTotal = Math.min(...totals);

    el.statBestFirst.textContent = `${bestFirst.toFixed(2)}s`;
    el.statAvgFirst.textContent = `${avgFirst.toFixed(2)}s`;
    el.statBestTotal.textContent = `${bestTotal.toFixed(2)}s`;

    el.logsListContainer.innerHTML = '';
    filtered.forEach((log) => {
      const card = document.createElement('div');
      card.className = 'log-item';

      const dateStr = new Date(log.timestampIso).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      const deltaSign = log.deltaSec >= 0 ? '+' : '';
      const splitsHtml = (log.shots || [])
        .map((s) => {
          const cls = s.isReloadSplit ? 'split-chip reload-chip' : 'split-chip';
          const tag = s.isReloadSplit
            ? `#${s.shotNumber} RELOAD: ${s.elapsedSec.toFixed(2)}s (+${s.splitSec.toFixed(2)}s)`
            : `#${s.shotNumber}: ${s.elapsedSec.toFixed(2)}s (${s.shotNumber === 1 ? '1st' : '+' + s.splitSec.toFixed(2) + 's'})`;
          return `<span class="${cls}">${tag}</span>`;
        })
        .join('');

      card.innerHTML = `
        <div class="log-item-top">
          <div>
            <span class="log-drill-title">${log.drillName}</span>
            ${log.contextLabel ? `<span class="badge-subtle" style="margin-left:0.35rem;">${log.contextLabel}</span>` : ''}
          </div>
          <div>
            <span class="log-timestamp">${dateStr}</span>
            <button type="button" class="log-delete-btn" data-delete-id="${log.id}" title="Delete Log">&times;</button>
          </div>
        </div>
        <div class="log-metrics-row">
          <span><strong>Total:</strong> ${log.totalSec.toFixed(2)}s</span>
          <span><strong>1st Shot:</strong> ${log.firstShotSec.toFixed(2)}s</span>
          <span><strong>Target/Par:</strong> ${log.targetSec.toFixed(2)}s (${deltaSign}${log.deltaSec.toFixed(2)}s)</span>
          <span><strong>Shots:</strong> ${log.shots.length}</span>
        </div>
        <div class="splits-strip" style="margin-bottom:0;justify-content:flex-start;">
          ${splitsHtml}
        </div>
      `;

      el.logsListContainer.appendChild(card);
    });
  }

  function exportLogsToCsv() {
    if (state.logs.length === 0) return;
    const headers = [
      'Timestamp',
      'Drill',
      'Context',
      'TotalShots',
      'FirstShotSec',
      'TotalSec',
      'TargetParSec',
      'DeltaSec',
      'SplitsSummary'
    ];
    const rows = state.logs.map((l) => {
      const splitsStr = (l.shots || [])
        .map(
          (s) =>
            `#${s.shotNumber}:${s.elapsedSec.toFixed(2)}s(+${s.splitSec.toFixed(2)}s${s.isReloadSplit ? '-RELOAD' : ''})`
        )
        .join(' | ');
      return [
        l.timestampIso,
        `"${l.drillName}"`,
        `"${l.contextLabel || ''}"`,
        l.shots.length,
        l.firstShotSec.toFixed(2),
        l.totalSec.toFixed(2),
        l.targetSec.toFixed(2),
        l.deltaSec.toFixed(2),
        `"${splitsStr}"`
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `airsoft-drill-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ==========================================
  // 11. EVENT LISTENERS & UI BINDINGS
  // ==========================================
  function bindEvents() {
    // Top Status Pills
    el.wakeLockBtn.addEventListener('click', toggleWakeLock);
    el.micToggleBtn.addEventListener('click', () => toggleMicDetector());
    el.voiceToggleBtn.addEventListener('click', () => toggleVoiceCommands());

    // Tab Navigation
    el.tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.tab;
        el.tabBtns.forEach((b) => b.classList.toggle('active', b === btn));
        el.tabPanels.forEach((p) => p.classList.toggle('active', p.id === targetId));
      });
    });

    // Drill Selector Tiles
    el.drillTiles.forEach((tile) => {
      tile.addEventListener('click', () => {
        if (state.phase !== 'IDLE') stopDrill('Switched drill');
        selectDrill(tile.dataset.drill);
      });
    });

    // Stepper +/- Buttons
    document.querySelectorAll('.step-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.stepTarget);
        if (!input) return;
        const step = parseFloat(btn.dataset.step) || 1;
        const min = parseFloat(input.min) || 0.1;
        const max = parseFloat(input.max) || 100;
        const current = parseFloat(input.value) || min;
        const nextVal = Math.min(max, Math.max(min, Number((current + step).toFixed(2))));
        input.value = nextVal;
        updateExpectedShotsPreview();
      });
    });

    // Dexterity Quick Time Chips
    el.dexterityQuickChips.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        el.targetSecondsInput.value = chip.dataset.setTime;
        updateExpectedShotsPreview();
      });
    });

    // Parameter Changes
    el.targetSecondsInput.addEventListener('change', updateExpectedShotsPreview);
    el.shotsCountInput.addEventListener('change', updateExpectedShotsPreview);
    el.postReloadShotsInput.addEventListener('change', updateExpectedShotsPreview);
    el.includeReloadCheckbox.addEventListener('change', updateReloadVisibility);

    el.autoRepeatCheckbox.addEventListener('change', () => {
      el.paramAutoRepeatDelayWrap.classList.toggle(
        'hidden',
        !el.autoRepeatCheckbox.checked
      );
    });

    // Primary Timer Controls
    el.startDrillBtn.addEventListener('click', startSelectedDrill);
    el.manualShotBtn.addEventListener('click', () =>
      registerShot(performance.now(), 'TAP')
    );
    el.stopDrillBtn.addEventListener('click', () => stopDrill('Drill stopped'));

    // Audio & Mic Settings
    el.thresholdSlider.addEventListener('input', () => {
      const val = parseInt(el.thresholdSlider.value, 10);
      state.thresholdPercent = val;
      el.thresholdSliderVal.textContent = `${val}%`;
      el.thresholdValueLabel.textContent = `${val}%`;
      el.meterThresholdLine.style.left = `${val}%`;
    });

    el.debounceSlider.addEventListener('input', () => {
      const val = parseInt(el.debounceSlider.value, 10);
      state.debounceMs = val;
      el.debounceSliderVal.textContent = `${val} ms`;
    });

    el.calibrateMicBtn.addEventListener('click', () => toggleMicDetector());
    el.testBeepBtn.addEventListener('click', () => playTimerBeep(240));

    el.enableSpeechRecCheckbox.addEventListener('change', () => {
      toggleVoiceCommands(el.enableSpeechRecCheckbox.checked);
    });

    el.ttsRateSlider.addEventListener('input', () => {
      el.ttsRateVal.textContent = `${parseFloat(el.ttsRateSlider.value).toFixed(2)}x`;
    });

    // Soundboard Callout Buttons
    el.soundboardGrid.querySelectorAll('.sb-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const phrase = btn.dataset.say;
        const withBeep = btn.dataset.beep === 'true';
        if (withBeep) {
          playTimerBeep(220);
        }
        speakCue(phrase);
      });
    });

    // Logs Tab Actions
    el.logFilterSelect.addEventListener('change', renderLogsAndStats);
    el.exportCsvBtn.addEventListener('click', exportLogsToCsv);
    el.clearLogsBtn.addEventListener('click', () => {
      if (state.logs.length === 0) return;
      state.logs = [];
      localStorage.removeItem(STORAGE_KEYS.LOGS);
      renderLogsAndStats();
    });

    el.logsListContainer.addEventListener('click', (e) => {
      const delBtn = e.target.closest('[data-delete-id]');
      if (!delBtn) return;
      const id = delBtn.dataset.deleteId;
      state.logs = state.logs.filter((l) => l.id !== id);
      localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(state.logs));
      renderLogsAndStats();
    });
  }

  // ==========================================
  // 12. BOOTSTRAP
  // ==========================================
  function init() {
    initPWA();
    bindEvents();
    loadLogsFromStorage();
    selectDrill('draw_exact');
  }

  init();
})();

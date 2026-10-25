/**
 * Tactical Airsoft Shot Timer & Drill Trainer
 * Offline-First PWA with Wake Lock, Web Audio GBB Shot Detection,
 * Hands-Free Voice / Clap Commands, Pre-Drill Shooter State + Action Briefing,
 * Multi-Drill Queue Builder, and Split Logging.
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
      defaultShots: 2,
      defaultTargetSec: 3.0
    },
    holster_shoot: {
      id: 'holster_shoot',
      name: 'Holster Shoot #',
      category: 'Holster Speed',
      defaultShots: 2,
      defaultTargetSec: 2.0
    },
    high_ready: {
      id: 'high_ready',
      name: 'High Ready Shoot #',
      category: 'Ready Position',
      defaultShots: 2,
      defaultTargetSec: 1.2
    },
    low_ready: {
      id: 'low_ready',
      name: 'Low Ready Shoot #',
      category: 'Ready Position',
      defaultShots: 2,
      defaultTargetSec: 1.3
    },
    reload_drill: {
      id: 'reload_drill',
      name: 'Shoot # + Reload + #',
      category: 'Reload Transitions',
      defaultShots: 2,
      defaultPostReloadShots: 2,
      defaultTargetSec: 4.5
    },
    turned_holster: {
      id: 'turned_holster',
      name: 'Turned Away (90°/180°/270°)',
      category: 'Pivot & Engage',
      defaultShots: 2,
      defaultTargetSec: 2.5
    },
    walk_draw_shoot: {
      id: 'walk_draw_shoot',
      name: 'Walk: 1st Signal Draw, 2nd Shoot #',
      category: 'Movement & Two-Stage Signal',
      defaultShots: 2,
      defaultTargetSec: 1.8
    },
    contact_callout: {
      id: 'contact_callout',
      name: 'Contact Threat Callout',
      category: 'Reaction & Threat ID',
      defaultShots: 2,
      defaultTargetSec: 2.0
    }
  };

  // ==========================================
  // 2. APPLICATION STATE
  // ==========================================
  const state = {
    // Builder form selection
    builderDrillId: 'draw_exact',

    // Drill Queue & Active Queue Index
    queue: [],
    activeQueueIndex: 0,

    // Active run execution state
    phase: 'IDLE', // 'IDLE' | 'BRIEFING' | 'COUNTDOWN' | 'WALKING' | 'DRAWN_WAITING' | 'LIVE'
    timers: [],
    rafId: null,
    activeRunConfig: null, // Resolved drill config for current run

    // Run timing metrics
    signalTimestampMs: 0,
    firstSignalTimestampMs: 0,
    prematureShots: 0,
    shots: [],
    expectedTotalShots: 2,
    preReloadShots: 2,
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
    QUEUE: 'airsoft_trainer_queue_v1'
  };

  // ==========================================
  // 3. DOM ELEMENTS
  // ==========================================
  const el = {
    // Top bar & Navigation Drawer
    menuToggleBtn: document.getElementById('menuToggleBtn'),
    navBackdrop: document.getElementById('navBackdrop'),
    navDrawer: document.getElementById('navDrawer'),
    closeDrawerBtn: document.getElementById('closeDrawerBtn'),
    drawerLinks: document.querySelectorAll('.drawer-link'),
    viewPanels: document.querySelectorAll('.view-panel'),
    offlineStatusText: document.getElementById('offlineStatusText'),
    installPwaBtn: document.getElementById('installPwaBtn'),

    // Top Mic & Wake Lock Widgets
    micQuickToggleBtn: document.getElementById('micQuickToggleBtn'),
    micShortText: document.getElementById('micShortText'),
    meterFill: document.getElementById('meterFill'),
    meterPeakHold: document.getElementById('meterPeakHold'),
    meterThresholdLine: document.getElementById('meterThresholdLine'),
    peakValueLabel: document.getElementById('peakValueLabel'),
    voiceQuickBadge: document.getElementById('voiceQuickBadge'),
    wakeLockBtn: document.getElementById('wakeLockBtn'),
    wakeLockText: document.getElementById('wakeLockText'),

    queueCountNavBadge: document.getElementById('queueCountNavBadge'),
    logCountBadge: document.getElementById('logCountBadge'),

    // View 1: Shot Timer
    timerCard: document.getElementById('timerCard'),
    drillPhaseBadge: document.getElementById('drillPhaseBadge'),
    queueProgressPill: document.getElementById('queueProgressPill'),
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

    currentDrillTitleDisplay: document.getElementById('currentDrillTitleDisplay'),
    quickExplainToggle: document.getElementById('quickExplainToggle'),
    currentDrillBriefingDisplay: document.getElementById('currentDrillBriefingDisplay'),
    prevQueueBtn: document.getElementById('prevQueueBtn'),
    openDrillsMenuBtn: document.getElementById('openDrillsMenuBtn'),
    timerQueueCountLabel: document.getElementById('timerQueueCountLabel'),
    nextQueueBtn: document.getElementById('nextQueueBtn'),

    // View 2: Drills & Queue Builder
    queueTotalBadge: document.getElementById('queueTotalBadge'),
    autoAdvanceQueueCheckbox: document.getElementById('autoAdvanceQueueCheckbox'),
    autoRepeatCheckbox: document.getElementById('autoRepeatCheckbox'),
    paramAutoRepeatDelayWrap: document.getElementById('paramAutoRepeatDelayWrap'),
    autoRepeatSecInput: document.getElementById('autoRepeatSecInput'),
    drillQueueList: document.getElementById('drillQueueList'),
    loadSampleQueueBtn: document.getElementById('loadSampleQueueBtn'),
    clearQueueBtn: document.getElementById('clearQueueBtn'),

    drillCategoryTag: document.getElementById('drillCategoryTag'),
    drillTiles: document.querySelectorAll('.drill-tile'),
    builderBriefingText: document.getElementById('builderBriefingText'),
    testBriefingSpeakBtn: document.getElementById('testBriefingSpeakBtn'),

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

    paramPaceGuideWrap: document.getElementById('paramPaceGuideWrap'),
    pacedVoiceGuideCheckbox: document.getElementById('pacedVoiceGuideCheckbox'),

    addToQueueBtn: document.getElementById('addToQueueBtn'),
    useSingleDrillBtn: document.getElementById('useSingleDrillBtn'),

    // View 3: Settings & Audio
    announceDrillExplanationCheckbox: document.getElementById(
      'announceDrillExplanationCheckbox'
    ),
    countdownModeSelect: document.getElementById('countdownModeSelect'),
    thresholdSlider: document.getElementById('thresholdSlider'),
    thresholdSliderVal: document.getElementById('thresholdSliderVal'),
    debounceSlider: document.getElementById('debounceSlider'),
    debounceSliderVal: document.getElementById('debounceSliderVal'),
    calibrateMicBtn: document.getElementById('calibrateMicBtn'),
    testBeepBtn: document.getElementById('testBeepBtn'),

    enableSpeechRecCheckbox: document.getElementById('enableSpeechRecCheckbox'),
    enableClapStartCheckbox: document.getElementById('enableClapStartCheckbox'),
    voiceHeardBanner: document.getElementById('voiceHeardBanner'),

    signalStyleSelect: document.getElementById('signalStyleSelect'),
    beepFreqSelect: document.getElementById('beepFreqSelect'),
    ttsRateSlider: document.getElementById('ttsRateSlider'),
    ttsRateVal: document.getElementById('ttsRateVal'),
    soundboardGrid: document.getElementById('soundboardGrid'),

    // View 4: Logs
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
  // 4. SPOKEN DRILL BRIEFING GENERATOR
  //    (Always starts with Shooter State -> Action)
  // ==========================================
  function formatShotCountPhrase(count) {
    const n = Number(count) || 1;
    return n === 1 ? '1 shot' : `${n} shots`;
  }

  function formatSecondsPhrase(sec) {
    const n = Number(sec) || 1;
    if (Number.isInteger(n)) {
      return n === 1 ? '1 second' : `${n} seconds`;
    }
    return `${n} seconds`;
  }

  /**
   * Builds the Shooter State + Action explanation for any drill item.
   * When resolveRandoms is true (at the start of an actual drill run),
   * random turn angles or walk directions are resolved into concrete instructions.
   */
  function generateDrillBriefing(item, resolveRandoms = false) {
    const drillId = item.drillId;
    const shotsPhrase = formatShotCountPhrase(item.shots);
    const reloadClause = item.includeReload
      ? `, reload, and fire ${formatShotCountPhrase(item.postReloadShots)}`
      : '';

    let resolvedTurn = item.turnAngle || '90 degrees left';
    if (drillId === 'turned_holster' && item.turnAngle === 'random') {
      if (resolveRandoms) {
        const opts = [
          '90 degrees left',
          '90 degrees right',
          '180 degrees away from target',
          '270 degrees left',
          '270 degrees right'
        ];
        resolvedTurn = opts[Math.floor(Math.random() * opts.length)];
      } else {
        resolvedTurn = 'turned away from target';
      }
    }

    let resolvedWalk = item.walkDirection || 'walking towards target';
    if (drillId === 'walk_draw_shoot' && item.walkDirection === 'random') {
      if (resolveRandoms) {
        resolvedWalk =
          Math.random() < 0.5
            ? 'walking towards target'
            : 'walking away from target';
      } else {
        resolvedWalk = 'walking towards or away from target';
      }
    }

    let shooterState = 'Holstered, facing target';
    let actionText = `on signal, draw the weapon and fire ${shotsPhrase}${reloadClause}`;

    switch (drillId) {
      case 'draw_exact': {
        shooterState = 'Holstered, facing target';
        const secPhrase = formatSecondsPhrase(item.targetSec);
        actionText = `Draw the weapon in ${secPhrase} and fire ${shotsPhrase}${reloadClause}`;
        break;
      }
      case 'holster_shoot': {
        shooterState = 'Holstered, facing target';
        actionText = `On signal, draw the weapon and fire ${shotsPhrase}${reloadClause}`;
        break;
      }
      case 'high_ready': {
        shooterState = 'High ready, facing target';
        actionText = `On signal, present the weapon and fire ${shotsPhrase}${reloadClause}`;
        break;
      }
      case 'low_ready': {
        shooterState = 'Low ready, facing target';
        actionText = `On signal, raise the weapon and fire ${shotsPhrase}${reloadClause}`;
        break;
      }
      case 'reload_drill': {
        const pos = item.startPos || 'Holstered';
        shooterState = `${pos}, facing target`;
        const drawVerb =
          pos === 'Holstered' ? 'draw the weapon and fire' : 'present the weapon and fire';
        actionText = `On signal, ${drawVerb} ${shotsPhrase}, reload, and fire ${formatShotCountPhrase(item.postReloadShots || 2)}`;
        break;
      }
      case 'turned_holster': {
        shooterState =
          resolvedTurn === 'turned away from target'
            ? 'Holstered, turned away from target'
            : `Holstered, turned ${resolvedTurn}`;
        actionText = `On signal, turn to target, draw the weapon, and fire ${shotsPhrase}${reloadClause}`;
        break;
      }
      case 'walk_draw_shoot': {
        shooterState = `Holstered, ${resolvedWalk}`;
        actionText = `At first signal draw the weapon, at second signal fire ${shotsPhrase}${reloadClause}`;
        break;
      }
      case 'contact_callout': {
        const pos = item.startPos || 'Holstered';
        shooterState = `${pos}, scanning for contact`;
        actionText = `On threat callout, orient to threat and fire ${shotsPhrase}${reloadClause}`;
        break;
      }
    }

    const fullBriefing = `${shooterState}. ${actionText}.`;
    return {
      shooterState,
      actionText,
      fullBriefing,
      resolvedTurn,
      resolvedWalk
    };
  }

  // ==========================================
  // 5. NAVIGATION DRAWER & VIEW SWITCHING
  // ==========================================
  function openDrawer() {
    el.navBackdrop.classList.remove('hidden');
    el.navDrawer.classList.remove('hidden');
  }

  function closeDrawer() {
    el.navBackdrop.classList.add('hidden');
    el.navDrawer.classList.add('hidden');
  }

  function switchView(viewId) {
    el.viewPanels.forEach((p) => p.classList.toggle('active', p.id === viewId));
    el.drawerLinks.forEach((l) =>
      l.classList.toggle('active', l.dataset.view === viewId)
    );
    closeDrawer();
  }

  // ==========================================
  // 6. PWA & OFFLINE CACHE INITIALIZATION
  // ==========================================
  let deferredInstallPrompt = null;

  function initPWA() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('./sw.js')
        .then(() => updateOnlineStatus())
        .catch((err) => console.warn('ServiceWorker warning:', err));
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
  // 7. SCREEN WAKE LOCK (HOLD SCREEN OPEN)
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
        updateWakeLockUI(false);
        return false;
      }
    } else {
      ensureAudioContext();
      state.wakeLockActive = true;
      updateWakeLockUI(true);
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

  function updateWakeLockUI(isActive) {
    if (isActive) {
      el.wakeLockBtn.className = 'icon-badge badge-on';
      el.wakeLockText.textContent = 'AWAKE';
    } else {
      el.wakeLockBtn.className = 'icon-badge badge-warn';
      el.wakeLockText.textContent = 'LOCK';
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestWakeLock();
    }
  });

  document.addEventListener(
    'pointerdown',
    () => {
      if (!state.wakeLockActive) requestWakeLock();
      ensureAudioContext();
    },
    { once: true }
  );

  // ==========================================
  // 8. WEB AUDIO API: PIEZO BEEPS & GBB MIC DETECTOR
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

  function playTimerBeep(durationMs = 220, freqHz = null, gainLevel = 0.65) {
    const ctx = ensureAudioContext();
    const frequency = freqHz || Number(el.beepFreqSelect.value) || 2400;

    const nowMs = performance.now();
    state.muteShotDetectionUntilMs = Math.max(
      state.muteShotDetectionUntilMs,
      nowMs + durationMs + 115
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

  function speakCue(text, { onEnd = null, playBeepAfter = false } = {}) {
    if (!('speechSynthesis' in window)) {
      if (playBeepAfter) playTimerBeep(240);
      if (onEnd) setTimeout(onEnd, 250);
      return;
    }

    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = parseFloat(el.ttsRateSlider.value) || 1.1;
    utter.pitch = 0.96;
    utter.volume = 1.0;

    const estimatedMs = Math.max(500, text.length * 68);
    state.isSpeakingTts = true;
    state.muteShotDetectionUntilMs = Math.max(
      state.muteShotDetectionUntilMs,
      performance.now() + estimatedMs + 180
    );

    let finished = false;
    const finishHandler = () => {
      if (finished) return;
      finished = true;
      state.isSpeakingTts = false;
      state.muteShotDetectionUntilMs = Math.max(
        state.muteShotDetectionUntilMs,
        performance.now() + 120
      );
      if (playBeepAfter) playTimerBeep(240);
      if (onEnd) onEnd();
    };

    utter.onend = finishHandler;
    utter.onerror = finishHandler;

    setTimeout(finishHandler, estimatedMs + 1100);
    window.speechSynthesis.speak(utter);
  }

  function triggerGoSignal(customVoiceText = 'Fire!', callbackOnSignalStart = null) {
    const style = el.signalStyleSelect.value;
    if (style === 'beep') {
      playTimerBeep(260);
      if (callbackOnSignalStart) callbackOnSignalStart();
    } else if (style === 'voice') {
      if (callbackOnSignalStart) callbackOnSignalStart();
      speakCue(customVoiceText);
    } else {
      playTimerBeep(240);
      if (callbackOnSignalStart) callbackOnSignalStart();
      speakCue(customVoiceText);
    }
  }

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

      el.micQuickToggleBtn.className = 'mic-pill pill-on';
      el.micShortText.textContent = 'MIC ON';
      el.calibrateMicBtn.textContent = 'Disable Shot Mic';

      runMicLoop();
      return true;
    } catch (err) {
      console.error('Microphone access denied:', err);
      el.activeCueBanner.textContent =
        'Mic permission needed for GBB detection (or use TAP SHOT).';
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
    el.micQuickToggleBtn.className = 'mic-pill pill-off';
    el.micShortText.textContent = 'MIC OFF';
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

    const peakPercent = Math.min(100, Math.round((maxDeviation / 128) * 100));
    state.currentPeak = peakPercent;

    const nowMs = performance.now();
    if (peakPercent >= state.peakHold || nowMs > state.peakHoldDecayTime) {
      state.peakHold = peakPercent;
      state.peakHoldDecayTime = nowMs + 900;
    }

    el.meterFill.style.width = `${peakPercent}%`;
    el.meterPeakHold.style.left = `${Math.min(99, state.peakHold)}%`;
    el.peakValueLabel.textContent = `${peakPercent}%`;

    if (
      peakPercent >= state.thresholdPercent &&
      nowMs > state.muteShotDetectionUntilMs &&
      !state.isSpeakingTts &&
      nowMs - state.lastShotTimestampMs >= state.debounceMs
    ) {
      state.lastShotTimestampMs = nowMs;
      handleAcousticSpikeDetected(nowMs);
    }

    state.micRafId = requestAnimationFrame(runMicLoop);
  }

  function handleAcousticSpikeDetected(nowMs) {
    if (state.phase === 'LIVE') {
      registerShot(nowMs, 'MIC');
    } else if (state.phase === 'WALKING' || state.phase === 'DRAWN_WAITING') {
      state.prematureShots++;
      el.activeCueBanner.textContent = `EARLY SHOT DETECTED! Wait for 2nd "Fire!" signal!`;
    } else if (state.phase === 'IDLE' && el.enableClapStartCheckbox.checked) {
      state.clapTimestamps = state.clapTimestamps.filter((t) => nowMs - t < 750);
      state.clapTimestamps.push(nowMs);
      if (state.clapTimestamps.length >= 2) {
        const gap =
          state.clapTimestamps[state.clapTimestamps.length - 1] -
          state.clapTimestamps[state.clapTimestamps.length - 2];
        if (gap >= 160 && gap <= 720) {
          state.clapTimestamps = [];
          startActiveQueuedDrill();
        }
      }
    }
  }

  // ==========================================
  // 9. HANDS-FREE VOICE COMMANDS
  // ==========================================
  function updateHandsFreeQuickBadge() {
    if (state.voiceCmdEnabled) {
      el.voiceQuickBadge.textContent = 'Voice: ON';
    } else if (el.enableClapStartCheckbox.checked) {
      el.voiceQuickBadge.textContent = 'Clap: ON';
    } else {
      el.voiceQuickBadge.textContent = 'Manual';
    }
  }

  function toggleVoiceCommands(forceState = null) {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      el.voiceHeardBanner.innerHTML =
        'SpeechRecognition unavailable — <strong>Double-Clap to Start</strong> is active!';
      el.enableSpeechRecCheckbox.checked = false;
      updateHandsFreeQuickBadge();
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
      updateHandsFreeQuickBadge();
      return;
    }

    if (!state.recognition) {
      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';

      rec.onresult = (event) => {
        if (state.isSpeakingTts) return;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript.trim().toLowerCase();
          if (transcript) processVoiceCommand(transcript);
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
      updateHandsFreeQuickBadge();
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
      startActiveQueuedDrill();
    } else if (state.phase === 'IDLE' && phrase.includes('next')) {
      lastVoiceCommandTime = now;
      stepQueue(1, true);
    }
  }

  // ==========================================
  // 10. DRILL BUILDER & QUEUE MANAGEMENT
  // ==========================================
  function getBuilderDrillItem() {
    const drillId = state.builderDrillId;
    const def = DRILL_DEFS[drillId];
    const shots = Math.max(1, parseInt(el.shotsCountInput.value, 10) || 1);
    const targetSec = Math.max(0.4, parseFloat(el.targetSecondsInput.value) || 2.0);
    const includeReload = el.includeReloadCheckbox.checked;
    const postReloadShots = includeReload
      ? Math.max(1, parseInt(el.postReloadShotsInput.value, 10) || 1)
      : 0;

    return {
      uid: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      drillId,
      name: def.name,
      shots,
      targetSec: Number(targetSec.toFixed(2)),
      includeReload,
      postReloadShots,
      startPos: el.startPosSelect.value,
      turnAngle: el.turnAngleSelect.value,
      walkDirection: el.walkDirectionSelect.value,
      secondSignalDelay: el.secondSignalDelaySelect.value,
      pacedVoiceGuide: el.pacedVoiceGuideCheckbox.checked
    };
  }

  function selectBuilderDrillTile(drillId) {
    if (!DRILL_DEFS[drillId]) return;
    state.builderDrillId = drillId;
    const def = DRILL_DEFS[drillId];

    el.drillTiles.forEach((tile) => {
      tile.classList.toggle('active', tile.dataset.drill === drillId);
    });

    el.drillCategoryTag.textContent = def.category;
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
    el.dexterityQuickChips.classList.toggle('hidden', !isExactDraw);
    el.paramPaceGuideWrap.classList.toggle('hidden', !isExactDraw);

    el.paramStartPosWrap.classList.toggle('hidden', !(isReloadPreset || isContact));
    el.paramTurnAngleWrap.classList.toggle('hidden', !isTurned);
    el.paramWalkDirectionWrap.classList.toggle('hidden', !isWalk);
    el.paramSecondSignalWrap.classList.toggle('hidden', !isWalk);

    if (isReloadPreset) {
      el.includeReloadCheckbox.checked = true;
      el.postReloadShotsInput.value = def.defaultPostReloadShots || 2;
    } else {
      el.includeReloadCheckbox.checked = false;
    }

    updateBuilderReloadVisibility();
  }

  function updateBuilderReloadVisibility() {
    const hasReload = el.includeReloadCheckbox.checked;
    el.paramPostReloadShotsWrap.classList.toggle('hidden', !hasReload);
    el.shotsCountLabel.textContent = hasReload
      ? 'Shots Before Reload (#)'
      : 'Shots to Fire (#)';
    updateBuilderBriefingPreview();
  }

  function updateBuilderBriefingPreview() {
    const item = getBuilderDrillItem();
    const { fullBriefing } = generateDrillBriefing(item, false);
    el.builderBriefingText.textContent = `"${fullBriefing}"`;
  }

  function createDefaultSampleQueue() {
    return [
      {
        uid: 'sample-1',
        drillId: 'draw_exact',
        name: DRILL_DEFS.draw_exact.name,
        shots: 2,
        targetSec: 3.0,
        includeReload: false,
        postReloadShots: 0,
        startPos: 'Holstered',
        turnAngle: 'random',
        walkDirection: 'random',
        secondSignalDelay: 'random',
        pacedVoiceGuide: true
      },
      {
        uid: 'sample-2',
        drillId: 'holster_shoot',
        name: DRILL_DEFS.holster_shoot.name,
        shots: 2,
        targetSec: 2.0,
        includeReload: false,
        postReloadShots: 0,
        startPos: 'Holstered',
        turnAngle: 'random',
        walkDirection: 'random',
        secondSignalDelay: 'random',
        pacedVoiceGuide: false
      },
      {
        uid: 'sample-3',
        drillId: 'reload_drill',
        name: DRILL_DEFS.reload_drill.name,
        shots: 2,
        targetSec: 4.5,
        includeReload: true,
        postReloadShots: 2,
        startPos: 'High Ready',
        turnAngle: 'random',
        walkDirection: 'random',
        secondSignalDelay: 'random',
        pacedVoiceGuide: false
      },
      {
        uid: 'sample-4',
        drillId: 'turned_holster',
        name: DRILL_DEFS.turned_holster.name,
        shots: 2,
        targetSec: 2.5,
        includeReload: false,
        postReloadShots: 0,
        startPos: 'Holstered',
        turnAngle: '180 degrees away from target',
        walkDirection: 'random',
        secondSignalDelay: 'random',
        pacedVoiceGuide: false
      }
    ];
  }

  function loadQueueFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.QUEUE);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length > 0) {
        state.queue = parsed;
      } else {
        state.queue = [getBuilderDrillItem()];
      }
    } catch (_) {
      state.queue = [getBuilderDrillItem()];
    }
    state.activeQueueIndex = 0;
    saveQueueToStorage();
    renderQueueUI();
  }

  function saveQueueToStorage() {
    try {
      localStorage.setItem(STORAGE_KEYS.QUEUE, JSON.stringify(state.queue));
    } catch (_) {}
  }

  function getActiveQueuedDrill() {
    if (state.queue.length === 0) {
      state.queue.push(getBuilderDrillItem());
    }
    if (state.activeQueueIndex >= state.queue.length) {
      state.activeQueueIndex = 0;
    }
    return state.queue[state.activeQueueIndex];
  }

  function stepQueue(delta, announceSelection = false) {
    if (state.queue.length === 0) return;
    if (state.phase !== 'IDLE') {
      stopDrill('Switched queued drill');
    }
    const len = state.queue.length;
    state.activeQueueIndex = (state.activeQueueIndex + delta + len) % len;
    renderQueueUI();

    if (announceSelection) {
      const activeItem = getActiveQueuedDrill();
      const { fullBriefing } = generateDrillBriefing(activeItem, false);
      speakCue(`Drill ${state.activeQueueIndex + 1}. ${fullBriefing}`);
    }
  }

  function renderQueueUI() {
    if (state.queue.length === 0) {
      state.queue.push(getBuilderDrillItem());
      state.activeQueueIndex = 0;
    }
    if (state.activeQueueIndex >= state.queue.length) {
      state.activeQueueIndex = state.queue.length - 1;
    }

    const total = state.queue.length;
    const currentIdx = state.activeQueueIndex;
    const activeItem = state.queue[currentIdx];
    const { fullBriefing } = generateDrillBriefing(activeItem, false);

    // Update Badges & Timer Start Page Bar
    el.queueCountNavBadge.textContent = total;
    el.queueTotalBadge.textContent = total;
    el.timerQueueCountLabel.textContent = total;
    el.queueProgressPill.textContent = `Queue ${currentIdx + 1} / ${total}`;

    el.currentDrillTitleDisplay.textContent = `${currentIdx + 1}. ${activeItem.name}`;
    el.currentDrillBriefingDisplay.textContent = `"${fullBriefing}"`;

    // Update idle Timer metrics preview
    const totalShots =
      activeItem.shots + (activeItem.includeReload ? activeItem.postReloadShots : 0);
    state.expectedTotalShots = totalShots;
    state.preReloadShots = activeItem.shots;
    state.includeReload = activeItem.includeReload;

    if (state.phase === 'IDLE') {
      el.shotsCounterDisplay.textContent = `0 / ${totalShots}`;
      el.parDeltaDisplay.textContent = `${Number(activeItem.targetSec).toFixed(2)}s`;
      el.parOrTargetLabel.textContent =
        activeItem.drillId === 'draw_exact' ? 'TARGET PACE' : 'TARGET / PAR';
    }

    // Render Queue List in Drills & Queue Menu
    el.drillQueueList.innerHTML = '';
    state.queue.forEach((item, idx) => {
      const isActive = idx === currentIdx;
      const briefing = generateDrillBriefing(item, false);
      const row = document.createElement('div');
      row.className = `queue-item${isActive ? ' active-queue-item' : ''}`;
      row.dataset.queueIdx = idx;

      row.innerHTML = `
        <div class="queue-item-body">
          <div class="queue-item-title">
            #${idx + 1} • ${item.name} ${isActive ? '(Active)' : ''}
          </div>
          <div class="queue-item-brief">"${briefing.fullBriefing}"</div>
        </div>
        <div class="queue-item-actions">
          <button type="button" class="q-icon-btn" data-q-move="-1" data-q-idx="${idx}" title="Move Up">&uarr;</button>
          <button type="button" class="q-icon-btn" data-q-move="1" data-q-idx="${idx}" title="Move Down">&darr;</button>
          <button type="button" class="q-icon-btn q-del" data-q-del="${idx}" title="Remove">&times;</button>
        </div>
      `;

      el.drillQueueList.appendChild(row);
    });
  }

  // ==========================================
  // 11. DRILL EXECUTION ENGINE (WITH PRE-DRILL BRIEFING)
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

  async function startActiveQueuedDrill() {
    clearAllDrillTimers();
    ensureAudioContext();
    if (!state.wakeLockActive) {
      requestWakeLock();
    }
    if (!state.micEnabled) {
      await toggleMicDetector(true);
    }

    const activeItem = getActiveQueuedDrill();
    const resolvedBriefing = generateDrillBriefing(activeItem, true);

    const totalShots =
      activeItem.shots + (activeItem.includeReload ? activeItem.postReloadShots : 0);

    state.activeRunConfig = {
      ...activeItem,
      totalShots,
      resolvedBriefing
    };

    state.expectedTotalShots = totalShots;
    state.preReloadShots = activeItem.shots;
    state.includeReload = activeItem.includeReload;
    state.shots = [];
    state.prematureShots = 0;
    state.reloadCalled = false;
    state.activeContextLabel = resolvedBriefing.shooterState;

    // Reset Timer UI
    el.clockDisplay.innerHTML = `0.00<span class="clock-unit">s</span>`;
    el.shotsCounterDisplay.textContent = `0 / ${totalShots}`;
    el.firstShotDisplay.textContent = '--';
    el.lastSplitDisplay.textContent = '--';
    el.parDeltaDisplay.textContent = `${Number(activeItem.targetSec).toFixed(2)}s`;
    el.parDeltaDisplay.style.color = 'var(--text-main)';
    el.liveSplitsStrip.innerHTML = `<span class="splits-placeholder">Waiting for signal...</span>`;
    el.currentDrillBriefingDisplay.textContent = `"${resolvedBriefing.fullBriefing}"`;

    el.startDrillBtn.disabled = true;
    el.manualShotBtn.disabled = false;
    el.stopDrillBtn.disabled = false;

    const shouldAnnounceBriefing = el.announceDrillExplanationCheckbox.checked;

    if (shouldAnnounceBriefing) {
      setDrillPhaseUI('BRIEFING', 'DRILL BRIEFING');
      el.activeCueBanner.textContent = resolvedBriefing.fullBriefing;
      speakCue(resolvedBriefing.fullBriefing, {
        onEnd: () => {
          if (state.phase !== 'BRIEFING') return;
          scheduleTimeout(() => {
            if (state.phase !== 'BRIEFING') return;
            proceedAfterBriefing();
          }, 350);
        }
      });
    } else {
      proceedAfterBriefing();
    }
  }

  function proceedAfterBriefing() {
    const cfg = state.activeRunConfig;
    if (!cfg) return;

    setDrillPhaseUI('COUNTDOWN', 'PREPARING / STANDBY');

    if (cfg.drillId === 'walk_draw_shoot') {
      runWalkTwoStageDrill(cfg);
      return;
    }

    const mode = el.countdownModeSelect.value;
    if (mode === 'countdown_5' || mode === 'countdown_5_instant') {
      runFiveSecondCountdown(mode === 'countdown_5_instant');
    } else if (mode === 'instant') {
      el.activeCueBanner.textContent = `Standby...`;
      scheduleTimeout(() => beginLiveFirePhase(), 1000);
    } else {
      el.activeCueBanner.textContent = 'Shooter Ready... Standby';
      speakCue('Ready. Standby.', {
        onEnd: () => {
          if (state.phase !== 'COUNTDOWN') return;
          const randomDelayMs = Math.floor(1500 + Math.random() * 2000);
          el.activeCueBanner.textContent = 'Hold... Waiting for Signal...';
          scheduleTimeout(() => beginLiveFirePhase(), randomDelayMs);
        }
      });
    }
  }

  function runFiveSecondCountdown(immediateFireAfterOne) {
    const steps = ['5', '4', '3', '2', '1'];
    steps.forEach((step, idx) => {
      scheduleTimeout(() => {
        if (state.phase !== 'COUNTDOWN') return;
        el.activeCueBanner.textContent = `Countdown: ${step}...`;
        playTimerBeep(70, 1200, 0.3);
        speakCue(step);
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

  function runWalkTwoStageDrill(cfg) {
    const walkPhrase = cfg.resolvedBriefing.resolvedWalk;
    setDrillPhaseUI('WALKING', 'STAGE 1: WALKING');
    el.activeCueBanner.textContent = `Begin ${walkPhrase} (Holstered)...`;

    speakCue(`Begin ${walkPhrase}`, {
      onEnd: () => {
        if (state.phase !== 'WALKING') return;
        const walkTimeMs = Math.floor(2000 + Math.random() * 1800);
        scheduleTimeout(() => {
          if (state.phase !== 'WALKING') return;
          setDrillPhaseUI('DRAWN_WAITING', '1ST SIGNAL: DRAW!');
          state.firstSignalTimestampMs = performance.now();
          el.activeCueBanner.textContent =
            '1ST SIGNAL: DRAW WEAPON! (Wait for 2nd signal to shoot)';
          playTimerBeep(140, 1500, 0.5);
          speakCue('Draw!');

          const delayChoice = cfg.secondSignalDelay || 'random';
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

  function resolveContactCallout() {
    const directions = [
      'Contact Front!',
      'Contact Left!',
      'Contact Right!',
      'Contact Rear!'
    ];
    return directions[Math.floor(Math.random() * directions.length)];
  }

  function beginLiveFirePhase(overrideVoiceText = null) {
    const cfg = state.activeRunConfig;
    if (!cfg) return;

    let voiceSignal = overrideVoiceText || 'Fire!';

    if (cfg.drillId === 'contact_callout') {
      voiceSignal = resolveContactCallout();
      state.activeContextLabel = `${cfg.resolvedBriefing.shooterState} • ${voiceSignal}`;
    } else if (cfg.drillId === 'turned_holster') {
      voiceSignal = 'Turn and Fire!';
    } else if (cfg.drillId === 'draw_exact') {
      voiceSignal = cfg.targetSec >= 1.5 ? 'Draw!' : 'Fire!';
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

    const targetSec = Number(cfg.targetSec) || 2.0;
    if (cfg.drillId === 'draw_exact') {
      scheduleExactDrawPacingCues(targetSec, cfg.pacedVoiceGuide);
    } else if (targetSec > 0) {
      scheduleTimeout(() => {
        if (state.phase === 'LIVE') {
          playTimerBeep(160, 1000, 0.45);
        }
      }, Math.round(targetSec * 1000));
    }

    startClockAnimationLoop();
  }

  function scheduleExactDrawPacingCues(targetSec, useVoiceTicks) {
    if (useVoiceTicks) {
      const wholeSeconds = Math.floor(targetSec);
      if (wholeSeconds >= 2) {
        for (let s = 1; s < wholeSeconds; s++) {
          const remaining = wholeSeconds - s;
          scheduleTimeout(() => {
            if (state.phase !== 'LIVE') return;
            el.activeCueBanner.textContent = `Pacing Draw... ${remaining}s to Target Mark`;
            playTimerBeep(55, 1400, 0.3);
          }, s * 1000);
        }
      }
    }

    scheduleTimeout(() => {
      if (state.phase !== 'LIVE') return;
      el.activeCueBanner.textContent = `TARGET MARK (${targetSec.toFixed(2)}s) — FIRE!`;
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

    el.clockDisplay.innerHTML = `${shotRecord.elapsedSec.toFixed(2)}<span class="clock-unit">s</span>`;
    el.shotsCounterDisplay.textContent = `${shotNumber} / ${state.expectedTotalShots}`;

    if (shotNumber === 1) {
      el.firstShotDisplay.textContent = `${shotRecord.elapsedSec.toFixed(2)}s`;
    }
    el.lastSplitDisplay.textContent =
      shotNumber === 1
        ? `${shotRecord.elapsedSec.toFixed(2)}s`
        : `+${shotRecord.splitSec.toFixed(2)}s`;

    const chip = document.createElement('span');
    chip.className = `split-chip${isReloadSplit ? ' reload-chip' : ''}`;
    chip.textContent = isReloadSplit
      ? `#${shotNumber} RELOAD: ${shotRecord.elapsedSec.toFixed(2)}s (+${shotRecord.splitSec.toFixed(2)}s)`
      : `#${shotNumber}: ${shotRecord.elapsedSec.toFixed(2)}s (${shotNumber === 1 ? '1st' : '+' + shotRecord.splitSec.toFixed(2) + 's'})`;
    el.liveSplitsStrip.appendChild(chip);

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

    if (shotNumber >= state.expectedTotalShots) {
      completeDrillRun();
    }
  }

  function completeDrillRun() {
    clearAllDrillTimers();
    state.phase = 'IDLE';

    const cfg = state.activeRunConfig || getActiveQueuedDrill();
    const lastShot = state.shots[state.shots.length - 1];
    const totalSec = lastShot ? lastShot.elapsedSec : 0;
    const firstShotSec = state.shots[0] ? state.shots[0].elapsedSec : 0;
    const targetSec = Number(cfg.targetSec) || 2.0;
    const deltaSec = totalSec - targetSec;
    const deltaSign = deltaSec >= 0 ? '+' : '';

    el.clockDisplay.innerHTML = `${totalSec.toFixed(2)}<span class="clock-unit">s</span>`;
    el.parDeltaDisplay.textContent = `${deltaSign}${deltaSec.toFixed(2)}s`;
    el.parDeltaDisplay.style.color =
      cfg.drillId === 'draw_exact'
        ? Math.abs(deltaSec) <= 0.2
          ? 'var(--accent-green)'
          : 'var(--accent-amber)'
        : deltaSec <= 0
          ? 'var(--accent-green)'
          : 'var(--accent-amber)';

    setDrillPhaseUI('IDLE', 'DRILL COMPLETE');

    if (cfg.drillId === 'draw_exact') {
      el.activeCueBanner.textContent = `Target: ${targetSec.toFixed(2)}s | Actual: ${totalSec.toFixed(2)}s | Delta: ${deltaSign}${deltaSec.toFixed(2)}s`;
    } else {
      el.activeCueBanner.textContent = `Complete! Total: ${totalSec.toFixed(2)}s | 1st Shot: ${firstShotSec.toFixed(2)}s`;
    }

    el.startDrillBtn.disabled = false;
    el.manualShotBtn.disabled = true;
    el.stopDrillBtn.disabled = true;

    saveCompletedRunToLog({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      timestampIso: new Date().toISOString(),
      drillId: cfg.drillId,
      drillName: cfg.name,
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

    // Advance to next item in queue if enabled
    if (el.autoAdvanceQueueCheckbox.checked && state.queue.length > 1) {
      state.activeQueueIndex = (state.activeQueueIndex + 1) % state.queue.length;
      renderQueueUI();
    }

    // Auto-start next run if Hands-Free Auto-Repeat is enabled
    if (el.autoRepeatCheckbox.checked) {
      const restSec = Math.max(3, parseInt(el.autoRepeatSecInput.value, 10) || 8);
      el.activeCueBanner.textContent += ` • Next drill in ${restSec}s...`;
      scheduleTimeout(() => {
        if (state.phase === 'IDLE' && el.autoRepeatCheckbox.checked) {
          startActiveQueuedDrill();
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
    if (
      phase === 'BRIEFING' ||
      phase === 'COUNTDOWN' ||
      phase === 'WALKING' ||
      phase === 'DRAWN_WAITING'
    ) {
      el.timerCard.classList.add('phase-standby');
    } else if (phase === 'LIVE') {
      el.timerCard.classList.add('phase-live');
    }
  }

  // ==========================================
  // 12. PERSISTENT LOGGING & ANALYTICS
  // ==========================================
  function loadLogsFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LOGS);
      state.logs = raw ? JSON.parse(raw) : [];
    } catch (_) {
      state.logs = [];
    }
    renderLogsAndStats();
  }

  function saveCompletedRunToLog(entry) {
    state.logs.unshift(entry);
    if (state.logs.length > 500) state.logs.length = 500;
    try {
      localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(state.logs));
    } catch (_) {}
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
      el.logsListContainer.innerHTML = `<div class="card"><p class="helper-text" style="margin:0;text-align:center;">No logged runs yet. Complete a drill to see shot timings and splits here.</p></div>`;
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
      'ShooterState',
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
  // 13. EVENT LISTENERS & UI BINDINGS
  // ==========================================
  function bindEvents() {
    // Hamburger Menu Drawer
    el.menuToggleBtn.addEventListener('click', openDrawer);
    el.closeDrawerBtn.addEventListener('click', closeDrawer);
    el.navBackdrop.addEventListener('click', closeDrawer);

    el.drawerLinks.forEach((link) => {
      link.addEventListener('click', () => {
        switchView(link.dataset.view);
      });
    });

    // Top Bar Quick Controls
    el.micQuickToggleBtn.addEventListener('click', () => toggleMicDetector());
    el.wakeLockBtn.addEventListener('click', toggleWakeLock);

    // Sync Voice Briefing Toggle on Timer view & Settings view
    el.quickExplainToggle.addEventListener('change', () => {
      el.announceDrillExplanationCheckbox.checked = el.quickExplainToggle.checked;
    });
    el.announceDrillExplanationCheckbox.addEventListener('change', () => {
      el.quickExplainToggle.checked = el.announceDrillExplanationCheckbox.checked;
    });

    // Timer View Queue Navigation
    el.prevQueueBtn.addEventListener('click', () => stepQueue(-1, false));
    el.nextQueueBtn.addEventListener('click', () => stepQueue(1, false));
    el.openDrillsMenuBtn.addEventListener('click', () => switchView('view-drills'));

    // Primary Timer Controls
    el.startDrillBtn.addEventListener('click', startActiveQueuedDrill);
    el.manualShotBtn.addEventListener('click', () =>
      registerShot(performance.now(), 'TAP')
    );
    el.stopDrillBtn.addEventListener('click', () => stopDrill('Drill stopped'));

    // Drill Builder Tiles & Inputs
    el.drillTiles.forEach((tile) => {
      tile.addEventListener('click', () => {
        selectBuilderDrillTile(tile.dataset.drill);
      });
    });

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
        updateBuilderBriefingPreview();
      });
    });

    el.dexterityQuickChips.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        el.targetSecondsInput.value = chip.dataset.setTime;
        updateBuilderBriefingPreview();
      });
    });

    [
      el.targetSecondsInput,
      el.shotsCountInput,
      el.postReloadShotsInput,
      el.startPosSelect,
      el.turnAngleSelect,
      el.walkDirectionSelect,
      el.secondSignalDelaySelect,
      el.pacedVoiceGuideCheckbox
    ].forEach((inputEl) => {
      inputEl.addEventListener('change', updateBuilderBriefingPreview);
    });

    el.includeReloadCheckbox.addEventListener('change', updateBuilderReloadVisibility);

    el.testBriefingSpeakBtn.addEventListener('click', () => {
      const item = getBuilderDrillItem();
      const { fullBriefing } = generateDrillBriefing(item, true);
      speakCue(fullBriefing);
    });

    // Add to Queue / Run Single Drill
    el.addToQueueBtn.addEventListener('click', () => {
      const newItem = getBuilderDrillItem();
      state.queue.push(newItem);
      state.activeQueueIndex = state.queue.length - 1;
      saveQueueToStorage();
      renderQueueUI();
    });

    el.useSingleDrillBtn.addEventListener('click', () => {
      const newItem = getBuilderDrillItem();
      state.queue = [newItem];
      state.activeQueueIndex = 0;
      saveQueueToStorage();
      renderQueueUI();
      switchView('view-timer');
    });

    // Queue List Actions (Select, Move Up/Down, Delete)
    el.drillQueueList.addEventListener('click', (e) => {
      const moveBtn = e.target.closest('[data-q-move]');
      if (moveBtn) {
        e.stopPropagation();
        const idx = parseInt(moveBtn.dataset.qIdx, 10);
        const dir = parseInt(moveBtn.dataset.qMove, 10);
        const targetIdx = idx + dir;
        if (targetIdx >= 0 && targetIdx < state.queue.length) {
          const temp = state.queue[idx];
          state.queue[idx] = state.queue[targetIdx];
          state.queue[targetIdx] = temp;
          if (state.activeQueueIndex === idx) state.activeQueueIndex = targetIdx;
          saveQueueToStorage();
          renderQueueUI();
        }
        return;
      }

      const delBtn = e.target.closest('[data-q-del]');
      if (delBtn) {
        e.stopPropagation();
        const idx = parseInt(delBtn.dataset.qDel, 10);
        state.queue.splice(idx, 1);
        if (state.queue.length === 0) {
          state.queue.push(getBuilderDrillItem());
        }
        if (state.activeQueueIndex >= state.queue.length) {
          state.activeQueueIndex = state.queue.length - 1;
        }
        saveQueueToStorage();
        renderQueueUI();
        return;
      }

      const row = e.target.closest('[data-queue-idx]');
      if (row) {
        state.activeQueueIndex = parseInt(row.dataset.queueIdx, 10) || 0;
        renderQueueUI();
        switchView('view-timer');
      }
    });

    el.loadSampleQueueBtn.addEventListener('click', () => {
      state.queue = createDefaultSampleQueue();
      state.activeQueueIndex = 0;
      saveQueueToStorage();
      renderQueueUI();
    });

    el.clearQueueBtn.addEventListener('click', () => {
      state.queue = [getBuilderDrillItem()];
      state.activeQueueIndex = 0;
      saveQueueToStorage();
      renderQueueUI();
    });

    el.autoRepeatCheckbox.addEventListener('change', () => {
      el.paramAutoRepeatDelayWrap.classList.toggle(
        'hidden',
        !el.autoRepeatCheckbox.checked
      );
    });

    // Settings & Audio Controls
    el.thresholdSlider.addEventListener('input', () => {
      const val = parseInt(el.thresholdSlider.value, 10);
      state.thresholdPercent = val;
      el.thresholdSliderVal.textContent = `${val}%`;
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
    el.enableClapStartCheckbox.addEventListener('change', updateHandsFreeQuickBadge);

    el.ttsRateSlider.addEventListener('input', () => {
      el.ttsRateVal.textContent = `${parseFloat(el.ttsRateSlider.value).toFixed(2)}x`;
    });

    el.soundboardGrid.querySelectorAll('.sb-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const phrase = btn.dataset.say;
        const withBeep = btn.dataset.beep === 'true';
        if (withBeep) playTimerBeep(220);
        speakCue(phrase);
      });
    });

    // Logs Actions
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
  // 14. BOOTSTRAP
  // ==========================================
  function init() {
    initPWA();
    bindEvents();
    selectBuilderDrillTile('draw_exact');
    loadQueueFromStorage();
    loadLogsFromStorage();
    updateHandsFreeQuickBadge();
  }

  init();
})();

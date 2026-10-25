/**
 * Tactical Airsoft Shot Timer & Drill Trainer
 * Offline-First PWA with Wake Lock, Web Audio GBB Shot Detection,
 * Vocal-Band "Ready" Detector + Speech API, 1st-Rep Drill Briefing,
 * Spoken Draw Countdown ("Draw! # ... 2, 1, Fire!"), and Multi-Rep Queue.
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
    builderDrillId: 'draw_exact',

    // Drill Queue & Rep Tracking
    queue: [],
    activeQueueIndex: 0,
    activeRepIndex: 1,

    // Active run execution state
    // 'IDLE' | 'BRIEFING' | 'ASKING_READY' | 'WAITING_FOR_READY' | 'COUNTDOWN' | 'WALKING' | 'DRAWN_WAITING' | 'LIVE'
    phase: 'IDLE',
    timers: [],
    rafId: null,
    activeRunConfig: null,

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

    // Web Audio API: GBB Shot Transient + Vocal Formant Analyzer
    audioCtx: null,
    micStream: null,
    analyser: null,
    timeDomainData: null,
    freqDomainData: null,
    micEnabled: false,
    micRafId: null,
    currentPeak: 0,
    currentVocalEnergy: 0,
    peakHold: 0,
    peakHoldDecayTime: 0,
    thresholdPercent: 62,
    voiceThresholdPercent: 18,
    debounceMs: 115,
    lastShotTimestampMs: 0,

    // Self-Audio Lockout & "Ready" Vocal Envelope State
    muteShotDetectionUntilMs: 0,
    ignoreVoiceUntilMs: 0,
    readyListenEligibleAtMs: 0,
    readyListenerArmed: false,
    quietCalibrationSamples: [],
    ambientVoiceFloor: 4,
    vocalActiveFrames: 0,
    vocalQuietTailFrames: 0,
    isSpeakingTts: false,

    // Optional Browser SpeechRecognition
    recognition: null,
    speechRecSupported: false,
    voiceCmdEnabled: true,
    recognitionRunning: false,
    recognitionResumeTimer: null,

    // Persisted Logs
    logs: []
  };

  const STORAGE_KEYS = {
    LOGS: 'airsoft_trainer_logs_v1',
    QUEUE: 'airsoft_trainer_queue_v2'
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
    drawerInstallBtn: document.getElementById('drawerInstallBtn'),
    installHelpNote: document.getElementById('installHelpNote'),

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
    autoPromptReadyCheckbox: document.getElementById('autoPromptReadyCheckbox'),
    paramAutoRepeatDelayWrap: document.getElementById('paramAutoRepeatDelayWrap'),
    autoRepeatSecInput: document.getElementById('autoRepeatSecInput'),
    drillQueueList: document.getElementById('drillQueueList'),
    loadSampleQueueBtn: document.getElementById('loadSampleQueueBtn'),
    clearQueueBtn: document.getElementById('clearQueueBtn'),

    drillCategoryTag: document.getElementById('drillCategoryTag'),
    drillTiles: document.querySelectorAll('.drill-tile'),
    builderBriefingText: document.getElementById('builderBriefingText'),
    testBriefingSpeakBtn: document.getElementById('testBriefingSpeakBtn'),

    drillRepsInput: document.getElementById('drillRepsInput'),
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
    requireReadyVoiceCheckbox: document.getElementById('requireReadyVoiceCheckbox'),
    countdownModeSelect: document.getElementById('countdownModeSelect'),
    thresholdSlider: document.getElementById('thresholdSlider'),
    thresholdSliderVal: document.getElementById('thresholdSliderVal'),
    debounceSlider: document.getElementById('debounceSlider'),
    debounceSliderVal: document.getElementById('debounceSliderVal'),
    calibrateMicBtn: document.getElementById('calibrateMicBtn'),
    testBeepBtn: document.getElementById('testBeepBtn'),

    voiceThresholdSlider: document.getElementById('voiceThresholdSlider'),
    voiceThresholdSliderVal: document.getElementById('voiceThresholdSliderVal'),
    enableSpeechRecCheckbox: document.getElementById('enableSpeechRecCheckbox'),
    enableAcousticReadyFallbackCheckbox: document.getElementById(
      'enableAcousticReadyFallbackCheckbox'
    ),
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

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;

    if (isStandalone) {
      el.installPwaBtn.classList.add('hidden');
      if (el.drawerInstallBtn) {
        el.drawerInstallBtn.textContent = 'App Installed (Offline Ready)';
      }
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      el.installPwaBtn.classList.remove('hidden');
      if (el.drawerInstallBtn) {
        el.drawerInstallBtn.textContent = '+ Install App Now';
      }
    });

    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      el.installPwaBtn.classList.add('hidden');
      if (el.drawerInstallBtn) {
        el.drawerInstallBtn.textContent = 'App Installed (Offline Ready)';
      }
    });

    const handleInstallClick = async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        return;
      }

      // Explicitly cache all assets offline & show browser install instructions
      if ('caches' in window) {
        try {
          const cache = await caches.open('airsoft-trainer-v1.6');
          await cache.addAll([
            './',
            './index.html',
            './style.css',
            './script.js',
            './manifest.json',
            './icon.svg',
            './icon-192.png',
            './icon-512.png'
          ]);
        } catch (_) {}
      }

      openDrawer();
      if (el.installHelpNote) {
        el.installHelpNote.classList.remove('hidden');
        el.installHelpNote.innerHTML =
          'Offline cache verified &amp; saved! To add the app icon to your Android home screen, tap your browser&rsquo;s <strong>&vellip;</strong> menu (top right) &rarr; <strong>Install app</strong> (or <strong>Add to Home screen</strong>).';
      }
    };

    el.installPwaBtn.addEventListener('click', handleInstallClick);
    if (el.drawerInstallBtn) {
      el.drawerInstallBtn.addEventListener('click', handleInstallClick);
    }
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
  // 8. WEB AUDIO API: PIEZO, TTS, GBB TRANSIENT & VOCAL FORMANT DETECTOR
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

  function isSelfAudioActive(nowMs = performance.now()) {
    const synthSpeaking =
      state.isSpeakingTts ||
      ('speechSynthesis' in window && window.speechSynthesis.speaking);
    if (synthSpeaking) {
      state.muteShotDetectionUntilMs = Math.max(
        state.muteShotDetectionUntilMs,
        nowMs + 280
      );
      state.ignoreVoiceUntilMs = Math.max(state.ignoreVoiceUntilMs, nowMs + 500);
      return true;
    }
    return nowMs < state.muteShotDetectionUntilMs;
  }

  function playTimerBeep(durationMs = 220, freqHz = null, gainLevel = 0.65) {
    const ctx = ensureAudioContext();
    const frequency = freqHz || Number(el.beepFreqSelect.value) || 2400;

    const nowMs = performance.now();
    state.muteShotDetectionUntilMs = Math.max(
      state.muteShotDetectionUntilMs,
      nowMs + durationMs + 140
    );
    state.ignoreVoiceUntilMs = Math.max(
      state.ignoreVoiceUntilMs,
      nowMs + durationMs + 380
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
   * Speaks a tactical phrase or single countdown word.
   * Supports custom speech rate and post-speech guard duration.
   */
  function speakCue(
    text,
    {
      onEnd = null,
      playBeepAfter = false,
      rateOverride = null,
      postGuardMs = 400
    } = {}
  ) {
    suspendSpeechRecognitionForSelfAudio();

    if (!('speechSynthesis' in window)) {
      if (playBeepAfter) playTimerBeep(240);
      if (onEnd) setTimeout(onEnd, 260);
      return;
    }

    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const baseRate = parseFloat(el.ttsRateSlider.value) || 1.05;
    utter.rate = rateOverride || baseRate;
    utter.pitch = 0.96;
    utter.volume = 1.0;

    const estimatedMs = Math.max(320, text.length * 68);
    const nowMs = performance.now();
    state.isSpeakingTts = true;
    state.muteShotDetectionUntilMs = Math.max(
      state.muteShotDetectionUntilMs,
      nowMs + estimatedMs + postGuardMs
    );
    state.ignoreVoiceUntilMs = Math.max(
      state.ignoreVoiceUntilMs,
      nowMs + estimatedMs + postGuardMs + 200
    );

    let finished = false;
    const finishHandler = () => {
      if (finished) return;
      finished = true;
      state.isSpeakingTts = false;

      const endNow = performance.now();
      state.muteShotDetectionUntilMs = endNow + postGuardMs;
      state.ignoreVoiceUntilMs = endNow + postGuardMs + 150;

      if (playBeepAfter) {
        playTimerBeep(240);
      }

      if (state.phase === 'WAITING_FOR_READY' || state.phase === 'ASKING_READY') {
        resumeSpeechRecognitionAfterSelfAudio(postGuardMs + 50);
      }

      if (onEnd) onEnd();
    };

    utter.onend = finishHandler;
    utter.onerror = finishHandler;

    const safetyWatchdog = setTimeout(() => {
      if (!window.speechSynthesis.speaking) {
        finishHandler();
      } else {
        setTimeout(finishHandler, 900);
      }
    }, estimatedMs + 950);

    state.timers.push(safetyWatchdog);
    window.speechSynthesis.speak(utter);
  }

  /**
   * Fires the primary "GO / FIRE" signal. Uses a short postGuardMs (160ms)
   * so shots fired right after "Fire!" are never blocked by a long TTS cooldown.
   */
  function triggerGoSignal(customVoiceText = 'Fire!', callbackOnSignalStart = null) {
    const style = el.signalStyleSelect.value;
    if (style === 'beep') {
      playTimerBeep(240);
      if (callbackOnSignalStart) callbackOnSignalStart();
    } else if (style === 'voice') {
      if (callbackOnSignalStart) callbackOnSignalStart();
      speakCue(customVoiceText, { rateOverride: 1.25, postGuardMs: 140 });
    } else {
      playTimerBeep(220);
      if (callbackOnSignalStart) callbackOnSignalStart();
      speakCue(customVoiceText, { rateOverride: 1.25, postGuardMs: 140 });
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
      analyser.smoothingTimeConstant = 0.15;
      source.connect(analyser);

      state.analyser = analyser;
      state.timeDomainData = new Uint8Array(analyser.fftSize);
      state.freqDomainData = new Uint8Array(analyser.frequencyBinCount);
      state.micEnabled = true;

      el.micQuickToggleBtn.className = 'mic-pill pill-on';
      el.micShortText.textContent = 'MIC ON';
      el.calibrateMicBtn.textContent = 'Disable Shot Mic';

      runMicLoop();
      return true;
    } catch (err) {
      console.error('Microphone access denied:', err);
      el.activeCueBanner.textContent =
        'Mic permission needed for GBB & Voice detection (or use buttons).';
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

  /**
   * Computes human vocal formant energy (200Hz - 2800Hz) from FFT frequency bins,
   * scaled 0..100%. Much more sensitive to a spoken "Ready" from 1-2m away than
   * raw time-domain peak!
   */
  function computeVocalBandEnergyPercent() {
    if (!state.analyser || !state.freqDomainData || !state.audioCtx) return 0;
    state.analyser.getByteFrequencyData(state.freqDomainData);

    const sampleRate = state.audioCtx.sampleRate || 48000;
    const binHz = sampleRate / state.analyser.fftSize;
    const startBin = Math.max(2, Math.floor(200 / binHz));
    const endBin = Math.min(
      state.freqDomainData.length - 1,
      Math.ceil(2800 / binHz)
    );

    let sum = 0;
    let maxBin = 0;
    let count = 0;
    for (let i = startBin; i <= endBin; i++) {
      const val = state.freqDomainData[i];
      sum += val;
      if (val > maxBin) maxBin = val;
      count++;
    }
    if (count === 0) return 0;
    const avg = sum / count;
    // Blend average and peak formant bin, scaled into 0..100%
    const blended = avg * 0.65 + maxBin * 0.35;
    return Math.min(100, Math.round((blended / 190) * 100));
  }

  function runMicLoop() {
    if (!state.micEnabled || !state.analyser) return;

    const nowMs = performance.now();
    const selfAudioBusy = isSelfAudioActive(nowMs);

    // 1. Compute Time-Domain Peak (for sharp GBB gunshot transients)
    state.analyser.getByteTimeDomainData(state.timeDomainData);
    let maxDeviation = 0;
    const buf = state.timeDomainData;
    for (let i = 0; i < buf.length; i++) {
      const dev = Math.abs(buf[i] - 128);
      if (dev > maxDeviation) maxDeviation = dev;
    }
    const rawPeakPercent = Math.min(100, Math.round((maxDeviation / 128) * 100));

    // 2. Compute Vocal Formant Band Energy (for spoken "Ready" detection)
    const rawVocalPercent = computeVocalBandEnergyPercent();

    const peakPercent = selfAudioBusy ? 0 : rawPeakPercent;
    const vocalPercent = selfAudioBusy ? 0 : rawVocalPercent;

    state.currentPeak = peakPercent;
    state.currentVocalEnergy = vocalPercent;

    // When waiting for "Ready", display the Vocal Energy on the top meter so the shooter sees their voice!
    const isWaitingReady = state.phase === 'WAITING_FOR_READY';
    const displayedMeterVal = isWaitingReady
      ? Math.max(vocalPercent, peakPercent)
      : peakPercent;
    const displayedThreshold = isWaitingReady
      ? Math.max(state.voiceThresholdPercent, state.ambientVoiceFloor + 7)
      : state.thresholdPercent;

    if (displayedMeterVal >= state.peakHold || nowMs > state.peakHoldDecayTime) {
      state.peakHold = displayedMeterVal;
      state.peakHoldDecayTime = nowMs + 900;
    }

    el.meterFill.style.width = `${displayedMeterVal}%`;
    el.meterPeakHold.style.left = `${Math.min(99, state.peakHold)}%`;
    el.meterThresholdLine.style.left = `${Math.min(98, displayedThreshold)}%`;
    el.peakValueLabel.textContent = `${displayedMeterVal}%`;

    // 3. If in WAITING_FOR_READY phase, run Vocal Formant Envelope Detector for "Ready"
    if (
      isWaitingReady &&
      !selfAudioBusy &&
      nowMs >= state.readyListenEligibleAtMs &&
      el.enableAcousticReadyFallbackCheckbox.checked
    ) {
      processVocalReadyEnvelope(displayedMeterVal, nowMs);
    }

    // 4. Check GBB Shot Threshold during LIVE / WALKING / DRAWN_WAITING
    if (
      !isWaitingReady &&
      !selfAudioBusy &&
      peakPercent >= state.thresholdPercent &&
      nowMs - state.lastShotTimestampMs >= state.debounceMs
    ) {
      state.lastShotTimestampMs = nowMs;
      handleAcousticSpikeDetected(nowMs);
    }

    state.micRafId = requestAnimationFrame(runMicLoop);
  }

  /**
   * Detects when the shooter speaks "Ready" after "Shooter ready?" has finished:
   * Step 1: Requires 8 quiet frames (~130ms) after the TTS echo guard to lock in room silence floor.
   * Step 2: Detects a vocal energy rise >= effectiveThreshold lasting >= 3 frames (~50ms)
   *         followed by word completion (or 14 continuous vocal frames ~230ms).
   */
  function processVocalReadyEnvelope(vocalLevel, nowMs) {
    if (!state.readyListenerArmed) {
      // Wait for room silence after "Shooter ready?" finishes playing
      if (vocalLevel < 28) {
        state.quietCalibrationSamples.push(vocalLevel);
        if (state.quietCalibrationSamples.length >= 8) {
          const sum = state.quietCalibrationSamples.reduce((a, b) => a + b, 0);
          state.ambientVoiceFloor = Math.min(
            20,
            Math.max(2, Math.round(sum / state.quietCalibrationSamples.length))
          );
          state.readyListenerArmed = true;
          state.vocalActiveFrames = 0;
          state.vocalQuietTailFrames = 0;
          el.activeCueBanner.textContent =
            'Listening for "READY"... (Speak "Ready" now)';
        }
      } else {
        // Still hearing speaker tail or background noise; reset quiet calibration
        state.quietCalibrationSamples = [];
      }
      return;
    }

    const effectiveThreshold = Math.max(
      state.voiceThresholdPercent,
      state.ambientVoiceFloor + 7
    );

    if (vocalLevel >= effectiveThreshold) {
      state.vocalActiveFrames++;
      state.vocalQuietTailFrames = 0;
      if (state.vocalActiveFrames >= 2) {
        el.voiceHeardBanner.innerHTML = `Hearing voice reply (${vocalLevel}%)...`;
      }
      // If user has spoken clearly for ~220ms continuously, trigger immediately!
      if (state.vocalActiveFrames >= 13) {
        confirmShooterReady('Voice "Ready" Detected');
      }
    } else if (state.vocalActiveFrames >= 3) {
      // User spoke >= 50ms and vocal level just dropped at end of word "Ready"
      state.vocalQuietTailFrames++;
      if (state.vocalQuietTailFrames >= 3) {
        confirmShooterReady('Voice "Ready" Detected');
      }
    } else {
      state.vocalActiveFrames = 0;
      state.vocalQuietTailFrames = 0;
    }
  }

  function handleAcousticSpikeDetected(nowMs) {
    if (state.phase === 'LIVE') {
      registerShot(nowMs, 'MIC');
    } else if (state.phase === 'WALKING' || state.phase === 'DRAWN_WAITING') {
      state.prematureShots++;
      el.activeCueBanner.textContent = `EARLY SHOT DETECTED! Wait for 2nd "Fire!" signal!`;
    }
  }

  // ==========================================
  // 9. BROWSER SPEECH RECOGNITION (SUPPLEMENTARY)
  // ==========================================
  function initSpeechRecognition() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      state.speechRecSupported = false;
      return;
    }

    state.speechRecSupported = true;
    const rec = new SpeechRec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onstart = () => {
      state.recognitionRunning = true;
      updateHandsFreeQuickBadge();
    };

    rec.onresult = (event) => {
      const nowMs = performance.now();
      if (isSelfAudioActive(nowMs) || nowMs < state.ignoreVoiceUntilMs) {
        return;
      }

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript.trim().toLowerCase();
        if (transcript) {
          processVoiceCommand(transcript, nowMs);
        }
      }
    };

    rec.onerror = () => {};

    rec.onend = () => {
      state.recognitionRunning = false;
      updateHandsFreeQuickBadge();
    };

    state.recognition = rec;
  }

  function suspendSpeechRecognitionForSelfAudio() {
    if (state.recognitionResumeTimer) {
      clearTimeout(state.recognitionResumeTimer);
      state.recognitionResumeTimer = null;
    }
    if (state.recognition && state.recognitionRunning) {
      try {
        state.recognition.abort();
      } catch (_) {}
      state.recognitionRunning = false;
    }
  }

  function resumeSpeechRecognitionAfterSelfAudio(delayMs = 450) {
    if (!state.speechRecSupported || !state.recognition) return;
    if (!el.enableSpeechRecCheckbox.checked) return;

    if (state.recognitionResumeTimer) {
      clearTimeout(state.recognitionResumeTimer);
    }

    state.recognitionResumeTimer = setTimeout(() => {
      if (isSelfAudioActive()) return;
      if (!state.recognitionRunning) {
        try {
          state.recognition.start();
        } catch (_) {}
      }
    }, delayMs);
  }

  function updateHandsFreeQuickBadge() {
    if (state.phase === 'WAITING_FOR_READY') {
      el.voiceQuickBadge.textContent = 'Listening: "Ready"';
    } else if (state.micEnabled) {
      el.voiceQuickBadge.textContent = 'Voice + Shot Ready';
    } else {
      el.voiceQuickBadge.textContent = 'Say "Ready"';
    }
  }

  let lastVoiceCommandTime = 0;
  function processVoiceCommand(phrase, nowMs = performance.now()) {
    if (nowMs - lastVoiceCommandTime < 800) return;

    if (phrase === 'shooter' || phrase.includes('shooter ready')) {
      return;
    }

    el.voiceHeardBanner.innerHTML = `Heard: <strong>"${phrase}"</strong>`;

    if (
      phrase.includes('stop') ||
      phrase.includes('cease') ||
      phrase.includes('cancel') ||
      phrase.includes('hold')
    ) {
      lastVoiceCommandTime = nowMs;
      stopDrill('Stopped by voice command');
      return;
    }

    if (state.phase === 'WAITING_FOR_READY' && state.readyListenerArmed) {
      const isReadyWord =
        phrase.includes('ready') ||
        phrase.includes('already') ||
        phrase.includes('red') ||
        phrase.includes('read') ||
        phrase.includes('eddy') ||
        phrase.includes('yes') ||
        phrase.includes('yeah') ||
        phrase.includes('yep') ||
        phrase.includes('go') ||
        phrase.includes('start') ||
        phrase.includes('standby');

      if (isReadyWord) {
        lastVoiceCommandTime = nowMs;
        confirmShooterReady(`Speech "${phrase}"`);
      }
    }
  }

  // ==========================================
  // 10. DRILL BUILDER & QUEUE MANAGEMENT (WITH REPS)
  // ==========================================
  function getBuilderDrillItem() {
    const drillId = state.builderDrillId;
    const def = DRILL_DEFS[drillId];
    const reps = Math.max(1, parseInt(el.drillRepsInput.value, 10) || 1);
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
      reps,
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
        reps: 3,
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
        reps: 3,
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
        reps: 2,
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
        reps: 2,
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
        state.queue = parsed.map((item) => ({
          ...item,
          reps: Math.max(1, parseInt(item.reps, 10) || 1)
        }));
      } else {
        state.queue = [getBuilderDrillItem()];
      }
    } catch (_) {
      state.queue = [getBuilderDrillItem()];
    }
    state.activeQueueIndex = 0;
    state.activeRepIndex = 1;
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
    const item = state.queue[state.activeQueueIndex];
    item.reps = Math.max(1, parseInt(item.reps, 10) || 1);
    if (state.activeRepIndex > item.reps) {
      state.activeRepIndex = 1;
    }
    return item;
  }

  function stepQueue(delta) {
    if (state.queue.length === 0) return;
    if (state.phase !== 'IDLE') {
      stopDrill('Switched queued drill');
    }
    const len = state.queue.length;
    state.activeQueueIndex = (state.activeQueueIndex + delta + len) % len;
    state.activeRepIndex = 1;
    renderQueueUI();
  }

  function renderQueueUI() {
    const activeItem = getActiveQueuedDrill();
    const totalDrills = state.queue.length;
    const currentIdx = state.activeQueueIndex;
    const currentRep = state.activeRepIndex;
    const totalReps = activeItem.reps || 1;
    const { fullBriefing } = generateDrillBriefing(activeItem, false);

    el.queueCountNavBadge.textContent = totalDrills;
    el.queueTotalBadge.textContent = totalDrills;
    el.timerQueueCountLabel.textContent = totalDrills;
    el.queueProgressPill.textContent = `Queue ${currentIdx + 1}/${totalDrills} • Rep ${currentRep}/${totalReps}`;

    el.currentDrillTitleDisplay.textContent = `${currentIdx + 1}. ${activeItem.name} (Rep ${currentRep} of ${totalReps})`;
    el.currentDrillBriefingDisplay.textContent = `"${fullBriefing}"`;

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

    el.drillQueueList.innerHTML = '';
    state.queue.forEach((item, idx) => {
      const isActive = idx === currentIdx;
      const itemReps = Math.max(1, parseInt(item.reps, 10) || 1);
      const briefing = generateDrillBriefing(item, false);
      const row = document.createElement('div');
      row.className = `queue-item${isActive ? ' active-queue-item' : ''}`;
      row.dataset.queueIdx = idx;

      row.innerHTML = `
        <div class="queue-item-body">
          <div class="queue-item-title">
            #${idx + 1} • ${item.name} ${isActive ? `(Active: Rep ${currentRep}/${itemReps})` : ''}
          </div>
          <div class="queue-item-brief">"${briefing.fullBriefing}"</div>
        </div>
        <div class="queue-item-actions">
          <div class="q-reps-ctrl" title="Number of repetitions for this drill">
            <button type="button" class="q-rep-btn" data-q-rep-delta="-1" data-q-idx="${idx}">-</button>
            <span class="q-reps-label">${itemReps}x</span>
            <button type="button" class="q-rep-btn" data-q-rep-delta="1" data-q-idx="${idx}">+</button>
          </div>
          <button type="button" class="q-icon-btn" data-q-move="-1" data-q-idx="${idx}" title="Move Up">&uarr;</button>
          <button type="button" class="q-icon-btn" data-q-move="1" data-q-idx="${idx}" title="Move Down">&darr;</button>
          <button type="button" class="q-icon-btn q-del" data-q-del="${idx}" title="Remove">&times;</button>
        </div>
      `;

      el.drillQueueList.appendChild(row);
    });
  }

  // ==========================================
  // 11. DRILL EXECUTION ENGINE
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
    if (state.phase === 'WAITING_FOR_READY') {
      confirmShooterReady('Manual Button Confirm');
      return;
    }

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
      repNumber: state.activeRepIndex,
      totalReps: activeItem.reps || 1,
      totalShots,
      resolvedBriefing
    };

    state.expectedTotalShots = totalShots;
    state.preReloadShots = activeItem.shots;
    state.includeReload = activeItem.includeReload;
    state.shots = [];
    state.prematureShots = 0;
    state.reloadCalled = false;
    state.activeContextLabel = `${resolvedBriefing.shooterState} (Rep ${state.activeRepIndex}/${activeItem.reps || 1})`;

    // Reset Timer UI
    el.clockDisplay.innerHTML = `0.00<span class="clock-unit">s</span>`;
    el.shotsCounterDisplay.textContent = `0 / ${totalShots}`;
    el.firstShotDisplay.textContent = '--';
    el.lastSplitDisplay.textContent = '--';
    el.parDeltaDisplay.textContent = `${Number(activeItem.targetSec).toFixed(2)}s`;
    el.parDeltaDisplay.style.color = 'var(--text-main)';
    el.liveSplitsStrip.innerHTML = `<span class="splits-placeholder">Waiting for signal...</span>`;
    el.currentDrillBriefingDisplay.textContent = `"${resolvedBriefing.fullBriefing}"`;
    renderQueueUI();

    el.startDrillBtn.disabled = true;
    el.startDrillBtn.textContent = 'START DRILL';
    el.manualShotBtn.disabled = false;
    el.stopDrillBtn.disabled = false;

    // Only announce full description on Rep 1 of each drill
    const isFirstRepOfThisDrill = state.activeRepIndex === 1;
    const shouldAnnounceBriefing =
      isFirstRepOfThisDrill && el.announceDrillExplanationCheckbox.checked;

    if (shouldAnnounceBriefing) {
      setDrillPhaseUI('BRIEFING', `REP 1/${state.activeRunConfig.totalReps} BRIEFING`);
      el.activeCueBanner.textContent = resolvedBriefing.fullBriefing;
      speakCue(resolvedBriefing.fullBriefing, {
        postGuardMs: 350,
        onEnd: () => {
          if (state.phase !== 'BRIEFING') return;
          scheduleTimeout(() => {
            if (state.phase !== 'BRIEFING') return;
            askShooterReadyGate();
          }, 250);
        }
      });
    } else {
      askShooterReadyGate();
    }
  }

  function askShooterReadyGate() {
    const cfg = state.activeRunConfig;
    if (!cfg) return;

    if (!el.requireReadyVoiceCheckbox.checked) {
      proceedAfterReadyConfirmed();
      return;
    }

    state.readyListenerArmed = false;
    state.quietCalibrationSamples = [];
    state.vocalActiveFrames = 0;
    state.vocalQuietTailFrames = 0;

    setDrillPhaseUI(
      'ASKING_READY',
      `REP ${cfg.repNumber}/${cfg.totalReps} • ASKING READY`
    );
    el.activeCueBanner.textContent = 'Asking: "Shooter ready?"...';

    speakCue('Shooter ready?', {
      postGuardMs: 380,
      onEnd: () => {
        if (state.phase !== 'ASKING_READY') return;

        const nowMs = performance.now();
        state.readyListenEligibleAtMs = nowMs + 380;
        state.ignoreVoiceUntilMs = nowMs + 380;
        state.muteShotDetectionUntilMs = nowMs + 380;

        setDrillPhaseUI(
          'WAITING_FOR_READY',
          `REP ${cfg.repNumber}/${cfg.totalReps} • SAY "READY"`
        );
        el.activeCueBanner.textContent =
          'Calibrating room silence... Get ready to say "READY"';

        el.startDrillBtn.disabled = false;
        el.startDrillBtn.textContent = 'SAY "READY" (OR TAP)';

        updateHandsFreeQuickBadge();
        resumeSpeechRecognitionAfterSelfAudio(380);
      }
    });
  }

  function confirmShooterReady(triggerSource = 'Voice') {
    if (state.phase !== 'WAITING_FOR_READY') return;

    state.readyListenerArmed = false;
    el.startDrillBtn.disabled = true;
    el.startDrillBtn.textContent = 'START DRILL';
    // Restore GBB shot threshold line on top meter
    el.meterThresholdLine.style.left = `${state.thresholdPercent}%`;
    updateHandsFreeQuickBadge();

    el.voiceHeardBanner.innerHTML = `Confirmed Ready (${triggerSource}) &rarr; <strong>Starting Drill!</strong>`;
    proceedAfterReadyConfirmed();
  }

  function proceedAfterReadyConfirmed() {
    const cfg = state.activeRunConfig;
    if (!cfg) return;

    setDrillPhaseUI('COUNTDOWN', `REP ${cfg.repNumber}/${cfg.totalReps} • STANDBY`);

    if (cfg.drillId === 'walk_draw_shoot') {
      runWalkTwoStageDrill(cfg);
      return;
    }

    // For Exact #s Draw: after Standby delay, it says "Draw!" and counts down aloud ("3, 2, 1, Fire!")
    if (cfg.drillId === 'draw_exact') {
      const randomDelayMs = Math.floor(1400 + Math.random() * 1800);
      el.activeCueBanner.textContent = 'Standby for "Draw!" & Countdown...';
      scheduleTimeout(() => runExactDrawSpokenCountdown(cfg), randomDelayMs);
      return;
    }

    const mode = el.countdownModeSelect.value;
    if (mode === 'countdown_5' || mode === 'countdown_5_instant') {
      runFiveSecondCountdown(mode === 'countdown_5_instant');
    } else if (mode === 'instant') {
      el.activeCueBanner.textContent = `Standby...`;
      scheduleTimeout(() => beginLiveFirePhase(), 1000);
    } else {
      const randomDelayMs = Math.floor(1500 + Math.random() * 2000);
      el.activeCueBanner.textContent = 'Standby... Waiting for Signal...';
      scheduleTimeout(() => beginLiveFirePhase(), randomDelayMs);
    }
  }

  /**
   * Executes the Exact #s Draw Drill:
   * Announces "Draw!", then counts down aloud in spoken voice ("# ... 2 ... 1 ... Fire!")
   * over the targetSec duration (no beeps during countdown).
   */
  function runExactDrawSpokenCountdown(cfg) {
    const targetSec = Math.max(0.5, Number(cfg.targetSec) || 3.0);
    const wholeSec = Math.round(targetSec);

    setDrillPhaseUI('COUNTDOWN', `REP ${cfg.repNumber}/${cfg.totalReps} • DRAW!`);
    el.activeCueBanner.textContent = `DRAW! Counting down ${targetSec}s to FIRE...`;
    el.liveSplitsStrip.innerHTML = '';

    // 1. Announce "Draw!" first
    speakCue('Draw!', {
      rateOverride: 1.25,
      postGuardMs: 140,
      onEnd: () => {
        if (state.phase === 'IDLE') return;

        // Start the visual timer clock & live shot listener at 0.00s as the #s draw countdown begins
        state.signalTimestampMs = performance.now();
        setDrillPhaseUI('LIVE', `REP ${cfg.repNumber}/${cfg.totalReps} • DRAW COUNTDOWN`);
        startClockAnimationLoop();

        if (!cfg.pacedVoiceGuide || targetSec < 1.2) {
          // For sub-second draws (or if spoken countdown unchecked), wait targetSec and call "Fire!"
          scheduleTimeout(() => {
            if (state.phase !== 'LIVE') return;
            el.activeCueBanner.textContent = `FIRE! (${targetSec.toFixed(2)}s Mark)`;
            speakCue('Fire!', { rateOverride: 1.3, postGuardMs: 130 });
          }, Math.round(targetSec * 1000));
          return;
        }

        // 2. Spoken countdown: e.g. for 3s -> "3" (at 0s), "2" (at 1s), "1" (at 2s), "Fire!" (at 3s)
        for (let i = 0; i < wholeSec; i++) {
          const countNum = wholeSec - i;
          scheduleTimeout(() => {
            if (state.phase !== 'LIVE') return;
            el.activeCueBanner.textContent = `Draw Countdown: ${countNum}...`;
            speakCue(String(countNum), {
              rateOverride: 1.35,
              postGuardMs: 130
            });
          }, i * 1000);
        }

        // 3. At exactly wholeSec (targetSec), speak "Fire!"
        scheduleTimeout(() => {
          if (state.phase !== 'LIVE') return;
          el.activeCueBanner.textContent = `FIRE! (${targetSec.toFixed(2)}s Target Mark)`;
          speakCue('Fire!', {
            rateOverride: 1.3,
            postGuardMs: 130
          });
        }, wholeSec * 1000);
      }
    });
  }

  function runFiveSecondCountdown(immediateFireAfterOne) {
    const steps = ['5', '4', '3', '2', '1'];
    steps.forEach((step, idx) => {
      scheduleTimeout(() => {
        if (state.phase !== 'COUNTDOWN') return;
        el.activeCueBanner.textContent = `Countdown: ${step}...`;
        speakCue(step, { rateOverride: 1.3, postGuardMs: 140 });
      }, idx * 1000);
    });

    scheduleTimeout(() => {
      if (state.phase !== 'COUNTDOWN') return;
      if (immediateFireAfterOne) {
        beginLiveFirePhase();
      } else {
        el.activeCueBanner.textContent = 'Standby...';
        const randomDelayMs = Math.floor(1200 + Math.random() * 2000);
        scheduleTimeout(() => beginLiveFirePhase(), randomDelayMs);
      }
    }, 5000);
  }

  function runWalkTwoStageDrill(cfg) {
    const walkPhrase = cfg.resolvedBriefing.resolvedWalk;
    setDrillPhaseUI('WALKING', 'STAGE 1: WALKING');
    el.activeCueBanner.textContent = `Begin ${walkPhrase} (Holstered)...`;

    speakCue(`Begin ${walkPhrase}`, {
      postGuardMs: 250,
      onEnd: () => {
        if (state.phase !== 'WALKING') return;
        const walkTimeMs = Math.floor(2000 + Math.random() * 1800);
        scheduleTimeout(() => {
          if (state.phase !== 'WALKING') return;
          setDrillPhaseUI('DRAWN_WAITING', '1ST SIGNAL: DRAW!');
          state.firstSignalTimestampMs = performance.now();
          el.activeCueBanner.textContent =
            '1ST SIGNAL: DRAW WEAPON! (Wait for 2nd signal to shoot)';
          speakCue('Draw!', { rateOverride: 1.25, postGuardMs: 180 });

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
      state.activeContextLabel = `${cfg.resolvedBriefing.shooterState} • ${voiceSignal} (Rep ${cfg.repNumber}/${cfg.totalReps})`;
    } else if (cfg.drillId === 'turned_holster') {
      voiceSignal = 'Turn and Fire!';
    }

    setDrillPhaseUI('LIVE', `REP ${cfg.repNumber}/${cfg.totalReps} • LIVE FIRE!`);
    el.activeCueBanner.textContent = `SIGNAL: ${voiceSignal.toUpperCase()}`;
    el.liveSplitsStrip.innerHTML = '';

    triggerGoSignal(voiceSignal, () => {
      state.signalTimestampMs = performance.now();
    });
    if (!state.signalTimestampMs) {
      state.signalTimestampMs = performance.now();
    }

    const targetSec = Number(cfg.targetSec) || 2.0;
    if (targetSec > 0) {
      scheduleTimeout(() => {
        if (state.phase === 'LIVE') {
          playTimerBeep(160, 1000, 0.45);
        }
      }, Math.round(targetSec * 1000));
    }

    startClockAnimationLoop();
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
      speakCue('Reload!', { rateOverride: 1.25, postGuardMs: 180 });
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
        ? Math.abs(deltaSec) <= 0.35
          ? 'var(--accent-green)'
          : 'var(--accent-amber)'
        : deltaSec <= 0
          ? 'var(--accent-green)'
          : 'var(--accent-amber)';

    setDrillPhaseUI('IDLE', `REP ${cfg.repNumber}/${cfg.totalReps} COMPLETE`);

    if (cfg.drillId === 'draw_exact') {
      el.activeCueBanner.textContent = `Rep ${cfg.repNumber}/${cfg.totalReps} Done! Target: ${targetSec.toFixed(2)}s | 1st: ${firstShotSec.toFixed(2)}s | Total: ${totalSec.toFixed(2)}s`;
    } else {
      el.activeCueBanner.textContent = `Rep ${cfg.repNumber}/${cfg.totalReps} Done! Total: ${totalSec.toFixed(2)}s | 1st Shot: ${firstShotSec.toFixed(2)}s`;
    }

    el.startDrillBtn.disabled = false;
    el.startDrillBtn.textContent = 'START DRILL';
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

    const activeItem = getActiveQueuedDrill();
    const totalRepsForDrill = activeItem.reps || 1;
    let hasMoreInSet = false;

    if (el.autoAdvanceQueueCheckbox.checked) {
      if (state.activeRepIndex < totalRepsForDrill) {
        state.activeRepIndex++;
        hasMoreInSet = true;
      } else {
        state.activeRepIndex = 1;
        if (state.activeQueueIndex + 1 < state.queue.length) {
          state.activeQueueIndex++;
          hasMoreInSet = true;
        } else {
          state.activeQueueIndex = 0;
          hasMoreInSet = false;
        }
      }
      renderQueueUI();
    }

    if (el.autoPromptReadyCheckbox.checked && hasMoreInSet) {
      const restSec = Math.max(2, parseInt(el.autoRepeatSecInput.value, 10) || 4);
      el.activeCueBanner.textContent += ` • Next rep in ${restSec}s...`;
      scheduleTimeout(() => {
        if (state.phase === 'IDLE' && el.autoPromptReadyCheckbox.checked) {
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
    state.readyListenerArmed = false;

    if (state.phase === 'LIVE' && state.shots.length > 0) {
      completeDrillRun();
      return;
    }

    state.phase = 'IDLE';
    setDrillPhaseUI('IDLE', 'STANDBY / IDLE');
    el.activeCueBanner.textContent = reason;
    el.startDrillBtn.disabled = false;
    el.startDrillBtn.textContent = 'START DRILL';
    el.manualShotBtn.disabled = true;
    el.stopDrillBtn.disabled = true;
    el.meterThresholdLine.style.left = `${state.thresholdPercent}%`;
    updateHandsFreeQuickBadge();
  }

  function setDrillPhaseUI(phase, badgeText) {
    state.phase = phase;
    el.drillPhaseBadge.textContent = badgeText;
    el.timerCard.classList.remove(
      'phase-standby',
      'phase-waiting-ready',
      'phase-live'
    );
    if (phase === 'WAITING_FOR_READY') {
      el.timerCard.classList.add('phase-waiting-ready');
    } else if (
      phase === 'BRIEFING' ||
      phase === 'ASKING_READY' ||
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
      'ShooterStateAndRep',
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
    el.menuToggleBtn.addEventListener('click', openDrawer);
    el.closeDrawerBtn.addEventListener('click', closeDrawer);
    el.navBackdrop.addEventListener('click', closeDrawer);

    el.drawerLinks.forEach((link) => {
      link.addEventListener('click', () => {
        switchView(link.dataset.view);
      });
    });

    el.micQuickToggleBtn.addEventListener('click', () => toggleMicDetector());
    el.wakeLockBtn.addEventListener('click', toggleWakeLock);

    el.quickExplainToggle.addEventListener('change', () => {
      el.announceDrillExplanationCheckbox.checked = el.quickExplainToggle.checked;
    });
    el.announceDrillExplanationCheckbox.addEventListener('change', () => {
      el.quickExplainToggle.checked = el.announceDrillExplanationCheckbox.checked;
    });

    el.prevQueueBtn.addEventListener('click', () => stepQueue(-1));
    el.nextQueueBtn.addEventListener('click', () => stepQueue(1));
    el.openDrillsMenuBtn.addEventListener('click', () => switchView('view-drills'));

    el.startDrillBtn.addEventListener('click', startActiveQueuedDrill);
    el.manualShotBtn.addEventListener('click', () =>
      registerShot(performance.now(), 'TAP')
    );
    el.stopDrillBtn.addEventListener('click', () => stopDrill('Drill stopped'));

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
      el.drillRepsInput,
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

    el.addToQueueBtn.addEventListener('click', () => {
      const newItem = getBuilderDrillItem();
      state.queue.push(newItem);
      state.activeQueueIndex = state.queue.length - 1;
      state.activeRepIndex = 1;
      saveQueueToStorage();
      renderQueueUI();
    });

    el.useSingleDrillBtn.addEventListener('click', () => {
      const newItem = getBuilderDrillItem();
      state.queue = [newItem];
      state.activeQueueIndex = 0;
      state.activeRepIndex = 1;
      saveQueueToStorage();
      renderQueueUI();
      switchView('view-timer');
    });

    el.drillQueueList.addEventListener('click', (e) => {
      const repBtn = e.target.closest('[data-q-rep-delta]');
      if (repBtn) {
        e.stopPropagation();
        const idx = parseInt(repBtn.dataset.qIdx, 10);
        const delta = parseInt(repBtn.dataset.qRepDelta, 10);
        if (state.queue[idx]) {
          const currentReps = Math.max(1, parseInt(state.queue[idx].reps, 10) || 1);
          state.queue[idx].reps = Math.min(50, Math.max(1, currentReps + delta));
          if (idx === state.activeQueueIndex && state.activeRepIndex > state.queue[idx].reps) {
            state.activeRepIndex = state.queue[idx].reps;
          }
          saveQueueToStorage();
          renderQueueUI();
        }
        return;
      }

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
        state.activeRepIndex = 1;
        saveQueueToStorage();
        renderQueueUI();
        return;
      }

      const row = e.target.closest('[data-queue-idx]');
      if (row) {
        state.activeQueueIndex = parseInt(row.dataset.queueIdx, 10) || 0;
        state.activeRepIndex = 1;
        renderQueueUI();
        switchView('view-timer');
      }
    });

    el.loadSampleQueueBtn.addEventListener('click', () => {
      state.queue = createDefaultSampleQueue();
      state.activeQueueIndex = 0;
      state.activeRepIndex = 1;
      saveQueueToStorage();
      renderQueueUI();
    });

    el.clearQueueBtn.addEventListener('click', () => {
      state.queue = [getBuilderDrillItem()];
      state.activeQueueIndex = 0;
      state.activeRepIndex = 1;
      saveQueueToStorage();
      renderQueueUI();
    });

    el.autoPromptReadyCheckbox.addEventListener('change', () => {
      el.paramAutoRepeatDelayWrap.classList.toggle(
        'hidden',
        !el.autoPromptReadyCheckbox.checked
      );
    });

    // Settings & Audio Controls
    el.thresholdSlider.addEventListener('input', () => {
      const val = parseInt(el.thresholdSlider.value, 10);
      state.thresholdPercent = val;
      el.thresholdSliderVal.textContent = `${val}%`;
      if (state.phase !== 'WAITING_FOR_READY') {
        el.meterThresholdLine.style.left = `${val}%`;
      }
    });

    el.voiceThresholdSlider.addEventListener('input', () => {
      const val = parseInt(el.voiceThresholdSlider.value, 10);
      state.voiceThresholdPercent = val;
      el.voiceThresholdSliderVal.textContent = `${val}%`;
      if (state.phase === 'WAITING_FOR_READY') {
        el.meterThresholdLine.style.left = `${val}%`;
      }
    });

    el.debounceSlider.addEventListener('input', () => {
      const val = parseInt(el.debounceSlider.value, 10);
      state.debounceMs = val;
      el.debounceSliderVal.textContent = `${val} ms`;
    });

    el.calibrateMicBtn.addEventListener('click', () => toggleMicDetector());
    el.testBeepBtn.addEventListener('click', () => playTimerBeep(240));

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
    initSpeechRecognition();
    bindEvents();
    selectBuilderDrillTile('draw_exact');
    loadQueueFromStorage();
    loadLogsFromStorage();
    updateHandsFreeQuickBadge();
  }

  init();
})();

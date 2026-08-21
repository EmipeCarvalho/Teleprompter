(function () {
  "use strict";

  var STORAGE_KEY = "teleprompter:state:v1";

  var defaultState = {
    script: "",
    speed: 5,
    fontSize: 42,
    align: "left",
    mirror: false
  };

  var state = loadState();

  // ---------- elements ----------
  var setupScreen = document.getElementById("setup-screen");
  var prompterScreen = document.getElementById("prompter-screen");

  var scriptInput = document.getElementById("script-input");
  var speedRange = document.getElementById("speed-range");
  var speedValue = document.getElementById("speed-value");
  var fontRange = document.getElementById("font-range");
  var fontValue = document.getElementById("font-value");
  var alignSegmented = document.getElementById("align-segmented");
  var mirrorToggle = document.getElementById("mirror-toggle");
  var fullscreenBtn = document.getElementById("fullscreen-btn");
  var startBtn = document.getElementById("start-btn");

  var scrollContainer = document.getElementById("scroll-container");
  var textContent = document.getElementById("text-content");
  var tapZone = document.getElementById("tap-zone");
  var controlsOverlay = document.getElementById("controls-overlay");

  var exitBtn = document.getElementById("exit-btn");
  var restartBtn = document.getElementById("restart-btn");
  var fontDecBtn = document.getElementById("font-dec-btn");
  var fontIncBtn = document.getElementById("font-inc-btn");
  var speedDecBtn = document.getElementById("speed-dec-btn");
  var speedIncBtn = document.getElementById("speed-inc-btn");
  var playPauseBtn = document.getElementById("play-pause-btn");

  // ---------- runtime scroll state ----------
  var isPlaying = false;
  var rafId = null;
  var lastTimestamp = null;
  var scrollPosition = 0; // fractional px, more precise than scrollTop
  var wakeLock = null;
  var hideControlsTimer = null;

  // ---------- persistence ----------
  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return Object.assign({}, defaultState);
      var parsed = JSON.parse(raw);
      return Object.assign({}, defaultState, parsed);
    } catch (e) {
      return Object.assign({}, defaultState);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* ignore quota / private mode errors */
    }
  }

  // ---------- setup screen sync ----------
  function applyStateToSetupUI() {
    scriptInput.value = state.script;
    speedRange.value = state.speed;
    speedValue.textContent = state.speed;
    fontRange.value = state.fontSize;
    fontValue.textContent = state.fontSize;
    setAlignUI(state.align);
    setMirrorUI(state.mirror);
  }

  function setAlignUI(align) {
    var btns = alignSegmented.querySelectorAll(".segmented-btn");
    btns.forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.align === align);
    });
  }

  function setMirrorUI(mirror) {
    mirrorToggle.setAttribute("aria-pressed", mirror ? "true" : "false");
    mirrorToggle.textContent = "Espelhamento: " + (mirror ? "Ligado" : "Desligado");
  }

  scriptInput.addEventListener("input", function () {
    state.script = scriptInput.value;
    saveState();
  });

  speedRange.addEventListener("input", function () {
    state.speed = parseInt(speedRange.value, 10);
    speedValue.textContent = state.speed;
    saveState();
  });

  fontRange.addEventListener("input", function () {
    state.fontSize = parseInt(fontRange.value, 10);
    fontValue.textContent = state.fontSize;
    saveState();
  });

  alignSegmented.addEventListener("click", function (e) {
    var btn = e.target.closest(".segmented-btn");
    if (!btn) return;
    state.align = btn.dataset.align;
    setAlignUI(state.align);
    saveState();
  });

  mirrorToggle.addEventListener("click", function () {
    state.mirror = !state.mirror;
    setMirrorUI(state.mirror);
    saveState();
  });

  fullscreenBtn.addEventListener("click", function () {
    requestFullscreenSafe(document.documentElement);
  });

  startBtn.addEventListener("click", function () {
    if (!scriptInput.value.trim()) {
      scriptInput.focus();
      return;
    }
    state.script = scriptInput.value;
    saveState();
    enterPrompter();
    requestFullscreenSafe(document.documentElement);
  });

  function requestFullscreenSafe(el) {
    try {
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) req.call(el);
    } catch (e) {
      /* fullscreen not supported (e.g. iOS Safari) — ignore */
    }
  }

  // ---------- prompter screen ----------
  function enterPrompter() {
    applyTextContent();
    setupScreen.classList.add("hidden");
    prompterScreen.classList.remove("hidden");
    resetScrollPosition();
    showControls();
    scheduleAutoHide();
    play();
    requestWakeLock();
  }

  function exitPrompter() {
    pause();
    prompterScreen.classList.add("hidden");
    setupScreen.classList.remove("hidden");
    releaseWakeLock();
    if (document.fullscreenElement) {
      try {
        document.exitFullscreen();
      } catch (e) {
        /* ignore */
      }
    }
  }

  function applyTextContent() {
    textContent.textContent = state.script;
    textContent.style.fontSize = state.fontSize + "px";
    textContent.classList.toggle("align-left", state.align === "left");
    textContent.classList.toggle("align-center", state.align === "center");
    textContent.classList.toggle("mirrored", !!state.mirror);
  }

  function resetScrollPosition() {
    // Start with the first line visible near the top, roughly one screen
    // of blank space above so the reader has time to get ready, and enough
    // blank space below so the last line fully scrolls off screen.
    var viewportH = scrollContainer.clientHeight;
    textContent.style.paddingTop = viewportH * 0.6 + "px";
    textContent.style.paddingBottom = viewportH * 0.9 + "px";
    scrollPosition = 0;
    scrollContainer.scrollTop = 0;
  }

  // ---------- scroll animation ----------
  function speedToPixelsPerSecond(speed) {
    // speed range 1-10 -> gentle to fast reading scroll speed
    return speed * 16;
  }

  function tick(timestamp) {
    if (!isPlaying) return;
    if (lastTimestamp === null) lastTimestamp = timestamp;
    var deltaSeconds = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;

    var pxPerSecond = speedToPixelsPerSecond(state.speed);
    scrollPosition += pxPerSecond * deltaSeconds;

    var maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
    if (scrollPosition >= maxScroll) {
      scrollPosition = maxScroll;
      scrollContainer.scrollTop = scrollPosition;
      pause();
      return;
    }

    scrollContainer.scrollTop = scrollPosition;
    rafId = requestAnimationFrame(tick);
  }

  function play() {
    if (isPlaying) return;
    isPlaying = true;
    lastTimestamp = null;
    playPauseBtn.textContent = "❚❚";
    playPauseBtn.setAttribute("aria-label", "Pausar");
    rafId = requestAnimationFrame(tick);
    scheduleAutoHide();
  }

  function pause() {
    isPlaying = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    playPauseBtn.textContent = "▶";
    playPauseBtn.setAttribute("aria-label", "Reproduzir");
    showControls();
    clearAutoHide();
  }

  function togglePlayPause() {
    if (isPlaying) pause();
    else play();
  }

  // ---------- controls visibility ----------
  function showControls() {
    controlsOverlay.classList.remove("controls-hidden");
  }

  function hideControls() {
    controlsOverlay.classList.add("controls-hidden");
  }

  function scheduleAutoHide() {
    clearAutoHide();
    hideControlsTimer = setTimeout(function () {
      if (isPlaying) hideControls();
    }, 2800);
  }

  function clearAutoHide() {
    if (hideControlsTimer) clearTimeout(hideControlsTimer);
    hideControlsTimer = null;
  }

  tapZone.addEventListener("click", function () {
    togglePlayPause();
    showControls();
    if (isPlaying) scheduleAutoHide();
  });

  controlsOverlay.addEventListener("click", function () {
    showControls();
    if (isPlaying) scheduleAutoHide();
  });

  // ---------- prompter controls ----------
  exitBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    exitPrompter();
  });

  restartBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    resetScrollPosition();
  });

  playPauseBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    togglePlayPause();
  });

  speedIncBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    state.speed = Math.min(10, state.speed + 1);
    saveState();
  });

  speedDecBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    state.speed = Math.max(1, state.speed - 1);
    saveState();
  });

  fontIncBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    state.fontSize = Math.min(96, state.fontSize + 4);
    textContent.style.fontSize = state.fontSize + "px";
    saveState();
  });

  fontDecBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    state.fontSize = Math.max(18, state.fontSize - 4);
    textContent.style.fontSize = state.fontSize + "px";
    saveState();
  });

  window.addEventListener("resize", function () {
    if (!prompterScreen.classList.contains("hidden")) {
      // keep current relative position stable-ish on resize/orientation change
      var wasPlaying = isPlaying;
      pause();
      scrollPosition = scrollContainer.scrollTop;
      if (wasPlaying) play();
    }
  });

  // ---------- screen wake lock ----------
  function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    navigator.wakeLock.request("screen").then(function (lock) {
      wakeLock = lock;
    }).catch(function () {
      /* ignore — not critical */
    });
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(function () {});
      wakeLock = null;
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" &&
        !prompterScreen.classList.contains("hidden")) {
      requestWakeLock();
    }
  });

  // ---------- init ----------
  applyStateToSetupUI();
})();

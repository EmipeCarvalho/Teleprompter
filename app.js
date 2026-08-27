(function () {
  "use strict";

  var STORAGE_KEY = "teleprompter:state:v1";

  var defaultState = {
    script: "",
    speed: 5,
    fontSize: 42,
    align: "left",
    mirror: false,
    cameraEnabled: false
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
  var cameraToggle = document.getElementById("camera-toggle");
  var cameraWarning = document.getElementById("camera-warning");
  var fullscreenBtn = document.getElementById("fullscreen-btn");
  var startBtn = document.getElementById("start-btn");

  var scrollContainer = document.getElementById("scroll-container");
  var textContent = document.getElementById("text-content");
  var controlsOverlay = document.getElementById("controls-overlay");

  var exitBtn = document.getElementById("exit-btn");
  var restartBtn = document.getElementById("restart-btn");
  var fontDecBtn = document.getElementById("font-dec-btn");
  var fontIncBtn = document.getElementById("font-inc-btn");
  var speedDecBtn = document.getElementById("speed-dec-btn");
  var speedIncBtn = document.getElementById("speed-inc-btn");
  var playPauseBtn = document.getElementById("play-pause-btn");
  var recIndicator = document.getElementById("rec-indicator");

  var cameraVideo = document.getElementById("camera-video");
  var cameraFlipBtn = document.getElementById("camera-flip-btn");
  var recordRow = document.getElementById("record-row");
  var recordBtn = document.getElementById("record-btn");
  var reviewScreen = document.getElementById("review-screen");
  var reviewVideo = document.getElementById("review-video");
  var reviewSaveBtn = document.getElementById("review-save-btn");
  var reviewRetakeBtn = document.getElementById("review-retake-btn");
  var reviewExitBtn = document.getElementById("review-exit-btn");
  var toast = document.getElementById("toast");
  var exitConfirm = document.getElementById("exit-confirm");
  var exitConfirmCancelBtn = document.getElementById("exit-confirm-cancel");
  var exitConfirmOkBtn = document.getElementById("exit-confirm-ok");

  // ---------- runtime scroll state ----------
  var isPlaying = false;
  var rafId = null;
  var lastTimestamp = null;
  var scrollPosition = 0; // fractional px, more precise than scrollTop
  var wakeLock = null;
  var hideControlsTimer = null;
  var toastTimer = null;

  // ---------- runtime camera/recording state ----------
  var cameraStream = null;
  var cameraFacing = "user";
  var mediaRecorder = null;
  var recordedChunks = [];
  var isRecording = false;
  var lastRecordingUrl = null;

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
    setCameraUI(state.cameraEnabled);
  }

  function cameraApiAvailable() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  function setCameraUI(cameraEnabled) {
    cameraToggle.setAttribute("aria-pressed", cameraEnabled ? "true" : "false");
    cameraToggle.textContent = "Câmera: " + (cameraEnabled ? "Ligada" : "Desligada");
    cameraWarning.classList.toggle("hidden", !cameraEnabled || cameraApiAvailable());
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

  cameraToggle.addEventListener("click", function () {
    state.cameraEnabled = !state.cameraEnabled;
    setCameraUI(state.cameraEnabled);
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

  // Avisos aparecem na própria tela em vez de alert()/confirm(): dentro de
  // um iframe restrito (como o preview de artifacts), diálogos nativos do
  // navegador podem ser bloqueados silenciosamente, deixando o app parecer
  // travado sem explicação nenhuma.
  function showToast(message) {
    toast.textContent = message;
    toast.classList.remove("hidden");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.add("hidden");
    }, 4500);
  }

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
    if (state.cameraEnabled) startCamera();
  }

  function exitPrompter() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.onstop = null; // sair descarta a gravação em andamento
      mediaRecorder.stop();
    }
    isRecording = false;
    pause();
    stopCamera();
    hideReview();
    exitConfirm.classList.add("hidden");
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

  // O texto rola nativamente com o dedo (a área já é um contêiner com
  // overflow-y: scroll — o navegador cuida do arrastar/momentum sozinho).
  // Um toque simples (sem arrastar) dá play/pause; o próprio navegador não
  // dispara "click" depois de um gesto de rolagem, então os dois convivem
  // sem gesto customizado nenhum. O pointerdown já pausa (pra não brigar
  // com o arrasto), então o click decide com base no estado ANTES do
  // toque, não no que ficou logo depois do pointerdown.
  var wasPlayingBeforeTouch = false;

  scrollContainer.addEventListener("pointerdown", function () {
    wasPlayingBeforeTouch = isPlaying;
    if (isPlaying) pause();
  });

  scrollContainer.addEventListener("click", function () {
    if (!wasPlayingBeforeTouch) {
      play();
      scheduleAutoHide();
    }
    showControls();
  });

  scrollContainer.addEventListener("scroll", function () {
    scrollPosition = scrollContainer.scrollTop;
  });

  controlsOverlay.addEventListener("click", function () {
    showControls();
    if (isPlaying) scheduleAutoHide();
  });

  // ---------- câmera ----------
  function requestCameraStream(facing) {
    // Nenhum aspect ratio é pedido: mesmo como "ideal", isso faz o iPhone
    // recortar/ampliar a imagem do sensor pra tentar atingir a proporção,
    // dando um efeito de zoom indesejado. Deixamos a câmera abrir no campo
    // de visão natural dela; o enquadramento em tela (e o corte visual
    // pra caber na tela cheia) é só CSS (object-fit: cover), não afeta o
    // que a câmera realmente captura.
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing },
      audio: true
    });
  }

  function startCamera() {
    if (!cameraApiAvailable()) {
      showToast("A câmera não está disponível. É necessário acessar por HTTPS (ou localhost) em um navegador compatível.");
      return;
    }
    cameraFacing = "user";
    requestCameraStream(cameraFacing).then(function (stream) {
      cameraStream = stream;
      cameraVideo.srcObject = stream;
      prompterScreen.classList.add("camera-mode");
      cameraFlipBtn.classList.remove("hidden");
      recordRow.classList.remove("hidden");
    }).catch(function (err) {
      showToast("Não foi possível acessar a câmera: " + (err && err.message ? err.message : err));
    });
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(function (t) {
        t.stop();
      });
      cameraStream = null;
    }
    cameraVideo.srcObject = null;
    prompterScreen.classList.remove("camera-mode");
    cameraFlipBtn.classList.add("hidden");
    recordRow.classList.add("hidden");
    recIndicator.classList.add("hidden");
  }

  cameraFlipBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (isRecording) return; // não troca de câmera com gravação em andamento
    var newFacing = cameraFacing === "user" ? "environment" : "user";
    requestCameraStream(newFacing).then(function (stream) {
      if (cameraStream) {
        cameraStream.getTracks().forEach(function (t) {
          t.stop();
        });
      }
      cameraStream = stream;
      cameraFacing = newFacing;
      cameraVideo.srcObject = stream;
    }).catch(function () {
      /* câmera solicitada indisponível — mantém a atual */
    });
  });

  // ---------- gravação ----------
  function pickMimeType() {
    var candidates = [
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm"
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(candidates[i])) {
        return candidates[i];
      }
    }
    return "";
  }

  function startRecording() {
    if (!cameraStream) return;
    recordedChunks = [];
    var mimeType = pickMimeType();
    try {
      mediaRecorder = mimeType ? new MediaRecorder(cameraStream, { mimeType: mimeType }) : new MediaRecorder(cameraStream);
    } catch (e) {
      showToast("Não foi possível iniciar a gravação neste navegador.");
      return;
    }
    mediaRecorder.ondataavailable = function (e) {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = function () {
      var blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || mimeType || "video/webm" });
      showReview(blob);
    };
    mediaRecorder.start();
    isRecording = true;
    recordBtn.classList.add("is-recording");
    recIndicator.classList.remove("hidden");
    if (!isPlaying) play();
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    isRecording = false;
    recordBtn.classList.remove("is-recording");
    recIndicator.classList.add("hidden");
    pause();
  }

  recordBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (isRecording) stopRecording();
    else startRecording();
  });

  // ---------- revisão do vídeo gravado ----------
  function showReview(blob) {
    if (lastRecordingUrl) URL.revokeObjectURL(lastRecordingUrl);
    lastRecordingUrl = URL.createObjectURL(blob);
    reviewVideo.src = lastRecordingUrl;
    reviewScreen.dataset.mimeType = blob.type;
    reviewScreen.classList.remove("hidden");
  }

  function hideReview() {
    reviewScreen.classList.add("hidden");
    reviewVideo.pause();
    reviewVideo.removeAttribute("src");
    reviewVideo.load();
  }

  function saveBlob(blob, mimeType) {
    var ext = mimeType && mimeType.indexOf("mp4") !== -1 ? "mp4" : "webm";
    var filename = "teleprompter-" + Date.now() + "." + ext;
    var file = null;
    try {
      file = new File([blob], filename, { type: mimeType || blob.type });
    } catch (e) {
      /* File API indisponível — cai no download direto */
    }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: "Teleprompter" }).catch(function () {});
      return;
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 30000);
  }

  reviewSaveBtn.addEventListener("click", function () {
    if (!lastRecordingUrl) return;
    fetch(lastRecordingUrl).then(function (r) {
      return r.blob();
    }).then(function (blob) {
      saveBlob(blob, reviewScreen.dataset.mimeType);
    });
  });

  reviewRetakeBtn.addEventListener("click", function () {
    hideReview();
    resetScrollPosition();
  });

  reviewExitBtn.addEventListener("click", function () {
    hideReview();
    exitPrompter();
  });

  // ---------- prompter controls ----------
  exitBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (isRecording) {
      exitConfirm.classList.remove("hidden");
      return;
    }
    exitPrompter();
  });

  exitConfirmCancelBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    exitConfirm.classList.add("hidden");
  });

  exitConfirmOkBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    exitConfirm.classList.add("hidden");
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

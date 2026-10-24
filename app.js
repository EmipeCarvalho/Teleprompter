(function () {
  "use strict";

  var STORAGE_KEY = "teleprompter:state:v1";

  var defaultState = {
    script: "",
    speed: 5,
    fontSize: 42,
    align: "left",
    mirror: false,
    cameraEnabled: false,
    textWidth: 72,
    textTop: 6,
    lineHeight: 1.45,
    quality: "1080",
    audioMode: "natural"
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
  var reviewInfo = document.getElementById("review-info");
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
  var originalBlob = null;
  var cameraGeneration = 0;
  var dragging = false;
  var dragMoved = false;
  var dragStartY = 0;
  var resumeAfterDrag = false;
  var dragTimer = null;
  var finalizing = false;
  var audioContext = null;
  var meterFrame = null;
  var backupDb = null;
  function startAudioMeter(stream) {
    stopAudioMeter();
    var Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try {
      audioContext = new Audio();
      var source = audioContext.createMediaStreamSource(stream);
      var analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser); // No connection to speakers: avoids feedback.
      var data = new Uint8Array(analyser.fftSize);
      function draw() {
        analyser.getByteTimeDomainData(data);
        var sum = 0;
        for (var i = 0; i < data.length; i++) sum += Math.pow((data[i] - 128) / 128, 2);
        var level = Math.sqrt(sum / data.length);
        document.getElementById("audio-meter").value = Math.min(100, level * 250);
        document.getElementById("audio-level").textContent = audioContext.state !== "running" ? "Toque em Gravar para ativar o medidor" : level > 0.8 ? "Áudio muito alto" : level > 0.01 ? "Microfone captando" : "Áudio baixo / silêncio";
        meterFrame = requestAnimationFrame(draw);
      }
      draw();
    } catch (e) { document.getElementById("audio-level").textContent = "Medidor indisponível"; }
  }
  function stopAudioMeter() {
    if (meterFrame) cancelAnimationFrame(meterFrame);
    meterFrame = null;
    if (audioContext) audioContext.close().catch(function () {});
    audioContext = null;
  }
  var backupReady = new Promise(function (resolve) {
    if (!window.indexedDB) return resolve(null);
    var req = indexedDB.open("teleprompter-recordings", 1);
    req.onupgradeneeded = function () { req.result.createObjectStore("recordings"); };
    req.onsuccess = function () { backupDb = req.result; resolve(backupDb); };
    req.onerror = function () { resolve(null); };
  });
  function backupRecording(blob) {
    return backupReady.then(function (db) {
      if (!db) { showToast("Backup indisponível. Salve o vídeo antes de sair."); return; }
      return new Promise(function (resolve) {
        var tx = db.transaction("recordings", "readwrite");
        tx.objectStore("recordings").put(blob, "latest");
        tx.oncomplete = resolve;
        tx.onerror = function () { showToast("Não foi possível guardar o backup. Salve o vídeo agora."); resolve(); };
        tx.onabort = tx.onerror;
      });
    });
  }
  window.addEventListener("beforeunload", function (e) {
    if (isRecording || finalizing) { e.preventDefault(); e.returnValue = ""; }
  });

  // ---------- persistence ----------
  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return Object.assign({}, defaultState);
      var parsed = JSON.parse(raw);
      var loaded = Object.assign({}, defaultState, parsed);
      ["speed", "fontSize", "textWidth", "textTop", "lineHeight"].forEach(function (key) {
        var bounds = { speed: [0.25, 20], fontSize: [16, 120], textWidth: [40, 100], textTop: [0, 45], lineHeight: [1.1, 2] }[key];
        loaded[key] = Number.isFinite(Number(loaded[key])) ? Math.max(bounds[0], Math.min(bounds[1], Number(loaded[key]))) : defaultState[key];
      });
      return loaded;
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
    state.speed = parseFloat(speedRange.value);
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
    pause();
    requestWakeLock();
    if (state.cameraEnabled) startCamera();
  }

  function exitPrompter() {
    cameraGeneration++;
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.onstop = null; // sair descarta a gravação em andamento
      mediaRecorder.stop();
    }
    isRecording = false;
    finalizing = false;
    recordBtn.classList.remove("is-recording");
    pause();
    stopCamera();
    hideReview();
    exitConfirm.classList.add("hidden");
    prompterScreen.classList.add("hidden");
    setupScreen.classList.remove("hidden");
    applyStateToSetupUI();
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
    textContent.style.paddingTop = viewportH * 0.12 + "px";
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
    if (dragging) { lastTimestamp = null; rafId = requestAnimationFrame(tick); return; }
    if (lastTimestamp === null) lastTimestamp = timestamp;
    var deltaSeconds = Math.min(0.1, (timestamp - lastTimestamp) / 1000);
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
  scrollContainer.addEventListener("pointerdown", function (e) {
    dragging = true; dragMoved = false; dragStartY = e.clientY;
    resumeAfterDrag = isPlaying;
    clearTimeout(dragTimer);
  });
  scrollContainer.addEventListener("pointermove", function (e) {
    if (Math.abs(e.clientY - dragStartY) > 6) dragMoved = true;
  });
  function finishDrag() {
    dragTimer = setTimeout(function () {
      scrollPosition = scrollContainer.scrollTop;
      dragging = false; lastTimestamp = null;
    }, 180);
  }
  window.addEventListener("pointerup", finishDrag);
  window.addEventListener("pointercancel", finishDrag);
  scrollContainer.addEventListener("click", function () {
    if (!dragMoved) {
      dragging = false;
      if (resumeAfterDrag) pause(); else play();
    }
    showControls();
  });
  scrollContainer.addEventListener("scroll", function () {
    scrollPosition = scrollContainer.scrollTop;
    if (dragging) finishDrag();
  });

  controlsOverlay.addEventListener("click", function () {
    showControls();
    if (isPlaying) scheduleAutoHide();
  });

  // ---------- câmera ----------
  function requestCameraStream(facing) {
    // Pedimos Full HD nas dimensões NATIVAS do sensor (1920x1080, paisagem;
    // o iPhone gira o quadro sozinho quando o aparelho está em pé). Isso
    // casa com um modo real da câmera, então ela usa o campo de visão
    // completo. Pedir dimensões em retrato (1080x1920) ou um aspect ratio
    // não corresponde a nenhum modo nativo e faz o iPhone "aproximar"
    // recortando/ampliando o sensor — era isso que causava o zoom. Sem
    // pedir resolução nenhuma, o Safari cai no padrão (~640x480), que é
    // baixo demais para um vídeo final.
    return navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: facing,
        width: { ideal: state.quality === "720" ? 1280 : 1920 },
        height: { ideal: state.quality === "720" ? 720 : 1080 },
        frameRate: { ideal: 30, max: 30 }
      },
      // Por padrão o navegador aplica processamentos feitos para chamadas
      // (cancelamento de eco, supressão de ruído, ganho automático) que
      // deixam a voz abafada e "metálica". Numa gravação não há eco a
      // cancelar (a prévia é muda), então pedimos o áudio cru, como o app
      // de Câmera nativo. "ideal" = preferência: se o aparelho não
      // suportar, continua funcionando com o padrão.
      audio: {
        echoCancellation: { ideal: false },
        noiseSuppression: { ideal: state.audioMode === "voice" },
        autoGainControl: { ideal: state.audioMode === "voice" },
        sampleRate: { ideal: 48000 },
        channelCount: { ideal: 1 }
      }
    });
  }

  // A câmera frontal é mostrada espelhada na prévia (como um espelho e como
  // o app de Câmera do iPhone faz); a traseira, não. Só a prévia é
  // espelhada — o gravador captura o stream, não o elemento na tela, então
  // o vídeo salvo fica na orientação real, igual ao padrão do iPhone.
  function applyPreviewMirror() {
    cameraVideo.classList.toggle("mirror-preview", cameraFacing === "user");
  }

  function startCamera() {
    if (!cameraApiAvailable()) {
      showToast("A câmera não está disponível. É necessário acessar por HTTPS (ou localhost) em um navegador compatível.");
      return;
    }
    var generation = ++cameraGeneration;
    cameraFacing = "user";
    requestCameraStream(cameraFacing).then(function (stream) {
      if (generation !== cameraGeneration || prompterScreen.classList.contains("hidden")) {
        stream.getTracks().forEach(function (t) { t.stop(); }); return;
      }
      cameraStream = stream;
      startAudioMeter(stream);
      cameraVideo.srcObject = stream;
      applyPreviewMirror();
      prompterScreen.classList.add("camera-mode");
      resetScrollPosition();
      cameraFlipBtn.classList.remove("hidden");
      recordRow.classList.remove("hidden");
      if (stream.getAudioTracks().length === 0) {
        showToast("Câmera ativada sem áudio. Veja Ajustes > Safari > Microfone e permita para este site.");
      }
    }).catch(function (err) {
      showToast("Não foi possível acessar a câmera: " + (err && err.message ? err.message : err));
    });
  }

  function stopCamera() {
    stopAudioMeter();
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
    var generation = ++cameraGeneration;
    cameraFlipBtn.disabled = true;
    var newFacing = cameraFacing === "user" ? "environment" : "user";
    requestCameraStream(newFacing).then(function (stream) {
      if (generation !== cameraGeneration || prompterScreen.classList.contains("hidden")) {
        stream.getTracks().forEach(function (t) { t.stop(); }); return;
      }
      if (cameraStream) {
        cameraStream.getTracks().forEach(function (t) {
          t.stop();
        });
      }
      cameraStream = stream;
      startAudioMeter(stream);
      cameraFacing = newFacing;
      cameraVideo.srcObject = stream;
      applyPreviewMirror();
    }).catch(function () {
      showToast("Não foi possível trocar a câmera.");
    }).finally(function () { cameraFlipBtn.disabled = false; });
  });

  // ---------- gravação ----------
  function pickMimeType() {
    // "video/mp4" puro primeiro — é o formato que o Safari testa e suporta
    // melhor. Strings de codec explícitas e não totalmente padronizadas
    // (ex.: "avc1,mp4a.40.2" sem o perfil/nível) podem fazer o Safari cair
    // num caminho de codificação menos testado e mais instável.
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

  // O Safari/iOS grava em MP4 "fragmentado" (fMP4). O app Fotos toca isso
  // normalmente, mas muitos editores (CapCut etc.) só entendem o MP4 clássico
  // e mostram um quadro congelado. mp4remux.js reorganiza o arquivo para o
  // layout clássico sem recodificar (rápido, sem perda). Se qualquer coisa
  // falhar, mantém o arquivo original — nunca perde a gravação.
  function finalizeRecording(blob, type) {
    if (type.indexOf("mp4") === -1 || typeof window.remuxFragmentedMp4 !== "function" || !blob.arrayBuffer) {
      return Promise.resolve(blob);
    }
    showToast("Preparando o vídeo...");
    return blob.arrayBuffer().then(function (buf) {
      var result = window.remuxFragmentedMp4(buf);
      reviewInfo.textContent = "MP4 clássico ✓ · " + result.info.tracks.map(function (t) {
        return (t.handler === "vide" ? "vídeo " : t.handler === "soun" ? "áudio " : t.handler + " ") +
          t.codec + " " + t.samples + " amostras" +
          (t.handler === "vide" ? ", " + t.sync + " keyframes (" + t.syncSource + ")" : "");
      }).join(" · ") + " · " + Math.round(blob.size / 1024) + " KB";
      return new Blob(result.parts, { type: type });
    }).catch(function (err) {
      reviewInfo.textContent = "Conversão falhou (arquivo original mantido): " + (err && err.message ? err.message : err);
      return blob;
    }).then(function (finalBlob) {
      toast.classList.add("hidden");
      return finalBlob;
    });
  }

  // Taxa de bits explícita: o padrão do gravador costuma ser baixo e deixa
  // o vídeo com aspecto "borrado" mesmo em Full HD. 8 Mbps é um valor
  // confortável para 1080p. Tentamos com bitrate + formato; se o navegador
  // rejeitar as opções, caímos para só o formato e, por fim, para o padrão.
  function createRecorder(stream, mimeType) {
    // 192 kbps de áudio: o padrão do gravador é baixo demais para voz com
    // qualidade de publicação.
    var attempts = [
      { mimeType: mimeType, videoBitsPerSecond: state.quality === "720" ? 6000000 : 12000000, audioBitsPerSecond: 192000 },
      { mimeType: mimeType, videoBitsPerSecond: state.quality === "720" ? 6000000 : 12000000 },
      { mimeType: mimeType },
      null
    ];
    for (var i = 0; i < attempts.length; i++) {
      var opts = attempts[i];
      if (opts && !opts.mimeType) delete opts.mimeType;
      try {
        return opts ? new MediaRecorder(stream, opts) : new MediaRecorder(stream);
      } catch (e) {
        /* tenta a próxima combinação */
      }
    }
    return null;
  }

  function startRecording() {
    if (!cameraStream || finalizing || isRecording) return;
    var audioTrack = cameraStream.getAudioTracks()[0];
    var captureTrack = cameraStream.getVideoTracks()[0];
    if (!audioTrack || audioTrack.readyState !== "live" || !audioTrack.enabled || audioTrack.muted || !captureTrack || captureTrack.readyState !== "live") {
      showToast("Câmera ou microfone indisponível. Ative as permissões antes de gravar."); return;
    }
    if (audioContext) audioContext.resume().catch(function () {});
    recordedChunks = [];
    var mimeType = pickMimeType();
    mediaRecorder = createRecorder(cameraStream, mimeType);
    if (!mediaRecorder) {
      showToast("Não foi possível iniciar a gravação neste navegador.");
      return;
    }
    mediaRecorder.ondataavailable = function (e) {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };
    var recorder = mediaRecorder;
    recorder.onerror = function () { showToast("Falha na gravação. Tentando preservar o vídeo capturado."); stopRecording(); };
    recorder.onstop = function () {
      finalizing = false;
      isRecording = false;
      recordBtn.classList.remove("is-recording");
      recIndicator.classList.add("hidden");
      pause();
      var type = recorder.mimeType || mimeType || "video/webm";
      originalBlob = new Blob(recordedChunks, { type: type });
      recordedChunks = [];
      if (!originalBlob.size) { showToast("O navegador não entregou dados de vídeo."); return; }
      backupRecording(originalBlob);
      reviewInfo.textContent = "Original preservado · " + Math.round(originalBlob.size / 1024) + " KB. Confira imagem e áudio antes de sair.";
      showReview(originalBlob);
    };
    try { recorder.start(1000); }
    catch (e) { showToast("Falha ao iniciar gravação: " + e.message); return; }
    isRecording = true;
    recordBtn.classList.add("is-recording");
    recIndicator.classList.remove("hidden");
    if (!isPlaying) play();

    // Em gravações mais longas, o iPhone às vezes para de entregar imagem
    // da câmera (aquecimento/economia de energia) enquanto o microfone
    // continua captando — o vídeo fica com o quadro congelado e o áudio
    // seguindo por baixo. Isso dispara o evento "mute" na faixa de vídeo;
    // detectamos e paramos a gravação na hora, com aviso, em vez de deixar
    // minutos de vídeo quebrado acontecerem sem você perceber.
    var videoTrack = cameraStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onmute = function () {
        if (isRecording) {
          showToast("A câmera parou de enviar imagem (comum em gravações longas). Gravação parada — tente takes mais curtos.");
          stopRecording();
        }
      };
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      finalizing = true;
      mediaRecorder.stop();
    }
    var videoTrack = cameraStream && cameraStream.getVideoTracks()[0];
    if (videoTrack) videoTrack.onmute = null;
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
    pause();
    if (lastRecordingUrl) URL.revokeObjectURL(lastRecordingUrl);
    lastRecordingUrl = URL.createObjectURL(blob);
    reviewVideo.src = lastRecordingUrl;
    reviewScreen.dataset.mimeType = blob.type;
    reviewScreen.dataset.converted = blob === originalBlob ? "false" : "true";
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
    if (originalBlob && !finalizing && reviewVideo.src === lastRecordingUrl) {
      // Use the in-memory Blob synchronously to preserve sharing user activation.
      if (reviewScreen.dataset.converted !== "true") {
        saveBlob(originalBlob, originalBlob.type); return;
      }
    }
    fetch(lastRecordingUrl).then(function (r) { return r.blob(); }).then(function (blob) {
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
    state.speed = Math.min(20, Math.round((state.speed + 0.25) * 100) / 100);
    saveState();
  });

  speedDecBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    state.speed = Math.max(0.25, Math.round((state.speed - 0.25) * 100) / 100);
    saveState();
  });

  fontIncBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    state.fontSize = Math.min(120, state.fontSize + 2);
    textContent.style.fontSize = state.fontSize + "px";
    saveState();
  });

  fontDecBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    state.fontSize = Math.max(16, state.fontSize - 2);
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
  function layoutText() {
    prompterScreen.style.setProperty("--reading-width", state.textWidth + "%");
    prompterScreen.style.setProperty("--reading-top", state.textTop + "vh");
    textContent.style.lineHeight = state.lineHeight;
  }
  ["textWidth", "textTop", "lineHeight", "quality", "audioMode"].forEach(function (key) {
    var el = document.getElementById(key);
    el.value = state[key];
    el.addEventListener("input", function () {
      state[key] = el.type === "range" ? Number(el.value) : el.value;
      layoutText(); saveState();
    });
  });
  document.getElementById("live-speed").addEventListener("input", function (e) {
    state.speed = Number(e.target.value); saveState();
    document.getElementById("live-speed-value").textContent = (state.speed * 16).toFixed(0) + " px/s";
  });
  document.getElementById("live-font").addEventListener("input", function (e) {
    state.fontSize = Number(e.target.value); applyTextContent(); saveState();
  });
  document.getElementById("live-settings-toggle").addEventListener("click", function () {
    var panel = document.getElementById("live-settings");
    panel.classList.toggle("hidden");
    document.getElementById("live-speed").value = state.speed;
    document.getElementById("live-font").value = state.fontSize;
    document.getElementById("live-speed-value").textContent = (state.speed * 16).toFixed(0) + " px/s";
    showControls(); clearAutoHide();
  });
  document.getElementById("review-convert-btn").addEventListener("click", function () {
    if (!originalBlob || finalizing) return;
    finalizing = true; this.disabled = true;
    var button = this;
    finalizeRecording(originalBlob, originalBlob.type).then(function (blob) {
      showReview(blob);
    }).finally(function () { finalizing = false; button.disabled = false; });
  });
  document.getElementById("review-original-btn").addEventListener("click", function () {
    if (originalBlob) saveBlob(originalBlob, originalBlob.type);
  });
  document.getElementById("recover-btn").addEventListener("click", function () {
    backupReady.then(function (db) {
      if (!db) return showSetupNotice("Backup indisponível neste navegador.");
      var req = db.transaction("recordings").objectStore("recordings").get("latest");
      req.onsuccess = function () {
        if (!req.result) return showSetupNotice("Nenhuma gravação recuperável neste navegador.");
        originalBlob = req.result;
        setupScreen.classList.add("hidden"); prompterScreen.classList.remove("hidden");
        showReview(originalBlob);
        reviewInfo.textContent = "Último original recuperado deste navegador.";
      };
      req.onerror = function () { showSetupNotice("Falha ao recuperar o backup."); };
    });
  });
  function showSetupNotice(message) { document.getElementById("setup-notice").textContent = message; }
  document.addEventListener("visibilitychange", function () {
    lastTimestamp = null;
    if (document.hidden && isRecording) {
      showToast("Gravação interrompida ao sair do aplicativo. Confira o take."); stopRecording();
    }
  });
  layoutText();
  applyStateToSetupUI();
})();

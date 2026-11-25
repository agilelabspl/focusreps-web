// FocusReps browser demo.
// Opens a full-page popup with the app's Home -> Break (camera) -> Celebration flow.
// Rep counting is a 1:1 port of mobile/FocusReps/PushupCounter.swift.
// Pose detection: MediaPipe Pose Landmarker, runs on-device in the browser. No video leaves the computer.

const APPSTORE_URL = "https://apps.apple.com/us/app/focus-push-up-set-focusreps/id6827547307?ppid=c766ab44-a775-4fb3-ad46-c6d85a74fd3a";
const MP_VERSION = "0.10.14";
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const BREAK_SECONDS = 5 * 60;
const BASE = new URL(".", import.meta.url).href; // .../demo/

// ---------- analytics (no-op when PostHog is not on the page) ----------
function track(name, props) {
  try { window.posthog && window.posthog.capture("web.focusreps.demo_" + name, props || {}); } catch (_) {}
}

// ---------- icons (SF Symbols look-alikes) ----------
const ICON = {
  clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  pause: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  number: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M9 4 7 20M17 4l-2 16M4 9h16M3 15h16"/></svg>',
  lock: '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1Zm2 0h6V7a3 3 0 0 0-6 0v3Z"/></svg>',
  close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  camera: '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M9 4h6l1.5 2H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5L9 4Zm3 4.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z"/></svg>'
};

// ---------- PushupCounter (port of PushupCounter.swift) ----------
// Coordinates use Vision convention: y = 0 bottom, 1 top.
class PushupCounter {
  constructor() {
    this.downDelta = 0.05;
    this.upDelta = 0.03;
    this.plankThreshold = 0.22;
    this.samplesForBaseline = 20;
    this.plankStableThreshold = 15;
    this.reset();
  }
  reset() {
    this.repCount = 0;
    this.state = "waitingForPlank";
    this.baselineY = 0;
    this.baselineSamples = [];
    this.plankStableFrames = 0;
  }
  update(pose) {
    const shoulderY = meanY(pose.leftShoulder, pose.rightShoulder);
    if (shoulderY == null) return false;
    const plankOK = this.isInPlank(pose, shoulderY);
    let counted = false;
    switch (this.state) {
      case "waitingForPlank":
        if (plankOK) {
          this.plankStableFrames += 1;
          if (this.plankStableFrames >= this.plankStableThreshold) {
            this.state = "calibrating";
            this.plankStableFrames = 0;
          }
        } else {
          this.plankStableFrames = 0;
        }
        break;
      case "calibrating":
        this.baselineSamples.push(shoulderY);
        if (this.baselineSamples.length >= this.samplesForBaseline) {
          const sorted = [...this.baselineSamples].sort((a, b) => a - b);
          this.baselineY = sorted[Math.floor(sorted.length / 2)];
          this.state = "up";
        }
        break;
      case "up":
        if (shoulderY < this.baselineY - this.downDelta) this.state = "down";
        break;
      case "down":
        if (shoulderY > this.baselineY - this.upDelta) {
          this.state = "up";
          this.repCount += 1;
          counted = true;
        }
        break;
    }
    return counted;
  }
  isInPlank(pose, shoulderY) {
    const lowerY = meanY(pose.leftHip, pose.rightHip)
      ?? meanY(pose.leftKnee, pose.rightKnee)
      ?? meanY(pose.leftAnkle, pose.rightAnkle);
    if (lowerY == null) return false;
    return Math.abs(shoulderY - lowerY) < this.plankThreshold;
  }
}
function meanY(a, b) {
  if (a && b) return (a.y + b.y) / 2;
  if (a) return a.y;
  if (b) return b.y;
  return null;
}

// MediaPipe landmark indices -> app joint names
const LM = {
  nose: 0, leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16, leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28
};
const MIN_VISIBILITY = 0.3;
function toPose(landmarks) {
  const pose = {};
  if (!landmarks) return pose;
  for (const [name, i] of Object.entries(LM)) {
    const p = landmarks[i];
    if (!p) continue;
    if ((p.visibility ?? 1) < MIN_VISIBILITY) continue;
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) continue;
    pose[name] = { x: p.x, y: 1 - p.y };
  }
  if (pose.leftShoulder && pose.rightShoulder) {
    pose.neck = {
      x: (pose.leftShoulder.x + pose.rightShoulder.x) / 2,
      y: (pose.leftShoulder.y + pose.rightShoulder.y) / 2
    };
  }
  return pose;
}
const CONNECTIONS = [
  ["leftShoulder", "leftElbow"], ["leftElbow", "leftWrist"],
  ["rightShoulder", "rightElbow"], ["rightElbow", "rightWrist"],
  ["leftShoulder", "rightShoulder"], ["leftShoulder", "leftHip"],
  ["rightShoulder", "rightHip"], ["leftHip", "rightHip"],
  ["leftHip", "leftKnee"], ["leftKnee", "leftAnkle"],
  ["rightHip", "rightKnee"], ["rightKnee", "rightAnkle"], ["neck", "nose"]
];
const STATE_COLOR = { waitingForPlank: "#ff9500", calibrating: "#ffcc00", up: "#34c759", down: "#32ade6" };
const STATE_LABEL = { waitingForPlank: "GET\nREADY", calibrating: "HOLD\nSTEADY", up: "DOWN", down: "UP" };

// ---------- MediaPipe loader (lazy, cached) ----------
let landmarkerPromise = null;
function loadLandmarker() {
  if (landmarkerPromise) return landmarkerPromise;
  landmarkerPromise = (async () => {
    const vision = await import(`${MP_BASE}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const make = (delegate) => vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO",
      numPoses: 1
    });
    try { return await make("GPU"); } catch (_) { return await make("CPU"); }
  })();
  landmarkerPromise.catch(() => { landmarkerPromise = null; });
  return landmarkerPromise;
}

// ---------- speech (the app speaks every rep) ----------
function speak(text, rate) {
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = "en-US";
    u.rate = rate || 1.1;
    window.speechSynthesis.speak(u);
  } catch (_) {}
}
function stopSpeech() { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) {} }

// ---------- Demo ----------
class Demo {
  constructor() {
    this.goal = 5;
    this.counter = new PushupCounter();
    this.stream = null;
    this.raf = 0;
    this.timer = 0;
    this.toastTimer = 0;
    this.celebrateTimers = [];
    this.onKey = (e) => { if (e.key === "Escape") this.close(); };
  }

  open(source) {
    if (this.root) return;
    track("open", { source: source || "unknown" });
    document.documentElement.classList.add("frd-lock");
    const root = document.createElement("div");
    root.className = "frd-overlay";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "FocusReps demo");
    root.innerHTML = `
      <button class="frd-close" type="button" aria-label="Close demo">${ICON.close}</button>
      <div class="frd-phone"><div class="frd-toast" role="status" aria-live="polite"></div></div>
      <a class="frd-store" href="${APPSTORE_URL}" data-store="corner" aria-label="Download FocusReps on the App Store">
        <img src="${BASE}../appstore-badge.webp" alt="Download on the App Store" width="2000" height="593" />
      </a>`;
    document.body.appendChild(root);
    this.root = root;
    this.phone = root.querySelector(".frd-phone");
    this.toastEl = root.querySelector(".frd-toast");
    root.querySelector(".frd-close").addEventListener("click", () => this.close());
    root.addEventListener("click", (e) => {
      if (e.target === root) this.close();
      const store = e.target.closest("[data-store]");
      if (store) track("appstore_click", { placement: store.dataset.store });
    });
    document.addEventListener("keydown", this.onKey);
    loadLandmarker().catch(() => {}); // warm up while the user reads Home
    this.showHome();
    root.querySelector(".frd-close").focus();
  }

  close() {
    if (!this.root) return;
    track("close", { screen: this.screen });
    this.stopBreak();
    this.clearCelebration();
    document.removeEventListener("keydown", this.onKey);
    this.root.remove();
    this.root = null;
    document.documentElement.classList.remove("frd-lock");
  }

  setScreen(name, html) {
    this.screen = name;
    this.phone.querySelectorAll(".frd-screen, .frd-celebrate").forEach((n) => n.remove());
    this.phone.insertAdjacentHTML("afterbegin", html);
    return this.phone.querySelector(".frd-screen");
  }

  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add("is-on");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove("is-on"), 2400);
  }

  // ----- Home (HomeView.swift) -----
  showHome() {
    const el = this.setScreen("home", `
      <div class="frd-screen frd-home">
        <h2 class="frd-hero">Focus.<br>Then <span class="frd-accent">push-ups.</span></h2>
        <p class="frd-sub">Trade the scroll for push-ups.<br>Camera counts, you train.</p>
        <div class="frd-spacer"></div>
        <p class="frd-section">New focus rep</p>
        <div class="frd-card">
          ${this.row("Focus", ICON.clock, "25", "m", true)}
          ${this.row("Break", ICON.pause, "5", "m", true)}
          ${this.row("Push-ups", ICON.number, String(this.goal), "", false)}
        </div>
        <div class="frd-chips">
          <button type="button" class="frd-chip" data-preset="0">25 / 5 / 10</button>
          <button type="button" class="frd-chip" data-preset="1">${ICON.lock}50 / 10 / 20</button>
          <button type="button" class="frd-chip" data-preset="2">${ICON.lock}15 / 5 / 5</button>
        </div>
        <div class="frd-spacer"></div>
        <div class="frd-stats">
          <div class="frd-stat"><b>0</b><span>focus reps today</span></div>
          <div class="frd-stat"><b>0</b><span>push-ups today</span></div>
          <div class="frd-stat"><b>0</b><span>breaks<br>today</span></div>
        </div>
        <p class="frd-hint">Demo skips the 25 minute focus. Straight to the push-ups.</p>
        <button type="button" class="frd-cta" data-act="start">Start push-ups</button>
      </div>`);
    const valEl = el.querySelector('[data-row="Push-ups"] .frd-val');
    const chips = el.querySelectorAll(".frd-chip");
    const refresh = () => {
      valEl.textContent = String(this.goal);
      chips[0].classList.toggle("is-active", this.goal === 10);
    };
    refresh();
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.act === "start") { track("start", { goal: this.goal }); this.showBreak(); return; }
      if (b.dataset.locked) { this.toast("Custom focus and break lengths are in the app."); return; }
      if (b.dataset.step) {
        this.goal = Math.min(30, Math.max(1, this.goal + Number(b.dataset.step)));
        refresh();
        return;
      }
      if (b.dataset.preset === "0") { this.goal = 10; refresh(); return; }
      if (b.dataset.preset) this.toast("More presets are in the app.");
    });
  }

  row(title, icon, value, unit, locked) {
    const l = locked ? ' data-locked="1"' : "";
    return `
      <div class="frd-row" data-row="${title}">
        <div class="frd-row-l">
          <div class="frd-ico">${icon}</div>
          <div class="frd-row-title">${title}${locked ? `<span class="frd-lock-ico">${ICON.lock}</span>` : ""}</div>
        </div>
        <div class="frd-stepper${locked ? " is-locked" : ""}">
          <button type="button" aria-label="Less ${title}" data-step="-1"${l}>&minus;</button>
          <span class="frd-val">${value}${unit ? `<small>${unit}</small>` : ""}</span>
          <button type="button" aria-label="More ${title}" data-step="1"${l}>+</button>
        </div>
      </div>`;
  }

  // ----- Break (BreakView.swift) -----
  showBreak() {
    this.stopBreak();
    this.counter.reset();
    this.breakLeft = BREAK_SECONDS;
    this.finished = false;
    const el = this.setScreen("break", `
      <div class="frd-screen frd-break">
        <div class="frd-break-head">
          <div class="frd-live"><span class="frd-dot"></span>ACTIVE BREAK</div>
          <div class="frd-timer"><b data-timer>05:00</b><span>BREAK ENDS IN</span></div>
        </div>
        <div class="frd-cam">
          <video playsinline muted autoplay></video>
          <canvas></canvas>
          <div class="frd-cam-top"><span class="frd-pill"><i></i>PRIVATE COUNTING</span></div>
          <div class="frd-cam-bottom">
            <div class="frd-count"><b data-count>0</b><span>/</span><span>${this.goal}</span></div>
            <div class="frd-state" data-state>GET\nREADY</div>
          </div>
          <div class="frd-loading" data-loading>LOADING CAMERA…</div>
          <div class="frd-cam-overlay" data-setup>
            <div class="frd-setup">
              <h3>GET READY</h3>
              <div class="frd-step"><i>1</i>Put your laptop on the floor, camera facing you</div>
              <div class="frd-step"><i>2</i>Step back about 1.5 m and drop into plank</div>
              <div class="frd-step"><i>3</i>Position until lines turn green</div>
              <button type="button" class="frd-pill-btn" data-act="gotit">GOT IT</button>
            </div>
          </div>
          <div class="frd-cam-overlay frd-msg" data-error hidden></div>
        </div>
        <div class="frd-spacer"></div>
        <button type="button" class="frd-cta is-secondary" data-act="skip">Skip push-ups</button>
        <button type="button" class="frd-link" data-act="end">End session</button>
      </div>`);
    this.els = {
      video: el.querySelector("video"),
      canvas: el.querySelector("canvas"),
      count: el.querySelector("[data-count]"),
      state: el.querySelector("[data-state]"),
      timer: el.querySelector("[data-timer]"),
      setup: el.querySelector("[data-setup]"),
      error: el.querySelector("[data-error]"),
      loading: el.querySelector("[data-loading]")
    };
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const act = b.dataset.act;
      if (act === "gotit") this.els.setup.hidden = true;
      else if (act === "skip") { track("skip", { reps: this.counter.repCount }); this.stopBreak(); this.showResult(this.counter.repCount); }
      else if (act === "end") { track("end_session", { reps: this.counter.repCount }); this.stopBreak(); this.showHome(); }
      else if (act === "retry") { this.showBreak(); }
    });
    this.timer = setInterval(() => {
      this.breakLeft -= 1;
      const m = Math.floor(this.breakLeft / 60), s = this.breakLeft % 60;
      this.els.timer.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      if (this.breakLeft <= 0) { this.stopBreak(); this.showResult(this.counter.repCount); }
    }, 1000);
    this.startCamera();
  }

  async startCamera() {
    const token = (this.camToken = (this.camToken || 0) + 1);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.showError("nocam");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      if (token !== this.camToken || this.screen !== "break") { stream.getTracks().forEach((t) => t.stop()); return; }
      this.stream = stream;
      this.els.video.srcObject = stream;
      await this.els.video.play().catch(() => {});
      track("camera_granted");
    } catch (err) {
      if (token !== this.camToken) return;
      const name = err && err.name;
      track("camera_error", { error: name || "unknown" });
      this.showError(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "nocam");
      return;
    }
    this.els.loading.textContent = "LOADING POSE MODEL…";
    let landmarker;
    try {
      landmarker = await loadLandmarker();
    } catch (_) {
      if (token !== this.camToken) return;
      track("model_error");
      this.showError("model");
      return;
    }
    if (token !== this.camToken || this.screen !== "break") return;
    this.els.loading.hidden = true;
    this.loop(landmarker, token);
  }

  loop(landmarker, token) {
    const video = this.els.video;
    let lastTime = -1;
    const tick = () => {
      if (token !== this.camToken || this.finished) return;
      if (video.readyState >= 2 && video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        let result;
        try { result = landmarker.detectForVideo(video, performance.now()); } catch (_) { result = null; }
        const pose = toPose(result && result.landmarks && result.landmarks[0]);
        const counted = this.counter.update(pose);
        this.draw(pose);
        this.renderCounter(counted);
        if (this.counter.state !== "waitingForPlank" && !this.els.setup.hidden) this.els.setup.hidden = true;
        if (this.counter.repCount >= this.goal) { this.finish(); return; }
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  renderCounter(counted) {
    this.els.state.textContent = STATE_LABEL[this.counter.state];
    if (counted) {
      const n = this.counter.repCount;
      this.els.count.textContent = String(n);
      this.els.count.classList.remove("is-bump");
      void this.els.count.offsetWidth;
      this.els.count.classList.add("is-bump");
      speak(n);
      track("rep", { n });
    }
  }

  // Draw skeleton like PoseOverlayView.swift, matching the mirrored, object-fit: cover video.
  draw(pose) {
    const { canvas, video } = this.els;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const vw = video.videoWidth || 4, vh = video.videoHeight || 3;
    const s = Math.max(w / vw, h / vh);
    const dw = vw * s, dh = vh * s, ox = (w - dw) / 2, oy = (h - dh) / 2;
    const screen = (p) => ({ x: w - (ox + p.x * dw), y: oy + (1 - p.y) * dh });
    const color = STATE_COLOR[this.counter.state];
    ctx.lineCap = "round";
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.9;
    for (const [a, b] of CONNECTIONS) {
      if (!pose[a] || !pose[b]) continue;
      const pa = screen(pose[a]), pb = screen(pose[b]);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    for (const name of Object.keys(pose)) {
      const p = screen(pose[name]);
      ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#fff"; ctx.fill(); ctx.stroke();
    }
  }

  showError(kind) {
    this.els.loading.hidden = true;
    this.els.setup.hidden = true;
    const box = this.els.error;
    const copy = {
      denied: ["CAMERA ACCESS NEEDED", "FocusReps counts push-ups on your device. Nothing is uploaded. Allow the camera in your browser to try it."],
      nocam: ["NO CAMERA FOUND", "This demo needs a webcam. On iPhone, the app counts with the front camera."],
      model: ["COULD NOT LOAD", "The pose model did not load. Check your connection and try again."]
    }[kind];
    box.innerHTML = `
      <div>
        ${ICON.camera}
        <h3>${copy[0]}</h3>
        <p>${copy[1]}</p>
        <button type="button" class="frd-pill-btn" data-act="retry">TRY AGAIN</button>
        <button type="button" class="frd-under" data-act="skip">Skip push-ups</button>
      </div>`;
    box.hidden = false;
  }

  stopBreak() {
    this.camToken = (this.camToken || 0) + 1;
    cancelAnimationFrame(this.raf);
    clearInterval(this.timer);
    stopSpeech();
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
  }

  // ----- Celebration (CelebrationOverlay.swift) -----
  finish() {
    this.finished = true;
    const reps = this.counter.repCount;
    this.stopBreak();
    track("complete", { reps, goal: this.goal });
    setTimeout(() => speak("Well done!", 1.0), 400);
    const layer = document.createElement("div");
    layer.className = "frd-celebrate";
    layer.innerHTML = "<h2>WELL DONE!</h2>";
    this.phone.appendChild(layer);
    this.spawnConfetti(layer);
    this.celebrateTimers.push(setTimeout(() => this.spawnConfetti(layer), 1800));
    this.celebrateTimers.push(setTimeout(() => { layer.style.opacity = "0"; }, 3800));
    this.celebrateTimers.push(setTimeout(() => this.showResult(reps), 4400));
  }

  spawnConfetti(layer) {
    const colors = ["#ff5b14", "#ffffff", "#ccff00", "#32ade6", "#ffcc00", "#ff2d55"];
    const w = layer.clientWidth, h = layer.clientHeight;
    for (let i = 0; i < 80; i++) {
      const d = document.createElement("i");
      d.className = "frd-confetti";
      const cw = 6 + Math.random() * 7, ch = 10 + Math.random() * 10;
      d.style.cssText = `left:${Math.random() * w}px;width:${cw}px;height:${ch}px;background:${colors[i % colors.length]};` +
        `transform:rotate(${Math.random() * 360}deg) translateY(${-Math.random() * 280}px);` +
        `--dx:${(Math.random() * 200 - 100).toFixed(0)}px;--h:${h}px;--rot:${(360 + Math.random() * 720).toFixed(0)}deg;` +
        `animation-duration:${(2.8 + Math.random() * 1.4).toFixed(2)}s;`;
      layer.appendChild(d);
    }
  }

  clearCelebration() {
    this.celebrateTimers.forEach(clearTimeout);
    this.celebrateTimers = [];
  }

  // ----- Result -----
  showResult(reps) {
    this.clearCelebration();
    const done = reps > 0;
    const el = this.setScreen("result", `
      <div class="frd-screen frd-result">
        <div class="frd-eyebrow">${done ? "Well done" : "No reps yet"}</div>
        <div class="frd-big">${reps}</div>
        <div class="frd-big-label">push-ups</div>
        <p>${done
          ? `In the FocusReps app, these ${reps} reps would go straight to your stats and the leaderboard. Here they are gone when you close this window.`
          : "Prop the camera so it sees your whole body in plank, then try again. Or get the app and let your iPhone count."}</p>
        <a class="frd-cta" href="${APPSTORE_URL}" data-store="result">Get the App</a>
        <button type="button" class="frd-cta is-secondary" data-act="again">Do another set</button>
        <button type="button" class="frd-link" data-act="home">Back to start</button>
      </div>`);
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.act === "again") { track("again"); this.showBreak(); }
      if (b.dataset.act === "home") this.showHome();
    });
  }
}

// ---------- wiring ----------
const demo = new Demo();
document.addEventListener("click", (e) => {
  const trigger = e.target.closest("[data-demo-open]");
  if (!trigger) return;
  e.preventDefault();
  demo.open(trigger.dataset.demoOpen || "button");
});
const demoParam = new URLSearchParams(location.search).get("demo");
if (demoParam !== null) {
  demo.open("url");
  if (demoParam === "break") demo.showBreak();
  if (demoParam === "result") demo.showResult(5);
}
window.FocusRepsDemo = demo;

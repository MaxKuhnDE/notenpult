// Turning pages by face: the front camera, MediaPipe's face landmarker running on the device (no
// picture is stored or sent anywhere), and a small state machine that turns a head turn, an open
// mouth or a wink into "next"/"prev". The state machine is a plain function (test/face.js).

import { db } from './store.js';
import { h, fill, modal } from './ui.js';

export const GESTURES = [['head', 'Kopf drehen'], ['mouth', 'Mund öffnen'], ['wink', 'Zwinkern']];
const HOLD_FRAMES = 2; // a gesture has to last two pictures (a quick glance does nothing)
const COOLDOWN_MS = 700;
const FRAME_MS = 70; // aim for ~14 pictures a second; slower devices take what they can

/**
 * Per picture { yaw (degrees, + = one side), jaw (0–1), blinkL, blinkR (0–1) } or null (no face)
 * → 'next' | 'prev' | null. After an action the face has to come back to neutral first.
 */
export function createGestureDetector({ gesture = 'head', sensitivity = 0.5, swap = false } = {}) {
  const s = Math.max(0, Math.min(1, Number(sensitivity) || 0));
  const yawOn = 26 - 14 * s; // degrees: 26 (rough) … 12 (fine)
  const yawOff = yawOn * 0.45;
  const jawOn = 0.55 - 0.25 * s;
  const jawOff = jawOn * 0.5;
  const shutOn = 0.62 - 0.2 * s; // eye closed enough
  const openMax = 0.35; // the other eye stays open (a normal blink closes both)
  let armed = true;
  let streak = 0;
  let streakAct = null;
  let last = -Infinity;
  return {
    update(f, now) {
      if (!f) {
        streak = 0;
        return null;
      }
      let act = null;
      let neutral = false;
      if (gesture === 'mouth') {
        if (f.jaw > jawOn) act = 'next';
        neutral = f.jaw < jawOff;
      } else if (gesture === 'wink') {
        if (f.blinkR > shutOn && f.blinkL < openMax) act = 'next';
        else if (f.blinkL > shutOn && f.blinkR < openMax) act = 'prev';
        neutral = f.blinkL < openMax && f.blinkR < openMax;
      } else {
        if (f.yaw > yawOn) act = 'next';
        else if (f.yaw < -yawOn) act = 'prev';
        neutral = Math.abs(f.yaw) < yawOff;
      }
      if (swap && act) act = act === 'next' ? 'prev' : 'next';
      if (!armed) {
        if (neutral) armed = true;
        streak = 0;
        return null;
      }
      if (!act) {
        streak = 0;
        return null;
      }
      streak = act === streakAct ? streak + 1 : 1;
      streakAct = act;
      if (streak < HOLD_FRAMES || now - last < COOLDOWN_MS) return null;
      armed = false;
      streak = 0;
      last = now;
      return act;
    },
  };
}

/** The numbers the detector needs from a FaceLandmarker result (null: no face). */
export function featuresOf(result) {
  const cats = result && result.faceBlendshapes && result.faceBlendshapes[0] && result.faceBlendshapes[0].categories;
  if (!cats || !cats.length) return null;
  const score = (name) => (cats.find((c) => c.categoryName === name) || {}).score || 0;
  const m = result.facialTransformationMatrixes && result.facialTransformationMatrixes[0] && result.facialTransformationMatrixes[0].data;
  const yaw = m ? (Math.atan2(m[8], m[10]) * 180) / Math.PI : 0; // rotation about the vertical axis
  return {
    yaw: Math.round(yaw * 10) / 10, jaw: score('jawOpen'), blinkL: score('eyeBlinkLeft'), blinkR: score('eyeBlinkRight'),
  };
}

// ---------- MediaPipe ----------

const BASE = new URL('../vendor/mediapipe/', document.baseURI).href;
let landmarker = null;

/** MediaPipe writes its start-up notes as console errors; they are no errors. */
let quiet = false;
function quietMediapipeLogs() {
  if (quiet) return;
  quiet = true;
  for (const level of ['error', 'warn', 'info', 'log']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      if (typeof args[0] === 'string' && /^(INFO: |[IWE]\d{4} \d\d:\d\d:\d\d)/.test(args[0])) return;
      original(...args);
    };
  }
}

/** Loads the face landmarker once (GPU where possible, otherwise CPU). */
export function loadLandmarker() {
  if (!landmarker) {
    quietMediapipeLogs();
    landmarker = (async () => {
      const vision = await import(`${BASE}vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`${BASE}wasm`);
      const options = (delegate) => ({
        baseOptions: { modelAssetPath: `${BASE}face_landmarker.task`, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      try {
        return await vision.FaceLandmarker.createFromOptions(fileset, options('GPU'));
      } catch {
        return vision.FaceLandmarker.createFromOptions(fileset, options('CPU'));
      }
    })();
    landmarker.catch(() => { landmarker = null; });
  }
  return landmarker;
}

const controllers = new Set();

/** Test hook: a picture's numbers as if the camera had seen them (the camera pauses for a moment). */
export function feedFrame(f, now = performance.now()) {
  for (const c of controllers) {
    c.manualUntil = performance.now() + 1500;
    c.feed(f, now);
  }
}

/**
 * Starts the camera and calls onAction('next' | 'prev'). onFrame(features) and onStatus(text, ok)
 * are for the test dialog. Returns { stop(), video }.
 */
export function startFaceControl({ onAction, onFrame = () => {}, onStatus = () => {} } = {}) {
  const detector = createGestureDetector({
    gesture: db.settings.faceGesture, sensitivity: db.settings.faceSensitivity, swap: db.settings.faceSwap,
  });
  const video = h('video.face-video', { autoplay: true, muted: true, playsinline: true });
  video.muted = true;
  let stream = null;
  let stopped = false;
  let timer = 0;
  const feed = (f, now) => {
    onFrame(f);
    const act = detector.update(f, now);
    if (act) onAction(act);
  };
  const control = {
    feed, video, stop, manualUntil: 0,
  };
  controllers.add(control);

  async function loop() {
    if (stopped) return;
    const t0 = performance.now();
    try {
      const lm = await loadLandmarker();
      if (!stopped && video.readyState >= 2 && !(control.manualUntil > t0)) feed(featuresOf(lm.detectForVideo(video, t0)), t0);
    } catch (err) {
      console.warn('Gesichtserkennung', err);
    }
    if (!stopped) timer = setTimeout(loop, Math.max(10, FRAME_MS - (performance.now() - t0)));
  }

  (async () => {
    onStatus('Kamera wird gestartet …', true);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } }, audio: false });
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => {});
      onStatus('Gesichtserkennung wird geladen …', true);
      await loadLandmarker();
      if (stopped) return;
      onStatus('Aktiv', true);
      loop();
    } catch (err) {
      console.warn('Kamera', err);
      onStatus(err && err.name === 'NotAllowedError'
        ? 'Kein Zugriff auf die Kamera – bitte in den Einstellungen des Geräts für Notenpult erlauben.'
        : err && err.name === 'NotFoundError' ? 'Keine Kamera gefunden.' : `Kamera nicht verfügbar (${err && err.message ? err.message : err}).`, false);
    }
  })();

  function stop() {
    stopped = true;
    clearTimeout(timer);
    controllers.delete(control);
    if (stream) stream.getTracks().forEach((t) => t.stop());
  }
  return control;
}

/** Settings → "Testen …": live picture, the numbers, and what would happen. */
export function openFaceTest() {
  const status = h('div.face-status', null, 'Kamera wird gestartet …');
  const values = h('div.face-values');
  const action = h('div.face-action', null, ' ');
  let flash = 0;
  const control = startFaceControl({
    onStatus: (text, ok) => {
      status.textContent = text;
      status.classList.toggle('error', !ok);
    },
    onFrame: (f) => {
      if (!f) {
        fill(values, h('span.muted', null, 'Kein Gesicht im Bild'));
        return;
      }
      const pct = (v) => `${Math.round(v * 100)} %`;
      fill(values,
        h('span', null, `Kopf: ${f.yaw > 0 ? '+' : ''}${Math.round(f.yaw)}°`),
        h('span', null, `Mund: ${pct(f.jaw)}`),
        h('span', null, `Auge links: ${pct(f.blinkL)}`),
        h('span', null, `Auge rechts: ${pct(f.blinkR)}`));
    },
    onAction: (a) => {
      action.textContent = a === 'next' ? 'Weiter ▶' : '◀ Zurück';
      action.classList.add('show');
      clearTimeout(flash);
      flash = setTimeout(() => action.classList.remove('show'), 900);
    },
  });
  modal({
    title: 'Blättern per Gesicht testen',
    className: 'face-modal',
    body: h('div.face-test', null,
      h('p.dialog-text', null, `Geste: ${(GESTURES.find(([g]) => g === db.settings.faceGesture) || GESTURES[0])[1]}. `
        + 'Zeigt „Zurück“ statt „Weiter“, schalte „Richtung tauschen“ ein. Das Bild bleibt auf diesem Gerät.'),
      h('div.face-preview', null, control.video, action),
      status,
      values),
    actions: [{ label: 'Fertig', kind: 'primary', value: true }],
    onClose: () => control.stop(),
  });
  return control;
}


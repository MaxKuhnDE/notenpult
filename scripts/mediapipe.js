// MediaPipe's face landmarker for page turns by face (renderer/js/face.js): the bundle, its wasm
// and the face model (assets/mediapipe, from Google's model page). Used by copy-vendor.js
// (Windows) and build-android-web.js (Android).
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function copyMediapipe(to) {
  const mp = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision');
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.join(to, 'wasm'), { recursive: true });
  fs.copyFileSync(path.join(mp, 'vision_bundle.mjs'), path.join(to, 'vision_bundle.mjs'));
  for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) fs.copyFileSync(path.join(mp, 'wasm', f), path.join(to, 'wasm', f));
  for (const f of ['face_landmarker.task', 'LICENSE']) fs.copyFileSync(path.join(root, 'assets', 'mediapipe', f), path.join(to, f));
  console.log('MediaPipe copied to', path.relative(root, to));
}

module.exports = { copyMediapipe };

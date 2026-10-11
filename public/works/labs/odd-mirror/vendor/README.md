# MediaPipe dependencies

Pinned runtime: `@mediapipe/tasks-vision@1.0.1`, downloaded from jsDelivr. Runtime license: Apache-2.0, upstream `https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE`.

Models are the same ones already used by Odd Mirror:

- `face_landmarker.task`: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`
- `selfie_multiclass.tflite`: `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite`

Original URLs, byte counts and SHA-256 hashes are recorded in `assets.json`. These are local browser inference dependencies, not recordings or user data. Only the selected runtime variant is loaded; classic/no-SIMD variants support fallback environments. Serve `.mjs` as JavaScript and `.wasm` as `application/wasm`.

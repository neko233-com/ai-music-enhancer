# Verification record

Current environment: Windows, Rust 1.96.0, Node 24, Python 3.10, AMD Ryzen 9 7900X3D, 8 inference threads, CPU-only PyTorch 2.7.1+cpu. Historical optional GPU tests used an NVIDIA RTX 5070 Ti 16 GB with PyTorch 2.7.1+cu128.

## Automated checks

- Rust: 6 signal/encoding tests and 1 CLI integration test. Includes all 24 WAV rate/depth combinations, invalid input, stereo isolation, partial RNNoise frames, silence, peak limiting, low-pass alias rejection and overwrite protection.
- TypeScript: 4 audio input/size tests. Preserves original 192 kHz PCM input, rejects truncated/non-finite WAV, estimates bitrate and samples both channels for waveforms.
- Local API: 9 tests. Origin/host/header checks, malformed uploads, cancellation between chunks, overlap-add continuity, real FLAC and MP3 encoding, CPU selection without CUDA queries, CPU health with/without weights, invalid runtime settings.
- Browser: 4 portable end-to-end tests. Real WASM processing; actual original/enhanced playback and switching; downloaded 192 kHz float WAV headers; MP3 frames; file upload errors; 390 px mobile overflow check; full offline reload and processing with the browser network disabled; local-network permission failure and the offline entry point.
- Additional opt-in browser CPU/GPU test: actual local AudioSR processing, enhanced playback and FLAC download. Standard CI skips it because hosted runners lack the installed model; local opt-in runs use the real model.
- `cargo fmt`, `cargo clippy -D warnings`, TypeScript compilation, production build, `actionlint`, `wrangler deploy --dry-run`.

## Real CPU inference

`scripts/verify-cpu.py` requires `torch.version.cuda is None`, blocks socket connections and CUDA initialization, loads the real locally installed weights, and asserts every model parameter is on CPU. A two-second voice excerpt at 10 steps completed in 42.25 seconds including cold model load. It preserved 96,000 output frames at 48 kHz and produced finite, changed PCM below the peak ceiling. Report: `cpu-verification.json`. No GPU, CUDA runtime or cloud API participates.

This verifies genuine model execution on CPU, not perceptual quality or real-time performance. Input is internally padded to the model's 5.12-second chunk length. Longer recordings, more channels and more steps take longer.

The CPU browser integration test also processed the complete 10.9-second voice demo at the default 50 steps, played the enhanced result and downloaded real 192 kHz FLAC. It passed in about 2.2 minutes including a cold service model load. All five browser tests passed with the CPU-only service.

The Rust CLI independently used the same CPU service at 10 steps and exported a two-second, mono, 192 kHz, 32-bit float WAV (384,000 frames, 1,536,056 bytes), verified with libsndfile. The in-app browser was refreshed and its rendered connection status confirmed `CPU · 8 线程 · 模型就绪`. `artifacts/studio-cpu.png` was inspected with `view_image`; layout and the A/B controls remain consistent with the existing design.

## Historical GPU inference

`scripts/verify-gpu.py` blocks `socket.socket.connect` and `socket.create_connection` before loading AudioSR, then reconstructs a two-second excerpt from each of the six bundled files. No fake model is used in this test. Report: `gpu-verification.json`.

All six preserve frame count and channel count, produce finite samples below the configured sample peak ceiling, and differ from ordinary resampling. Energy appears in the 12–22 kHz band. This demonstrates model inference and generation, **not** a claim that greater high-frequency energy proves perceptual improvement. Listen to A/B results.

Cold model load and first inference took about 36 seconds; later two-second clips took about 2–4 seconds at 10 steps on this machine. These are smoke-test measurements, not a performance promise for full tracks or default 50-step quality.

The CLI separately processed the full 12-second stereo music demo through the HTTP GPU service and exported a 192000 Hz, two-channel, 32-bit float WAV, 18,432,056 bytes. Duration and subtype were verified with libsndfile.

## Browser and visual inspection

The in-app browser loaded the local studio, inspected the rendered controls and confirmed `NVIDIA GeForce RTX 5070 Ti · 模型就绪` after clicking 检测连接. Playwright provides repeatable regression tests, downloads and screenshots; it is additional automation, not a substitute for the in-app browser check.

Production GPU tests explicitly grant the site's local-network permission in an isolated browser context. Without permission, Chromium blocks the public site's connection to loopback. The app explains this and links to the fully local studio. This follows [Chrome's local-network permission model](https://developer.chrome.com/release-notes/142); no browser security flags are disabled.

Verified on `https://music.neko233.com`: real WASM processing, original/enhanced playback, WAV/MP3 exports, mobile upload handling, offline reload, and the actual GPU reconstruction/FLAC flow with permission granted. Cold GPU browser flow completed in about 47 seconds on the verification machine.

Reference: `design/concept.png` (1505 × 1045). Browser captures include 1440 × 1000 desktop, 390 × 844 mobile and a 1505 × 1045 native-reference viewport for the GPU flow. Both the concept and browser screenshots were opened with `view_image` for visual review.

| Comparison point | Reference / implementation | Decision |
|---|---|---|
| Overall layout | Broad audio workspace, narrow settings rail | Preserved; mobile becomes one column |
| Palette | Cool gray canvas, true white panels, periwinkle accent | Preserved via shared CSS tokens |
| Typography | Large left-aligned Chinese title, restrained section/control hierarchy | Preserved with offline system font fallbacks |
| Media | Gray original waveform, purple enhanced waveform, circular play buttons | Preserved; waveform now uses real sample peaks |
| Containers | Dashed upload well, thin panel borders, modest corner radii | Preserved |
| Controls | Sliders/selects/export controls | Native controls styled; added format/bit-depth options |
| Copy | Main title, navigation, upload/player/settings labels | Kept; subtitle and model help intentionally expanded for actual reconstruction |
| Expanded requirements | Six samples, inference parameters, offline setup and RMS match | Added within the same visual system; advanced inference parameters collapse |

Fixed during review: unstyled thin range tracks, large expanded model-options block, screenshot scroll position, mobile long source names and an offline cache mismatch caused by the development server's `Vary: Origin` header.

Above-the-fold copy review found only intentional additions recorded in `design/spec.md`. The implementation follows the concept's layout, palette, type hierarchy, container treatment and A/B player design, with documented additions for the expanded requirements. No clipped primary controls or horizontal mobile overflow remain.

## Practical limits

AudioSR generates a plausible reconstruction, not a guaranteed recovery of the original. Model output is natively 48 kHz. Output at 192 kHz is sinc-converted storage. High-rate files and long clips are bounded by explicit memory limits. Fully offline CPU inference requires the initial dependency/model install and a running local service; cached browser-only tuning works without that service. CPU is the default and does not require a GPU driver or CUDA runtime.

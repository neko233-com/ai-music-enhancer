# Third-party components and assets

Application code is MIT. Dependency and asset licenses remain their own.

| Component | Use | Upstream / license |
|---|---|---|
| nnnoiseless 0.5.2 | Embedded pretrained RNNoise and Rust inference | https://github.com/jneem/nnnoiseless — BSD-3-Clause |
| AudioSR 0.0.7 | Local diffusion super-resolution | https://github.com/haoheliu/versatile_audio_super_resolution — MIT |
| AudioSR basic weights | Downloaded separately, never committed | https://huggingface.co/haoheliu/audiosr_basic — model card and upstream terms |
| PyTorch / torchaudio / torchvision | Local CUDA runtime | https://pytorch.org/ — BSD-style |
| @breezystack/lamejs | Browser MP3 encoder | https://www.npmjs.com/package/@breezystack/lamejs — LGPL-3.0; source is available through the package/upstream, build reproducible from package-lock.json |
| imageio-ffmpeg | Separately installed local FFmpeg executable | https://github.com/imageio/imageio-ffmpeg — wrapper BSD-2-Clause; bundled FFmpeg retains its own LGPL/GPL build license |
| python-soundfile / libsndfile | Local WAV/FLAC encoding | https://github.com/bastibe/python-soundfile — BSD-3-Clause wrapper, LGPL libsndfile |
| React / Vite / Lucide | UI and build | MIT / ISC licenses as distributed in npm packages |
| Demo audio | Four original examples and two public-domain historical recordings | See web/public/demos/README.md and manifest.json |

Model installer pins the official AudioSR basic revision and verifies the model SHA-256. Voice synthesis models are supplied by the operating system and are not redistributed.

nnnoiseless copyright notice:

Copyright (c) 2020, Joe Neeman
Copyright (c) 2017, Mozilla
Copyright (c) 2007-2017, Jean-Marc Valin
Copyright (c) 2005-2017, Xiph.Org Foundation
Copyright (c) 2003-2004, Mark Borgerding

See `THIRD_PARTY_LICENSES/nnnoiseless.txt` for the exact upstream distribution notice.

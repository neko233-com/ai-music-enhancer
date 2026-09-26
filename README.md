# neko audio — AI Music Enhancer

[在线工作台](https://music.neko233.com) · [GitHub](https://github.com/neko233-com/ai-music-enhancer)

Rust CLI + WebAssembly 音频工作台 + **本地 GPU AudioSR 细节重建**。安装完成后可以完全断网使用，音频不发送给 Cloudflare 或任何云端 AI 服务。

## 能做什么

- **真实模型重建**：AudioSR 扩散模型在本机 GPU 推断缺失高频。逐声道处理、5.12 秒分块、0.5 秒重叠淡化、原始低频保留、重建混合比例可调。
- **离线调音**：Rust/浏览器共用 RNNoise 神经网络降噪、轻度高架均衡、抗混叠 sinc 重采样、立体声联动峰值衰减。
- **A/B 试听**：两条真实音频与波形，播放、暂停、拖动、播放中切换保留时间；可匹配 RMS 音量。
- **导出**：WAV、FLAC、MP3；44.1 / 48 / 88.2 / 96 / 176.4 / 192 kHz；16 / 24 / 32 bit PCM、32 bit float；MP3 CBR 64–320 kbps。
- **六个随附示例**：2 段中英文合成语音、2 段原创器乐、2 段公有领域真人演唱与伴奏。来源与处理记录见 [示例说明](web/public/demos/README.md)。也支持拖拽上传自己的文件。
- 网页、WASM 和示例一起缓存；本机服务也直接提供网页，完全离线时打开本机地址即可。

### 重建与高规格导出的区别

AudioSR 原生生成 **48 kHz / 24 kHz 带宽**音频。192 kHz 是之后的导出规格，32 bit 是存储精度，两者不会自动创造真实录音细节。生成式重建会推断内容，可能改变音色或立体声空间，无法保证恢复原版或主观听感一定更好。

模型适合带宽不足的源音频；高质量母带不一定适合。严重失真或不规则 MP3 截止频率可能降低效果，可选择源带宽低通预处理。RNNoise 使用语音训练，音乐默认只混合 15% 降噪，必要时降为零。

## Windows 本机快速开始

前提：Git、Rust（rustup）、Node.js 22+、[uv](https://docs.astral.sh/uv/)、NVIDIA GPU 与新驱动。开发验证设备为 RTX 5070 Ti 16 GB。

```powershell
git clone https://github.com/neko233-com/ai-music-enhancer.git
cd ai-music-enhancer
# 首次安装联网，下载 CUDA PyTorch、约 6.2 GB AudioSR 模型及 tokenizer。
powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1
# 之后可以断网。前台服务只监听 127.0.0.1。
powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1
```

打开 **http://127.0.0.1:8765**。也可从在线网页点击「检测连接」访问同一台电脑上的服务；如果浏览器询问本地网络访问权限，需要允许。离线优先推荐本机地址。首次推理加载模型较慢，之后重复使用已加载模型。

模型位于 `models/`，不提交 Git；下载脚本校验 SHA-256。推理进程强制 `HF_HUB_OFFLINE=1` 和 `TRANSFORMERS_OFFLINE=1`。没有模型时会明确报错，**不会悄悄切换为普通升采样**。

Linux/macOS 可使用相同 Python 3.10 环境安装步骤和 `python -m local.server` 启动；AudioSR GPU 路径目前要求 CUDA/NVIDIA，macOS CLI 可运行本地调音，或使用纯浏览器调音。

## CLI

```powershell
cargo build --release -p neko-audio

# 默认 AudioSR：先启动本机服务。输出 192 kHz / 32-bit float WAV。
target/release/neko-audio input.flac -o enhanced.wav --sample-rate 192000 --bits 33

# 重建参数与 24 bit FLAC
target/release/neko-audio input.wav -o enhanced.flac --steps 50 --seed 233 --mix 0.7 --cutoff 8000 --bits 24

# 纯 Rust 调音，无需 Python/GPU
target/release/neko-audio input.mp3 -o enhanced.wav --mode local --denoise 0.15 --detail 0.3 --sample-rate 96000 --bits 24

# MP3 编码通过本机服务（网页 MP3 编码直接在浏览器运行）
target/release/neko-audio input.wav -o enhanced.mp3 --sample-rate 48000 --bitrate 320
```

`--bits 33` 表示 32-bit IEEE float；`--bits 32` 表示 32-bit 整数 PCM。已有输出文件默认拒绝覆盖，显式 `--overwrite` 可替换；采用临时文件与原子落盘。CLI 只允许连接 loopback 本机服务，禁用代理。

## 格式与限制

| 编码 | 采样率 | 位深/码率 | 运行位置 |
|---|---|---|---|
| WAV | 44.1–192 kHz，6 档 | 16/24/32 整数、32 float | Rust CLI / 浏览器 |
| FLAC | 44.1–192 kHz，6 档 | 16/24 bit | 本机 Python/libFLAC |
| MP3 | 44.1 / 48 kHz | 64/96/128/160/192/224/256/320 kbps | 浏览器 LAME / 本机 FFmpeg |

- 网页输入上限 80 MB、180 秒、单声道或立体声。引擎输入/输出各最多 4000 万采样；192 kHz 立体声最多约 104 秒，超过时请拆分片段。
- 原生 PCM WAV 保留源采样率；浏览器其他格式用 Web Audio 解码至 48 kHz，具体格式支持取决于浏览器。CLI 使用 Symphonia 支持 WAV/MP3/FLAC/AAC/M4A/OGG 等。
- 每次一个 GPU 任务；可取消，当前模型片段完成后停止。结果在本机进程中最多保留 4 个，1 小时后清理；服务关闭后清空。
- MP3 有损，FLAC 无损；PCM 码率由采样率 × 位深 × 声道数决定。页面展示文件体积估计，FLAC 估计为压缩前大小。

## 开发与测试

```powershell
npm ci
npm run wasm
npm run dev

cargo fmt --all --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
npm run build
npm test
npx playwright install chromium
npm run test:e2e
.venv/Scripts/python.exe -m pytest local/test_local.py -q
# 可选真实 GPU 集成测试：禁止所有 socket 网络连接，处理六类示例片段。
.venv/Scripts/python.exe scripts/verify-gpu.py
```

测试覆盖：全规格 WAV 回读、时长/声道/尾帧、无效输入、抗混叠、限峰、CLI 防覆盖、实际浏览器 WASM 推理、双音轨播放、WAV/MP3 导出、上传错误、移动端及离线重载、本机 API 边界、真实 FLAC/MP3 编码。GPU 实测结果见 [验证记录](docs/verification.md)。CI 在 Linux/Windows/macOS 构建 CLI，并产出可下载二进制与离线网页 artifact。

## Cloudflare

站点使用 Workers Static Assets，`wrangler.jsonc` 已配置 `music.neko233.com`。GPU 推理始终在本机，Cloudflare 仅托管静态资源。

```powershell
npm run deploy
```

GitHub Actions 在 main 推送后先完成所有测试，再使用仓库加密 secret `CLOUDFLARE_API_TOKEN` 发布已验证的网页 artifact。部署不包含模型、用户音频、Python 环境或密钥。

## 目录

```text
crates/engine/       Rust DSP、RNNoise、重采样、WAV 编码、WASM 接口
crates/cli/          原生 CLI、音频解码、本机 GPU 服务客户端
web/                React + Vite 工作台、Web Worker、离线资源与示例
local/              AudioSR GPU 适配、本机 HTTP API、FLAC/MP3 导出
scripts/            安装、启动、模型校验、示例构建与 GPU 验证
tests/              前端单元测试及 Playwright 端到端测试
```

选择 Rust 是为了原生 CLI 和浏览器共用同一个可测试音频内核；Python 仅作为 AudioSR/PyTorch 官方模型的本机适配层。

## 模型与许可

- 应用代码：MIT。
- [AudioSR 官方实现](https://github.com/haoheliu/versatile_audio_super_resolution)、[论文](https://arxiv.org/abs/2309.07314)、[模型](https://huggingface.co/haoheliu/audiosr_basic)。AudioSR 限制与输入建议见官方 README。
- [nnnoiseless / RNNoise](https://github.com/jneem/nnnoiseless)：BSD-3-Clause。
- LAME、FFmpeg、libsndfile 及其他依赖各自保留原许可；参见 [第三方说明](THIRD_PARTY.md)。

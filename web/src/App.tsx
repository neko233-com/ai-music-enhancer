import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  ArrowUpFromLine,
  CheckCircle2,
  Github,
  Info,
  Headphones,
  RefreshCw,
  CircleHelp,
  WifiOff,
} from 'lucide-react';
import {
  decodeAudio,
  defaults,
  estimateBytes,
  waveBlob,
  type AudioData,
  type Settings,
} from './audio';
import { WavePlayer } from './components/WavePlayer';
import { SettingsPanel } from './components/SettingsPanel';
import { api, health } from './local-api';
type Demo = { id: string; name: string; category: string; description: string; path: string };
type Track = AudioData & { url: string; name: string };
function rms(audio?: AudioData) {
  if (!audio) return 0;
  let total = 0;
  for (let i = 0; i < audio.samples.length; i += 16) total += audio.samples[i] ** 2;
  return Math.sqrt(total / Math.ceil(audio.samples.length / 16));
}
export default function App() {
  const [settings, setSettings] = useState(defaults),
    [source, setSource] = useState<Track>(),
    [result, setResult] = useState<Track>();
  const [demos, setDemos] = useState<Demo[]>([]),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(''),
    [error, setError] = useState(''),
    [dragging, setDragging] = useState(false),
    [match, setMatch] = useState(true);
  const [service, setService] = useState('尚未连接'),
    [offline, setOffline] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null),
    player = useRef<HTMLAudioElement | null>(null),
    worker = useRef<Worker | null>(null),
    task = useRef(0),
    job = useRef<string | null>(null);
  const cancelWorker = useRef<(() => void) | null>(null);
  const demoSection = useRef<HTMLElement>(null);
  useEffect(() => {
    fetch('/demos/manifest.json')
      .then((r) => r.json())
      .then(setDemos)
      .catch(() => setError('示例音频未加载，请检查安装包。'));
    if ('serviceWorker' in navigator && import.meta.env.PROD)
      navigator.serviceWorker
        .register('/sw.js')
        .then(() => navigator.serviceWorker.ready)
        .then(() => setOffline(true))
        .catch(() => {});
    return () => worker.current?.terminate();
  }, []);
  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source.url);
    },
    [source],
  );
  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result.url);
    },
    [result],
  );
  const cancel = () => {
    task.current++;
    cancelWorker.current?.();
    worker.current?.terminate();
    worker.current = null;
    player.current?.pause();
    if (job.current) {
      void api(`/api/jobs/${job.current}`, { method: 'DELETE' }).catch(() => {});
      job.current = null;
    }
    setBusy(false);
    setProgress('已取消');
  };
  const load = async (blob: Blob, name: string) => {
    cancel();
    const token = task.current;
    setError('');
    setProgress('正在读取音频…');
    setResult(undefined);
    setSource(undefined);
    setBusy(true);
    try {
      const audio = await decodeAudio(blob);
      if (token !== task.current) return;
      setSource({
        ...audio,
        name,
        url: URL.createObjectURL(waveBlob(audio.samples, audio.rate, audio.channels)),
      });
      setProgress('音频已就绪');
    } catch (e) {
      if (token === task.current) {
        setError(e instanceof Error ? e.message : '音频格式无法读取。');
        setProgress('');
      }
    } finally {
      if (token === task.current) setBusy(false);
    }
  };
  const loadDemo = async (demo: Demo) => {
    try {
      const r = await fetch(demo.path);
      if (!r.ok) throw new Error('示例文件不可用');
      await load(await r.blob(), demo.name);
    } catch (e) {
      setError(String(e));
    }
  };
  const compute = (
    action: 'enhance' | 'export',
    audio: AudioData,
  ): Promise<{ samples: Float32Array; rate: number; channels: number; blob: Blob }> =>
    new Promise((resolve, reject) => {
      worker.current?.terminate();
      const w = new Worker(new URL('./audio.worker.ts', import.meta.url), { type: 'module' });
      worker.current = w;
      cancelWorker.current = () => {
        w.terminate();
        cancelWorker.current = null;
        reject(new Error('已取消'));
      };
      w.onmessage = (e) => {
        w.terminate();
        worker.current = null;
        cancelWorker.current = null;
        if (e.data.error) reject(new Error(e.data.error));
        else resolve(e.data);
      };
      w.onerror = () => {
        w.terminate();
        worker.current = null;
        cancelWorker.current = null;
        reject(new Error('音频引擎运行失败，请缩短音频后重试。'));
      };
      w.postMessage({
        action,
        samples: audio.samples,
        rate: audio.rate,
        channels: audio.channels,
        settings,
      });
    });
  const run = async () => {
    if (!source) return;
    setBusy(true);
    setError('');
    setResult(undefined);
    player.current?.pause();
    const token = ++task.current;
    try {
      let input: AudioData = source;
      if (settings.mode === 'audiosr') {
        setProgress('正在连接本机 AI 服务…');
        const status = await health();
        if (!status.ready) throw new Error(status.error || '请先启动本地服务并安装 AudioSR 模型。');
        setService(status.processor || status.gpu);
        const form = new FormData();
        form.append('file', waveBlob(source.samples, source.rate, source.channels), 'input.wav');
        for (const key of ['steps', 'seed', 'mix', 'cutoff'] as const)
          form.append(key, String(settings[key]));
        const created = await (await api('/api/jobs', { method: 'POST', body: form })).json();
        job.current = created.id;
        if (token !== task.current) {
          await api(`/api/jobs/${created.id}`, { method: 'DELETE' });
          return;
        }
        const start = Date.now();
        while (token === task.current) {
          const state = await (await api(`/api/jobs/${created.id}`)).json();
          if (state.status === 'failed' || state.status === 'cancelled')
            throw new Error(state.error || '任务已取消');
          if (state.status === 'succeeded') {
            input = await decodeAudio(await (await api(`/api/jobs/${created.id}/audio`)).blob());
            job.current = null;
            break;
          }
          setProgress(state.message || '本机模型正在重建细节…');
          if (Date.now() - start > 86400000) {
            await api(`/api/jobs/${created.id}`, { method: 'DELETE' });
            throw new Error('推理超过 24 小时，已请求取消。请缩短片段或减少步数。');
          }
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
      if (token !== task.current) return;
      setProgress('正在调音与转换输出规格…');
      const out = await compute('enhance', input);
      if (token !== task.current) return;
      const audio = {
        samples: out.samples,
        rate: out.rate,
        channels: out.channels,
        duration: out.samples.length / out.rate / out.channels,
      };
      setResult({
        ...audio,
        name: source.name,
        url: URL.createObjectURL(waveBlob(audio.samples, audio.rate, audio.channels)),
      });
      setProgress(
        settings.mode === 'audiosr'
          ? 'AI 细节重建完成 · 可试听、导出'
          : '本地调音完成 · 可试听、导出',
      );
    } catch (e) {
      if (token === task.current) {
        setError(e instanceof Error ? e.message : String(e));
        setProgress('');
      }
    } finally {
      if (token === task.current) setBusy(false);
    }
  };
  const exportAudio = async () => {
    if (!result) return;
    setBusy(true);
    setError('');
    setProgress('正在编码导出…');
    const token = ++task.current;
    try {
      let { blob } = await compute('export', result);
      if (settings.format === 'flac') {
        const form = new FormData();
        form.append('file', blob, 'input.wav');
        form.append('format', 'flac');
        form.append('bits', String(settings.bits));
        blob = await (await api('/api/export', { method: 'POST', body: form })).blob();
      }
      if (token !== task.current) return;
      const url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = `${result.name.replace(/\.[^/.]+$/, '')}-enhanced-${result.rate / 1000}k.${settings.format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setProgress(`已导出 · ${(blob.size / 1048576).toFixed(2)} MB`);
    } catch (e) {
      if (token === task.current) {
        setError(
          settings.format === 'flac' ? 'FLAC 编码需要本地服务，请先运行启动脚本。' : String(e),
        );
        setProgress('');
      }
    } finally {
      if (token === task.current) setBusy(false);
    }
  };
  const updateSettings = (next: Settings) => {
    if (
      ['mode', 'preset', 'noise', 'detail', 'rate', 'steps', 'seed', 'mix', 'cutoff'].some(
        (k) => next[k as keyof Settings] !== settings[k as keyof Settings],
      )
    ) {
      setResult(undefined);
      setProgress(source ? '设置已更新，请重新增强' : '');
    }
    setSettings(next);
  };
  const checkService = async () => {
    setService('连接中…');
    try {
      const s = await health();
      setService(s.ready ? `${s.processor || s.gpu} · 模型就绪` : s.error || '模型未安装');
    } catch {
      setService('未连接 · 请检查本机服务或浏览器网络权限');
    }
  };
  const sourceRms = useMemo(() => rms(source), [source]),
    resultRms = useMemo(() => rms(result), [result]),
    minRms = Math.min(sourceRms || 1, resultRms || 1);
  return (
    <>
      <header className="header">
        <a className="brand" href="/" aria-label="neko audio 首页">
          <AudioLines size={30} />
          <span>neko audio</span>
        </a>
        <nav>
          <a className="active" href="#studio">
            工作台
          </a>
          <a
            href="https://github.com/neko233-com/ai-music-enhancer"
            target="_blank"
            rel="noreferrer"
          >
            <Github size={16} />
            GitHub
          </a>
        </nav>
      </header>
      <main id="studio">
        <section className="intro">
          <h1>让好声音，更进一步。</h1>
          <p>AI 降噪 · 细节重建 · 高品质导出</p>
        </section>
        <div className="workspace">
          <div className="main-column">
            <section
              className={`upload panel ${dragging ? 'dragging' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) void load(file, file.name);
              }}
            >
              <div className="drop-area">
                <ArrowUpFromLine size={37} strokeWidth={1.6} />
                <h2>{source ? source.name : '把音频拖到这里'}</h2>
                <p>
                  {source
                    ? `${source.duration.toFixed(1)} 秒 · ${source.rate / 1000} kHz · ${source.channels === 2 ? '立体声' : '单声道'}`
                    : 'WAV、MP3、FLAC、M4A · 本地处理，音频不上传'}
                </p>
                <div className="upload-actions">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    {source ? '更换音频' : '选择音频'}
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      demoSection.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }
                  >
                    试听示例
                  </button>
                </div>
                <input
                  ref={fileInput}
                  aria-label="上传音频"
                  type="file"
                  accept="audio/*,.flac,.wav,.mp3,.m4a,.ogg"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void load(file, file.name);
                    e.target.value = '';
                  }}
                />
              </div>
            </section>
            <section className="comparison panel">
              <div className="section-heading">
                <div>
                  <h2>听见每一处变化</h2>
                  <p>转换前后对比 · 切换试听保留播放位置</p>
                </div>
                <Headphones size={22} />
              </div>
              <WavePlayer
                label="原始音频"
                url={source?.url}
                audio={source}
                shared={player}
                match={match}
                gain={sourceRms ? minRms / sourceRms : 1}
              />
              <WavePlayer
                label="增强音频"
                url={result?.url}
                audio={result}
                enhanced
                shared={player}
                match={match}
                gain={resultRms ? minRms / resultRms : 1}
              />
              <label className="check">
                <input
                  type="checkbox"
                  checked={match}
                  onChange={(e) => setMatch(e.target.checked)}
                />
                匹配试听音量 <span>避免把更响误听成更好</span>
              </label>
            </section>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <section className="demos panel" ref={demoSection}>
              <div className="section-heading">
                <div>
                  <h2>从一段声音开始</h2>
                  <p>项目自带示例 · 纯人声 / 纯音乐 / 人声音乐 · 各 2 段</p>
                </div>
              </div>
              <div className="demo-list">
                {demos.map((demo, i) => (
                  <button
                    key={demo.id}
                    onClick={() => void loadDemo(demo)}
                    disabled={busy}
                    className={source?.name === demo.name ? 'selected' : ''}
                  >
                    <span className="demo-number">0{i + 1}</span>
                    <span>
                      <strong>{demo.name}</strong>
                      <small>
                        {demo.category} · {demo.description}
                      </small>
                    </span>
                    <AudioLines size={20} />
                  </button>
                ))}
              </div>
              <p className="hint">
                两段系统语音、两段原创旋律与两段公有领域真人演唱。音频与来源说明已打包，可离线使用。
              </p>
            </section>
          </div>
          <SettingsPanel
            settings={settings}
            onChange={updateSettings}
            busy={busy}
            source={!!source}
            result={!!result}
            progress={progress}
            onRun={() => void run()}
            onExport={() => void exportAudio()}
            onCancel={cancel}
            size={source ? estimateBytes(source.duration, source.channels, settings) : 0}
            channels={source?.channels || 2}
          />
        </div>
        <section className="truth panel">
          <Info size={27} />
          <div>
            <h3>真实增强，诚实呈现。</h3>
            <p>
              AudioSR 在本机推断缺失的细节；192 kHz
              是导出规格，不代表恢复原始录音。请用双音轨试听判断效果。
            </p>
          </div>
        </section>
        <section className="offline-section">
          <div>
            <h2>
              <WifiOff size={20} /> 完全离线，也能继续创作
            </h2>
            <p>
              {offline
                ? '网页与示例已缓存，可离线重新打开。'
                : '首次访问后缓存网页；也可从本机服务打开。'}{' '}
              音频始终留在你的设备。
            </p>
            <p>
              CPU 细节重建 / FLAC：首次安装运行 <code>scripts/setup-local.ps1</code>，之后使用{' '}
              <code>scripts/start-local.ps1</code>。
            </p>
            <details>
              <summary>
                <CircleHelp size={15} /> 离线使用与模型说明
              </summary>
              <p>
                首次安装需要联网下载依赖与约 6.2 GB 模型。安装完成后断网，打开 http://127.0.0.1:8765
                即可使用全部功能。Cloudflare 只提供网页文件；模型推理默认在本机 CPU
                运行，无需显卡、CUDA 或云端 API。
              </p>
              <p>
                AudioSR 原生重建至 48
                kHz，适合带宽不足的声音。高质量母带可能无需重建。立体声逐声道处理，保留长度；生成结果可能改变空间感。WAV
                支持全部位深，FLAC 支持 16/24 bit，MP3 支持 44.1/48 kHz、64–320 kbps。网页单次最多
                180 秒 / 80 MB，高采样率输出受 4000 万采样内存上限限制。
              </p>
            </details>
          </div>
          <div className="service">
            <span>本机 AI 服务 · 默认 CPU</span>
            <strong>{service}</strong>
            <button className="outline" onClick={() => void checkService()}>
              <RefreshCw size={14} />
              检测连接
            </button>
            <a href="http://127.0.0.1:8765" target="_blank" rel="noreferrer">
              打开本机离线工作台 ↗
            </a>
            <small>在线页面需允许浏览器访问本机网络；本机入口可直接离线使用。</small>
          </div>
        </section>
      </main>
      <footer>
        <span>
          <CheckCircle2 size={13} /> RUST + WEBASSEMBLY + AUDIOSR
        </span>
        <span>Made for listening.</span>
      </footer>
    </>
  );
}

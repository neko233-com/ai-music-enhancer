import { Download, SlidersHorizontal, Sparkles } from 'lucide-react';
import { RATES, type Settings } from '../audio';
type Props = {
  settings: Settings;
  onChange: (s: Settings) => void;
  busy: boolean;
  source: boolean;
  result: boolean;
  progress: string;
  onRun: () => void;
  onExport: () => void;
  onCancel: () => void;
  size: number;
  channels: number;
};
export function SettingsPanel({
  settings: s,
  onChange,
  busy,
  source,
  result,
  progress,
  onRun,
  onExport,
  onCancel,
  size,
  channels,
}: Props) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...s, [key]: value });
  return (
    <aside className="settings panel">
      <h2>
        <SlidersHorizontal size={21} />
        声音调校
      </h2>
      <fieldset disabled={busy}>
        <label className="field-label" htmlFor="mode">
          处理引擎
        </label>
        <select
          id="mode"
          value={s.mode}
          onChange={(e) => set('mode', e.target.value as Settings['mode'])}
        >
          <option value="local">本地降噪与调音</option>
          <option value="audiosr">AudioSR · GPU 细节重建</option>
        </select>
        <span className="field-label">预设场景</span>
        <div className="segments">
          {(['music', 'voice'] as const).map((p) => (
            <button
              key={p}
              aria-pressed={s.preset === p}
              onClick={() =>
                onChange({
                  ...s,
                  preset: p,
                  noise: p === 'music' ? 0.15 : 0.7,
                  detail: p === 'music' ? 0.3 : 0.15,
                })
              }
            >
              {p === 'music' ? '音乐' : '人声'}
            </button>
          ))}
        </div>
        <label className="slider-label" htmlFor="noise">
          AI 降噪 <span>{Math.round(s.noise * 100)}%</span>
        </label>
        <input
          id="noise"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={s.noise}
          onChange={(e) => set('noise', +e.target.value)}
        />
        <label className="slider-label" htmlFor="detail">
          细节增强 <span>{Math.round(s.detail * 100)}%</span>
        </label>
        <input
          id="detail"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={s.detail}
          onChange={(e) => set('detail', +e.target.value)}
        />
        <p className="hint">
          {s.preset === 'music'
            ? '轻度降噪，保留音乐的动态与质感。'
            : '加强语音降噪，让对白更清晰。'}{' '}
          RNNoise 针对语音训练。
        </p>
        {s.mode === 'audiosr' && (
          <details className="model-options">
            <summary>重建参数 · 混合比例 / 步数 / 带宽</summary>
            <label className="slider-label" htmlFor="mix">
              重建混合比例 <span>{Math.round(s.mix * 100)}%</span>
            </label>
            <input
              id="mix"
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={s.mix}
              onChange={(e) => set('mix', +e.target.value)}
            />
            <div className="fields">
              <label>
                推理步数
                <select value={s.steps} onChange={(e) => set('steps', +e.target.value)}>
                  {[10, 25, 50, 100].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                随机种子
                <input
                  aria-label="随机种子"
                  type="number"
                  min="0"
                  max="2147483647"
                  value={s.seed}
                  onChange={(e) => set('seed', +e.target.value)}
                />
              </label>
            </div>
            <label className="field-label" htmlFor="cutoff">
              源音频带宽
            </label>
            <select id="cutoff" value={s.cutoff} onChange={(e) => set('cutoff', +e.target.value)}>
              <option value="0">自动识别</option>
              {[4000, 8000, 12000, 16000].map((x) => (
                <option value={x} key={x}>
                  {x / 1000} kHz 低通预处理
                </option>
              ))}
            </select>
            <p className="hint">
              本机生成缺失的高频纹理，模型原生输出 48 kHz。可能改变音色，建议 A/B 试听。
            </p>
          </details>
        )}
        <div className="output-settings">
          <h3>输出设置</h3>
          <div className="fields">
            <label>
              格式
              <select
                aria-label="输出格式"
                value={s.format}
                onChange={(e) => {
                  const format = e.target.value as Settings['format'];
                  onChange({
                    ...s,
                    format,
                    rate: format === 'mp3' ? 48000 : s.rate,
                    bits: format === 'flac' ? 24 : s.bits,
                  });
                }}
              >
                <option value="wav">WAV · 无损</option>
                <option value="flac">FLAC · 无损</option>
                <option value="mp3">MP3 · 有损</option>
              </select>
            </label>
            <label>
              采样率
              <select
                aria-label="采样率"
                value={s.rate}
                onChange={(e) => set('rate', +e.target.value)}
              >
                {(s.format === 'mp3' ? [44100, 48000] : RATES).map((rate) => (
                  <option key={rate} value={rate}>
                    {rate / 1000} kHz
                  </option>
                ))}
              </select>
            </label>
          </div>
          {s.format === 'mp3' ? (
            <label className="field-label">
              目标码率
              <select
                aria-label="目标码率"
                value={s.bitrate}
                onChange={(e) => set('bitrate', +e.target.value)}
              >
                {[64, 96, 128, 160, 192, 224, 256, 320].map((x) => (
                  <option key={x} value={x}>
                    {x} kbps · CBR
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field-label">
              位深
              <select
                aria-label="位深"
                value={s.bits}
                onChange={(e) => set('bits', +e.target.value)}
              >
                <option value="16">16 bit · PCM</option>
                <option value="24">24 bit · PCM</option>
                {s.format !== 'flac' && (
                  <>
                    <option value="32">32 bit · PCM</option>
                    <option value="33">32 bit · Float</option>
                  </>
                )}
              </select>
            </label>
          )}
          <p className="hint output-meta">
            {s.format === 'mp3'
              ? `${s.bitrate} kbps`
              : `${Math.round((s.rate * channels * (s.bits === 33 ? 32 : s.bits)) / 1000)} kbps PCM`}{' '}
            · {size ? `约 ${(size / 1048576).toFixed(1)} MB` : '等待音频'}
            {s.format === 'flac' ? ' · 压缩前估计' : ''}
          </p>
        </div>
      </fieldset>
      <button className="primary wide" disabled={busy || !source} onClick={onRun}>
        <Sparkles size={17} />
        {busy ? '处理中…' : '开始增强'}
      </button>
      <button className="outline wide" disabled={busy || !result} onClick={onExport}>
        <Download size={17} />
        导出 {s.format.toUpperCase()}
      </button>
      <div className="progress" role="status" aria-live="polite">
        {progress}
      </div>
      {busy && (
        <button className="text-button wide" onClick={onCancel}>
          取消处理
        </button>
      )}
    </aside>
  );
}

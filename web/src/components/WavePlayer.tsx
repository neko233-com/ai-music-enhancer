import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { peakBins, time, type AudioData } from '../audio';
type Props = {
  label: string;
  url?: string;
  audio?: AudioData;
  enhanced?: boolean;
  shared: React.RefObject<HTMLAudioElement | null>;
  match: boolean;
  gain?: number;
};
export function WavePlayer({ label, url, audio, enhanced, shared, match, gain = 1 }: Props) {
  const ref = useRef<HTMLAudioElement>(null),
    [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0);
  const bins = useMemo(
    () => (audio ? peakBins(audio.samples, audio.channels) : Array(180).fill(0)),
    [audio],
  );
  useEffect(() => {
    setPlaying(false);
    setPosition(0);
    if (ref.current) ref.current.load();
  }, [url]);
  useEffect(() => {
    if (ref.current) ref.current.volume = match ? Math.min(1, gain) : 1;
  }, [gain, match]);
  const toggle = async () => {
    const current = ref.current;
    if (!current || !url) return;
    if (!current.paused) {
      current.pause();
      return;
    }
    if (shared.current && shared.current !== current) {
      const previous = shared.current,
        wasPlaying = !previous.paused;
      previous.pause();
      if (wasPlaying && audio)
        current.currentTime = Math.min(previous.currentTime, Math.max(0, audio.duration - 0.02));
    }
    shared.current = current;
    try {
      await current.play();
    } catch {
      setPlaying(false);
    }
  };
  return (
    <section className={`wave-player ${enhanced ? 'enhanced' : ''}`} aria-label={label}>
      <div className="wave-heading">
        <strong>{label}</strong>
        <span>{audio ? `${time(position)} / ${time(audio.duration)}` : '等待音频'}</span>
      </div>
      <div className="wave-body">
        <button
          className="play-button"
          aria-label={`${playing ? '暂停' : '播放'}${label}`}
          disabled={!url}
          onClick={toggle}
        >
          {playing ? (
            <Pause size={19} fill="currentColor" />
          ) : (
            <Play size={19} fill="currentColor" />
          )}
        </button>
        <div className="wave-track">
          <svg
            viewBox="0 0 720 64"
            preserveAspectRatio="none"
            role="img"
            aria-label={`${label}波形`}
          >
            {bins.map((peak, i) => (
              <line
                key={i}
                x1={i * 4 + 2}
                x2={i * 4 + 2}
                y1={32 - Math.max(1, peak * 30)}
                y2={32 + Math.max(1, peak * 30)}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                opacity={audio ? 1 : 0.3}
              />
            ))}
          </svg>
          <input
            type="range"
            aria-label={`${label}播放进度`}
            min="0"
            max={audio?.duration || 1}
            step="0.01"
            value={position}
            disabled={!url}
            onChange={(e) => {
              if (ref.current) ref.current.currentTime = Number(e.target.value);
              setPosition(Number(e.target.value));
            }}
          />
        </div>
      </div>
      <audio
        ref={ref}
        src={url}
        preload="metadata"
        onTimeUpdate={() => setPosition(ref.current?.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </section>
  );
}

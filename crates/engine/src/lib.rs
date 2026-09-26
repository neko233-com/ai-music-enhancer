//! Shared, offline audio processing. RNNoise is a speech denoiser, not music super-resolution.
use nnnoiseless::DenoiseState;
use std::f64::consts::PI;
use wasm_bindgen::prelude::*;

pub const RATES: [u32; 6] = [44100, 48000, 88200, 96000, 176400, 192000];
pub const MAX_SAMPLES: usize = 40_000_000;

fn validate(input: &[f32], rate: u32, channels: u32) -> Result<(), String> {
    if !(8000..=192000).contains(&rate) || !(1..=2).contains(&channels) {
        return Err("Only 8–192 kHz mono/stereo audio is supported".into());
    }
    if input.is_empty()
        || input.len() > MAX_SAMPLES
        || !input.len().is_multiple_of(channels as usize)
    {
        return Err("Audio is empty, too large, or has incomplete channel frames".into());
    }
    if input.iter().any(|x| !x.is_finite()) {
        return Err("Audio contains non-finite samples".into());
    }
    Ok(())
}

/// Polyphase windowed-sinc conversion with a low-pass cutoff when downsampling.
pub fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to {
        return input.to_vec();
    }
    if input.is_empty() || from == 0 || to == 0 {
        return Vec::new();
    }
    const HALF: i32 = 32;
    const PHASES: usize = 1024;
    let cutoff = (to as f64 / from as f64).min(1.0) * 0.94;
    let kernels: Vec<Vec<f64>> = (0..PHASES)
        .map(|p| {
            let frac = p as f64 / PHASES as f64;
            let mut k: Vec<f64> = (-HALF + 1..=HALF)
                .map(|j| {
                    let x = j as f64 - frac;
                    let sinc = if x.abs() < 1e-12 {
                        cutoff
                    } else {
                        (PI * cutoff * x).sin() / (PI * x)
                    };
                    let window = 0.42
                        + 0.5 * (PI * x / HALF as f64).cos()
                        + 0.08 * (2.0 * PI * x / HALF as f64).cos();
                    sinc * window
                })
                .collect();
            let sum: f64 = k.iter().sum();
            for x in &mut k {
                *x /= sum;
            }
            k
        })
        .collect();
    let len = (input.len() as u64 * to as u64).div_ceil(from as u64) as usize;
    (0..len)
        .map(|i| {
            let pos = i as f64 * from as f64 / to as f64;
            let center = pos.floor() as i64;
            let phase = ((pos.fract() * PHASES as f64) as usize).min(PHASES - 1);
            kernels[phase]
                .iter()
                .enumerate()
                .map(|(j, weight)| {
                    let index = (center + j as i64 - HALF as i64 + 1)
                        .clamp(0, input.len() as i64 - 1) as usize;
                    input[index] as f64 * weight
                })
                .sum::<f64>() as f32
        })
        .collect()
}

fn denoise(input: &[f32]) -> Vec<f32> {
    const FRAME: usize = DenoiseState::FRAME_SIZE;
    let mut state = DenoiseState::new();
    let mut result = Vec::with_capacity(input.len() + FRAME);
    let mut source = [0.0; FRAME];
    let mut output = [0.0; FRAME];
    // RNNoise has one frame of analysis latency. Flush once, discard first output.
    for frame in 0..=input.len().div_ceil(FRAME) {
        source.fill(0.0);
        for (i, x) in source.iter_mut().enumerate() {
            *x = input.get(frame * FRAME + i).copied().unwrap_or(0.0) * 32768.0;
        }
        state.process_frame(&mut output, &source);
        if frame > 0 {
            result.extend(output.iter().map(|x| x / 32768.0));
        }
    }
    result.truncate(input.len());
    result
}

pub fn enhance_audio(
    input: &[f32],
    rate: u32,
    channels: u32,
    noise: f32,
    detail: f32,
    target: u32,
) -> Result<Vec<f32>, String> {
    validate(input, rate, channels)?;
    if !RATES.contains(&target)
        || !noise.is_finite()
        || !detail.is_finite()
        || !(0.0..=1.0).contains(&noise)
        || !(0.0..=1.0).contains(&detail)
    {
        return Err("Invalid output rate or enhancement strength".into());
    }
    let frames = input.len() / channels as usize;
    let out_frames = (frames as u64 * target as u64).div_ceil(rate as u64) as usize;
    if out_frames * channels as usize > MAX_SAMPLES {
        return Err("Output exceeds the 40 million sample memory limit; use a shorter clip".into());
    }
    let mut output = vec![0.0; out_frames * channels as usize];
    for channel in 0..channels as usize {
        let mut mono: Vec<f32> = input
            .iter()
            .skip(channel)
            .step_by(channels as usize)
            .copied()
            .collect();
        if noise > 0.0 {
            let at_48k = resample(&mono, rate, 48000);
            let clean = denoise(&at_48k);
            let residual: Vec<f32> = at_48k.iter().zip(clean).map(|(a, b)| a - b).collect();
            let residual = resample(&residual, 48000, rate);
            for (x, n) in mono.iter_mut().zip(residual) {
                *x -= n * noise;
            }
        }
        // Gentle high shelf, no invented claim of recovering missing frequencies.
        let alpha = 1.0 - (-2.0 * std::f32::consts::PI * 3200.0 / rate as f32).exp();
        let mut low = mono[0];
        for x in &mut mono {
            low += alpha * (*x - low);
            *x += detail * 0.55 * (*x - low);
        }
        let converted = resample(&mono, rate, target);
        for (i, x) in converted.into_iter().enumerate() {
            output[i * channels as usize + channel] = x;
        }
    }
    // Linked attenuation only: preserve stereo balance and avoid loudness inflation.
    let peak = output.iter().fold(0.0_f32, |a, b| a.max(b.abs()));
    let ceiling = 10.0_f32.powf(-1.0 / 20.0);
    if peak > ceiling {
        for x in &mut output {
            *x *= ceiling / peak;
        }
    }
    Ok(output)
}

/// WAV PCM 16/24/32 integer, or IEEE float with bits=33. TPDF dither for integer PCM.
pub fn encode_wave(input: &[f32], rate: u32, channels: u32, bits: u32) -> Result<Vec<u8>, String> {
    validate(input, rate, channels)?;
    if ![16, 24, 32, 33].contains(&bits) {
        return Err("Expected 16, 24, 32, or 33 (float32)".into());
    }
    let float = bits == 33;
    let depth = if float { 32 } else { bits };
    let bytes = depth / 8;
    let data_size = input.len() * bytes as usize;
    let padding = data_size % 2;
    let extra = if float { 12 } else { 0 };
    let mut out = Vec::with_capacity(data_size + 44 + extra + padding);
    out.extend(b"RIFF");
    out.extend(((data_size + 36 + extra + padding) as u32).to_le_bytes());
    out.extend(b"WAVEfmt ");
    out.extend(16u32.to_le_bytes());
    out.extend((if float { 3u16 } else { 1u16 }).to_le_bytes());
    out.extend((channels as u16).to_le_bytes());
    out.extend(rate.to_le_bytes());
    out.extend((rate * channels * bytes).to_le_bytes());
    out.extend(((channels * bytes) as u16).to_le_bytes());
    out.extend((depth as u16).to_le_bytes());
    if float {
        out.extend(b"fact");
        out.extend(4u32.to_le_bytes());
        out.extend(((input.len() / channels as usize) as u32).to_le_bytes());
    }
    out.extend(b"data");
    out.extend((data_size as u32).to_le_bytes());
    let mut seed: u32 = 0x233abcd;
    let mut random = || {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        seed as f64 / u32::MAX as f64
    };
    for &x in input {
        if float {
            out.extend(x.to_le_bytes());
        } else {
            let scale = (1u64 << (depth - 1)) as f64;
            let dither = if x == 0.0 { 0.0 } else { random() - random() };
            let value = (x as f64 * scale + dither)
                .round()
                .clamp(-scale, scale - 1.0) as i32;
            out.extend(&value.to_le_bytes()[..bytes as usize]);
        }
    }
    if padding != 0 {
        out.push(0);
    }
    Ok(out)
}

#[wasm_bindgen]
pub fn enhance(
    input: &[f32],
    rate: u32,
    channels: u32,
    noise: f32,
    detail: f32,
    target: u32,
) -> Result<Vec<f32>, JsValue> {
    enhance_audio(input, rate, channels, noise, detail, target).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn wav(input: &[f32], rate: u32, channels: u32, bits: u32) -> Result<Vec<u8>, JsValue> {
    encode_wave(input, rate, channels, bits).map_err(|e| JsValue::from_str(&e))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tone(rate: u32, frequency: f32, length: usize) -> Vec<f32> {
        (0..length)
            .map(|i| 0.4 * (i as f32 * 2.0 * std::f32::consts::PI * frequency / rate as f32).sin())
            .collect()
    }
    #[test]
    fn rejects_invalid_inputs() {
        for data in [vec![], vec![f32::NAN], vec![f32::INFINITY]] {
            assert!(enhance_audio(&data, 48000, 1, 0.0, 0.0, 48000).is_err());
        }
        assert!(enhance_audio(&[0.1], 48000, 2, 0.0, 0.0, 48000).is_err());
        assert!(enhance_audio(&[0.1], 48000, 1, f32::NAN, 0.0, 48000).is_err());
        assert!(enhance_audio(&[0.1], 48000, 1, 0.0, 0.0, 0).is_err());
    }
    #[test]
    fn bypass_is_sample_identical_and_channels_do_not_leak() {
        let mono = tone(48000, 440.0, 4800);
        let stereo: Vec<_> = mono.iter().flat_map(|x| [*x, 0.0]).collect();
        assert_eq!(
            enhance_audio(&stereo, 48000, 2, 0.0, 0.0, 48000).unwrap(),
            stereo
        );
        let out = enhance_audio(&stereo, 48000, 2, 0.15, 0.3, 96000).unwrap();
        assert!(out.iter().skip(1).step_by(2).all(|x| *x == 0.0));
    }
    #[test]
    fn duration_tail_and_silence_survive_ai() {
        for len in [1, 479, 480, 481, 960, 1234] {
            let out = enhance_audio(&vec![0.0; len], 48000, 1, 1.0, 0.5, 192000).unwrap();
            assert_eq!(out.len(), len * 4);
            assert!(out.iter().all(|x| *x == 0.0));
        }
    }
    #[test]
    fn neural_denoising_changes_signal_and_limits_peak() {
        let input = tone(48000, 440.0, 4800);
        let out = enhance_audio(&input, 48000, 1, 0.8, 0.0, 48000).unwrap();
        assert!(
            out.iter()
                .zip(&input)
                .map(|(a, b)| (a - b).abs())
                .sum::<f32>()
                > 1.0
        );
        let loud: Vec<_> = input.iter().map(|x| x * 10.0).collect();
        assert!(enhance_audio(&loud, 48000, 1, 0.0, 1.0, 48000)
            .unwrap()
            .iter()
            .all(|x| x.is_finite() && x.abs() <= 0.89126));
    }
    #[test]
    fn sinc_rejects_aliasing_and_preserves_in_band_tone() {
        let high = resample(&tone(96000, 35000.0, 9600), 96000, 48000);
        let low = resample(&tone(96000, 1000.0, 9600), 96000, 48000);
        let rms = |v: &[f32]| {
            (v[100..v.len() - 100].iter().map(|x| x * x).sum::<f32>() / (v.len() - 200) as f32)
                .sqrt()
        };
        assert!(rms(&high) < 0.004);
        assert!((rms(&low) - 0.28284).abs() < 0.002);
    }
    #[test]
    fn all_export_specs_round_trip() {
        for rate in RATES {
            for bits in [16, 24, 32, 33] {
                let data = encode_wave(&[-0.5, 0.0, 0.5], rate, 1, bits).unwrap();
                assert_eq!(
                    u32::from_le_bytes(data[4..8].try_into().unwrap()) as usize + 8,
                    data.len()
                );
                let mut reader = hound::WavReader::new(std::io::Cursor::new(data)).unwrap();
                assert_eq!(reader.spec().sample_rate, rate);
                assert_eq!(reader.duration(), 3);
                if bits == 33 {
                    assert_eq!(
                        reader
                            .samples::<f32>()
                            .map(Result::unwrap)
                            .collect::<Vec<_>>(),
                        [-0.5, 0.0, 0.5]
                    );
                } else {
                    assert_eq!(reader.spec().bits_per_sample, bits as u16);
                    assert_eq!(reader.samples::<i32>().count(), 3);
                }
            }
        }
    }
}

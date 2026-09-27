use anyhow::{bail, Context, Result};
use clap::{Parser, ValueEnum};
use neko_audio_engine::{encode_wave, enhance_audio, MAX_SAMPLES};
use std::{
    fs::File,
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use symphonia::core::{
    audio::SampleBuffer, codecs::DecoderOptions, errors::Error, formats::FormatOptions,
    io::MediaSourceStream, meta::MetadataOptions, probe::Hint,
};

#[derive(Clone, Debug, ValueEnum)]
enum Mode {
    Local,
    Audiosr,
}
#[derive(Parser, Debug)]
#[command(
    version,
    about = "Offline AI audio reconstruction, refinement and high-resolution export"
)]
struct Args {
    input: PathBuf,
    #[arg(short, long)]
    output: PathBuf,
    #[arg(long, value_enum, default_value = "audiosr")]
    mode: Mode,
    #[arg(long, default_value_t = 48000)]
    sample_rate: u32,
    /// 16, 24, 32 (integer PCM), or 33 (32-bit float WAV)
    #[arg(long, default_value_t = 24)]
    bits: u32,
    /// RNNoise wet mix (0..1). Speech-trained; use sparingly on music.
    #[arg(long, default_value_t = 0.15)]
    denoise: f32,
    #[arg(long, default_value_t = 0.3)]
    detail: f32,
    #[arg(long, default_value = "http://127.0.0.1:8765")]
    server: String,
    #[arg(long, default_value_t = 50)]
    steps: u32,
    #[arg(long, default_value_t = 233)]
    seed: u32,
    /// Maximum job duration, in seconds. CPU inference can take much longer than GPU.
    #[arg(long, default_value_t = 86400, value_parser = clap::value_parser!(u64).range(1..=604800))]
    timeout_seconds: u64,
    /// Blend inferred high-band detail into the original (0..1)
    #[arg(long, default_value_t = 0.7)]
    mix: f32,
    /// Source low-pass preprocessing: 0 (auto), 4000, 8000, 12000 or 16000 Hz
    #[arg(long, default_value_t = 0)]
    cutoff: u32,
    /// MP3 target bitrate in kbps; requires local service for MP3/FLAC export
    #[arg(long, default_value_t = 320)]
    bitrate: u32,
    #[arg(long)]
    overwrite: bool,
}

fn decode(path: &Path) -> Result<(Vec<f32>, u32, u32)> {
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
        hint.with_extension(ext);
    }
    let source = MediaSourceStream::new(Box::new(File::open(path)?), Default::default());
    let mut format = symphonia::default::get_probe()
        .format(
            &hint,
            source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )?
        .format;
    let track = format.default_track().context("No default audio track")?;
    let id = track.id;
    let mut decoder =
        symphonia::default::get_codecs().make(&track.codec_params, &DecoderOptions::default())?;
    let mut samples = Vec::new();
    let mut rate = 0;
    let mut channels = 0;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(Error::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(e.into()),
        };
        if packet.track_id() != id {
            continue;
        }
        let audio = decoder.decode(&packet)?;
        let spec = *audio.spec();
        if channels != 0 && (rate != spec.rate || channels != spec.channels.count() as u32) {
            bail!("Midstream format changes are not supported");
        }
        rate = spec.rate;
        channels = spec.channels.count() as u32;
        if channels > 2 {
            bail!("Only mono/stereo supported");
        }
        let mut buffer = SampleBuffer::<f32>::new(audio.capacity() as u64, spec);
        buffer.copy_interleaved_ref(audio);
        if samples.len() + buffer.samples().len() > MAX_SAMPLES {
            bail!("Input exceeds memory limit; split into shorter files");
        }
        samples.extend_from_slice(buffer.samples());
    }
    if samples.is_empty() {
        bail!("Empty audio");
    }
    Ok((samples, rate, channels))
}

fn server_url(server: &str) -> Result<reqwest::Url> {
    let url = reqwest::Url::parse(server)?;
    if url.scheme() != "http"
        || !matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
        || !url.username().is_empty()
        || url.password().is_some()
    {
        bail!("Offline mode only permits an HTTP loopback service");
    }
    Ok(url)
}

fn reconstruct(args: &Args, client: &reqwest::blocking::Client, input: Vec<u8>) -> Result<Vec<u8>> {
    let base = server_url(&args.server)?;
    let form = reqwest::blocking::multipart::Form::new()
        .part(
            "file",
            reqwest::blocking::multipart::Part::bytes(input).file_name("input.wav"),
        )
        .text("steps", args.steps.to_string())
        .text("seed", args.seed.to_string())
        .text("mix", args.mix.to_string())
        .text("cutoff", args.cutoff.to_string());
    let job: serde_json::Value = client
        .post(base.join("/api/jobs")?)
        .header("X-Neko-Client", "1")
        .multipart(form)
        .send()?
        .error_for_status()?
        .json()?;
    let id = job["id"].as_str().context("Missing job id")?;
    let start = Instant::now();
    loop {
        if start.elapsed() > Duration::from_secs(args.timeout_seconds) {
            let _ = client
                .delete(base.join(&format!("/api/jobs/{id}"))?)
                .header("X-Neko-Client", "1")
                .send();
            bail!(
                "AudioSR timed out after {} seconds; increase --timeout-seconds for CPU inference",
                args.timeout_seconds
            );
        }
        let state: serde_json::Value = client
            .get(base.join(&format!("/api/jobs/{id}"))?)
            .send()?
            .error_for_status()?
            .json()?;
        match state["status"].as_str() {
            Some("succeeded") => {
                return Ok(client
                    .get(base.join(&format!("/api/jobs/{id}/audio"))?)
                    .send()?
                    .error_for_status()?
                    .bytes()?
                    .to_vec())
            }
            Some("failed" | "cancelled") => bail!("AudioSR: {}", state["error"]),
            _ => std::thread::sleep(Duration::from_secs(1)),
        }
    }
}

fn main() -> Result<()> {
    let args = Args::parse();
    enhance_audio(
        &[0.0],
        48000,
        1,
        args.denoise,
        args.detail,
        args.sample_rate,
    )
    .map_err(anyhow::Error::msg)?;
    encode_wave(&[0.0], args.sample_rate, 1, args.bits).map_err(anyhow::Error::msg)?;
    if !(10..=100).contains(&args.steps)
        || args.seed > 2147483647
        || !args.mix.is_finite()
        || !(0.0..=1.0).contains(&args.mix)
        || ![0, 4000, 8000, 12000, 16000].contains(&args.cutoff)
    {
        bail!("Invalid AudioSR steps, seed, mix or cutoff");
    }
    if args.input == args.output {
        bail!("Input and output must differ");
    }
    if args.output.exists() && !args.overwrite {
        bail!("Output exists; use --overwrite explicitly");
    }
    let extension = args
        .output
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !["wav", "flac", "mp3"].contains(&extension.as_str()) {
        bail!("Output must be .wav, .flac or .mp3");
    }
    if extension == "flac" && ![16, 24].contains(&args.bits) {
        bail!("FLAC export supports 16/24 bit");
    }
    if extension == "mp3" && ![44100, 48000].contains(&args.sample_rate) {
        bail!("MP3 export supports 44.1/48 kHz; use WAV/FLAC for higher rates");
    }
    let (mut input, mut rate, mut channels) = decode(&args.input)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .no_proxy()
        .build()?;
    if matches!(args.mode, Mode::Audiosr) {
        let result = reconstruct(
            &args,
            &client,
            encode_wave(&input, rate, channels, 33).map_err(anyhow::Error::msg)?,
        )?;
        let mut temp = tempfile::Builder::new().suffix(".wav").tempfile()?;
        temp.write_all(&result)?;
        (input, rate, channels) = decode(temp.path())?;
    }
    let output = enhance_audio(
        &input,
        rate,
        channels,
        args.denoise,
        args.detail,
        args.sample_rate,
    )
    .map_err(anyhow::Error::msg)?;
    let mut bytes =
        encode_wave(&output, args.sample_rate, channels, args.bits).map_err(anyhow::Error::msg)?;
    if extension != "wav" {
        let base = server_url(&args.server)?;
        let form = reqwest::blocking::multipart::Form::new()
            .part(
                "file",
                reqwest::blocking::multipart::Part::bytes(bytes).file_name("input.wav"),
            )
            .text("format", extension.clone())
            .text("bits", args.bits.to_string())
            .text("bitrate", args.bitrate.to_string());
        bytes = client
            .post(base.join("/api/export")?)
            .header("X-Neko-Client", "1")
            .multipart(form)
            .send()?
            .error_for_status()?
            .bytes()?
            .to_vec();
    }
    let parent = args
        .output
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(&bytes)?;
    temporary.as_file().sync_all()?;
    if args.overwrite {
        temporary.persist(&args.output)?;
    } else {
        temporary.persist_noclobber(&args.output)?;
    }
    println!(
        "Saved {} · {} Hz · {} ch · {} bit · {} bytes",
        args.output.display(),
        args.sample_rate,
        channels,
        if args.bits == 33 { 32 } else { args.bits },
        bytes.len()
    );
    Ok(())
}

use std::{fs, process::Command};
#[test]
fn converts_real_wav_and_protects_existing_files() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("in.wav");
    let output = dir.path().join("out.wav");
    let data = neko_audio_engine::encode_wave(&vec![0.1; 480], 48000, 1, 16).unwrap();
    fs::write(&input, data).unwrap();
    let run = || {
        Command::new(env!("CARGO_BIN_EXE_neko-audio"))
            .arg(&input)
            .arg("-o")
            .arg(&output)
            .args([
                "--sample-rate",
                "192000",
                "--bits",
                "33",
                "--denoise",
                "0",
                "--mode",
                "local",
            ])
            .output()
            .unwrap()
    };
    assert!(run().status.success());
    let before = fs::read(&output).unwrap();
    let reader = hound::WavReader::open(&output).unwrap();
    assert_eq!(reader.spec().sample_rate, 192000);
    assert_eq!(reader.duration(), 1920);
    assert!(!run().status.success());
    assert_eq!(fs::read(&output).unwrap(), before);
}

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use hound::{SampleFormat as WavSampleFormat, WavSpec, WavWriter};
use std::env;
use std::fs::File;
use std::io::{self, BufWriter, Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

type SharedWriter = Arc<Mutex<Option<WavWriter<BufWriter<File>>>>>;
type SharedLevel = Arc<Mutex<f32>>;

fn main() {
    if let Err(message) = run() {
        eprintln!("ERROR {message}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let output_path = parse_output_path()?;
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "No default input device was found.".to_string())?;
    let supported = device
        .default_input_config()
        .map_err(|err| format!("Failed to read default microphone config: {err}"))?;

    let stream_config: StreamConfig = supported.clone().into();
    let wav_spec = WavSpec {
        channels: supported.channels(),
        sample_rate: supported.sample_rate().0,
        bits_per_sample: 16,
        sample_format: WavSampleFormat::Int,
    };

    let writer = WavWriter::create(&output_path, wav_spec)
        .map_err(|err| format!("Failed to create output wav file: {err}"))?;
    let writer: SharedWriter = Arc::new(Mutex::new(Some(writer)));
    let level: SharedLevel = Arc::new(Mutex::new(0.0));
    let keep_running = Arc::new(AtomicBool::new(true));

    let stdin_flag = Arc::clone(&keep_running);
    let stdin_thread = thread::spawn(move || {
        let mut stdin = io::stdin();
        let mut buf = [0_u8; 256];
        while stdin_flag.load(Ordering::SeqCst) {
            match stdin.read(&mut buf) {
                Ok(0) => {
                    stdin_flag.store(false, Ordering::SeqCst);
                    break;
                }
                Ok(_) => {}
                Err(_) => {
                    stdin_flag.store(false, Ordering::SeqCst);
                    break;
                }
            }
        }
    });

    let reporter_flag = Arc::clone(&keep_running);
    let reporter_level = Arc::clone(&level);
    let reporter_thread = thread::spawn(move || {
        let mut stdout = io::stdout();
        while reporter_flag.load(Ordering::SeqCst) {
            let current_level = reporter_level.lock().map(|value| *value).unwrap_or(0.0);
            let _ = writeln!(stdout, "LEVEL {:.4}", current_level.clamp(0.0, 1.0));
            let _ = stdout.flush();
            thread::sleep(Duration::from_millis(150));
        }
    });

    let error_callback = |err| {
        eprintln!("ERROR Stream error: {err}");
    };

    let stream = match supported.sample_format() {
        SampleFormat::F32 => build_stream_f32(&device, &stream_config, Arc::clone(&writer), Arc::clone(&level), error_callback),
        SampleFormat::I16 => build_stream_i16(&device, &stream_config, Arc::clone(&writer), Arc::clone(&level), error_callback),
        SampleFormat::U16 => build_stream_u16(&device, &stream_config, Arc::clone(&writer), Arc::clone(&level), error_callback),
        sample_format => Err(format!("Unsupported microphone sample format: {sample_format:?}")),
    }?;

    stream
        .play()
        .map_err(|err| format!("Failed to start microphone stream: {err}"))?;

    println!("STARTED");
    io::stdout().flush().map_err(|err| format!("Failed to flush stdout: {err}"))?;

    while keep_running.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(50));
    }

    drop(stream);

    let _ = stdin_thread.join();
    let _ = reporter_thread.join();

    finalize_writer(writer)?;
    Ok(())
}

fn parse_output_path() -> Result<PathBuf, String> {
    env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or_else(|| "Missing output file path argument.".to_string())
}

fn build_stream_f32(
    device: &cpal::Device,
    config: &StreamConfig,
    writer: SharedWriter,
    level: SharedLevel,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<cpal::Stream, String> {
    device
        .build_input_stream(
            config,
            move |data: &[f32], _| write_samples_f32(data, &writer, &level),
            err_fn,
            None,
        )
        .map_err(|err| format!("Failed to build f32 input stream: {err}"))
}

fn build_stream_i16(
    device: &cpal::Device,
    config: &StreamConfig,
    writer: SharedWriter,
    level: SharedLevel,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<cpal::Stream, String> {
    device
        .build_input_stream(
            config,
            move |data: &[i16], _| write_samples_i16(data, &writer, &level),
            err_fn,
            None,
        )
        .map_err(|err| format!("Failed to build i16 input stream: {err}"))
}

fn build_stream_u16(
    device: &cpal::Device,
    config: &StreamConfig,
    writer: SharedWriter,
    level: SharedLevel,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<cpal::Stream, String> {
    device
        .build_input_stream(
            config,
            move |data: &[u16], _| write_samples_u16(data, &writer, &level),
            err_fn,
            None,
        )
        .map_err(|err| format!("Failed to build u16 input stream: {err}"))
}

fn write_samples_f32(data: &[f32], writer: &SharedWriter, level: &SharedLevel) {
    let mut energy = 0.0_f32;
    if let Ok(mut guard) = writer.lock() {
        if let Some(active_writer) = guard.as_mut() {
            for sample in data {
                let clamped = sample.clamp(-1.0, 1.0);
                let pcm = (clamped * i16::MAX as f32) as i16;
                let _ = active_writer.write_sample(pcm);
                energy += clamped * clamped;
            }
        }
    }
    update_level(data.len(), energy, level);
}

fn write_samples_i16(data: &[i16], writer: &SharedWriter, level: &SharedLevel) {
    let mut energy = 0.0_f32;
    if let Ok(mut guard) = writer.lock() {
        if let Some(active_writer) = guard.as_mut() {
            for sample in data {
                let normalized = *sample as f32 / i16::MAX as f32;
                let _ = active_writer.write_sample(*sample);
                energy += normalized * normalized;
            }
        }
    }
    update_level(data.len(), energy, level);
}

fn write_samples_u16(data: &[u16], writer: &SharedWriter, level: &SharedLevel) {
    let mut energy = 0.0_f32;
    if let Ok(mut guard) = writer.lock() {
        if let Some(active_writer) = guard.as_mut() {
            for sample in data {
                let normalized = (*sample as f32 / u16::MAX as f32) * 2.0 - 1.0;
                let pcm = (normalized.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                let _ = active_writer.write_sample(pcm);
                energy += normalized * normalized;
            }
        }
    }
    update_level(data.len(), energy, level);
}

fn update_level(sample_count: usize, energy: f32, level: &SharedLevel) {
    if sample_count == 0 {
        return;
    }
    let rms = (energy / sample_count as f32).sqrt();
    if let Ok(mut current_level) = level.lock() {
        *current_level = rms.clamp(0.0, 1.0);
    }
}

fn finalize_writer(writer: SharedWriter) -> Result<(), String> {
    let wav_writer = writer
        .lock()
        .map_err(|_| "Failed to lock wav writer for finalize.".to_string())?
        .take();

    if let Some(active_writer) = wav_writer {
        active_writer
            .finalize()
            .map_err(|err| format!("Failed to finalize wav file: {err}"))?;
    }

    Ok(())
}

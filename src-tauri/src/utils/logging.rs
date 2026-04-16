use chrono::Local;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

pub fn local_logging_enabled() -> bool {
    cfg!(feature = "local-logging")
}

pub fn resolve_log_dir() -> Result<PathBuf, String> {
    let cwd =
        std::env::current_dir().map_err(|e| format!("Failed to resolve current directory: {e}"))?;
    Ok(cwd.join("log"))
}

pub fn append_frontend_log_entry(level: Option<&str>, message: &str) -> Result<(), String> {
    if !local_logging_enabled() {
        return Ok(());
    }

    let log_root = resolve_log_dir()?;

    std::fs::create_dir_all(&log_root)
        .map_err(|e| format!("Failed to create log directory: {e}"))?;

    let log_path = log_root.join("frontend.log");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open log file: {e}"))?;

    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let level = level.unwrap_or("info");
    let entry = format!("[{timestamp}][{level}] {message}\n");

    file.write_all(entry.as_bytes())
        .map_err(|e| format!("Failed to write log entry: {e}"))?;

    Ok(())
}

pub fn init_tracing() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "video_downloader_pro=info,tauri=info".into());

    #[cfg(feature = "local-logging")]
    {
        use std::sync::OnceLock;
        use tracing_appender::non_blocking::WorkerGuard;

        static LOG_GUARD: OnceLock<WorkerGuard> = OnceLock::new();

        let log_dir = match resolve_log_dir() {
            Ok(dir) => dir,
            Err(err) => {
                eprintln!("{err}");
                let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
                return;
            }
        };

        if let Err(err) = std::fs::create_dir_all(&log_dir) {
            eprintln!("Failed to create log directory: {err}");
            let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
            return;
        }

        let file_appender = tracing_appender::rolling::never(&log_dir, "backend.log");
        let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
        let _ = LOG_GUARD.set(guard);

        let _ = tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_writer(non_blocking)
            .with_ansi(false)
            .try_init();
        return;
    }

    #[cfg(not(feature = "local-logging"))]
    {
        let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
    }
}

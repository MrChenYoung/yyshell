use chrono::Local;
use log::{info, LevelFilter};
use simplelog::{
    ColorChoice, CombinedLogger, Config, ConfigBuilder, TermLogger, TerminalMode, WriteLogger,
};
use std::fs::{self, File, OpenOptions};
use std::path::PathBuf;

/// Get the log directory path
pub fn get_log_dir() -> PathBuf {
    let app_data = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.yyshell.app")
        .join("logs");
    
    // Create directory if it doesn't exist
    if !app_data.exists() {
        let _ = fs::create_dir_all(&app_data);
    }
    
    app_data
}

/// Get the current log file path
pub fn get_log_file_path() -> PathBuf {
    let log_dir = get_log_dir();
    let date = Local::now().format("%Y-%m-%d").to_string();
    log_dir.join(format!("yyshell-{}.log", date))
}

/// Initialize the logging system
pub fn init_logging() -> Result<(), Box<dyn std::error::Error>> {
    let log_file_path = get_log_file_path();
    
    // Create or open log file in append mode
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file_path)?;
    
    // Configure log format with timestamps
    let config = ConfigBuilder::new()
        .set_time_format_rfc3339()
        .set_time_offset_to_local()
        .unwrap_or_else(|builder| builder)
        .build();
    
    // Initialize combined logger: terminal + file
    CombinedLogger::init(vec![
        // Terminal logger for development
        TermLogger::new(
            LevelFilter::Info,
            config.clone(),
            TerminalMode::Mixed,
            ColorChoice::Auto,
        ),
        // File logger for persistent logs
        WriteLogger::new(LevelFilter::Debug, config, log_file),
    ])?;
    
    info!("=== YYShell Started ===");
    info!("Log file: {}", log_file_path.display());
    
    Ok(())
}

/// Clean up old log files (keep last 7 days)
pub fn cleanup_old_logs(days_to_keep: u32) {
    let log_dir = get_log_dir();
    
    if let Ok(entries) = fs::read_dir(&log_dir) {
        let cutoff = Local::now() - chrono::Duration::days(days_to_keep as i64);
        
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "log") {
                if let Ok(metadata) = fs::metadata(&path) {
                    if let Ok(modified) = metadata.modified() {
                        let modified_time: chrono::DateTime<Local> = modified.into();
                        if modified_time < cutoff {
                            let _ = fs::remove_file(&path);
                            info!("Cleaned up old log file: {}", path.display());
                        }
                    }
                }
            }
        }
    }
}

/// Get list of available log files
pub fn list_log_files() -> Vec<PathBuf> {
    let log_dir = get_log_dir();
    let mut files = Vec::new();
    
    if let Ok(entries) = fs::read_dir(&log_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "log") {
                files.push(path);
            }
        }
    }
    
    // Sort by name (which includes date) in reverse order (newest first)
    files.sort_by(|a, b| b.cmp(a));
    files
}

/// Read log file content
pub fn read_log_file(path: &PathBuf) -> Result<String, std::io::Error> {
    fs::read_to_string(path)
}

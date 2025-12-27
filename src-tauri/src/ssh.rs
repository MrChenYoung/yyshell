// SSH support module for monitoring and command execution
// Uses russh for SSH connections (pure Rust, async)
// This module provides:
//  - start_monitoring: Collects system stats via a separate SSH connection
//  - ssh_exec_command: Executes commands on the server (used by SFTP for cp, mv, rm -r)

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use russh::*;
use tauri::{AppHandle, Emitter};
use log::{info, error, debug};

/// Stored credentials for reconnection (also used by other modules)
#[derive(Clone)]
pub struct StoredCredentials {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub auth_type: String,
    pub private_key_path: Option<String>,
}

pub struct AppState {
    pub credentials: Mutex<HashMap<String, StoredCredentials>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            credentials: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone, serde::Serialize)]
struct StatsPayload {
    id: String,
    cpu: f32,           // CPU usage percent
    ram_total: u64,     // Total RAM in KB
    ram_used: u64,      // Used RAM in KB
    net_rx: u64,        // Network received bytes
    net_tx: u64,        // Network transmitted bytes
    disk_total: u64,    // Disk total in KB
    disk_used: u64,     // Disk used in KB
    load_1: f32,        // Load average 1 min
    load_5: f32,        // Load average 5 min
    load_15: f32,       // Load average 15 min
    os_name: String,    // OS name and version (e.g., "Ubuntu 22.04")
}

/// Parse CPU usage from /proc/stat output
fn parse_cpu_usage(prev_stats: &Option<(u64, u64)>, output: &str) -> (f32, Option<(u64, u64)>) {
    for line in output.lines() {
        if line.starts_with("cpu ") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 5 {
                let user: u64 = parts[1].parse().unwrap_or(0);
                let nice: u64 = parts[2].parse().unwrap_or(0);
                let system: u64 = parts[3].parse().unwrap_or(0);
                let idle: u64 = parts[4].parse().unwrap_or(0);
                let iowait: u64 = parts.get(5).and_then(|s| s.parse().ok()).unwrap_or(0);
                let irq: u64 = parts.get(6).and_then(|s| s.parse().ok()).unwrap_or(0);
                let softirq: u64 = parts.get(7).and_then(|s| s.parse().ok()).unwrap_or(0);
                let steal: u64 = parts.get(8).and_then(|s| s.parse().ok()).unwrap_or(0);

                let total = user + nice + system + idle + iowait + irq + softirq + steal;
                let active = total - idle - iowait;

                if let Some((prev_active, prev_total)) = prev_stats {
                    let delta_active = active.saturating_sub(*prev_active);
                    let delta_total = total.saturating_sub(*prev_total);
                    if delta_total > 0 {
                        let usage = (delta_active as f32 / delta_total as f32) * 100.0;
                        return (usage, Some((active, total)));
                    }
                }
                return (0.0, Some((active, total)));
            }
        }
    }
    (0.0, None)
}

/// Parse memory info from /proc/meminfo output
fn parse_memory_info(output: &str) -> (u64, u64) {
    let mut mem_total: u64 = 0;
    let mut mem_free: u64 = 0;
    let mut mem_available: u64 = 0;
    let mut buffers: u64 = 0;
    let mut cached: u64 = 0;

    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            let value: u64 = parts[1].parse().unwrap_or(0);
            match parts[0] {
                "MemTotal:" => mem_total = value,
                "MemFree:" => mem_free = value,
                "MemAvailable:" => mem_available = value,
                "Buffers:" => buffers = value,
                "Cached:" => cached = value,
                _ => {}
            }
        }
    }

    let used = if mem_available > 0 {
        mem_total.saturating_sub(mem_available)
    } else {
        mem_total.saturating_sub(mem_free + buffers + cached)
    };

    (mem_total, used)
}

/// Parse network stats from /proc/net/dev output
fn parse_network_stats(output: &str) -> (u64, u64) {
    let mut total_rx: u64 = 0;
    let mut total_tx: u64 = 0;

    for line in output.lines() {
        let line = line.trim();
        if line.starts_with("Inter") || line.starts_with("face") || line.starts_with("lo:") {
            continue;
        }
        if let Some(colon_pos) = line.find(':') {
            let data = &line[colon_pos + 1..];
            let parts: Vec<&str> = data.split_whitespace().collect();
            if parts.len() >= 9 {
                let rx: u64 = parts[0].parse().unwrap_or(0);
                let tx: u64 = parts[8].parse().unwrap_or(0);
                total_rx += rx;
                total_tx += tx;
            }
        }
    }

    (total_rx, total_tx)
}

/// Parse disk usage from df output
fn parse_disk_usage(output: &str) -> (u64, u64) {
    for line in output.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            if let Some(mount) = parts.last() {
                if *mount == "/" {
                    let total: u64 = parts[1].parse().unwrap_or(0);
                    let used: u64 = parts[2].parse().unwrap_or(0);
                    return (total, used);
                }
            }
        }
    }
    (0, 0)
}

/// Parse load average from /proc/loadavg
fn parse_load_average(output: &str) -> (f32, f32, f32) {
    let parts: Vec<&str> = output.split_whitespace().collect();
    if parts.len() >= 3 {
        let load_1: f32 = parts[0].parse().unwrap_or(0.0);
        let load_5: f32 = parts[1].parse().unwrap_or(0.0);
        let load_15: f32 = parts[2].parse().unwrap_or(0.0);
        return (load_1, load_5, load_15);
    }
    (0.0, 0.0, 0.0)
}

/// Parse OS info from /etc/os-release output
fn parse_os_release(output: &str) -> String {
    for line in output.lines() {
        if line.starts_with("PRETTY_NAME=") {
            let value = line.trim_start_matches("PRETTY_NAME=").trim_matches('"');
            return value.to_string();
        }
    }
    "Unknown".to_string()
}

/// SSH Client handler for russh monitoring
struct MonitoringClient {
    id: String,
}

#[async_trait::async_trait]
impl client::Handler for MonitoringClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh_keys::PublicKey
    ) -> Result<bool, Self::Error> {
        debug!("[SSH-Monitor:{}] Accepting server key", self.id);
        Ok(true)
    }
}

/// Execute a command on a russh channel and return output
async fn exec_command_on_channel(
    handle: &mut client::Handle<MonitoringClient>,
    command: &str,
) -> Result<String, String> {
    let mut channel = handle.channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel: {}", e))?;
    
    channel.exec(true, command)
        .await
        .map_err(|e| format!("Failed to exec command: {}", e))?;
    
    let mut output = Vec::new();
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { data }) => {
                output.extend_from_slice(&data);
            }
            Some(ChannelMsg::ExtendedData { data, ext: _ }) => {
                output.extend_from_slice(&data);
            }
            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                break;
            }
            _ => {}
        }
    }
    
    String::from_utf8(output).map_err(|e| format!("Invalid UTF-8 output: {}", e))
}

/// Authenticate with russh based on auth type
async fn authenticate_russh(
    handle: &mut client::Handle<MonitoringClient>,
    creds: &StoredCredentials,
) -> Result<bool, String> {
    match creds.auth_type.as_str() {
        "Key" => {
            if let Some(ref key_path) = creds.private_key_path {
                let key = russh_keys::load_secret_key(key_path, creds.password.as_deref())
                    .map_err(|e| format!("Failed to load private key: {}", e))?;
                handle.authenticate_publickey(&creds.username, Arc::new(key))
                    .await
                    .map_err(|e| format!("Key auth failed: {}", e))
            } else {
                Err("Private key path not provided".into())
            }
        }
        "Agent" => {
            Err("SSH Agent authentication not yet implemented in russh".into())
        }
        _ => {
            // Password authentication
            if let Some(ref pwd) = creds.password {
                handle.authenticate_password(&creds.username, pwd)
                    .await
                    .map_err(|e| format!("Password auth failed: {}", e))
            } else {
                Err("Password not provided".into())
            }
        }
    }
}

#[tauri::command]
pub async fn start_monitoring(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    russh_state: tauri::State<'_, super::ssh_russh::RusshAppState>,
    id: String,
) -> Result<(), String> {
    // Get credentials from russh state first, then fallback to legacy state
    let creds = {
        let russh_creds = russh_state.credentials.lock().unwrap();
        if let Some(c) = russh_creds.get(&id) {
            StoredCredentials {
                host: c.host.clone(),
                port: c.port,
                username: c.username.clone(),
                password: c.password.clone(),
                auth_type: c.auth_type.clone(),
                private_key_path: c.private_key_path.clone(),
            }
        } else {
            let creds_lock = state.credentials.lock().unwrap();
            match creds_lock.get(&id) {
                Some(c) => c.clone(),
                None => return Err("No credentials found".into()),
            }
        }
    };

    let id_clone = id.clone();
    
    // Spawn async monitoring task
    tokio::spawn(async move {
        info!("[SSH-Monitor:{}] Starting monitoring for {}:{}", id_clone, creds.host, creds.port);
        
        // Build russh config
        let config = Arc::new(client::Config {
            inactivity_timeout: Some(Duration::from_secs(60)),
            keepalive_interval: Some(Duration::from_secs(15)),
            keepalive_max: 4,
            ..Default::default()
        });
        
        let client = MonitoringClient { id: id_clone.clone() };
        let addr = format!("{}:{}", creds.host, creds.port);
        
        // Connect with timeout
        let handle_result = tokio::time::timeout(
            Duration::from_secs(30),
            client::connect(config, addr.clone(), client)
        ).await;
        
        let mut handle = match handle_result {
            Ok(Ok(h)) => h,
            Ok(Err(e)) => {
                error!("[SSH-Monitor:{}] Connection failed: {}", id_clone, e);
                return;
            }
            Err(_) => {
                error!("[SSH-Monitor:{}] Connection timeout", id_clone);
                return;
            }
        };
        
        info!("[SSH-Monitor:{}] Connected, authenticating...", id_clone);
        
        // Authenticate
        match authenticate_russh(&mut handle, &creds).await {
            Ok(true) => {
                info!("[SSH-Monitor:{}] Authentication successful", id_clone);
            }
            Ok(false) => {
                error!("[SSH-Monitor:{}] Authentication rejected", id_clone);
                return;
            }
            Err(e) => {
                error!("[SSH-Monitor:{}] Authentication failed: {}", id_clone, e);
                return;
            }
        }
        
        // Monitoring loop
        let mut prev_cpu_stats: Option<(u64, u64)> = None;
        let mut prev_net_stats: Option<(u64, u64)> = None;
        let mut os_name = String::new();
        
        loop {
            // Get OS name once
            if os_name.is_empty() {
                if let Ok(output) = exec_command_on_channel(&mut handle, "cat /etc/os-release").await {
                    os_name = parse_os_release(&output);
                }
            }
            
            // Get CPU stats
            let cpu_percent = if let Ok(output) = exec_command_on_channel(&mut handle, "cat /proc/stat").await {
                let (cpu, new_stats) = parse_cpu_usage(&prev_cpu_stats, &output);
                prev_cpu_stats = new_stats;
                cpu
            } else {
                0.0
            };
            
            // Get memory stats
            let (ram_total, ram_used) = if let Ok(output) = exec_command_on_channel(&mut handle, "cat /proc/meminfo").await {
                parse_memory_info(&output)
            } else {
                (0, 0)
            };
            
            // Get network stats
            let (net_rx_rate, net_tx_rate) = if let Ok(output) = exec_command_on_channel(&mut handle, "cat /proc/net/dev").await {
                let (rx, tx) = parse_network_stats(&output);
                if let Some((prev_rx, prev_tx)) = prev_net_stats {
                    prev_net_stats = Some((rx, tx));
                    (rx.saturating_sub(prev_rx) / 2, tx.saturating_sub(prev_tx) / 2) // Rate per second (2s interval)
                } else {
                    prev_net_stats = Some((rx, tx));
                    (0, 0)
                }
            } else {
                (0, 0)
            };
            
            // Get disk stats
            let (disk_total, disk_used) = if let Ok(output) = exec_command_on_channel(&mut handle, "df -k /").await {
                parse_disk_usage(&output)
            } else {
                (0, 0)
            };
            
            // Get load average
            let (load_1, load_5, load_15) = if let Ok(output) = exec_command_on_channel(&mut handle, "cat /proc/loadavg").await {
                parse_load_average(&output)
            } else {
                (0.0, 0.0, 0.0)
            };
            
            // Emit stats
            let _ = app.emit("stats-data", StatsPayload {
                id: id_clone.clone(),
                cpu: cpu_percent,
                ram_total,
                ram_used,
                net_rx: net_rx_rate,
                net_tx: net_tx_rate,
                disk_total,
                disk_used,
                load_1,
                load_5,
                load_15,
                os_name: os_name.clone(),
            });
            
            // Wait 2 seconds before next collection
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });

    Ok(())
}

/// Execute a command on the server via SSH and return output
/// Used for server-side operations like cp, mv, rm -r
#[tauri::command]
pub async fn ssh_exec_command(
    state: tauri::State<'_, AppState>,
    russh_state: tauri::State<'_, super::ssh_russh::RusshAppState>,
    id: String,
    command: String,
) -> Result<String, String> {
    // Get credentials
    let creds = {
        let russh_creds = russh_state.credentials.lock().unwrap();
        if let Some(c) = russh_creds.get(&id) {
            StoredCredentials {
                host: c.host.clone(),
                port: c.port,
                username: c.username.clone(),
                password: c.password.clone(),
                auth_type: c.auth_type.clone(),
                private_key_path: c.private_key_path.clone(),
            }
        } else {
            let creds_lock = state.credentials.lock().unwrap();
            match creds_lock.get(&id) {
                Some(c) => c.clone(),
                None => return Err("No credentials found".into()),
            }
        }
    };

    debug!("[SSH-Exec:{}] Executing command: {}", id, command);
    
    // Build russh config
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(60)),
        ..Default::default()
    });
    
    let client = MonitoringClient { id: id.clone() };
    let addr = format!("{}:{}", creds.host, creds.port);
    
    // Connect with timeout
    let mut handle = tokio::time::timeout(
        Duration::from_secs(30),
        client::connect(config, addr.clone(), client)
    )
    .await
    .map_err(|_| "Connection timeout".to_string())?
    .map_err(|e| format!("Connection failed: {}", e))?;
    
    // Authenticate
    let authenticated = authenticate_russh(&mut handle, &creds).await?;
    if !authenticated {
        return Err("Authentication rejected".into());
    }
    
    // Execute command
    let output = exec_command_on_channel(&mut handle, &command).await?;
    
    debug!("[SSH-Exec:{}] Command completed, output length: {}", id, output.len());
    
    Ok(output)
}

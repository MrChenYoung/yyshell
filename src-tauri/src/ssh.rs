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
use tokio_util::sync::CancellationToken;

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
    pub monitoring_tokens: Mutex<HashMap<String, CancellationToken>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            credentials: Mutex::new(HashMap::new()),
            monitoring_tokens: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone, serde::Serialize)]
struct StatsPayload {
    id: String,
    cpu: f32,             // CPU usage percent
    ram_total: u64,       // Total RAM in KB
    ram_used: u64,        // Used RAM in KB
    net_rx: u64,          // Network received bytes
    net_tx: u64,          // Network transmitted bytes
    disk_total: u64,      // Disk total in KB
    disk_used: u64,       // Disk used in KB
    load_1: f32,          // Load average 1 min
    load_5: f32,          // Load average 5 min
    load_15: f32,         // Load average 15 min
    os_name: String,      // OS name and version (e.g., "Ubuntu 22.04")
    cpu_model: String,    // CPU model name
    cpu_cores: u32,       // Number of CPU cores
    // Extended monitoring data
    uptime_seconds: u64,  // Server uptime in seconds
    swap_total: u64,      // Total swap in KB
    swap_used: u64,       // Used swap in KB
    processes: u32,       // Number of running processes
    users: u32,           // Number of logged in users
    kernel_version: String, // Kernel version
    tcp_connections: u32, // Number of TCP connections
    disk_read_bytes: u64, // Disk read bytes per second
    disk_write_bytes: u64, // Disk write bytes per second
    inode_total: u64,     // Total inodes on root filesystem
    inode_used: u64,      // Used inodes on root filesystem
    zombie_processes: u32, // Number of zombie processes
    ssh_connections: u32, // Number of SSH connections
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

/// Parse CPU info from /proc/cpuinfo output
fn parse_cpu_info(output: &str) -> (String, u32) {
    let mut model_name = String::new();
    let mut core_count: u32 = 0;
    
    for line in output.lines() {
        if line.starts_with("model name") {
            if model_name.is_empty() {
                if let Some(value) = line.split(':').nth(1) {
                    model_name = value.trim().to_string();
                }
            }
        } else if line.starts_with("processor") {
            core_count += 1;
        }
    }
    
    // Clean up model name (remove extra spaces)
    model_name = model_name.split_whitespace().collect::<Vec<_>>().join(" ");
    
    (model_name, core_count)
}

/// Parse uptime from /proc/uptime output
fn parse_uptime(output: &str) -> u64 {
    let parts: Vec<&str> = output.split_whitespace().collect();
    if !parts.is_empty() {
        parts[0].parse::<f64>().unwrap_or(0.0) as u64
    } else {
        0
    }
}

/// Parse swap info from /proc/meminfo output
fn parse_swap_info(output: &str) -> (u64, u64) {
    let mut swap_total: u64 = 0;
    let mut swap_free: u64 = 0;
    
    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            let value: u64 = parts[1].parse().unwrap_or(0);
            match parts[0] {
                "SwapTotal:" => swap_total = value,
                "SwapFree:" => swap_free = value,
                _ => {}
            }
        }
    }
    
    let swap_used = swap_total.saturating_sub(swap_free);
    (swap_total, swap_used)
}

/// Parse process count from /proc/loadavg output (4th field: running/total)
fn parse_process_count(output: &str) -> u32 {
    let parts: Vec<&str> = output.split_whitespace().collect();
    if parts.len() >= 4 {
        // Format: "running/total"
        if let Some(total) = parts[3].split('/').nth(1) {
            return total.parse().unwrap_or(0);
        }
    }
    0
}

/// Parse user count from 'who' command output
fn parse_user_count(output: &str) -> u32 {
    output.lines().filter(|line| !line.trim().is_empty()).count() as u32
}

/// Parse kernel version from 'uname -r' output
fn parse_kernel_version(output: &str) -> String {
    output.trim().to_string()
}

/// Parse TCP connection count from /proc/net/tcp output
/// Only counts ESTABLISHED connections (state = 01)
fn parse_tcp_connections(output: &str) -> u32 {
    // /proc/net/tcp format: sl local_address rem_address st ...
    // st (state) = 01 means ESTABLISHED
    // Skip header line and count only ESTABLISHED connections
    output.lines().skip(1).filter(|line| {
        let parts: Vec<&str> = line.split_whitespace().collect();
        // State is the 4th field (index 3)
        if parts.len() >= 4 {
            parts[3] == "01" // 01 = ESTABLISHED
        } else {
            false
        }
    }).count() as u32
}

/// Parse SSH connection count from /proc/net/tcp output
/// Counts ESTABLISHED connections to port 22 (0016 in hex)
fn parse_ssh_connections(output: &str) -> u32 {
    // /proc/net/tcp format: sl local_address rem_address st ...
    // local_address format: IP:PORT where PORT is hex
    // Port 22 = 0016 in hex
    output.lines().skip(1).filter(|line| {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            let local_addr = parts[1];
            let state = parts[3];
            // Check if local port is 22 (0016) and state is ESTABLISHED (01)
            local_addr.ends_with(":0016") && state == "01"
        } else {
            false
        }
    }).count() as u32
}

/// Parse disk IO stats from /proc/diskstats output
fn parse_disk_io(prev_stats: &Option<(u64, u64)>, output: &str) -> ((u64, u64), Option<(u64, u64)>) {
    let mut total_read: u64 = 0;
    let mut total_write: u64 = 0;
    
    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        // diskstats format: major minor name rd_ios rd_merges rd_sectors rd_ticks wr_ios wr_merges wr_sectors ...
        if parts.len() >= 10 {
            let device_name = parts[2];
            // Only count main devices (sda, vda, nvme0n1), not partitions
            if device_name.starts_with("sd") && device_name.len() == 3 
               || device_name.starts_with("vd") && device_name.len() == 3
               || device_name.starts_with("nvme") && device_name.ends_with("n1") && !device_name.contains("p") {
                let rd_sectors: u64 = parts[5].parse().unwrap_or(0);
                let wr_sectors: u64 = parts[9].parse().unwrap_or(0);
                total_read += rd_sectors * 512; // sectors to bytes
                total_write += wr_sectors * 512;
            }
        }
    }
    
    if let Some((prev_read, prev_write)) = prev_stats {
        let read_rate = total_read.saturating_sub(*prev_read) / 2; // per second (2s interval)
        let write_rate = total_write.saturating_sub(*prev_write) / 2;
        ((read_rate, write_rate), Some((total_read, total_write)))
    } else {
        ((0, 0), Some((total_read, total_write)))
    }
}

/// Parse inode usage from 'df -i /' output
fn parse_inode_usage(output: &str) -> (u64, u64) {
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

/// Parse zombie process count from ps output
fn parse_zombie_count(output: &str) -> u32 {
    // ps aux output: second-to-last column is STAT, zombie shows as 'Z' or 'Z+'
    output.lines().skip(1).filter(|line| {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 8 {
            // STAT is usually the 8th column (index 7)
            let stat = parts[7];
            stat.starts_with('Z')
        } else {
            false
        }
    }).count() as u32
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
    // Cancel any existing monitoring task for this ID
    {
        let mut tokens = state.monitoring_tokens.lock().unwrap();
        if let Some(old_token) = tokens.remove(&id) {
            info!("[SSH-Monitor:{}] Cancelling previous monitoring task", id);
            old_token.cancel();
        }
        // Create new cancellation token
        let new_token = CancellationToken::new();
        tokens.insert(id.clone(), new_token.clone());
    }
    
    // Get the token for this monitoring session
    let cancel_token = {
        let tokens = state.monitoring_tokens.lock().unwrap();
        tokens.get(&id).cloned().unwrap()
    };
    
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
        let mut prev_disk_io_stats: Option<(u64, u64)> = None;
        let mut os_name = String::new();
        let mut cpu_model = String::new();
        let mut cpu_cores: u32 = 0;
        let mut kernel_version = String::new();
        
        loop {
            // Check if cancelled
            if cancel_token.is_cancelled() {
                info!("[SSH-Monitor:{}] Monitoring cancelled, stopping", id_clone);
                return;
            }
            
            // Get static info once (OS name, CPU info, kernel version)
            if os_name.is_empty() {
                if let Ok(output) = exec_command_on_channel(&mut handle, "cat /etc/os-release").await {
                    os_name = parse_os_release(&output);
                }
            }
            
            if cpu_model.is_empty() {
                if let Ok(output) = exec_command_on_channel(&mut handle, "cat /proc/cpuinfo").await {
                    let (model, cores) = parse_cpu_info(&output);
                    cpu_model = model;
                    cpu_cores = cores;
                }
            }
            
            if kernel_version.is_empty() {
                if let Ok(output) = exec_command_on_channel(&mut handle, "uname -r").await {
                    kernel_version = parse_kernel_version(&output);
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
            
            // Get memory and swap stats (from same file)
            let (ram_total, ram_used, swap_total, swap_used) = if let Ok(output) = exec_command_on_channel(&mut handle, "cat /proc/meminfo").await {
                let (rt, ru) = parse_memory_info(&output);
                let (st, su) = parse_swap_info(&output);
                (rt, ru, st, su)
            } else {
                (0, 0, 0, 0)
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
            
            // Get load average and process count (from same file)
            let (load_1, load_5, load_15, processes) = if let Ok(output) = exec_command_on_channel(&mut handle, "cat /proc/loadavg").await {
                let (l1, l5, l15) = parse_load_average(&output);
                let procs = parse_process_count(&output);
                (l1, l5, l15, procs)
            } else {
                (0.0, 0.0, 0.0, 0)
            };
            
            // Get uptime
            let uptime_seconds = if let Ok(output) = exec_command_on_channel(&mut handle, "cat /proc/uptime").await {
                parse_uptime(&output)
            } else {
                0
            };
            
            // Get user count
            let users = if let Ok(output) = exec_command_on_channel(&mut handle, "who").await {
                parse_user_count(&output)
            } else {
                0
            };
            
            // Get TCP connections and SSH connections (from same data)
            let (tcp_connections, ssh_connections) = if let Ok(output) = exec_command_on_channel(&mut handle, "cat /proc/net/tcp").await {
                (parse_tcp_connections(&output), parse_ssh_connections(&output))
            } else {
                (0, 0)
            };
            
            // Get disk IO
            let (disk_read_bytes, disk_write_bytes) = if let Ok(output) = exec_command_on_channel(&mut handle, "cat /proc/diskstats").await {
                let ((read, write), new_stats) = parse_disk_io(&prev_disk_io_stats, &output);
                prev_disk_io_stats = new_stats;
                (read, write)
            } else {
                (0, 0)
            };
            
            // Get inode usage
            let (inode_total, inode_used) = if let Ok(output) = exec_command_on_channel(&mut handle, "df -i /").await {
                parse_inode_usage(&output)
            } else {
                (0, 0)
            };
            
            // Get zombie process count
            let zombie_processes = if let Ok(output) = exec_command_on_channel(&mut handle, "ps aux").await {
                parse_zombie_count(&output)
            } else {
                0
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
                cpu_model: cpu_model.clone(),
                cpu_cores,
                uptime_seconds,
                swap_total,
                swap_used,
                processes,
                users,
                kernel_version: kernel_version.clone(),
                tcp_connections,
                disk_read_bytes,
                disk_write_bytes,
                inode_total,
                inode_used,
                zombie_processes,
                ssh_connections,
            });
            
            // Wait 2 seconds before next collection, but check for cancellation
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(2)) => {}
                _ = cancel_token.cancelled() => {
                    info!("[SSH-Monitor:{}] Monitoring cancelled during sleep, stopping", id_clone);
                    return;
                }
            }
        }
    });

    Ok(())
}

/// Stop monitoring for a specific connection
#[tauri::command]
pub async fn stop_monitoring(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let mut tokens = state.monitoring_tokens.lock().unwrap();
    if let Some(token) = tokens.remove(&id) {
        info!("[SSH-Monitor:{}] Stopping monitoring", id);
        token.cancel();
    }
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

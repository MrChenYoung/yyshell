use std::collections::HashMap;
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::io::Read;
use std::io::Write;
use ssh2::Session;
use tauri::{AppHandle, Emitter, Manager};

pub struct Connection {
    pub session: Session,
    pub channel: Mutex<Option<ssh2::Channel>>,
}

/// Stored credentials for reconnection
#[derive(Clone)]
pub struct StoredCredentials {
    pub host: String,
    pub user: String,
    pub password: Option<String>,
    pub auth_type: String,
    pub private_key_path: Option<String>,
}

pub struct AppState {
    pub connections: Mutex<HashMap<String, Arc<Connection>>>,
    pub credentials: Mutex<HashMap<String, StoredCredentials>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
            credentials: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone, serde::Serialize)]
struct Payload {
    id: String,
    data: Vec<u8>,
}

#[derive(Clone, serde::Serialize)]
struct ConnectionLostPayload {
    id: String,
    reason: String,
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
    // cpu  user nice system idle iowait irq softirq steal guest guest_nice
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

    // If MemAvailable is present (Linux 3.14+), use it; otherwise calculate
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
        // Skip header lines and loopback
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
    // df output: Filesystem 1K-blocks Used Available Use% Mounted
    for line in output.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            // Look for root filesystem
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
            // Remove PRETTY_NAME= prefix and quotes
            let value = line.trim_start_matches("PRETTY_NAME=").trim_matches('"');
            return value.to_string();
        }
    }
    "Unknown".to_string()
}

#[tauri::command]
pub async fn connect(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
    host: String,
    user: String,
    password: Option<String>,
    auth_type: Option<String>,
    private_key_path: Option<String>,
) -> Result<String, String> {
    
    let auth = auth_type.unwrap_or_else(|| "Password".to_string());
    
    // Store creds for reconnection
    state.credentials.lock().unwrap().insert(id.clone(), StoredCredentials {
        host: host.clone(),
        user: user.clone(),
        password: password.clone(),
        auth_type: auth.clone(),
        private_key_path: private_key_path.clone(),
    });

    // Clone values for the blocking task
    let id_clone = id.clone();
    let host_clone = host.clone();
    let user_clone = user.clone();
    let password_clone = password.clone();
    let auth_clone = auth.clone();
    let key_path_clone = private_key_path.clone();

    // Run blocking SSH operations in a separate thread pool
    let (conn, channel) = tokio::task::spawn_blocking(move || -> Result<(Arc<Connection>, ssh2::Channel), String> {
        // Connect to the SSH server
        let tcp = TcpStream::connect(format!("{}:22", host_clone)).map_err(|e| e.to_string())?;
        
        let mut sess = Session::new().unwrap();
        sess.set_tcp_stream(tcp);
        sess.handshake().map_err(|e| e.to_string())?;

        // Auth based on type
        match auth_clone.as_str() {
            "Key" => {
                // Private key authentication
                let key_path = key_path_clone.ok_or("Private key path not provided")?;
                let key_path = std::path::Path::new(&key_path);
                
                // Try with password (passphrase) if provided, otherwise without
                if let Some(passphrase) = &password_clone {
                    sess.userauth_pubkey_file(&user_clone, None, key_path, Some(passphrase))
                        .map_err(|e| format!("Key authentication failed: {}", e))?;
                } else {
                    sess.userauth_pubkey_file(&user_clone, None, key_path, None)
                        .map_err(|e| format!("Key authentication failed: {}", e))?;
                }
            },
            "Agent" => {
                // SSH Agent authentication
                sess.userauth_agent(&user_clone)
                    .map_err(|e| format!("SSH Agent authentication failed: {}", e))?;
            },
            _ => {
                // Password authentication (default)
                if let Some(pwd) = &password_clone {
                    sess.userauth_password(&user_clone, pwd)
                        .map_err(|e| format!("Password authentication failed: {}", e))?;
                } else {
                    return Err("Password not provided for password authentication".into());
                }
            }
        }
        
        if !sess.authenticated() {
            return Err("Authentication failed".into());
        }

        // Channel
        let mut channel = sess.channel_session().map_err(|e| e.to_string())?;
        channel.request_pty("xterm", None, Some((80, 24, 0, 0))).map_err(|e| e.to_string())?;
        channel.shell().map_err(|e| e.to_string())?;
        
        // Set non-blocking for the read loop
        sess.set_blocking(false);

        let conn = Arc::new(Connection {
            session: sess,
            channel: Mutex::new(None), // We'll set this after
        });

        Ok((conn, channel))
    }).await.map_err(|e| e.to_string())??;

    // Set the channel
    *conn.channel.lock().unwrap() = Some(channel);

    state.connections.lock().unwrap().insert(id.clone(), conn.clone());
    
    // Spawn reader thread
    let conn_clone = conn.clone();
    let id_clone2 = id.clone();
    
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            // Scope for lock
            let mut should_break = false;
            let mut disconnect_reason: Option<String> = None;
            {
                if let Ok(mut lock) = conn_clone.channel.lock() {
                     if let Some(channel) = lock.as_mut() {
                         match channel.read(&mut buf) {
                             Ok(0) => {
                                 disconnect_reason = Some("Connection closed by remote host".to_string());
                                 should_break = true;
                             }
                             Ok(n) => {
                                 let _data = String::from_utf8_lossy(&buf[..n]).to_string();
                                 let _ = app.emit("term-data", Payload { id: id_clone2.clone(), data: buf[..n].to_vec() });
                             }
                             Err(e) => {
                                 if e.kind() == std::io::ErrorKind::WouldBlock {
                                     // Just wait a bit
                                 } else {
                                     disconnect_reason = Some(format!("Connection error: {}", e));
                                     should_break = true;
                                 }
                             }
                         }
                     }
                }
            }
            
            if should_break {
                // Emit connection-lost event to notify frontend
                if let Some(reason) = disconnect_reason {
                    let _ = app.emit("connection-lost", ConnectionLostPayload { 
                        id: id_clone2.clone(), 
                        reason 
                    });
                }
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
    });
    
    Ok("Connected".into())
}

#[tauri::command]
pub fn write_pty(
    state: tauri::State<'_, AppState>,
    id: String,
    data: String,
) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    if let Some(conn) = connections.get(&id) {
        let mut lock = conn.channel.lock().unwrap();
        if let Some(channel) = lock.as_mut() {
            channel.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
            channel.flush().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn resize_pty(
    state: tauri::State<'_, AppState>,
    id: String,
    rows: u32,
    cols: u32,
) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    if let Some(conn) = connections.get(&id) {
         let mut lock = conn.channel.lock().unwrap();
         if let Some(channel) = lock.as_mut() {
             channel.request_pty_size(cols, rows, None, None).map_err(|e| e.to_string())?;
         }
    }
    Ok(())
}

#[tauri::command]
pub fn disconnect(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    // Remove connection from state
    let mut connections = state.connections.lock().unwrap();
    if let Some(conn) = connections.remove(&id) {
        // Close the channel if it exists
        if let Ok(mut lock) = conn.channel.lock() {
            if let Some(ref mut channel) = *lock {
                let _ = channel.send_eof();
                let _ = channel.wait_close();
            }
            *lock = None;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn start_monitoring(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let creds = {
        let creds_lock = state.credentials.lock().unwrap();
        match creds_lock.get(&id) {
            Some(c) => c.clone(),
            None => return Err("No credentials found".into()),
        }
    };

    thread::spawn(move || {
        // New connection for monitoring
        if let Ok(tcp) = TcpStream::connect(format!("{}:22", creds.host)) {
            if let Ok(mut sess) = Session::new() {
                sess.set_tcp_stream(tcp);
                if sess.handshake().is_ok() {
                    // Auth based on type
                    let auth_res = match creds.auth_type.as_str() {
                        "Key" => {
                            if let Some(ref key_path) = creds.private_key_path {
                                let path = std::path::Path::new(key_path);
                                sess.userauth_pubkey_file(&creds.user, None, path, creds.password.as_deref())
                            } else {
                                Err(ssh2::Error::from_errno(ssh2::ErrorCode::Session(-1)))
                            }
                        },
                        "Agent" => sess.userauth_agent(&creds.user),
                        _ => {
                            if let Some(ref pwd) = creds.password {
                                sess.userauth_password(&creds.user, pwd)
                            } else {
                                Err(ssh2::Error::from_errno(ssh2::ErrorCode::Session(-1)))
                            }
                        }
                    };

                    if auth_res.is_ok() && sess.authenticated() {
                        let mut prev_cpu_stats: Option<(u64, u64)> = None;
                        let mut prev_net_stats: Option<(u64, u64)> = None;
                        
                        // Get OS info once at start
                        let os_name = {
                            let mut os_channel = match sess.channel_session() {
                                Ok(c) => c,
                                Err(_) => return,
                            };
                            if os_channel.exec("cat /etc/os-release 2>/dev/null || echo 'PRETTY_NAME=\"Unknown\"'").is_ok() {
                                let mut os_output = String::new();
                                let _ = os_channel.read_to_string(&mut os_output);
                                let _ = os_channel.wait_close();
                                parse_os_release(&os_output)
                            } else {
                                "Unknown".to_string()
                            }
                        };

                        loop {
                            // Collect all stats in one command for efficiency
                            let stat_cmd = "cat /proc/stat; echo '---MEMINFO---'; cat /proc/meminfo; echo '---NETDEV---'; cat /proc/net/dev; echo '---DISK---'; df -k /; echo '---LOADAVG---'; cat /proc/loadavg";
                            
                            let mut channel = match sess.channel_session() {
                                Ok(c) => c,
                                Err(_) => break,
                            };

                            if channel.exec(stat_cmd).is_ok() {
                                let mut output = String::new();
                                let _ = channel.read_to_string(&mut output);
                                let _ = channel.wait_close();

                                // Split by markers
                                let sections: Vec<&str> = output.split("---").collect();
                                
                                let mut cpu_output = "";
                                let mut mem_output = "";
                                let mut net_output = "";
                                let mut disk_output = "";
                                let mut load_output = "";

                                for (i, section) in sections.iter().enumerate() {
                                    if i == 0 {
                                        cpu_output = section;
                                    } else if section.starts_with("MEMINFO") {
                                        if let Some(next) = sections.get(i + 1) {
                                            mem_output = next.trim_start_matches("---");
                                        }
                                    } else if section.starts_with("NETDEV") {
                                        if let Some(next) = sections.get(i + 1) {
                                            net_output = next.trim_start_matches("---");
                                        }
                                    } else if section.starts_with("DISK") {
                                        if let Some(next) = sections.get(i + 1) {
                                            disk_output = next.trim_start_matches("---");
                                        }
                                    } else if section.starts_with("LOADAVG") {
                                        if let Some(next) = sections.get(i + 1) {
                                            load_output = next.trim_start_matches("---");
                                        }
                                    }
                                }

                                // Parse CPU
                                let (cpu_percent, new_cpu_stats) = parse_cpu_usage(&prev_cpu_stats, cpu_output);
                                prev_cpu_stats = new_cpu_stats;

                                // Parse Memory (values in KB)
                                let (ram_total, ram_used) = parse_memory_info(mem_output);

                                // Parse Network
                                let (net_rx, net_tx) = parse_network_stats(net_output);
                                
                                // Calculate network rate (bytes since last poll)
                                let (net_rx_rate, net_tx_rate) = if let Some((prev_rx, prev_tx)) = prev_net_stats {
                                    (net_rx.saturating_sub(prev_rx), net_tx.saturating_sub(prev_tx))
                                } else {
                                    (0, 0)
                                };
                                prev_net_stats = Some((net_rx, net_tx));

                                // Parse Disk (values in KB)
                                let (disk_total, disk_used) = parse_disk_usage(disk_output);

                                // Parse Load Average
                                let (load_1, load_5, load_15) = parse_load_average(load_output);

                                let _ = app.emit("stats-data", StatsPayload {
                                    id: id.clone(),
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
                            }
                            thread::sleep(Duration::from_secs(2));
                        }
                    }
                }
            }
        }
    });

    Ok(())
}

/// Execute a command on the server via SSH and return output
/// Used for server-side operations like cp, mv, rm -r
#[tauri::command]
pub async fn ssh_exec_command(
    state: tauri::State<'_, AppState>,
    id: String,
    command: String,
) -> Result<String, String> {
    // Get credentials to create a new exec channel
    let creds = {
        let creds_lock = state.credentials.lock().unwrap();
        match creds_lock.get(&id) {
            Some(c) => c.clone(),
            None => return Err("No credentials found".into()),
        }
    };

    // Execute in blocking task
    tokio::task::spawn_blocking(move || -> Result<String, String> {
        // New connection for exec
        let tcp = TcpStream::connect(format!("{}:22", creds.host)).map_err(|e| e.to_string())?;
        let mut sess = Session::new().map_err(|e| e.to_string())?;
        sess.set_tcp_stream(tcp);
        sess.handshake().map_err(|e| e.to_string())?;

        // Auth based on type
        match creds.auth_type.as_str() {
            "Key" => {
                let key_path = creds.private_key_path.as_ref().ok_or("Private key path not provided")?;
                let path = std::path::Path::new(key_path);
                sess.userauth_pubkey_file(&creds.user, None, path, creds.password.as_deref())
                    .map_err(|e| format!("Key authentication failed: {}", e))?;
            },
            "Agent" => {
                sess.userauth_agent(&creds.user)
                    .map_err(|e| format!("SSH Agent authentication failed: {}", e))?;
            },
            _ => {
                let pwd = creds.password.as_ref().ok_or("Password not provided")?;
                sess.userauth_password(&creds.user, pwd)
                    .map_err(|e| format!("Password authentication failed: {}", e))?;
            }
        }

        if !sess.authenticated() {
            return Err("Authentication failed".into());
        }

        // Execute command
        let mut channel = sess.channel_session().map_err(|e| e.to_string())?;
        channel.exec(&command).map_err(|e| e.to_string())?;

        let mut output = String::new();
        channel.read_to_string(&mut output).map_err(|e| e.to_string())?;
        
        // Get exit status
        channel.wait_close().map_err(|e| e.to_string())?;
        let exit_status = channel.exit_status().unwrap_or(-1);
        
        if exit_status != 0 {
            // Read stderr for error message
            let mut stderr = String::new();
            let _ = channel.stderr().read_to_string(&mut stderr);
            if !stderr.is_empty() {
                return Err(stderr);
            }
            return Err(format!("Command failed with exit code {}", exit_status));
        }

        Ok(output)
    }).await.map_err(|e| e.to_string())?
}

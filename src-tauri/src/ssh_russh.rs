// SSH implementation using russh (pure Rust, async)
// This provides more stable connections than ssh2-rs (C bindings)

use std::collections::HashMap;
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use std::time::{Duration, Instant};
use russh::*;
use tokio::sync::{mpsc, Mutex as TokioMutex};
use tauri::{AppHandle, Emitter};
use log::{info, warn, error, debug};

// Configuration constants (matching Tabby's russh settings)
const KEEPALIVE_INTERVAL_SECS: u64 = 15;
const KEEPALIVE_MAX_COUNT: u32 = 4;
const CONNECTION_TIMEOUT_SECS: u64 = 30;

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

/// SSH Connection using russh
/// Uses mpsc channel to send commands to the async task
pub struct RusshConnection {
    pub write_tx: mpsc::Sender<WriteCommand>,
    pub alive: AtomicBool,
    pub last_activity: std::sync::Mutex<Instant>,
    pub idle_timeout_minutes: u32,
}

pub enum WriteCommand {
    Data(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Disconnect,
}

/// Stored credentials for reconnection
#[derive(Clone)]
pub struct StoredCredentials {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub auth_type: String,
    pub private_key_path: Option<String>,
}

pub struct RusshAppState {
    pub connections: TokioMutex<HashMap<String, Arc<RusshConnection>>>,
    pub credentials: std::sync::Mutex<HashMap<String, StoredCredentials>>,
}

impl Default for RusshAppState {
    fn default() -> Self {
        Self {
            connections: TokioMutex::new(HashMap::new()),
            credentials: std::sync::Mutex::new(HashMap::new()),
        }
    }
}

/// SSH Client handler for russh
struct SshClient {
    id: String,
}

#[async_trait::async_trait]
impl client::Handler for SshClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh_keys::PublicKey
    ) -> Result<bool, Self::Error> {
        // Accept all server keys (TODO: implement proper host key verification)
        debug!("[SSH:{}] Accepting server key", self.id);
        Ok(true)
    }
}

/// Build russh client config
fn build_client_config() -> client::Config {
    client::Config {
        inactivity_timeout: Some(Duration::from_secs(KEEPALIVE_INTERVAL_SECS * 4)),
        keepalive_interval: Some(Duration::from_secs(KEEPALIVE_INTERVAL_SECS)),
        keepalive_max: KEEPALIVE_MAX_COUNT as usize,
        ..Default::default()
    }
}

/// Connect to SSH server using russh
#[tauri::command]
pub async fn russh_connect(
    app: AppHandle,
    state: tauri::State<'_, RusshAppState>,
    id: String,
    host: String,
    port: Option<u16>,
    user: String,
    password: Option<String>,
    auth_type: Option<String>,
    private_key_path: Option<String>,
    server_id: Option<String>,
    idle_timeout_minutes: Option<u32>,
) -> Result<String, String> {
    let ssh_port = port.unwrap_or(22);
    let auth = auth_type.unwrap_or_else(|| "Password".to_string());
    let idle_timeout = idle_timeout_minutes.unwrap_or(30);
    
    // If password not provided, try to get it from keychain
    // Use server_id if provided, otherwise try the connection id
    let actual_password = if password.is_some() {
        password.clone()
    } else {
        // First try server_id, then fallback to connection id for keychain lookup
        let keychain_id = server_id.as_ref().unwrap_or(&id);
        crate::keychain::get_password(keychain_id)
    };
    
    info!("[SSH:{}] (russh) Initiating connection to {}@{}:{} (auth: {})", 
          id, user, host, ssh_port, auth);
    
    // Build client config with keepalive
    let config = Arc::new(build_client_config());
    
    // Create client handler
    let client = SshClient {
        id: id.clone(),
    };
    
    // Connect to server
    let addr = format!("{}:{}", host, ssh_port);
    debug!("[SSH:{}] Connecting to {}", id, addr);
    
    let mut handle = tokio::time::timeout(
        Duration::from_secs(CONNECTION_TIMEOUT_SECS),
        client::connect(config, addr.clone(), client)
    )
    .await
    .map_err(|_| format!("Connection timeout to {}", addr))?
    .map_err(|e| format!("Connection failed: {}", e))?;
    
    info!("[SSH:{}] TCP connection established", id);
    
    // Authenticate
    let authenticated = match auth.as_str() {
        "Key" => {
            if let Some(ref key_path) = private_key_path {
                debug!("[SSH:{}] Authenticating with private key: {}", id, key_path);
                
                // Load private key
                let key = russh_keys::load_secret_key(key_path, actual_password.as_deref())
                    .map_err(|e| format!("Failed to load private key: {}", e))?;
                
                handle.authenticate_publickey(&user, Arc::new(key))
                    .await
                    .map_err(|e| format!("Public key auth failed: {}", e))?
            } else {
                return Err("Private key path required for Key authentication".into());
            }
        }
        "Agent" => {
            debug!("[SSH:{}] Authenticating with SSH agent", id);
            return Err("SSH Agent authentication not yet implemented in russh".into());
        }
        _ => {
            // Password authentication
            if let Some(ref pwd) = actual_password {
                debug!("[SSH:{}] Authenticating with password", id);
                handle.authenticate_password(&user, pwd)
                    .await
                    .map_err(|e| format!("Password auth failed: {}", e))?
            } else {
                return Err("Password required for authentication".into());
            }
        }
    };
    
    if !authenticated {
        error!("[SSH:{}] Authentication rejected", id);
        return Err("Authentication rejected by server".into());
    }
    
    info!("[SSH:{}] Authentication successful", id);
    
    // Open channel and request PTY
    let mut channel = handle.channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel: {}", e))?;
    
    // Request PTY
    channel.request_pty(
        false, // want_reply
        "xterm-256color",
        80, 24, 0, 0,
        &[], // Terminal modes
    ).await.map_err(|e| format!("Failed to request PTY: {}", e))?;
    
    // Request shell
    channel.request_shell(true)
        .await
        .map_err(|e| format!("Failed to request shell: {}", e))?;
    
    info!("[SSH:{}] PTY channel established", id);
    
    // Create write command channel
    let (write_tx, mut write_rx) = mpsc::channel::<WriteCommand>(256);
    
    // Store connection
    let conn = Arc::new(RusshConnection {
        write_tx,
        alive: AtomicBool::new(true),
        last_activity: std::sync::Mutex::new(Instant::now()),
        idle_timeout_minutes: idle_timeout,
    });
    
    // Store credentials for reconnection
    {
        let mut creds = state.credentials.lock().unwrap();
        creds.insert(id.clone(), StoredCredentials {
            host: host.clone(),
            port: ssh_port,
            username: user.clone(),
            password: actual_password.clone(),
            auth_type: auth.clone(),
            private_key_path: private_key_path.clone(),
        });
    }
    
    // Spawn IO task that owns the channel
    let app_clone = app.clone();
    let id_clone = id.clone();
    let conn_clone = conn.clone();
    
    tokio::spawn(async move {
        debug!("[SSH:{}] IO task started", id_clone);
        
        loop {
            tokio::select! {
                // Handle incoming data from SSH
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) => {
                            // Update last activity
                            if let Ok(mut last) = conn_clone.last_activity.lock() {
                                *last = Instant::now();
                            }
                            
                            // Emit data to frontend
                            let _ = app_clone.emit("term-data", Payload {
                                id: id_clone.clone(),
                                data: data.to_vec(),
                            });
                        }
                        Some(ChannelMsg::ExtendedData { data, ext: _ }) => {
                            // Extended data (stderr)
                            let _ = app_clone.emit("term-data", Payload {
                                id: id_clone.clone(),
                                data: data.to_vec(),
                            });
                        }
                        Some(ChannelMsg::Eof) => {
                            info!("[SSH:{}] Channel EOF received", id_clone);
                            let _ = app_clone.emit("connection-lost", ConnectionLostPayload {
                                id: id_clone.clone(),
                                reason: "Connection closed by remote host".to_string(),
                            });
                            break;
                        }
                        Some(ChannelMsg::Close) => {
                            info!("[SSH:{}] Channel closed", id_clone);
                            let _ = app_clone.emit("connection-lost", ConnectionLostPayload {
                                id: id_clone.clone(),
                                reason: "Channel closed".to_string(),
                            });
                            break;
                        }
                        None => {
                            warn!("[SSH:{}] Channel wait returned None", id_clone);
                            let _ = app_clone.emit("connection-lost", ConnectionLostPayload {
                                id: id_clone.clone(),
                                reason: "Connection lost".to_string(),
                            });
                            break;
                        }
                        _ => {
                            // Other messages, ignore
                        }
                    }
                }
                
                // Handle write commands from app
                cmd = write_rx.recv() => {
                    match cmd {
                        Some(WriteCommand::Data(bytes)) => {
                            if let Err(e) = channel.data(&bytes[..]).await {
                                error!("[SSH:{}] Write error: {}", id_clone, e);
                                break;
                            }
                        }
                        Some(WriteCommand::Resize { cols, rows }) => {
                            if let Err(e) = channel.window_change(cols, rows, 0, 0).await {
                                warn!("[SSH:{}] Resize error: {}", id_clone, e);
                            }
                        }
                        Some(WriteCommand::Disconnect) | None => {
                            info!("[SSH:{}] Disconnect command received", id_clone);
                            let _ = channel.eof().await;
                            let _ = channel.close().await;
                            break;
                        }
                    }
                }
            }
        }
        
        conn_clone.alive.store(false, Ordering::Relaxed);
        debug!("[SSH:{}] IO task ended", id_clone);
    });
    
    // Store connection in state
    {
        let mut connections = state.connections.lock().await;
        connections.insert(id.clone(), conn);
    }
    
    info!("[SSH:{}] Connection established successfully", id);
    
    Ok(format!("Connected to {}@{}:{}", user, host, ssh_port))
}

/// Write data to PTY
#[tauri::command]
pub async fn russh_write_pty(
    state: tauri::State<'_, RusshAppState>,
    id: String,
    data: String,
) -> Result<(), String> {
    let connections = state.connections.lock().await;
    
    if let Some(conn) = connections.get(&id) {
        // Update activity
        if let Ok(mut last) = conn.last_activity.lock() {
            *last = Instant::now();
        }
        
        // Send write command
        conn.write_tx.send(WriteCommand::Data(data.into_bytes()))
            .await
            .map_err(|e| format!("Failed to send write command: {}", e))?;
        
        Ok(())
    } else {
        Err(format!("Connection {} not found", id))
    }
}

/// Resize PTY
#[tauri::command]
pub async fn russh_resize_pty(
    state: tauri::State<'_, RusshAppState>,
    id: String,
    rows: u32,
    cols: u32,
) -> Result<(), String> {
    let connections = state.connections.lock().await;
    
    if let Some(conn) = connections.get(&id) {
        // Send resize command
        conn.write_tx.send(WriteCommand::Resize { cols, rows })
            .await
            .map_err(|e| format!("Failed to send resize command: {}", e))?;
        
        Ok(())
    } else {
        Err(format!("Connection {} not found", id))
    }
}

/// Disconnect from SSH server
#[tauri::command]
pub async fn russh_disconnect(
    state: tauri::State<'_, RusshAppState>,
    id: String,
) -> Result<(), String> {
    info!("[SSH:{}] Disconnect requested", id);
    
    let mut connections = state.connections.lock().await;
    
    if let Some(conn) = connections.remove(&id) {
        conn.alive.store(false, Ordering::Relaxed);
        
        // Send disconnect command
        let _ = conn.write_tx.send(WriteCommand::Disconnect).await;
        
        info!("[SSH:{}] Disconnected", id);
        Ok(())
    } else {
        warn!("[SSH:{}] Connection not found for disconnect", id);
        Ok(())
    }
}

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::thread;
use std::time::Duration;
use russh::*;
use tauri::{AppHandle, Emitter};
use log::{info, warn, error, debug};

/// Active port forward state
pub struct ActiveForward {
    pub id: String,
    pub connection_id: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub running: Arc<AtomicBool>,
}

/// Payload for port forward events
#[derive(Clone, serde::Serialize)]
pub struct PortForwardEvent {
    pub connection_id: String,
    pub forward_id: String,
    pub event_type: String,  // "started", "stopped", "error", "connection"
    pub message: String,
}

/// State for managing port forwards
pub struct PortForwardState {
    pub active_forwards: Arc<Mutex<HashMap<String, ActiveForward>>>,
}

impl Default for PortForwardState {
    fn default() -> Self {
        Self {
            active_forwards: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

/// SSH client handler for port forwarding
struct TunnelClient;

#[async_trait::async_trait]
impl client::Handler for TunnelClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh_keys::PublicKey
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

/// Start a local port forward
#[tauri::command]
pub fn start_port_forward(
    app: AppHandle,
    ssh_state: tauri::State<'_, crate::ssh::AppState>,
    russh_state: tauri::State<'_, crate::ssh_russh::RusshAppState>,
    pf_state: tauri::State<'_, PortForwardState>,
    connection_id: String,
    forward_id: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
) -> Result<String, String> {
    // Check if already running
    {
        let forwards = pf_state.active_forwards.lock().unwrap();
        if forwards.contains_key(&forward_id) {
            return Err("该隧道已在运行中".into());
        }
    }

    // Get credentials - try russh first, then ssh2
    let credentials = {
        let russh_creds = russh_state.credentials.lock().unwrap();
        if let Some(c) = russh_creds.get(&connection_id) {
            crate::ssh::StoredCredentials {
                host: c.host.clone(),
                port: c.port,
                username: c.username.clone(),
                password: c.password.clone(),
                auth_type: c.auth_type.clone(),
                private_key_path: c.private_key_path.clone(),
            }
        } else {
            let creds = ssh_state.credentials.lock().unwrap();
            creds.get(&connection_id).cloned()
                .ok_or("No active connection found for this ID")?
        }
    };

    let running = Arc::new(AtomicBool::new(true));
    let running_clone = running.clone();
    let forward_id_clone = forward_id.clone();
    let remote_host_clone = remote_host.clone();
    let app_clone = app.clone();
    let connection_id_clone = connection_id.clone();

    // Start listener thread
    thread::spawn(move || {
        let listener = match TcpListener::bind(format!("127.0.0.1:{}", local_port)) {
            Ok(l) => l,
            Err(e) => {
                let _ = app_clone.emit("port-forward-event", PortForwardEvent {
                    connection_id: connection_id_clone,
                    forward_id: forward_id_clone,
                    event_type: "error".into(),
                    message: format!("Failed to bind to port {}: {}", local_port, e),
                });
                return;
            }
        };

        // Set non-blocking to allow checking running flag
        listener.set_nonblocking(true).ok();

        let _ = app_clone.emit("port-forward-event", PortForwardEvent {
            connection_id: connection_id_clone.clone(),
            forward_id: forward_id_clone.clone(),
            event_type: "started".into(),
            message: format!("Listening on 127.0.0.1:{}", local_port),
        });

        info!("[PortForward:{}] Started on 127.0.0.1:{}", forward_id_clone, local_port);

        while running_clone.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((client_stream, addr)) => {
                    let _ = app_clone.emit("port-forward-event", PortForwardEvent {
                        connection_id: connection_id_clone.clone(),
                        forward_id: forward_id_clone.clone(),
                        event_type: "connection".into(),
                        message: format!("New connection from {}", addr),
                    });

                    debug!("[PortForward:{}] New connection from {}", forward_id_clone, addr);

                    let creds = credentials.clone();
                    let remote_host = remote_host_clone.clone();
                    let remote_port = remote_port;
                    let running = running_clone.clone();

                    // Handle tunnel in a new thread with tokio runtime
                    thread::spawn(move || {
                        // Create a new tokio runtime for this tunnel
                        let rt = match tokio::runtime::Runtime::new() {
                            Ok(rt) => rt,
                            Err(e) => {
                                error!("Failed to create tokio runtime: {}", e);
                                return;
                            }
                        };
                        
                        rt.block_on(async {
                            if let Err(e) = handle_tunnel_connection(
                                client_stream,
                                &creds,
                                &remote_host,
                                remote_port,
                                running,
                            ).await {
                                warn!("Tunnel error: {}", e);
                            }
                        });
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(100));
                }
                Err(e) => {
                    error!("[PortForward] Accept error: {}", e);
                    break;
                }
            }
        }

        let _ = app_clone.emit("port-forward-event", PortForwardEvent {
            connection_id: connection_id_clone,
            forward_id: forward_id_clone,
            event_type: "stopped".into(),
            message: "Port forward stopped".into(),
        });
    });

    // Store active forward
    {
        let mut forwards = pf_state.active_forwards.lock().unwrap();
        forwards.insert(forward_id.clone(), ActiveForward {
            id: forward_id.clone(),
            connection_id: connection_id.clone(),
            local_port,
            remote_host,
            remote_port,
            running,
        });
    }

    Ok(format!("Port forward started on 127.0.0.1:{}", local_port))
}

/// Handle a single tunnel connection using russh
async fn handle_tunnel_connection(
    mut client: TcpStream,
    creds: &crate::ssh::StoredCredentials,
    remote_host: &str,
    remote_port: u16,
    running: Arc<AtomicBool>,
) -> Result<(), String> {
    // Build russh config
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(120)),
        keepalive_interval: Some(Duration::from_secs(15)),
        keepalive_max: 4,
        ..Default::default()
    });
    
    // Connect to SSH server
    let addr = format!("{}:{}", creds.host, creds.port);
    let mut handle = tokio::time::timeout(
        Duration::from_secs(30),
        client::connect(config, addr.clone(), TunnelClient)
    )
    .await
    .map_err(|_| "SSH connection timeout".to_string())?
    .map_err(|e| format!("SSH connection failed: {}", e))?;
    
    debug!("[Tunnel] Connected to SSH server {}", addr);
    
    // Authenticate
    let authenticated = match creds.auth_type.as_str() {
        "Key" => {
            if let Some(ref key_path) = creds.private_key_path {
                let key = russh_keys::load_secret_key(key_path, creds.password.as_deref())
                    .map_err(|e| format!("Failed to load key: {}", e))?;
                handle.authenticate_publickey(&creds.username, Arc::new(key))
                    .await
                    .map_err(|e| format!("Key auth failed: {}", e))?
            } else {
                return Err("Private key path not provided".into());
            }
        }
        "Agent" => {
            return Err("SSH Agent not supported in russh".into());
        }
        _ => {
            if let Some(ref pwd) = creds.password {
                handle.authenticate_password(&creds.username, pwd)
                    .await
                    .map_err(|e| format!("Password auth failed: {}", e))?
            } else {
                return Err("Password not provided".into());
            }
        }
    };
    
    if !authenticated {
        return Err("Authentication rejected".into());
    }
    
    debug!("[Tunnel] Authenticated, opening direct-tcpip channel to {}:{}", remote_host, remote_port);
    
    // Open direct-tcpip channel for port forwarding
    let mut channel = handle.channel_open_direct_tcpip(
        remote_host,
        remote_port as u32,
        "127.0.0.1",
        0,
    )
    .await
    .map_err(|e| format!("Failed to open tunnel channel: {}", e))?;
    
    debug!("[Tunnel] Channel opened, starting bidirectional copy");
    
    // Set client to non-blocking for polling
    client.set_nonblocking(true).ok();
    
    let mut client_buf = [0u8; 8192];
    
    // Bidirectional copy loop
    while running.load(Ordering::Relaxed) {
        let mut did_work = false;
        
        // Client -> SSH Channel
        match client.read(&mut client_buf) {
            Ok(0) => {
                debug!("[Tunnel] Client closed connection");
                break;
            }
            Ok(n) => {
                if let Err(e) = channel.data(&client_buf[..n]).await {
                    debug!("[Tunnel] Failed to write to channel: {}", e);
                    break;
                }
                did_work = true;
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(e) => {
                debug!("[Tunnel] Client read error: {}", e);
                break;
            }
        }
        
        // SSH Channel -> Client (non-blocking check)
        match tokio::time::timeout(Duration::from_millis(10), channel.wait()).await {
            Ok(Some(ChannelMsg::Data { data })) => {
                if let Err(e) = client.write_all(&data) {
                    debug!("[Tunnel] Failed to write to client: {}", e);
                    break;
                }
                did_work = true;
            }
            Ok(Some(ChannelMsg::Eof)) | Ok(Some(ChannelMsg::Close)) | Ok(None) => {
                debug!("[Tunnel] Channel closed");
                break;
            }
            Ok(_) => {}
            Err(_) => {} // Timeout, no data available
        }
        
        if !did_work {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
    
    // Close channel
    let _ = channel.eof().await;
    let _ = channel.close().await;
    
    debug!("[Tunnel] Connection closed");
    
    Ok(())
}

/// Stop a port forward
#[tauri::command]
pub fn stop_port_forward(
    pf_state: tauri::State<'_, PortForwardState>,
    forward_id: String,
) -> Result<(), String> {
    let mut forwards = pf_state.active_forwards.lock().unwrap();
    if let Some(forward) = forwards.remove(&forward_id) {
        forward.running.store(false, Ordering::Relaxed);
        info!("[PortForward:{}] Stopped", forward_id);
        Ok(())
    } else {
        Err("Port forward not found".into())
    }
}

/// List active port forwards
#[tauri::command]
pub fn list_port_forwards(
    pf_state: tauri::State<'_, PortForwardState>,
) -> Result<Vec<serde_json::Value>, String> {
    let forwards = pf_state.active_forwards.lock().unwrap();
    let list: Vec<_> = forwards.values().map(|f| {
        serde_json::json!({
            "id": f.id,
            "connection_id": f.connection_id,
            "local_port": f.local_port,
            "remote_host": f.remote_host,
            "remote_port": f.remote_port,
        })
    }).collect();
    Ok(list)
}

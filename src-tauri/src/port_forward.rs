use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::thread;
use std::time::Duration;
use ssh2::Session;
use tauri::{AppHandle, Emitter};

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

/// Start a local port forward
#[tauri::command]
pub fn start_port_forward(
    app: AppHandle,
    ssh_state: tauri::State<'_, crate::ssh::AppState>,
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

    // Get the SSH session credentials to create new sessions for each tunnel
    let credentials = {
        let creds = ssh_state.credentials.lock().unwrap();
        creds.get(&connection_id).cloned()
            .ok_or("No active connection found for this ID")?
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

        while running_clone.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((client_stream, addr)) => {
                    let _ = app_clone.emit("port-forward-event", PortForwardEvent {
                        connection_id: connection_id_clone.clone(),
                        forward_id: forward_id_clone.clone(),
                        event_type: "connection".into(),
                        message: format!("New connection from {}", addr),
                    });

                    // Create a new SSH session for this tunnel connection
                    let creds = credentials.clone();
                    let remote_host = remote_host_clone.clone();
                    let remote_port = remote_port;
                    let running = running_clone.clone();

                    thread::spawn(move || {
                        if let Err(e) = handle_tunnel_connection(
                            client_stream,
                            &creds,
                            &remote_host,
                            remote_port,
                            running,
                        ) {
                            eprintln!("Tunnel error: {}", e);
                        }
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    // No connection, sleep briefly
                    thread::sleep(Duration::from_millis(100));
                }
                Err(e) => {
                    eprintln!("Accept error: {}", e);
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

/// Handle a single tunnel connection
fn handle_tunnel_connection(
    mut client: TcpStream,
    creds: &crate::ssh::StoredCredentials,
    remote_host: &str,
    remote_port: u16,
    running: Arc<AtomicBool>,
) -> Result<(), String> {
    // Create new SSH session for this tunnel
    let tcp = TcpStream::connect(format!("{}:{}", creds.host, creds.port))
        .map_err(|e| format!("Failed to connect to SSH server: {}", e))?;
    tcp.set_read_timeout(Some(Duration::from_secs(30))).ok();
    
    let mut session = Session::new()
        .map_err(|e| format!("Failed to create session: {}", e))?;
    session.set_tcp_stream(tcp);
    session.handshake()
        .map_err(|e| format!("SSH handshake failed: {}", e))?;

    // Authenticate
    match &creds.auth_type as &str {
        "Key" => {
            if let Some(key_path) = &creds.private_key_path {
                let path = std::path::Path::new(key_path);
                session.userauth_pubkey_file(
                    &creds.username,
                    None,
                    path,
                    creds.password.as_deref(),
                ).map_err(|e| format!("Key auth failed: {}", e))?;
            }
        }
        "Agent" => {
            session.userauth_agent(&creds.username)
                .map_err(|e| format!("Agent auth failed: {}", e))?;
        }
        _ => {
            if let Some(pwd) = &creds.password {
                session.userauth_password(&creds.username, pwd)
                    .map_err(|e| format!("Password auth failed: {}", e))?;
            }
        }
    }

    if !session.authenticated() {
        return Err("Authentication failed".into());
    }

    // Create direct TCP/IP channel
    let mut channel = session.channel_direct_tcpip(
        remote_host,
        remote_port,
        None,
    ).map_err(|e| format!("Failed to create tunnel: {}", e))?;

    // Set non-blocking
    session.set_blocking(false);
    client.set_nonblocking(true).ok();

    let mut client_buf = [0u8; 8192];
    let mut channel_buf = [0u8; 8192];

    // Bidirectional copy
    while running.load(Ordering::Relaxed) {
        let mut did_work = false;

        // Client -> Channel
        match client.read(&mut client_buf) {
            Ok(0) => break, // Client closed
            Ok(n) => {
                channel.write_all(&client_buf[..n]).ok();
                did_work = true;
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => break,
        }

        // Channel -> Client
        match channel.read(&mut channel_buf) {
            Ok(0) => break, // Channel closed
            Ok(n) => {
                client.write_all(&channel_buf[..n]).ok();
                did_work = true;
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => break,
        }

        if !did_work {
            thread::sleep(Duration::from_millis(10));
        }
    }

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

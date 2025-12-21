use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Command history entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandHistory {
    pub id: String,
    pub server_id: String,
    pub command: String,
    pub executed_at: String,
}

/// Quick command entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickCommand {
    pub id: String,
    pub name: String,
    pub command: String,
    pub category: String,
    pub description: Option<String>,
}

/// Get config directory path
fn get_config_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let config_dir = home.join(".yyshell");
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }
    Ok(config_dir)
}

// ============ Command History Functions ============

#[tauri::command]
pub fn load_command_history(server_id: String) -> Result<Vec<CommandHistory>, String> {
    let config_dir = get_config_dir()?;
    let file_path = config_dir.join("command_history.json");
    
    if !file_path.exists() {
        return Ok(vec![]);
    }
    
    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let all_history: Vec<CommandHistory> = serde_json::from_str(&content).unwrap_or_default();
    
    // Filter by server_id
    let filtered: Vec<CommandHistory> = all_history
        .into_iter()
        .filter(|h| h.server_id == server_id)
        .collect();
    
    Ok(filtered)
}

#[tauri::command]
pub fn add_command_history(
    server_id: String,
    command: String,
) -> Result<CommandHistory, String> {
    let config_dir = get_config_dir()?;
    let file_path = config_dir.join("command_history.json");
    
    // Load existing history
    let mut all_history: Vec<CommandHistory> = if file_path.exists() {
        let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        vec![]
    };
    
    // Create new entry
    let entry = CommandHistory {
        id: uuid::Uuid::new_v4().to_string(),
        server_id: server_id.clone(),
        command: command.clone(),
        executed_at: chrono::Utc::now().to_rfc3339(),
    };
    
    all_history.push(entry.clone());
    
    // Limit history per server (keep last 500)
    let mut server_history: Vec<CommandHistory> = all_history
        .iter()
        .filter(|h| h.server_id == server_id)
        .cloned()
        .collect();
    
    if server_history.len() > 500 {
        let skip_count = server_history.len() - 500;
        server_history = server_history.into_iter().skip(skip_count).collect();
    }
    
    // Rebuild all history
    let other_history: Vec<CommandHistory> = all_history
        .into_iter()
        .filter(|h| h.server_id != server_id)
        .collect();
    
    let final_history: Vec<CommandHistory> = other_history
        .into_iter()
        .chain(server_history.into_iter())
        .collect();
    
    // Save
    let json = serde_json::to_string_pretty(&final_history).map_err(|e| e.to_string())?;
    fs::write(&file_path, json).map_err(|e| e.to_string())?;
    
    Ok(entry)
}

#[tauri::command]
pub fn clear_command_history(server_id: String) -> Result<(), String> {
    let config_dir = get_config_dir()?;
    let file_path = config_dir.join("command_history.json");
    
    if !file_path.exists() {
        return Ok(());
    }
    
    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let all_history: Vec<CommandHistory> = serde_json::from_str(&content).unwrap_or_default();
    
    // Keep only other servers' history
    let filtered: Vec<CommandHistory> = all_history
        .into_iter()
        .filter(|h| h.server_id != server_id)
        .collect();
    
    let json = serde_json::to_string_pretty(&filtered).map_err(|e| e.to_string())?;
    fs::write(&file_path, json).map_err(|e| e.to_string())?;
    
    Ok(())
}

// ============ Quick Commands Functions ============

#[tauri::command]
pub fn load_quick_commands() -> Result<Vec<QuickCommand>, String> {
    let config_dir = get_config_dir()?;
    let file_path = config_dir.join("quick_commands.json");
    
    if !file_path.exists() {
        // Return default commands
        return Ok(get_default_quick_commands());
    }
    
    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let commands: Vec<QuickCommand> = serde_json::from_str(&content).unwrap_or_else(|_| get_default_quick_commands());
    
    Ok(commands)
}

#[tauri::command]
pub fn save_quick_commands(commands: Vec<QuickCommand>) -> Result<(), String> {
    let config_dir = get_config_dir()?;
    let file_path = config_dir.join("quick_commands.json");
    
    let json = serde_json::to_string_pretty(&commands).map_err(|e| e.to_string())?;
    fs::write(&file_path, json).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn add_quick_command(
    name: String,
    command: String,
    category: String,
    description: Option<String>,
) -> Result<QuickCommand, String> {
    let mut commands = load_quick_commands()?;
    
    let new_command = QuickCommand {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        command,
        category,
        description,
    };
    
    commands.push(new_command.clone());
    save_quick_commands(commands)?;
    
    Ok(new_command)
}

#[tauri::command]
pub fn update_quick_command(
    id: String,
    name: String,
    command: String,
    category: String,
    description: Option<String>,
) -> Result<QuickCommand, String> {
    let mut commands = load_quick_commands()?;
    
    let updated = QuickCommand {
        id: id.clone(),
        name,
        command,
        category,
        description,
    };
    
    if let Some(pos) = commands.iter().position(|c| c.id == id) {
        commands[pos] = updated.clone();
        save_quick_commands(commands)?;
        Ok(updated)
    } else {
        Err("Command not found".to_string())
    }
}

#[tauri::command]
pub fn delete_quick_command(id: String) -> Result<(), String> {
    let mut commands = load_quick_commands()?;
    commands.retain(|c| c.id != id);
    save_quick_commands(commands)?;
    Ok(())
}

/// Default quick commands
fn get_default_quick_commands() -> Vec<QuickCommand> {
    vec![
        QuickCommand {
            id: "1".to_string(),
            name: "查看磁盘使用".to_string(),
            command: "df -h".to_string(),
            category: "系统管理".to_string(),
            description: Some("显示磁盘空间使用情况".to_string()),
        },
        QuickCommand {
            id: "2".to_string(),
            name: "查看内存使用".to_string(),
            command: "free -h".to_string(),
            category: "系统管理".to_string(),
            description: Some("显示内存使用情况".to_string()),
        },
        QuickCommand {
            id: "3".to_string(),
            name: "查看进程".to_string(),
            command: "top -bn1 | head -20".to_string(),
            category: "系统管理".to_string(),
            description: Some("显示系统进程概览".to_string()),
        },
        QuickCommand {
            id: "4".to_string(),
            name: "查看网络连接".to_string(),
            command: "netstat -tuln".to_string(),
            category: "网络诊断".to_string(),
            description: Some("显示监听的端口".to_string()),
        },
        QuickCommand {
            id: "5".to_string(),
            name: "查看 Docker 容器".to_string(),
            command: "docker ps -a".to_string(),
            category: "Docker".to_string(),
            description: Some("列出所有 Docker 容器".to_string()),
        },
        QuickCommand {
            id: "6".to_string(),
            name: "查看系统日志".to_string(),
            command: "tail -100 /var/log/syslog".to_string(),
            category: "系统管理".to_string(),
            description: Some("查看最近的系统日志".to_string()),
        },
    ]
}

// ============ Tunnel Preset Functions ============

/// SSH Tunnel preset - global template for any server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelPreset {
    pub id: String,
    pub name: String,
    pub category: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    #[serde(default)]
    pub description: Option<String>,
}

#[tauri::command]
pub fn load_tunnel_presets() -> Result<Vec<TunnelPreset>, String> {
    let config_dir = get_config_dir()?;
    let file_path = config_dir.join("tunnel_presets.json");
    
    if !file_path.exists() {
        // Return default presets
        return Ok(get_default_tunnel_presets());
    }
    
    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let presets: Vec<TunnelPreset> = serde_json::from_str(&content).unwrap_or_default();
    
    Ok(presets)
}

fn get_default_tunnel_presets() -> Vec<TunnelPreset> {
    vec![
        // 数据库
        TunnelPreset {
            id: uuid::Uuid::new_v4().to_string(),
            name: "MySQL".to_string(),
            category: "数据库".to_string(),
            local_port: 13306,
            remote_host: "localhost".to_string(),
            remote_port: 3306,
            description: Some("MySQL 数据库".to_string()),
        },
        TunnelPreset {
            id: uuid::Uuid::new_v4().to_string(),
            name: "PostgreSQL".to_string(),
            category: "数据库".to_string(),
            local_port: 15432,
            remote_host: "localhost".to_string(),
            remote_port: 5432,
            description: Some("PostgreSQL 数据库".to_string()),
        },
        TunnelPreset {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Redis".to_string(),
            category: "数据库".to_string(),
            local_port: 16379,
            remote_host: "localhost".to_string(),
            remote_port: 6379,
            description: Some("Redis 缓存".to_string()),
        },
        TunnelPreset {
            id: uuid::Uuid::new_v4().to_string(),
            name: "MongoDB".to_string(),
            category: "数据库".to_string(),
            local_port: 27017,
            remote_host: "localhost".to_string(),
            remote_port: 27017,
            description: Some("MongoDB 数据库".to_string()),
        },
        TunnelPreset {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Elasticsearch".to_string(),
            category: "数据库".to_string(),
            local_port: 19200,
            remote_host: "localhost".to_string(),
            remote_port: 9200,
            description: Some("ES 搜索引擎".to_string()),
        },
        // Web服务
        TunnelPreset {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Nginx".to_string(),
            category: "Web服务".to_string(),
            local_port: 18080,
            remote_host: "localhost".to_string(),
            remote_port: 80,
            description: Some("HTTP 服务".to_string()),
        },
        TunnelPreset {
            id: uuid::Uuid::new_v4().to_string(),
            name: "HTTPS".to_string(),
            category: "Web服务".to_string(),
            local_port: 18443,
            remote_host: "localhost".to_string(),
            remote_port: 443,
            description: Some("HTTPS 服务".to_string()),
        },
        TunnelPreset {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Node.js".to_string(),
            category: "Web服务".to_string(),
            local_port: 13000,
            remote_host: "localhost".to_string(),
            remote_port: 3000,
            description: Some("Node 开发服务器".to_string()),
        },
        TunnelPreset {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Tomcat".to_string(),
            category: "Web服务".to_string(),
            local_port: 18080,
            remote_host: "localhost".to_string(),
            remote_port: 8080,
            description: Some("Java Web 服务".to_string()),
        },
        // 开发工具
        TunnelPreset {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Jupyter".to_string(),
            category: "开发工具".to_string(),
            local_port: 18888,
            remote_host: "localhost".to_string(),
            remote_port: 8888,
            description: Some("Jupyter Notebook".to_string()),
        },
        TunnelPreset {
            id: uuid::Uuid::new_v4().to_string(),
            name: "VS Code Server".to_string(),
            category: "开发工具".to_string(),
            local_port: 18443,
            remote_host: "localhost".to_string(),
            remote_port: 8443,
            description: Some("远程 VS Code".to_string()),
        },
        TunnelPreset {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Docker API".to_string(),
            category: "开发工具".to_string(),
            local_port: 12375,
            remote_host: "localhost".to_string(),
            remote_port: 2375,
            description: Some("Docker 守护进程".to_string()),
        },
        TunnelPreset {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Grafana".to_string(),
            category: "开发工具".to_string(),
            local_port: 13001,
            remote_host: "localhost".to_string(),
            remote_port: 3001,
            description: Some("监控面板".to_string()),
        },
        TunnelPreset {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Prometheus".to_string(),
            category: "开发工具".to_string(),
            local_port: 19090,
            remote_host: "localhost".to_string(),
            remote_port: 9090,
            description: Some("指标服务".to_string()),
        },
    ]
}

#[tauri::command]
pub fn save_tunnel_presets(presets: Vec<TunnelPreset>) -> Result<(), String> {
    let config_dir = get_config_dir()?;
    let file_path = config_dir.join("tunnel_presets.json");
    
    let json = serde_json::to_string_pretty(&presets).map_err(|e| e.to_string())?;
    fs::write(&file_path, json).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn add_tunnel_preset(
    name: String,
    category: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    description: Option<String>,
) -> Result<TunnelPreset, String> {
    let mut presets = load_tunnel_presets()?;
    
    let new_preset = TunnelPreset {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        category,
        local_port,
        remote_host,
        remote_port,
        description,
    };
    
    presets.push(new_preset.clone());
    save_tunnel_presets(presets)?;
    
    Ok(new_preset)
}

#[tauri::command]
pub fn update_tunnel_preset(
    id: String,
    name: String,
    category: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    description: Option<String>,
) -> Result<TunnelPreset, String> {
    let mut presets = load_tunnel_presets()?;
    
    let updated = TunnelPreset {
        id: id.clone(),
        name,
        category,
        local_port,
        remote_host,
        remote_port,
        description,
    };
    
    if let Some(pos) = presets.iter().position(|p| p.id == id) {
        presets[pos] = updated.clone();
        save_tunnel_presets(presets)?;
        Ok(updated)
    } else {
        Err("Tunnel preset not found".to_string())
    }
}

#[tauri::command]
pub fn delete_tunnel_preset(id: String) -> Result<(), String> {
    let mut presets = load_tunnel_presets()?;
    presets.retain(|p| p.id != id);
    save_tunnel_presets(presets)?;
    Ok(())
}

// ============ Tunnel Category Order Functions ============

#[tauri::command]
pub fn load_tunnel_category_order() -> Result<Vec<String>, String> {
    let config_dir = get_config_dir()?;
    let file_path = config_dir.join("tunnel_categories.json");
    
    if !file_path.exists() {
        // Return default categories
        return Ok(vec![
            "数据库".to_string(),
            "Web服务".to_string(),
            "开发工具".to_string(),
            "其他".to_string(),
        ]);
    }
    
    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let categories: Vec<String> = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(categories)
}

#[tauri::command]
pub fn save_tunnel_category_order(categories: Vec<String>) -> Result<(), String> {
    let config_dir = get_config_dir()?;
    let file_path = config_dir.join("tunnel_categories.json");
    
    let json = serde_json::to_string_pretty(&categories).map_err(|e| e.to_string())?;
    fs::write(&file_path, json).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn rename_tunnel_category(old_name: String, new_name: String) -> Result<(), String> {
    // Update category order
    let mut categories = load_tunnel_category_order()?;
    if let Some(pos) = categories.iter().position(|c| c == &old_name) {
        categories[pos] = new_name.clone();
    }
    save_tunnel_category_order(categories)?;
    
    // Update all presets with this category
    let mut presets = load_tunnel_presets()?;
    for preset in presets.iter_mut() {
        if preset.category == old_name {
            preset.category = new_name.clone();
        }
    }
    save_tunnel_presets(presets)?;
    
    Ok(())
}

#[tauri::command]
pub fn delete_tunnel_category(category_name: String) -> Result<(), String> {
    // Remove from category order
    let mut categories = load_tunnel_category_order()?;
    categories.retain(|c| c != &category_name);
    save_tunnel_category_order(categories)?;
    
    // Delete all presets in this category
    let mut presets = load_tunnel_presets()?;
    presets.retain(|p| p.category != category_name);
    save_tunnel_presets(presets)?;
    
    Ok(())
}

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

use keyring::Entry;

const SERVICE_NAME: &str = "com.chenhuiyi.yyshell";

/// Save a password to the system keychain
/// Uses server_id as the unique identifier
pub fn save_password(server_id: &str, password: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, server_id)
        .map_err(|e| format!("Failed to create keychain entry: {}", e))?;
    
    entry.set_password(password)
        .map_err(|e| format!("Failed to save password to keychain: {}", e))?;
    
    Ok(())
}

/// Get a password from the system keychain
/// Returns None if the password doesn't exist
pub fn get_password(server_id: &str) -> Option<String> {
    let entry = Entry::new(SERVICE_NAME, server_id).ok()?;
    entry.get_password().ok()
}

/// Delete a password from the system keychain
pub fn delete_password(server_id: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, server_id)
        .map_err(|e| format!("Failed to access keychain entry: {}", e))?;
    
    // Ignore error if credential doesn't exist
    let _ = entry.delete_credential();
    
    Ok(())
}

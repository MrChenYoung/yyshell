// Plugin WASM runtime using wasmtime

use crate::plugin_types::{PluginError, PluginManifest};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use wasmtime::*;
use wasmtime_wasi::preview1::{self, WasiP1Ctx};
use wasmtime_wasi::WasiCtxBuilder;

/// Plugin state accessible from WASM
pub struct PluginState {
    pub wasi: WasiP1Ctx,
    pub plugin_id: String,
    pub storage: HashMap<String, String>,
}

/// A loaded plugin instance
pub struct PluginInstance {
    pub manifest: PluginManifest,
    store: Mutex<Store<PluginState>>,
    instance: Instance,
    linker: Linker<PluginState>,
}

/// WASM runtime for plugins
pub struct PluginRuntime {
    engine: Engine,
    plugins: HashMap<String, Arc<PluginInstance>>,
}

impl PluginRuntime {
    pub fn new() -> Result<Self, PluginError> {
        let mut config = Config::new();
        config.async_support(false);
        config.wasm_component_model(false);
        
        let engine = Engine::new(&config)
            .map_err(|e| PluginError::wasm_load_failed(&format!("Failed to create WASM engine: {}", e)))?;
        
        Ok(Self {
            engine,
            plugins: HashMap::new(),
        })
    }

    /// Load a plugin from a WASM file
    pub fn load_plugin(&mut self, manifest: PluginManifest, wasm_path: &Path) -> Result<(), PluginError> {
        let plugin_id = manifest.id.clone();
        
        // Read WASM bytes
        let wasm_bytes = std::fs::read(wasm_path)
            .map_err(|e| PluginError::wasm_load_failed(&format!("Failed to read WASM file: {}", e)))?;
        
        // Compile module
        let module = Module::new(&self.engine, &wasm_bytes)
            .map_err(|e| PluginError::wasm_load_failed(&format!("Failed to compile WASM: {}", e)))?;
        
        // Create WASI context
        let wasi = WasiCtxBuilder::new()
            .inherit_stdout()
            .inherit_stderr()
            .build_p1();
        
        let state = PluginState {
            wasi,
            plugin_id: plugin_id.clone(),
            storage: HashMap::new(),
        };
        
        let mut store = Store::new(&self.engine, state);
        let mut linker: Linker<PluginState> = Linker::new(&self.engine);
        
        // Add WASI functions
        preview1::add_to_linker_sync(&mut linker, |s| &mut s.wasi)
            .map_err(|e| PluginError::wasm_load_failed(&format!("Failed to add WASI: {}", e)))?;
        
        // Add YYShell host functions
        self.add_host_functions(&mut linker)?;
        
        // Instantiate module
        let instance = linker.instantiate(&mut store, &module)
            .map_err(|e| PluginError::wasm_load_failed(&format!("Failed to instantiate WASM: {}", e)))?;
        
        // Call _start if it exists (WASI entry point)
        if let Ok(start) = instance.get_typed_func::<(), ()>(&mut store, "_start") {
            let _ = start.call(&mut store, ());
        }
        
        let plugin_instance = PluginInstance {
            manifest,
            store: Mutex::new(store),
            instance,
            linker,
        };
        
        self.plugins.insert(plugin_id, Arc::new(plugin_instance));
        
        Ok(())
    }

    /// Add YYShell host functions to linker
    fn add_host_functions(&self, linker: &mut Linker<PluginState>) -> Result<(), PluginError> {
        // yyshell_log: Log a message
        linker.func_wrap("env", "yyshell_log", |mut caller: Caller<'_, PluginState>, ptr: i32, len: i32| {
            if let Some(memory) = caller.get_export("memory").and_then(|e| e.into_memory()) {
                let data = memory.data(&caller);
                if let Some(slice) = data.get(ptr as usize..(ptr + len) as usize) {
                    if let Ok(msg) = std::str::from_utf8(slice) {
                        println!("[Plugin:{}] {}", caller.data().plugin_id, msg);
                    }
                }
            }
        }).map_err(|e| PluginError::wasm_load_failed(&format!("Failed to add yyshell_log: {}", e)))?;

        // yyshell_storage_get: Get value from storage
        linker.func_wrap("env", "yyshell_storage_get", |mut caller: Caller<'_, PluginState>, key_ptr: i32, key_len: i32| -> i32 {
            if let Some(memory) = caller.get_export("memory").and_then(|e| e.into_memory()) {
                let data = memory.data(&caller);
                if let Some(slice) = data.get(key_ptr as usize..(key_ptr + key_len) as usize) {
                    if let Ok(key) = std::str::from_utf8(slice) {
                        if caller.data().storage.contains_key(key) {
                            return 1; // Found
                        }
                    }
                }
            }
            0 // Not found
        }).map_err(|e| PluginError::wasm_load_failed(&format!("Failed to add yyshell_storage_get: {}", e)))?;

        Ok(())
    }

    /// Unload a plugin
    pub fn unload_plugin(&mut self, id: &str) -> Result<(), PluginError> {
        self.plugins.remove(id)
            .ok_or_else(|| PluginError::plugin_not_found(id))?;
        Ok(())
    }

    /// Check if plugin is loaded
    pub fn is_loaded(&self, id: &str) -> bool {
        self.plugins.contains_key(id)
    }

    /// Get plugin instance
    pub fn get_plugin(&self, id: &str) -> Option<Arc<PluginInstance>> {
        self.plugins.get(id).cloned()
    }

    /// List loaded plugins
    pub fn list_plugins(&self) -> Vec<String> {
        self.plugins.keys().cloned().collect()
    }

    /// Call a plugin function
    pub fn call_plugin_function(
        &self,
        plugin_id: &str,
        function_name: &str,
        args: &[Val],
    ) -> Result<Vec<Val>, PluginError> {
        let plugin = self.plugins.get(plugin_id)
            .ok_or_else(|| PluginError::plugin_not_found(plugin_id))?;
        
        let mut store = plugin.store.lock().unwrap();
        
        let func = plugin.instance
            .get_func(&mut *store, function_name)
            .ok_or_else(|| PluginError::new("FUNCTION_NOT_FOUND", 
                &format!("Function '{}' not found in plugin '{}'", function_name, plugin_id)))?;
        
        let func_type = func.ty(&*store);
        let result_count = func_type.results().len();
        let mut results = vec![Val::I32(0); result_count];
        
        func.call(&mut *store, args, &mut results)
            .map_err(|e| PluginError::new("CALL_FAILED", &format!("Failed to call function: {}", e)))?;
        
        Ok(results)
    }
}

impl Default for PluginRuntime {
    fn default() -> Self {
        Self::new().expect("Failed to create plugin runtime")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_runtime_creation() {
        let runtime = PluginRuntime::new();
        assert!(runtime.is_ok());
    }
}

// Plugin Window Entry Point - Host Container
// This is the minimal container that loads and runs plugins dynamically at runtime

import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

// Import xterm for plugins to use
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';

// Expose React, ReactDOM, and xterm to plugins via window object
// This allows bundled plugins to use these without bundling them
(window as any).React = React;
(window as any).ReactDOM = ReactDOM;
(window as any).Terminal = Terminal;
(window as any).FitAddon = { FitAddon };

// Auto-connect server info passed from host
interface AutoConnectServer {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    password?: string | null;
    auth_type?: string | null;
    private_key_path?: string | null;
}

// Plugin API interface
interface PluginAPI {
    loadServers: () => Promise<any[]>;
    connect: (config: {
        id: string;
        host: string;
        port: number;
        user: string;
        auth_type?: string;
        password?: string;
        private_key_path?: string;
        serverId?: string;  // Original server ID for keychain password lookup
    }) => Promise<string>;
    disconnect: (id: string) => Promise<void>;
    sshExec: (id: string, command: string) => Promise<string>;
    writePty: (id: string, data: string) => Promise<void>;
    resizePty: (id: string, rows: number, cols: number) => Promise<void>;
    attachSession: (id: string, sessionType: 'screen' | 'tmux', sessionName: string) => Promise<void>;
    onTermData: (callback: (data: { id: string; data: number[] }) => void) => () => void;
    getTheme: () => 'light' | 'dark';
}

// Store for event listeners
const termDataListeners: Set<(data: { id: string; data: number[] }) => void> = new Set();

// Set up global terminal data listener
let globalTermDataUnlisten: UnlistenFn | null = null;
listen<{ id: string; data: number[] }>('term-data', (event) => {
    termDataListeners.forEach(cb => cb(event.payload));
}).then(unlisten => {
    globalTermDataUnlisten = unlisten;
});

// Get theme from URL query parameter
const getThemeFromURL = (): 'light' | 'dark' => {
    const params = new URLSearchParams(window.location.search);
    const theme = params.get('theme');
    if (theme === 'light') return 'light';
    if (theme === 'system') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
};

// Apply theme class to document root
const currentTheme = getThemeFromURL();
document.documentElement.classList.add(currentTheme);

// Create plugin API
const pluginAPI: PluginAPI = {
    loadServers: () => invoke<any[]>('load_servers'),
    connect: (config) => invoke<string>('russh_connect', {
        id: config.id,
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password || null,
        authType: config.auth_type || 'Password',
        privateKeyPath: config.private_key_path || null,
        serverId: config.serverId || null,
    }),
    disconnect: (id) => invoke('russh_disconnect', { id }),
    sshExec: (id, command) => invoke<string>('ssh_exec_command', { id, command }),
    writePty: (id, data) => invoke('russh_write_pty', { id, data }),
    resizePty: (id, rows, cols) => invoke('russh_resize_pty', { id, rows, cols }),

    // Attach to screen/tmux session by executing the appropriate command
    attachSession: async (id, sessionType, sessionName) => {
        const command = sessionType === 'screen'
            ? `screen -r ${sessionName}`
            : `tmux attach -t ${sessionName}`;
        await invoke('russh_write_pty', { id, data: command + '\n' });
    },

    // Register callback for terminal data
    onTermData: (callback) => {
        termDataListeners.add(callback);
        return () => {
            termDataListeners.delete(callback);
        };
    },

    // Get current theme
    getTheme: () => currentTheme,
};

// Make API available globally for plugins
(window as unknown as { __YYSHELL_PLUGIN__: PluginAPI }).__YYSHELL_PLUGIN__ = pluginAPI;

// Load and execute a plugin bundle dynamically
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadPluginBundle = async (pluginId: string): Promise<React.ComponentType<any>> => {
    // Get the bundle code from backend
    const bundleCode = await invoke<string>('load_plugin_bundle', { pluginId });

    // IIFE bundles look like: (function(exports, React) { ... }({}, React));
    // We need to capture the exports object

    try {
        // Create an exports object that the IIFE will populate
        const pluginExports: Record<string, unknown> = {};

        // Wrap the bundle code to capture IIFE exports
        // The bundle code is like: (function(e,React){...e.default=Component...}({},React))
        // We replace {} with our exports object
        let wrappedCode = bundleCode;

        // Check if it's an IIFE format: ends with }({},React); or similar
        const iifeMatch = bundleCode.match(/\}\s*\(\s*\{\s*\}\s*,\s*React\s*\)\s*;?\s*$/);
        if (iifeMatch) {
            // Replace the empty object {} with our pluginExports
            wrappedCode = bundleCode.replace(
                /\}\s*\(\s*\{\s*\}\s*,\s*React\s*\)\s*;?\s*$/,
                '}(__pluginExports__, React);'
            );
        }

        // Execute wrapped code
        const wrapper = new Function('__pluginExports__', 'React', 'ReactDOM', wrappedCode);
        wrapper(pluginExports, React, ReactDOM);

        // Get the default export (the plugin component)
        const PluginComponent = pluginExports.default || pluginExports.SessionManagerApp || Object.values(pluginExports).find(v => typeof v === 'function');

        if (typeof PluginComponent !== 'function') {
            console.error('Plugin exports:', pluginExports);
            throw new Error('Plugin bundle must export a React component as default');
        }

        return PluginComponent as React.ComponentType<any>;
    } catch (e) {
        console.error('Failed to execute plugin bundle:', e);
        throw e;
    }
};

// Minimal host styles
const hostStyles = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .plugin-loading, .plugin-error {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
        font-size: 16px;
    }
    .plugin-error {
        color: #ef4444;
        padding: 24px;
        text-align: center;
        max-width: 600px;
    }
`;

// Render the plugin dynamically based on URL parameter
function PluginWindow() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [PluginComponent, setPluginComponent] = useState<React.ComponentType<any> | null>(null);
    const [autoConnectServer, setAutoConnectServer] = useState<AutoConnectServer | undefined>(undefined);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const pluginId = params.get('plugin');

        if (!pluginId) {
            setError('未指定插件 ID');
            setLoading(false);
            return;
        }

        // Parse autoConnectServer if provided (Base64 encoded JSON)
        const autoConnectServerParam = params.get('autoConnectServer');
        if (autoConnectServerParam) {
            try {
                // Decode Base64 to JSON string, then parse
                const decoded = atob(autoConnectServerParam);
                const parsed = JSON.parse(decoded) as AutoConnectServer;
                setAutoConnectServer(parsed);
            } catch (e) {
                console.error('Failed to parse autoConnectServer:', e);
            }
        }

        // Load the plugin bundle dynamically from installed plugins
        loadPluginBundle(pluginId)
            .then((Component) => {
                setPluginComponent(() => Component);
                setLoading(false);
            })
            .catch((err) => {
                setError(`加载插件失败: ${err.message || err}`);
                setLoading(false);
            });
    }, []);

    if (loading) {
        return (
            <>
                <style>{hostStyles}</style>
                <div className="plugin-loading">加载中...</div>
            </>
        );
    }

    if (error) {
        return (
            <>
                <style>{hostStyles}</style>
                <div className="plugin-error">
                    <div>
                        <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>错误</div>
                        <div>{error}</div>
                    </div>
                </div>
            </>
        );
    }

    if (!PluginComponent) {
        return (
            <>
                <style>{hostStyles}</style>
                <div className="plugin-error">插件组件未找到</div>
            </>
        );
    }

    return (
        <>
            <style>{hostStyles}</style>
            <PluginComponent autoConnectServer={autoConnectServer} />
        </>
    );
}

ReactDOM.createRoot(document.getElementById('plugin-root')!).render(
    <React.StrictMode>
        <PluginWindow />
    </React.StrictMode>
);

// Cleanup on unload
window.addEventListener('unload', () => {
    if (globalTermDataUnlisten) {
        globalTermDataUnlisten();
    }
});

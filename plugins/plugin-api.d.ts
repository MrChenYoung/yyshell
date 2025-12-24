// YYShell Plugin API Type Definitions
// This file provides TypeScript types for plugin developers

export interface ServerConfig {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    auth_type: 'Password' | 'Key' | 'Agent';
    password?: string;
    private_key_path?: string;
    tags: string[];
    group?: string;
}

export interface TermDataEvent {
    id: string;
    data: number[];
}

export interface PluginAPI {
    // ===== Server Management =====

    /** Load all configured servers */
    loadServers: () => Promise<ServerConfig[]>;

    /** 
     * Connect to a server, returns connection ID
     * NOTE: For security, password is fetched from keychain using serverId.
     * Plugins should NOT receive passwords directly.
     */
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

    /** Disconnect from a server */
    disconnect: (id: string) => Promise<void>;

    // ===== Command Execution =====

    /** Execute a command via SSH and return output */
    sshExec: (id: string, command: string) => Promise<string>;

    // ===== Terminal/PTY Support =====

    /** Write data to the PTY (for interactive terminal) */
    writePty: (id: string, data: string) => Promise<void>;

    /** Resize the PTY */
    resizePty: (id: string, rows: number, cols: number) => Promise<void>;

    /** 
     * Attach to a screen/tmux session
     * This writes the appropriate attach command to the PTY
     */
    attachSession: (id: string, sessionType: 'screen' | 'tmux', sessionName: string) => Promise<void>;

    /** 
     * Register a callback for terminal data events
     * @returns Unsubscribe function
     * 
     * @example
     * const unsubscribe = pluginAPI.onTermData((event) => {
     *     if (event.id === myConnectionId) {
     *         const data = new Uint8Array(event.data);
     *         terminal.write(data);
     *     }
     * });
     * // Later: unsubscribe();
     */
    onTermData: (callback: (data: TermDataEvent) => void) => () => void;

    // ===== Theme =====

    /** Get current theme ('light' | 'dark') */
    getTheme: () => 'light' | 'dark';
}

// Access the API from your plugin:
// const pluginAPI = (window as any).__YYSHELL_PLUGIN__ as PluginAPI;

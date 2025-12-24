# YYShell 插件开发指南

本文档提供完整的 YYShell 插件开发指南，帮助开发者创建功能丰富的插件。

## 目录

- [快速开始](#快速开始)
- [插件结构](#插件结构)
- [manifest.json 配置](#manifestjson-配置)
- [Plugin API 参考](#plugin-api-参考)
- [终端集成](#终端集成)
- [主题适配](#主题适配)
- [构建与打包](#构建与打包)
- [发布插件](#发布插件)
- [示例代码](#示例代码)

---

## 快速开始

### 1. 创建插件项目

```bash
mkdir my-plugin && cd my-plugin
npm init -y
npm install react react-dom typescript vite @vitejs/plugin-react
npm install -D @types/react @types/react-dom
```

### 2. 项目结构

```
my-plugin/
├── src/
│   └── App.tsx          # 插件主组件
├── manifest.json        # 插件配置清单
├── vite.config.ts       # Vite 构建配置
├── tsconfig.json
└── package.json
```

### 3. 创建 manifest.json

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "description": "这是一个示例插件",
  "author": "Your Name",
  "main": "plugin.js",
  "icon": "rocket",
  "permissions": ["servers", "terminal"],
  "contributions": {
    "tools": [
      {
        "id": "my-plugin",
        "title": "我的插件",
        "icon": "rocket"
      }
    ]
  }
}
```

### 4. 编写插件代码

```tsx
// src/App.tsx
import React from 'react';

// 获取 YYShell 提供的 API
const pluginAPI = (window as any).__YYSHELL_PLUGIN__;

export default function App() {
  const [servers, setServers] = React.useState<any[]>([]);

  React.useEffect(() => {
    pluginAPI.loadServers().then(setServers);
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h1>我的插件</h1>
      <p>共有 {servers.length} 个服务器</p>
    </div>
  );
}
```

---

## 插件结构

### 必需文件

| 文件 | 说明 |
|------|------|
| `manifest.json` | 插件配置清单，定义元信息和功能 |
| `plugin.js` | 编译后的插件代码 (单文件 IIFE 格式) |

### 可选文件

| 文件 | 说明 |
|------|------|
| `README.md` | 插件说明文档 |
| `CHANGELOG.md` | 版本变更记录 |

---

## manifest.json 配置

```json
{
  "id": "plugin-id",
  "name": "插件名称",
  "version": "1.0.0",
  "description": "插件描述",
  "author": "作者名",
  "main": "plugin.js",
  "icon": "lucide-icon-name",
  "permissions": ["servers", "terminal"],
  "contributions": {
    "tools": [
      {
        "id": "tool-id",
        "title": "工具标题",
        "icon": "icon-name"
      }
    ]
  }
}
```

### 字段说明

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 唯一标识符，建议使用 kebab-case |
| `name` | string | ✅ | 显示名称 |
| `version` | string | ✅ | 语义化版本号 (SemVer) |
| `description` | string | ✅ | 简短描述 |
| `author` | string | ✅ | 作者名称 |
| `main` | string | ✅ | 入口文件路径 |
| `icon` | string | ❌ | [Lucide](https://lucide.dev/icons) 图标名 |
| `permissions` | string[] | ❌ | 所需权限列表 |
| `contributions` | object | ❌ | 插件贡献的功能 |

### 权限列表

| 权限 | 说明 |
|------|------|
| `servers` | 访问服务器列表 |
| `terminal` | 终端读写操作 |

### contributions.tools

在左侧工具栏注册工具入口：

```json
{
  "contributions": {
    "tools": [
      {
        "id": "unique-tool-id",
        "title": "显示标题",
        "icon": "lucide-icon-name"
      }
    ]
  }
}
```

---

## Plugin API 参考

插件通过全局变量 `window.__YYSHELL_PLUGIN__` 访问 API。

### 获取 API

```typescript
interface PluginAPI {
  loadServers: () => Promise<ServerConfig[]>;
  connect: (config: ConnectionConfig) => Promise<string>;
  disconnect: (id: string) => Promise<void>;
  sshExec: (id: string, command: string) => Promise<string>;
  writePty: (id: string, data: string) => Promise<void>;
  resizePty: (id: string, rows: number, cols: number) => Promise<void>;
  attachSession: (id: string, sessionType: 'screen' | 'tmux', sessionName: string) => Promise<void>;
  onTermData: (callback: (data: TermDataEvent) => void) => () => void;
  getTheme: () => 'light' | 'dark';
}

const pluginAPI = (window as any).__YYSHELL_PLUGIN__ as PluginAPI;
```

---

### loadServers()

加载所有已配置的服务器列表。

```typescript
const servers = await pluginAPI.loadServers();
// 返回: ServerConfig[]
```

**ServerConfig 结构**:
```typescript
interface ServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: 'Password' | 'Key' | 'Agent';
  tags: string[];
  group?: string;
}
```

> ⚠️ **安全说明**: `password` 字段不会返回给插件，密码通过系统密钥链安全管理。

---

### connect(config)

建立 SSH 连接，返回连接 ID。

```typescript
const connectionId = await pluginAPI.connect({
  id: 'unique-connection-id',
  host: '192.168.1.100',
  port: 22,
  user: 'root',
  serverId: 'server-uuid'  // 用于从密钥链获取密码
});
```

**参数**:
```typescript
interface ConnectionConfig {
  id: string;              // 连接唯一标识符
  host: string;            // 服务器地址
  port: number;            // SSH 端口
  user: string;            // 用户名
  auth_type?: string;      // 'Password' | 'Key' | 'Agent'
  password?: string;       // 密码 (仅用于临时连接)
  private_key_path?: string; // 私钥路径
  serverId?: string;       // 原始服务器 ID (用于密钥链查询)
}
```

---

### disconnect(id)

断开指定连接。

```typescript
await pluginAPI.disconnect(connectionId);
```

---

### sshExec(id, command)

执行 SSH 命令并返回输出。

```typescript
const output = await pluginAPI.sshExec(connectionId, 'ls -la');
console.log(output);
```

> 💡 适用于一次性命令执行，不适合交互式命令。

---

### writePty(id, data)

向 PTY 终端写入数据。

```typescript
await pluginAPI.writePty(connectionId, 'cd /var/log\n');
```

> 💡 用于交互式终端场景，需配合 `onTermData` 接收输出。

---

### resizePty(id, rows, cols)

调整 PTY 终端大小。

```typescript
await pluginAPI.resizePty(connectionId, 24, 80);
```

---

### attachSession(id, sessionType, sessionName)

附加到 screen/tmux 会话。

```typescript
// 附加到 screen 会话
await pluginAPI.attachSession(connectionId, 'screen', 'my-session');

// 附加到 tmux 会话
await pluginAPI.attachSession(connectionId, 'tmux', 'my-session');
```

---

### onTermData(callback)

监听终端数据输出。

```typescript
const unsubscribe = pluginAPI.onTermData((event) => {
  if (event.id === connectionId) {
    const bytes = new Uint8Array(event.data);
    terminal.write(bytes);
  }
});

// 清理时取消订阅
unsubscribe();
```

**事件结构**:
```typescript
interface TermDataEvent {
  id: string;     // 连接 ID
  data: number[]; // 字节数组
}
```

---

### getTheme()

获取当前主题。

```typescript
const theme = pluginAPI.getTheme();
// 返回: 'light' | 'dark'
```

---

## 终端集成

YYShell 内置 [xterm.js](https://xtermjs.org/) 终端支持。

### 使用内置 Terminal

```typescript
// 全局变量已注入
const Terminal = (window as any).Terminal;
const FitAddon = (window as any).FitAddon.FitAddon;

// 创建终端实例
const terminal = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  theme: pluginAPI.getTheme() === 'dark' 
    ? { background: '#1a1a1a' } 
    : { background: '#ffffff' }
});

const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);
terminal.open(containerElement);
fitAddon.fit();
```

### 完整终端示例

```tsx
import React, { useRef, useEffect } from 'react';

const pluginAPI = (window as any).__YYSHELL_PLUGIN__;
const Terminal = (window as any).Terminal;
const FitAddon = (window as any).FitAddon.FitAddon;

export function TerminalPanel({ serverId }: { serverId: string }) {
  const termRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<any>(null);
  const connectionIdRef = useRef<string>('');

  useEffect(() => {
    if (!termRef.current) return;

    // 初始化终端
    const term = new Terminal({ cursorBlink: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termRef.current);
    fit.fit();
    terminalRef.current = term;

    // 连接服务器
    const connId = `plugin-${Date.now()}`;
    connectionIdRef.current = connId;

    pluginAPI.connect({
      id: connId,
      host: 'server-host',
      port: 22,
      user: 'root',
      serverId: serverId
    });

    // 监听终端输出
    const unsub = pluginAPI.onTermData((e: any) => {
      if (e.id === connId) {
        term.write(new Uint8Array(e.data));
      }
    });

    // 发送用户输入
    term.onData((data: string) => {
      pluginAPI.writePty(connId, data);
    });

    return () => {
      unsub();
      pluginAPI.disconnect(connId);
      term.dispose();
    };
  }, [serverId]);

  return <div ref={termRef} style={{ height: '100%' }} />;
}
```

---

## 主题适配

### 获取主题

```typescript
const theme = pluginAPI.getTheme(); // 'light' | 'dark'
```

### CSS 变量

```css
/* 根据主题类自动切换 */
:root.dark {
  --bg-primary: #1a1a1a;
  --text-primary: #e5e5e5;
}

:root.light {
  --bg-primary: #ffffff;
  --text-primary: #1a1a1a;
}

.my-component {
  background: var(--bg-primary);
  color: var(--text-primary);
}
```

### React 中动态适配

```tsx
const theme = pluginAPI.getTheme();

return (
  <div style={{
    background: theme === 'dark' ? '#1a1a1a' : '#ffffff',
    color: theme === 'dark' ? '#e5e5e5' : '#1a1a1a'
  }}>
    内容
  </div>
);
```

---

## 构建与打包

### Vite 配置

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  build: {
    lib: {
      entry: 'src/App.tsx',
      name: 'Plugin',
      fileName: () => 'plugin.js',
      formats: ['iife']
    },
    rollupOptions: {
      external: ['react', 'react-dom'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM'
        },
        inlineDynamicImports: true
      }
    },
    cssCodeSplit: false,
    minify: true
  }
});
```

### 构建命令

```bash
npm run build
```

输出文件：`dist/plugin.js`

### 打包发布

```bash
# 创建发布包
zip -j my-plugin.zip dist/plugin.js manifest.json
```

发布包结构：
```
my-plugin.zip
├── plugin.js
└── manifest.json
```

---

## 发布插件

### GitHub 发布

1. 创建 GitHub 仓库
2. 添加 GitHub Actions 自动构建
3. 创建 Release 并上传 `.zip` 文件

### 安装方式

用户可通过以下方式安装：

**1. GitHub 安装**
```
插件中心 → 从 GitHub 安装 → 输入仓库地址
```

**2. 本地安装**
```
插件中心 → 从本地安装 → 选择 .zip 文件
```

**3. 插件市场** (官方审核)
提交到 `plugins/registry.json` 进行审核。

---

## 示例代码

### 基础插件模板

```tsx
import React, { useState, useEffect } from 'react';

const pluginAPI = (window as any).__YYSHELL_PLUGIN__;

interface Server {
  id: string;
  name: string;
  host: string;
}

export default function App() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const theme = pluginAPI.getTheme();

  useEffect(() => {
    pluginAPI.loadServers()
      .then(setServers)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div>加载中...</div>;
  }

  return (
    <div style={{
      padding: 20,
      background: theme === 'dark' ? '#1a1a1a' : '#fff',
      color: theme === 'dark' ? '#e5e5e5' : '#1a1a1a',
      minHeight: '100vh'
    }}>
      <h1>服务器列表</h1>
      <ul>
        {servers.map(s => (
          <li key={s.id}>{s.name} - {s.host}</li>
        ))}
      </ul>
    </div>
  );
}
```

### 执行命令示例

```tsx
async function getSystemInfo(serverId: string) {
  const connId = `cmd-${Date.now()}`;
  
  try {
    await pluginAPI.connect({
      id: connId,
      host: 'host',
      port: 22,
      user: 'root',
      serverId
    });
    
    const hostname = await pluginAPI.sshExec(connId, 'hostname');
    const uptime = await pluginAPI.sshExec(connId, 'uptime');
    
    return { hostname, uptime };
  } finally {
    await pluginAPI.disconnect(connId);
  }
}
```

---

## 常见问题

### Q: 如何调试插件？

在 YYShell 中打开插件后，使用 `Cmd + Option + I` (macOS) 或 `F12` 打开开发者工具。

### Q: 插件可以访问文件系统吗？

不可以。插件运行在沙箱环境中，只能通过 Plugin API 与主应用交互。

### Q: 如何获取服务器密码？

插件无法直接获取密码。使用 `serverId` 参数，密码会由主应用从系统密钥链安全获取。

---

## 参考资源

- [Lucide Icons](https://lucide.dev/icons) - 图标库
- [xterm.js](https://xtermjs.org/) - 终端库
- [Vite](https://vitejs.dev/) - 构建工具
- [会话管理器插件源码](https://github.com/MrChenYoung/yyshell-plugin-session-manager) - 官方示例

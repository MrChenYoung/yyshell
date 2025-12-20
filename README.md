# YYShell

<p align="center">
  <img src="yyshell_final_icon.png" alt="YYShell Logo" width="128" height="128">
</p>

<p align="center">
  <strong>一款现代化的 SSH 终端管理工具</strong>
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> •
  <a href="#安装">安装</a> •
  <a href="#开发">开发</a> •
  <a href="#技术栈">技术栈</a> •
  <a href="#许可证">许可证</a>
</p>

---

## 简介

YYShell 是一款基于 Tauri + React + TypeScript 开发的跨平台 SSH 终端管理工具，专为 macOS 设计。它提供了现代化的用户界面和丰富的功能，让服务器管理变得更加高效。

> ⚠️ **声明**：本项目主要使用 AI 辅助开发，作者无精力长期维护。欢迎有需要的开发者自行 Fork 修改使用。

## 功能特性

- 🖥️ **SSH 终端** - 完整的 SSH 终端功能，支持多标签页
- 📁 **SFTP 文件管理** - 可视化文件浏览、上传、下载、编辑
- 📊 **系统监控** - 实时 CPU、内存、磁盘、网络监控
- ⚡ **快捷命令** - 常用命令管理，支持分类和拖拽排序
- 📜 **命令历史** - 记录执行过的命令，方便快速执行
- 🔐 **数据备份** - 支持加密备份服务器配置和设置
- 🎨 **主题切换** - 支持深色/浅色/跟随系统主题
- 📝 **文件编辑** - 内置 Monaco 编辑器，支持语法高亮

## 安装

### 从 Release 下载

前往 [Releases](../../releases) 页面下载最新版本的 DMG 安装包。

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/YOUR_USERNAME/yyshell.git
cd yyshell

# 安装依赖
npm install

# 开发模式
npm run tauri dev

# 构建生产版本
npm run tauri build
```

## 技术栈

- **前端框架**: React 19 + TypeScript
- **桌面框架**: Tauri 2.x (Rust)
- **UI 组件**: Shadcn UI + Tailwind CSS
- **终端模拟**: xterm.js
- **代码编辑**: Monaco Editor
- **SSH 连接**: ssh2 (Rust)
- **状态管理**: Zustand

## 项目结构

```
yyshell/
├── src/                    # React 前端代码
│   ├── components/         # UI 组件
│   ├── stores/            # Zustand 状态管理
│   └── lib/               # 工具函数
├── src-tauri/             # Tauri/Rust 后端代码
│   ├── src/               # Rust 源码
│   └── Cargo.toml         # Rust 依赖配置
└── package.json           # Node.js 依赖配置
```

## 开发

### 环境要求

- Node.js 18+
- Rust 1.70+
- macOS 12+（目前仅支持 macOS）

### 开发命令

```bash
# 启动开发服务器
npm run tauri dev

# 类型检查
npm run build

# 构建生产版本
npm run tauri build
```

## 截图

*待添加*

## 贡献

由于作者无精力维护，本项目不接受 Pull Request。如有需要，请自行 Fork 修改。

## 许可证

本项目采用 [CC BY-NC-SA 4.0](LICENSE) 许可证。

- ✅ 允许个人学习和使用
- ✅ 允许 Fork 和修改
- ✅ 允许非商业性分发（需注明出处）
- ❌ **禁止商业用途**

## 致谢

- [Tauri](https://tauri.app/) - 跨平台桌面应用框架
- [Shadcn UI](https://ui.shadcn.com/) - 精美的 UI 组件
- [xterm.js](https://xtermjs.org/) - 终端模拟器

---

<p align="center">Made with ❤️ and AI</p>

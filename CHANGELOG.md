# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-12-24 🎉

### 🚀 重大更新

这是 YYShell 的首个正式版本，标志着项目的成熟！

### Added
- **插件系统** - 支持从本地、GitHub 或插件市场安装插件
- **插件 API** - 完整的插件开发接口，支持 xterm.js 终端集成
- **插件市场** - 内置官方插件市场
- **SSH 隧道** - 端口转发/隧道管理功能
- **加密备份** - 支持密码保护的服务器配置备份/恢复
- **系统密钥链** - 密码通过操作系统密钥链安全存储
- **拖拽排序** - 快捷命令和隧道分类支持拖拽排序
- **插件开发文档** - 完整的插件开发指南 (`docs/PLUGIN_DEVELOPMENT.md`)
- **CHANGELOG** - 版本变更记录

### Changed
- 项目名称统一为 `yyshell`
- 优化插件窗口加载状态，消除白屏闪烁
- 插件安全性增强：密码不再通过 URL 传递
- README.md 增加徽章和完善的多平台安装说明
- 技术栈文档完善

### Fixed
- 修复 GitHub 仓库 URL 带 `.git` 后缀的安装问题
- 移除未使用的模板代码 (`greet` 函数)

### Security
- 插件无法直接访问服务器密码，通过 serverId 从密钥链安全获取

## [0.2.0] - 2024-12-20

### Added
- SFTP 文件管理器：上传、下载、编辑文件
- 文件传输进度条显示
- 服务器端文件操作优化（cp/mv 使用 SSH 命令）
- Monaco 代码编辑器集成

### Changed
- 改进终端会话管理，支持独立会话

## [0.1.0] - 2024-12-18

### Added
- 基础 SSH 终端功能 (xterm.js)
- 多标签页终端管理
- 服务器列表管理
- 实时系统监控（CPU、内存、磁盘、网络）
- 命令历史记录
- 快捷命令管理
- 深色/浅色/跟随系统主题

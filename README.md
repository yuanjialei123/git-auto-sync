# Git 自动同步工具

定时自动提交并推送代码到远程 Git 仓库，支持 Web UI 可视化管理。

## 功能特性

- **自动同步**：按配置的时间间隔自动执行 `git add`、`commit`、`push`
- **多仓库管理**：支持同时配置和同步多个 Git 仓库
- **文件夹过滤**：可指定只同步特定文件夹，或排除特定文件类型
- **Web UI 界面**：通过浏览器可视化管理所有配置
- **开机自启动**：支持系统启动时自动运行
- **后台运行**：关闭窗口后继续运行，系统托盘图标管理
- **日志记录**：完整的同步日志，支持文件轮转

## 环境要求

- Windows 系统
- Node.js >= 14.x（需加入系统 PATH）
- Git（需加入系统 PATH）

## 快速开始

### 1. 编辑配置

打开 `config.json`，将仓库路径改为你的实际 Git 仓库路径：

```json
{
  "sync_interval_minutes": 30,
  "repositories": [
    {
      "name": "我的项目",
      "path": "D:/projects/my-repo",
      "branch": "main",
      "include_folders": ["src", "docs"],
      "exclude_patterns": ["*.log", "*.tmp", ".env"],
      "commit_message_prefix": "[Auto Sync]",
      "enabled": true
    }
  ]
}
```

### 2. 启动

**Web UI 模式（推荐）：**

```bash
git-auto-sync.exe --ui
```

自动打开浏览器访问 `http://127.0.0.1:9527`，在网页中管理所有配置。

**后台运行模式：**

```bash
git-auto-sync.exe --ui --background
```

窗口关闭后程序继续运行，系统托盘显示图标。

**命令行模式：**

```bash
git-auto-sync.exe --once        # 只执行一次同步
git-auto-sync.exe --status      # 查看仓库状态
git-auto-sync.exe               # 守护模式（定时同步）
```

## 配置说明

### config.json 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `sync_interval_minutes` | number | 同步间隔，单位分钟 |
| `repositories` | array | 仓库列表 |
| `log_file` | string | 日志文件路径 |
| `max_log_size_mb` | number | 日志文件最大大小（MB） |
| `auto_start` | boolean | 是否开机自启动 |
| `run_in_background` | boolean | 是否后台运行 |

### 仓库配置字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 仓库名称（自定义） |
| `path` | string | 仓库本地路径（必填） |
| `branch` | string | 同步的分支，默认 `main` |
| `include_folders` | array | 只同步这些文件夹，留空表示全部 |
| `exclude_patterns` | array | 排除的文件模式（如 `*.log`） |
| `commit_message_prefix` | string | 提交信息前缀 |
| `enabled` | boolean | 是否启用该仓库 |

## Web UI 界面

启动后访问 `http://127.0.0.1:9527`，包含三个功能页：

- **仓库管理**：添加、编辑、删除仓库，配置同步文件夹和排除规则
- **同步设置**：调整同步间隔、开关开机自启动和后台运行
- **运行日志**：查看同步历史和错误信息

## 项目结构

```
d:\llll\
├── git-auto-sync.exe        # 启动器程序
├── git-sync-server.js       # Web UI 服务端（API + 同步引擎）
├── git-auto-sync.js         # 命令行版本
├── config.json              # 配置文件
├── GitAutoSyncLauncher.cs   # C# 启动器源码
├── build-ui.js              # 编译脚本
├── package.json             # 项目配置
└── dist/                    # 发布目录（exe + js + config）
```

## 编译

如需重新编译 exe：

```bash
node build-ui.js
```

编译后的文件输出到 `dist/` 目录。发布时需要将以下文件放在同一目录：

- `git-auto-sync.exe`
- `git-sync-server.js`
- `git-auto-sync.js`
- `config.json`

## 命令行参数

| 参数 | 说明 |
|------|------|
| `--ui` | 启动 Web UI 界面 |
| `--background` | 后台运行（系统托盘） |
| `--once` | 只执行一次同步后退出 |
| `--status` | 查看所有仓库状态 |
| `--no-browser` | 启动 UI 时不自动打开浏览器 |
| `--config <path>` | 指定配置文件路径 |
| `--interval <min>` | 覆盖同步间隔（分钟） |
| `--help` | 显示帮助信息 |

## 常见问题

**Q: exe 运行提示找不到 node.exe？**
A: 确保 Node.js 已安装并添加到系统 PATH 环境变量中。

**Q: 同步提示"不是有效的 Git 仓库"？**
A: 检查 `config.json` 中的 `path` 是否指向一个实际的 Git 仓库目录（需已执行 `git init`）。

**Q: 推送失败？**
A: 检查远程仓库地址配置、网络连通性，以及 Git 凭据是否已配置。

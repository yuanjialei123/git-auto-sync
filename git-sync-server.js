#!/usr/bin/env node
/**
 * Git 自动同步工具 - Web UI 版本
 * 功能：
 * 1. Web UI 配置界面
 * 2. 自动同步 Git 仓库
 * 3. 开机自启动
 * 4. 后台运行（最小化到系统托盘）
 */

const http = require('http');
const { execSync, execFileSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ==================== 全局状态 ====================
const APP_DIR = path.dirname(process.argv[1]);
const CONFIG_FILE = path.join(APP_DIR, 'config.json');
const LOG_FILE = path.join(APP_DIR, 'git_auto_sync.log');
let syncTimer = null;
let isRunning = false;
let syncLog = [];

// ==================== 配置管理 ====================
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('加载配置失败:', e.message);
  }
  return {
    sync_interval_minutes: 30,
    repositories: [],
    log_file: 'git_auto_sync.log',
    max_log_size_mb: 10,
    auto_start: false,
    run_in_background: false
  };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

function addLog(level, message) {
  const timestamp = new Date().toLocaleString('zh-CN', { hour12: false });
  const entry = { time: timestamp, level, message };
  syncLog.unshift(entry);
  if (syncLog.length > 100) syncLog.pop();
  
  const line = `[${timestamp}] [${level}] ${message}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
  } catch (e) {}
  console.log(line.trim());
}

// ==================== Git 操作 ====================
function runGit(repoPath, args) {
  try {
    const result = execFileSync('git', args, {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { success: true, stdout: result.trim() };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : '';
    return { success: false, stderr };
  }
}

function syncRepo(repo) {
  if (!repo.enabled) return { success: false, message: '已禁用' };
  if (!repo.path || !fs.existsSync(repo.path)) {
    return { success: false, message: '路径不存在' };
  }

  // 检查是否为 git 仓库
  const isRepo = runGit(repo.path, ['rev-parse', '--is-inside-work-tree']);
  if (!isRepo.success) return { success: false, message: '不是有效的 Git 仓库' };

  // 切换分支
  const branch = repo.branch || 'main';
  runGit(repo.path, ['checkout', branch]);

  // 拉取远程更改
  runGit(repo.path, ['pull', '--rebase', 'origin', branch]);

  // 检查更改
  const status = runGit(repo.path, ['status', '--porcelain']);
  if (!status.success || !status.stdout) {
    return { success: true, message: '没有需要同步的更改' };
  }

  // 添加文件
  const folders = repo.include_folders || [];
  if (folders.length > 0) {
    for (const folder of folders) {
      const folderPath = path.join(repo.path, folder);
      if (fs.existsSync(folderPath)) {
        runGit(repo.path, ['add', folder]);
      }
    }
  } else {
    runGit(repo.path, ['add', '-A']);
  }

  // 排除文件
  const excludes = repo.exclude_patterns || [];
  for (const pattern of excludes) {
    runGit(repo.path, ['reset', 'HEAD', '--', pattern]);
  }

  // 检查暂存区
  const staged = runGit(repo.path, ['status', '--porcelain']);
  if (!staged.success || !staged.stdout) {
    return { success: true, message: '过滤后没有更改' };
  }

  // 提交
  const timestamp = new Date().toLocaleString('zh-CN', { hour12: false });
  const prefix = repo.commit_message_prefix || '[Auto Sync]';
  const count = staged.stdout.split('\n').length;
  const message = `${prefix} ${timestamp} - ${count} 个文件变更`;

  const commit = runGit(repo.path, ['commit', '-m', message]);
  if (!commit.success) return { success: false, message: '提交失败' };

  // 推送
  const push = runGit(repo.path, ['push', 'origin', branch]);
  if (!push.success) return { success: false, message: '推送失败: ' + push.stderr };

  return { success: true, message: `同步成功: ${count} 个文件` };
}

function syncAll() {
  if (isRunning) {
    addLog('WARN', '上一次同步还在进行中');
    return;
  }
  
  isRunning = true;
  const config = loadConfig();
  addLog('INFO', '开始同步所有仓库...');

  let success = 0, fail = 0;
  for (const repo of config.repositories || []) {
    const result = syncRepo(repo);
    if (result.success) {
      addLog('INFO', `[${repo.name}] ${result.message}`);
      success++;
    } else {
      addLog('ERROR', `[${repo.name}] ${result.message}`);
      fail++;
    }
  }

  addLog('INFO', `同步完成: 成功 ${success}, 失败 ${fail}`);
  isRunning = false;
}

function startSyncTimer() {
  if (syncTimer) clearInterval(syncTimer);
  
  const config = loadConfig();
  const interval = (config.sync_interval_minutes || 30) * 60 * 1000;
  
  addLog('INFO', `启动定时同步，间隔 ${config.sync_interval_minutes || 30} 分钟`);
  syncAll(); // 立即同步一次
  
  syncTimer = setInterval(() => {
    syncAll();
  }, interval);
}

function stopSyncTimer() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    addLog('INFO', '已停止定时同步');
  }
}

// ==================== 开机自启动 ====================
function getAutoStartKey() {
  return 'GitAutoSync';
}

function getAutoStartCommand() {
  const exePath = path.join(APP_DIR, 'git-auto-sync.exe');
  return `"${exePath}" --ui --background`;
}

function checkAutoStart() {
  try {
    const result = execSync(
      `reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v ${getAutoStartKey()}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return result.includes('git-auto-sync');
  } catch {
    return false;
  }
}

function enableAutoStart() {
  try {
    const cmd = getAutoStartCommand();
    execSync(
      `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v ${getAutoStartKey()} /t REG_SZ /d "${cmd}" /f`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    addLog('INFO', '已启用开机自启动');
    return true;
  } catch (e) {
    addLog('ERROR', '启用开机自启动失败: ' + e.message);
    return false;
  }
}

function disableAutoStart() {
  try {
    execSync(
      `reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v ${getAutoStartKey()} /f`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    addLog('INFO', '已禁用开机自启动');
    return true;
  } catch (e) {
    addLog('ERROR', '禁用开机自启动失败: ' + e.message);
    return false;
  }
}

// ==================== HTTP 服务器 ====================
function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function handleApi(req, res, url) {
  const method = req.method;

  // GET /api/config
  if (url === '/api/config' && method === 'GET') {
    const config = loadConfig();
    config.auto_start = checkAutoStart();
    return sendJson(res, config);
  }

  // PUT /api/config
  if (url === '/api/config' && method === 'PUT') {
    const body = await parseBody(req);
    const config = loadConfig();
    
    if (body.sync_interval_minutes !== undefined) {
      config.sync_interval_minutes = parseInt(body.sync_interval_minutes) || 30;
    }
    if (body.auto_start !== undefined) {
      if (body.auto_start) enableAutoStart();
      else disableAutoStart();
    }
    if (body.run_in_background !== undefined) {
      config.run_in_background = body.run_in_background;
    }
    
    saveConfig(config);
    startSyncTimer(); // 重新启动定时器
    return sendJson(res, { success: true, config });
  }

  // POST /api/repo/add
  if (url === '/api/repo/add' && method === 'POST') {
    const body = await parseBody(req);
    const config = loadConfig();
    
    const newRepo = {
      name: body.name || '新仓库',
      path: body.path || '',
      branch: body.branch || 'main',
      include_folders: body.include_folders || [],
      exclude_patterns: body.exclude_patterns || [],
      commit_message_prefix: body.commit_message_prefix || '[Auto Sync]',
      enabled: body.enabled !== false
    };
    
    config.repositories = config.repositories || [];
    config.repositories.push(newRepo);
    saveConfig(config);
    
    addLog('INFO', `添加仓库: ${newRepo.name}`);
    return sendJson(res, { success: true, repo: newRepo });
  }

  // PUT /api/repo/:index
  const repoMatch = url.match(/^\/api\/repo\/(\d+)$/);
  if (repoMatch && method === 'PUT') {
    const index = parseInt(repoMatch[1]);
    const body = await parseBody(req);
    const config = loadConfig();
    
    if (config.repositories && config.repositories[index]) {
      Object.assign(config.repositories[index], body);
      saveConfig(config);
      addLog('INFO', `更新仓库: ${config.repositories[index].name}`);
      return sendJson(res, { success: true });
    }
    return sendJson(res, { success: false, message: '仓库不存在' }, 404);
  }

  // DELETE /api/repo/:index
  if (repoMatch && method === 'DELETE') {
    const index = parseInt(repoMatch[1]);
    const config = loadConfig();
    
    if (config.repositories && config.repositories[index]) {
      const name = config.repositories[index].name;
      config.repositories.splice(index, 1);
      saveConfig(config);
      addLog('INFO', `删除仓库: ${name}`);
      return sendJson(res, { success: true });
    }
    return sendJson(res, { success: false, message: '仓库不存在' }, 404);
  }

  // POST /api/sync
  if (url === '/api/sync' && method === 'POST') {
    syncAll();
    return sendJson(res, { success: true });
  }

  // GET /api/status
  if (url === '/api/status' && method === 'GET') {
    const config = loadConfig();
    const repos = (config.repositories || []).map(repo => {
      const info = { ...repo };
      if (repo.path && fs.existsSync(repo.path)) {
        const branch = runGit(repo.path, ['rev-parse', '--abbrev-ref', 'HEAD']);
        const status = runGit(repo.path, ['status', '--porcelain']);
        info.current_branch = branch.success ? branch.stdout : '未知';
        info.has_changes = status.success && status.stdout.length > 0;
        info.changes_count = status.success ? status.stdout.split('\n').filter(l => l).length : 0;
      } else {
        info.current_branch = '不可用';
        info.has_changes = false;
      }
      return info;
    });
    
    return sendJson(res, {
      is_running: isRunning,
      sync_running: syncTimer !== null,
      repos,
      auto_start: checkAutoStart()
    });
  }

  // GET /api/logs
  if (url === '/api/logs' && method === 'GET') {
    return sendJson(res, syncLog.slice(0, 50));
  }

  sendJson(res, { error: 'Not Found' }, 404);
}

function serveUI(res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(getHtmlContent());
}

// ==================== 启动服务器 ====================
const PORT = process.env.GIT_SYNC_PORT || 9527;

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/' || url === '/index.html') {
    return serveUI(res);
  }

  if (url.startsWith('/api/')) {
    return handleApi(req, res, url);
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, '127.0.0.1', () => {
  addLog('INFO', `Git 自动同步工具 UI 已启动: http://127.0.0.1:${PORT}`);
  
  // 启动同步
  startSyncTimer();
  
  // 自动打开浏览器
  const args = process.argv.slice(2);
  if (!args.includes('--no-browser')) {
    setTimeout(() => {
      try {
        exec(`start http://127.0.0.1:${PORT}`);
      } catch (e) {}
    }, 500);
  }
});

// 优雅退出
process.on('SIGINT', () => {
  addLog('INFO', '正在停止...');
  stopSyncTimer();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopSyncTimer();
  server.close();
  process.exit(0);
});

// ==================== HTML UI ====================
function getHtmlContent() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Git 自动同步工具</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    :root {
      --primary: #4f46e5;
      --primary-hover: #4338ca;
      --success: #10b981;
      --danger: #ef4444;
      --warning: #f59e0b;
      --bg: #f8fafc;
      --card: #ffffff;
      --border: #e2e8f0;
      --text: #1e293b;
      --text-secondary: #64748b;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
    }

    .header {
      background: linear-gradient(135deg, var(--primary), #7c3aed);
      color: white;
      padding: 20px 30px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }

    .header h1 { font-size: 24px; font-weight: 600; }
    .header p { opacity: 0.9; font-size: 14px; margin-top: 4px; }

    .container {
      max-width: 1100px;
      margin: 0 auto;
      padding: 24px;
    }

    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 24px;
      background: var(--card);
      padding: 6px;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }

    .tab {
      flex: 1;
      padding: 12px 20px;
      border: none;
      background: transparent;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      color: var(--text-secondary);
      transition: all 0.2s;
    }

    .tab:hover { background: var(--bg); }
    .tab.active {
      background: var(--primary);
      color: white;
      box-shadow: 0 2px 8px rgba(79, 70, 229, 0.3);
    }

    .panel { display: none; }
    .panel.active { display: block; }

    .card {
      background: var(--card);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      border: 1px solid var(--border);
    }

    .card h3 {
      font-size: 16px;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .form-row {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
      align-items: flex-end;
    }

    .form-group {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .form-group label {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }

    .form-group input, .form-group select {
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 14px;
      transition: border-color 0.2s;
      outline: none;
    }

    .form-group input:focus, .form-group select:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
    }

    .btn {
      padding: 10px 20px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .btn-primary {
      background: var(--primary);
      color: white;
    }
    .btn-primary:hover { background: var(--primary-hover); }

    .btn-success {
      background: var(--success);
      color: white;
    }
    .btn-success:hover { background: #059669; }

    .btn-danger {
      background: var(--danger);
      color: white;
    }
    .btn-danger:hover { background: #dc2626; }

    .btn-outline {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text);
    }
    .btn-outline:hover { background: var(--bg); }

    .btn-sm { padding: 6px 12px; font-size: 13px; }

    .toggle-container {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 0;
      border-bottom: 1px solid var(--border);
    }

    .toggle-container:last-child { border-bottom: none; }

    .toggle-info h4 { font-size: 15px; font-weight: 500; }
    .toggle-info p { font-size: 13px; color: var(--text-secondary); margin-top: 2px; }

    .toggle {
      position: relative;
      width: 48px;
      height: 26px;
    }

    .toggle input { opacity: 0; width: 0; height: 0; }

    .toggle-slider {
      position: absolute;
      cursor: pointer;
      inset: 0;
      background: #cbd5e1;
      border-radius: 26px;
      transition: 0.3s;
    }

    .toggle-slider:before {
      content: "";
      position: absolute;
      height: 20px;
      width: 20px;
      left: 3px;
      bottom: 3px;
      background: white;
      border-radius: 50%;
      transition: 0.3s;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }

    .toggle input:checked + .toggle-slider { background: var(--primary); }
    .toggle input:checked + .toggle-slider:before { transform: translateX(22px); }

    .repo-list { display: flex; flex-direction: column; gap: 12px; }

    .repo-item {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
      transition: all 0.2s;
    }

    .repo-item:hover { border-color: var(--primary); box-shadow: 0 2px 8px rgba(0,0,0,0.06); }

    .repo-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .repo-name {
      font-weight: 600;
      font-size: 15px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .repo-status {
      font-size: 12px;
      padding: 3px 10px;
      border-radius: 20px;
      font-weight: 500;
    }

    .status-enabled { background: #dcfce7; color: #166534; }
    .status-disabled { background: #fee2e2; color: #991b1b; }

    .repo-details {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      font-size: 13px;
      color: var(--text-secondary);
    }

    .repo-details span { display: flex; align-items: center; gap: 4px; }

    .repo-actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
    }

    .log-list {
      max-height: 400px;
      overflow-y: auto;
      font-family: "Cascadia Code", "Fira Code", monospace;
      font-size: 13px;
    }

    .log-entry {
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      display: flex;
      gap: 12px;
    }

    .log-entry:last-child { border-bottom: none; }
    .log-time { color: var(--text-secondary); white-space: nowrap; }
    .log-level {
      font-weight: 600;
      padding: 1px 8px;
      border-radius: 4px;
      font-size: 11px;
    }
    .log-INFO { background: #dbeafe; color: #1e40af; }
    .log-WARN { background: #fef3c7; color: #92400e; }
    .log-ERROR { background: #fee2e2; color: #991b1b; }

    .empty-state {
      text-align: center;
      padding: 48px 20px;
      color: var(--text-secondary);
    }

    .empty-state svg { width: 64px; height: 64px; margin-bottom: 16px; opacity: 0.5; }
    .empty-state h3 { font-size: 18px; margin-bottom: 8px; color: var(--text); }

    .status-bar {
      display: flex;
      gap: 20px;
      margin-bottom: 20px;
    }

    .status-card {
      flex: 1;
      background: var(--card);
      border-radius: 10px;
      padding: 16px 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      border: 1px solid var(--border);
    }

    .status-card .label {
      font-size: 12px;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .status-card .value {
      font-size: 22px;
      font-weight: 700;
      margin-top: 4px;
    }

    .status-card .value.running { color: var(--success); }
    .status-card .value.stopped { color: var(--text-secondary); }

    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .modal-overlay.active { display: flex; }

    .modal {
      background: var(--card);
      border-radius: 16px;
      padding: 28px;
      width: 90%;
      max-width: 520px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.2);
    }

    .modal h3 { font-size: 18px; margin-bottom: 20px; }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 24px;
    }

    .folder-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }

    .folder-tag {
      background: var(--bg);
      border: 1px solid var(--border);
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .folder-tag .remove {
      cursor: pointer;
      color: var(--danger);
      font-weight: bold;
    }

    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--text);
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.3s;
      z-index: 2000;
    }

    .toast.show { transform: translateY(0); opacity: 1; }
    .toast.success { background: var(--success); }
    .toast.error { background: var(--danger); }
  </style>
</head>
<body>
  <div class="header">
    <h1>Git 自动同步工具</h1>
    <p>定时自动提交并推送代码到远程仓库</p>
  </div>

  <div class="container">
    <div class="status-bar">
      <div class="status-card">
        <div class="label">同步状态</div>
        <div class="value" id="syncStatus">检测中...</div>
      </div>
      <div class="status-card">
        <div class="label">仓库数量</div>
        <div class="value" id="repoCount">0</div>
      </div>
      <div class="status-card">
        <div class="label">同步间隔</div>
        <div class="value" id="intervalDisplay">30分钟</div>
      </div>
      <div class="status-card">
        <div class="label">下次同步</div>
        <div class="value" id="nextSync" style="font-size:16px">--</div>
      </div>
    </div>

    <div class="tabs">
      <button class="tab active" onclick="switchTab('repos')">仓库管理</button>
      <button class="tab" onclick="switchTab('settings')">同步设置</button>
      <button class="tab" onclick="switchTab('logs')">运行日志</button>
    </div>

    <!-- 仓库管理面板 -->
    <div id="panel-repos" class="panel active">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3>我的仓库</h3>
          <div style="display:flex;gap:8px">
            <button class="btn btn-success btn-sm" onclick="syncNow()">立即同步</button>
            <button class="btn btn-primary btn-sm" onclick="showAddRepoModal()">添加仓库</button>
          </div>
        </div>
        <div id="repoList" class="repo-list"></div>
      </div>
    </div>

    <!-- 设置面板 -->
    <div id="panel-settings" class="panel">
      <div class="card">
        <h3>同步设置</h3>
        <div class="form-row">
          <div class="form-group">
            <label>同步间隔（分钟）</label>
            <input type="number" id="syncInterval" min="1" max="1440" value="30" 
                   onchange="updateInterval()">
          </div>
          <div class="form-group">
            <label>默认提交信息前缀</label>
            <input type="text" id="commitPrefix" value="[Auto Sync]" 
                   onchange="updateConfig()">
          </div>
        </div>
      </div>

      <div class="card">
        <h3>系统设置</h3>
        <div class="toggle-container">
          <div class="toggle-info">
            <h4>开机自启动</h4>
            <p>系统启动时自动运行同步工具</p>
          </div>
          <label class="toggle">
            <input type="checkbox" id="autoStart" onchange="toggleAutoStart()">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="toggle-container">
          <div class="toggle-info">
            <h4>后台运行</h4>
            <p>关闭窗口后继续在后台运行</p>
          </div>
          <label class="toggle">
            <input type="checkbox" id="runBackground" onchange="toggleBackground()">
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    </div>

    <!-- 日志面板 -->
    <div id="panel-logs" class="panel">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3>运行日志</h3>
          <button class="btn btn-outline btn-sm" onclick="loadLogs()">刷新</button>
        </div>
        <div id="logList" class="log-list"></div>
      </div>
    </div>
  </div>

  <!-- 添加仓库弹窗 -->
  <div class="modal-overlay" id="addRepoModal">
    <div class="modal">
      <h3 id="modalTitle">添加仓库</h3>
      <input type="hidden" id="editRepoIndex" value="-1">
      <div class="form-group" style="margin-bottom:12px">
        <label>仓库名称</label>
        <input type="text" id="repoName" placeholder="例如：我的项目">
      </div>
      <div class="form-group" style="margin-bottom:12px">
        <label>仓库路径</label>
        <input type="text" id="repoPath" placeholder="例如：D:/projects/my-repo">
      </div>
      <div class="form-row" style="margin-bottom:12px">
        <div class="form-group">
          <label>同步分支</label>
          <input type="text" id="repoBranch" value="main">
        </div>
        <div class="form-group">
          <label>提交信息前缀</label>
          <input type="text" id="repoPrefix" value="[Auto Sync]">
        </div>
      </div>
      <div class="form-group" style="margin-bottom:12px">
        <label>同步文件夹（留空表示全部，回车添加）</label>
        <input type="text" id="folderInput" placeholder="输入文件夹名称后按回车"
               onkeydown="if(event.key==='Enter'){addFolder();event.preventDefault();}">
        <div id="folderTags" class="folder-tags"></div>
      </div>
      <div class="form-group" style="margin-bottom:12px">
        <label>排除模式（留空表示无，回车添加）</label>
        <input type="text" id="excludeInput" placeholder="例如：*.log"
               onkeydown="if(event.key==='Enter'){addExclude();event.preventDefault();}">
        <div id="excludeTags" class="folder-tags"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="saveRepo()">保存</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    let config = {};
    let tempFolders = [];
    let tempExcludes = [];

    // 初始化
    document.addEventListener('DOMContentLoaded', () => {
      loadConfig();
      setInterval(loadStatus, 5000);
    });

    // 切换标签页
    function switchTab(name) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById('panel-' + name).classList.add('active');
      
      if (name === 'logs') loadLogs();
    }

    // 加载配置
    async function loadConfig() {
      const res = await fetch('/api/config');
      config = await res.json();
      
      document.getElementById('syncInterval').value = config.sync_interval_minutes || 30;
      document.getElementById('intervalDisplay').textContent = (config.sync_interval_minutes || 30) + '分钟';
      document.getElementById('autoStart').checked = config.auto_start || false;
      document.getElementById('runBackground').checked = config.run_in_background || false;
      
      renderRepos();
      loadStatus();
    }

    // 加载状态
    async function loadStatus() {
      const res = await fetch('/api/status');
      const data = await res.json();
      
      const statusEl = document.getElementById('syncStatus');
      if (data.sync_running) {
        statusEl.textContent = '运行中';
        statusEl.className = 'value running';
      } else {
        statusEl.textContent = '已停止';
        statusEl.className = 'value stopped';
      }
      
      document.getElementById('repoCount').textContent = data.repos.length;
    }

    // 渲染仓库列表
    function renderRepos() {
      const list = document.getElementById('repoList');
      const repos = config.repositories || [];
      
      if (repos.length === 0) {
        list.innerHTML = \`
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
            </svg>
            <h3>暂无仓库</h3>
            <p>点击"添加仓库"按钮来配置你的第一个 Git 仓库</p>
          </div>
        \`;
        return;
      }
      
      list.innerHTML = repos.map((repo, i) => \`
        <div class="repo-item">
          <div class="repo-header">
            <div class="repo-name">
              \${repo.enabled ? '📁' : '📂'} \${repo.name}
              <span class="repo-status \${repo.enabled ? 'status-enabled' : 'status-disabled'}">
                \${repo.enabled ? '已启用' : '已禁用'}
              </span>
            </div>
          </div>
          <div class="repo-details">
            <span>📍 \${repo.path || '未设置路径'}</span>
            <span>🌿 分支: \${repo.branch || 'main'}</span>
            <span>📁 文件夹: \${(repo.include_folders || []).length > 0 ? repo.include_folders.join(', ') : '全部'}</span>
            <span>🚫 排除: \${(repo.exclude_patterns || []).length > 0 ? repo.exclude_patterns.join(', ') : '无'}</span>
          </div>
          <div class="repo-actions">
            <button class="btn btn-outline btn-sm" onclick="editRepo(\${i})">编辑</button>
            <button class="btn btn-outline btn-sm" onclick="toggleRepo(\${i})">
              \${repo.enabled ? '禁用' : '启用'}
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteRepo(\${i})">删除</button>
          </div>
        </div>
      \`).join('');
    }

    // 显示添加仓库弹窗
    function showAddRepoModal() {
      document.getElementById('modalTitle').textContent = '添加仓库';
      document.getElementById('editRepoIndex').value = -1;
      document.getElementById('repoName').value = '';
      document.getElementById('repoPath').value = '';
      document.getElementById('repoBranch').value = 'main';
      document.getElementById('repoPrefix').value = '[Auto Sync]';
      tempFolders = [];
      tempExcludes = [];
      renderFolderTags();
      renderExcludeTags();
      document.getElementById('addRepoModal').classList.add('active');
    }

    // 编辑仓库
    function editRepo(index) {
      const repo = config.repositories[index];
      document.getElementById('modalTitle').textContent = '编辑仓库';
      document.getElementById('editRepoIndex').value = index;
      document.getElementById('repoName').value = repo.name;
      document.getElementById('repoPath').value = repo.path;
      document.getElementById('repoBranch').value = repo.branch || 'main';
      document.getElementById('repoPrefix').value = repo.commit_message_prefix || '[Auto Sync]';
      tempFolders = [...(repo.include_folders || [])];
      tempExcludes = [...(repo.exclude_patterns || [])];
      renderFolderTags();
      renderExcludeTags();
      document.getElementById('addRepoModal').classList.add('active');
    }

    function closeModal() {
      document.getElementById('addRepoModal').classList.remove('active');
    }

    // 添加文件夹
    function addFolder() {
      const input = document.getElementById('folderInput');
      const val = input.value.trim();
      if (val && !tempFolders.includes(val)) {
        tempFolders.push(val);
        renderFolderTags();
      }
      input.value = '';
    }

    function removeFolder(index) {
      tempFolders.splice(index, 1);
      renderFolderTags();
    }

    function renderFolderTags() {
      document.getElementById('folderTags').innerHTML = tempFolders.map((f, i) => \`
        <span class="folder-tag">\${f} <span class="remove" onclick="removeFolder(\${i})">×</span></span>
      \`).join('');
    }

    // 添加排除模式
    function addExclude() {
      const input = document.getElementById('excludeInput');
      const val = input.value.trim();
      if (val && !tempExcludes.includes(val)) {
        tempExcludes.push(val);
        renderExcludeTags();
      }
      input.value = '';
    }

    function removeExclude(index) {
      tempExcludes.splice(index, 1);
      renderExcludeTags();
    }

    function renderExcludeTags() {
      document.getElementById('excludeTags').innerHTML = tempExcludes.map((e, i) => \`
        <span class="folder-tag">\${e} <span class="remove" onclick="removeExclude(\${i})">×</span></span>
      \`).join('');
    }

    // 保存仓库
    async function saveRepo() {
      const index = parseInt(document.getElementById('editRepoIndex').value);
      const data = {
        name: document.getElementById('repoName').value.trim(),
        path: document.getElementById('repoPath').value.trim(),
        branch: document.getElementById('repoBranch').value.trim() || 'main',
        commit_message_prefix: document.getElementById('repoPrefix').value.trim() || '[Auto Sync]',
        include_folders: tempFolders,
        exclude_patterns: tempExcludes,
        enabled: true
      };

      if (!data.name || !data.path) {
        showToast('请填写仓库名称和路径', 'error');
        return;
      }

      if (index >= 0) {
        await fetch('/api/repo/' + index, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        showToast('仓库已更新', 'success');
      } else {
        await fetch('/api/repo/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        showToast('仓库已添加', 'success');
      }

      closeModal();
      loadConfig();
    }

    // 删除仓库
    async function deleteRepo(index) {
      if (!confirm('确定要删除这个仓库吗？')) return;
      
      await fetch('/api/repo/' + index, { method: 'DELETE' });
      showToast('仓库已删除', 'success');
      loadConfig();
    }

    // 切换仓库启用状态
    async function toggleRepo(index) {
      const repo = config.repositories[index];
      await fetch('/api/repo/' + index, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !repo.enabled })
      });
      loadConfig();
    }

    // 立即同步
    async function syncNow() {
      showToast('正在同步...', 'success');
      await fetch('/api/sync', { method: 'POST' });
      setTimeout(loadLogs, 2000);
    }

    // 更新同步间隔
    async function updateInterval() {
      const val = document.getElementById('syncInterval').value;
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sync_interval_minutes: parseInt(val) })
      });
      document.getElementById('intervalDisplay').textContent = val + '分钟';
      showToast('同步间隔已更新', 'success');
    }

    // 更新配置
    async function updateConfig() {
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
    }

    // 切换开机自启动
    async function toggleAutoStart() {
      const val = document.getElementById('autoStart').checked;
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_start: val })
      });
      showToast(val ? '已启用开机自启动' : '已禁用开机自启动', 'success');
    }

    // 切换后台运行
    async function toggleBackground() {
      const val = document.getElementById('runBackground').checked;
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_in_background: val })
      });
      showToast(val ? '已启用后台运行' : '已禁用后台运行', 'success');
    }

    // 加载日志
    async function loadLogs() {
      const res = await fetch('/api/logs');
      const logs = await res.json();
      const list = document.getElementById('logList');
      
      if (logs.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>暂无日志</p></div>';
        return;
      }
      
      list.innerHTML = logs.map(log => \`
        <div class="log-entry">
          <span class="log-time">\${log.time}</span>
          <span class="log-level log-\${log.level}">\${log.level}</span>
          <span>\${log.message}</span>
        </div>
      \`).join('');
    }

    // Toast 提示
    function showToast(msg, type = '') {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.className = 'toast show ' + type;
      setTimeout(() => toast.className = 'toast', 3000);
    }
  </script>
</body>
</html>`;
}

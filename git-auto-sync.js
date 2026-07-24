#!/usr/bin/env node
/**
 * Git 自动同步工具
 * 功能：
 * 1. 自动同步指定的 Git 仓库
 * 2. 可配置同步的文件夹
 * 3. 可配置自动同步时间间隔
 * 4. 支持 include/exclude 规则
 * 5. 完整的日志记录
 * 6. 支持热更新配置
 */

const { execSync, execFileSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// ==================== 日志系统 ====================
class Logger {
  constructor(logFile, maxSizeMB = 10) {
    this.logFile = path.resolve(logFile);
    this.maxSize = maxSizeMB * 1024 * 1024;
    this._ensureLogFile();
  }

  _ensureLogFile() {
    const dir = path.dirname(this.logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.logFile)) {
      fs.writeFileSync(this.logFile, '', 'utf-8');
    }
  }

  _rotate() {
    try {
      const stats = fs.statSync(this.logFile);
      if (stats.size > this.maxSize) {
        const backup = this.logFile + '.1';
        if (fs.existsSync(backup)) fs.unlinkSync(backup);
        fs.renameSync(this.logFile, backup);
        fs.writeFileSync(this.logFile, '', 'utf-8');
      }
    } catch (e) {
      // 忽略轮转错误
    }
  }

  _log(level, message) {
    const timestamp = new Date().toLocaleString('zh-CN', { hour12: false });
    const line = `[${timestamp}] [${level}] ${message}`;
    console.log(line);
    try {
      this._rotate();
      fs.appendFileSync(this.logFile, line + '\n', 'utf-8');
    } catch (e) {
      // 忽略文件写入错误
    }
  }

  info(msg) { this._log('INFO', msg); }
  warn(msg) { this._log('WARN', msg); }
  error(msg) { this._log('ERROR', msg); }
  debug(msg) { this._log('DEBUG', msg); }
}

// ==================== Git 操作 ====================
class GitOperator {
  constructor(repoPath, logger) {
    this.repoPath = path.resolve(repoPath);
    this.logger = logger;
  }

  _run(args) {
    this.logger.debug(`执行: git ${args.join(' ')} (目录: ${this.repoPath})`);
    try {
      const result = execFileSync('git', args, {
        cwd: this.repoPath,
        encoding: 'utf-8',
        timeout: 120000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return { success: true, stdout: result.trim(), stderr: '' };
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString().trim() : '';
      const stdout = err.stdout ? err.stdout.toString().trim() : '';
      this.logger.error(`Git 命令失败: ${cmd}`);
      if (stderr) this.logger.error(`错误: ${stderr}`);
      return { success: false, stdout, stderr };
    }
  }

  isGitRepo() {
    const result = this._run(['rev-parse', '--is-inside-work-tree']);
    return result.success;
  }

  getCurrentBranch() {
    const result = this._run(['rev-parse', '--abbrev-ref', 'HEAD']);
    return result.success ? result.stdout : null;
  }

  checkoutBranch(branch) {
    const current = this.getCurrentBranch();
    if (current === branch) return true;
    const result = this._run(['checkout', branch]);
    if (!result.success) {
      this.logger.error(`切换分支失败: ${branch}`);
      return false;
    }
    return true;
  }

  getStatus() {
    const result = this._run(['status', '--porcelain']);
    return result.success ? result.stdout : '';
  }

  hasChanges() {
    return this.getStatus().length > 0;
  }

  addFiles(folders, excludePatterns) {
    if (folders && folders.length > 0) {
      for (const folder of folders) {
        const folderPath = path.join(this.repoPath, folder);
        if (fs.existsSync(folderPath)) {
          const result = this._run(['add', folder]);
          if (!result.success) {
            this.logger.warn(`添加文件夹失败: ${folder}`);
          }
        } else {
          this.logger.warn(`文件夹不存在，跳过: ${folder}`);
        }
      }
    } else {
      const result = this._run(['add', '-A']);
      if (!result.success) return false;
    }

    // 处理 exclude 模式
    if (excludePatterns && excludePatterns.length > 0) {
      for (const pattern of excludePatterns) {
        this._run(['reset', 'HEAD', '--', pattern]);
      }
    }
    return true;
  }

  commit(message) {
    const result = this._run(['commit', '-m', message]);
    return result.success;
  }

  push(branch) {
    const args = branch ? ['push', 'origin', branch] : ['push'];
    const result = this._run(args);
    if (!result.success) {
      this.logger.error(`推送失败: ${result.stderr}`);
    }
    return result.success;
  }

  pull(branch) {
    const args = branch ? ['pull', '--rebase', 'origin', branch] : ['pull', '--rebase'];
    const result = this._run(args);
    if (!result.success) {
      this.logger.warn(`拉取失败: ${result.stderr}`);
    }
    return result.success;
  }
}

// ==================== 仓库同步器 ====================
class RepoSyncer {
  constructor(config, logger) {
    this.name = config.name || '未命名仓库';
    this.repoPath = config.path || '';
    this.branch = config.branch || 'main';
    this.includeFolders = config.include_folders || [];
    this.excludePatterns = config.exclude_patterns || [];
    this.commitPrefix = config.commit_message_prefix || '[Auto Sync]';
    this.enabled = config.enabled !== false;
    this.logger = logger;
    this.git = this.repoPath ? new GitOperator(this.repoPath, logger) : null;
  }

  validate() {
    if (!this.enabled) {
      this.logger.info(`[${this.name}] 已禁用，跳过`);
      return false;
    }
    if (!this.repoPath) {
      this.logger.error(`[${this.name}] 未配置仓库路径`);
      return false;
    }
    if (!fs.existsSync(this.repoPath)) {
      this.logger.error(`[${this.name}] 仓库路径不存在: ${this.repoPath}`);
      return false;
    }
    if (!this.git.isGitRepo()) {
      this.logger.error(`[${this.name}] 不是有效的 Git 仓库: ${this.repoPath}`);
      return false;
    }
    return true;
  }

  sync() {
    this.logger.info(`[${this.name}] 开始同步...`);

    if (!this.validate()) return false;

    // 切换分支
    if (!this.git.checkoutBranch(this.branch)) return false;

    // 先拉取远程更改
    this.git.pull(this.branch);

    // 检查是否有本地更改
    if (!this.git.hasChanges()) {
      this.logger.info(`[${this.name}] 没有需要同步的更改`);
      return true;
    }

    // 添加文件
    this.git.addFiles(
      this.includeFolders.length > 0 ? this.includeFolders : null,
      this.excludePatterns
    );

    // 再次检查暂存区
    const status = this.git.getStatus();
    if (!status) {
      this.logger.info(`[${this.name}] 过滤后没有需要同步的更改`);
      return true;
    }

    // 生成提交信息
    const timestamp = new Date().toLocaleString('zh-CN', { hour12: false });
    const changedCount = status.split('\n').length;
    const message = `${this.commitPrefix} ${timestamp} - ${changedCount} 个文件变更`;

    // 提交并推送
    if (this.git.commit(message)) {
      this.logger.info(`[${this.name}] 提交成功: ${message}`);
      if (this.git.push(this.branch)) {
        this.logger.info(`[${this.name}] 推送成功`);
        return true;
      } else {
        this.logger.error(`[${this.name}] 推送失败，请检查网络和远程仓库配置`);
        return false;
      }
    } else {
      this.logger.warn(`[${this.name}] 没有需要提交的内容`);
      return true;
    }
  }
}

// ==================== 主程序 ====================
class GitAutoSync {
  constructor(configPath = 'config.json') {
    this.configPath = path.resolve(configPath);
    this.config = {};
    this.logger = null;
    this.syncers = [];
    this.timer = null;
  }

  loadConfig() {
    if (!fs.existsSync(this.configPath)) {
      console.error(`[ERROR] 配置文件不存在: ${this.configPath}`);
      console.error(`[INFO] 请创建配置文件，参考模板 config.json`);
      return false;
    }

    try {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      this.config = JSON.parse(content);
    } catch (e) {
      console.error(`[ERROR] 配置文件格式错误: ${e.message}`);
      return false;
    }

    // 设置日志
    const logFile = this.config.log_file || 'git_auto_sync.log';
    const maxLogSize = this.config.max_log_size_mb || 10;
    this.logger = new Logger(logFile, maxLogSize);

    return true;
  }

  initSyncers() {
    this.syncers = [];
    const repos = this.config.repositories || [];
    if (repos.length === 0) {
      this.logger.warn('配置文件中没有配置任何仓库');
      return;
    }

    for (const repoConfig of repos) {
      const syncer = new RepoSyncer(repoConfig, this.logger);
      this.syncers.push(syncer);
    }

    this.logger.info(`已加载 ${this.syncers.length} 个仓库配置`);
  }

  syncAll() {
    this.logger.info('='.repeat(50));
    this.logger.info('开始一轮同步');
    this.logger.info('='.repeat(50));

    let successCount = 0;
    let failCount = 0;

    for (const syncer of this.syncers) {
      try {
        if (syncer.sync()) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (e) {
        this.logger.error(`[${syncer.name}] 同步异常: ${e.message}`);
        failCount++;
      }
    }

    this.logger.info(`同步完成: 成功 ${successCount}, 失败 ${failCount}`);
  }

  showStatus() {
    if (!this.loadConfig()) {
      process.exit(1);
    }
    this.initSyncers();

    console.log('\n=== 仓库状态 ===');
    for (const syncer of this.syncers) {
      const status = syncer.enabled ? '启用' : '禁用';
      console.log(`\n[${syncer.name}] (${status})`);
      console.log(`  路径: ${syncer.repoPath}`);
      console.log(`  分支: ${syncer.branch}`);
      console.log(`  同步文件夹: ${syncer.includeFolders.length > 0 ? syncer.includeFolders.join(', ') : '全部'}`);
      console.log(`  排除模式: ${syncer.excludePatterns.length > 0 ? syncer.excludePatterns.join(', ') : '无'}`);

      if (syncer.git && syncer.git.isGitRepo()) {
        const currentBranch = syncer.git.getCurrentBranch();
        const hasChanges = syncer.git.hasChanges() ? '是' : '否';
        console.log(`  当前分支: ${currentBranch}`);
        console.log(`  有未提交更改: ${hasChanges}`);
      } else {
        console.log(`  状态: 仓库不可用`);
      }
    }
    console.log();
  }

  runOnce() {
    if (!this.loadConfig()) {
      process.exit(1);
    }
    this.initSyncers();
    this.syncAll();
  }

  runDaemon(intervalOverride) {
    if (!this.loadConfig()) {
      process.exit(1);
    }
    this.initSyncers();

    const intervalMinutes = intervalOverride || this.config.sync_interval_minutes || 30;
    const intervalMs = intervalMinutes * 60 * 1000;

    this.logger.info('Git 自动同步工具已启动');
    this.logger.info(`同步间隔: ${intervalMinutes} 分钟`);
    this.logger.info('按 Ctrl+C 停止');

    // 启动时立即同步一次
    this.syncAll();

    // 定时同步
    this.timer = setInterval(() => {
      // 热更新配置
      if (this.loadConfig()) {
        this.initSyncers();
      }
      this.syncAll();
    }, intervalMs);

    // 优雅退出
    const cleanup = () => {
      this.logger.info('Git 自动同步工具已停止');
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// ==================== CLI 入口 ====================
function printHelp() {
  console.log(`
Git 自动同步工具 - 定时自动提交并推送代码到远程仓库

用法:
  node git-auto-sync.js [选项]

选项:
  --config, -c <path>   指定配置文件路径 (默认: config.json)
  --once                只执行一次同步后退出
  --interval, -i <min>  覆盖配置文件中的同步间隔（单位：分钟）
  --status              查看所有配置仓库的状态
  --help, -h            显示帮助信息

示例:
  node git-auto-sync.js                     # 以守护模式运行
  node git-auto-sync.js --once              # 只执行一次同步
  node git-auto-sync.js --config my.json    # 指定配置文件
  node git-auto-sync.js --interval 10       # 设置同步间隔为10分钟
  node git-auto-sync.js --status            # 查看仓库状态
  `);
}

function parseArgs(argv) {
  const args = {
    config: 'config.json',
    once: false,
    interval: null,
    status: false,
    help: false
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--once') {
      args.once = true;
    } else if (arg === '--status') {
      args.status = true;
    } else if (arg === '--config' || arg === '-c') {
      args.config = argv[++i] || args.config;
    } else if (arg === '--interval' || arg === '-i') {
      args.interval = parseInt(argv[++i]) || null;
    }
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const app = new GitAutoSync(args.config);

  if (args.status) {
    app.showStatus();
    return;
  }

  if (args.once) {
    app.runOnce();
  } else {
    app.runDaemon(args.interval);
  }
}

main();

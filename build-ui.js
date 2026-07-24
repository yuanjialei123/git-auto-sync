/**
 * 构建脚本 - 编译 Git 自动同步工具 exe
 * 使用 C# 编译器创建启动器，支持 UI 模式和命令行模式
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_DIR = __dirname;
const DIST_DIR = path.join(APP_DIR, 'dist');
const CSC = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

console.log('开始编译 Git 自动同步工具...\n');

// 创建 dist 目录
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

// 编译 C# 启动器
console.log('编译 exe 启动器...');
try {
  const cmd = `"${CSC}" /nologo /target:winexe /out:"${DIST_DIR}\\git-auto-sync.exe" /platform:x64 /r:System.Windows.Forms.dll /r:System.Drawing.dll "${APP_DIR}\\GitAutoSyncLauncher.cs"`;
  execSync(cmd, { stdio: 'inherit' });
  console.log('✓ exe 编译成功\n');
} catch (e) {
  console.error('✗ exe 编译失败');
  process.exit(1);
}

// 复制文件
const files = [
  'git-sync-server.js',
  'git-auto-sync.js',
  'config.json'
];

console.log('复制文件到 dist 目录...');
for (const file of files) {
  const src = path.join(APP_DIR, file);
  const dst = path.join(DIST_DIR, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
    console.log(`✓ ${file}`);
  } else {
    console.log(`⚠ ${file} 不存在，跳过`);
  }
}

console.log('\n========================================');
console.log('编译完成！');
console.log('========================================\n');
console.log('dist 目录内容:');
const distFiles = fs.readdirSync(DIST_DIR);
for (const file of distFiles) {
  const stat = fs.statSync(path.join(DIST_DIR, file));
  console.log(`  ${file} (${(stat.size / 1024).toFixed(1)} KB)`);
}

console.log('\n使用方法:');
console.log('  git-auto-sync.exe --ui          启动 Web UI（推荐）');
console.log('  git-auto-sync.exe --once        执行一次同步');
console.log('  git-auto-sync.exe --status      查看仓库状态');
console.log('  git-auto-sync.exe               守护模式运行');
console.log('\n访问 http://127.0.0.1:9527 使用 Web UI');

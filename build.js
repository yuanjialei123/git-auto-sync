/**
 * 构建脚本 - 将 git-auto-sync.js 编译为 Windows exe 文件
 */
const { compile } = require('nexe');
const path = require('path');
const fs = require('fs');

async function build() {
  console.log('开始编译 Git 自动同步工具...');
  console.log('目标平台: Windows x64');

  const outputDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 清理旧的 exe
  const outputPath = path.join(outputDir, 'git-auto-sync.exe');
  if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
  }

  try {
    await compile({
      input: path.join(__dirname, 'git-auto-sync.js'),
      output: outputPath,
      target: 'windows-x64-14.15.3',
      name: 'git-auto-sync',
      mangle: false,
      loglevel: 'verbose',
    });

    console.log(`\n编译成功！`);
    console.log(`输出文件: ${outputPath}`);
    
    // 检查文件大小
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      console.log(`文件大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    }

    // 复制配置文件到 dist 目录
    const configSrc = path.join(__dirname, 'config.json');
    const configDst = path.join(outputDir, 'config.json');
    if (fs.existsSync(configSrc)) {
      fs.copyFileSync(configSrc, configDst);
      console.log(`配置文件已复制到: ${configDst}`);
    }

    console.log('\n使用说明:');
    console.log(`  1. 编辑 dist\\config.json 配置你的仓库信息`);
    console.log(`  2. 双击运行 git-auto-sync.exe 或:`);
    console.log(`     git-auto-sync.exe --once     (执行一次同步)`);
    console.log(`     git-auto-sync.exe --status   (查看仓库状态)`);

  } catch (err) {
    console.error('编译失败:', err.message);
    process.exit(1);
  }
}

build();

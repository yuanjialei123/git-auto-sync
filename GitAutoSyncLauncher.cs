using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Drawing;
using System.Windows.Forms;

namespace GitAutoSync
{
    class Program
    {
        [DllImport("user32.dll")]
        static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        
        const int SW_HIDE = 0;
        const int SW_MINIMIZE = 6;
        
        private static Process nodeProcess;
        private static NotifyIcon trayIcon;
        private static bool isBackgroundMode = false;

        [STAThread]
        static int Main(string[] args)
        {
            // 检查参数
            bool uiMode = Array.Exists(args, a => a == "--ui");
            bool backgroundMode = Array.Exists(args, a => a == "--background");
            bool noBrowser = Array.Exists(args, a => a == "--no-browser");
            
            // 获取 exe 所在目录
            string exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            
            // 确定要运行的 JS 文件
            string jsFile;
            if (uiMode)
            {
                jsFile = Path.Combine(exeDir, "git-sync-server.js");
                if (!File.Exists(jsFile))
                {
                    Console.WriteLine("[ERROR] 找不到 git-sync-server.js");
                    Console.WriteLine("请确保 git-sync-server.js 与本程序在同一目录下");
                    Console.ReadKey();
                    return 1;
                }
            }
            else
            {
                jsFile = Path.Combine(exeDir, "git-auto-sync.js");
                if (!File.Exists(jsFile))
                {
                    Console.WriteLine("[ERROR] 找不到 git-auto-sync.js");
                    Console.ReadKey();
                    return 1;
                }
            }

            // 查找 node.exe
            string nodePath = FindNode();
            if (nodePath == null)
            {
                Console.WriteLine("[ERROR] 找不到 node.exe");
                Console.WriteLine("请确保 Node.js 已安装并添加到系统 PATH");
                Console.ReadKey();
                return 1;
            }

            // 构建命令行参数
            string arguments = "\"" + jsFile + "\"";
            if (noBrowser) arguments += " --no-browser";
            
            foreach (string arg in args)
            {
                if (arg != "--ui" && arg != "--background" && arg != "--no-browser")
                {
                    arguments += " " + arg;
                }
            }

            // 启动 Node.js 进程
            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = arguments,
                UseShellExecute = false,
                RedirectStandardInput = false,
                RedirectStandardOutput = false,
                RedirectStandardError = false,
                CreateNoWindow = backgroundMode,
                WindowStyle = backgroundMode ? ProcessWindowStyle.Hidden : ProcessWindowStyle.Normal
            };
            startInfo.WorkingDirectory = exeDir;

            try
            {
                nodeProcess = Process.Start(startInfo);
                
                if (backgroundMode || uiMode)
                {
                    // 后台模式或 UI 模式 - 显示系统托盘图标
                    isBackgroundMode = true;
                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);
                    
                    SetupTrayIcon(exeDir);
                    
                    // 如果是 UI 模式，打开浏览器
                    if (uiMode && !noBrowser)
                    {
                        Thread.Sleep(1000);
                        try
                        {
                            Process.Start(new ProcessStartInfo
                            {
                                FileName = "http://127.0.0.1:9527",
                                UseShellExecute = true
                            });
                        }
                        catch { }
                    }
                    
                    Application.Run();
                }
                else
                {
                    // 前台模式 - 等待进程结束
                    if (!backgroundMode)
                    {
                        Console.WriteLine("============================================");
                        Console.WriteLine("  Git 自动同步工具 v1.0.0");
                        Console.WriteLine("============================================");
                        Console.WriteLine();
                        Console.WriteLine("用法:");
                        Console.WriteLine("  git-auto-sync.exe --ui           启动 Web UI");
                        Console.WriteLine("  git-auto-sync.exe --once         执行一次同步");
                        Console.WriteLine("  git-auto-sync.exe --status       查看仓库状态");
                        Console.WriteLine();
                    }
                    
                    nodeProcess.WaitForExit();
                    return nodeProcess.ExitCode;
                }
                
                return 0;
            }
            catch (Exception ex)
            {
                Console.WriteLine("[ERROR] 启动失败: " + ex.Message);
                Console.ReadKey();
                return 1;
            }
        }

        static void SetupTrayIcon(string exeDir)
        {
            trayIcon = new NotifyIcon();
            
            // 使用系统图标
            trayIcon.Icon = SystemIcons.Application;
            trayIcon.Text = "Git 自动同步工具";
            trayIcon.Visible = true;
            
            // 创建右键菜单
            ContextMenuStrip menu = new ContextMenuStrip();
            
            menu.Items.Add("打开 UI", null, (s, e) => {
                try
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = "http://127.0.0.1:9527",
                        UseShellExecute = true
                    });
                }
                catch { }
            });
            
            menu.Items.Add(new ToolStripSeparator());
            
            menu.Items.Add("立即同步", null, (s, e) => {
                try
                {
                    using (var client = new System.Net.WebClient())
                    {
                        client.UploadString("http://127.0.0.1:9527/api/sync", "POST", "");
                    }
                    ShowNotification("同步已触发", "正在同步所有仓库...");
                }
                catch (Exception ex)
                {
                    ShowNotification("同步失败", ex.Message);
                }
            });
            
            menu.Items.Add(new ToolStripSeparator());
            
            menu.Items.Add("退出", null, (s, e) => {
                if (MessageBox.Show("确定要退出 Git 自动同步工具吗？", "确认退出",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes)
                {
                    trayIcon.Visible = false;
                    if (nodeProcess != null && !nodeProcess.HasExited)
                    {
                        nodeProcess.Kill();
                    }
                    Application.Exit();
                }
            });
            
            trayIcon.ContextMenuStrip = menu;
            
            // 双击打开 UI
            trayIcon.DoubleClick += (s, e) => {
                try
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = "http://127.0.0.1:9527",
                        UseShellExecute = true
                    });
                }
                catch { }
            };
        }

        static void ShowNotification(string title, string message)
        {
            if (trayIcon != null)
            {
                trayIcon.ShowBalloonTip(3000, title, message, ToolTipIcon.Info);
            }
        }

        static string FindNode()
        {
            // 1. 检查 PATH 环境变量
            string pathEnv = Environment.GetEnvironmentVariable("PATH");
            if (pathEnv != null)
            {
                foreach (string dir in pathEnv.Split(Path.PathSeparator))
                {
                    try
                    {
                        string nodePath = Path.Combine(dir, "node.exe");
                        if (File.Exists(nodePath))
                        {
                            return nodePath;
                        }
                    }
                    catch { }
                }
            }

            // 2. 检查常见安装路径
            string[] commonPaths = new string[]
            {
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe",
                @"D:\env\nodejs22\node.exe",
                @"D:\Program Files\nodejs\node.exe",
            };

            foreach (string p in commonPaths)
            {
                if (File.Exists(p))
                {
                    return p;
                }
            }

            // 3. 检查与本程序同目录
            string exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string localNode = Path.Combine(exeDir, "node.exe");
            if (File.Exists(localNode))
            {
                return localNode;
            }

            return null;
        }
    }
}

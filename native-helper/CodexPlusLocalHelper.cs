using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Management;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace CodexPlusLocalHelper
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }

    public sealed class MainForm : Form
    {
        private const string HelperVersion = "0.3.0";
        private const string HelperBuildDate = "2026-05-25";
        private const int HelperLogMaxBytes = 1024 * 1024;
        private const int HelperLogBackups = 5;
        private const int AutoSwitchRepeatedLogSeconds = 300;
        private static readonly object HelperLogFileLock = new object();
        private int _port = 18766;
        private readonly string _root;
        private readonly DateTime _startedAtUtc = DateTime.UtcNow;
        private readonly Label _statusLabel;
        private readonly Label _authLabel;
        private readonly TextBox _logBox;
        private readonly Button _startButton;
        private readonly Button _stopButton;
        private readonly Button _openButton;
        private readonly Button _folderButton;
        private readonly Button _refreshAuthButton;
        private readonly Button _importAuthButton;
        private readonly Button _backupAuthButton;
        private readonly Button _launchCodexButton;
        private readonly NotifyIcon _trayIcon;
        private readonly ContextMenuStrip _trayMenu;
        private HttpListener _listener;
        private HttpListener _oauthCallbackListener;
        private Thread _oauthCallbackThread;
        private volatile bool _oauthCallbackRunning;
        private Thread _serverThread;
        private volatile bool _running;
        private bool _allowExit;
        private bool _trayTipShown;
        private readonly object _autoSwitchLock = new object();
        private Thread _autoSwitchThread;
        private volatile bool _autoSwitchStop;
        private AutoSwitchConfig _autoSwitchConfig;
        private DateTime _lastAutoSwitchAt = DateTime.MinValue;
        private DateTime _lastAutoSwitchCheckAt = DateTime.MinValue;
        private string _lastAutoSwitchReason = "";
        private string _lastAutoSwitchResult = "";
        private string _lastAutoSwitchLogKey = "";
        private DateTime _lastAutoSwitchLogAt = DateTime.MinValue;
        private readonly object _authSyncLock = new object();
        private string _lastSyncedAuthFingerprint = "";
        private DateTime _lastSyncedAuthWriteAt = DateTime.MinValue;
        private DateTime _lastAuthSyncAttemptAt = DateTime.MinValue;
        private string _lastHelperWrittenAuthFingerprint = "";
        private string _lastAuthSyncLogKey = "";
        private DateTime _lastAuthSyncLogAt = DateTime.MinValue;
        private string _lastSkippedAuthFingerprint = "";
        private DateTime _lastSkippedAuthWriteAt = DateTime.MinValue;
        private DateTime _lastSkippedAuthAttemptAt = DateTime.MinValue;
        private string _pendingPostSwitchAuthCompareFingerprint = "";
        private DateTime _pendingPostSwitchAuthCompareAfter = DateTime.MinValue;
        private string _lastForcedAuthCompareKey = "";
        private DateTime _lastForcedAuthCompareAt = DateTime.MinValue;
        private readonly object _oauthCallbackLock = new object();
        private string _lastOauthCallbackUrl = "";
        private string _lastOauthCallbackCode = "";
        private string _lastOauthCallbackState = "";
        private string _lastOauthCallbackError = "";
        private DateTime _lastOauthCallbackAt = DateTime.MinValue;
        private double _lastCodexCpuSeconds = -1;
        private DateTime _lastCodexCpuSampleAt = DateTime.MinValue;
        private DateTime _codexCpuQuietSince = DateTime.MinValue;
        private readonly object _codexStatusLock = new object();
        private Thread _codexStatusThread;
        private volatile bool _codexStatusStop;
        private CodexRuntimeStatus _codexStatus = CodexRuntimeStatus.Unknown("尚未探测");
        private readonly CodexLogRuntimeMonitor _codexLogRuntimeMonitor = new CodexLogRuntimeMonitor();
        private readonly object _operationProgressLock = new object();
        private OperationProgressForm _operationProgressForm;

        [StructLayout(LayoutKind.Sequential)]
        private struct LastInputInfo
        {
            public uint CbSize;
            public uint DwTime;
        }

        [DllImport("user32.dll")]
        private static extern bool GetLastInputInfo(ref LastInputInfo info);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        private static extern IntPtr SendMessageTimeout(IntPtr hWnd, int msg, IntPtr wParam, string lParam, int flags, int timeout, out IntPtr result);

        private static readonly IntPtr HWND_BROADCAST = new IntPtr(0xffff);
        private const int WM_SETTINGCHANGE = 0x001A;
        private const int SMTO_ABORTIFHUNG = 0x0002;

        public MainForm()
        {
            _root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            _autoSwitchConfig = LoadAutoSwitchConfig();

            Text = "Codex Dock Helper";
            Width = 900;
            Height = 620;
            MinimumSize = new Size(820, 560);
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Microsoft YaHei UI", 9F);
            BackColor = Color.FromArgb(12, 15, 11);
            ForeColor = Color.FromArgb(243, 241, 232);

            var root = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                BackColor = BackColor,
                Padding = new Padding(22),
                RowCount = 3,
                ColumnCount = 1,
            };
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 104));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 184));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            Controls.Add(root);

            var header = new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.FromArgb(18, 22, 15),
                Padding = new Padding(18),
            };
            root.Controls.Add(header, 0, 0);

            var brand = new Label
            {
                Text = "Dock",
                TextAlign = ContentAlignment.MiddleCenter,
                Font = new Font("Segoe UI", 15F, FontStyle.Bold),
                ForeColor = Color.FromArgb(229, 255, 106),
                BackColor = Color.FromArgb(31, 38, 24),
                Location = new Point(18, 20),
                Size = new Size(54, 54),
            };
            header.Controls.Add(brand);

            var title = MakeLabel("Codex Dock Helper", 19F, FontStyle.Bold, Color.FromArgb(243, 241, 232));
            title.Location = new Point(88, 17);
            title.Size = new Size(360, 34);
            header.Controls.Add(title);

            var subtitle = MakeLabel("安装后即可自动写入 auth 并重启 Codex。", 9.5F, FontStyle.Regular, Color.FromArgb(169, 176, 158));
            subtitle.Location = new Point(90, 54);
            subtitle.Size = new Size(620, 24);
            header.Controls.Add(subtitle);

            _statusLabel = new Label
            {
                Text = "未启动",
                Font = new Font("Microsoft YaHei UI", 9.5F, FontStyle.Bold),
                ForeColor = Color.FromArgb(86, 218, 197),
                BackColor = Color.FromArgb(24, 32, 26),
                TextAlign = ContentAlignment.MiddleCenter,
                AutoSize = false,
                Anchor = AnchorStyles.Top | AnchorStyles.Right,
                Location = new Point(650, 22),
                Size = new Size(170, 34),
            };
            header.Controls.Add(_statusLabel);

            var cards = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                BackColor = BackColor,
                Padding = new Padding(0, 16, 0, 14),
                ColumnCount = 2,
                RowCount = 1,
            };
            cards.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 53));
            cards.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 47));
            root.Controls.Add(cards, 0, 1);

            var serviceCard = MakeCard();
            serviceCard.Margin = new Padding(0, 0, 8, 0);
            cards.Controls.Add(serviceCard, 0, 0);

            var serviceTitle = MakeLabel("本地服务", 12F, FontStyle.Bold, Color.FromArgb(243, 241, 232));
            serviceTitle.Location = new Point(18, 16);
            serviceTitle.Size = new Size(160, 24);
            serviceCard.Controls.Add(serviceTitle);

            var serviceCopy = MakeLabel("只监听 127.0.0.1，网页通过本机接口触发稳定切换。", 9F, FontStyle.Regular, Color.FromArgb(169, 176, 158));
            serviceCopy.Location = new Point(18, 44);
            serviceCopy.Size = new Size(380, 22);
            serviceCard.Controls.Add(serviceCopy);

            _openButton = MakeButton("打开云端控制台", true);
            _openButton.Location = new Point(18, 88);
            _openButton.Size = new Size(170, 42);
            serviceCard.Controls.Add(_openButton);

            _startButton = MakeButton("启动服务", false);
            _startButton.Location = new Point(200, 88);
            _startButton.Size = new Size(104, 42);
            serviceCard.Controls.Add(_startButton);

            _stopButton = MakeButton("停止", false);
            _stopButton.Location = new Point(314, 88);
            _stopButton.Size = new Size(82, 42);
            _stopButton.Enabled = false;
            serviceCard.Controls.Add(_stopButton);

            var authCard = MakeCard();
            authCard.Margin = new Padding(8, 0, 0, 0);
            cards.Controls.Add(authCard, 1, 0);

            var authTitle = MakeLabel("当前 Codex 授权", 12F, FontStyle.Bold, Color.FromArgb(243, 241, 232));
            authTitle.Location = new Point(18, 16);
            authTitle.Size = new Size(190, 24);
            authCard.Controls.Add(authTitle);

            _authLabel = new Label
            {
                Text = "当前 auth：未检测",
                Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular),
                ForeColor = Color.FromArgb(215, 221, 198),
                BackColor = Color.Transparent,
                AutoSize = false,
                Location = new Point(18, 44),
                Width = 330,
                Height = 42,
                Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right,
            };
            authCard.Controls.Add(_authLabel);

            _refreshAuthButton = MakeButton("刷新", false);
            _refreshAuthButton.Location = new Point(18, 96);
            _refreshAuthButton.Size = new Size(82, 36);
            authCard.Controls.Add(_refreshAuthButton);

            _folderButton = MakeButton("Codex 目录", false);
            _folderButton.Location = new Point(110, 96);
            _folderButton.Size = new Size(110, 36);
            authCard.Controls.Add(_folderButton);

            _backupAuthButton = MakeButton("备份 auth", false);
            _backupAuthButton.Location = new Point(230, 96);
            _backupAuthButton.Size = new Size(104, 36);
            authCard.Controls.Add(_backupAuthButton);

            var lower = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                BackColor = BackColor,
                ColumnCount = 2,
                RowCount = 1,
            };
            lower.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 230));
            lower.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            root.Controls.Add(lower, 0, 2);

            var quickCard = MakeCard();
            quickCard.Margin = new Padding(0, 0, 8, 0);
            lower.Controls.Add(quickCard, 0, 0);

            var quickTitle = MakeLabel("应急操作", 12F, FontStyle.Bold, Color.FromArgb(243, 241, 232));
            quickTitle.Location = new Point(18, 18);
            quickTitle.Size = new Size(150, 24);
            quickCard.Controls.Add(quickTitle);

            var quickCopy = MakeLabel("日常请在云端网页操作，这里只保留本地兜底能力。", 9F, FontStyle.Regular, Color.FromArgb(169, 176, 158));
            quickCopy.Location = new Point(18, 50);
            quickCopy.Size = new Size(184, 48);
            quickCard.Controls.Add(quickCopy);

            _importAuthButton = MakeButton("导入 auth.json", false);
            _importAuthButton.Location = new Point(18, 116);
            _importAuthButton.Size = new Size(176, 40);
            quickCard.Controls.Add(_importAuthButton);

            _launchCodexButton = MakeButton("启动 Codex", false);
            _launchCodexButton.Location = new Point(18, 166);
            _launchCodexButton.Size = new Size(176, 40);
            quickCard.Controls.Add(_launchCodexButton);

            var logCard = MakeCard();
            logCard.Margin = new Padding(8, 0, 0, 0);
            lower.Controls.Add(logCard, 1, 0);

            var logTitle = MakeLabel("执行日志", 12F, FontStyle.Bold, Color.FromArgb(243, 241, 232));
            logTitle.Location = new Point(18, 16);
            logTitle.Size = new Size(180, 24);
            logCard.Controls.Add(logTitle);

            _logBox = new TextBox
            {
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                BorderStyle = BorderStyle.None,
                Font = new Font("Consolas", 9.5F),
                ForeColor = Color.FromArgb(223, 233, 212),
                BackColor = Color.FromArgb(9, 12, 8),
                Location = new Point(18, 52),
                Width = 560,
                Height = 240,
                Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right,
            };
            logCard.Controls.Add(_logBox);

            _startButton.Click += delegate { StartServer(); };
            _stopButton.Click += delegate { StopServer(); };
            _openButton.Click += delegate { OpenManagementPage(); };
            _folderButton.Click += delegate { OpenCodexFolder(); };
            _refreshAuthButton.Click += delegate { RefreshAuthStatus(); };
            _importAuthButton.Click += delegate { ImportAndApplyAuthJson(); };
            _backupAuthButton.Click += delegate { BackupCurrentAuth(); };
            _launchCodexButton.Click += delegate { LaunchCodexWithLog(); };
            _trayMenu = BuildTrayMenu();
            _trayIcon = new NotifyIcon
            {
                Icon = SystemIcons.Application,
                Text = "Codex Dock Helper",
                Visible = true,
                ContextMenuStrip = _trayMenu
            };
            _trayIcon.DoubleClick += delegate { ShowFromTray(); };
            FormClosing += MainForm_FormClosing;
            Resize += delegate
            {
                if (WindowState == FormWindowState.Minimized)
                {
                    HideToTray();
                }
            };
            Shown += delegate
            {
                RefreshAuthStatus();
                RepairCodexStartupChain();
                StartServer();
                StartCodexStatusMonitor();
                StartAutoSwitchService();
            };
        }

        private string BaseUrl
        {
            get { return "http://127.0.0.1:" + _port + "/"; }
        }

        private string CloudConsoleUrl
        {
            get
            {
                var configured = Environment.GetEnvironmentVariable("CODEX_PLUS_CLOUD_CONSOLE_URL");
                return string.IsNullOrWhiteSpace(configured) ? "https://codex.woai.pro/" : configured.Trim();
            }
        }

        private static Label MakeLabel(string text, float size, FontStyle style, Color color)
        {
            return new Label
            {
                Text = text,
                Font = new Font("Microsoft YaHei UI", size, style),
                ForeColor = color,
                BackColor = Color.Transparent,
                AutoSize = false,
            };
        }

        private static Panel MakeCard()
        {
            return new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.FromArgb(25, 30, 22),
                BorderStyle = BorderStyle.FixedSingle,
                Padding = new Padding(14),
            };
        }

        private static Button MakeButton(string text, bool primary)
        {
            var button = new Button
            {
                Text = text,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Bold),
                Cursor = Cursors.Hand,
                UseVisualStyleBackColor = false,
                BackColor = primary ? Color.FromArgb(229, 255, 106) : Color.FromArgb(20, 25, 18),
                ForeColor = primary ? Color.FromArgb(18, 21, 14) : Color.FromArgb(243, 241, 232),
            };
            button.FlatAppearance.BorderColor = primary ? Color.FromArgb(229, 255, 106) : Color.FromArgb(61, 70, 56);
            button.FlatAppearance.MouseOverBackColor = primary ? Color.FromArgb(237, 255, 132) : Color.FromArgb(31, 38, 28);
            button.FlatAppearance.MouseDownBackColor = primary ? Color.FromArgb(211, 238, 80) : Color.FromArgb(13, 17, 12);
            return button;
        }

        private ContextMenuStrip BuildTrayMenu()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add("显示 Dock Helper", null, delegate { ShowFromTray(); });
            menu.Items.Add("打开 Codex Dock", null, delegate { OpenManagementPage(); });
            menu.Items.Add("打开本地状态页", null, delegate { OpenLocalStatusPage(); });
            menu.Items.Add("打开 Codex 目录", null, delegate { OpenCodexFolder(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("重启本地服务", null, delegate
            {
                StopServer();
                StartServer();
            });
            menu.Items.Add("退出助手", null, delegate { ExitApplication(); });
            return menu;
        }

        private void MainForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (!_allowExit && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                HideToTray();
                return;
            }

            StopServer();
            StopAutoSwitchService();
            StopCodexStatusMonitor();
            if (_trayIcon != null)
            {
                _trayIcon.Visible = false;
                _trayIcon.Dispose();
            }
            if (_trayMenu != null)
            {
                _trayMenu.Dispose();
            }
        }

        private void HideToTray()
        {
            Hide();
            ShowInTaskbar = false;
            if (!_trayTipShown && _trayIcon != null)
            {
                _trayIcon.ShowBalloonTip(2500, "Codex Dock Helper", "Helper 仍在系统托盘运行。右键图标可以退出。", ToolTipIcon.Info);
                _trayTipShown = true;
            }
        }

        private void ShowFromTray()
        {
            ShowInTaskbar = true;
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
        }

        private void ExitApplication()
        {
            _allowExit = true;
            Close();
        }

        private void StartServer()
        {
            if (_running) return;

            try
            {
                Exception lastError = null;
                for (var offset = 0; offset < 20; offset++)
                {
                    _port = 18766 + offset;
                    try
                    {
                        _listener = new HttpListener();
                        _listener.Prefixes.Add(BaseUrl);
                        _listener.Start();
                        lastError = null;
                        break;
                    }
                    catch (Exception ex)
                    {
                        lastError = ex;
                        try
                        {
                            if (_listener != null) _listener.Close();
                        }
                        catch { }
                        _listener = null;
                    }
                }
                if (lastError != null || _listener == null)
                {
                    throw lastError ?? new InvalidOperationException("没有可用端口");
                }
                _running = true;
                _serverThread = new Thread(ServerLoop) { IsBackground = true };
                _serverThread.Start();
                StartOauthCallbackServer();
                SetStatus("运行中：" + BaseUrl);
                Log("服务已启动：" + BaseUrl + " · Helper " + HelperVersion + " (" + HelperBuildDate + ")");
                RefreshAuthStatus();
                _startButton.Enabled = false;
                _stopButton.Enabled = true;
            }
            catch (Exception ex)
            {
                Log("启动失败：" + ex.Message);
                SetStatus("启动失败");
            }
        }

        private void StopServer()
        {
            if (!_running) return;
            _running = false;
            try
            {
                StopOauthCallbackServer();
                if (_listener != null)
                {
                    _listener.Stop();
                    _listener.Close();
                    _listener = null;
                }
            }
            catch { }
            SetStatus("已停止");
            Log("服务已停止");
            _startButton.Enabled = true;
            _stopButton.Enabled = false;
        }

        private void ServerLoop()
        {
            while (_running)
            {
                try
                {
                    var context = _listener.GetContext();
                    ThreadPool.QueueUserWorkItem(delegate { HandleRequest(context); });
                }
                catch
                {
                    if (_running) Log("服务循环异常，已忽略一次。");
                }
            }
        }

        private void StartOauthCallbackServer()
        {
            if (_oauthCallbackRunning) return;
            try
            {
                _oauthCallbackListener = new HttpListener();
                _oauthCallbackListener.Prefixes.Add("http://localhost:1455/");
                _oauthCallbackListener.Prefixes.Add("http://127.0.0.1:1455/");
                _oauthCallbackListener.Start();
                _oauthCallbackRunning = true;
                _oauthCallbackThread = new Thread(OauthCallbackLoop) { IsBackground = true };
                _oauthCallbackThread.Start();
                Log("OAuth 回调监听已启动：http://localhost:1455/auth/callback");
            }
            catch (Exception ex)
            {
                try
                {
                    if (_oauthCallbackListener != null) _oauthCallbackListener.Close();
                }
                catch { }
                _oauthCallbackListener = null;
                _oauthCallbackRunning = false;
                Log("OAuth 回调监听未启动：" + ex.Message);
            }
        }

        private void StopOauthCallbackServer()
        {
            _oauthCallbackRunning = false;
            try
            {
                if (_oauthCallbackListener != null)
                {
                    _oauthCallbackListener.Stop();
                    _oauthCallbackListener.Close();
                    _oauthCallbackListener = null;
                }
            }
            catch { }
        }

        private void OauthCallbackLoop()
        {
            while (_oauthCallbackRunning)
            {
                try
                {
                    var context = _oauthCallbackListener.GetContext();
                    ThreadPool.QueueUserWorkItem(delegate { HandleOauthCallbackRequest(context); });
                }
                catch
                {
                    if (_oauthCallbackRunning) Log("OAuth 回调监听异常，已忽略一次。");
                }
            }
        }

        private void HandleOauthCallbackRequest(HttpListenerContext context)
        {
            try
            {
                var request = context.Request;
                if (request.HttpMethod == "GET" && request.Url.AbsolutePath == "/auth/callback")
                {
                    var code = request.QueryString["code"] ?? "";
                    var state = request.QueryString["state"] ?? "";
                    var error = request.QueryString["error"] ?? "";
                    var raw = request.RawUrl ?? "";
                    var fullUrl = "http://localhost:1455" + raw;
                    lock (_oauthCallbackLock)
                    {
                        _lastOauthCallbackUrl = fullUrl;
                        _lastOauthCallbackCode = code;
                        _lastOauthCallbackState = state;
                        _lastOauthCallbackError = error;
                        _lastOauthCallbackAt = DateTime.UtcNow;
                    }
                    SendText(context.Response, string.IsNullOrEmpty(error) ? 200 : 400, OauthCallbackHtml(error, fullUrl), "text/html; charset=utf-8");
                    return;
                }
                SendText(context.Response, 404, "OAuth callback listener is running.", "text/plain; charset=utf-8");
            }
            catch (Exception ex)
            {
                try { SendText(context.Response, 500, "OAuth callback failed: " + ex.Message, "text/plain; charset=utf-8"); }
                catch { }
            }
        }

        private void HandleRequest(HttpListenerContext context)
        {
            try
            {
                if (HandleApi(context)) return;
                ServeStatic(context);
            }
            catch (Exception ex)
            {
                SendJson(context.Response, 500, "{\"ok\":false,\"error\":\"" + JsonEscape(ex.Message) + "\"}");
            }
        }

        private bool HandleApi(HttpListenerContext context)
        {
            var request = context.Request;
            var path = request.Url.AbsolutePath;

            if (request.HttpMethod == "OPTIONS")
            {
                if (!IsAllowedOrigin(request))
                {
                    SendText(context.Response, 403, "");
                    return true;
                }
                SendText(context.Response, 204, "");
                return true;
            }

            if (request.HttpMethod == "GET" && path == "/api/health")
            {
                SendJson(context.Response, 200, "{\"ok\":true,\"mode\":\"native-helper\",\"port\":" + _port + ",\"cloud_console_url\":\"" + JsonEscape(CloudConsoleUrl) + "\",\"auto_switch\":" + AutoSwitchStatusJson() + ",\"codex_proxy\":" + CodexProxyStatusJson() + ",\"codex_status\":" + CodexStatusJson() + "}");
                return true;
            }

            if (request.HttpMethod == "GET" && path == "/api/codex/status")
            {
                if (!IsAllowedOrigin(request))
                {
                    SendJson(context.Response, 403, "{\"ok\":false,\"error\":\"来源未授权\"}");
                    return true;
                }
                SendJson(context.Response, 200, "{\"ok\":true,\"codex_proxy\":" + CodexProxyStatusJson() + ",\"codex_status\":" + RefreshCodexStatusJson() + "}");
                return true;
            }

            if (request.HttpMethod == "GET" && path == "/api/codex/restore-target")
            {
                if (!IsAllowedOrigin(request))
                {
                    SendJson(context.Response, 403, "{\"ok\":false,\"error\":\"来源未授权\"}");
                    return true;
                }
                SendJson(context.Response, 200, CodexRestoreTargetJson());
                return true;
            }

            if (request.HttpMethod == "GET" && path == "/api/codex/proxy")
            {
                if (!IsAllowedOrigin(request))
                {
                    SendJson(context.Response, 403, "{\"ok\":false,\"error\":\"来源未授权\"}");
                    return true;
                }
                SendJson(context.Response, 200, "{\"ok\":true,\"codex_proxy\":" + CodexProxyStatusJson() + "}");
                return true;
            }

            if (request.HttpMethod == "POST" && path == "/api/codex/proxy/install")
            {
                if (!IsAllowedOrigin(request))
                {
                    SendJson(context.Response, 403, "{\"ok\":false,\"error\":\"来源未授权\"}");
                    return true;
                }
                SendJson(context.Response, 200, InstallCodexProxyJson());
                return true;
            }

            if (request.HttpMethod == "POST" && path == "/api/codex/proxy/uninstall")
            {
                if (!IsAllowedOrigin(request))
                {
                    SendJson(context.Response, 403, "{\"ok\":false,\"error\":\"来源未授权\"}");
                    return true;
                }
                SendJson(context.Response, 200, UninstallCodexProxyJson());
                return true;
            }

            if (request.HttpMethod == "GET" && path == "/api/auto-switch/status")
            {
                if (!IsAllowedOrigin(request))
                {
                    SendJson(context.Response, 403, "{\"ok\":false,\"error\":\"来源未授权\"}");
                    return true;
                }
                SendJson(context.Response, 200, "{\"ok\":true,\"auto_switch\":" + AutoSwitchStatusJson() + "}");
                return true;
            }

            if (request.HttpMethod == "POST" && path == "/api/auto-switch/configure")
            {
                if (!IsAllowedOrigin(request))
                {
                    SendJson(context.Response, 403, "{\"ok\":false,\"error\":\"来源未授权\"}");
                    return true;
                }

                var body = ReadBody(request);
                ConfigureAutoSwitch(body);
                SendJson(context.Response, 200, "{\"ok\":true,\"auto_switch\":" + AutoSwitchStatusJson() + "}");
                return true;
            }

            if (request.HttpMethod == "POST" && path == "/api/pair")
            {
                if (!IsAllowedOrigin(request))
                {
                    SendJson(context.Response, 403, "{\"ok\":false,\"error\":\"来源未授权\"}");
                    return true;
                }

                ReadBody(request);
                SendJson(
                    context.Response,
                    200,
                    "{\"ok\":true,\"mode\":\"native-helper\",\"port\":" + _port + ",\"paired\":true,\"paired_at\":\"" + JsonEscape(DateTime.UtcNow.ToString("o")) + "\"}"
                );
                return true;
            }

            if (request.HttpMethod == "GET" && path == "/api/current-auth")
            {
                if (!IsAllowedOrigin(request))
                {
                    SendJson(context.Response, 403, "{\"ok\":false,\"error\":\"来源未授权\"}");
                    return true;
                }

                var target = CurrentAuthPath();
                if (!File.Exists(target))
                {
                    SendJson(context.Response, 404, "{\"ok\":false,\"error\":\"未找到当前 auth.json\"}");
                    return true;
                }

                var authJson = File.ReadAllText(target, Encoding.UTF8).Trim();
                ValidateAuthJson(authJson);
                SendJson(
                    context.Response,
                    200,
                    "{\"ok\":true,\"path\":\"" + JsonEscape(target) + "\",\"authJson\":" + authJson + "}"
                );
                return true;
            }

            if (request.HttpMethod == "GET" && path == "/api/oauth/callback/latest")
            {
                if (!IsAllowedOrigin(request))
                {
                    SendJson(context.Response, 403, "{\"ok\":false,\"error\":\"来源未授权\"}");
                    return true;
                }
                string url;
                string code;
                string stateValue;
                string error;
                DateTime receivedAt;
                lock (_oauthCallbackLock)
                {
                    url = _lastOauthCallbackUrl;
                    code = _lastOauthCallbackCode;
                    stateValue = _lastOauthCallbackState;
                    error = _lastOauthCallbackError;
                    receivedAt = _lastOauthCallbackAt;
                }
                var requestedState = request.QueryString["state"] ?? "";
                var fresh = receivedAt != DateTime.MinValue && (DateTime.UtcNow - receivedAt).TotalMinutes < 10;
                var stateMatches = string.IsNullOrEmpty(requestedState) || string.IsNullOrEmpty(stateValue) || requestedState == stateValue;
                if (!fresh || !stateMatches)
                {
                    SendJson(context.Response, 200, "{\"ok\":true,\"pending\":true}");
                    return true;
                }
                SendJson(context.Response, 200, "{"
                    + "\"ok\":true,"
                    + "\"pending\":false,"
                    + "\"url\":\"" + JsonEscape(url) + "\","
                    + "\"code\":\"" + JsonEscape(code) + "\","
                    + "\"state\":\"" + JsonEscape(stateValue) + "\","
                    + "\"error\":\"" + JsonEscape(error) + "\","
                    + "\"receivedAt\":\"" + JsonEscape(receivedAt.ToString("o")) + "\""
                    + "}");
                return true;
            }

            if (request.HttpMethod == "POST" && path == "/api/apply-auth")
            {
                if (!IsAllowedOrigin(request))
                {
                    SendJson(context.Response, 403, "{\"ok\":false,\"error\":\"来源未授权\"}");
                    return true;
                }

                var body = ReadBody(request);
                var launch = !Regex.IsMatch(body, "\"launch\"\\s*:\\s*false", RegexOptions.IgnoreCase);
                var restart = Regex.IsMatch(body, "\"restart\"\\s*:\\s*true", RegexOptions.IgnoreCase);
                var allowAtExperimental = MatchJsonBool(body, "allowAtExperimental", false);
                var authJson = NormalizeAuthJsonForCodex(ExtractAuthJson(body), allowAtExperimental);
                ValidateAuthJson(authJson);
                if (restart || launch)
                {
                    Log("后台切换已接管，等待关闭 Codex 后写入 auth.json。");
                    ThreadPool.QueueUserWorkItem(delegate { RunSwitchJob(authJson, restart, launch); });
                    SendJson(
                        context.Response,
                        200,
                        "{\"ok\":true,\"accepted\":true,\"target\":\"" + JsonEscape(CurrentAuthPath()) + "\",\"backup\":null" +
                        ",\"launched\":" + (launch ? "true" : "false") +
                        ",\"stopped_count\":0" +
                        ",\"stopped_process_count\":0" +
                        ",\"launch_mode\":\"后台任务已接管，将关闭并重启 Codex\"}"
                    );
                    return true;
                }
                var result = WriteAuthJson(authJson);
                BeginInvoke(new Action(RefreshAuthStatus));
                Log("已写入 auth.json：" + result.Target);
                if (result.Backup != null) Log("已备份：" + result.Backup);
                SendJson(
                    context.Response,
                    200,
                    "{\"ok\":true,\"accepted\":false,\"target\":\"" + JsonEscape(result.Target) + "\",\"backup\":" +
                    (result.Backup == null ? "null" : "\"" + JsonEscape(result.Backup) + "\"") +
                    ",\"launched\":false" +
                    ",\"stopped_count\":0" +
                    ",\"stopped_process_count\":0" +
                    ",\"launch_mode\":\"只写入 auth.json\"}"
                );
                return true;
            }

            if (request.HttpMethod == "POST" && path == "/api/usage/preview")
            {
                if (!IsAllowedOrigin(request))
                {
                    SendJson(context.Response, 403, "{\"ok\":false,\"error\":\"来源未授权\"}");
                    return true;
                }

                string authJson = null;
                try
                {
                    var body = ReadBody(request);
                    authJson = ExtractAuthJson(body);
                    ValidateAuthJson(authJson);
                    var usageJson = FetchUsageSnapshotJson(authJson);
                    SendJson(context.Response, 200, "{\"ok\":true,\"usage_snapshot\":" + usageJson + "}");
                }
                catch (Exception ex)
                {
                    var plan = authJson == null ? "" : PlanFromAuthJson(authJson);
                    SendJson(
                        context.Response,
                        200,
                        "{\"ok\":false,\"error\":\"" + JsonEscape(ex.Message) + "\",\"usage_snapshot\":" + FallbackUsageJson(plan) + "}"
                    );
                }
                return true;
            }

            return false;
        }

        private static string ReadBody(HttpListenerRequest request)
        {
            using (var reader = new StreamReader(request.InputStream, request.ContentEncoding ?? Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }

        private static string ExtractAuthJson(string body)
        {
            var match = Regex.Match(body, "\"authJson\"\\s*:");
            if (!match.Success)
            {
                return body.Trim();
            }

            var start = match.Index + match.Length;
            while (start < body.Length && char.IsWhiteSpace(body[start])) start++;
            if (start >= body.Length || body[start] != '{')
            {
                throw new InvalidOperationException("authJson 必须是对象");
            }

            var depth = 0;
            var inString = false;
            var escaped = false;
            for (var i = start; i < body.Length; i++)
            {
                var ch = body[i];
                if (inString)
                {
                    if (escaped)
                    {
                        escaped = false;
                    }
                    else if (ch == '\\')
                    {
                        escaped = true;
                    }
                    else if (ch == '"')
                    {
                        inString = false;
                    }
                    continue;
                }

                if (ch == '"')
                {
                    inString = true;
                }
                else if (ch == '{')
                {
                    depth++;
                }
                else if (ch == '}')
                {
                    depth--;
                    if (depth == 0)
                    {
                        return body.Substring(start, i - start + 1);
                    }
                }
            }

            throw new InvalidOperationException("authJson 不完整");
        }

        private static void ValidateAuthJson(string authJson)
        {
            if (!Regex.IsMatch(authJson, "\"tokens\"\\s*:"))
            {
                throw new InvalidOperationException("authJson 缺少 tokens");
            }
            if (!Regex.IsMatch(authJson, "\"access_token\"\\s*:\\s*\"[^\"]+\""))
            {
                throw new InvalidOperationException("authJson 缺少 tokens.access_token");
            }
        }

        private static string NormalizeAuthJsonForCodex(string authJson)
        {
            return NormalizeAuthJsonForCodex(authJson, false);
        }

        private static string NormalizeAuthJsonForCodex(string authJson, bool allowAtExperimental)
        {
            ValidateAuthJson(authJson);
            var accessToken = MatchJsonString(authJson, "access_token");
            var accountId = MatchJsonString(authJson, "account_id");
            if (string.IsNullOrEmpty(accountId))
            {
                accountId = AccountIdFromJwt(accessToken);
            }
            var refreshToken = MatchJsonString(authJson, "refresh_token");
            var hasRefreshToken = !string.IsNullOrEmpty(refreshToken)
                && refreshToken != accessToken
                && !string.Equals(refreshToken, "rt_mock_token", StringComparison.OrdinalIgnoreCase);
            if (!hasRefreshToken && !allowAtExperimental)
            {
                throw new InvalidOperationException("当前 auth 缺少可用 refresh_token，AT-only 不支持 Codex 使用。请重新登录 Codex 获取 RT。");
            }
            if (!hasRefreshToken)
            {
                refreshToken = "rt_mock_token";
            }

            return "{\n"
                + "  \"auth_mode\": \"chatgpt\",\n"
                + "  \"OPENAI_API_KEY\": null,\n"
                + "  \"tokens\": {\n"
                + "    \"id_token\": \"" + JsonEscape(accessToken) + "\",\n"
                + "    \"access_token\": \"" + JsonEscape(accessToken) + "\",\n"
                + "    \"refresh_token\": \"" + JsonEscape(refreshToken) + "\",\n"
                + "    \"account_id\": \"" + JsonEscape(accountId) + "\"\n"
                + "  },\n"
                + "  \"last_refresh\": \"" + JsonEscape(DateTime.UtcNow.ToString("o")) + "\"\n"
                + "}";
        }

        private static string FetchUsageSnapshotJson(string authJson)
        {
            var accessToken = MatchJsonString(authJson, "access_token");
            var accountId = MatchJsonString(authJson, "account_id");
            var plan = PlanFromAuthJson(authJson);
            if (string.IsNullOrEmpty(accountId))
            {
                accountId = AccountIdFromJwt(accessToken);
            }
            if (string.IsNullOrEmpty(accountId))
            {
                throw new InvalidOperationException("未识别到 ChatGPT-Account-Id");
            }

            var urls = new[]
            {
                "https://chatgpt.com/backend-api/wham/usage",
                "https://chatgpt.com/wham/usage",
                "https://chatgpt.com/api/codex/usage"
            };
            var errors = "";
            foreach (var url in urls)
            {
                try
                {
                    var payload = DownloadUsagePayload(url, accessToken, accountId);
                    return MapUsagePayloadJson(payload, plan);
                }
                catch (Exception ex)
                {
                    if (errors.Length > 0) errors += " | ";
                    errors += url + " -> " + ex.Message;
                }
            }
            throw new InvalidOperationException(errors.Length == 0 ? "请求用量接口失败" : errors);
        }

        private static string DownloadUsagePayload(string url, string accessToken, string accountId)
        {
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.Method = "GET";
            request.Timeout = 18000;
            request.ReadWriteTimeout = 18000;
            request.UserAgent = "codex-dock-helper/" + HelperVersion;
            request.Accept = "application/json";
            request.Headers["Authorization"] = "Bearer " + accessToken;
            request.Headers["ChatGPT-Account-Id"] = accountId;
            try
            {
                using (var response = (HttpWebResponse)request.GetResponse())
                using (var stream = response.GetResponseStream())
                using (var reader = new StreamReader(stream, Encoding.UTF8))
                {
                    return reader.ReadToEnd();
                }
            }
            catch (WebException ex)
            {
                if (ex.Response != null)
                {
                    using (var response = (HttpWebResponse)ex.Response)
                    using (var stream = response.GetResponseStream())
                    using (var reader = new StreamReader(stream, Encoding.UTF8))
                    {
                        var body = reader.ReadToEnd();
                        if (body.Length > 140) body = body.Substring(0, 140);
                        throw new InvalidOperationException(((int)response.StatusCode) + ": " + body);
                    }
                }
                throw;
            }
        }

        private static string MapUsagePayloadJson(string payload, string fallbackPlan)
        {
            var plan = MatchJsonString(payload, "plan_type");
            if (string.IsNullOrEmpty(plan)) plan = fallbackPlan;
            var windows = Regex.Matches(
                payload,
                "\\{[^{}]*\"used_percent\"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)[^{}]*\"limit_window_seconds\"\\s*:\\s*(\\d+)[^{}]*\"reset_at\"\\s*:\\s*(\\d+)[^{}]*\\}",
                RegexOptions.IgnoreCase
            );
            return "{"
                + "\"fetched_at\":" + UnixNow() + ","
                + "\"refreshed_at\":\"" + JsonEscape(DateTime.UtcNow.ToString("o")) + "\","
                + "\"plan_type\":\"" + JsonEscape(plan) + "\","
                + "\"five_hour\":" + NearestUsageWindowJson(windows, 5 * 60 * 60) + ","
                + "\"one_week\":" + NearestUsageWindowJson(windows, 7 * 24 * 60 * 60) + ","
                + "\"credits\":null"
                + "}";
        }

        private static string NearestUsageWindowJson(MatchCollection windows, int targetSeconds)
        {
            Match best = null;
            long bestDistance = long.MaxValue;
            foreach (Match match in windows)
            {
                long seconds;
                if (!long.TryParse(match.Groups[2].Value, out seconds)) continue;
                var distance = Math.Abs(seconds - targetSeconds);
                if (distance < bestDistance)
                {
                    bestDistance = distance;
                    best = match;
                }
            }
            if (best == null) return "null";
            var used = double.Parse(best.Groups[1].Value, CultureInfo.InvariantCulture);
            return "{"
                + "\"used_percent\":" + used.ToString("0.##", CultureInfo.InvariantCulture) + ","
                + "\"window_seconds\":" + best.Groups[2].Value + ","
                + "\"reset_at\":" + best.Groups[3].Value
                + "}";
        }

        private static string FallbackUsageJson(string plan)
        {
            return "{"
                + "\"fetched_at\":" + UnixNow() + ","
                + "\"refreshed_at\":\"" + JsonEscape(DateTime.UtcNow.ToString("o")) + "\","
                + "\"plan_type\":\"" + JsonEscape(plan) + "\","
                + "\"five_hour\":null,"
                + "\"one_week\":null,"
                + "\"credits\":null"
                + "}";
        }

        private static long UnixNow()
        {
            return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalSeconds;
        }

        private static string PlanFromAuthJson(string authJson)
        {
            var accessToken = MatchJsonString(authJson, "access_token");
            var plan = MatchJsonString(JwtPayloadJson(accessToken), "chatgpt_plan_type");
            if (!string.IsNullOrEmpty(plan)) return plan;
            var idToken = MatchJsonString(authJson, "id_token");
            return MatchJsonString(JwtPayloadJson(idToken), "chatgpt_plan_type");
        }

        private static string AccountIdFromJwt(string accessToken)
        {
            var payload = JwtPayloadJson(accessToken);
            var accountId = MatchJsonString(payload, "chatgpt_account_id");
            if (!string.IsNullOrEmpty(accountId)) return accountId;
            return MatchJsonString(payload, "chatgpt_account_user_id");
        }

        private static string AuthSubject(string authJson)
        {
            var email = EmailFromAuthJson(authJson);
            var accountId = MatchJsonString(authJson, "account_id");
            if (string.IsNullOrEmpty(accountId)) accountId = AccountIdFromJwt(MatchJsonString(authJson, "access_token"));
            var plan = PlanFromAuthJson(authJson);
            var label = !string.IsNullOrEmpty(email) ? email : (!string.IsNullOrEmpty(accountId) ? ShortText(accountId, 18) : "未知账号");
            return label + (string.IsNullOrEmpty(plan) ? "" : " · " + plan.ToUpperInvariant());
        }

        private static string JwtPayloadJson(string token)
        {
            if (string.IsNullOrEmpty(token)) return "";
            var parts = token.Split('.');
            if (parts.Length < 2) return "";
            try
            {
                var payload = parts[1].Replace('-', '+').Replace('_', '/');
                while (payload.Length % 4 != 0) payload += "=";
                return Encoding.UTF8.GetString(Convert.FromBase64String(payload));
            }
            catch
            {
                return "";
            }
        }

        private bool RunSwitchJob(string authJson, bool restart, bool launch)
        {
            var jobId = DateTime.Now.ToString("HHmmss", CultureInfo.InvariantCulture);
            var subject = AuthSubject(authJson);
            ShowOperationProgress("切换 Codex 授权", "任务 " + jobId + " 正在准备目标账号：" + subject, 4);
            try
            {
                Log("切换任务 " + jobId + " 开始：目标 " + subject + "，restart=" + (restart ? "true" : "false") + "，launch=" + (launch ? "true" : "false"));
                UpdateOperationProgress(12, "正在定位当前 Codex 窗口与目标任务。");
                var restoreTarget = launch ? CaptureCodexRestoreTarget() : null;
                if (restoreTarget != null)
                {
                    Log("切换任务 " + jobId + " 目标窗口：" + (restoreTarget.IsGoal ? "目标任务" : "会话") + " " + ShortText(restoreTarget.ThreadId, 12) + " · " + restoreTarget.Source);
                    UpdateOperationProgress(24, "已记录待恢复窗口：" + (restoreTarget.IsGoal ? "目标任务" : "普通会话") + " " + ShortText(restoreTarget.ThreadId, 12));
                }
                else if (launch)
                {
                    Log("切换任务 " + jobId + " 目标窗口：未识别，将按 Codex 默认窗口启动。");
                    UpdateOperationProgress(24, "未识别目标窗口，将按 Codex 默认窗口启动。");
                }
                var stoppedCount = 0;
                if (restart)
                {
                    UpdateOperationProgress(36, "正在关闭旧 Codex 进程，避免 auth 写入冲突。");
                    stoppedCount = StopCodexInstances();
                    Log("切换任务 " + jobId + " 已关闭 Codex 实例数：" + stoppedCount);
                    UpdateOperationProgress(48, "已关闭 Codex 实例数：" + stoppedCount);
                }
                else
                {
                    UpdateOperationProgress(48, "无需关闭 Codex，准备写入 auth.json。");
                }

                Thread.Sleep(700);
                UpdateOperationProgress(60, "正在备份并写入新的 auth.json。");
                var rewrite = WriteAuthJson(authJson);
                Log("切换任务 " + jobId + " 已写入 auth.json：" + rewrite.Target);
                if (rewrite.Backup != null) Log("切换任务 " + jobId + " 已备份旧 auth：" + rewrite.Backup);
                ClearRuntimePendingSwitch();
                BeginInvoke(new Action(RefreshAuthStatus));
                UpdateOperationProgress(70, "auth.json 已写入，正在刷新本地授权状态。");

                var launchResult = "";
                var restoreResult = "";
                var goalResult = "";
                if (launch)
                {
                    Thread.Sleep(500);
                    UpdateOperationProgress(80, "正在启动 Codex。");
                    launchResult = LaunchCodex();
                    Log("切换任务 " + jobId + " " + launchResult);
                    if (restoreTarget != null)
                    {
                        Thread.Sleep(2200);
                        UpdateOperationProgress(88, "正在恢复切换前的 Codex 窗口。");
                        restoreResult = RestoreCodexWindow(restoreTarget);
                        Log("切换任务 " + jobId + " " + restoreResult);
                        UpdateOperationProgress(94, "正在恢复目标状态。");
                        goalResult = RestoreCodexGoalIfNeeded(restoreTarget);
                        if (!string.IsNullOrEmpty(goalResult)) Log("切换任务 " + jobId + " " + goalResult);
                    }
                }
                Log("切换任务 " + jobId + " 成功：目标 " + subject + "，已写入 auth" + (launch ? "，已请求启动 Codex" : "") + (restoreTarget != null ? "，已请求恢复窗口" : "") + "。");
                CompleteOperationProgress(true, "切换完成：" + subject);
                return true;
            }
            catch (Exception ex)
            {
                Log("切换任务 " + jobId + " 失败：目标 " + subject + "，" + ex.Message);
                CompleteOperationProgress(false, "切换失败：" + ex.Message);
                return false;
            }
        }

        private AuthWriteResult WriteAuthJson(string authJson)
        {
            return WriteAuthJson(authJson, true);
        }

        private AuthWriteResult WriteAuthJson(string authJson, bool createBackup)
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex");
            Directory.CreateDirectory(dir);
            var target = Path.Combine(dir, "auth.json");
            string backup = null;
            if (createBackup && File.Exists(target))
            {
                backup = target + ".bak-" + DateTime.Now.ToString("yyyyMMdd-HHmmss");
                File.Copy(target, backup, true);
            }
            var temp = target + ".tmp-" + Process.GetCurrentProcess().Id + "-" + DateTime.Now.Ticks;
            File.WriteAllText(temp, authJson + Environment.NewLine, new UTF8Encoding(false));
            if (File.Exists(target)) File.Delete(target);
            File.Move(temp, target);
            lock (_authSyncLock)
            {
                var fingerprint = AuthFingerprint(authJson);
                _lastHelperWrittenAuthFingerprint = fingerprint;
                _pendingPostSwitchAuthCompareFingerprint = fingerprint;
                _pendingPostSwitchAuthCompareAfter = DateTime.UtcNow.AddSeconds(45);
            }
            ClearRuntimePendingSwitch();
            return new AuthWriteResult { Target = target, Backup = backup };
        }

        private void ImportAndApplyAuthJson()
        {
            using (var dialog = new OpenFileDialog())
            {
                dialog.Title = "选择 auth.json";
                dialog.Filter = "auth.json (*.json)|*.json|All files (*.*)|*.*";
                if (dialog.ShowDialog(this) != DialogResult.OK) return;

                try
                {
                    var authJson = NormalizeAuthJsonForCodex(File.ReadAllText(dialog.FileName, Encoding.UTF8).Trim());
                    ValidateAuthJson(authJson);
                    var result = WriteAuthJson(authJson);
                    Log("已导入并应用：" + dialog.FileName);
                    Log("已写入 auth.json：" + result.Target);
                    if (result.Backup != null) Log("已备份：" + result.Backup);
                    RefreshAuthStatus();
                }
                catch (Exception ex)
                {
                    MessageBox.Show(this, ex.Message, "导入失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    Log("导入失败：" + ex.Message);
                }
            }
        }

        private void BackupCurrentAuth()
        {
            try
            {
                var target = CurrentAuthPath();
                if (!File.Exists(target))
                {
                    MessageBox.Show(this, "当前没有 auth.json。", "备份", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                var backup = target + ".manual-bak-" + DateTime.Now.ToString("yyyyMMdd-HHmmss");
                File.Copy(target, backup, true);
                Log("已备份当前 auth：" + backup);
                RefreshAuthStatus();
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "备份失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Log("备份失败：" + ex.Message);
            }
        }

        private void LaunchCodexWithLog()
        {
            try
            {
                Log(LaunchCodex());
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Log("启动 Codex 失败：" + ex.Message);
            }
        }

        private void RefreshAuthStatus()
        {
            SetAuthStatus(CurrentAuthSummaryText());
        }

        private static string CurrentAuthSummaryText()
        {
            try
            {
                var target = CurrentAuthPath();
                if (!File.Exists(target))
                {
                    return "当前 auth：未找到 " + target;
                }
                var raw = File.ReadAllText(target, Encoding.UTF8);
                var email = MatchJsonString(raw, "email");
                var accountId = MatchJsonString(raw, "account_id");
                var accessToken = MatchJsonString(raw, "access_token");
                var refreshToken = MatchJsonString(raw, "refresh_token");
                var expires = JwtExpiry(accessToken);
                var rtState = string.IsNullOrEmpty(refreshToken)
                    ? "RT 缺失（不支持 Codex）"
                    : (refreshToken == accessToken || string.Equals(refreshToken, "rt_mock_token", StringComparison.OrdinalIgnoreCase)
                        ? "RT 占位（不支持 Codex）"
                        : "RT 存在");
                var shortAccount = ShortText(!string.IsNullOrEmpty(email) ? email : accountId, 28);
                var expiryText = expires.HasValue ? "AT 到期 " + expires.Value.ToLocalTime().ToString("yyyy-MM-dd HH:mm") : "AT 到期未知";
                return "当前 auth：" + shortAccount + " · " + rtState + " · " + expiryText;
            }
            catch (Exception ex)
            {
                return "当前 auth：读取失败 " + ex.Message;
            }
        }

        private static string CurrentAuthPath()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex", "auth.json");
        }

        private static string AuthFingerprint(string authJson)
        {
            var seed = (MatchJsonString(authJson, "account_id") ?? "")
                + "\n" + (MatchJsonString(authJson, "access_token") ?? "")
                + "\n" + (MatchJsonString(authJson, "refresh_token") ?? "");
            using (var sha = SHA256.Create())
            {
                var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(seed));
                var sb = new StringBuilder(bytes.Length * 2);
                foreach (var b in bytes) sb.Append(b.ToString("x2", CultureInfo.InvariantCulture));
                return sb.ToString();
            }
        }

        private static string DockDataDir()
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CodexDock");
            Directory.CreateDirectory(dir);
            return dir;
        }

        private static string AutoSwitchConfigPath()
        {
            return Path.Combine(DockDataDir(), "auto-switch.json");
        }

        private static string CodexProxyConfigPath()
        {
            return Path.Combine(DockDataDir(), "app-server-proxy.json");
        }

        private static string CodexProxyStatusPath()
        {
            return Path.Combine(DockDataDir(), "codex-app-server-proxy-status.json");
        }

        private static string HelperLogPath()
        {
            return Path.Combine(DockDataDir(), "helper.log");
        }

        private string CodexProxyExePath()
        {
            return Path.Combine(_root, "CodexAppServerProxy.exe");
        }

        private static AutoSwitchConfig LoadAutoSwitchConfig()
        {
            try
            {
                var path = AutoSwitchConfigPath();
                if (!File.Exists(path)) return new AutoSwitchConfig();
                var raw = File.ReadAllText(path, Encoding.UTF8);
                return new AutoSwitchConfig
                {
                    Enabled = Regex.IsMatch(raw, "\"enabled\"\\s*:\\s*true", RegexOptions.IgnoreCase),
                    CloudBase = MatchJsonString(raw, "cloudBase"),
                    DeviceToken = MatchJsonString(raw, "deviceToken"),
                    DeviceKey = MatchJsonString(raw, "deviceKey"),
                    DeviceTokenExpiresAt = MatchJsonString(raw, "deviceTokenExpiresAt"),
                    CloudLastSyncAt = MatchJsonString(raw, "cloudLastSyncAt"),
                    LastSwitchAt = MatchJsonString(raw, "lastSwitchAt"),
                    LastSwitchLabel = MatchJsonString(raw, "lastSwitchLabel"),
                    FiveHourThreshold = MatchJsonInt(raw, "fiveHourThreshold", 5),
                    OneWeekThreshold = MatchJsonInt(raw, "oneWeekThreshold", 5),
                    PollSeconds = MatchJsonInt(raw, "pollSeconds", 15),
                    IdlePollSeconds = MatchJsonInt(raw, "idlePollSeconds", 300),
                    GlobalCooldownSeconds = MatchJsonInt(raw, "globalCooldownSeconds", 180),
                    CooldownMinutes = MatchJsonInt(raw, "cooldownMinutes", 10),
                    OnlyWhenIdle = MatchJsonBool(raw, "onlyWhenIdle", true),
                    IdleSeconds = MatchJsonInt(raw, "idleSeconds", 10),
                    ActivityQuietSeconds = MatchJsonInt(raw, "activityQuietSeconds", 120),
                    CpuQuietSeconds = MatchJsonInt(raw, "cpuQuietSeconds", 90),
                    CpuBusyPercent = MatchJsonInt(raw, "cpuBusyPercent", 3),
                }.Clamp();
            }
            catch
            {
                return new AutoSwitchConfig();
            }
        }

        private static void SaveAutoSwitchConfig(AutoSwitchConfig config)
        {
            var json = "{"
                + "\"enabled\":" + (config.Enabled ? "true" : "false") + ","
                + "\"cloudBase\":\"" + JsonEscape(config.CloudBase) + "\","
                + "\"deviceToken\":\"" + JsonEscape(config.DeviceToken) + "\","
                + "\"deviceKey\":\"" + JsonEscape(config.DeviceKey) + "\","
                + "\"deviceTokenExpiresAt\":\"" + JsonEscape(config.DeviceTokenExpiresAt) + "\","
                + "\"cloudLastSyncAt\":\"" + JsonEscape(config.CloudLastSyncAt) + "\","
                + "\"lastSwitchAt\":\"" + JsonEscape(config.LastSwitchAt) + "\","
                + "\"lastSwitchLabel\":\"" + JsonEscape(config.LastSwitchLabel) + "\","
                + "\"fiveHourThreshold\":" + config.FiveHourThreshold + ","
                + "\"oneWeekThreshold\":" + config.OneWeekThreshold + ","
                + "\"pollSeconds\":" + config.PollSeconds + ","
                + "\"idlePollSeconds\":" + config.IdlePollSeconds + ","
                + "\"globalCooldownSeconds\":" + config.GlobalCooldownSeconds + ","
                + "\"cooldownMinutes\":" + config.CooldownMinutes + ","
                + "\"onlyWhenIdle\":" + (config.OnlyWhenIdle ? "true" : "false") + ","
                + "\"idleSeconds\":" + config.IdleSeconds + ","
                + "\"activityQuietSeconds\":" + config.ActivityQuietSeconds + ","
                + "\"cpuQuietSeconds\":" + config.CpuQuietSeconds + ","
                + "\"cpuBusyPercent\":" + config.CpuBusyPercent
                + "}";
            File.WriteAllText(AutoSwitchConfigPath(), json, new UTF8Encoding(false));
        }

        private string AutoSwitchStatusJson()
        {
            var config = GetAutoSwitchConfig();
            return "{"
                + "\"enabled\":" + (config.Enabled ? "true" : "false") + ","
                + "\"authorized\":" + (!string.IsNullOrEmpty(config.DeviceToken) ? "true" : "false") + ","
                + "\"cloud_base\":\"" + JsonEscape(config.CloudBase) + "\","
                + "\"device_key\":\"" + JsonEscape(config.DeviceKey) + "\","
                + "\"last_check\":\"" + JsonEscape(_lastAutoSwitchCheckAt == DateTime.MinValue ? "" : _lastAutoSwitchCheckAt.ToString("o")) + "\","
                + "\"last_switch\":\"" + JsonEscape(_lastAutoSwitchAt == DateTime.MinValue ? config.LastSwitchAt : _lastAutoSwitchAt.ToString("o")) + "\","
                + "\"last_switch_label\":\"" + JsonEscape(config.LastSwitchLabel) + "\","
                + "\"last_reason\":\"" + JsonEscape(_lastAutoSwitchReason) + "\","
                + "\"last_result\":\"" + JsonEscape(_lastAutoSwitchResult) + "\","
                + "\"token_expires_at\":\"" + JsonEscape(config.DeviceTokenExpiresAt) + "\","
                + "\"cloud_last_sync\":\"" + JsonEscape(config.CloudLastSyncAt) + "\","
                + "\"only_when_idle\":" + (config.OnlyWhenIdle ? "true" : "false") + ","
                + "\"poll_seconds\":" + config.PollSeconds + ","
                + "\"effective_poll_seconds\":" + EffectiveAutoSwitchPollSeconds(config)
                + "}";
        }

        private string CodexStatusJson()
        {
            lock (_codexStatusLock)
            {
                return _codexStatus.ToJson();
            }
        }

        private string RefreshCodexStatusJson()
        {
            return RefreshCodexStatusNow().ToJson();
        }

        private string CodexRestoreTargetJson()
        {
            var target = CaptureCodexRestoreTarget();
            if (target == null)
            {
                return "{\"ok\":true,\"available\":false,\"thread_id\":\"\",\"url\":\"\",\"source\":\"\",\"title\":\"\",\"cwd\":\"\",\"is_goal\":false,\"reason\":\"\"}";
            }
            return "{\"ok\":true,\"available\":true,\"thread_id\":\"" + JsonEscape(target.ThreadId)
                + "\",\"url\":\"" + JsonEscape(target.Url)
                + "\",\"source\":\"" + JsonEscape(target.Source)
                + "\",\"title\":\"" + JsonEscape(target.Title)
                + "\",\"cwd\":\"" + JsonEscape(target.Cwd)
                + "\",\"is_goal\":" + (target.IsGoal ? "true" : "false")
                + ",\"reason\":\"" + JsonEscape(target.Reason) + "\"}";
        }

        private string CodexProxyStatusJson()
        {
            var proxyPath = CodexProxyExePath();
            var userCli = GetUserEnvironmentVariable("CODEX_CLI_PATH");
            var processCli = Environment.GetEnvironmentVariable("CODEX_CLI_PATH") ?? "";
            var userReal = GetUserEnvironmentVariable("CODEX_DOCK_REAL_CODEX_CLI_PATH");
            var realPath = ResolveRealCodexCliPath();
            var installed = File.Exists(proxyPath);
            var enabled = IsSamePath(userCli, proxyPath) || IsSamePath(processCli, proxyPath);
            var statusRaw = "";
            try
            {
                if (enabled && File.Exists(CodexProxyStatusPath())) statusRaw = File.ReadAllText(CodexProxyStatusPath(), Encoding.UTF8);
            }
            catch { }

            return "{"
                + "\"installed\":" + (installed ? "true" : "false") + ","
                + "\"enabled\":" + (enabled ? "true" : "false") + ","
                + "\"startup_hook_disabled\":true,"
                + "\"requires_codex_restart\":" + (enabled ? "true" : "false") + ","
                + "\"proxy_path\":\"" + JsonEscape(proxyPath) + "\","
                + "\"real_codex_path\":\"" + JsonEscape(realPath) + "\","
                + "\"user_codex_cli_path\":\"" + JsonEscape(userCli) + "\","
                + "\"process_codex_cli_path\":\"" + JsonEscape(processCli) + "\","
                + "\"user_real_codex_cli_path\":\"" + JsonEscape(userReal) + "\","
                + "\"status\":" + (string.IsNullOrWhiteSpace(statusRaw) ? "null" : statusRaw)
                + "}";
        }

        private string InstallCodexProxyJson()
        {
            try
            {
                RepairCodexStartupChain();
                return "{\"ok\":false,\"error\":\"为避免 Codex 启动链路死锁，精准监控代理安装已停用。当前会继续使用安全的保守监控。\",\"codex_proxy\":" + CodexProxyStatusJson() + "}";
            }
            catch (Exception ex)
            {
                return "{\"ok\":false,\"error\":\"" + JsonEscape(ex.Message) + "\",\"codex_proxy\":" + CodexProxyStatusJson() + "}";
            }
        }

        private string UninstallCodexProxyJson()
        {
            try
            {
                var proxyPath = CodexProxyExePath();
                var previous = MatchJsonString(ReadTextIfExists(CodexProxyConfigPath()), "previousUserCodexCliPath");
                if (!string.IsNullOrWhiteSpace(previous) && !IsSamePath(previous, proxyPath))
                {
                    Environment.SetEnvironmentVariable("CODEX_CLI_PATH", previous, EnvironmentVariableTarget.User);
                    Environment.SetEnvironmentVariable("CODEX_CLI_PATH", previous);
                }
                else
                {
                    Environment.SetEnvironmentVariable("CODEX_CLI_PATH", null, EnvironmentVariableTarget.User);
                    Environment.SetEnvironmentVariable("CODEX_CLI_PATH", null);
                }
                Environment.SetEnvironmentVariable("CODEX_DOCK_REAL_CODEX_CLI_PATH", null, EnvironmentVariableTarget.User);
                Environment.SetEnvironmentVariable("CODEX_DOCK_REAL_CODEX_CLI_PATH", null);
                try { if (File.Exists(CodexProxyConfigPath())) File.Delete(CodexProxyConfigPath()); } catch { }
                try { if (File.Exists(CodexProxyStatusPath())) File.Delete(CodexProxyStatusPath()); } catch { }
                BroadcastEnvironmentChange();
                Log("精准状态监控代理已关闭。重启 Codex 后恢复默认启动方式。");
                return "{\"ok\":true,\"message\":\"精准状态监控已关闭，重启 Codex 后生效。\",\"codex_proxy\":" + CodexProxyStatusJson() + "}";
            }
            catch (Exception ex)
            {
                return "{\"ok\":false,\"error\":\"" + JsonEscape(ex.Message) + "\",\"codex_proxy\":" + CodexProxyStatusJson() + "}";
            }
        }

        private static string ReadTextIfExists(string path)
        {
            try
            {
                return File.Exists(path) ? File.ReadAllText(path, Encoding.UTF8) : "";
            }
            catch
            {
                return "";
            }
        }

        private static string GetUserEnvironmentVariable(string name)
        {
            try
            {
                return Environment.GetEnvironmentVariable(name, EnvironmentVariableTarget.User) ?? "";
            }
            catch
            {
                return "";
            }
        }

        private static void BroadcastEnvironmentChange()
        {
            try
            {
                IntPtr result;
                SendMessageTimeout(HWND_BROADCAST, WM_SETTINGCHANGE, IntPtr.Zero, "Environment", SMTO_ABORTIFHUNG, 5000, out result);
            }
            catch { }
        }

        private void RepairCodexStartupChain()
        {
            var proxyPath = CodexProxyExePath();
            var changed = false;
            var userCli = GetUserEnvironmentVariable("CODEX_CLI_PATH");
            if (IsSamePath(userCli, proxyPath))
            {
                Environment.SetEnvironmentVariable("CODEX_CLI_PATH", null, EnvironmentVariableTarget.User);
                changed = true;
            }
            var processCli = Environment.GetEnvironmentVariable("CODEX_CLI_PATH") ?? "";
            if (IsSamePath(processCli, proxyPath))
            {
                Environment.SetEnvironmentVariable("CODEX_CLI_PATH", null);
                changed = true;
            }
            var realUser = GetUserEnvironmentVariable("CODEX_DOCK_REAL_CODEX_CLI_PATH");
            if (!string.IsNullOrWhiteSpace(realUser))
            {
                Environment.SetEnvironmentVariable("CODEX_DOCK_REAL_CODEX_CLI_PATH", null, EnvironmentVariableTarget.User);
                changed = true;
            }
            var realProcess = Environment.GetEnvironmentVariable("CODEX_DOCK_REAL_CODEX_CLI_PATH") ?? "";
            if (!string.IsNullOrWhiteSpace(realProcess))
            {
                Environment.SetEnvironmentVariable("CODEX_DOCK_REAL_CODEX_CLI_PATH", null);
                changed = true;
            }
            try { if (File.Exists(CodexProxyConfigPath())) File.Delete(CodexProxyConfigPath()); } catch { }
            try { if (File.Exists(CodexProxyStatusPath())) File.Delete(CodexProxyStatusPath()); } catch { }
            if (changed)
            {
                BroadcastEnvironmentChange();
                Log("已修复 Codex 启动链路：移除 CODEX_CLI_PATH 代理钩子。");
            }
        }

        private static string MatchJsonString(string json, string field)
        {
            var match = Regex.Match(json, "\"" + Regex.Escape(field) + "\"\\s*:\\s*\"([^\"]*)\"");
            return match.Success ? match.Groups[1].Value : "";
        }

        private static int MatchJsonInt(string json, string field, int fallback)
        {
            var match = Regex.Match(json ?? "", "\"" + Regex.Escape(field) + "\"\\s*:\\s*(-?\\d+)");
            int value;
            return match.Success && int.TryParse(match.Groups[1].Value, out value) ? value : fallback;
        }

        private static bool MatchJsonBool(string json, string field, bool fallback)
        {
            var match = Regex.Match(json ?? "", "\"" + Regex.Escape(field) + "\"\\s*:\\s*(true|false)", RegexOptions.IgnoreCase);
            if (!match.Success) return fallback;
            return string.Equals(match.Groups[1].Value, "true", StringComparison.OrdinalIgnoreCase);
        }

        private static double? MatchJsonDouble(string json, string field)
        {
            var match = Regex.Match(json ?? "", "\"" + Regex.Escape(field) + "\"\\s*:\\s*(-?[0-9]+(?:\\.[0-9]+)?)");
            double value;
            return match.Success && double.TryParse(match.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out value) ? value : (double?)null;
        }

        private static string ExtractJsonObject(string body, string field)
        {
            var match = Regex.Match(body ?? "", "\"" + Regex.Escape(field) + "\"\\s*:");
            if (!match.Success) return "";
            var start = match.Index + match.Length;
            while (start < body.Length && char.IsWhiteSpace(body[start])) start++;
            if (start >= body.Length) return "";
            if (body.Substring(start).StartsWith("null", StringComparison.OrdinalIgnoreCase)) return "null";
            if (body[start] != '{') return "";
            var depth = 0;
            var inString = false;
            var escaped = false;
            for (var i = start; i < body.Length; i++)
            {
                var ch = body[i];
                if (inString)
                {
                    if (escaped) escaped = false;
                    else if (ch == '\\') escaped = true;
                    else if (ch == '"') inString = false;
                    continue;
                }
                if (ch == '"') inString = true;
                else if (ch == '{') depth++;
                else if (ch == '}')
                {
                    depth--;
                    if (depth == 0) return body.Substring(start, i - start + 1);
                }
            }
            return "";
        }

        private static DateTime? JwtExpiry(string token)
        {
            if (string.IsNullOrEmpty(token)) return null;
            var parts = token.Split('.');
            if (parts.Length < 2) return null;
            try
            {
                var payload = parts[1].Replace('-', '+').Replace('_', '/');
                while (payload.Length % 4 != 0) payload += "=";
                var json = Encoding.UTF8.GetString(Convert.FromBase64String(payload));
                var match = Regex.Match(json, "\"exp\"\\s*:\\s*(\\d+)");
                if (!match.Success) return null;
                var seconds = long.Parse(match.Groups[1].Value);
                return new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddSeconds(seconds);
            }
            catch
            {
                return null;
            }
        }

        private static string ShortText(string value, int max)
        {
            if (string.IsNullOrEmpty(value)) return "未知账号";
            return value.Length <= max ? value : value.Substring(0, max - 3) + "...";
        }

        private static int StopCodexInstances()
        {
            var own = Process.GetCurrentProcess().Id;
            var all = new List<ProcessRecord>();
            var ids = new HashSet<int>();
            var roots = 0;

            try
            {
                using (var searcher = new ManagementObjectSearcher("SELECT ProcessId,ParentProcessId,Name,CommandLine FROM Win32_Process"))
                {
                    foreach (ManagementObject item in searcher.Get())
                    {
                        var record = new ProcessRecord
                        {
                            Id = Convert.ToInt32(item["ProcessId"]),
                            ParentId = item["ParentProcessId"] == null ? 0 : Convert.ToInt32(item["ParentProcessId"]),
                            Name = Convert.ToString(item["Name"]) ?? "",
                            CommandLine = Convert.ToString(item["CommandLine"]) ?? ""
                        };
                        all.Add(record);
                        if (IsTargetCodexProcess(record, own))
                        {
                            ids.Add(record.Id);
                            roots++;
                        }
                    }
                }
            }
            catch
            {
                return 0;
            }

            var changed = true;
            while (changed)
            {
                changed = false;
                foreach (var record in all)
                {
                    if (record.Id == own) continue;
                    if (ids.Contains(record.ParentId) && !ids.Contains(record.Id))
                    {
                        ids.Add(record.Id);
                        changed = true;
                    }
                }
            }

            var ordered = new List<int>(ids);
            ordered.Sort();
            ordered.Reverse();
            foreach (var id in ordered)
            {
                try
                {
                    var info = new ProcessStartInfo("taskkill.exe", "/PID " + id + " /T /F")
                    {
                        CreateNoWindow = true,
                        UseShellExecute = false,
                        WindowStyle = ProcessWindowStyle.Hidden
                    };
                    using (var taskkill = Process.Start(info))
                    {
                        if (taskkill != null) taskkill.WaitForExit(5000);
                    }
                }
                catch
                {
                    try { Process.GetProcessById(id).Kill(); } catch { }
                }
            }
            Thread.Sleep(900);
            return ordered.Count > roots ? ordered.Count : roots;
        }

        private static bool IsTargetCodexProcess(ProcessRecord process, int own)
        {
            if (process.Id == own) return false;
            var cmd = process.CommandLine ?? "";
            var name = process.Name ?? "";
            if (ContainsIgnoreCase(cmd, "\\.codex\\plugins\\")
                || ContainsIgnoreCase(cmd, "--listen stdio://")
                || ContainsIgnoreCase(cmd, "\\AppData\\Local\\OpenAI\\Codex\\bin\\"))
            {
                return false;
            }
            if (ContainsIgnoreCase(cmd, "\\WindowsApps\\OpenAI.Codex_")
                || ContainsIgnoreCase(cmd, "\\AppData\\Roaming\\Codex"))
            {
                return true;
            }
            return name.StartsWith("OpenAI.Codex", StringComparison.OrdinalIgnoreCase);
        }

        private static bool ContainsIgnoreCase(string value, string needle)
        {
            return value != null && value.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static bool HasCodexProcess()
        {
            var own = Process.GetCurrentProcess().Id;
            try
            {
                using (var searcher = new ManagementObjectSearcher("SELECT ProcessId,ParentProcessId,Name,CommandLine FROM Win32_Process"))
                {
                    foreach (ManagementObject item in searcher.Get())
                    {
                        var record = new ProcessRecord
                        {
                            Id = Convert.ToInt32(item["ProcessId"]),
                            ParentId = item["ParentProcessId"] == null ? 0 : Convert.ToInt32(item["ParentProcessId"]),
                            Name = Convert.ToString(item["Name"]) ?? "",
                            CommandLine = Convert.ToString(item["CommandLine"]) ?? ""
                        };
                        if (IsTargetCodexProcess(record, own)) return true;
                    }
                }
            }
            catch { }
            return false;
        }

        private void StartCodexStatusMonitor()
        {
            if (_codexStatusThread != null && _codexStatusThread.IsAlive) return;
            _codexStatusStop = false;
            _codexStatusThread = new Thread(CodexStatusLoop) { IsBackground = true };
            _codexStatusThread.Start();
            Log("Codex 状态监控已启动。");
        }

        private void StopCodexStatusMonitor()
        {
            _codexStatusStop = true;
            try
            {
                if (_codexStatusThread != null && _codexStatusThread.IsAlive) _codexStatusThread.Join(1500);
            }
            catch { }
        }

        private void CodexStatusLoop()
        {
            while (!_codexStatusStop)
            {
                var sleepSeconds = 2;
                try
                {
                    var status = RefreshCodexStatusNow();
                    if (status.State == "not_running") sleepSeconds = 30;
                    else if (status.State == "unknown") sleepSeconds = 10;
                }
                catch (Exception ex)
                {
                    SetCodexStatus(CodexRuntimeStatus.Unknown("状态探测失败：" + ex.Message));
                    sleepSeconds = 10;
                }

                for (var i = 0; i < sleepSeconds && !_codexStatusStop; i++) Thread.Sleep(1000);
            }
        }

        private CodexRuntimeStatus RefreshCodexStatusNow()
        {
            var related = GetCodexRelatedProcesses();
            var own = Process.GetCurrentProcess().Id;
            var targetRunning = false;
            foreach (var record in related)
            {
                if (IsTargetCodexProcess(record, own))
                {
                    targetRunning = true;
                    break;
                }
            }
            if (!targetRunning)
            {
                return SetCodexStatus(CodexRuntimeStatus.NotRunning(related.Count));
            }
            return SetCodexStatus(_codexLogRuntimeMonitor.Refresh(related.Count));
        }

        private CodexRuntimeStatus RefreshCodexStatusNowLegacy()
        {
            CodexRuntimeStatus proxyStatus;
            if (TryReadProxyRuntimeStatus(out proxyStatus))
            {
                return SetCodexStatus(proxyStatus);
            }

            var related = GetCodexRelatedProcesses();
            var targetRunning = false;
            var privateAppServers = 0;
            foreach (var record in related)
            {
                if (IsTargetCodexProcess(record, Process.GetCurrentProcess().Id)) targetRunning = true;
                if (IsCodexAppServerProcess(record) && IsPrivateAppServerProcess(record)) privateAppServers++;
            }

            if (!targetRunning && privateAppServers == 0)
            {
                return SetCodexStatus(CodexRuntimeStatus.NotRunning(related.Count));
            }

            var protocol = ProbeCodexAppServerProtocol();
            var status = CodexRuntimeStatus.FromProtocol(protocol, targetRunning, related.Count, privateAppServers);
            if (status.UsedFallback && targetRunning)
            {
                status = ApplyConservativeRuntimeProbe(status);
            }
            return SetCodexStatus(status);
        }

        private bool TryReadProxyRuntimeStatus(out CodexRuntimeStatus status)
        {
            status = null;
            try
            {
                var proxyPath = CodexProxyExePath();
                if (!IsSamePath(GetUserEnvironmentVariable("CODEX_CLI_PATH"), proxyPath)
                    && !IsSamePath(Environment.GetEnvironmentVariable("CODEX_CLI_PATH") ?? "", proxyPath))
                {
                    return false;
                }

                var path = CodexProxyStatusPath();
                if (!File.Exists(path)) return false;
                var raw = File.ReadAllText(path, Encoding.UTF8);
                var heartbeatText = MatchJsonString(raw, "heartbeat_at");
                DateTime heartbeat;
                if (string.IsNullOrWhiteSpace(heartbeatText)
                    || !DateTime.TryParse(heartbeatText, null, DateTimeStyles.RoundtripKind, out heartbeat))
                {
                    return false;
                }
                if ((DateTime.UtcNow - heartbeat.ToUniversalTime()).TotalSeconds > 8) return false;

                var state = MatchJsonString(raw, "state");
                if (string.IsNullOrWhiteSpace(state)) return false;

                var related = GetCodexRelatedProcesses();
                var privateAppServers = 0;
                foreach (var record in related)
                {
                    if (IsCodexAppServerProcess(record) && IsPrivateAppServerProcess(record)) privateAppServers++;
                }

                var active = MatchJsonInt(raw, "active_turn_count", 0);
                var waiting = MatchJsonInt(raw, "waiting_thread_count", 0);
                var threadCount = MatchJsonInt(raw, "thread_count", 0);

                status = new CodexRuntimeStatus
                {
                    State = state,
                    Label = MatchJsonString(raw, "label"),
                    Detail = MatchJsonString(raw, "detail"),
                    Source = "app-server-proxy",
                    ProtocolConnected = MatchJsonBool(raw, "running", true) && state != "not_running",
                    UsedFallback = false,
                    RunningProcessCount = related.Count,
                    PrivateAppServerCount = privateAppServers,
                    LoadedThreadCount = threadCount,
                    ActiveThreadCount = active,
                    WaitingThreadCount = waiting,
                    ThreadCount = threadCount,
                    CheckedAt = DateTime.UtcNow
                };
                if (string.IsNullOrWhiteSpace(status.Label)) status.Label = state == "active" ? "任务中" : state == "idle" ? "空闲" : "状态未知";
                if (string.IsNullOrWhiteSpace(status.Detail)) status.Detail = "来自 Codex app-server 代理的实时状态。";
                return true;
            }
            catch
            {
                status = null;
                return false;
            }
        }

        private CodexRuntimeStatus ApplyConservativeRuntimeProbe(CodexRuntimeStatus status)
        {
            var now = DateTime.UtcNow;
            var cpuPercent = -1.0;
            var cpuSeconds = CodexCpuTotalSeconds();
            if (cpuSeconds >= 0)
            {
                if (_lastCodexCpuSeconds >= 0 && _lastCodexCpuSampleAt != DateTime.MinValue)
                {
                    var elapsed = Math.Max(1, (now - _lastCodexCpuSampleAt).TotalSeconds);
                    var cpuDelta = Math.Max(0, cpuSeconds - _lastCodexCpuSeconds);
                    cpuPercent = (cpuDelta / elapsed) * 100.0;
                }
                _lastCodexCpuSeconds = cpuSeconds;
                _lastCodexCpuSampleAt = now;
            }

            string activeFile;
            var recentFile = HasRecentCodexActivityFiles(45, out activeFile);
            var userIdle = UserIdleSeconds();

            status.Source = "app-server+fallback";
            status.UsedFallback = true;
            status.CpuPercent = cpuPercent;
            status.UserIdleSeconds = userIdle;
            status.ActivityFile = string.IsNullOrEmpty(activeFile) ? "" : Path.GetFileName(activeFile);

            if (cpuPercent > 3)
            {
                status.State = "active";
                status.Label = "疑似任务中";
                status.Detail = "保护模式检测到 Codex 进程仍在计算，CPU 活动约 " + cpuPercent.ToString("0.##", CultureInfo.InvariantCulture) + "%。";
                return status;
            }

            if (recentFile)
            {
                status.State = "active";
                status.Label = "最近有活动";
                status.Detail = "保护模式检测到 Codex 最近写入了会话或状态文件。";
                return status;
            }

            if (userIdle >= 0 && userIdle < 8)
            {
                status.State = "active";
                status.Label = "刚刚操作";
                status.Detail = "保护模式检测到用户刚刚操作电脑，会暂缓自动切换。";
                return status;
            }

            if (cpuSeconds >= 0)
            {
                status.State = "idle";
                status.Label = "空闲";
                status.Detail = "保护模式未发现近期会话写入或明显 CPU 活动。";
                return status;
            }

            status.State = "unknown";
            status.Label = "确认中";
            status.Detail = "保护模式正在采样 Codex 进程活动。";
            return status;
        }

        private CodexRuntimeStatus SetCodexStatus(CodexRuntimeStatus status)
        {
            lock (_codexStatusLock)
            {
                _codexStatus = status;
                return _codexStatus.Clone();
            }
        }

        private CodexRuntimeStatus CurrentCodexStatus()
        {
            lock (_codexStatusLock)
            {
                return _codexStatus.Clone();
            }
        }

        private static List<ProcessRecord> GetCodexRelatedProcesses()
        {
            var own = Process.GetCurrentProcess().Id;
            var list = new List<ProcessRecord>();
            try
            {
                using (var searcher = new ManagementObjectSearcher("SELECT ProcessId,ParentProcessId,Name,CommandLine FROM Win32_Process"))
                {
                    foreach (ManagementObject item in searcher.Get())
                    {
                        var record = new ProcessRecord
                        {
                            Id = Convert.ToInt32(item["ProcessId"]),
                            ParentId = item["ParentProcessId"] == null ? 0 : Convert.ToInt32(item["ParentProcessId"]),
                            Name = Convert.ToString(item["Name"]) ?? "",
                            CommandLine = Convert.ToString(item["CommandLine"]) ?? ""
                        };
                        if (record.Id == own) continue;
                        if (IsCodexRelatedProcess(record)) list.Add(record);
                    }
                }
            }
            catch { }
            return list;
        }

        private static bool IsCodexRelatedProcess(ProcessRecord process)
        {
            var name = process.Name ?? "";
            var cmd = process.CommandLine ?? "";
            if (name.Equals("codex.exe", StringComparison.OrdinalIgnoreCase)) return true;
            if (name.StartsWith("OpenAI.Codex", StringComparison.OrdinalIgnoreCase)) return true;
            if (ContainsIgnoreCase(cmd, "\\WindowsApps\\OpenAI.Codex_")) return true;
            if (ContainsIgnoreCase(cmd, "\\AppData\\Local\\OpenAI\\Codex\\bin\\")) return true;
            if (ContainsIgnoreCase(cmd, "\\AppData\\Roaming\\Codex")) return true;
            return false;
        }

        private static bool IsCodexAppServerProcess(ProcessRecord process)
        {
            return ContainsIgnoreCase(process.CommandLine ?? "", "app-server");
        }

        private static bool IsPrivateAppServerProcess(ProcessRecord process)
        {
            var cmd = process.CommandLine ?? "";
            if (!IsCodexAppServerProcess(process)) return false;
            if (ContainsIgnoreCase(cmd, "--listen ws://")) return false;
            if (ContainsIgnoreCase(cmd, "--listen unix://")) return false;
            return true;
        }

        private static ProtocolProbeResult ProbeCodexAppServerProtocol()
        {
            var result = new ProtocolProbeResult();
            var exe = ResolveCodexCliPath();
            if (string.IsNullOrEmpty(exe))
            {
                result.Error = "未找到 Codex app-server";
                return result;
            }

            Process process = null;
            var outputLines = new List<string>();
            var errorLines = new List<string>();
            var outputLock = new object();
            try
            {
                var info = new ProcessStartInfo(exe, "app-server --listen stdio://")
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                process = Process.Start(info);
                if (process == null)
                {
                    result.Error = "app-server 启动失败";
                    return result;
                }

                var stdout = new Thread(new ThreadStart(delegate
                {
                    try
                    {
                        string line;
                        while ((line = process.StandardOutput.ReadLine()) != null)
                        {
                            lock (outputLock) outputLines.Add(line);
                        }
                    }
                    catch { }
                })) { IsBackground = true };
                var stderr = new Thread(new ThreadStart(delegate
                {
                    try
                    {
                        string line;
                        while ((line = process.StandardError.ReadLine()) != null)
                        {
                            lock (outputLock) errorLines.Add(line);
                        }
                    }
                    catch { }
                })) { IsBackground = true };
                stdout.Start();
                stderr.Start();

                SendRpc(process, 1, "initialize", "{\"clientInfo\":{\"name\":\"codex-dock-helper\",\"version\":\"0.1.0\"},\"capabilities\":null}");
                var init = WaitForRpcLine(outputLines, outputLock, 1, 4500);
                if (string.IsNullOrEmpty(init))
                {
                    result.Error = FirstError(errorLines, outputLock, "app-server 初始化超时");
                    return result;
                }
                result.Connected = true;
                result.UserAgent = MatchJsonString(init, "userAgent");

                SendRpc(process, 2, "thread/loaded/list", "{\"limit\":30}");
                var loaded = WaitForRpcLine(outputLines, outputLock, 2, 4500);
                result.LoadedThreadCount = CountStringArrayField(loaded, "data");

                SendRpc(process, 3, "thread/list", "{\"limit\":20,\"useStateDbOnly\":true}");
                var list = WaitForRpcLine(outputLines, outputLock, 3, 5000);
                result.ThreadCount = Regex.Matches(list ?? "", "\"sessionId\"\\s*:").Count;
                result.ActiveThreadCount = Regex.Matches(list ?? "", "\"status\"\\s*:\\s*\\{\\s*\"type\"\\s*:\\s*\"active\"", RegexOptions.IgnoreCase).Count;
                result.WaitingThreadCount = Regex.Matches(list ?? "", "\"activeFlags\"\\s*:\\s*\\[[^\\]]*waitingOn", RegexOptions.IgnoreCase).Count;
                return result;
            }
            catch (Exception ex)
            {
                result.Error = ex.Message;
                return result;
            }
            finally
            {
                try
                {
                    if (process != null && !process.HasExited) process.Kill();
                }
                catch { }
                try
                {
                    if (process != null) process.Dispose();
                }
                catch { }
            }
        }

        private static void SendRpc(Process process, int id, string method, string paramsJson)
        {
            process.StandardInput.WriteLine("{\"jsonrpc\":\"2.0\",\"id\":" + id + ",\"method\":\"" + method + "\",\"params\":" + paramsJson + "}");
            process.StandardInput.Flush();
        }

        private static string WaitForRpcLine(List<string> lines, object outputLock, int id, int timeoutMs)
        {
            var needle = "\"id\":" + id;
            var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            while (DateTime.UtcNow < deadline)
            {
                lock (outputLock)
                {
                    foreach (var line in lines)
                    {
                        if ((line ?? "").IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) return line;
                    }
                }
                Thread.Sleep(40);
            }
            return "";
        }

        private static string FirstError(List<string> lines, object outputLock, string fallback)
        {
            lock (outputLock)
            {
                foreach (var line in lines)
                {
                    if (!string.IsNullOrWhiteSpace(line)) return line.Trim();
                }
            }
            return fallback;
        }

        private static int CountStringArrayField(string json, string field)
        {
            if (string.IsNullOrEmpty(json)) return 0;
            var match = Regex.Match(json, "\"" + Regex.Escape(field) + "\"\\s*:\\s*\\[(.*?)\\]", RegexOptions.Singleline);
            if (!match.Success) return 0;
            return Regex.Matches(match.Groups[1].Value, "\"(?:\\\\.|[^\"])*\"").Count;
        }

        private static string ResolveCodexCliPath()
        {
            return ResolveRealCodexCliPath();
        }

        private static string ResolveRealCodexCliPath()
        {
            var proxyPath = DefaultCodexProxyExePath();
            var realEnv = Environment.GetEnvironmentVariable("CODEX_DOCK_REAL_CODEX_CLI_PATH");
            if (IsUsableRealCodexPath(realEnv, proxyPath)) return realEnv;

            var realUserEnv = GetUserEnvironmentVariable("CODEX_DOCK_REAL_CODEX_CLI_PATH");
            if (IsUsableRealCodexPath(realUserEnv, proxyPath)) return realUserEnv;

            var configured = Environment.GetEnvironmentVariable("CODEX_CLI_PATH");
            if (IsUsableRealCodexPath(configured, proxyPath)) return configured;

            var configuredUser = GetUserEnvironmentVariable("CODEX_CLI_PATH");
            if (IsUsableRealCodexPath(configuredUser, proxyPath)) return configuredUser;

            var configRaw = ReadTextIfExists(CodexProxyConfigPath());
            var configReal = MatchJsonString(configRaw, "realCodexPath");
            if (IsUsableRealCodexPath(configReal, proxyPath)) return configReal;

            try
            {
                var binRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpenAI", "Codex", "bin");
                if (Directory.Exists(binRoot))
                {
                    string newest = null;
                    DateTime newestWrite = DateTime.MinValue;
                    foreach (var file in Directory.EnumerateFiles(binRoot, "codex.exe", SearchOption.AllDirectories))
                    {
                        try
                        {
                            if (!IsUsableRealCodexPath(file, proxyPath)) continue;
                            var write = File.GetLastWriteTimeUtc(file);
                            if (newest == null || write > newestWrite)
                            {
                                newest = file;
                                newestWrite = write;
                            }
                        }
                        catch { }
                    }
                    if (!string.IsNullOrEmpty(newest)) return newest;
                }
            }
            catch { }
            return "";
        }

        private static string DefaultCodexProxyExePath()
        {
            try
            {
                return Path.Combine(AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar), "CodexAppServerProxy.exe");
            }
            catch
            {
                return "CodexAppServerProxy.exe";
            }
        }

        private static bool IsUsableRealCodexPath(string path, string proxyPath)
        {
            if (string.IsNullOrWhiteSpace(path) || !File.Exists(path)) return false;
            if (IsSamePath(path, proxyPath)) return false;
            if (Path.GetFileName(path).Equals("CodexAppServerProxy.exe", StringComparison.OrdinalIgnoreCase)) return false;
            return Path.GetFileName(path).Equals("codex.exe", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsSamePath(string left, string right)
        {
            if (string.IsNullOrWhiteSpace(left) || string.IsNullOrWhiteSpace(right)) return false;
            try
            {
                return string.Equals(Path.GetFullPath(left).TrimEnd('\\'), Path.GetFullPath(right).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return string.Equals(left, right, StringComparison.OrdinalIgnoreCase);
            }
        }

        private void StartAutoSwitchService()
        {
            if (_autoSwitchThread != null && _autoSwitchThread.IsAlive) return;
            _autoSwitchStop = false;
            _autoSwitchThread = new Thread(AutoSwitchLoop) { IsBackground = true };
            _autoSwitchThread.Start();
            Log("自动切换守护已启动。");
        }

        private void StopAutoSwitchService()
        {
            _autoSwitchStop = true;
            try
            {
                if (_autoSwitchThread != null && _autoSwitchThread.IsAlive) _autoSwitchThread.Join(1500);
            }
            catch { }
        }

        private void AutoSwitchLoop()
        {
            while (!_autoSwitchStop)
            {
                var delaySeconds = 30;
                try
                {
                    var config = GetAutoSwitchConfig();
                    if (!string.IsNullOrEmpty(config.CloudBase) && !string.IsNullOrEmpty(config.DeviceToken))
                    {
                        config = RefreshAutoSwitchCloudConfig(config);
                        if (string.IsNullOrEmpty(config.CloudBase) || string.IsNullOrEmpty(config.DeviceToken))
                        {
                            delaySeconds = config.IdlePollSeconds;
                        }
                        else
                        {
                            var codexRunning = HasCodexProcess();
                            if (codexRunning)
                            {
                                try { MaybePostSwitchAuthCompare(config); }
                                catch (Exception ex) { Log("切入后 auth 比对跳过：" + ShortText(ex.Message, 120)); }
                            }
                            delaySeconds = codexRunning ? EffectiveAutoSwitchPollSeconds(config) : config.IdlePollSeconds;
                            if (config.Enabled && codexRunning)
                            {
                                RunAutoSwitchCheck(config);
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    SetAutoSwitchResult("检查失败：" + ex.Message, "check-error:" + ex.GetType().Name + ":" + ShortText(ex.Message, 80));
                }

                var loops = Math.Max(1, delaySeconds);
                for (var i = 0; i < loops && !_autoSwitchStop; i++)
                {
                    Thread.Sleep(1000);
                    var runtime = CurrentCodexStatus();
                    if (!string.IsNullOrEmpty(runtime.PendingSwitchReason)) break;
                }
            }
        }

        private static int EffectiveAutoSwitchPollSeconds(AutoSwitchConfig config)
        {
            return Math.Max(5, Math.Min(config.PollSeconds, 15));
        }

        private AutoSwitchConfig GetAutoSwitchConfig()
        {
            lock (_autoSwitchLock)
            {
                return _autoSwitchConfig.Clone();
            }
        }

        private void ConfigureAutoSwitch(string body)
        {
            lock (_autoSwitchLock)
            {
                var next = _autoSwitchConfig == null ? new AutoSwitchConfig() : _autoSwitchConfig.Clone();
                if (Regex.IsMatch(body, "\"enabled\"\\s*:\\s*false", RegexOptions.IgnoreCase)) next.Enabled = false;
                if (Regex.IsMatch(body, "\"enabled\"\\s*:\\s*true", RegexOptions.IgnoreCase)) next.Enabled = true;
                if (Regex.IsMatch(body, "\"clearToken\"\\s*:\\s*true", RegexOptions.IgnoreCase))
                {
                    next.DeviceToken = "";
                    next.Enabled = false;
                }
                var cloudBase = MatchJsonString(body, "cloudBase");
                var token = MatchJsonString(body, "deviceToken");
                var deviceKey = MatchJsonString(body, "deviceKey");
                var tokenExpiresAt = MatchJsonString(body, "tokenExpiresAt");
                if (!string.IsNullOrEmpty(cloudBase)) next.CloudBase = cloudBase.TrimEnd('/');
                if (!string.IsNullOrEmpty(token)) next.DeviceToken = token;
                if (!string.IsNullOrEmpty(deviceKey)) next.DeviceKey = deviceKey;
                if (!string.IsNullOrEmpty(tokenExpiresAt)) next.DeviceTokenExpiresAt = tokenExpiresAt;
                next.CloudLastSyncAt = DateTime.UtcNow.ToString("o");
                var settingsJson = ExtractJsonObject(body, "settings");
                var settingsSource = string.IsNullOrEmpty(settingsJson) || settingsJson == "null" ? body : settingsJson;
                next.FiveHourThreshold = MatchJsonInt(settingsSource, "fiveHourThreshold", MatchJsonInt(settingsSource, "five_hour_threshold", next.FiveHourThreshold));
                next.OneWeekThreshold = MatchJsonInt(settingsSource, "oneWeekThreshold", MatchJsonInt(settingsSource, "one_week_threshold", next.OneWeekThreshold));
                next.PollSeconds = MatchJsonInt(settingsSource, "pollSeconds", next.PollSeconds);
                next.IdlePollSeconds = MatchJsonInt(settingsSource, "idlePollSeconds", next.IdlePollSeconds);
                next.GlobalCooldownSeconds = MatchJsonInt(settingsSource, "globalCooldownSeconds", next.GlobalCooldownSeconds);
                next.CooldownMinutes = MatchJsonInt(settingsSource, "cooldownMinutes", next.CooldownMinutes);
                next.OnlyWhenIdle = MatchJsonBool(settingsSource, "onlyWhenIdle", next.OnlyWhenIdle);
                next.IdleSeconds = MatchJsonInt(settingsSource, "idleSeconds", next.IdleSeconds);
                next.ActivityQuietSeconds = MatchJsonInt(settingsSource, "activityQuietSeconds", next.ActivityQuietSeconds);
                next.CpuQuietSeconds = MatchJsonInt(settingsSource, "cpuQuietSeconds", next.CpuQuietSeconds);
                next.CpuBusyPercent = MatchJsonInt(settingsSource, "cpuBusyPercent", next.CpuBusyPercent);
                _autoSwitchConfig = next.Clamp();
                SaveAutoSwitchConfig(_autoSwitchConfig);
            }
            SetAutoSwitchResult(GetAutoSwitchConfig().Enabled ? "自动切换已配置" : "自动切换已关闭", "configured:" + GetAutoSwitchConfig().Enabled);
            StartAutoSwitchService();
        }

        private AutoSwitchConfig RefreshAutoSwitchCloudConfig(AutoSwitchConfig config)
        {
            try
            {
                var response = GetHelperJson(config, "/api/helper/auto-switch/config");
                var settingsJson = ExtractJsonObject(response, "settings");
                var replacementToken = MatchJsonString(response, "replacementDeviceToken");
                var replacementExpiresAt = MatchJsonString(response, "replacementExpiresAt");
                var tokenJson = ExtractJsonObject(response, "token");
                var tokenExpiresAt = MatchJsonString(tokenJson, "expiresAt");
                var changed = false;

                lock (_autoSwitchLock)
                {
                    var next = _autoSwitchConfig == null ? config.Clone() : _autoSwitchConfig.Clone();
                    if (!string.IsNullOrEmpty(settingsJson) && settingsJson != "null")
                    {
                        next.Enabled = MatchJsonBool(settingsJson, "enabled", next.Enabled);
                        next.FiveHourThreshold = MatchJsonInt(settingsJson, "fiveHourThreshold", next.FiveHourThreshold);
                        next.OneWeekThreshold = MatchJsonInt(settingsJson, "oneWeekThreshold", next.OneWeekThreshold);
                        next.PollSeconds = MatchJsonInt(settingsJson, "pollSeconds", next.PollSeconds);
                        next.IdlePollSeconds = MatchJsonInt(settingsJson, "idlePollSeconds", next.IdlePollSeconds);
                        next.GlobalCooldownSeconds = MatchJsonInt(settingsJson, "globalCooldownSeconds", next.GlobalCooldownSeconds);
                        next.CooldownMinutes = MatchJsonInt(settingsJson, "cooldownMinutes", next.CooldownMinutes);
                        next.OnlyWhenIdle = MatchJsonBool(settingsJson, "onlyWhenIdle", next.OnlyWhenIdle);
                        next.IdleSeconds = MatchJsonInt(settingsJson, "idleSeconds", next.IdleSeconds);
                        next.ActivityQuietSeconds = MatchJsonInt(settingsJson, "activityQuietSeconds", next.ActivityQuietSeconds);
                        next.CpuQuietSeconds = MatchJsonInt(settingsJson, "cpuQuietSeconds", next.CpuQuietSeconds);
                        next.CpuBusyPercent = MatchJsonInt(settingsJson, "cpuBusyPercent", next.CpuBusyPercent);
                    }
                    if (!string.IsNullOrEmpty(replacementToken))
                    {
                        next.DeviceToken = replacementToken;
                        next.DeviceTokenExpiresAt = replacementExpiresAt;
                        changed = true;
                    }
                    else if (!string.IsNullOrEmpty(tokenExpiresAt))
                    {
                        next.DeviceTokenExpiresAt = tokenExpiresAt;
                    }
                    next.CloudLastSyncAt = DateTime.UtcNow.ToString("o");
                    next = next.Clamp();
                    var shouldSave = changed || !AutoSwitchConfigEquivalent(_autoSwitchConfig, next);
                    _autoSwitchConfig = next;
                    if (shouldSave)
                    {
                        SaveAutoSwitchConfig(_autoSwitchConfig);
                    }
                    config = next.Clone();
                }

                if (!string.IsNullOrEmpty(replacementToken))
                {
                    Log("自动切换：云端已轮换 Helper token，新的授权已保存。");
                }
            }
            catch (Exception ex)
            {
                SetAutoSwitchResult("云端保活失败：" + ex.Message, "cloud-keepalive-failed:" + ShortText(ex.Message, 80));
            }
            return config;
        }

        private static bool AutoSwitchConfigEquivalent(AutoSwitchConfig a, AutoSwitchConfig b)
        {
            if (a == null || b == null) return false;
            return a.Enabled == b.Enabled
                && string.Equals(a.CloudBase, b.CloudBase, StringComparison.Ordinal)
                && string.Equals(a.DeviceToken, b.DeviceToken, StringComparison.Ordinal)
                && string.Equals(a.DeviceKey, b.DeviceKey, StringComparison.Ordinal)
                && string.Equals(a.DeviceTokenExpiresAt, b.DeviceTokenExpiresAt, StringComparison.Ordinal)
                && a.FiveHourThreshold == b.FiveHourThreshold
                && a.OneWeekThreshold == b.OneWeekThreshold
                && a.PollSeconds == b.PollSeconds
                && a.IdlePollSeconds == b.IdlePollSeconds
                && a.GlobalCooldownSeconds == b.GlobalCooldownSeconds
                && a.CooldownMinutes == b.CooldownMinutes
                && a.OnlyWhenIdle == b.OnlyWhenIdle
                && a.IdleSeconds == b.IdleSeconds
                && a.ActivityQuietSeconds == b.ActivityQuietSeconds
                && a.CpuQuietSeconds == b.CpuQuietSeconds
                && a.CpuBusyPercent == b.CpuBusyPercent;
        }

        private void MaybePostSwitchAuthCompare(AutoSwitchConfig config)
        {
            string pendingFingerprint;
            DateTime compareAfter;
            lock (_authSyncLock)
            {
                pendingFingerprint = _pendingPostSwitchAuthCompareFingerprint;
                compareAfter = _pendingPostSwitchAuthCompareAfter;
            }
            if (string.IsNullOrEmpty(pendingFingerprint) || compareAfter == DateTime.MinValue) return;
            if (DateTime.UtcNow < compareAfter) return;

            var compared = MaybeSyncCurrentAuth(config, true, "post-switch-compare");
            if (!compared) return;
            lock (_authSyncLock)
            {
                if (_pendingPostSwitchAuthCompareFingerprint == pendingFingerprint)
                {
                    _pendingPostSwitchAuthCompareFingerprint = "";
                    _pendingPostSwitchAuthCompareAfter = DateTime.MinValue;
                }
            }
        }

        private bool MaybeSyncCurrentAuth(AutoSwitchConfig config, bool forceCompare, string syncReason)
        {
            if (config == null || string.IsNullOrEmpty(config.CloudBase) || string.IsNullOrEmpty(config.DeviceToken)) return false;
            var now = DateTime.UtcNow;
            lock (_authSyncLock)
            {
                if (!forceCompare && (now - _lastAuthSyncAttemptAt).TotalSeconds < 10) return false;
                _lastAuthSyncAttemptAt = now;
            }

            var path = CurrentAuthPath();
            if (!File.Exists(path)) return false;
            var writeAt = File.GetLastWriteTimeUtc(path);
            var authJson = File.ReadAllText(path, Encoding.UTF8).Trim();
            ValidateAuthJson(authJson);
            var fingerprint = AuthFingerprint(authJson);
            var forceKey = (syncReason ?? "") + ":" + fingerprint + ":" + writeAt.ToUniversalTime().ToString("o");
            lock (_authSyncLock)
            {
                if (forceCompare)
                {
                    if (forceKey == _lastForcedAuthCompareKey
                        && _lastForcedAuthCompareAt != DateTime.MinValue
                        && (now - _lastForcedAuthCompareAt).TotalSeconds < 300)
                    {
                        return false;
                    }
                }
                if (!forceCompare && fingerprint == _lastHelperWrittenAuthFingerprint) return false;
                if (!forceCompare && fingerprint == _lastSyncedAuthFingerprint && writeAt <= _lastSyncedAuthWriteAt.AddSeconds(1)) return false;
                if (!forceCompare && fingerprint == _lastSkippedAuthFingerprint
                    && writeAt <= _lastSkippedAuthWriteAt.AddSeconds(1)
                    && _lastSkippedAuthAttemptAt != DateTime.MinValue
                    && (now - _lastSkippedAuthAttemptAt).TotalSeconds < 300)
                {
                    return false;
                }
            }

            var response = PostHelperJson(config, "/api/helper/auto-switch/current-auth", "{"
                + "\"deviceKey\":\"" + JsonEscape(config.DeviceKey) + "\","
                + "\"localUpdatedAt\":\"" + JsonEscape(writeAt.ToUniversalTime().ToString("o")) + "\","
                + "\"fingerprint\":\"" + JsonEscape(ShortText(fingerprint, 16)) + "\","
                + "\"syncReason\":\"" + JsonEscape(syncReason ?? "") + "\","
                + "\"authJson\":" + JsString(authJson)
                + "}");
            var matched = Regex.IsMatch(response, "\"matched\"\\s*:\\s*true", RegexOptions.IgnoreCase);
            var synced = Regex.IsMatch(response, "\"synced\"\\s*:\\s*true", RegexOptions.IgnoreCase);
            var reason = MatchJsonString(response, "reason");
            lock (_authSyncLock)
            {
                if (forceCompare)
                {
                    _lastForcedAuthCompareKey = forceKey;
                    _lastForcedAuthCompareAt = now;
                }
                if (synced)
                {
                    _lastSyncedAuthFingerprint = fingerprint;
                    _lastSyncedAuthWriteAt = writeAt;
                    _lastSkippedAuthFingerprint = "";
                    _lastSkippedAuthWriteAt = DateTime.MinValue;
                    _lastSkippedAuthAttemptAt = DateTime.MinValue;
                }
                else
                {
                    _lastSkippedAuthFingerprint = fingerprint;
                    _lastSkippedAuthWriteAt = writeAt;
                    _lastSkippedAuthAttemptAt = now;
                }
            }
            if (synced)
            {
                LogAuthSync("synced:" + ShortText(fingerprint, 16), "当前 auth 已同步到云端：" + ShortText(MatchJsonString(response, "matchedAccountId"), 12));
            }
            else if (matched && !string.IsNullOrEmpty(reason))
            {
                var message = reason.Contains("无需同步") ? "当前 auth 比对完成：" + reason : "当前 auth 暂未同步：" + reason;
                LogAuthSync("skipped:" + reason, message);
            }
            return true;
        }

        private void LogAuthSync(string key, string message)
        {
            var now = DateTime.UtcNow;
            lock (_authSyncLock)
            {
                if (key == _lastAuthSyncLogKey
                    && _lastAuthSyncLogAt != DateTime.MinValue
                    && (now - _lastAuthSyncLogAt).TotalSeconds < 300)
                {
                    return;
                }
                _lastAuthSyncLogKey = key;
                _lastAuthSyncLogAt = now;
            }
            Log(message);
        }

        private void RunAutoSwitchCheck(AutoSwitchConfig config)
        {
            var now = DateTime.UtcNow;
            _lastAutoSwitchCheckAt = now;
            var authPath = CurrentAuthPath();
            if (!File.Exists(authPath))
            {
                SetAutoSwitchResult("未找到 auth.json", "missing-auth");
                return;
            }
            var authJson = File.ReadAllText(authPath, Encoding.UTF8).Trim();
            var authWrittenAt = File.GetLastWriteTimeUtc(authPath);
            ValidateAuthJson(authJson);

            var usageJson = "";
            var error = "";
            try
            {
                usageJson = FetchUsageSnapshotJson(authJson);
            }
            catch (Exception ex)
            {
                error = ex.Message;
                usageJson = FallbackUsageJson(PlanFromAuthJson(authJson));
            }

            var trigger = AutoSwitchTriggerReason(usageJson, error, config);
            var triggerType = AutoSwitchUsageTriggerType(trigger, error);
            var triggerSource = string.IsNullOrEmpty(trigger) ? "" : "实时用量";
            var usageSummary = UsageSnapshotSummary(usageJson);
            var clearedRuntimeTriggerReason = "";
            if (string.IsNullOrEmpty(trigger))
            {
                var runtimeStatus = RefreshCodexStatusNow();
                var runtimeTrigger = runtimeStatus.PendingSwitchReason;
                if (!string.IsNullOrEmpty(runtimeTrigger))
                {
                    if (IsRuntimeTriggerOlderThanAuth(runtimeStatus, authWrittenAt))
                    {
                        ClearRuntimePendingSwitch();
                        clearedRuntimeTriggerReason = "已清理换号前触发";
                    }
                    else if (UsageSnapshotIsHealthy(usageJson, error, config))
                    {
                        ClearRuntimePendingSwitch();
                        clearedRuntimeTriggerReason = "实时用量正常（" + usageSummary + "），已忽略运行日志触发：" + runtimeTrigger;
                    }
                    else
                    {
                        trigger = runtimeTrigger;
                        triggerType = runtimeStatus.PendingSwitchType;
                        triggerSource = "运行日志";
                    }
                }
            }
            var currentAccountId = MatchJsonString(authJson, "account_id");
            var currentEmail = EmailFromAuthJson(authJson);
            PostHelperJson(config, "/api/helper/auto-switch/current-usage", "{"
                + "\"deviceKey\":\"" + JsonEscape(config.DeviceKey) + "\","
                + "\"currentAccountId\":\"" + JsonEscape(currentAccountId) + "\","
                + "\"currentEmail\":\"" + JsonEscape(currentEmail) + "\","
                + "\"ok\":" + (string.IsNullOrEmpty(error) ? "true" : "false") + ","
                + "\"error\":\"" + JsonEscape(error) + "\","
                + "\"usage\":" + usageJson
                + "}");

            if (string.IsNullOrEmpty(trigger))
            {
                _lastAutoSwitchReason = "";
                SetAutoSwitchResult(string.IsNullOrEmpty(clearedRuntimeTriggerReason) ? "检查正常" : "检查正常：" + clearedRuntimeTriggerReason,
                    string.IsNullOrEmpty(clearedRuntimeTriggerReason) ? "normal" : "normal:runtime-trigger-cleared:" + ShortText(clearedRuntimeTriggerReason, 80));
                return;
            }
            _lastAutoSwitchReason = trigger;
            var triggerLabel = string.IsNullOrEmpty(triggerSource) ? trigger : triggerSource + "：" + trigger;
            if ((DateTime.UtcNow - _lastAutoSwitchAt).TotalSeconds < config.GlobalCooldownSeconds)
            {
                SetAutoSwitchResult("已触发但处于冷却：" + triggerLabel, "cooldown:" + triggerSource + ":" + trigger);
                return;
            }
            string idleReason;
            if (!IsSafeToAutoSwitch(config, triggerType, out idleReason))
            {
                SetAutoSwitchResult("已触发但等待空闲：" + idleReason + "；触发源 " + triggerLabel, "waiting-idle:" + triggerType + ":" + trigger);
                TryPostHelperAudit(config, "deferred-active-task", triggerLabel, idleReason);
                return;
            }

            var forceCloudTrigger = IsHardAutoSwitchTrigger(triggerType);
            try { MaybeSyncCurrentAuth(config, true, "pre-switch-check"); }
            catch (Exception ex) { Log("切换前 auth 比对跳过：" + ShortText(ex.Message, 120)); }
            var response = PostHelperJson(config, "/api/helper/auto-switch/next", "{"
                + "\"deviceKey\":\"" + JsonEscape(config.DeviceKey) + "\","
                + "\"currentAccountId\":\"" + JsonEscape(currentAccountId) + "\","
                + "\"currentEmail\":\"" + JsonEscape(currentEmail) + "\","
                + "\"triggerReason\":\"" + JsonEscape(trigger) + "\","
                + "\"triggerType\":\"" + JsonEscape(triggerType) + "\","
                + "\"triggerSource\":\"" + JsonEscape(triggerSource) + "\","
                + "\"currentUsageSummary\":\"" + JsonEscape(usageSummary) + "\","
                + "\"force\":" + (forceCloudTrigger ? "true" : "false") + ","
                + "\"error\":\"" + JsonEscape(error) + "\","
                + "\"usage\":" + usageJson
                + "}");
            if (!Regex.IsMatch(response, "\"shouldSwitch\"\\s*:\\s*true", RegexOptions.IgnoreCase))
            {
                var responseReason = MatchJsonString(response, "reason");
                var cloudSummary = CloudSwitchDecisionSummary(response);
                var responseDetail = string.IsNullOrEmpty(responseReason) ? cloudSummary : responseReason + (string.IsNullOrEmpty(cloudSummary) ? "" : "；" + cloudSummary);
                if (IsCloudTriggerRejected(responseReason))
                {
                    SetAutoSwitchResult("云端未确认切换条件：" + triggerLabel + (string.IsNullOrEmpty(responseDetail) ? "" : "（" + responseDetail + "）"), "not-triggered:" + triggerSource + ":" + trigger);
                }
                else if (IsCloudNoCandidate(responseReason))
                {
                    SetAutoSwitchResult("已触发但无可用候选账号：" + triggerLabel + (string.IsNullOrEmpty(responseDetail) ? "" : "（" + responseDetail + "）"), "no-candidate:" + triggerSource + ":" + trigger + ":" + ShortText(responseDetail, 120));
                }
                else
                {
                    SetAutoSwitchResult("已触发但未切换：" + triggerLabel + (string.IsNullOrEmpty(responseDetail) ? "" : "（" + responseDetail + "）"), "not-switched:" + triggerSource + ":" + trigger + ":" + ShortText(responseDetail, 120));
                }
                return;
            }
            var allowAtExperimental = MatchJsonBool(response, "allowAtExperimental", false);
            var nextAuth = NormalizeAuthJsonForCodex(ExtractJsonObject(response, "authJson"), allowAtExperimental);
            var accountJson = ExtractJsonObject(response, "account");
            var targetCloudId = MatchJsonString(accountJson, "id");
            var targetName = MatchJsonString(accountJson, "email");
            if (string.IsNullOrEmpty(targetName)) targetName = MatchJsonString(ExtractJsonObject(response, "account"), "name");
            Log("自动切换触发：" + triggerLabel + "，当前用量 " + usageSummary + "，目标：" + ShortText(targetName, 48));
            var switched = RunSwitchJob(nextAuth, true, true);
            if (!switched)
            {
                SetAutoSwitchResult("自动切换失败：" + ShortText(targetName, 48), "switch-failed:" + ShortText(targetName, 48));
                TryPostHelperAudit(config, "switch-failed", trigger, "target=" + targetName);
                return;
            }
            _lastAutoSwitchAt = DateTime.UtcNow;
            PersistAutoSwitchSuccess(targetName, _lastAutoSwitchAt);
            SetAutoSwitchResult("已自动切换：" + ShortText(targetName, 48), "switched:" + ShortText(targetName, 48));
            ShowTrayTip("已自动切换账号", string.IsNullOrEmpty(targetName) ? trigger : targetName);
            PostHelperJson(config, "/api/helper/auto-switch/audit", "{"
                + "\"accountId\":\"" + JsonEscape(targetCloudId) + "\","
                + "\"result\":\"switched\","
                + "\"metadata\":{\"reason\":\"" + JsonEscape(trigger) + "\",\"target\":\"" + JsonEscape(targetName) + "\"}"
                + "}");
        }

        private static bool IsRuntimeTriggerOlderThanAuth(CodexRuntimeStatus status, DateTime authWrittenAt)
        {
            if (status == null || status.PendingSwitchAt == DateTime.MinValue) return false;
            return authWrittenAt.ToUniversalTime() >= status.PendingSwitchAt.ToUniversalTime().AddSeconds(-2);
        }

        private void ClearRuntimePendingSwitch()
        {
            _codexLogRuntimeMonitor.ClearPendingSwitch();
            lock (_codexStatusLock)
            {
                _codexStatus.PendingSwitchReason = "";
                _codexStatus.PendingSwitchType = "";
                _codexStatus.PendingSwitchAt = DateTime.MinValue;
            }
        }

        private void PersistAutoSwitchSuccess(string targetName, DateTime switchedAtUtc)
        {
            try
            {
                lock (_autoSwitchLock)
                {
                    var config = _autoSwitchConfig == null ? LoadAutoSwitchConfig() : _autoSwitchConfig.Clone();
                    config.LastSwitchAt = switchedAtUtc.ToString("o");
                    config.LastSwitchLabel = targetName ?? "";
                    _autoSwitchConfig = config.Clamp();
                    SaveAutoSwitchConfig(_autoSwitchConfig);
                }
            }
            catch (Exception ex)
            {
                Log("自动切换：保存最近切换状态失败：" + ex.Message);
            }
        }

        private bool IsSafeToAutoSwitch(AutoSwitchConfig config, string triggerType, out string reason)
        {
            reason = "";
            if (!config.OnlyWhenIdle) return true;

            var runtimeStatus = CurrentCodexStatus();
            if (IsHardAutoSwitchTrigger(triggerType) && runtimeStatus.State == "cooling")
            {
                return true;
            }
            if (runtimeStatus.State == "idle" && runtimeStatus.SafeToSwitch)
            {
                if (runtimeStatus.StableSeconds >= 0 && runtimeStatus.StableSeconds < config.IdleSeconds)
                {
                    reason = "Codex 空闲 " + Math.Floor(runtimeStatus.StableSeconds).ToString(CultureInfo.InvariantCulture)
                        + " 秒，等待 " + config.IdleSeconds.ToString(CultureInfo.InvariantCulture) + " 秒确认";
                    return false;
                }
                return true;
            }
            if (runtimeStatus.State == "active")
            {
                reason = "Codex 未稳定空闲";
                return false;
            }
            if (runtimeStatus.State == "cooling")
            {
                reason = "Codex 未稳定空闲";
                return false;
            }
            if (runtimeStatus.State == "unknown")
            {
                reason = "无法确认 Codex 是否空闲";
                return false;
            }
            if (runtimeStatus.State == "not_running")
            {
                reason = "Codex 未运行";
                return false;
            }
            reason = string.IsNullOrEmpty(runtimeStatus.Detail) ? "等待日志状态确认" : runtimeStatus.Detail;
            return false;
        }

        private static bool IsHardAutoSwitchTrigger(string triggerType)
        {
            return string.Equals(triggerType, "auth", StringComparison.OrdinalIgnoreCase)
                || string.Equals(triggerType, "quota", StringComparison.OrdinalIgnoreCase)
                || string.Equals(triggerType, "account_disabled", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsCloudTriggerRejected(string reason)
        {
            return !string.IsNullOrWhiteSpace(reason)
                && reason.IndexOf("未命中切换条件", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static bool IsCloudNoCandidate(string reason)
        {
            return !string.IsNullOrWhiteSpace(reason)
                && reason.IndexOf("可用候选", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static double UserIdleSeconds()
        {
            try
            {
                var info = new LastInputInfo();
                info.CbSize = (uint)Marshal.SizeOf(typeof(LastInputInfo));
                if (!GetLastInputInfo(ref info)) return -1;
                var tick = unchecked((uint)Environment.TickCount);
                return unchecked(tick - info.DwTime) / 1000.0;
            }
            catch
            {
                return -1;
            }
        }

        private static double CodexCpuTotalSeconds()
        {
            var own = Process.GetCurrentProcess().Id;
            var total = 0.0;
            var found = false;
            try
            {
                using (var searcher = new ManagementObjectSearcher("SELECT ProcessId,ParentProcessId,Name,CommandLine FROM Win32_Process"))
                {
                    foreach (ManagementObject item in searcher.Get())
                    {
                        var record = new ProcessRecord
                        {
                            Id = Convert.ToInt32(item["ProcessId"]),
                            ParentId = item["ParentProcessId"] == null ? 0 : Convert.ToInt32(item["ParentProcessId"]),
                            Name = Convert.ToString(item["Name"]) ?? "",
                            CommandLine = Convert.ToString(item["CommandLine"]) ?? ""
                        };
                        if (!IsTargetCodexProcess(record, own)) continue;
                        try
                        {
                            using (var process = Process.GetProcessById(record.Id))
                            {
                                total += process.TotalProcessorTime.TotalSeconds;
                                found = true;
                            }
                        }
                        catch { }
                    }
                }
            }
            catch { }
            return found ? total : -1;
        }

        private static bool HasRecentCodexActivityFiles(int seconds, out string fileName)
        {
            fileName = "";
            var cutoff = DateTime.UtcNow.AddSeconds(-Math.Max(30, seconds));
            var userCodex = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex");
            var files = new[]
            {
                Path.Combine(userCodex, "session_index.jsonl"),
                Path.Combine(userCodex, "state_5.sqlite-wal"),
                Path.Combine(userCodex, "logs_2.sqlite-wal"),
                Path.Combine(userCodex, ".codex-global-state.json"),
            };
            foreach (var file in files)
            {
                try
                {
                    if (File.Exists(file) && File.GetLastWriteTimeUtc(file) >= cutoff)
                    {
                        fileName = file;
                        return true;
                    }
                }
                catch { }
            }

            var roots = new[]
            {
                Path.Combine(userCodex, "sessions"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Codex"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpenAI", "Codex"),
                userCodex,
            };
            var scanned = 0;
            foreach (var root in roots)
            {
                if (!Directory.Exists(root)) continue;
                try
                {
                    foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
                    {
                        if (++scanned > 8000) break;
                        var name = Path.GetFileName(file) ?? "";
                        if (name.Equals("auth.json", StringComparison.OrdinalIgnoreCase)
                            || name.IndexOf("auth.json.bak", StringComparison.OrdinalIgnoreCase) >= 0
                            || name.IndexOf(".tmp-", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            continue;
                        }
                        try
                        {
                            if (File.GetLastWriteTimeUtc(file) >= cutoff)
                            {
                                fileName = file;
                                return true;
                            }
                        }
                        catch { }
                    }
                }
                catch { }
            }
            return false;
        }

        private void TryPostHelperAudit(AutoSwitchConfig config, string result, string trigger, string detail)
        {
            try
            {
                PostHelperJson(config, "/api/helper/auto-switch/audit", "{"
                    + "\"result\":\"" + JsonEscape(result) + "\","
                    + "\"metadata\":{\"reason\":\"" + JsonEscape(trigger) + "\",\"detail\":\"" + JsonEscape(detail) + "\"}"
                    + "}");
            }
            catch { }
        }

        private static string AutoSwitchTriggerReason(string usageJson, string error, AutoSwitchConfig config)
        {
            var five = UsageRemainingPercent(usageJson, "five_hour");
            var week = UsageRemainingPercent(usageJson, "one_week");
            if (five.HasValue && five.Value <= config.FiveHourThreshold) return "5H 剩余 " + five.Value.ToString("0.##", CultureInfo.InvariantCulture) + "%";
            if (week.HasValue && week.Value <= config.OneWeekThreshold) return "7D 剩余 " + week.Value.ToString("0.##", CultureInfo.InvariantCulture) + "%";
            var text = (error ?? "").ToLowerInvariant();
            if (Regex.IsMatch(text, "401|429|quota|rate limit|usage limit|too many requests|token has been invalidated|invalidated|token expired|invalid_grant|refresh token was already used|access token could not be refreshed|could not be refreshed|已失效|频率|额度", RegexOptions.IgnoreCase))
            {
                return "当前账号不可用或已限流";
            }
            return "";
        }

        private static string AutoSwitchUsageTriggerType(string trigger, string error)
        {
            if (string.IsNullOrEmpty(trigger)) return "";
            var text = ((trigger ?? "") + " " + (error ?? "")).ToLowerInvariant();
            if (Regex.IsMatch(text, "401|token has been invalidated|invalidated|token expired|invalid_grant|refresh token was already used|access token could not be refreshed|could not be refreshed|已失效", RegexOptions.IgnoreCase)) return "auth";
            if (Regex.IsMatch(text, "5h|7d|429|quota|rate limit|usage limit|too many requests|频率|额度|限流", RegexOptions.IgnoreCase)) return "quota";
            return "usage";
        }

        private static bool UsageSnapshotIsHealthy(string usageJson, string error, AutoSwitchConfig config)
        {
            if (!string.IsNullOrWhiteSpace(error)) return false;
            var five = UsageRemainingPercent(usageJson, "five_hour");
            var week = UsageRemainingPercent(usageJson, "one_week");
            var hasSignal = false;
            if (five.HasValue)
            {
                hasSignal = true;
                if (five.Value <= config.FiveHourThreshold) return false;
            }
            if (week.HasValue)
            {
                hasSignal = true;
                if (week.Value <= config.OneWeekThreshold) return false;
            }
            return hasSignal;
        }

        private static string UsageSnapshotSummary(string usageJson)
        {
            var parts = new List<string>();
            var five = UsageRemainingPercent(usageJson, "five_hour");
            var week = UsageRemainingPercent(usageJson, "one_week");
            if (five.HasValue) parts.Add("5H " + five.Value.ToString("0.##", CultureInfo.InvariantCulture) + "%");
            if (week.HasValue) parts.Add("7D " + week.Value.ToString("0.##", CultureInfo.InvariantCulture) + "%");
            return parts.Count == 0 ? "实时用量无窗口" : string.Join("，", parts.ToArray());
        }

        private static string CloudSwitchDecisionSummary(string response)
        {
            var parts = new List<string>();
            var candidateCount = MatchJsonInt(response, "candidateCount", -1);
            var eligibleCount = MatchJsonInt(response, "eligibleCount", -1);
            if (candidateCount >= 0 || eligibleCount >= 0)
            {
                parts.Add("候选 " + (candidateCount >= 0 ? candidateCount.ToString(CultureInfo.InvariantCulture) : "?")
                    + "，可用 " + (eligibleCount >= 0 ? eligibleCount.ToString(CultureInfo.InvariantCulture) : "?"));
            }
            var blockedSummary = MatchJsonString(response, "blockedSummary");
            if (!string.IsNullOrEmpty(blockedSummary)) parts.Add("拦截统计：" + blockedSummary);
            return parts.Count == 0 ? "" : string.Join("；", parts.ToArray());
        }

        private static double? UsageRemainingPercent(string usageJson, string field)
        {
            var obj = ExtractJsonObject(usageJson, field);
            if (string.IsNullOrEmpty(obj) || obj == "null") return null;
            var remaining = MatchJsonDouble(obj, "remaining_percent");
            if (remaining.HasValue) return Math.Max(0, Math.Min(100, remaining.Value));
            var used = MatchJsonDouble(obj, "used_percent");
            if (used.HasValue) return Math.Max(0, Math.Min(100, 100 - used.Value));
            return null;
        }

        private static string EmailFromAuthJson(string authJson)
        {
            var email = MatchJsonString(authJson, "email");
            if (!string.IsNullOrEmpty(email)) return email;
            var accessToken = MatchJsonString(authJson, "access_token");
            email = MatchJsonString(JwtPayloadJson(accessToken), "email");
            if (!string.IsNullOrEmpty(email)) return email;
            return MatchJsonString(JwtPayloadJson(MatchJsonString(authJson, "id_token")), "email");
        }

        private string GetHelperJson(AutoSwitchConfig config, string path)
        {
            return SendHelperJson(config, "GET", path, null);
        }

        private string PostHelperJson(AutoSwitchConfig config, string path, string body)
        {
            return SendHelperJson(config, "POST", path, body);
        }

        private string SendHelperJson(AutoSwitchConfig config, string method, string path, string body)
        {
            var url = config.CloudBase.TrimEnd('/') + path;
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.Method = method;
            request.Timeout = 20000;
            request.ReadWriteTimeout = 20000;
            request.ContentType = "application/json; charset=utf-8";
            request.Accept = "application/json";
            request.UserAgent = "codex-dock-helper/auto-switch";
            request.Headers["Authorization"] = "Bearer " + config.DeviceToken;
            if (!string.Equals(method, "GET", StringComparison.OrdinalIgnoreCase))
            {
                var bytes = Encoding.UTF8.GetBytes(body ?? "{}");
                using (var stream = request.GetRequestStream())
                {
                    stream.Write(bytes, 0, bytes.Length);
                }
            }
            try
            {
                using (var response = (HttpWebResponse)request.GetResponse())
                using (var stream = response.GetResponseStream())
                using (var reader = new StreamReader(stream, Encoding.UTF8))
                {
                    return reader.ReadToEnd();
                }
            }
            catch (WebException ex)
            {
                if (ex.Response != null)
                {
                    using (var response = (HttpWebResponse)ex.Response)
                    using (var stream = response.GetResponseStream())
                    using (var reader = new StreamReader(stream, Encoding.UTF8))
                    {
                        var text = reader.ReadToEnd();
                        if (((int)response.StatusCode) == 401)
                        {
                            lock (_autoSwitchLock)
                            {
                                _autoSwitchConfig.Enabled = false;
                                SaveAutoSwitchConfig(_autoSwitchConfig);
                            }
                        }
                        throw new InvalidOperationException(((int)response.StatusCode) + ": " + text);
                    }
                }
                throw;
            }
        }

        private void SetAutoSwitchResult(string text)
        {
            SetAutoSwitchResult(text, "");
        }

        private void SetAutoSwitchResult(string text, string logKey)
        {
            var next = text ?? "";
            _lastAutoSwitchResult = next;
            if (string.IsNullOrEmpty(next)) return;

            var key = string.IsNullOrEmpty(logKey) ? next : logKey;
            var now = DateTime.UtcNow;
            var shouldLog = key != _lastAutoSwitchLogKey
                || _lastAutoSwitchLogAt == DateTime.MinValue
                || (now - _lastAutoSwitchLogAt).TotalSeconds >= AutoSwitchRepeatedLogSeconds;
            if (!shouldLog) return;

            _lastAutoSwitchLogKey = key;
            _lastAutoSwitchLogAt = now;
            Log("自动切换：" + next);
        }

        private void ShowTrayTip(string title, string text)
        {
            try
            {
                if (_trayIcon != null) _trayIcon.ShowBalloonTip(2500, title, text, ToolTipIcon.Info);
            }
            catch { }
        }

        private static string LaunchCodex()
        {
            var appId = Environment.GetEnvironmentVariable("CODEX_PLUS_APP_ID");
            if (string.IsNullOrWhiteSpace(appId)) appId = "OpenAI.Codex_2p2nqsd0c76g0!App";
            try
            {
                var shellInfo = new ProcessStartInfo("explorer.exe", "shell:AppsFolder\\" + appId)
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                };
                Process.Start(shellInfo);
                return "通过 Windows Shell 启动: " + appId;
            }
            catch
            {
                var info = new ProcessStartInfo("cmd.exe", "/c start \"\" codex")
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                };
                Process.Start(info);
                return "通过 PATH 启动: codex";
            }
        }

        private static CodexRestoreTarget CaptureCodexRestoreTarget()
        {
            var disabled = Environment.GetEnvironmentVariable("CODEX_DOCK_RESTORE_WINDOW");
            if (string.Equals(disabled, "0", StringComparison.OrdinalIgnoreCase)
                || string.Equals(disabled, "false", StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            string source;
            var target = CodexLogRuntimeMonitor.TryReadBestRestoreTarget(out source);
            if (target == null || string.IsNullOrWhiteSpace(target.ThreadId)) return null;
            target.Source = string.IsNullOrWhiteSpace(target.Source) ? source : target.Source;
            target.Url = "codex://threads/" + Uri.EscapeDataString(target.ThreadId);
            return target;
        }

        private static string RestoreCodexWindow(CodexRestoreTarget target)
        {
            if (target == null || string.IsNullOrWhiteSpace(target.Url)) return "未找到可恢复会话。";
            try
            {
                var attempts = target.IsGoal ? 4 : 3;
                for (var i = 0; i < attempts; i++)
                {
                    Process.Start(new ProcessStartInfo(target.Url) { UseShellExecute = true });
                    if (i < attempts - 1) Thread.Sleep(1400);
                }
                return "已请求恢复" + (target.IsGoal ? "目标任务" : "会话") + "窗口：" + ShortText(target.ThreadId, 12);
            }
            catch (Exception ex)
            {
                return "恢复会话窗口失败：" + ex.Message;
            }
        }

        private static string RestoreCodexGoalIfNeeded(CodexRestoreTarget target)
        {
            if (target == null || !target.IsGoal || string.IsNullOrWhiteSpace(target.ThreadId)) return "";
            var disabled = Environment.GetEnvironmentVariable("CODEX_DOCK_RESTORE_GOAL");
            if (string.Equals(disabled, "0", StringComparison.OrdinalIgnoreCase)
                || string.Equals(disabled, "false", StringComparison.OrdinalIgnoreCase))
            {
                return "目标恢复已关闭：CODEX_DOCK_RESTORE_GOAL=" + disabled;
            }

            var exe = ResolveCodexCliPath();
            if (string.IsNullOrEmpty(exe)) return "目标恢复失败：未找到 Codex app-server。";

            Process process = null;
            var outputLines = new List<string>();
            var errorLines = new List<string>();
            var outputLock = new object();
            try
            {
                var info = new ProcessStartInfo(exe, "app-server --listen stdio://")
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                process = Process.Start(info);
                if (process == null) return "目标恢复失败：app-server 启动失败。";

                var stdout = new Thread(new ThreadStart(delegate
                {
                    try
                    {
                        string line;
                        while ((line = process.StandardOutput.ReadLine()) != null)
                        {
                            lock (outputLock) outputLines.Add(line);
                        }
                    }
                    catch { }
                })) { IsBackground = true };
                var stderr = new Thread(new ThreadStart(delegate
                {
                    try
                    {
                        string line;
                        while ((line = process.StandardError.ReadLine()) != null)
                        {
                            lock (outputLock) errorLines.Add(line);
                        }
                    }
                    catch { }
                })) { IsBackground = true };
                stdout.Start();
                stderr.Start();

                SendRpc(process, 1, "initialize", "{\"clientInfo\":{\"name\":\"codex-dock-helper\",\"version\":\"0.2.0\"},\"capabilities\":{\"experimentalApi\":true}}");
                var init = WaitForRpcLine(outputLines, outputLock, 1, 4500);
                if (string.IsNullOrEmpty(init))
                {
                    return "目标恢复失败：" + FirstError(errorLines, outputLock, "app-server 初始化超时");
                }

                SendRpc(process, 2, "thread/goal/get", "{\"threadId\":\"" + JsonEscape(target.ThreadId) + "\"}");
                var goalLine = WaitForRpcLine(outputLines, outputLock, 2, 4500);
                if (string.IsNullOrEmpty(goalLine)) return "目标恢复失败：读取目标状态超时。";
                if (ContainsJsonError(goalLine)) return "目标恢复失败：" + RpcErrorMessage(goalLine);

                var goalJson = ExtractJsonObject(goalLine, "goal");
                if (string.IsNullOrEmpty(goalJson) || string.Equals(goalJson, "null", StringComparison.OrdinalIgnoreCase))
                {
                    return "目标恢复跳过：当前线程没有目标状态。";
                }

                var status = MatchJsonString(goalJson, "status");
                if (string.Equals(status, "active", StringComparison.OrdinalIgnoreCase))
                {
                    SendRpc(process, 3, "thread/resume", "{\"threadId\":\"" + JsonEscape(target.ThreadId) + "\",\"excludeTurns\":true}");
                    WaitForRpcLine(outputLines, outputLock, 3, 3500);
                    return "目标恢复：目标已处于 active。";
                }

                if (string.Equals(status, "complete", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(status, "blocked", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(status, "budgetLimited", StringComparison.OrdinalIgnoreCase))
                {
                    return "目标恢复跳过：目标状态为 " + status + "。";
                }

                if (string.Equals(status, "paused", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(status, "usageLimited", StringComparison.OrdinalIgnoreCase))
                {
                    SendRpc(process, 3, "thread/goal/set", "{\"threadId\":\"" + JsonEscape(target.ThreadId) + "\",\"status\":\"active\"}");
                    var setLine = WaitForRpcLine(outputLines, outputLock, 3, 4500);
                    if (string.IsNullOrEmpty(setLine)) return "目标恢复失败：写入目标状态超时。";
                    if (ContainsJsonError(setLine)) return "目标恢复失败：" + RpcErrorMessage(setLine);

                    SendRpc(process, 4, "thread/resume", "{\"threadId\":\"" + JsonEscape(target.ThreadId) + "\",\"excludeTurns\":true}");
                    WaitForRpcLine(outputLines, outputLock, 4, 3500);
                    var nextStatus = MatchJsonString(setLine, "status");
                    return "目标恢复：已将目标状态从 " + (string.IsNullOrEmpty(status) ? "unknown" : status) + " 恢复为 " + (string.IsNullOrEmpty(nextStatus) ? "active" : nextStatus) + "。";
                }

                return "目标恢复跳过：目标状态为 " + (string.IsNullOrEmpty(status) ? "unknown" : status) + "。";
            }
            catch (Exception ex)
            {
                return "目标恢复失败：" + ex.Message;
            }
            finally
            {
                try
                {
                    if (process != null && !process.HasExited) process.Kill();
                }
                catch { }
                try
                {
                    if (process != null) process.Dispose();
                }
                catch { }
            }
        }

        private static bool ContainsJsonError(string json)
        {
            return Regex.IsMatch(json ?? "", "\"error\"\\s*:\\s*\\{", RegexOptions.IgnoreCase);
        }

        private static string RpcErrorMessage(string json)
        {
            var error = ExtractJsonObject(json, "error");
            var message = MatchJsonString(error, "message");
            return string.IsNullOrEmpty(message) ? "app-server 返回错误。" : message;
        }

        private void ServeStatic(HttpListenerContext context)
        {
            var path = context.Request.Url.AbsolutePath;
            if (path == "/" || path == "/status")
            {
                SendText(context.Response, 200, HelperStatusHtml(), "text/html; charset=utf-8");
                return;
            }
            if (path == "/migrate-cache")
            {
                SendText(context.Response, 200, LegacyCacheMigratorHtml(context.Request), "text/html; charset=utf-8");
                return;
            }
            SendText(context.Response, 404, "Local helper API is running. Cloud console is separate.", "text/plain; charset=utf-8");
        }

        private string HelperStatusHtml()
        {
            var auth = CurrentAuthSummaryText();
            var auto = GetAutoSwitchConfig();
            var codex = CurrentCodexStatus();
            return "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<title>Codex Dock Helper</title>"
                + "<style>body{font-family:Segoe UI,Microsoft YaHei UI,sans-serif;margin:0;background:#0c0f0b;color:#f3f1e8}main{max-width:760px;margin:8vh auto;padding:0 24px}h1{font-size:28px;margin:0 0 12px}.card{border:1px solid #3d4638;background:#191e16;padding:22px;margin-top:18px}.muted{color:#a9b09e}.row{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}a{color:#12150e;background:#e5ff6a;text-decoration:none;padding:10px 14px;font-weight:700}code{background:#090c08;padding:3px 6px}</style>"
                + "</head><body><main><h1>Codex Dock Helper 正在运行</h1>"
                + "<p class=\"muted\">Helper 已就绪，可以在 Codex Dock 中一键切换账号。</p>"
                + "<div class=\"card\"><strong>本地 API</strong><p><code>" + HtmlEscape(BaseUrl) + "</code></p><p class=\"muted\">" + HtmlEscape(auth) + "</p></div>"
                + "<div class=\"card\"><strong>Codex 状态</strong><p>" + HtmlEscape(codex.Label) + "</p><p class=\"muted\">" + HtmlEscape(codex.Detail) + "</p></div>"
                + "<div class=\"card\"><strong>自动切换</strong><p>" + HtmlEscape(auto.Enabled && !string.IsNullOrEmpty(auto.DeviceToken) ? "已开启" : "未开启") + "</p><p class=\"muted\">" + HtmlEscape(_lastAutoSwitchResult) + "</p></div>"
                + "<div class=\"row\"><a href=\"" + HtmlEscape(CloudConsoleUrl) + "\">打开 Codex Dock</a><a href=\"/api/health\">查看状态</a></div>"
                + "</main></body></html>";
        }

        private string LegacyCacheMigratorHtml(HttpListenerRequest request)
        {
            var target = request.QueryString["target"];
            if (string.IsNullOrWhiteSpace(target)) target = CloudConsoleUrl.TrimEnd('/');
            return "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<title>迁移旧本地缓存</title>"
                + "<style>body{font-family:Segoe UI,Microsoft YaHei UI,sans-serif;margin:0;background:#f7f7f5;color:#171717}main{max-width:520px;margin:10vh auto;padding:0 24px}h1{font-size:24px;margin:0 0 12px}.card{border:1px solid #e3e3dd;background:white;border-radius:12px;padding:20px;margin-top:16px}.muted{color:#6f6f68;line-height:1.7}code{background:#f1f1ed;padding:2px 5px;border-radius:6px}button{min-height:36px;border:1px solid #171717;border-radius:999px;background:#171717;color:white;padding:0 14px;font-weight:700}</style>"
                + "</head><body><main><h1>迁移旧本地缓存</h1>"
                + "<p class=\"muted\">这个页面用于迁移旧账号池缓存，并发送到 Codex Dock 导入。</p>"
                + "<div class=\"card\"><strong id=\"status\">正在读取...</strong><p class=\"muted\" id=\"detail\"></p><button id=\"retry\" type=\"button\">重新发送</button></div>"
                + "<script>"
                + "const target=" + JsString(target) + ";"
                + "const keys=['codex-account-switcher-store-v3','codex-account-switcher-store-v2','codex-account-switcher-store-v1'];"
                + "function send(){const status=document.getElementById('status');const detail=document.getElementById('detail');try{let found=null;for(const key of keys){const raw=localStorage.getItem(key);if(!raw)continue;const parsed=JSON.parse(raw);if(Array.isArray(parsed.accounts)&&parsed.accounts.length){found={key,store:parsed};break;}}if(!found){status.textContent='未找到旧账号池';detail.textContent='当前浏览器在 '+location.origin+' 下没有旧版账号缓存。';window.opener&&window.opener.postMessage({type:'codex-plus-legacy-cache',error:'not_found'},target);return;}const count=found.store.accounts.length;status.textContent='已找到 '+count+' 个账号';detail.innerHTML='缓存键：<code>'+found.key+'</code>，已发送给 Codex Dock。';window.opener&&window.opener.postMessage({type:'codex-plus-legacy-cache',key:found.key,store:found.store},target);setTimeout(()=>{try{window.close()}catch(e){}},1200);}catch(error){status.textContent='读取失败';detail.textContent=error.message||String(error);window.opener&&window.opener.postMessage({type:'codex-plus-legacy-cache',error:error.message||String(error)},target);}}"
                + "document.getElementById('retry').addEventListener('click',send);send();"
                + "</script></main></body></html>";
        }

        private static string ContentTypeFor(string filePath)
        {
            switch (Path.GetExtension(filePath).ToLowerInvariant())
            {
                case ".html": return "text/html; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".js": return "application/javascript; charset=utf-8";
                case ".json": return "application/json; charset=utf-8";
                case ".md": return "text/markdown; charset=utf-8";
                default: return "application/octet-stream";
            }
        }

        private static string OauthCallbackHtml(string error, string callbackUrl)
        {
            var ok = string.IsNullOrEmpty(error);
            var title = ok ? "授权已接收" : "授权失败";
            var detail = ok
                ? "Codex Dock 正在自动解析回调，可以关闭这个页面。"
                : "授权服务返回错误：" + error;
            return "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<title>" + HtmlEscape(title) + "</title>"
                + "<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f6f6f6;color:#111;display:grid;place-items:center;min-height:100vh}"
                + ".card{width:min(480px,calc(100vw - 32px));background:#fff;border:1px solid #ddd;border-radius:16px;padding:24px;box-shadow:0 18px 60px rgba(0,0,0,.12)}"
                + "h1{font-size:22px;margin:0 0 8px}p{margin:0;color:#666;line-height:1.6}button{margin-top:18px;height:36px;border:1px solid #ddd;border-radius:999px;background:#111;color:#fff;padding:0 18px;font:inherit;cursor:pointer}</style>"
                + "</head><body><main class=\"card\"><h1>" + HtmlEscape(title) + "</h1><p>" + HtmlEscape(detail) + "</p><button onclick=\"window.close()\">关闭页面</button></main>"
                + "<script>(function(){var msg={type:'codex-dock-oauth-callback',url:" + JsString(callbackUrl) + "};function send(){try{if(window.opener&&!window.opener.closed)window.opener.postMessage(msg,'*');}catch(e){}}send();setTimeout(send,500);setTimeout(send,1500);})();</script>"
                + "</body></html>";
        }

        private bool IsAllowedOrigin(HttpListenerRequest request)
        {
            var origin = request.Headers["Origin"];
            if (string.IsNullOrEmpty(origin)) return true;

            try
            {
                var originUri = new Uri(origin);
                if (originUri.Scheme == "http"
                    && (originUri.Host == "127.0.0.1" || originUri.Host == "localhost" || originUri.Host == "::1"))
                {
                    return true;
                }
            }
            catch { }

            if (origin == "http://127.0.0.1:" + _port
                || origin == "http://localhost:" + _port)
            {
                return true;
            }

            try
            {
                var cloudOrigin = new Uri(CloudConsoleUrl).GetLeftPart(UriPartial.Authority);
                if (origin == cloudOrigin) return true;
            }
            catch { }

            var configured = Environment.GetEnvironmentVariable("CODEX_PLUS_ALLOWED_ORIGIN");
            if (!string.IsNullOrWhiteSpace(configured))
            {
                foreach (var item in configured.Split(','))
                {
                    if (origin == item.Trim()) return true;
                }
            }
            return false;
        }

        private static void SendJson(HttpListenerResponse response, int status, string json)
        {
            SendText(response, status, json, "application/json; charset=utf-8");
        }

        private static void SendRedirect(HttpListenerResponse response, string location)
        {
            response.StatusCode = 302;
            response.Headers["Location"] = location;
            response.Headers["Cache-Control"] = "no-store";
            response.Close();
        }

        private static void SendText(HttpListenerResponse response, int status, string text)
        {
            SendText(response, status, text, "text/plain; charset=utf-8");
        }

        private static void SendText(HttpListenerResponse response, int status, string text, string contentType)
        {
            AddCorsHeaders(response, null);
            var data = Encoding.UTF8.GetBytes(text ?? "");
            response.StatusCode = status;
            response.ContentType = contentType;
            response.Headers["Cache-Control"] = "no-store";
            response.OutputStream.Write(data, 0, data.Length);
            response.Close();
        }

        private static void AddCorsHeaders(HttpListenerResponse response, HttpListenerRequest request)
        {
            var origin = request == null ? null : request.Headers["Origin"];
            if (string.IsNullOrEmpty(origin)) origin = "*";
            response.Headers["Access-Control-Allow-Origin"] = origin;
            response.Headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
            response.Headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
            response.Headers["Vary"] = "Origin";
        }

        private static string JsonEscape(string value)
        {
            return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
        }

        private static string JsString(string value)
        {
            return "\"" + JsonEscape(value).Replace("<", "\\u003c").Replace(">", "\\u003e") + "\"";
        }

        private static string HtmlEscape(string value)
        {
            return WebUtility.HtmlEncode(value ?? "");
        }

        private void OpenManagementPage()
        {
            Process.Start(new ProcessStartInfo(CloudConsoleUrl) { UseShellExecute = true });
        }

        private void OpenLocalStatusPage()
        {
            Process.Start(new ProcessStartInfo(BaseUrl) { UseShellExecute = true });
        }

        private void OpenCodexFolder()
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex");
            Directory.CreateDirectory(dir);
            Process.Start(new ProcessStartInfo(dir) { UseShellExecute = true });
        }

        private void SetStatus(string text)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action<string>(SetStatus), text);
                return;
            }
            _statusLabel.Text = text;
            if (_trayIcon != null)
            {
                var tip = "Codex Dock Helper - " + text;
                _trayIcon.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;
            }
        }

        private void SetAuthStatus(string text)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action<string>(SetAuthStatus), text);
                return;
            }
            _authLabel.Text = text;
        }

        private void Log(string text)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action<string>(Log), text);
                return;
            }
            var now = DateTime.Now;
            var uiLine = "[" + now.ToString("HH:mm:ss") + "] " + text;
            WriteHelperLogLine("[" + now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + text);
            _logBox.AppendText(uiLine + Environment.NewLine);
        }

        private void RunOnUi(Action action)
        {
            try
            {
                if (IsDisposed) return;
                if (InvokeRequired)
                {
                    BeginInvoke(action);
                    return;
                }
                action();
            }
            catch { }
        }

        private void ShowOperationProgress(string title, string detail, int percent)
        {
            RunOnUi(delegate
            {
                lock (_operationProgressLock)
                {
                    if (_operationProgressForm == null || _operationProgressForm.IsDisposed)
                    {
                        _operationProgressForm = new OperationProgressForm();
                    }
                    _operationProgressForm.SetStep(title, detail, percent);
                    if (!_operationProgressForm.Visible)
                    {
                        if (Visible && WindowState != FormWindowState.Minimized)
                        {
                            _operationProgressForm.StartPosition = FormStartPosition.CenterParent;
                            _operationProgressForm.Show(this);
                        }
                        else
                        {
                            _operationProgressForm.StartPosition = FormStartPosition.CenterScreen;
                            _operationProgressForm.Show();
                        }
                    }
                    _operationProgressForm.Activate();
                }
            });
        }

        private void UpdateOperationProgress(int percent, string detail)
        {
            RunOnUi(delegate
            {
                lock (_operationProgressLock)
                {
                    if (_operationProgressForm == null || _operationProgressForm.IsDisposed) return;
                    _operationProgressForm.SetStep("", detail, percent);
                }
            });
        }

        private void CompleteOperationProgress(bool success, string detail)
        {
            RunOnUi(delegate
            {
                OperationProgressForm form = null;
                lock (_operationProgressLock)
                {
                    if (_operationProgressForm == null || _operationProgressForm.IsDisposed) return;
                    form = _operationProgressForm;
                    form.SetCompleted(success, detail);
                }

                var timer = new System.Windows.Forms.Timer();
                timer.Interval = success ? 900 : 2600;
                timer.Tick += delegate
                {
                    timer.Stop();
                    timer.Dispose();
                    lock (_operationProgressLock)
                    {
                        if (form != null && !form.IsDisposed)
                        {
                            form.Close();
                        }
                        if (_operationProgressForm == form)
                        {
                            _operationProgressForm = null;
                        }
                    }
                };
                timer.Start();
            });
        }

        private static void WriteHelperLogLine(string line)
        {
            try
            {
                lock (HelperLogFileLock)
                {
                    var path = HelperLogPath();
                    RotateHelperLogIfNeeded(path);
                    File.AppendAllText(path, line + Environment.NewLine, new UTF8Encoding(false));
                }
            }
            catch { }
        }

        private static void RotateHelperLogIfNeeded(string path)
        {
            try
            {
                var file = new FileInfo(path);
                if (!file.Exists || file.Length < HelperLogMaxBytes) return;

                var oldest = path + "." + HelperLogBackups.ToString(CultureInfo.InvariantCulture);
                if (File.Exists(oldest)) File.Delete(oldest);
                for (var i = HelperLogBackups - 1; i >= 1; i--)
                {
                    var source = path + "." + i.ToString(CultureInfo.InvariantCulture);
                    var target = path + "." + (i + 1).ToString(CultureInfo.InvariantCulture);
                    if (!File.Exists(source)) continue;
                    if (File.Exists(target)) File.Delete(target);
                    File.Move(source, target);
                }
                File.Move(path, path + ".1");
            }
            catch { }
        }

        private sealed class OperationProgressForm : Form
        {
            private readonly Label _titleLabel;
            private readonly Label _detailLabel;
            private readonly Label _percentLabel;
            private readonly ProgressBar _progressBar;

            public OperationProgressForm()
            {
                Text = "Codex Dock Helper";
                Width = 460;
                Height = 210;
                MinimumSize = new Size(420, 190);
                MaximumSize = new Size(520, 240);
                FormBorderStyle = FormBorderStyle.FixedDialog;
                MaximizeBox = false;
                MinimizeBox = false;
                ShowInTaskbar = false;
                BackColor = Color.FromArgb(13, 17, 12);
                ForeColor = Color.FromArgb(243, 241, 232);
                Font = new Font("Microsoft YaHei UI", 9F);
                Padding = new Padding(22);

                var badge = new Label
                {
                    Text = "Doc",
                    TextAlign = ContentAlignment.MiddleCenter,
                    Font = new Font("Segoe UI", 13F, FontStyle.Bold),
                    ForeColor = Color.FromArgb(229, 255, 106),
                    BackColor = Color.FromArgb(31, 38, 24),
                    Location = new Point(22, 22),
                    Size = new Size(48, 48),
                };
                Controls.Add(badge);

                _titleLabel = new Label
                {
                    Text = "正在执行",
                    Font = new Font("Microsoft YaHei UI", 13F, FontStyle.Bold),
                    ForeColor = Color.FromArgb(243, 241, 232),
                    BackColor = Color.Transparent,
                    Location = new Point(86, 22),
                    Size = new Size(320, 28),
                    AutoEllipsis = true,
                };
                Controls.Add(_titleLabel);

                _detailLabel = new Label
                {
                    Text = "",
                    Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular),
                    ForeColor = Color.FromArgb(181, 190, 169),
                    BackColor = Color.Transparent,
                    Location = new Point(88, 54),
                    Size = new Size(322, 42),
                    AutoEllipsis = true,
                };
                Controls.Add(_detailLabel);

                _percentLabel = new Label
                {
                    Text = "0%",
                    Font = new Font("Segoe UI", 10F, FontStyle.Bold),
                    ForeColor = Color.FromArgb(86, 218, 197),
                    BackColor = Color.Transparent,
                    TextAlign = ContentAlignment.MiddleRight,
                    Location = new Point(334, 108),
                    Size = new Size(76, 22),
                };
                Controls.Add(_percentLabel);

                _progressBar = new ProgressBar
                {
                    Style = ProgressBarStyle.Continuous,
                    Minimum = 0,
                    Maximum = 100,
                    Value = 0,
                    Location = new Point(22, 136),
                    Size = new Size(388, 18),
                    Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom,
                };
                Controls.Add(_progressBar);
            }

            public void SetStep(string title, string detail, int percent)
            {
                if (!string.IsNullOrWhiteSpace(title)) _titleLabel.Text = title;
                _detailLabel.Text = detail ?? "";
                var value = Math.Max(0, Math.Min(100, percent));
                _progressBar.Style = ProgressBarStyle.Continuous;
                _progressBar.Value = value;
                _percentLabel.Text = value.ToString(CultureInfo.InvariantCulture) + "%";
                _percentLabel.ForeColor = Color.FromArgb(86, 218, 197);
            }

            public void SetCompleted(bool success, string detail)
            {
                _titleLabel.Text = success ? "任务已完成" : "任务失败";
                _detailLabel.Text = detail ?? "";
                _progressBar.Style = ProgressBarStyle.Continuous;
                _progressBar.Value = success ? 100 : Math.Max(6, _progressBar.Value);
                _percentLabel.Text = success ? "100%" : "失败";
                _percentLabel.ForeColor = success ? Color.FromArgb(86, 218, 197) : Color.FromArgb(255, 116, 116);
            }
        }

        private sealed class AuthWriteResult
        {
            public string Target;
            public string Backup;
        }

        private sealed class AutoSwitchConfig
        {
            public bool Enabled;
            public string CloudBase = "";
            public string DeviceToken = "";
            public string DeviceKey = "";
            public string DeviceTokenExpiresAt = "";
            public string CloudLastSyncAt = "";
            public string LastSwitchAt = "";
            public string LastSwitchLabel = "";
            public int FiveHourThreshold = 5;
            public int OneWeekThreshold = 5;
            public int PollSeconds = 15;
            public int IdlePollSeconds = 300;
            public int GlobalCooldownSeconds = 180;
            public int CooldownMinutes = 10;
            public bool OnlyWhenIdle = true;
            public int IdleSeconds = 10;
            public int ActivityQuietSeconds = 120;
            public int CpuQuietSeconds = 90;
            public int CpuBusyPercent = 3;

            public AutoSwitchConfig Clone()
            {
                return new AutoSwitchConfig
                {
                    Enabled = Enabled,
                    CloudBase = CloudBase,
                    DeviceToken = DeviceToken,
                    DeviceKey = DeviceKey,
                    DeviceTokenExpiresAt = DeviceTokenExpiresAt,
                    CloudLastSyncAt = CloudLastSyncAt,
                    LastSwitchAt = LastSwitchAt,
                    LastSwitchLabel = LastSwitchLabel,
                    FiveHourThreshold = FiveHourThreshold,
                    OneWeekThreshold = OneWeekThreshold,
                    PollSeconds = PollSeconds,
                    IdlePollSeconds = IdlePollSeconds,
                    GlobalCooldownSeconds = GlobalCooldownSeconds,
                    CooldownMinutes = CooldownMinutes,
                    OnlyWhenIdle = OnlyWhenIdle,
                    IdleSeconds = IdleSeconds,
                    ActivityQuietSeconds = ActivityQuietSeconds,
                    CpuQuietSeconds = CpuQuietSeconds,
                    CpuBusyPercent = CpuBusyPercent,
                };
            }

            public AutoSwitchConfig Clamp()
            {
                if (FiveHourThreshold < 1) FiveHourThreshold = 1;
                if (FiveHourThreshold > 50) FiveHourThreshold = 50;
                if (OneWeekThreshold < 1) OneWeekThreshold = 1;
                if (OneWeekThreshold > 50) OneWeekThreshold = 50;
                if (PollSeconds < 10) PollSeconds = 10;
                if (PollSeconds > 600) PollSeconds = 600;
                if (IdlePollSeconds < 60) IdlePollSeconds = 60;
                if (IdlePollSeconds > 1800) IdlePollSeconds = 1800;
                if (GlobalCooldownSeconds < 30) GlobalCooldownSeconds = 30;
                if (GlobalCooldownSeconds > 1800) GlobalCooldownSeconds = 1800;
                if (CooldownMinutes < 0) CooldownMinutes = 0;
                if (CooldownMinutes > 240) CooldownMinutes = 240;
                if (IdleSeconds < 10) IdleSeconds = 10;
                if (IdleSeconds > 1800) IdleSeconds = 1800;
                if (ActivityQuietSeconds < 30) ActivityQuietSeconds = 30;
                if (ActivityQuietSeconds > 1800) ActivityQuietSeconds = 1800;
                if (CpuQuietSeconds < 15) CpuQuietSeconds = 15;
                if (CpuQuietSeconds > 600) CpuQuietSeconds = 600;
                if (CpuBusyPercent < 1) CpuBusyPercent = 1;
                if (CpuBusyPercent > 80) CpuBusyPercent = 80;
                if (!string.IsNullOrEmpty(CloudBase)) CloudBase = CloudBase.TrimEnd('/');
                return this;
            }
        }

        private sealed class ProcessRecord
        {
            public int Id;
            public int ParentId;
            public string Name;
            public string CommandLine;
        }

        private sealed class CodexRestoreTarget
        {
            public string ThreadId = "";
            public string Url = "";
            public string Source = "";
            public string Title = "";
            public string Cwd = "";
            public bool IsGoal;
            public string Reason = "";
        }

        private sealed class ProtocolProbeResult
        {
            public bool Connected;
            public string Error = "";
            public string UserAgent = "";
            public int LoadedThreadCount;
            public int ActiveThreadCount;
            public int WaitingThreadCount;
            public int ThreadCount;
        }

        private sealed class CodexLogRuntimeMonitor
        {
            private const int SQLITE_OK = 0;
            private const int SQLITE_ROW = 100;
            private const int SQLITE_DONE = 101;
            private const int SQLITE_OPEN_READONLY = 0x00000001;
            private const int InitialBackfillRows = 12000;
            private const int InitialBackfillSeconds = 900;
            private const int IncrementalLimit = 8000;
            private const int IdleStableSeconds = 10;
            private const int OpenTaskSilentCloseSeconds = 75;
            private const int LongTaskSeconds = 1800;
            private const int PendingTriggerSeconds = 1800;

            private bool _initialized;
            private long _lastSeenLogId;
            private int _taskEventCount;
            private bool _openTask;
            private bool _openToolCall;
            private DateTime _openTaskSince = DateTime.MinValue;
            private DateTime _lastTaskAt = DateTime.MinValue;
            private string _lastTaskEvent = "";
            private DateTime _lastTriggerAt = DateTime.MinValue;
            private string _pendingSwitchReason = "";
            private string _pendingSwitchType = "";
            private string _lastError = "";

            public void ClearPendingSwitch()
            {
                _pendingSwitchReason = "";
                _pendingSwitchType = "";
                _lastTriggerAt = DateTime.MinValue;
            }

            [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
            private static extern int sqlite3_open_v2(string filename, out IntPtr db, int flags, IntPtr vfs);

            [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
            private static extern int sqlite3_close(IntPtr db);

            [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
            private static extern int sqlite3_prepare_v2(IntPtr db, string sql, int nByte, out IntPtr stmt, IntPtr pzTail);

            [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
            private static extern int sqlite3_step(IntPtr stmt);

            [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
            private static extern int sqlite3_finalize(IntPtr stmt);

            [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
            private static extern long sqlite3_column_int64(IntPtr stmt, int iCol);

            [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
            private static extern IntPtr sqlite3_column_text(IntPtr stmt, int iCol);

            [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
            private static extern int sqlite3_column_bytes(IntPtr stmt, int iCol);

            [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
            private static extern IntPtr sqlite3_errmsg(IntPtr db);

            [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
            private static extern int sqlite3_busy_timeout(IntPtr db, int ms);

            public static CodexRestoreTarget TryReadBestRestoreTarget(out string source)
            {
                source = "";
                try
                {
                    var userCodex = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex");
                    var logsPath = Path.Combine(userCodex, "logs_2.sqlite");
                    var statePath = Path.Combine(userCodex, "state_5.sqlite");

                    var taskThread = TryReadScalarString(logsPath, RecentTaskThreadSql());
                    if (IsThreadId(taskThread))
                    {
                        var target = TryReadStateTargetById(statePath, taskThread, "logs_2.sqlite task-thread", "最近任务日志线程");
                        if (target != null)
                        {
                            source = target.Source;
                            return target;
                        }

                        source = "logs_2.sqlite task-thread";
                        return new CodexRestoreTarget
                        {
                            ThreadId = taskThread.Trim(),
                            Source = source,
                            Reason = "最近任务日志线程"
                        };
                    }

                    var goalTarget = TryReadBestStateTarget(statePath, true);
                    if (goalTarget != null)
                    {
                        source = goalTarget.Source;
                        return goalTarget;
                    }

                    var fromLogs = TryReadScalarString(logsPath, "SELECT thread_id FROM logs WHERE thread_id IS NOT NULL AND thread_id <> '' ORDER BY id DESC LIMIT 1");
                    if (IsThreadId(fromLogs))
                    {
                        var target = TryReadStateTargetById(statePath, fromLogs, "logs_2.sqlite", "最近日志线程");
                        if (target != null)
                        {
                            source = target.Source;
                            return target;
                        }

                        source = "logs_2.sqlite";
                        return new CodexRestoreTarget
                        {
                            ThreadId = fromLogs.Trim(),
                            Source = source,
                            Reason = "最近日志线程"
                        };
                    }

                    var latestTarget = TryReadBestStateTarget(statePath, false);
                    if (latestTarget != null)
                    {
                        source = latestTarget.Source;
                        return latestTarget;
                    }
                }
                catch
                {
                    source = "";
                }
                return null;
            }

            public static string TryReadMostRecentThreadId(out string source)
            {
                var target = TryReadBestRestoreTarget(out source);
                return target == null ? "" : target.ThreadId;
            }

            private static string RecentTaskThreadSql()
            {
                return "SELECT thread_id FROM logs WHERE thread_id IS NOT NULL AND thread_id <> ''"
                    + " AND (feedback_log_body LIKE '%op.dispatch.user_input%'"
                    + " OR feedback_log_body LIKE '%session_task.turn%'"
                    + " OR feedback_log_body LIKE '%thread/goal/set%'"
                    + " OR feedback_log_body LIKE '%event.kind=response.created%'"
                    + " OR feedback_log_body LIKE '%event.kind=response.completed%'"
                    + " OR feedback_log_body LIKE '%event.kind=response.failed%'"
                    + " OR feedback_log_body LIKE '%turn/completed%'"
                    + " OR feedback_log_body LIKE '%app-server event: item/started%'"
                    + " OR feedback_log_body LIKE '%app-server event: item/completed%')"
                    + " ORDER BY id DESC LIMIT 1";
            }

            private static CodexRestoreTarget TryReadStateTargetById(string statePath, string threadId, string source, string reason)
            {
                if (!IsThreadId(threadId)) return null;
                var where = "id = '" + SqlString(threadId.Trim()) + "'";
                return TryReadStateTarget(statePath, where, "updated_at DESC", source, reason);
            }

            private static CodexRestoreTarget TryReadBestStateTarget(string statePath, bool goalOnly)
            {
                var goalExpr = GoalTextSql();
                var where = "(archived IS NULL OR archived = 0)";
                if (goalOnly) where += " AND " + goalExpr + " LIKE '%/goal%'";
                return TryReadStateTarget(
                    statePath,
                    where,
                    "CASE WHEN " + goalExpr + " LIKE '%/goal%' THEN 1 ELSE 0 END DESC, updated_at DESC",
                    goalOnly ? "state_5.sqlite goal-thread" : "state_5.sqlite latest-thread",
                    goalOnly ? "最近目标任务线程" : "最近状态线程");
            }

            private static CodexRestoreTarget TryReadStateTarget(string statePath, string where, string orderBy, string source, string reason)
            {
                if (string.IsNullOrWhiteSpace(statePath) || !File.Exists(statePath)) return null;
                try
                {
                    using (var reader = new SqliteLogReader(statePath))
                    {
                        var goalExpr = GoalTextSql();
                        var sql = "SELECT id, COALESCE(title,''), COALESCE(cwd,''), "
                            + "CASE WHEN " + goalExpr + " LIKE '%/goal%' THEN '1' ELSE '0' END "
                            + "FROM threads WHERE " + where + " ORDER BY " + orderBy + " LIMIT 1";
                        foreach (var row in reader.QueryTextRows(sql, 4))
                        {
                            if (row.Length < 4 || !IsThreadId(row[0])) continue;
                            return new CodexRestoreTarget
                            {
                                ThreadId = row[0].Trim(),
                                Title = row[1],
                                Cwd = StripLongPathPrefix(row[2]),
                                IsGoal = string.Equals(row[3], "1", StringComparison.OrdinalIgnoreCase),
                                Source = source,
                                Reason = reason
                            };
                        }
                    }
                }
                catch
                {
                    return null;
                }
                return null;
            }

            private static string GoalTextSql()
            {
                return "lower(COALESCE(title,'') || ' ' || COALESCE(first_user_message,'') || ' ' || COALESCE(preview,''))";
            }

            private static string SqlString(string value)
            {
                return (value ?? "").Replace("'", "''");
            }

            private static string StripLongPathPrefix(string value)
            {
                if (string.IsNullOrEmpty(value)) return "";
                if (value.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase)) return value.Substring(4);
                return value;
            }

            private static string TryReadScalarString(string path, string sql)
            {
                if (string.IsNullOrWhiteSpace(path) || !File.Exists(path)) return "";
                try
                {
                    using (var reader = new SqliteLogReader(path))
                    {
                        return reader.QueryScalarString(sql);
                    }
                }
                catch
                {
                    return "";
                }
            }

            private static bool IsThreadId(string value)
            {
                return !string.IsNullOrWhiteSpace(value)
                    && Regex.IsMatch(value.Trim(), "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOptions.IgnoreCase);
            }

            public CodexRuntimeStatus Refresh(int processCount)
            {
                try
                {
                    var dbPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex", "logs_2.sqlite");
                    if (!File.Exists(dbPath))
                    {
                        _lastError = "未找到 Codex 任务日志。";
                        return Unknown(processCount, _lastError);
                    }

                    using (var reader = new SqliteLogReader(dbPath))
                    {
                        if (!_initialized)
                        {
                            var since = UnixSeconds(DateTime.UtcNow.AddSeconds(-InitialBackfillSeconds));
                            var maxId = reader.QueryScalarLong("SELECT COALESCE(MAX(id),0) FROM logs");
                            var startId = Math.Max(0, maxId - InitialBackfillRows);
                            ProcessRows(reader.QueryRows("SELECT id,ts,ts_nanos,target,feedback_log_body FROM (SELECT id,ts,ts_nanos,target,feedback_log_body FROM logs WHERE id >= " + startId.ToString(CultureInfo.InvariantCulture) + " OR ts >= " + since.ToString(CultureInfo.InvariantCulture) + " ORDER BY id DESC LIMIT " + InitialBackfillRows.ToString(CultureInfo.InvariantCulture) + ") ORDER BY id ASC"));
                            _initialized = true;
                            if (_lastSeenLogId <= 0) _lastSeenLogId = maxId;
                        }
                        else
                        {
                            var maxId = reader.QueryScalarLong("SELECT COALESCE(MAX(id),0) FROM logs");
                            if (maxId - _lastSeenLogId > IncrementalLimit)
                            {
                                ProcessRows(reader.QueryRows("SELECT id,ts,ts_nanos,target,feedback_log_body FROM (SELECT id,ts,ts_nanos,target,feedback_log_body FROM logs WHERE id > " + _lastSeenLogId.ToString(CultureInfo.InvariantCulture) + " ORDER BY id DESC LIMIT " + IncrementalLimit.ToString(CultureInfo.InvariantCulture) + ") ORDER BY id ASC"));
                            }
                            else
                            {
                                ProcessRows(reader.QueryRows("SELECT id,ts,ts_nanos,target,feedback_log_body FROM logs WHERE id > " + _lastSeenLogId.ToString(CultureInfo.InvariantCulture) + " ORDER BY id ASC LIMIT " + IncrementalLimit.ToString(CultureInfo.InvariantCulture)));
                            }
                        }
                    }

                    _lastError = "";
                    return BuildStatus(processCount);
                }
                catch (Exception ex)
                {
                    _lastError = "日志读取失败：" + ex.Message;
                    return Unknown(processCount, _lastError);
                }
            }

            private void ProcessRows(IEnumerable<LogRow> rows)
            {
                foreach (var row in rows)
                {
                    if (row.Id > _lastSeenLogId) _lastSeenLogId = row.Id;
                    var classification = Classify(row.Target, row.Body);
                    if (classification.Kind == "none") continue;

                    var eventAt = RowTime(row);
                    if (classification.StartsTool)
                    {
                        _openToolCall = true;
                    }
                    if (classification.EndsTool)
                    {
                        _openToolCall = false;
                    }

                    if (classification.Kind == "trigger")
                    {
                        _pendingSwitchReason = classification.Label;
                        _pendingSwitchType = classification.TriggerType;
                        _lastTriggerAt = eventAt;
                        _lastTaskAt = eventAt;
                        _lastTaskEvent = classification.Label;
                        _taskEventCount++;
                        if (classification.EndsTask)
                        {
                            _openTask = false;
                            _openToolCall = false;
                        }
                        continue;
                    }

                    if (classification.Kind == "tool_complete")
                    {
                        _lastTaskAt = eventAt;
                        _lastTaskEvent = classification.Label;
                        _taskEventCount++;
                        continue;
                    }

                    if (classification.Kind == "complete")
                    {
                        _openTask = false;
                        _openToolCall = false;
                        _lastTaskAt = eventAt;
                        _lastTaskEvent = classification.Label;
                        _taskEventCount++;
                        continue;
                    }

                    if (classification.Kind == "activity")
                    {
                        if (!_openTask)
                        {
                            _openTask = true;
                            _openTaskSince = eventAt;
                        }
                        _lastTaskAt = eventAt;
                        _lastTaskEvent = classification.Label;
                        _taskEventCount++;
                    }
                }
            }

            private CodexRuntimeStatus BuildStatus(int processCount)
            {
                var now = DateTime.UtcNow;
                var idleSeconds = _lastTaskAt == DateTime.MinValue ? InitialBackfillSeconds : Math.Max(0, (now - _lastTaskAt).TotalSeconds);
                var pendingReason = _pendingSwitchReason;
                var pendingType = _pendingSwitchType;
                var pendingAt = _lastTriggerAt;
                if (_lastTriggerAt != DateTime.MinValue && (now - _lastTriggerAt).TotalSeconds > PendingTriggerSeconds)
                {
                    ClearPendingSwitch();
                    pendingReason = "";
                    pendingType = "";
                    pendingAt = DateTime.MinValue;
                }

                var status = new CodexRuntimeStatus
                {
                    Source = "logs_2.sqlite",
                    ProtocolConnected = false,
                    UsedFallback = false,
                    RunningProcessCount = processCount,
                    LastSeenLogId = _lastSeenLogId,
                    TaskEventCount = _taskEventCount,
                    LastTaskEvent = _lastTaskEvent,
                    LastTaskEventAt = _lastTaskAt,
                    IdleSeconds = idleSeconds,
                    PendingSwitchReason = pendingReason,
                    PendingSwitchType = pendingType,
                    PendingSwitchAt = pendingAt,
                    CheckedAt = now
                };

                if (_openTask && !_openToolCall && idleSeconds >= OpenTaskSilentCloseSeconds)
                {
                    _openTask = false;
                    status.LastTaskEvent = string.IsNullOrEmpty(_lastTaskEvent) ? "静默闭合" : _lastTaskEvent + "（静默闭合）";
                    status.ActiveThreadCount = 0;
                    status.ThreadCount = 0;
                }

                if (_openTask)
                {
                    var runningSeconds = _openTaskSince == DateTime.MinValue ? 0 : Math.Max(0, (now - _openTaskSince).TotalSeconds);
                    if (runningSeconds > LongTaskSeconds)
                    {
                        status.State = "unknown";
                        status.Label = "状态未知";
                        status.Detail = "检测到长时间未闭合的任务日志，已暂停自动切换。";
                        status.SafeToSwitch = false;
                        status.StableSeconds = -1;
                        return status;
                    }
                    status.State = "active";
                    status.Label = "任务中";
                    status.Detail = "检测到 Codex 正在响应或执行工具。";
                    status.ActiveThreadCount = 1;
                    status.ThreadCount = 1;
                    status.SafeToSwitch = false;
                    status.StableSeconds = 0;
                    return status;
                }

                if (idleSeconds < IdleStableSeconds)
                {
                    status.State = "cooling";
                    status.Label = "冷却中";
                    status.Detail = "最近有任务日志，等待稳定空闲。";
                    status.SafeToSwitch = false;
                    status.StableSeconds = idleSeconds;
                    return status;
                }

                status.State = "idle";
                status.Label = "空闲";
                status.Detail = "连续 " + Math.Floor(idleSeconds).ToString(CultureInfo.InvariantCulture) + " 秒没有任务类日志。";
                status.SafeToSwitch = true;
                status.StableSeconds = idleSeconds;
                return status;
            }

            private CodexRuntimeStatus Unknown(int processCount, string detail)
            {
                var status = CodexRuntimeStatus.Unknown(detail);
                status.Source = "logs_2.sqlite";
                status.RunningProcessCount = processCount;
                status.LastSeenLogId = _lastSeenLogId;
                status.TaskEventCount = _taskEventCount;
                status.LastTaskEvent = _lastTaskEvent;
                status.LastTaskEventAt = _lastTaskAt;
                status.IdleSeconds = -1;
                status.PendingSwitchReason = _pendingSwitchReason;
                status.PendingSwitchType = _pendingSwitchType;
                status.PendingSwitchAt = _lastTriggerAt;
                status.SafeToSwitch = false;
                return status;
            }

            private static LogClassification Classify(string target, string body)
            {
                var t = (target ?? "").ToLowerInvariant();
                var b = (body ?? "").ToLowerInvariant();
                if (string.IsNullOrEmpty(t) && string.IsNullOrEmpty(b)) return LogClassification.None();

                if (IsToolArgumentPayloadEvent(b))
                {
                    return LogClassification.Activity("工具参数生成中");
                }

                if (IsToolEchoEvent(t, b)) return LogClassification.None();

                var visibleLimit = ClassifyVisibleLimitBanner(t, b);
                if (visibleLimit.Kind != "none") return visibleLimit;

                if (ContainsAny(b,
                    "event.kind=response.failed",
                    "\"type\":\"response.failed\""))
                {
                    if (!IsTrustedResponseFailureEvent(t, b)) return LogClassification.None();
                    var trigger = ClassifyTrigger(t, b);
                    if (trigger.Kind != "none")
                    {
                        trigger.EndsTask = true;
                        return trigger;
                    }
                    return LogClassification.Complete("任务失败");
                }

                if (ContainsAny(b,
                    "event.kind=response.completed",
                    "\"type\":\"response.completed\"",
                    "turn/completed",
                    "turn.completed"))
                {
                    return LogClassification.Complete("任务完成");
                }

                if (ContainsAny(b,
                    "event.kind=response.created",
                    "event.kind=response.output_text.delta",
                    "event.kind=response.reasoning",
                    "event.kind=response.reasoning_text.delta",
                    "event.kind=response.function_call_arguments.delta",
                    "\"type\":\"response.created\"",
                    "\"type\":\"response.output_text.delta\""))
                {
                    return LogClassification.Activity("模型响应中");
                }

                if (ContainsAny(b,
                    "output item item=functioncall",
                    "\"type\":\"response.output_item.done\""))
                {
                    if (ContainsAny(b, "functioncall", "\"type\":\"function_call\"")
                        && (t == "codex_core::stream_events_utils" || t == "codex_core::spawn" || t.IndexOf("codex_api::", StringComparison.OrdinalIgnoreCase) >= 0 || t == "log"))
                    {
                        return LogClassification.ToolStarted("工具执行中");
                    }
                }

                if (t == "codex_app_server::outgoing_message" && ContainsAny(b, "app-server event: item/started"))
                {
                    return LogClassification.Activity("任务进行中");
                }

                if (t == "codex_app_server::outgoing_message" && ContainsAny(b, "app-server event: item/completed"))
                {
                    return LogClassification.ToolComplete("工具或消息完成");
                }

                if (ContainsAny(b,
                    "dispatch_tool_call_with_code_mode_result",
                    "handle_tool_call_with_source:dispatch_tool_call",
                    "tool call result",
                    "tool_call_result"))
                {
                    if (t.IndexOf("codex_core::", StringComparison.OrdinalIgnoreCase) >= 0 || t.IndexOf("codex_otel.", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        return LogClassification.ToolComplete("工具完成");
                    }
                }

                return LogClassification.None();
            }

            private static bool IsToolArgumentPayloadEvent(string body)
            {
                return ContainsAny(body,
                    "event.kind=response.function_call_arguments.delta",
                    "event.kind=response.function_call_arguments.done",
                    "\"type\":\"response.function_call_arguments.delta\"",
                    "\"type\":\"response.function_call_arguments.done\"");
            }

            private static bool ShouldInspectStandaloneTrigger(string target, string body)
            {
                if (IsGeneratedContentEvent(target, body)) return false;
                if (IsToolEchoEvent(target, body)) return false;
                if (ContainsAny(body,
                    "codex.user_prompt",
                    "op.dispatch.user_input",
                    "codex.websocket_request",
                    "message_from_assistant",
                    "output item item=message",
                    "tool_name=\"shell_command\"",
                    "tool_name=\"exec_command\""))
                {
                    return false;
                }
                if (target == "codex_core::spawn") return false;
                if (target == "log" && !ContainsAny(body, "response.failed", "request failed", "exception", "api error", "api_error")) return false;
                return true;
            }

            private static bool IsToolEchoEvent(string target, string body)
            {
                var t = (target ?? "").ToLowerInvariant();
                var b = body ?? "";
                if (ContainsAny(b,
                    "otel.name=\"custom_tool_call\"",
                    "otel.name=custom_tool_call",
                    "toolcall:",
                    "toolcall ",
                    "tool_name=",
                    "tool_name=\"",
                    "tool_name:",
                    "tool_name=shell_command",
                    "tool_name=exec_command",
                    "toolcall: shell_command",
                    "toolcall: exec_command",
                    "toolcall: apply_patch",
                    "toolcall: update_plan",
                    "event.name=\"codex.tool_result\"",
                    "event.name=codex.tool_result",
                    "spawn_child_async",
                    "dispatch_tool_call",
                    "handle_tool_call",
                    "function_call_arguments",
                    "\"command\":\"",
                    "\"command\": \"",
                    "\\\"command\\\":",
                    "tool_uses",
                    "recipient_name",
                    "functions.shell_command",
                    "multi_tool_use.parallel",
                    "apply_patch",
                    "update_plan"))
                {
                    return true;
                }
                return t == "codex_core::spawn";
            }

            private static LogClassification ClassifyVisibleLimitBanner(string target, string body)
            {
                if (string.IsNullOrEmpty(body)) return LogClassification.None();
                if (!IsTrustedVisibleLimitEvent(target, body)) return LogClassification.None();
                if (ContainsAny(body,
                    "codex.user_prompt",
                    "op.dispatch.user_input",
                    "thread/goal/set",
                    "\"role\":\"user\"",
                    "\"role\": \"user\""))
                {
                    return LogClassification.None();
                }
                var hasCanonicalLimit = ContainsAny(body,
                    "you've hit your usage limit",
                    "you’ve hit your usage limit",
                    "you have hit your usage limit",
                    "you've reached your usage limit",
                    "you’ve reached your usage limit",
                    "temporarily unavailable because of usage limits");
                var hasCodexUsageLink = ContainsAny(body,
                    "chatgpt.com/codex/settings/usage",
                    "upgrade to pro");
                if (hasCanonicalLimit && hasCodexUsageLink)
                {
                    return LogClassification.Trigger("额度或限流触发，任务结束后切换", "quota");
                }
                return LogClassification.None();
            }

            private static bool IsTrustedVisibleLimitEvent(string target, string body)
            {
                if (IsToolEchoEvent(target, body)) return false;
                if (IsGeneratedContentEvent(target, body)) return false;
                var t = (target ?? "").ToLowerInvariant();
                var b = body ?? "";
                if (t.IndexOf("codex_otel.", StringComparison.OrdinalIgnoreCase) >= 0
                    && ContainsAny(b, "event.name=\"codex.sse_event\"", "event.name=codex.sse_event", "error.message="))
                {
                    return true;
                }
                if (t == "codex_core::session::turn" && ContainsAny(b, "turn error:")) return true;
                return false;
            }

            private static bool IsGeneratedContentEvent(string target, string body)
            {
                if (ContainsAny(body,
                    "event.kind=response.output_text.delta",
                    "event.kind=response.function_call_arguments.delta",
                    "event.kind=response.reasoning_text.delta",
                    "\"type\":\"response.output_text.delta\"",
                    "\"type\":\"response.output_text.done\"",
                    "\"type\":\"response.content_part.done\"",
                    "\"type\":\"response.function_call_arguments.delta\"",
                    "message_from_assistant",
                    "output item item=message"))
                {
                    return true;
                }

                if (ContainsAny(body, "\"type\":\"response.output_item.done\"")
                    && ContainsAny(body, "\"type\":\"message\"", "\"type\":\"function_call\""))
                {
                    return true;
                }

                return false;
            }

            private static LogClassification ClassifyTrigger(string target, string body)
            {
                if (string.IsNullOrEmpty(body)) return LogClassification.None();

                if (!LooksLikeErrorContext(body)) return LogClassification.None();

                if (LooksLikeAccountDisabled(body))
                {
                    return LogClassification.Trigger("账号疑似停用或封禁", "account_disabled");
                }

                if (ContainsAny(body,
                        "token has been invalidated",
                        "authentication token has been invalidated",
                        "refresh token was already used",
                        "access token could not be refreshed",
                        "could not be refreshed",
                        "invalid_grant")
                    || ContainsAny(body, "invalid_request_error")
                    || ContainsHttpStatus(body, "401"))
                {
                    return LogClassification.Trigger("授权失效，等待空闲后切换", "auth");
                }

                if (ContainsAny(body, "too many requests", "rate limit", "usage limit", "insufficient_quota", "you've reached", "temporarily unavailable because of usage limits")
                    || ContainsAny(body, "quota")
                    || ContainsHttpStatus(body, "429"))
                {
                    return LogClassification.Trigger("额度或限流触发，等待空闲后切换", "quota");
                }

                return LogClassification.None();
            }

            private static bool IsTrustedResponseFailureEvent(string target, string body)
            {
                if (IsToolEchoEvent(target, body)) return false;
                if (IsGeneratedContentEvent(target, body)) return false;
                if (IsTaskTurnSummaryOnlyEvent(body)) return false;
                if (ContainsAny(body,
                    "codex.user_prompt",
                    "op.dispatch.user_input",
                    "thread/goal/set",
                    "\"role\":\"user\"",
                    "\"role\": \"user\"",
                    "\"role\":\"assistant\"",
                    "\"role\": \"assistant\"",
                    "message_from_assistant",
                    "output item item=message"))
                {
                    return false;
                }

                var t = (target ?? "").ToLowerInvariant();
                if (t.IndexOf("codex_otel.", StringComparison.OrdinalIgnoreCase) >= 0) return true;
                if (t.IndexOf("codex_api::", StringComparison.OrdinalIgnoreCase) >= 0
                    && ContainsAny(body, "event.name=\"codex.sse_event\"", "event.name=codex.sse_event", "error.message=", "\"error\":", "\"error\": {"))
                {
                    return true;
                }
                return false;
            }

            private static bool IsTaskTurnSummaryOnlyEvent(string body)
            {
                if (!ContainsAny(body,
                    "otel.name=\"session_task.turn\"",
                    "otel.name=session_task.turn",
                    "otel.name=\"session_task.run\"",
                    "session_task.turn"))
                {
                    return false;
                }

                return !ContainsAny(body,
                    "event.name=\"codex.sse_event\"",
                    "event.name=codex.sse_event",
                    "error.message=",
                    "http.status_code=",
                    "status_code=",
                    "\"status\":",
                    "\"error\":",
                    "\"error\": {");
            }

            private static bool LooksLikeAccountDisabled(string body)
            {
                if (string.IsNullOrEmpty(body)) return false;
                return ContainsAny(body,
                    "account_deactivated",
                    "account_disabled",
                    "organization_deactivated",
                    "organization_disabled",
                    "account has been blocked",
                    "account is blocked",
                    "account was blocked",
                    "account has been deactivated",
                    "account is deactivated",
                    "account has been disabled",
                    "account is disabled",
                    "user has been suspended",
                    "user is suspended",
                    "organization has been suspended",
                    "organization is suspended",
                    "organization has been deactivated",
                    "organization is deactivated",
                    "organization has been disabled",
                    "organization is disabled");
            }

            private static bool LooksLikeErrorContext(string body)
            {
                var hasStatus = ContainsHttpStatus(body, "401") || ContainsHttpStatus(body, "429");
                var hasStructuredError = ContainsAny(body, "\"error\":{", "\"error\": {", "error=");
                var hasKnownLimitOrAuthText = ContainsAny(body,
                    "token has been invalidated",
                    "authentication token has been invalidated",
                    "refresh token was already used",
                    "access token could not be refreshed",
                    "could not be refreshed",
                    "invalid_grant",
                    "too many requests",
                    "rate limit",
                    "usage limit",
                    "insufficient_quota",
                    "temporarily unavailable because of usage limits");

                return ContainsAny(body,
                    "\"type\":\"response.failed\"",
                    "event.kind=response.failed",
                    "request failed",
                    "exception",
                    "api error",
                    "api_error",
                    "invalid_request_error",
                    "otel.status_code=\"error\"",
                    "level=error")
                    || (hasStructuredError && (hasStatus || hasKnownLimitOrAuthText));
            }

            private static bool ContainsHttpStatus(string body, string code)
            {
                return ContainsAny(body,
                    "status=" + code,
                    "status_code=" + code,
                    "http.status_code=" + code,
                    "\"status\":" + code,
                    "-> " + code,
                    code + ": {\"error\"",
                    " " + code + " ");
            }

            private static bool ContainsAny(string value, params string[] needles)
            {
                if (string.IsNullOrEmpty(value)) return false;
                foreach (var needle in needles)
                {
                    if (!string.IsNullOrEmpty(needle) && value.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) return true;
                }
                return false;
            }

            private static DateTime RowTime(LogRow row)
            {
                try
                {
                    if (row.Ts <= 0) return DateTime.UtcNow;
                    var epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
                    return epoch.AddSeconds(row.Ts).AddTicks(Math.Max(0, row.TsNanos) / 100);
                }
                catch
                {
                    return DateTime.UtcNow;
                }
            }

            private static long UnixSeconds(DateTime value)
            {
                return (long)Math.Floor((value.ToUniversalTime() - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds);
            }

            private sealed class SqliteLogReader : IDisposable
            {
                private IntPtr _db;

                public SqliteLogReader(string path)
                {
                    var rc = sqlite3_open_v2(path, out _db, SQLITE_OPEN_READONLY, IntPtr.Zero);
                    if (rc != SQLITE_OK || _db == IntPtr.Zero)
                    {
                        var message = _db == IntPtr.Zero ? "无法打开日志库" : Utf8(sqlite3_errmsg(_db), -1);
                        if (_db != IntPtr.Zero) sqlite3_close(_db);
                        _db = IntPtr.Zero;
                        throw new InvalidOperationException(message);
                    }
                    sqlite3_busy_timeout(_db, 500);
                }

                public long QueryScalarLong(string sql)
                {
                    IntPtr stmt;
                    Prepare(sql, out stmt);
                    try
                    {
                        var rc = sqlite3_step(stmt);
                        if (rc == SQLITE_ROW) return sqlite3_column_int64(stmt, 0);
                        if (rc == SQLITE_DONE) return 0;
                        throw new InvalidOperationException("SQLite 查询失败：" + rc);
                    }
                    finally
                    {
                        sqlite3_finalize(stmt);
                    }
                }

                public string QueryScalarString(string sql)
                {
                    IntPtr stmt;
                    Prepare(sql, out stmt);
                    try
                    {
                        var rc = sqlite3_step(stmt);
                        if (rc == SQLITE_ROW) return ColumnText(stmt, 0).Trim();
                        if (rc == SQLITE_DONE) return "";
                        throw new InvalidOperationException("SQLite 查询失败：" + rc);
                    }
                    finally
                    {
                        sqlite3_finalize(stmt);
                    }
                }

                public IEnumerable<LogRow> QueryRows(string sql)
                {
                    var result = new List<LogRow>();
                    IntPtr stmt;
                    Prepare(sql, out stmt);
                    try
                    {
                        while (true)
                        {
                            var rc = sqlite3_step(stmt);
                            if (rc == SQLITE_ROW)
                            {
                                result.Add(new LogRow
                                {
                                    Id = sqlite3_column_int64(stmt, 0),
                                    Ts = sqlite3_column_int64(stmt, 1),
                                    TsNanos = sqlite3_column_int64(stmt, 2),
                                    Target = ColumnText(stmt, 3),
                                    Body = ColumnText(stmt, 4)
                                });
                                continue;
                            }
                            if (rc == SQLITE_DONE) break;
                            throw new InvalidOperationException("SQLite 查询失败：" + rc);
                        }
                    }
                    finally
                    {
                        sqlite3_finalize(stmt);
                    }
                    return result;
                }

                public IEnumerable<string[]> QueryTextRows(string sql, int columnCount)
                {
                    var result = new List<string[]>();
                    IntPtr stmt;
                    Prepare(sql, out stmt);
                    try
                    {
                        while (true)
                        {
                            var rc = sqlite3_step(stmt);
                            if (rc == SQLITE_ROW)
                            {
                                var row = new string[Math.Max(0, columnCount)];
                                for (var i = 0; i < row.Length; i++) row[i] = ColumnText(stmt, i);
                                result.Add(row);
                                continue;
                            }
                            if (rc == SQLITE_DONE) break;
                            throw new InvalidOperationException("SQLite 查询失败：" + rc);
                        }
                    }
                    finally
                    {
                        sqlite3_finalize(stmt);
                    }
                    return result;
                }

                private void Prepare(string sql, out IntPtr stmt)
                {
                    var rc = sqlite3_prepare_v2(_db, sql, -1, out stmt, IntPtr.Zero);
                    if (rc != SQLITE_OK) throw new InvalidOperationException(Utf8(sqlite3_errmsg(_db), -1));
                }

                private static string ColumnText(IntPtr stmt, int index)
                {
                    return Utf8(sqlite3_column_text(stmt, index), sqlite3_column_bytes(stmt, index));
                }

                public void Dispose()
                {
                    if (_db != IntPtr.Zero)
                    {
                        sqlite3_close(_db);
                        _db = IntPtr.Zero;
                    }
                }
            }

            private static string Utf8(IntPtr ptr, int length)
            {
                if (ptr == IntPtr.Zero) return "";
                if (length < 0)
                {
                    length = 0;
                    while (Marshal.ReadByte(ptr, length) != 0) length++;
                }
                if (length <= 0) return "";
                var buffer = new byte[length];
                Marshal.Copy(ptr, buffer, 0, length);
                return Encoding.UTF8.GetString(buffer);
            }

            private sealed class LogRow
            {
                public long Id;
                public long Ts;
                public long TsNanos;
                public string Target = "";
                public string Body = "";
            }

            private sealed class LogClassification
            {
                public string Kind = "none";
                public string Label = "";
                public string TriggerType = "";
                public bool EndsTask;
                public bool StartsTool;
                public bool EndsTool;

                public static LogClassification None()
                {
                    return new LogClassification();
                }

                public static LogClassification Activity(string label)
                {
                    return new LogClassification { Kind = "activity", Label = label };
                }

                public static LogClassification ToolStarted(string label)
                {
                    return new LogClassification { Kind = "activity", Label = label, StartsTool = true };
                }

                public static LogClassification ToolComplete(string label)
                {
                    return new LogClassification { Kind = "tool_complete", Label = label, EndsTool = true };
                }

                public static LogClassification Complete(string label)
                {
                    return new LogClassification { Kind = "complete", Label = label };
                }

                public static LogClassification Trigger(string label, string triggerType)
                {
                    return new LogClassification { Kind = "trigger", Label = label, TriggerType = triggerType };
                }
            }
        }

        private sealed class CodexRuntimeStatus
        {
            public string State = "unknown";
            public string Label = "状态未知";
            public string Detail = "";
            public string Source = "app-server";
            public bool ProtocolConnected;
            public bool UsedFallback;
            public string RawState = "";
            public string Evidence = "";
            public string WindowTitle = "";
            public double StableSeconds = -1;
            public int RunningProcessCount;
            public int PrivateAppServerCount;
            public int LoadedThreadCount;
            public int ActiveThreadCount;
            public int WaitingThreadCount;
            public int ThreadCount;
            public double CpuPercent = -1;
            public double UserIdleSeconds = -1;
            public string ActivityFile = "";
            public bool SafeToSwitch;
            public long LastSeenLogId;
            public int TaskEventCount;
            public string LastTaskEvent = "";
            public DateTime LastTaskEventAt = DateTime.MinValue;
            public double IdleSeconds = -1;
            public string PendingSwitchReason = "";
            public string PendingSwitchType = "";
            public DateTime PendingSwitchAt = DateTime.MinValue;
            public DateTime CheckedAt = DateTime.UtcNow;

            public static CodexRuntimeStatus Unknown(string detail)
            {
                return new CodexRuntimeStatus
                {
                    State = "unknown",
                    Label = "状态未知",
                    Detail = detail ?? "",
                    Source = "app-server",
                    ProtocolConnected = false,
                    UsedFallback = true,
                    SafeToSwitch = false,
                    CheckedAt = DateTime.UtcNow
                };
            }

            public static CodexRuntimeStatus NotRunning(int processCount)
            {
                return new CodexRuntimeStatus
                {
                    State = "not_running",
                    Label = "Codex 未运行",
                    Detail = "未发现 Codex 桌面进程。",
                    Source = "process",
                    ProtocolConnected = false,
                    UsedFallback = false,
                    SafeToSwitch = false,
                    RunningProcessCount = processCount,
                    CheckedAt = DateTime.UtcNow
                };
            }

            public static CodexRuntimeStatus FromProtocol(ProtocolProbeResult probe, bool targetRunning, int processCount, int privateAppServers)
            {
                var status = new CodexRuntimeStatus
                {
                    RunningProcessCount = processCount,
                    PrivateAppServerCount = privateAppServers,
                    ProtocolConnected = probe.Connected,
                    LoadedThreadCount = probe.LoadedThreadCount,
                    ActiveThreadCount = probe.ActiveThreadCount,
                    WaitingThreadCount = probe.WaitingThreadCount,
                    ThreadCount = probe.ThreadCount,
                    CheckedAt = DateTime.UtcNow
                };

                if (!probe.Connected)
                {
                    status.State = targetRunning ? "unknown" : "not_running";
                    status.Label = targetRunning ? "状态未知" : "Codex 未运行";
                    status.Detail = string.IsNullOrEmpty(probe.Error) ? "app-server 协议未连接。" : probe.Error;
                    status.Source = "app-server";
                    status.UsedFallback = true;
                    return status;
                }

                if (probe.WaitingThreadCount > 0)
                {
                    status.State = "waiting";
                    status.Label = "等待确认";
                    status.Detail = "app-server 检测到线程正在等待用户确认。";
                    status.Source = "app-server";
                    return status;
                }
                if (probe.ActiveThreadCount > 0)
                {
                    status.State = "active";
                    status.Label = "任务中";
                    status.Detail = "app-server 检测到正在运行的线程。";
                    status.Source = "app-server";
                    return status;
                }
                if (probe.LoadedThreadCount > 0)
                {
                    status.State = "idle";
                    status.Label = "空闲";
                    status.Detail = "app-server 已连接，加载线程未处于运行状态。";
                    status.Source = "app-server";
                    return status;
                }
                if (privateAppServers > 0)
                {
                    status.State = "unknown";
                    status.Label = "保守监控";
                    status.Detail = "桌面端 app-server 使用私有 stdio，协议侧车未发现运行线程；自动切换会继续使用保守空闲保护。";
                    status.Source = "app-server+fallback";
                    status.UsedFallback = true;
                    return status;
                }

                status.State = targetRunning ? "idle" : "not_running";
                status.Label = targetRunning ? "空闲" : "Codex 未运行";
                status.Detail = targetRunning ? "app-server 已连接，未发现正在运行的线程。" : "未发现 Codex 桌面进程。";
                status.Source = "app-server";
                return status;
            }

            public CodexRuntimeStatus Clone()
            {
                return new CodexRuntimeStatus
                {
                    State = State,
                    Label = Label,
                    Detail = Detail,
                    Source = Source,
                    ProtocolConnected = ProtocolConnected,
                    UsedFallback = UsedFallback,
                    RawState = RawState,
                    Evidence = Evidence,
                    WindowTitle = WindowTitle,
                    StableSeconds = StableSeconds,
                    RunningProcessCount = RunningProcessCount,
                    PrivateAppServerCount = PrivateAppServerCount,
                    LoadedThreadCount = LoadedThreadCount,
                    ActiveThreadCount = ActiveThreadCount,
                    WaitingThreadCount = WaitingThreadCount,
                    ThreadCount = ThreadCount,
                    CpuPercent = CpuPercent,
                    UserIdleSeconds = UserIdleSeconds,
                    ActivityFile = ActivityFile,
                    SafeToSwitch = SafeToSwitch,
                    LastSeenLogId = LastSeenLogId,
                    TaskEventCount = TaskEventCount,
                    LastTaskEvent = LastTaskEvent,
                    LastTaskEventAt = LastTaskEventAt,
                    IdleSeconds = IdleSeconds,
                    PendingSwitchReason = PendingSwitchReason,
                    PendingSwitchType = PendingSwitchType,
                    PendingSwitchAt = PendingSwitchAt,
                    CheckedAt = CheckedAt
                };
            }

            public string ToJson()
            {
                return "{"
                    + "\"state\":\"" + JsonEscape(State) + "\","
                    + "\"label\":\"" + JsonEscape(Label) + "\","
                    + "\"detail\":\"" + JsonEscape(Detail) + "\","
                    + "\"source\":\"" + JsonEscape(Source) + "\","
                    + "\"protocol_connected\":" + (ProtocolConnected ? "true" : "false") + ","
                    + "\"used_fallback\":" + (UsedFallback ? "true" : "false") + ","
                    + "\"safe_to_switch\":" + (SafeToSwitch ? "true" : "false") + ","
                    + "\"raw_state\":\"" + JsonEscape(RawState) + "\","
                    + "\"evidence\":\"" + JsonEscape(Evidence) + "\","
                    + "\"window_title\":\"" + JsonEscape(WindowTitle) + "\","
                    + "\"stable_seconds\":" + StableSeconds.ToString("0.###", CultureInfo.InvariantCulture) + ","
                    + "\"running_process_count\":" + RunningProcessCount + ","
                    + "\"private_app_server_count\":" + PrivateAppServerCount + ","
                    + "\"loaded_thread_count\":" + LoadedThreadCount + ","
                    + "\"active_thread_count\":" + ActiveThreadCount + ","
                    + "\"waiting_thread_count\":" + WaitingThreadCount + ","
                    + "\"thread_count\":" + ThreadCount + ","
                    + "\"cpu_percent\":" + CpuPercent.ToString("0.###", CultureInfo.InvariantCulture) + ","
                    + "\"user_idle_seconds\":" + UserIdleSeconds.ToString("0.###", CultureInfo.InvariantCulture) + ","
                    + "\"activity_file\":\"" + JsonEscape(ActivityFile) + "\","
                    + "\"idle_seconds\":" + IdleSeconds.ToString("0.###", CultureInfo.InvariantCulture) + ","
                    + "\"last_seen_log_id\":" + LastSeenLogId + ","
                    + "\"task_event_count\":" + TaskEventCount + ","
                    + "\"last_task_event\":\"" + JsonEscape(LastTaskEvent) + "\","
                    + "\"last_task_event_at\":\"" + JsonEscape(LastTaskEventAt == DateTime.MinValue ? "" : LastTaskEventAt.ToString("o")) + "\","
                    + "\"pending_switch_reason\":\"" + JsonEscape(PendingSwitchReason) + "\","
                    + "\"pending_switch_type\":\"" + JsonEscape(PendingSwitchType) + "\","
                    + "\"pending_switch_at\":\"" + JsonEscape(PendingSwitchAt == DateTime.MinValue ? "" : PendingSwitchAt.ToString("o")) + "\","
                    + "\"checked_at\":\"" + JsonEscape(CheckedAt == DateTime.MinValue ? "" : CheckedAt.ToString("o")) + "\""
                    + "}";
            }
        }
    }
}

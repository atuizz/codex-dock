using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
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
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += delegate (object sender, ThreadExceptionEventArgs e)
            {
                WriteUnhandledException("ui-thread", e.Exception);
            };
            AppDomain.CurrentDomain.UnhandledException += delegate (object sender, UnhandledExceptionEventArgs e)
            {
                WriteUnhandledException("app-domain", e.ExceptionObject as Exception);
            };

            try
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm());
            }
            catch (Exception ex)
            {
                WriteUnhandledException("main-loop", ex);
            }
        }

        private static void WriteUnhandledException(string source, Exception ex)
        {
            try
            {
                var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CodexDock");
                Directory.CreateDirectory(dir);
                var message = "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + "] [unhandled:" + source + "] "
                    + (ex == null ? "unknown exception" : ex.ToString());
                File.AppendAllText(Path.Combine(dir, "helper.log"), message + Environment.NewLine, new UTF8Encoding(false));
            }
            catch { }
        }
    }

    public sealed class MainForm : Form
    {
        private const string HelperVersion = "0.4.11";
        private const string HelperBuildDate = "2026-06-06";
        private const string ProductFullName = "Codex Dock Agent";
        private const string HelperDownloadDefaultFile = "downloads/CodexDockHelper.exe";
        private const int HelperLogMaxBytes = 1024 * 1024;
        private const int HelperLogBackups = 5;
        private const int HelperUiLogLineLimit = 400;
        private const int HelperUiLogMaxCharacters = 160000;
        private const int AutoSwitchRepeatedLogSeconds = 300;
        private const int AutoSwitchFailureBackoffSeconds = 180;
        private const int AutoSwitchFailurePauseThreshold = 3;
        private const int AutoSwitchFailurePauseSeconds = 1800;
        private const int TrayWatchdogIntervalMs = 30000;
        private static readonly object HelperLogFileLock = new object();
        private int _port = 18766;
        private readonly string _root;
        private readonly DateTime _startedAtUtc = DateTime.UtcNow;
        private readonly Label _statusLabel;
        private readonly Label _authLabel;
        private readonly SafeLogRichTextBox _logBox;
        private readonly Font _logRegularFont;
        private readonly Font _logBoldFont;
        private readonly SoftButton _startButton;
        private readonly SoftButton _stopButton;
        private readonly SoftButton _openButton;
        private readonly SoftButton _updateButton;
        private readonly SoftButton _folderButton;
        private readonly SoftButton _refreshAuthButton;
        private readonly SoftButton _importAuthButton;
        private readonly SoftButton _backupAuthButton;
        private readonly SoftButton _launchCodexButton;
        private readonly Label _serviceBadgeLabel;
        private readonly InfoBox _portLabel;
        private readonly Label _runtimeLabel;
        private readonly Label _runtimeDetailLabel;
        private readonly Label _autoSwitchLabel;
        private readonly Label _autoSwitchDetailLabel;
        private readonly Label _uptimeLabel;
        private readonly System.Windows.Forms.Timer _dashboardTimer;
        private readonly System.Windows.Forms.Timer _trayWatchdogTimer;
        private readonly Icon _appIcon;
        private readonly NotifyIcon _trayIcon;
        private readonly ContextMenuStrip _trayMenu;
        private ToolStripMenuItem _trayStatusItem;
        private HttpListener _listener;
        private HttpListener _oauthCallbackListener;
        private Thread _oauthCallbackThread;
        private volatile bool _oauthCallbackRunning;
        private Thread _serverThread;
        private volatile bool _running;
        private bool _allowExit;
        private bool _trayTipShown;
        private DateTime _lastTrayIconConfirmedAtUtc = DateTime.MinValue;
        private string _lastTrayIconReason = "";
        private string _lastTrayIconError = "";
        private volatile bool _applicationClosing;
        private readonly object _recentLogLock = new object();
        private readonly Queue<string> _recentLogLines = new Queue<string>();
        private bool _logViewNeedsReload = true;
        private readonly object _autoSwitchLock = new object();
        private Thread _autoSwitchThread;
        private volatile bool _autoSwitchStop;
        private AutoSwitchConfig _autoSwitchConfig;
        private DateTime _lastAutoSwitchAt = DateTime.MinValue;
        private DateTime _lastAutoSwitchCheckAt = DateTime.MinValue;
        private string _lastAutoSwitchReason = "";
        private string _lastAutoSwitchResult = "";
        private string _lastAutoSwitchStage = "";
        private string _lastAutoSwitchStageLabel = "";
        private string _lastAutoSwitchFailureStage = "";
        private string _lastAutoSwitchFailureDetail = "";
        private DateTime _autoSwitchFailurePauseUntilUtc = DateTime.MinValue;
        private string _autoSwitchFailurePauseKey = "";
        private string _autoSwitchFailureStreakKey = "";
        private int _autoSwitchFailureStreak = 0;
        private DateTime _autoSwitchFailureSuspendedUntilUtc = DateTime.MinValue;
        private string _autoSwitchFailureSuspendedReason = "";
        private string _lastAutoSwitchLogKey = "";
        private DateTime _lastAutoSwitchLogAt = DateTime.MinValue;
        private string _lastAutoSwitchAuditKey = "";
        private DateTime _lastAutoSwitchAuditAt = DateTime.MinValue;
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

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        private static extern int RegisterWindowMessage(string lpString);

        [DllImport("user32.dll")]
        private static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr hWnd);

        private static readonly IntPtr HWND_BROADCAST = new IntPtr(0xffff);
        private static readonly int TaskbarCreatedMessage = RegisterWindowMessage("TaskbarCreated");
        private const int WM_SETTINGCHANGE = 0x001A;
        private const int SMTO_ABORTIFHUNG = 0x0002;
        private const int SW_RESTORE = 9;
        private const int SW_SHOW = 5;

        public MainForm()
        {
            _root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            _autoSwitchConfig = LoadAutoSwitchConfig();
            RestorePersistedAutoSwitchPendingState();

            _appIcon = CreateAppIcon();
            _logRegularFont = new Font("Consolas", 9.5F, FontStyle.Regular);
            _logBoldFont = new Font("Consolas", 9.5F, FontStyle.Bold);

            Text = ProductFullName;
            Icon = _appIcon;
            Width = 1180;
            Height = 800;
            MinimumSize = new Size(1000, 680);
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Microsoft YaHei UI", 9F);
            BackColor = Color.FromArgb(246, 246, 243);
            ForeColor = Color.FromArgb(24, 26, 27);

            var root = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                BackColor = BackColor,
                Padding = new Padding(28, 24, 28, 24),
                RowCount = 4,
                ColumnCount = 1,
            };
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 132));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 284));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 82));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            Controls.Add(root);

            var header = new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = BackColor,
            };
            root.Controls.Add(header, 0, 0);

            var title = MakeLabel(ProductFullName, 24F, FontStyle.Bold, Color.FromArgb(0, 0, 0));
            title.Location = new Point(0, 26);
            title.Size = new Size(390, 42);
            header.Controls.Add(title);

            var version = MakeLabel("v" + HelperVersion, 10F, FontStyle.Regular, Color.FromArgb(145, 145, 145));
            version.Location = new Point(338, 37);
            version.Size = new Size(120, 24);
            header.Controls.Add(version);
            version.BringToFront();

            var subtitle = MakeLabel("本机执行代理，负责写入 auth、观察任务边界并安全切换。", 10F, FontStyle.Regular, Color.FromArgb(48, 55, 64));
            subtitle.Location = new Point(0, 72);
            subtitle.Size = new Size(660, 26);
            header.Controls.Add(subtitle);

            _statusLabel = new Label
            {
                Text = "● 正在启动",
                Font = new Font("Microsoft YaHei UI", 9.5F, FontStyle.Bold),
                ForeColor = Color.FromArgb(5, 130, 96),
                BackColor = Color.FromArgb(251, 251, 250),
                TextAlign = ContentAlignment.MiddleCenter,
                AutoSize = false,
                Anchor = AnchorStyles.Top | AnchorStyles.Right,
                Location = new Point(886, 34),
                Size = new Size(202, 34),
            };
            header.Controls.Add(_statusLabel);
            RoundControl(_statusLabel, 16);

            _uptimeLabel = MakeLabel("运行时间 0 分钟", 9F, FontStyle.Regular, Color.FromArgb(112, 117, 121));
            _uptimeLabel.TextAlign = ContentAlignment.MiddleRight;
            _uptimeLabel.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _uptimeLabel.Location = new Point(764, 76);
            _uptimeLabel.Size = new Size(324, 24);
            header.Controls.Add(_uptimeLabel);
            header.Resize += delegate
            {
                _statusLabel.Left = Math.Max(540, header.ClientSize.Width - _statusLabel.Width);
                _uptimeLabel.Left = Math.Max(460, header.ClientSize.Width - _uptimeLabel.Width);
            };

            var divider = new Panel
            {
                Height = 1,
                BackColor = Color.FromArgb(226, 226, 222),
                Dock = DockStyle.Bottom,
            };
            header.Controls.Add(divider);

            var cards = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                BackColor = BackColor,
                Padding = new Padding(0, 8, 0, 14),
                ColumnCount = 3,
                RowCount = 1,
            };
            cards.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 34));
            cards.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33));
            cards.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33));
            root.Controls.Add(cards, 0, 1);

            var serviceCard = MakeCard();
            serviceCard.Margin = new Padding(0, 0, 10, 0);
            cards.Controls.Add(serviceCard, 0, 0);

            var serviceLayout = MakeCardLayout(5);
            serviceCard.Controls.Add(serviceLayout);
            serviceLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
            serviceLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
            serviceLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 96));
            serviceLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            serviceLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));

            var serviceTitle = MakeLabel("服务状态", 15F, FontStyle.Bold, Color.FromArgb(0, 0, 0));
            serviceTitle.Dock = DockStyle.Fill;
            serviceLayout.Controls.Add(serviceTitle, 0, 0);
            serviceLayout.SetColumnSpan(serviceTitle, 3);

            _serviceBadgeLabel = new Label
            {
                Text = "离线",
                Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Bold),
                ForeColor = Color.FromArgb(16, 126, 84),
                BackColor = Color.FromArgb(212, 247, 229),
                TextAlign = ContentAlignment.MiddleCenter,
                AutoSize = false,
                Size = new Size(48, 30),
                Anchor = AnchorStyles.Top | AnchorStyles.Right,
            };
            serviceCard.Controls.Add(_serviceBadgeLabel);
            RoundControl(_serviceBadgeLabel, 6);
            _serviceBadgeLabel.BringToFront();
            serviceCard.Layout += delegate
            {
                _serviceBadgeLabel.Left = Math.Max(10, serviceCard.ClientSize.Width - _serviceBadgeLabel.Width - 18);
                _serviceBadgeLabel.Top = 20;
            };

            var serviceCopy = MakeLabel("监听本地端口并执行授权写入。", 9.5F, FontStyle.Regular, Color.FromArgb(40, 48, 58));
            serviceCopy.Dock = DockStyle.Fill;
            serviceLayout.Controls.Add(serviceCopy, 0, 1);
            serviceLayout.SetColumnSpan(serviceCopy, 3);

            _portLabel = new InfoBox
            {
                Text = "Local API: 未启动\r\nOAuth: http://localhost:1455/auth/callback\r\nCloud: codex.woai.pro",
                ForeColor = Color.FromArgb(40, 48, 58),
                BackColor = Color.FromArgb(250, 250, 248),
                Dock = DockStyle.Fill,
            };
            _portLabel.Font = new Font("Consolas", 9.2F, FontStyle.Regular);
            serviceLayout.Controls.Add(_portLabel, 0, 2);
            serviceLayout.SetColumnSpan(_portLabel, 3);

            var serviceButtons = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.Transparent,
                ColumnCount = 2,
                RowCount = 1,
            };
            serviceButtons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            serviceButtons.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 62));
            serviceLayout.Controls.Add(serviceButtons, 0, 4);
            serviceLayout.SetColumnSpan(serviceButtons, 3);

            _startButton = MakeButton("重启服务", true);
            _startButton.Dock = DockStyle.Fill;
            _startButton.Margin = new Padding(0, 3, 10, 3);
            serviceButtons.Controls.Add(_startButton, 0, 0);

            _stopButton = MakeIconButton("停止");
            _stopButton.Dock = DockStyle.Fill;
            _stopButton.Margin = new Padding(0, 3, 0, 3);
            _stopButton.Enabled = false;
            serviceButtons.Controls.Add(_stopButton, 1, 0);

            var authCard = MakeCard();
            authCard.Margin = new Padding(0, 0, 10, 0);
            cards.Controls.Add(authCard, 1, 0);

            var authLayout = MakeCardLayout(5);
            authCard.Controls.Add(authLayout);
            authLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
            authLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 104));
            authLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            authLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
            authLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 1));

            var authTitle = MakeLabel("授权生命周期", 15F, FontStyle.Bold, Color.FromArgb(0, 0, 0));
            authTitle.Dock = DockStyle.Fill;
            authLayout.Controls.Add(authTitle, 0, 0);
            authLayout.SetColumnSpan(authTitle, 3);

            _authLabel = new Label
            {
                Text = "当前 auth：未检测",
                Font = new Font("Consolas", 9.2F, FontStyle.Regular),
                ForeColor = Color.FromArgb(40, 48, 58),
                BackColor = Color.Transparent,
                AutoSize = false,
                Dock = DockStyle.Fill,
            };
            authLayout.Controls.Add(_authLabel, 0, 1);
            authLayout.SetColumnSpan(_authLabel, 3);

            var authButtons = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.Transparent,
                ColumnCount = 3,
                RowCount = 1,
            };
            authButtons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.33F));
            authButtons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.33F));
            authButtons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.34F));
            authLayout.Controls.Add(authButtons, 0, 3);
            authLayout.SetColumnSpan(authButtons, 3);

            _refreshAuthButton = MakeButton("刷新", false);
            _refreshAuthButton.Text = "刷新状态";
            _refreshAuthButton.Dock = DockStyle.Fill;
            _refreshAuthButton.Margin = new Padding(0, 3, 7, 3);
            authButtons.Controls.Add(_refreshAuthButton, 0, 0);

            _folderButton = MakeButton("Codex 目录", false);
            _folderButton.Dock = DockStyle.Fill;
            _folderButton.Margin = new Padding(0, 3, 7, 3);
            authButtons.Controls.Add(_folderButton, 1, 0);

            _backupAuthButton = MakeButton("备份 auth", false);
            _backupAuthButton.Dock = DockStyle.Fill;
            _backupAuthButton.Margin = new Padding(0, 3, 0, 3);
            authButtons.Controls.Add(_backupAuthButton, 2, 0);

            var runtimeCard = MakeCard();
            runtimeCard.Margin = new Padding(0);
            cards.Controls.Add(runtimeCard, 2, 0);

            var runtimeLayout = MakeCardLayout(5);
            runtimeCard.Controls.Add(runtimeLayout);
            runtimeLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
            runtimeLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
            runtimeLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 74));
            runtimeLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            runtimeLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));

            var runtimeTitle = MakeLabel("Codex 守护进程", 15F, FontStyle.Bold, Color.FromArgb(0, 0, 0));
            runtimeTitle.Dock = DockStyle.Fill;
            runtimeLayout.Controls.Add(runtimeTitle, 0, 0);
            runtimeLayout.SetColumnSpan(runtimeTitle, 3);

            _runtimeLabel = MakeLabel("尚未探测", 15F, FontStyle.Bold, Color.FromArgb(28, 42, 50));
            _runtimeLabel.Dock = DockStyle.Fill;
            runtimeLayout.Controls.Add(_runtimeLabel, 0, 1);
            runtimeLayout.SetColumnSpan(_runtimeLabel, 3);

            _runtimeDetailLabel = MakeLabel("等待状态监控启动。", 9F, FontStyle.Regular, Color.FromArgb(95, 101, 105));
            _runtimeDetailLabel.Dock = DockStyle.Fill;
            runtimeLayout.Controls.Add(_runtimeDetailLabel, 0, 2);
            runtimeLayout.SetColumnSpan(_runtimeDetailLabel, 3);

            _launchCodexButton = MakeButton("启动 Codex", false);
            _launchCodexButton.Text = "▷ 启动";
            _launchCodexButton.Width = 126;
            _launchCodexButton.Height = 42;
            runtimeLayout.Controls.Add(_launchCodexButton, 0, 4);

            var actionCard = MakeCard();
            actionCard.Margin = new Padding(0, 0, 0, 14);
            actionCard.Padding = new Padding(18, 10, 18, 10);
            root.Controls.Add(actionCard, 0, 2);

            var actionLayout = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.Transparent,
                ColumnCount = 4,
                RowCount = 1,
            };
            actionLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            actionLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 142));
            actionLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 156));
            actionLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 156));
            actionLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            actionCard.Controls.Add(actionLayout);

            var autoPanel = new Panel { Dock = DockStyle.Fill, BackColor = Color.Transparent };
            actionLayout.Controls.Add(autoPanel, 0, 0);

            _autoSwitchLabel = MakeLabel("智能切换：未开启", 11F, FontStyle.Bold, Color.FromArgb(18, 18, 18));
            _autoSwitchLabel.Location = new Point(0, 0);
            _autoSwitchLabel.Size = new Size(240, 22);
            autoPanel.Controls.Add(_autoSwitchLabel);

            _autoSwitchDetailLabel = MakeLabel("在控制台开启后，Agent 会按云端策略保护额度。", 9F, FontStyle.Regular, Color.FromArgb(95, 101, 105));
            _autoSwitchDetailLabel.Location = new Point(0, 24);
            _autoSwitchDetailLabel.Size = new Size(520, 21);
            _autoSwitchDetailLabel.Anchor = AnchorStyles.Left | AnchorStyles.Top | AnchorStyles.Right;
            autoPanel.Controls.Add(_autoSwitchDetailLabel);

            _updateButton = MakeButton("检查更新", false);
            _updateButton.Dock = DockStyle.Fill;
            _updateButton.Margin = new Padding(8, 6, 8, 6);
            actionLayout.Controls.Add(_updateButton, 1, 0);

            _importAuthButton = MakeButton("导入 auth.json", false);
            _importAuthButton.Dock = DockStyle.Fill;
            _importAuthButton.Margin = new Padding(8, 6, 8, 6);
            actionLayout.Controls.Add(_importAuthButton, 2, 0);

            _openButton = MakeButton("打开控制台", true);
            _openButton.Dock = DockStyle.Fill;
            _openButton.Margin = new Padding(8, 4, 8, 4);
            actionLayout.Controls.Add(_openButton, 3, 0);

            var logCard = MakeCard();
            logCard.Margin = new Padding(0);
            logCard.BackColor = Color.FromArgb(28, 28, 28);
            root.Controls.Add(logCard, 0, 3);

            var logLayout = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.Transparent,
                ColumnCount = 1,
                RowCount = 2,
            };
            logLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
            logLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            logCard.Controls.Add(logLayout);

            var logHeader = new Panel { Dock = DockStyle.Fill, BackColor = Color.Transparent };
            logLayout.Controls.Add(logHeader, 0, 0);

            var logTitle = MakeLabel("执行日志", 15F, FontStyle.Bold, Color.White);
            logTitle.Location = new Point(0, 0);
            logTitle.Size = new Size(160, 32);
            logHeader.Controls.Add(logTitle);

            var clearLogButton = MakeButton("清空显示", false);
            clearLogButton.Width = 102;
            clearLogButton.Height = 32;
            clearLogButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            clearLogButton.Location = new Point(logHeader.ClientSize.Width - clearLogButton.Width, 0);
            logHeader.Controls.Add(clearLogButton);
            logHeader.Resize += delegate
            {
                clearLogButton.Left = Math.Max(0, logHeader.ClientSize.Width - clearLogButton.Width);
            };

            _logBox = new SafeLogRichTextBox(delegate (Exception ex)
            {
                _logViewNeedsReload = true;
                RecordLogViewFailure("handle-created", ex);
            })
            {
                Multiline = true,
                ReadOnly = true,
                ScrollBars = RichTextBoxScrollBars.Vertical,
                BorderStyle = BorderStyle.None,
                Font = _logRegularFont,
                ForeColor = Color.FromArgb(223, 233, 212),
                BackColor = Color.FromArgb(28, 28, 28),
                DetectUrls = false,
                Dock = DockStyle.Fill,
            };
            logLayout.Controls.Add(_logBox, 0, 1);

            _startButton.Click += delegate
            {
                if (_running)
                {
                    StopServer();
                    StartServer();
                }
                else
                {
                    StartServer();
                }
            };
            _stopButton.Click += delegate { StopServer(); };
            _openButton.Click += delegate { OpenManagementPage(); };
            _updateButton.Click += delegate { BeginHelperUpdateCheckFromUi(); };
            _folderButton.Click += delegate { OpenCodexFolder(); };
            _refreshAuthButton.Click += delegate { RefreshAuthStatus(); };
            _importAuthButton.Click += delegate { ImportAndApplyAuthJson(); };
            _backupAuthButton.Click += delegate { BackupCurrentAuth(); };
            _launchCodexButton.Click += delegate { LaunchCodexWithLog(); };
            clearLogButton.Click += delegate { ClearVisibleLogs(); };
            _trayMenu = BuildTrayMenu();
            _trayIcon = new NotifyIcon
            {
                Icon = _appIcon,
                Text = ProductFullName + " 正在准备",
                Visible = true,
                ContextMenuStrip = _trayMenu
            };
            _trayIcon.DoubleClick += delegate { ShowFromTray(); };
            _dashboardTimer = new System.Windows.Forms.Timer { Interval = 1500 };
            _dashboardTimer.Tick += delegate { RefreshDashboardUi(); };
            _dashboardTimer.Start();
            _trayWatchdogTimer = new System.Windows.Forms.Timer { Interval = TrayWatchdogIntervalMs };
            _trayWatchdogTimer.Tick += delegate { EnsureTrayIconHeartbeat(); };
            _trayWatchdogTimer.Start();
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
                LoadRecentLogHistory();
                RestoreRecentLogView("主窗口首次显示");
                RefreshAuthStatus();
                RepairCodexStartupChain();
                StartServer();
                StartCodexStatusMonitor();
                StartAutoSwitchService();
                RefreshDashboardUi();
                EnsureTrayIcon("主窗口首次显示");
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
            return HelperDesktopUi.MakeLabel(text, size, style, color);
        }

        private static TableLayoutPanel MakeCardLayout(int rows)
        {
            var layout = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.Transparent,
                ColumnCount = 3,
                RowCount = rows,
            };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 34));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33));
            return layout;
        }

        private static Panel MakeCard()
        {
            return new SurfacePanel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.White,
                Padding = new Padding(18),
            };
        }

        private static SoftButton MakeButton(string text, bool primary)
        {
            return new SoftButton(primary)
            {
                Text = text,
                Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Bold),
                Cursor = Cursors.Hand,
            };
        }

        private static Button MakeNativeButton(string text, bool primary)
        {
            var button = new Button
            {
                Text = text,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Bold),
                Cursor = Cursors.Hand,
                UseVisualStyleBackColor = false,
                BackColor = primary ? Color.FromArgb(10, 10, 10) : Color.FromArgb(252, 252, 251),
                ForeColor = primary ? Color.White : Color.FromArgb(35, 37, 39),
            };
            button.FlatAppearance.BorderSize = 1;
            button.FlatAppearance.BorderColor = primary ? Color.FromArgb(10, 10, 10) : Color.FromArgb(156, 164, 172);
            button.FlatAppearance.MouseOverBackColor = primary ? Color.FromArgb(34, 34, 34) : Color.FromArgb(244, 246, 247);
            button.FlatAppearance.MouseDownBackColor = primary ? Color.Black : Color.FromArgb(233, 235, 237);
            return button;
        }

        private static SoftButton MakeIconButton(string text)
        {
            var button = MakeButton(text, false);
            button.Font = new Font("Segoe UI Symbol", 11F, FontStyle.Bold);
            button.Text = "";
            button.Glyph = SoftButtonGlyph.Stop;
            return button;
        }

        private static void RoundControl(Control control, int radius)
        {
            HelperDesktopUi.RoundControl(control, radius);
        }

        private static Icon CreateAppIcon()
        {
            return HelperDesktopUi.CreateAppIcon();
        }

        private ContextMenuStrip BuildTrayMenu()
        {
            var menu = new RoundedTrayMenu
            {
                Font = new Font("Microsoft YaHei UI", 9F),
                BackColor = Color.FromArgb(255, 255, 255),
                ForeColor = Color.FromArgb(30, 32, 34),
                ShowImageMargin = false,
            };
            _trayStatusItem = new ToolStripMenuItem("状态：准备启动") { Enabled = false };
            menu.Items.Add(_trayStatusItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("显示主窗口", null, delegate { ShowFromTray(); });
            menu.Items.Add("打开控制台", null, delegate { OpenManagementPage(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("重启本地服务", null, delegate
            {
                StopServer();
                StartServer();
            });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出 Agent", null, delegate { ExitApplication(); });
            foreach (ToolStripItem item in menu.Items)
            {
                if (!(item is ToolStripSeparator)) item.Padding = new Padding(12, 7, 22, 7);
            }
            menu.Opening += delegate { RefreshTrayMenu(); };
            return menu;
        }

        private void MainForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (ShouldHideToTrayOnClose(e.CloseReason))
            {
                WriteLifecycleLog("FormClosing " + e.CloseReason + " -> tray; visible=" + Visible + ", handle=" + IsHandleCreated + ", disposing=" + Disposing);
                e.Cancel = true;
                HideToTray();
                return;
            }

            _applicationClosing = true;
            WriteLifecycleLog("FormClosing exit; reason=" + e.CloseReason + ", visible=" + Visible + ", handle=" + IsHandleCreated + ", disposing=" + Disposing);
            StopServer();
            StopAutoSwitchService();
            StopCodexStatusMonitor();
            lock (_operationProgressLock)
            {
                if (_operationProgressForm != null && !_operationProgressForm.IsDisposed)
                {
                    _operationProgressForm.Close();
                    _operationProgressForm.Dispose();
                }
                _operationProgressForm = null;
            }
            if (_dashboardTimer != null)
            {
                _dashboardTimer.Stop();
                _dashboardTimer.Dispose();
            }
            if (_trayWatchdogTimer != null)
            {
                _trayWatchdogTimer.Stop();
                _trayWatchdogTimer.Dispose();
            }
            if (_trayIcon != null)
            {
                _trayIcon.Visible = false;
                _trayIcon.Dispose();
            }
            if (_trayMenu != null)
            {
                _trayMenu.Dispose();
            }
            if (_appIcon != null)
            {
                _appIcon.Dispose();
            }
            if (_logRegularFont != null)
            {
                _logRegularFont.Dispose();
            }
            if (_logBoldFont != null)
            {
                _logBoldFont.Dispose();
            }
        }

        private bool ShouldHideToTrayOnClose(CloseReason reason)
        {
            if (_allowExit) return false;
            if (reason == CloseReason.WindowsShutDown) return false;
            if (reason == CloseReason.ApplicationExitCall) return false;
            return reason == CloseReason.UserClosing
                || reason == CloseReason.TaskManagerClosing
                || reason == CloseReason.None;
        }

        private void HideToTray()
        {
            WriteLifecycleLog("主窗口收起到托盘; visible=" + Visible + ", handle=" + IsHandleCreated + ", disposing=" + Disposing);
            ResetVisibleLogBox("收起到托盘");
            EnsureTrayIcon("收起到托盘");
            Hide();
            ShowInTaskbar = false;
            if (!_trayTipShown && _trayIcon != null)
            {
                try
                {
                    _trayIcon.ShowBalloonTip(2500, ProductFullName, "Agent 已收起到托盘。右键图标可打开控制台、重启服务或退出。", ToolTipIcon.Info);
                }
                catch (Exception ex)
                {
                    WriteLifecycleLog("托盘提示显示失败：" + ex.Message);
                }
                _trayTipShown = true;
            }
        }

        private void ShowFromTray()
        {
            EnsureTrayIcon("托盘恢复");
            ShowInTaskbar = true;
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
            WriteLifecycleLog("托盘恢复主窗口; visible=" + Visible + ", handle=" + IsHandleCreated + ", disposing=" + Disposing);
            RestoreRecentLogView("托盘恢复");
        }

        private void EnsureTrayIcon(string reason)
        {
            EnsureTrayIcon(reason, true);
        }

        private void EnsureTrayIcon(string reason, bool logSuccess)
        {
            if (_applicationClosing || _trayIcon == null) return;
            try
            {
                _trayIcon.Icon = _appIcon;
                _trayIcon.ContextMenuStrip = _trayMenu;
                _trayIcon.Visible = false;
                _trayIcon.Visible = true;
                _lastTrayIconConfirmedAtUtc = DateTime.UtcNow;
                _lastTrayIconReason = reason ?? "";
                _lastTrayIconError = "";
                if (logSuccess) WriteLifecycleLog("托盘图标已确认; reason=" + reason);
            }
            catch (Exception ex)
            {
                _lastTrayIconError = ex.GetType().Name + ": " + ShortNonEmpty(ex.Message, 180);
                WriteLifecycleLog("托盘图标确认失败; reason=" + reason + "; " + ex.Message);
            }
        }

        private void RepairTrayIconFromAnyThread(string reason, bool logSuccess)
        {
            if (_applicationClosing || _trayIcon == null) return;
            try
            {
                if (IsHandleCreated && InvokeRequired)
                {
                    BeginInvoke(new Action(delegate { EnsureTrayIcon(reason, logSuccess); }));
                    return;
                }
                EnsureTrayIcon(reason, logSuccess);
            }
            catch (Exception ex)
            {
                _lastTrayIconError = ex.GetType().Name + ": " + ShortNonEmpty(ex.Message, 180);
                WriteLifecycleLog("托盘修复调度失败; reason=" + reason + "; " + ex.Message);
            }
        }

        private void EnsureTrayIconHeartbeat()
        {
            if (_applicationClosing || _trayIcon == null) return;
            EnsureTrayIcon("托盘心跳", false);
        }

        protected override void WndProc(ref Message m)
        {
            base.WndProc(ref m);
            if (TaskbarCreatedMessage != 0 && m.Msg == TaskbarCreatedMessage)
            {
                EnsureTrayIcon("任务栏重建");
            }
        }

        private void RefreshDashboardUi()
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action(RefreshDashboardUi));
                return;
            }

            _uptimeLabel.Text = "运行时间 " + FormatDuration(DateTime.UtcNow - _startedAtUtc);
            _statusLabel.Text = _running ? "● Agent 在线" : "● 服务未启动";
            _statusLabel.ForeColor = _running ? Color.FromArgb(5, 130, 96) : Color.FromArgb(137, 91, 0);
            _serviceBadgeLabel.Text = _running ? "在线" : "离线";
            _serviceBadgeLabel.ForeColor = _running ? Color.FromArgb(16, 126, 84) : Color.FromArgb(137, 91, 0);
            _serviceBadgeLabel.BackColor = _running ? Color.FromArgb(212, 247, 229) : Color.FromArgb(255, 241, 205);
            _portLabel.Text = _running
                ? "Local API: " + BaseUrl + "\r\nOAuth: http://localhost:1455/auth/callback\r\nCloud: " + CloudConsoleUrl.TrimEnd('/')
                : "Local API: 未启动\r\nOAuth: http://localhost:1455/auth/callback\r\nCloud: " + CloudConsoleUrl.TrimEnd('/');
            _portLabel.ForeColor = Color.FromArgb(40, 48, 58);
            _startButton.Text = _running ? "重启服务" : "启动服务";
            _startButton.Enabled = true;
            _stopButton.Enabled = _running;

            var runtime = CurrentCodexStatus();
            _runtimeLabel.Text = string.IsNullOrWhiteSpace(runtime.Label) ? "状态未知" : runtime.Label;
            _runtimeLabel.ForeColor = RuntimeColor(runtime.State);
            var runtimeDetail = string.IsNullOrWhiteSpace(runtime.Detail) ? "等待状态更新。" : runtime.Detail;
            if (runtime.RunningProcessCount > 0)
            {
                runtimeDetail += " · 进程 " + runtime.RunningProcessCount.ToString(CultureInfo.InvariantCulture);
            }
            _runtimeDetailLabel.Text = ShortNonEmpty(runtimeDetail, 104);

            var auto = GetAutoSwitchConfig();
            var authorized = !string.IsNullOrEmpty(auto.DeviceToken);
            if (auto.Enabled && authorized)
            {
                _autoSwitchLabel.Text = "智能切换：已开启";
                _autoSwitchLabel.ForeColor = Color.FromArgb(5, 130, 96);
            }
            else if (auto.Enabled)
            {
                _autoSwitchLabel.Text = "智能切换：待授权";
                _autoSwitchLabel.ForeColor = Color.FromArgb(137, 91, 0);
            }
            else
            {
                _autoSwitchLabel.Text = "智能切换：未开启";
                _autoSwitchLabel.ForeColor = Color.FromArgb(89, 94, 99);
            }

            var autoDetail = _lastAutoSwitchResult;
            if (string.IsNullOrWhiteSpace(autoDetail))
            {
                autoDetail = auto.Enabled ? "等待云端策略和 Agent token。" : "在控制台开启后，Agent 会按云端策略保护额度。";
            }
            _autoSwitchDetailLabel.Text = ShortNonEmpty(autoDetail, 110);
            RefreshTrayMenu();
        }

        private void RefreshTrayMenu()
        {
            if (_trayStatusItem == null) return;
            _trayStatusItem.Text = _running ? "状态：服务运行中 · 127.0.0.1:" + _port.ToString(CultureInfo.InvariantCulture) : "状态：服务已停止";
        }

        private static Color RuntimeColor(string state)
        {
            if (string.Equals(state, "idle", StringComparison.OrdinalIgnoreCase)) return Color.FromArgb(5, 130, 96);
            if (string.Equals(state, "active", StringComparison.OrdinalIgnoreCase)) return Color.FromArgb(21, 101, 192);
            if (string.Equals(state, "waiting", StringComparison.OrdinalIgnoreCase)) return Color.FromArgb(137, 91, 0);
            if (string.Equals(state, "not_running", StringComparison.OrdinalIgnoreCase)) return Color.FromArgb(128, 73, 0);
            if (string.Equals(state, "cooling", StringComparison.OrdinalIgnoreCase)) return Color.FromArgb(137, 91, 0);
            return Color.FromArgb(89, 94, 99);
        }

        private static string FormatDuration(TimeSpan span)
        {
            if (span.TotalDays >= 1)
            {
                return ((int)span.TotalDays).ToString(CultureInfo.InvariantCulture) + "天 " + span.Hours.ToString(CultureInfo.InvariantCulture) + "小时";
            }
            if (span.TotalHours >= 1)
            {
                return ((int)span.TotalHours).ToString(CultureInfo.InvariantCulture) + "小时 " + span.Minutes.ToString(CultureInfo.InvariantCulture) + "分钟";
            }
            return Math.Max(1, span.Minutes).ToString(CultureInfo.InvariantCulture) + "分钟";
        }

        private static string FormatBytes(long bytes)
        {
            if (bytes <= 0) return "未知";
            if (bytes >= 1024L * 1024L) return (bytes / 1024D / 1024D).ToString("0.0", CultureInfo.InvariantCulture) + " MB";
            if (bytes >= 1024L) return (bytes / 1024D).ToString("0.0", CultureInfo.InvariantCulture) + " KB";
            return bytes.ToString(CultureInfo.InvariantCulture) + " B";
        }

        private static string ShortNonEmpty(string value, int max)
        {
            if (string.IsNullOrWhiteSpace(value)) return "";
            return value.Length <= max ? value : value.Substring(0, Math.Max(1, max - 3)) + "...";
        }

        private void ExitApplication()
        {
            WriteLifecycleLog("托盘请求退出 Agent");
            _applicationClosing = true;
            _allowExit = true;
            Close();
        }

        private void BeginHelperUpdateCheckFromUi()
        {
            if (_updateButton != null)
            {
                _updateButton.Enabled = false;
                _updateButton.Text = "检查中";
            }
            Log("正在检查 Agent 更新...");
            ThreadPool.QueueUserWorkItem(delegate
            {
                HelperUpdateInfo info;
                try
                {
                    info = CheckHelperUpdate();
                }
                catch (Exception ex)
                {
                    info = HelperUpdateInfo.Failed(ex.Message);
                }
                try
                {
                    BeginInvoke(new Action(delegate { FinishHelperUpdateCheck(info); }));
                }
                catch { }
            });
        }

        private void FinishHelperUpdateCheck(HelperUpdateInfo info)
        {
            if (_updateButton != null)
            {
                _updateButton.Enabled = true;
                _updateButton.Text = "检查更新";
            }
            if (info == null || !info.Ok)
            {
                var error = info == null ? "无法读取更新信息" : info.Error;
                Log("检查 Agent 更新失败：" + error);
                MessageBox.Show(this, "暂时无法检查更新。\r\n\r\n" + error, "检查更新失败", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            if (info.UpdateAvailable)
            {
                var message = "发现 Agent 新版本 v" + info.LatestVersion + "。\r\n\r\n"
                    + "当前版本：v" + HelperVersion + "\r\n"
                    + "发布包大小：" + FormatBytes(info.Bytes) + "\r\n"
                    + "SHA-256：" + ShortNonEmpty(info.Sha256, 24) + "\r\n\r\n"
                    + "是否打开官方下载页面？请关闭当前 Agent 后再运行新版。";
                Log("发现 Agent 新版本：v" + info.LatestVersion + "，等待用户打开下载页。");
                if (MessageBox.Show(this, message, "Agent 更新可用", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                {
                    OpenHelperDownloadPage(info.DownloadUrl);
                }
                return;
            }

            Log("Agent 已是最新版本：v" + HelperVersion);
            MessageBox.Show(this, "当前 Agent 已是最新版本 v" + HelperVersion + "。", "已是最新版本", MessageBoxButtons.OK, MessageBoxIcon.Information);
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
                Log("服务已启动：" + BaseUrl + " · Agent " + HelperVersion + " (" + HelperBuildDate + ")");
                RefreshAuthStatus();
                _startButton.Enabled = true;
                _stopButton.Enabled = true;
                RefreshDashboardUi();
            }
            catch (Exception ex)
            {
                Log("启动失败：" + ex.Message);
                SetStatus("启动失败");
                RefreshDashboardUi();
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
            RefreshDashboardUi();
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
                SendJson(context.Response, 200, "{\"ok\":true,\"mode\":\"native-helper\",\"version\":\"" + JsonEscape(HelperVersion) + "\",\"build_date\":\"" + JsonEscape(HelperBuildDate) + "\",\"port\":" + _port + ",\"cloud_console_url\":\"" + JsonEscape(CloudConsoleUrl) + "\",\"tray\":" + TrayStatusJson() + ",\"lifecycle\":" + LifecycleStatusJson() + ",\"auto_switch\":" + AutoSwitchStatusJson() + ",\"codex_proxy\":" + CodexProxyStatusJson() + ",\"codex_status\":" + CodexStatusJson() + "}");
                return true;
            }

            if (request.HttpMethod == "GET" && path == "/api/update/check")
            {
                if (!IsAllowedOrigin(request))
                {
                    SendJson(context.Response, 403, "{\"ok\":false,\"error\":\"来源未授权\"}");
                    return true;
                }
                SendJson(context.Response, 200, HelperUpdateCheckJson());
                return true;
            }

            if (request.HttpMethod == "POST" && path == "/api/update/open-download")
            {
                if (!IsAllowedOrigin(request))
                {
                    SendJson(context.Response, 403, "{\"ok\":false,\"error\":\"来源未授权\"}");
                    return true;
                }
                var url = LatestHelperDownloadUrl("");
                OpenHelperDownloadPage(url);
                SendJson(context.Response, 200, "{\"ok\":true,\"download_url\":\"" + JsonEscape(url) + "\"}");
                return true;
            }

            if (request.HttpMethod == "POST" && path == "/api/tray/repair")
            {
                if (!IsAllowedOrigin(request))
                {
                    SendJson(context.Response, 403, "{\"ok\":false,\"error\":\"来源未授权\"}");
                    return true;
                }
                RepairTrayIconFromAnyThread("本地 API 修复请求", true);
                SendJson(context.Response, 200, "{\"ok\":true,\"tray\":" + TrayStatusJson() + "}");
                return true;
            }

            if (request.HttpMethod == "GET" && path == "/api/diagnostics/export")
            {
                if (!IsAllowedOrigin(request))
                {
                    SendJson(context.Response, 403, "{\"ok\":false,\"error\":\"来源未授权\"}");
                    return true;
                }
                SendJson(context.Response, 200, DiagnosticsExportJson());
                return true;
            }

            if (request.HttpMethod == "POST" && path == "/api/lifecycle/self-test")
            {
                if (!IsAllowedOrigin(request))
                {
                    SendJson(context.Response, 403, "{\"ok\":false,\"error\":\"来源未授权\"}");
                    return true;
                }
                SendJson(context.Response, 200, LifecycleSelfTestJson());
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

            if (request.HttpMethod == "POST" && path == "/api/auto-switch/resume")
            {
                if (!IsAllowedOrigin(request))
                {
                    SendJson(context.Response, 403, "{\"ok\":false,\"error\":\"来源未授权\"}");
                    return true;
                }

                ClearAutoSwitchFailureBackoff();
                SetAutoSwitchStage("normal", "手动恢复");
                SetAutoSwitchResult("已手动恢复自动切换，下一轮会重新核验任务边界和候选账号", "manual-resume-auto-switch");
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

        private bool RunSwitchJob(string authJson, bool restart, bool launch, bool autoSwitchContext = false)
        {
            var jobId = DateTime.Now.ToString("HHmmss", CultureInfo.InvariantCulture);
            var subject = AuthSubject(authJson);
            ShowOperationProgress("切换 Codex 授权", "任务 " + jobId + " 正在准备目标账号：" + subject, 4);
            try
            {
                Log("切换任务 " + jobId + " 开始：目标 " + subject + "，restart=" + (restart ? "true" : "false") + "，launch=" + (launch ? "true" : "false"));
                if (autoSwitchContext)
                {
                    SetAutoSwitchStage("switching", "准备切换");
                    SetAutoSwitchResult("安全边界已确认，正在准备切换账号：" + subject, "switching:prepare:" + jobId);
                }
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
                    if (autoSwitchContext)
                    {
                        SetAutoSwitchStage("restarting-codex", "关闭旧 Codex");
                        SetAutoSwitchResult("正在关闭旧 Codex 进程，避免 auth 写入冲突：" + subject, "restarting-codex:stop:" + jobId);
                    }
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
                if (autoSwitchContext)
                {
                    SetAutoSwitchStage("writing-auth", "写入 auth");
                    SetAutoSwitchResult("正在备份并写入新的 auth.json：" + subject, "writing-auth:" + jobId);
                }
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
                    if (autoSwitchContext)
                    {
                        SetAutoSwitchStage("restarting-codex", "重启 Codex");
                        SetAutoSwitchResult("auth.json 已写入，正在重启 Codex：" + subject, "restarting-codex:launch:" + jobId);
                    }
                    UpdateOperationProgress(80, "正在启动 Codex。");
                    launchResult = LaunchCodex();
                    Log("切换任务 " + jobId + " " + launchResult);
                    if (restoreTarget != null)
                    {
                        Thread.Sleep(2200);
                        if (autoSwitchContext)
                        {
                            SetAutoSwitchStage("restoring-window", "恢复窗口");
                            SetAutoSwitchResult("Codex 已启动，正在恢复切换前窗口：" + subject, "restoring-window:" + jobId);
                        }
                        UpdateOperationProgress(88, "正在等待 Codex 恢复切换前窗口。");
                        restoreResult = RestoreCodexWindow(restoreTarget);
                        Log("切换任务 " + jobId + " " + restoreResult);
                        UpdateOperationProgress(94, "正在恢复目标状态。");
                        goalResult = RestoreCodexGoalIfNeeded(restoreTarget);
                        if (!string.IsNullOrEmpty(goalResult)) Log("切换任务 " + jobId + " " + goalResult);
                    }
                }
                Log("切换任务 " + jobId + " 成功：目标 " + subject + "，已写入 auth" + (launch ? "，已请求启动 Codex" : "") + (restoreTarget != null ? "，已处理窗口恢复" : "") + "。");
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
            SetAuthStatus(CurrentAuthPanelText());
        }

        private static string CurrentAuthPanelText()
        {
            try
            {
                var target = CurrentAuthPath();
                if (!File.Exists(target))
                {
                    return "ID:    未发现授权文件\r\n类型:  --\r\n状态:  请从控制台导入授权";
                }
                var raw = File.ReadAllText(target, Encoding.UTF8);
                var email = MatchJsonString(raw, "email");
                var accountId = MatchJsonString(raw, "account_id");
                var accessToken = MatchJsonString(raw, "access_token");
                var refreshToken = MatchJsonString(raw, "refresh_token");
                var identity = ShortText(!string.IsNullOrEmpty(email) ? email : accountId, 30);
                var hasRefresh = !string.IsNullOrEmpty(refreshToken)
                    && refreshToken != accessToken
                    && !string.Equals(refreshToken, "rt_mock_token", StringComparison.OrdinalIgnoreCase);
                var expires = JwtExpiry(accessToken);
                var expiresText = expires.HasValue
                    ? expires.Value.ToLocalTime().ToString("yyyy-MM-dd HH:mm")
                    : "未知";
                return "ID:    " + identity
                    + "\r\n类型:  " + (hasRefresh ? "RT Present" : "RT 不可用")
                    + "\r\nAT 到期: " + expiresText;
            }
            catch (Exception ex)
            {
                return "ID:    读取失败\r\n状态:  " + ShortNonEmpty(ex.Message, 34);
            }
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

        private string TrayStatusJson()
        {
            var visible = false;
            var text = "";
            try
            {
                visible = _trayIcon != null && _trayIcon.Visible;
                text = _trayIcon == null ? "" : (_trayIcon.Text ?? "");
            }
            catch { }

            return "{"
                + "\"visible\":" + (visible ? "true" : "false") + ","
                + "\"last_confirmed_at\":\"" + JsonEscape(_lastTrayIconConfirmedAtUtc == DateTime.MinValue ? "" : _lastTrayIconConfirmedAtUtc.ToString("o")) + "\","
                + "\"last_reason\":\"" + JsonEscape(_lastTrayIconReason) + "\","
                + "\"last_error\":\"" + JsonEscape(_lastTrayIconError) + "\","
                + "\"text\":\"" + JsonEscape(text) + "\""
                + "}";
        }

        private string LifecycleStatusJson()
        {
            var recentCount = 0;
            lock (_recentLogLock)
            {
                recentCount = _recentLogLines.Count;
            }

            var progressVisible = false;
            lock (_operationProgressLock)
            {
                progressVisible = _operationProgressForm != null && !_operationProgressForm.IsDisposed && _operationProgressForm.Visible;
            }

            var helperLogExists = false;
            long helperLogBytes = 0;
            try
            {
                var file = new FileInfo(HelperLogPath());
                helperLogExists = file.Exists;
                helperLogBytes = helperLogExists ? file.Length : 0;
            }
            catch { }

            return "{"
                + "\"main_window_visible\":" + (Visible ? "true" : "false") + ","
                + "\"show_in_taskbar\":" + (ShowInTaskbar ? "true" : "false") + ","
                + "\"window_state\":\"" + JsonEscape(WindowState.ToString()) + "\","
                + "\"application_closing\":" + (_applicationClosing ? "true" : "false") + ","
                + "\"log_view_needs_reload\":" + (_logViewNeedsReload ? "true" : "false") + ","
                + "\"recent_log_count\":" + recentCount.ToString(CultureInfo.InvariantCulture) + ","
                + "\"helper_log_exists\":" + (helperLogExists ? "true" : "false") + ","
                + "\"helper_log_bytes\":" + helperLogBytes.ToString(CultureInfo.InvariantCulture) + ","
                + "\"operation_progress_visible\":" + (progressVisible ? "true" : "false")
                + "}";
        }

        private string LifecycleSelfTestJson()
        {
            var marker = "lifecycle-self-test-" + DateTime.UtcNow.ToString("yyyyMMddHHmmssfff", CultureInfo.InvariantCulture);
            WriteLifecycleLog("自检开始; marker=" + marker + "; visible=" + Visible + "; handle=" + IsHandleCreated + "; disposing=" + Disposing);
            Log("生命周期自检 " + marker + " 中文日志 URL http://localhost/self-test?code=fake-code&state=fake-state");
            LoadRecentLogHistory();
            RepairTrayIconFromAnyThread("生命周期自检", true);
            RunOnUi(delegate
            {
                RestoreRecentLogView("生命周期自检");
                RefreshDashboardUi();
            });
            var logViewFaultTested = false;
            var logViewFaultRecovered = false;
            RunOnUiAndWait(delegate
            {
                logViewFaultTested = CanRenderLogView();
                if (logViewFaultTested) logViewFaultRecovered = SimulateLogViewFaultForSelfTest(marker);
            });
            Thread.Sleep(160);

            var logFound = false;
            try
            {
                logFound = File.ReadAllText(HelperLogPath(), Encoding.UTF8).IndexOf(marker, StringComparison.Ordinal) >= 0;
            }
            catch (Exception ex)
            {
                WriteLifecycleLog("自检读取日志失败; marker=" + marker + "; " + ex.GetType().Name + ": " + ShortNonEmpty(ex.Message, 180));
            }

            var ok = logFound && (!logViewFaultTested || logViewFaultRecovered);
            WriteLifecycleLog("自检完成; marker=" + marker + "; log_found=" + logFound + "; log_view_fault_tested=" + logViewFaultTested + "; log_view_fault_recovered=" + logViewFaultRecovered);
            return "{"
                + "\"ok\":" + (ok ? "true" : "false") + ","
                + "\"marker\":\"" + JsonEscape(marker) + "\","
                + "\"log_found\":" + (logFound ? "true" : "false") + ","
                + "\"log_view_fault_tested\":" + (logViewFaultTested ? "true" : "false") + ","
                + "\"log_view_fault_recovered\":" + (logViewFaultRecovered ? "true" : "false") + ","
                + "\"tray\":" + TrayStatusJson() + ","
                + "\"lifecycle\":" + LifecycleStatusJson()
                + "}";
        }

        private string DiagnosticsExportJson()
        {
            var lines = ReadHelperLogTail(HelperUiLogLineLimit);
            var sb = new StringBuilder();
            sb.Append("{");
            sb.Append("\"ok\":true,");
            sb.Append("\"generated_at\":\"").Append(JsonEscape(DateTime.UtcNow.ToString("o"))).Append("\",");
            sb.Append("\"mode\":\"native-helper\",");
            sb.Append("\"version\":\"").Append(JsonEscape(HelperVersion)).Append("\",");
            sb.Append("\"build_date\":\"").Append(JsonEscape(HelperBuildDate)).Append("\",");
            sb.Append("\"port\":").Append(_port.ToString(CultureInfo.InvariantCulture)).Append(",");
            sb.Append("\"cloud_console_url\":\"").Append(JsonEscape(CloudConsoleUrl)).Append("\",");
            sb.Append("\"helper_log_exists\":").Append(File.Exists(HelperLogPath()) ? "true" : "false").Append(",");
            sb.Append("\"tray\":").Append(TrayStatusJson()).Append(",");
            sb.Append("\"lifecycle\":").Append(LifecycleStatusJson()).Append(",");
            sb.Append("\"auto_switch\":").Append(RedactDiagnosticText(AutoSwitchStatusJson())).Append(",");
            sb.Append("\"codex_proxy\":").Append(RedactDiagnosticText(CodexProxyStatusJson())).Append(",");
            sb.Append("\"codex_status\":").Append(RedactDiagnosticText(CodexStatusJson())).Append(",");
            sb.Append("\"recent_logs\":[");
            for (var index = 0; index < lines.Length; index++)
            {
                if (index > 0) sb.Append(",");
                sb.Append("\"").Append(JsonEscape(RedactDiagnosticText(lines[index]))).Append("\"");
            }
            sb.Append("],");
            sb.Append("\"redaction\":{\"applied\":true,\"rules\":[\"auth-json\",\"bearer\",\"jwt\",\"helper-device-token\",\"oauth-query\"]}");
            sb.Append("}");
            return sb.ToString();
        }

        private static string[] ReadHelperLogTail(int maxLines)
        {
            try
            {
                var path = HelperLogPath();
                if (!File.Exists(path)) return new string[0];
                var lines = File.ReadAllLines(path, Encoding.UTF8);
                var count = Math.Min(Math.Max(0, maxLines), lines.Length);
                var result = new string[count];
                Array.Copy(lines, lines.Length - count, result, 0, count);
                return result;
            }
            catch (Exception ex)
            {
                return new[] { "[diagnostics] helper log read failed: " + ex.GetType().Name + ": " + ex.Message };
            }
        }

        private static string RedactDiagnosticText(string value)
        {
            var text = value ?? "";
            text = Regex.Replace(
                text,
                "(\"(?:access_token|refresh_token|id_token|session_token|authJson|auth_json|deviceToken|device_token|token|authorization|cookie|codex_session)\"\\s*:\\s*\")([^\"]*)(\")",
                "$1[REDACTED]$3",
                RegexOptions.IgnoreCase);
            text = Regex.Replace(text, "\\bAuthorization\\s*:\\s*Bearer\\s+[A-Za-z0-9._\\-]+", "Authorization: Bearer [REDACTED]", RegexOptions.IgnoreCase);
            text = Regex.Replace(text, "\\bBearer\\s+[A-Za-z0-9._\\-]+", "Bearer [REDACTED]", RegexOptions.IgnoreCase);
            text = Regex.Replace(
                text,
                "((?:access_token|refresh_token|id_token|session_token|deviceToken|device_token|codex_session|authorization|cookie)\\s*[=:]\\s*)([^\\s,;&\"']+)",
                "$1[REDACTED]",
                RegexOptions.IgnoreCase);
            text = Regex.Replace(text, "\\bcdh_[A-Za-z0-9_\\-]{12,}\\b", "cdh_[REDACTED]", RegexOptions.IgnoreCase);
            text = Regex.Replace(text, "\\beyJ[A-Za-z0-9_\\-]{20,}\\.[A-Za-z0-9_\\-]{20,}\\.[A-Za-z0-9_\\-]{8,}\\b", "[REDACTED_JWT]");
            text = Regex.Replace(text, "([?&](?:code|state|token|access_token|refresh_token)=)[^\\s&]+", "$1[REDACTED]", RegexOptions.IgnoreCase);
            return text;
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
                    PendingSwitchReason = MatchJsonString(raw, "pendingSwitchReason"),
                    PendingSwitchType = MatchJsonString(raw, "pendingSwitchType"),
                    PendingSwitchSource = MatchJsonString(raw, "pendingSwitchSource"),
                    PendingSwitchAt = MatchJsonString(raw, "pendingSwitchAt"),
                    PendingSwitchAuthFingerprint = MatchJsonString(raw, "pendingSwitchAuthFingerprint"),
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
                + "\"pendingSwitchReason\":\"" + JsonEscape(config.PendingSwitchReason) + "\","
                + "\"pendingSwitchType\":\"" + JsonEscape(config.PendingSwitchType) + "\","
                + "\"pendingSwitchSource\":\"" + JsonEscape(config.PendingSwitchSource) + "\","
                + "\"pendingSwitchAt\":\"" + JsonEscape(config.PendingSwitchAt) + "\","
                + "\"pendingSwitchAuthFingerprint\":\"" + JsonEscape(config.PendingSwitchAuthFingerprint) + "\","
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
                + "\"pending_reason\":\"" + JsonEscape(config.PendingSwitchReason) + "\","
                + "\"pending_type\":\"" + JsonEscape(config.PendingSwitchType) + "\","
                + "\"pending_source\":\"" + JsonEscape(config.PendingSwitchSource) + "\","
                + "\"pending_since\":\"" + JsonEscape(config.PendingSwitchAt) + "\","
                + "\"pending_revalidation\":" + (!string.IsNullOrEmpty(config.PendingSwitchReason) ? "true" : "false") + ","
                + "\"last_result\":\"" + JsonEscape(_lastAutoSwitchResult) + "\","
                + "\"last_stage\":\"" + JsonEscape(_lastAutoSwitchStage) + "\","
                + "\"last_stage_label\":\"" + JsonEscape(_lastAutoSwitchStageLabel) + "\","
                + "\"last_failure_stage\":\"" + JsonEscape(_lastAutoSwitchFailureStage) + "\","
                + "\"last_failure_detail\":\"" + JsonEscape(_lastAutoSwitchFailureDetail) + "\","
                + "\"failure_count\":" + _autoSwitchFailureStreak + ","
                + "\"failure_backoff_until\":\"" + JsonEscape(_autoSwitchFailurePauseUntilUtc == DateTime.MinValue ? "" : _autoSwitchFailurePauseUntilUtc.ToString("o")) + "\","
                + "\"failure_pause_until\":\"" + JsonEscape(_autoSwitchFailureSuspendedUntilUtc == DateTime.MinValue ? "" : _autoSwitchFailureSuspendedUntilUtc.ToString("o")) + "\","
                + "\"failure_pause_reason\":\"" + JsonEscape(_autoSwitchFailureSuspendedReason) + "\","
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

        private static long MatchJsonLong(string json, string field, long fallback)
        {
            var match = Regex.Match(json ?? "", "\"" + Regex.Escape(field) + "\"\\s*:\\s*(-?\\d+)");
            long value;
            return match.Success && long.TryParse(match.Groups[1].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out value) ? value : fallback;
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
                    Log("自动切换：云端已轮换 Agent token，新的授权已保存。");
                }
            }
            catch (Exception ex)
            {
                var accountHint = CurrentAuthAccountHint();
                var deviceHint = ShortDeviceKey(config.DeviceKey);
                SetAutoSwitchResult(
                    "云端配置同步失败：GET /api/helper/auto-switch/config 超时或无响应；设备 " + deviceHint + "；当前账号 " + accountHint + "；" + ex.Message,
                    "cloud-config-sync-failed:" + deviceHint + ":" + accountHint + ":" + ShortText(ex.Message, 80));
            }
            return config;
        }

        private static string CurrentAuthAccountHint()
        {
            try
            {
                var path = CurrentAuthPath();
                if (!File.Exists(path)) return "未找到 auth";
                var raw = File.ReadAllText(path, Encoding.UTF8);
                var email = EmailFromAuthJson(raw);
                if (!string.IsNullOrWhiteSpace(email)) return ShortText(email, 48);
                var accountId = MatchJsonString(raw, "account_id");
                return string.IsNullOrWhiteSpace(accountId) ? "未知账号" : ShortText(accountId, 18);
            }
            catch
            {
                return "读取失败";
            }
        }

        private static string ShortDeviceKey(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "未绑定";
            return value.Length <= 8 ? value : value.Substring(0, 8) + "...";
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
                ClearPersistedAutoSwitchPending();
                _lastAutoSwitchReason = "";
                SetAutoSwitchStage("missing-auth", "缺少 auth");
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
            if (string.IsNullOrEmpty(trigger))
            {
                _lastAutoSwitchReason = "";
                ClearPersistedAutoSwitchPending();
            }
            else
            {
                _lastAutoSwitchReason = trigger;
                PersistAutoSwitchPending(trigger, triggerType, triggerSource, AuthFingerprint(authJson), now);
            }
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
                ClearAutoSwitchFailureBackoff();
                SetAutoSwitchStage("normal", "检查正常");
                SetAutoSwitchResult(string.IsNullOrEmpty(clearedRuntimeTriggerReason) ? "检查正常" : "检查正常：" + clearedRuntimeTriggerReason,
                    string.IsNullOrEmpty(clearedRuntimeTriggerReason) ? "normal" : "normal:runtime-trigger-cleared:" + ShortText(clearedRuntimeTriggerReason, 80));
                return;
            }
            var triggerLabel = string.IsNullOrEmpty(triggerSource) ? trigger : triggerSource + "：" + trigger;
            var failureBackoffKey = triggerType + ":" + triggerSource + ":" + trigger;
            int failurePauseSeconds;
            if (AutoSwitchFailurePauseActive(out failurePauseSeconds))
            {
                SetAutoSwitchStage("failure-paused", "自动暂停");
                SetAutoSwitchResult("连续失败已自动暂停：" + (_autoSwitchFailureSuspendedReason ?? "") + "，约 " + failurePauseSeconds + " 秒后重试；触发源 " + triggerLabel, "failure-paused:" + _autoSwitchFailureStreakKey);
                return;
            }
            int failureBackoffSeconds;
            if (AutoSwitchFailureBackoffActive(failureBackoffKey, out failureBackoffSeconds))
            {
                SetAutoSwitchStage("failure-backoff", "失败退避");
                SetAutoSwitchResult("已触发但正在失败退避：" + triggerLabel + "，约 " + failureBackoffSeconds + " 秒后重试", "failure-backoff:" + failureBackoffKey);
                return;
            }
            if ((DateTime.UtcNow - _lastAutoSwitchAt).TotalSeconds < config.GlobalCooldownSeconds)
            {
                SetAutoSwitchStage("cooldown", "切换冷却");
                SetAutoSwitchResult("已触发但处于冷却：" + triggerLabel, "cooldown:" + triggerSource + ":" + trigger);
                return;
            }
            string idleReason;
            if (!IsSafeToAutoSwitch(config, triggerType, out idleReason))
            {
                SetAutoSwitchStage("draining-active-turn", "保护当前任务");
                SetAutoSwitchResult("额度已耗尽，正在保护当前运行任务：" + idleReason + "；触发源 " + triggerLabel, "draining-active-turn:" + triggerType + ":" + trigger);
                TryPostHelperAudit(config, "deferred-active-turn", triggerLabel, idleReason);
                return;
            }

            var boundaryStatus = CurrentCodexStatus();
            SetAutoSwitchStage("boundary-confirming", "确认安全边界");
            SetAutoSwitchResult("任务已结束，正在确认安全切换时机：" + triggerLabel, "boundary-confirming:" + triggerType + ":" + trigger);
            TryPostHelperAudit(config, "boundary-confirmed", triggerLabel, boundaryStatus.Detail);
            var forceCloudTrigger = IsHardAutoSwitchTrigger(triggerType);
            try { MaybeSyncCurrentAuth(config, true, "pre-switch-check"); }
            catch (Exception ex) { Log("切换前 auth 比对跳过：" + ShortText(ex.Message, 120)); }
            SetAutoSwitchStage("candidate-selecting", "请求候选账号");
            SetAutoSwitchResult("安全边界已确认，正在请求云端候选账号：" + triggerLabel, "candidate-selecting:" + triggerType + ":" + trigger);
            var response = PostHelperJson(config, "/api/helper/auto-switch/next", "{"
                + "\"deviceKey\":\"" + JsonEscape(config.DeviceKey) + "\","
                + "\"currentAccountId\":\"" + JsonEscape(currentAccountId) + "\","
                + "\"currentEmail\":\"" + JsonEscape(currentEmail) + "\","
                + "\"triggerReason\":\"" + JsonEscape(trigger) + "\","
                + "\"triggerType\":\"" + JsonEscape(triggerType) + "\","
                + "\"triggerSource\":\"" + JsonEscape(triggerSource) + "\","
                + "\"boundaryConfirmed\":true,"
                + "\"runtimeState\":\"" + JsonEscape(boundaryStatus.State) + "\","
                + "\"boundaryEvidence\":\"" + JsonEscape(boundaryStatus.Detail) + "\","
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
                    ArmAutoSwitchFailureBackoff(failureBackoffKey, "cloud-rejected", responseDetail);
                    SetAutoSwitchResult("云端未确认切换条件：" + triggerLabel + (string.IsNullOrEmpty(responseDetail) ? "" : "（" + responseDetail + "）"), "not-triggered:" + triggerSource + ":" + trigger);
                }
                else if (IsCloudNoCandidate(responseReason))
                {
                    ArmAutoSwitchFailureBackoff(failureBackoffKey, "no-candidate", responseDetail);
                    SetAutoSwitchResult("已触发但无可用候选账号：" + triggerLabel + (string.IsNullOrEmpty(responseDetail) ? "" : "（" + responseDetail + "）"), "no-candidate:" + triggerSource + ":" + trigger + ":" + ShortText(responseDetail, 120));
                }
                else
                {
                    ArmAutoSwitchFailureBackoff(failureBackoffKey, "not-switched", responseDetail);
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
            SetAutoSwitchStage("payload-issued", "已取得切换载荷");
            SetAutoSwitchResult("已取得候选账号，准备写入 auth：" + ShortText(targetName, 48), "payload-issued:" + ShortText(targetName, 48));
            var switched = RunSwitchJob(nextAuth, true, true, true);
            if (!switched)
            {
                ArmAutoSwitchFailureBackoff(failureBackoffKey, "switch-failed", targetName);
                SetAutoSwitchResult("自动切换失败：" + ShortText(targetName, 48), "switch-failed:" + ShortText(targetName, 48));
                TryPostHelperAudit(config, "switch-failed", trigger, "target=" + targetName, targetCloudId);
                return;
            }
            ClearAutoSwitchFailureBackoff();
            SetAutoSwitchStage("switched", "已切换");
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
                    config.PendingSwitchReason = "";
                    config.PendingSwitchType = "";
                    config.PendingSwitchSource = "";
                    config.PendingSwitchAt = "";
                    config.PendingSwitchAuthFingerprint = "";
                    _autoSwitchConfig = config.Clamp();
                    SaveAutoSwitchConfig(_autoSwitchConfig);
                }
            }
            catch (Exception ex)
            {
                Log("自动切换：保存最近切换状态失败：" + ex.Message);
            }
        }

        private void RestorePersistedAutoSwitchPendingState()
        {
            if (_autoSwitchConfig == null || string.IsNullOrWhiteSpace(_autoSwitchConfig.PendingSwitchReason)) return;
            _lastAutoSwitchReason = _autoSwitchConfig.PendingSwitchReason;
            _lastAutoSwitchStage = "pending-revalidation";
            _lastAutoSwitchStageLabel = "恢复待切计划";
            _lastAutoSwitchResult = "Agent 重启后已恢复待切原因，正在重新核验额度与任务边界：" + ShortText(_autoSwitchConfig.PendingSwitchReason, 90);
        }

        private void PersistAutoSwitchPending(string reason, string triggerType, string source, string authFingerprint, DateTime observedAtUtc)
        {
            if (string.IsNullOrWhiteSpace(reason)) return;
            try
            {
                lock (_autoSwitchLock)
                {
                    var config = _autoSwitchConfig == null ? LoadAutoSwitchConfig() : _autoSwitchConfig.Clone();
                    var samePlan = string.Equals(config.PendingSwitchReason, reason, StringComparison.Ordinal)
                        && string.Equals(config.PendingSwitchType, triggerType ?? "", StringComparison.Ordinal)
                        && string.Equals(config.PendingSwitchSource, source ?? "", StringComparison.Ordinal)
                        && string.Equals(config.PendingSwitchAuthFingerprint, authFingerprint ?? "", StringComparison.Ordinal);
                    if (samePlan) return;
                    config.PendingSwitchReason = reason;
                    config.PendingSwitchType = triggerType ?? "";
                    config.PendingSwitchSource = source ?? "";
                    config.PendingSwitchAt = observedAtUtc.ToString("o");
                    config.PendingSwitchAuthFingerprint = authFingerprint ?? "";
                    _autoSwitchConfig = config.Clamp();
                    SaveAutoSwitchConfig(_autoSwitchConfig);
                }
            }
            catch (Exception ex)
            {
                Log("自动切换：保存待切计划失败：" + ShortText(ex.Message, 120));
            }
        }

        private void ClearPersistedAutoSwitchPending()
        {
            try
            {
                lock (_autoSwitchLock)
                {
                    var config = _autoSwitchConfig == null ? LoadAutoSwitchConfig() : _autoSwitchConfig.Clone();
                    if (string.IsNullOrEmpty(config.PendingSwitchReason)
                        && string.IsNullOrEmpty(config.PendingSwitchType)
                        && string.IsNullOrEmpty(config.PendingSwitchSource)
                        && string.IsNullOrEmpty(config.PendingSwitchAt)
                        && string.IsNullOrEmpty(config.PendingSwitchAuthFingerprint)) return;
                    config.PendingSwitchReason = "";
                    config.PendingSwitchType = "";
                    config.PendingSwitchSource = "";
                    config.PendingSwitchAt = "";
                    config.PendingSwitchAuthFingerprint = "";
                    _autoSwitchConfig = config.Clamp();
                    SaveAutoSwitchConfig(_autoSwitchConfig);
                }
            }
            catch (Exception ex)
            {
                Log("自动切换：清理待切计划失败：" + ShortText(ex.Message, 120));
            }
        }

        private bool IsSafeToAutoSwitch(AutoSwitchConfig config, string triggerType, out string reason)
        {
            reason = "";

            var runtimeStatus = CurrentCodexStatus();
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
            TryPostHelperAudit(config, result, trigger, detail, "");
        }

        private void TryPostHelperAudit(AutoSwitchConfig config, string result, string trigger, string detail, string accountId)
        {
            try
            {
                var key = (result ?? "") + ":" + (trigger ?? "") + ":" + (detail ?? "") + ":" + (accountId ?? "");
                lock (_autoSwitchLock)
                {
                    var now = DateTime.UtcNow;
                    if (string.Equals(key, _lastAutoSwitchAuditKey, StringComparison.Ordinal)
                        && _lastAutoSwitchAuditAt != DateTime.MinValue
                        && (now - _lastAutoSwitchAuditAt).TotalSeconds < AutoSwitchRepeatedLogSeconds)
                    {
                        return;
                    }
                    _lastAutoSwitchAuditKey = key;
                    _lastAutoSwitchAuditAt = now;
                }
                PostHelperJson(config, "/api/helper/auto-switch/audit", "{"
                    + "\"accountId\":\"" + JsonEscape(accountId ?? "") + "\","
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

        private HelperUpdateInfo CheckHelperUpdate()
        {
            var manifestUrl = CloudConsoleUrl.TrimEnd('/') + "/asset-manifest.json?helper_ts=" + DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
            var manifest = DownloadText(manifestUrl, 8000);
            var helper = ExtractJsonObject(manifest, "helper");
            if (string.IsNullOrWhiteSpace(helper) || helper == "null")
            {
                throw new InvalidOperationException("发布清单缺少 Agent 信息。");
            }
            var latestVersion = MatchJsonString(helper, "version");
            if (string.IsNullOrWhiteSpace(latestVersion))
            {
                throw new InvalidOperationException("发布清单缺少 Agent 版本。");
            }
            var file = MatchJsonString(helper, "file");
            var result = new HelperUpdateInfo
            {
                Ok = true,
                CurrentVersion = HelperVersion,
                LatestVersion = latestVersion,
                LatestBuildDate = MatchJsonString(helper, "build_date"),
                AssetVersion = MatchJsonString(manifest, "version"),
                File = string.IsNullOrWhiteSpace(file) ? HelperDownloadDefaultFile : file,
                Sha256 = MatchJsonString(helper, "sha256"),
                Bytes = MatchJsonLong(helper, "bytes", 0),
                CheckedAt = DateTime.UtcNow.ToString("o"),
            };
            result.DownloadUrl = LatestHelperDownloadUrl(result.File);
            result.UpdateAvailable = CompareVersion(HelperVersion, latestVersion) < 0;
            return result;
        }

        private string HelperUpdateCheckJson()
        {
            try
            {
                return CheckHelperUpdate().ToJson();
            }
            catch (Exception ex)
            {
                return HelperUpdateInfo.Failed(ex.Message).ToJson();
            }
        }

        private static string DownloadText(string url, int timeoutMs)
        {
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.Method = "GET";
            request.Timeout = timeoutMs;
            request.ReadWriteTimeout = timeoutMs;
            request.Accept = "application/json,text/plain,*/*";
            request.UserAgent = "codex-dock-helper/" + HelperVersion;
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
                        if (body.Length > 180) body = body.Substring(0, 180);
                        throw new InvalidOperationException(((int)response.StatusCode).ToString(CultureInfo.InvariantCulture) + ": " + body);
                    }
                }
                throw;
            }
        }

        private string LatestHelperDownloadUrl(string file)
        {
            Uri absolute;
            if (Uri.TryCreate(file ?? "", UriKind.Absolute, out absolute)
                && (absolute.Scheme == Uri.UriSchemeHttps || absolute.Scheme == Uri.UriSchemeHttp))
            {
                return absolute.ToString();
            }
            var path = string.IsNullOrWhiteSpace(file) ? HelperDownloadDefaultFile : file.TrimStart('/', '\\');
            return CloudConsoleUrl.TrimEnd('/') + "/" + path.Replace("\\", "/");
        }

        private void OpenHelperDownloadPage(string url)
        {
            var target = string.IsNullOrWhiteSpace(url) ? LatestHelperDownloadUrl("") : url;
            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
            Log("已打开 Agent 最新版下载页：" + target);
        }

        private static int CompareVersion(string current, string latest)
        {
            var left = (current ?? "").Split('.');
            var right = (latest ?? "").Split('.');
            var length = Math.Max(left.Length, right.Length);
            for (var i = 0; i < length; i++)
            {
                int a;
                int b;
                if (i >= left.Length || !int.TryParse(Regex.Match(left[i], "\\d+").Value, out a)) a = 0;
                if (i >= right.Length || !int.TryParse(Regex.Match(right[i], "\\d+").Value, out b)) b = 0;
                if (a != b) return a.CompareTo(b);
            }
            return 0;
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

        private void SetAutoSwitchStage(string stage, string label)
        {
            _lastAutoSwitchStage = stage ?? "";
            _lastAutoSwitchStageLabel = label ?? "";
        }

        private void SetAutoSwitchFailure(string stage, string detail)
        {
            _lastAutoSwitchFailureStage = stage ?? "";
            _lastAutoSwitchFailureDetail = detail ?? "";
            SetAutoSwitchStage(_lastAutoSwitchFailureStage, "切换失败");
        }

        private bool AutoSwitchFailureBackoffActive(string key, out int waitSeconds)
        {
            waitSeconds = 0;
            var now = DateTime.UtcNow;
            if (string.IsNullOrEmpty(_autoSwitchFailurePauseKey) || _autoSwitchFailurePauseKey != key)
            {
                return false;
            }
            if (_autoSwitchFailurePauseUntilUtc == DateTime.MinValue || _autoSwitchFailurePauseUntilUtc <= now)
            {
                ClearAutoSwitchFailureBackoffWindow();
                return false;
            }
            waitSeconds = Math.Max(1, (int)Math.Ceiling((_autoSwitchFailurePauseUntilUtc - now).TotalSeconds));
            return true;
        }

        private bool AutoSwitchFailurePauseActive(out int waitSeconds)
        {
            waitSeconds = 0;
            var now = DateTime.UtcNow;
            if (_autoSwitchFailureSuspendedUntilUtc == DateTime.MinValue)
            {
                return false;
            }
            if (_autoSwitchFailureSuspendedUntilUtc <= now)
            {
                ClearAutoSwitchFailureBackoff();
                return false;
            }
            waitSeconds = Math.Max(1, (int)Math.Ceiling((_autoSwitchFailureSuspendedUntilUtc - now).TotalSeconds));
            return true;
        }

        private void ArmAutoSwitchFailureBackoff(string key, string stage, string detail)
        {
            var normalizedKey = key ?? "";
            if (string.Equals(_autoSwitchFailureStreakKey, normalizedKey, StringComparison.Ordinal))
            {
                _autoSwitchFailureStreak += 1;
            }
            else
            {
                _autoSwitchFailureStreakKey = normalizedKey;
                _autoSwitchFailureStreak = 1;
            }
            _autoSwitchFailurePauseKey = normalizedKey;
            _autoSwitchFailurePauseUntilUtc = DateTime.UtcNow.AddSeconds(AutoSwitchFailureBackoffSeconds);
            SetAutoSwitchFailure(stage, detail);
            if (_autoSwitchFailureStreak >= AutoSwitchFailurePauseThreshold)
            {
                _autoSwitchFailureSuspendedUntilUtc = DateTime.UtcNow.AddSeconds(AutoSwitchFailurePauseSeconds);
                _autoSwitchFailureSuspendedReason = "连续 " + _autoSwitchFailureStreak.ToString(CultureInfo.InvariantCulture)
                    + " 次 " + AutoSwitchFailureStageLabel(stage)
                    + (string.IsNullOrEmpty(detail) ? "" : "：" + ShortText(detail, 120));
                SetAutoSwitchStage("failure-paused", "自动暂停");
            }
        }

        private void ClearAutoSwitchFailureBackoff()
        {
            ClearAutoSwitchFailureBackoffWindow();
            _autoSwitchFailureStreakKey = "";
            _autoSwitchFailureStreak = 0;
            ClearAutoSwitchFailurePause();
            _lastAutoSwitchFailureStage = "";
            _lastAutoSwitchFailureDetail = "";
        }

        private void ClearAutoSwitchFailureBackoffWindow()
        {
            _autoSwitchFailurePauseKey = "";
            _autoSwitchFailurePauseUntilUtc = DateTime.MinValue;
        }

        private void ClearAutoSwitchFailurePause()
        {
            _autoSwitchFailureSuspendedUntilUtc = DateTime.MinValue;
            _autoSwitchFailureSuspendedReason = "";
        }

        private static string AutoSwitchFailureStageLabel(string stage)
        {
            if (string.Equals(stage, "cloud-rejected", StringComparison.OrdinalIgnoreCase)) return "云端未放行";
            if (string.Equals(stage, "no-candidate", StringComparison.OrdinalIgnoreCase)) return "无候选账号";
            if (string.Equals(stage, "not-switched", StringComparison.OrdinalIgnoreCase)) return "未切换";
            if (string.Equals(stage, "switch-failed", StringComparison.OrdinalIgnoreCase)) return "执行失败";
            return string.IsNullOrEmpty(stage) ? "自动切换失败" : stage;
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
            if (target == null || string.IsNullOrWhiteSpace(target.ThreadId)) return "未找到可恢复会话。";
            var focusBefore = FocusCodexMainWindow(15000);
            if (focusBefore.StartsWith("未找到", StringComparison.OrdinalIgnoreCase))
            {
                return focusBefore + "；已跳过会话深链，避免在 Codex 冷启动阶段触发协议错误：" + ShortText(target.ThreadId, 12);
            }
            if (ThreadProtocolRestoreDisabled())
            {
                return focusBefore + "；已按配置跳过 codex:// 会话深链：" + ShortText(target.ThreadId, 12);
            }
            if (string.IsNullOrWhiteSpace(target.Url)) return "未找到可恢复会话深链。";
            try
            {
                Thread.Sleep(1600);
                Process.Start(new ProcessStartInfo(target.Url) { UseShellExecute = true });
                Thread.Sleep(1200);
                var focusAfter = FocusCodexMainWindow(6000);
                return focusBefore + "；已延迟请求恢复" + (target.IsGoal ? "目标任务" : "会话") + "窗口：" + ShortText(target.ThreadId, 12) + "；" + focusAfter;
            }
            catch (Exception ex)
            {
                return focusBefore + "；恢复会话深链失败：" + ex.Message;
            }
        }

        private static bool ThreadProtocolRestoreDisabled()
        {
            var disabled = Environment.GetEnvironmentVariable("CODEX_DOCK_RESTORE_THREAD_PROTOCOL");
            return string.Equals(disabled, "0", StringComparison.OrdinalIgnoreCase)
                || string.Equals(disabled, "false", StringComparison.OrdinalIgnoreCase)
                || string.Equals(disabled, "off", StringComparison.OrdinalIgnoreCase);
        }

        private static string FocusCodexMainWindow(int timeoutMs)
        {
            var deadline = DateTime.UtcNow.AddMilliseconds(Math.Max(0, timeoutMs));
            IntPtr handle = IntPtr.Zero;
            do
            {
                handle = FindCodexMainWindowHandle();
                if (handle != IntPtr.Zero) break;
                Thread.Sleep(350);
            }
            while (DateTime.UtcNow < deadline);

            if (handle == IntPtr.Zero) return "未找到 Codex 主窗口";
            try
            {
                if (IsIconic(handle)) ShowWindowAsync(handle, SW_RESTORE);
                else ShowWindowAsync(handle, SW_SHOW);
                SetForegroundWindow(handle);
                return "已前置 Codex 主窗口";
            }
            catch (Exception ex)
            {
                return "前置 Codex 主窗口失败：" + ex.Message;
            }
        }

        private static IntPtr FindCodexMainWindowHandle()
        {
            try
            {
                var bestStartedAt = DateTime.MinValue;
                var best = IntPtr.Zero;
                foreach (var process in Process.GetProcessesByName("Codex"))
                {
                    using (process)
                    {
                        try
                        {
                            var handle = process.MainWindowHandle;
                            if (handle == IntPtr.Zero) continue;
                            var path = "";
                            try { path = process.MainModule == null ? "" : process.MainModule.FileName; } catch { }
                            if (!ContainsIgnoreCase(path, "\\WindowsApps\\OpenAI.Codex_")) continue;
                            var startedAt = DateTime.MinValue;
                            try { startedAt = process.StartTime; } catch { }
                            if (best == IntPtr.Zero || startedAt > bestStartedAt)
                            {
                                best = handle;
                                bestStartedAt = startedAt;
                            }
                        }
                        catch { }
                    }
                }
                return best;
            }
            catch
            {
                return IntPtr.Zero;
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
                + "<title>" + HtmlEscape(ProductFullName) + "</title>"
                + "<style>body{font-family:Segoe UI,Microsoft YaHei UI,sans-serif;margin:0;background:#0c0f0b;color:#f3f1e8}main{max-width:760px;margin:8vh auto;padding:0 24px}h1{font-size:28px;margin:0 0 12px}.card{border:1px solid #3d4638;background:#191e16;padding:22px;margin-top:18px}.muted{color:#a9b09e}.row{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}a{color:#12150e;background:#e5ff6a;text-decoration:none;padding:10px 14px;font-weight:700}code{background:#090c08;padding:3px 6px}</style>"
                + "</head><body><main><h1>" + HtmlEscape(ProductFullName) + " 正在运行</h1>"
                + "<p class=\"muted\">Agent 已就绪，可以在 Codex Dock 中一键切换账号。</p>"
                + "<div class=\"card\"><strong>本地 API</strong><p><code>" + HtmlEscape(BaseUrl) + "</code></p><p class=\"muted\">" + HtmlEscape(auth) + "</p></div>"
                + "<div class=\"card\"><strong>Codex 状态</strong><p>" + HtmlEscape(codex.Label) + "</p><p class=\"muted\">" + HtmlEscape(codex.Detail) + "</p></div>"
                + "<div class=\"card\"><strong>自动切换</strong><p>" + HtmlEscape(auto.Enabled && !string.IsNullOrEmpty(auto.DeviceToken) ? "已开启" : "未开启") + "</p><p class=\"muted\">" + HtmlEscape(_lastAutoSwitchResult) + "</p></div>"
                + "<div class=\"card\"><strong>版本更新</strong><p>当前 Agent v" + HtmlEscape(HelperVersion) + " · " + HtmlEscape(HelperBuildDate) + "</p><p class=\"muted\">可先检查发布清单，再下载安装最新版。Agent 不会静默覆盖当前运行文件。</p></div>"
                + "<div class=\"row\"><a href=\"" + HtmlEscape(CloudConsoleUrl) + "\">打开 Codex Dock</a><a href=\"/api/health\">查看状态</a><a href=\"/api/update/check\">检查更新</a><a href=\"" + HtmlEscape(LatestHelperDownloadUrl("")) + "\">下载最新版</a></div>"
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
                ? "Codex Dock 正在自动解析回调，此页面会尝试自动关闭。"
                : "授权服务返回错误：" + error;
            return "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<title>" + HtmlEscape(title) + "</title>"
                + "<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f6f6f6;color:#111;display:grid;place-items:center;min-height:100vh}"
                + ".card{width:min(480px,calc(100vw - 32px));background:#fff;border:1px solid #ddd;border-radius:16px;padding:24px;box-shadow:0 18px 60px rgba(0,0,0,.12)}"
                + "h1{font-size:22px;margin:0 0 8px}p{margin:0;color:#666;line-height:1.6}button{margin-top:18px;height:36px;border:1px solid #ddd;border-radius:999px;background:#111;color:#fff;padding:0 18px;font:inherit;cursor:pointer}</style>"
                + "</head><body><main class=\"card\"><h1>" + HtmlEscape(title) + "</h1><p>" + HtmlEscape(detail) + "</p><button onclick=\"window.close()\">关闭页面</button></main>"
                + "<script>(function(){var closed=false;var msg={type:'codex-dock-oauth-callback',url:" + JsString(callbackUrl) + "};function closeSoon(){if(closed)return;closed=true;setTimeout(function(){try{window.close();}catch(e){}},180);}function send(){try{if(window.opener&&!window.opener.closed)window.opener.postMessage(msg,'*');}catch(e){}}window.addEventListener('message',function(e){if(e&&e.data&&e.data.type==='codex-dock-oauth-received')closeSoon();});send();setTimeout(send,500);setTimeout(send,1500);setTimeout(closeSoon,2600);})();</script>"
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
            _statusLabel.Text = ContainsIgnoreCase(text, "失败")
                ? "● 服务异常"
                : (_running ? "● Agent 在线" : "● 服务未启动");
            _statusLabel.ForeColor = ContainsIgnoreCase(text, "失败")
                ? Color.FromArgb(180, 45, 45)
                : (_running ? Color.FromArgb(5, 130, 96) : Color.FromArgb(137, 91, 0));
            if (_trayIcon != null)
            {
                var tip = ProductFullName + " - " + text;
                _trayIcon.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;
            }
            RefreshTrayMenu();
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
            var safeText = text ?? "";
            var now = DateTime.Now;
            var display = ClassifyLogMessage(safeText);
            WriteHelperLogLine("[" + now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + safeText);
            AddRecentLogLine("[" + now.ToString("HH:mm:ss") + "] [" + display.Label + "] " + safeText);
            if (_applicationClosing) return;
            if (InvokeRequired)
            {
                try
                {
                    BeginInvoke(new Action(delegate { RenderLogMessage(now, safeText, display); }));
                }
                catch (Exception ex)
                {
                    RecordLogViewFailure("dispatch", ex);
                }
                return;
            }
            RenderLogMessage(now, safeText, display);
        }

        private void RenderLogMessage(DateTime now, string text, LogDisplayStyle display)
        {
            if (!CanRenderLogView())
            {
                _logViewNeedsReload = true;
                return;
            }
            if (_logViewNeedsReload)
            {
                RestoreRecentLogView("待显示日志恢复");
                return;
            }
            try
            {
            AppendLogText("[" + now.ToString("HH:mm:ss") + "] ", Color.FromArgb(136, 150, 165), FontStyle.Regular);
            AppendLogText("[" + display.Label + "] ", display.TagColor, FontStyle.Bold);
            AppendLogText(text + Environment.NewLine, display.TextColor, FontStyle.Regular);
            _logBox.SelectionStart = _logBox.TextLength;
            _logBox.ScrollToCaret();
                if (_logBox.TextLength > HelperUiLogMaxCharacters) RestoreRecentLogView("显示行数上限");
            }
            catch (ArgumentException ex)
            {
                RecoverLogView("render-argument", ex);
            }
            catch (ObjectDisposedException ex)
            {
                RecordLogViewFailure("render-disposed", ex);
                _logViewNeedsReload = true;
            }
            catch (InvalidOperationException ex)
            {
                RecoverLogView("render-invalid-operation", ex);
            }
        }

        private void AppendLogText(string text, Color color, FontStyle style)
        {
            _logBox.SelectionStart = _logBox.TextLength;
            _logBox.SelectionLength = 0;
            _logBox.SelectionColor = color;
            _logBox.SelectionFont = style == FontStyle.Bold ? _logBoldFont : _logRegularFont;
            _logBox.AppendText(text);
        }

        private bool CanRenderLogView()
        {
            return !_applicationClosing
                && Visible
                && !IsDisposed
                && !Disposing
                && _logBox != null
                && !_logBox.IsDisposed
                && !_logBox.Disposing
                && _logBox.IsHandleCreated;
        }

        private void AddRecentLogLine(string line)
        {
            lock (_recentLogLock)
            {
                _recentLogLines.Enqueue(line ?? "");
                while (_recentLogLines.Count > HelperUiLogLineLimit) _recentLogLines.Dequeue();
            }
        }

        private void LoadRecentLogHistory()
        {
            try
            {
                var path = HelperLogPath();
                if (!File.Exists(path)) return;
                var lines = File.ReadAllLines(path, Encoding.UTF8);
                lock (_recentLogLock)
                {
                    _recentLogLines.Clear();
                    var first = Math.Max(0, lines.Length - HelperUiLogLineLimit);
                    for (var index = first; index < lines.Length; index++)
                    {
                        _recentLogLines.Enqueue(lines[index]);
                    }
                }
                _logViewNeedsReload = true;
            }
            catch (Exception ex)
            {
                RecordLogViewFailure("history-load", ex);
            }
        }

        private void RestoreRecentLogView(string reason)
        {
            if (!CanRenderLogView())
            {
                _logViewNeedsReload = true;
                return;
            }
            string text;
            int count;
            lock (_recentLogLock)
            {
                var lines = _recentLogLines.ToArray();
                count = lines.Length;
                text = string.Join(Environment.NewLine, lines);
                if (text.Length > 0) text += Environment.NewLine;
            }
            try
            {
                ResetVisibleLogBox("恢复前清理");
                _logBox.SelectionColor = Color.FromArgb(223, 233, 212);
                _logBox.SelectionFont = _logRegularFont;
                _logBox.AppendText(text);
                _logBox.SelectionStart = _logBox.TextLength;
                _logBox.ScrollToCaret();
                _logViewNeedsReload = false;
                WriteLifecycleLog("日志视图已恢复; reason=" + reason + ", lines=" + count.ToString(CultureInfo.InvariantCulture));
            }
            catch (Exception ex)
            {
                _logViewNeedsReload = true;
                RecordLogViewFailure("restore-" + reason, ex);
            }
        }

        private void RecoverLogView(string stage, Exception ex)
        {
            _logViewNeedsReload = true;
            RecordLogViewFailure(stage, ex);
            RestoreRecentLogView("渲染故障恢复");
        }

        private bool SimulateLogViewFaultForSelfTest(string marker)
        {
            try
            {
                if (!CanRenderLogView()) return false;
                _logBox.SimulateRecoverForSelfTest(new ArgumentException("self-test simulated RichTextBox fault: " + marker));
                RestoreRecentLogView("生命周期自检渲染故障");
                return !_logViewNeedsReload && _logBox.Text.IndexOf(marker, StringComparison.Ordinal) >= 0;
            }
            catch (Exception ex)
            {
                RecordLogViewFailure("self-test-simulated-richtextbox-fault", ex);
                _logViewNeedsReload = true;
                return false;
            }
        }

        private void ResetVisibleLogBox(string reason)
        {
            try
            {
                if (_logBox == null || _logBox.IsDisposed) return;
                _logBox.Clear();
                _logBox.Text = "";
                _logBox.SelectionStart = 0;
                _logBox.SelectionLength = 0;
                _logBox.SelectionColor = Color.FromArgb(223, 233, 212);
                _logBox.SelectionFont = _logRegularFont;
                _logViewNeedsReload = true;
            }
            catch (Exception ex)
            {
                _logViewNeedsReload = true;
                RecordLogViewFailure("reset-" + reason, ex);
            }
        }

        private void ClearVisibleLogs()
        {
            lock (_recentLogLock)
            {
                _recentLogLines.Clear();
            }
            _logViewNeedsReload = false;
            try
            {
                if (_logBox != null && !_logBox.IsDisposed) _logBox.Clear();
            }
            catch (Exception ex)
            {
                RecordLogViewFailure("clear-visible", ex);
                _logViewNeedsReload = true;
            }
            WriteLifecycleLog("用户清空可见日志缓冲; 持久日志文件保留");
        }

        private static void RecordLogViewFailure(string stage, Exception ex)
        {
            WriteLifecycleLog("日志视图故障; stage=" + stage + ", type=" + ex.GetType().Name + ", message=" + ShortNonEmpty(ex.Message, 160));
        }

        private static void WriteLifecycleLog(string text)
        {
            WriteHelperLogLine("[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] [lifecycle] " + (text ?? ""));
        }

        private static LogDisplayStyle ClassifyLogMessage(string text)
        {
            var value = text ?? "";
            if (Regex.IsMatch(value, "失败|异常|错误|失效|未启动", RegexOptions.IgnoreCase))
            {
                return new LogDisplayStyle("错误", Color.FromArgb(255, 107, 107), Color.FromArgb(255, 178, 178));
            }
            if (Regex.IsMatch(value, "等待|冷却|触发|额度|用量", RegexOptions.IgnoreCase))
            {
                return new LogDisplayStyle("提醒", Color.FromArgb(255, 193, 74), Color.FromArgb(255, 214, 128));
            }
            if (Regex.IsMatch(value, "auth|OAuth|授权|备份|导入", RegexOptions.IgnoreCase))
            {
                return new LogDisplayStyle("授权", Color.FromArgb(144, 173, 255), Color.FromArgb(219, 229, 255));
            }
            if (Regex.IsMatch(value, "自动切换|检查正常|云端", RegexOptions.IgnoreCase))
            {
                return new LogDisplayStyle("切换", Color.FromArgb(32, 221, 151), Color.FromArgb(167, 242, 210));
            }
            if (Regex.IsMatch(value, "Codex|进程|窗口", RegexOptions.IgnoreCase))
            {
                return new LogDisplayStyle("Codex", Color.FromArgb(101, 185, 255), Color.FromArgb(193, 224, 255));
            }
            return new LogDisplayStyle("系统", Color.FromArgb(125, 184, 255), Color.FromArgb(224, 230, 236));
        }

        private void RunOnUi(Action action)
        {
            try
            {
                if (_applicationClosing || IsDisposed || Disposing) return;
                if (InvokeRequired)
                {
                    BeginInvoke(action);
                    return;
                }
                action();
            }
            catch { }
        }

        private bool RunOnUiAndWait(Action action)
        {
            try
            {
                if (_applicationClosing || IsDisposed || Disposing || !IsHandleCreated) return false;
                if (InvokeRequired)
                {
                    Invoke(action);
                    return true;
                }
                action();
                return true;
            }
            catch (Exception ex)
            {
                WriteLifecycleLog("UI 同步调度失败; " + ex.GetType().Name + ": " + ShortNonEmpty(ex.Message, 160));
                return false;
            }
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
                    _operationProgressForm.TopMost = true;
                    _operationProgressForm.BringToFront();
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
                timer.Interval = success ? 1800 : 3200;
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

        private sealed class HelperUpdateInfo
        {
            public bool Ok;
            public bool UpdateAvailable;
            public string CurrentVersion = "";
            public string LatestVersion = "";
            public string LatestBuildDate = "";
            public string AssetVersion = "";
            public string File = "";
            public string DownloadUrl = "";
            public string Sha256 = "";
            public long Bytes;
            public string CheckedAt = "";
            public string Error = "";

            public static HelperUpdateInfo Failed(string error)
            {
                return new HelperUpdateInfo
                {
                    Ok = false,
                    CurrentVersion = HelperVersion,
                    CheckedAt = DateTime.UtcNow.ToString("o"),
                    Error = string.IsNullOrWhiteSpace(error) ? "检查更新失败" : error,
                };
            }

            public string ToJson()
            {
                return "{\"ok\":" + (Ok ? "true" : "false")
                    + ",\"current_version\":\"" + JsonEscape(CurrentVersion) + "\""
                    + ",\"latest_version\":\"" + JsonEscape(LatestVersion) + "\""
                    + ",\"latest_build_date\":\"" + JsonEscape(LatestBuildDate) + "\""
                    + ",\"asset_version\":\"" + JsonEscape(AssetVersion) + "\""
                    + ",\"update_available\":" + (UpdateAvailable ? "true" : "false")
                    + ",\"file\":\"" + JsonEscape(File) + "\""
                    + ",\"download_url\":\"" + JsonEscape(DownloadUrl) + "\""
                    + ",\"sha256\":\"" + JsonEscape(Sha256) + "\""
                    + ",\"bytes\":" + Bytes.ToString(CultureInfo.InvariantCulture)
                    + ",\"checked_at\":\"" + JsonEscape(CheckedAt) + "\""
                    + (string.IsNullOrWhiteSpace(Error) ? "" : ",\"error\":\"" + JsonEscape(Error) + "\"")
                    + "}";
            }
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

    }
}

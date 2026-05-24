using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace CodexDockProxy
{
    internal static class Program
    {
        private static readonly object StateLock = new object();
        private static readonly HashSet<string> ActiveTurns = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private static string _state = "idle";
        private static string _label = "空闲";
        private static string _detail = "app-server 代理已启动，等待 Codex 事件。";
        private static string _lastEvent = "";
        private static DateTime _lastEventAt = DateTime.MinValue;
        private static int _childPid;
        private static string _realCodexPath = "";
        private static bool _running = true;
        private static bool _monitoring;

        private static int Main(string[] args)
        {
            try
            {
                _realCodexPath = ResolveRealCodexPath();
                if (string.IsNullOrEmpty(_realCodexPath) || !File.Exists(_realCodexPath))
                {
                    if (IsAppServerInvocation(args))
                    {
                        _monitoring = true;
                        SetState("unknown", "代理未就绪", "未找到真实 Codex CLI。请在 Dock Helper 中重新安装精准监控。", "proxy/error");
                        WriteStatus();
                    }
                    Console.Error.WriteLine("Codex Dock proxy: real codex.exe not found.");
                    return 2;
                }

                _monitoring = IsAppServerInvocation(args);
                var process = StartRealCodex(args, _realCodexPath);
                if (process == null)
                {
                    if (_monitoring)
                    {
                        SetState("unknown", "代理未就绪", "真实 Codex CLI 启动失败。", "proxy/error");
                        WriteStatus();
                    }
                    return 3;
                }

                _childPid = process.Id;
                if (_monitoring) SetState("idle", "空闲", "已接入 Codex app-server，正在监听任务事件。", "proxy/connected");

                if (_monitoring)
                {
                    var heartbeat = new Thread(new ThreadStart(HeartbeatLoop));
                    heartbeat.IsBackground = true;
                    heartbeat.Start();
                }

                var stdin = new Thread(new ThreadStart(delegate { ForwardInput(process); }));
                stdin.IsBackground = true;
                stdin.Start();

                var stdout = new Thread(new ThreadStart(delegate { ForwardOutput(process); }));
                stdout.IsBackground = true;
                stdout.Start();

                var stderr = new Thread(new ThreadStart(delegate { ForwardError(process); }));
                stderr.IsBackground = true;
                stderr.Start();

                process.WaitForExit();
                _running = false;
                if (_monitoring)
                {
                    SetState("not_running", "Codex 未运行", "Codex app-server 已退出。", "proxy/exited");
                    WriteStatus();
                }
                return process.ExitCode;
            }
            catch (Exception ex)
            {
                _running = false;
                if (_monitoring)
                {
                    SetState("unknown", "代理异常", ex.Message, "proxy/exception");
                    WriteStatus();
                }
                Console.Error.WriteLine("Codex Dock proxy error: " + ex.Message);
                return 1;
            }
        }

        private static Process StartRealCodex(string[] args, string realPath)
        {
            var info = new ProcessStartInfo();
            info.FileName = realPath;
            info.Arguments = QuoteArguments(args);
            info.UseShellExecute = false;
            info.RedirectStandardInput = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.CreateNoWindow = true;
            info.EnvironmentVariables["CODEX_DOCK_PROXY_ACTIVE"] = "1";
            info.EnvironmentVariables["CODEX_DOCK_REAL_CODEX_CLI_PATH"] = realPath;
            info.EnvironmentVariables["CODEX_CLI_PATH"] = realPath;
            return Process.Start(info);
        }

        private static void ForwardInput(Process process)
        {
            try
            {
                var input = Console.OpenStandardInput();
                var output = process.StandardInput.BaseStream;
                input.CopyTo(output);
                output.Flush();
            }
            catch { }
            try { process.StandardInput.Close(); } catch { }
        }

        private static void ForwardOutput(Process process)
        {
            var reader = new StreamReader(process.StandardOutput.BaseStream, new UTF8Encoding(false));
            var writer = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            writer.AutoFlush = true;
            try
            {
                string line;
                while ((line = reader.ReadLine()) != null)
                {
                    ObserveProtocolLine(line);
                    writer.WriteLine(line);
                }
            }
            catch { }
        }

        private static void ForwardError(Process process)
        {
            var reader = new StreamReader(process.StandardError.BaseStream, new UTF8Encoding(false));
            var writer = new StreamWriter(Console.OpenStandardError(), new UTF8Encoding(false));
            writer.AutoFlush = true;
            try
            {
                string line;
                while ((line = reader.ReadLine()) != null)
                {
                    writer.WriteLine(line);
                }
            }
            catch { }
        }

        private static void ObserveProtocolLine(string line)
        {
            if (!_monitoring) return;
            if (string.IsNullOrEmpty(line)) return;
            if (line.IndexOf("\"method\"", StringComparison.OrdinalIgnoreCase) < 0) return;

            if (line.IndexOf("\"turn/started\"", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                var id = ExtractTurnId(line);
                lock (StateLock)
                {
                    if (!string.IsNullOrEmpty(id)) ActiveTurns.Add(id);
                    _state = "active";
                    _label = "任务中";
                    _detail = "Codex 正在执行任务。";
                    TouchEvent("turn/started");
                }
                WriteStatus();
                return;
            }

            if (line.IndexOf("\"turn/completed\"", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                var id = ExtractTurnId(line);
                lock (StateLock)
                {
                    if (!string.IsNullOrEmpty(id)) ActiveTurns.Remove(id);
                    if (ActiveTurns.Count == 0)
                    {
                        _state = "idle";
                        _label = "空闲";
                        _detail = "最近一次任务已结束。";
                    }
                    TouchEvent("turn/completed");
                }
                WriteStatus();
                return;
            }

            if (line.IndexOf("\"thread/status/changed\"", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                lock (StateLock)
                {
                    if (Regex.IsMatch(line, "\"type\"\\s*:\\s*\"active\"", RegexOptions.IgnoreCase))
                    {
                        _state = "active";
                        _label = "任务中";
                        _detail = "Codex 线程处于运行状态。";
                    }
                    else if (Regex.IsMatch(line, "\"type\"\\s*:\\s*\"idle\"", RegexOptions.IgnoreCase) && ActiveTurns.Count == 0)
                    {
                        _state = "idle";
                        _label = "空闲";
                        _detail = "Codex 线程处于空闲状态。";
                    }
                    else if (line.IndexOf("waiting", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        _state = "waiting";
                        _label = "等待确认";
                        _detail = "Codex 正在等待用户确认。";
                    }
                    TouchEvent("thread/status/changed");
                }
                WriteStatus();
            }
        }

        private static void TouchEvent(string name)
        {
            _lastEvent = name;
            _lastEventAt = DateTime.UtcNow;
        }

        private static string ExtractTurnId(string line)
        {
            var match = Regex.Match(line, "\"turnId\"\\s*:\\s*\"([^\"]+)\"", RegexOptions.IgnoreCase);
            if (match.Success) return match.Groups[1].Value;
            match = Regex.Match(line, "\"id\"\\s*:\\s*\"([^\"]+)\"", RegexOptions.IgnoreCase);
            return match.Success ? match.Groups[1].Value : "";
        }

        private static void HeartbeatLoop()
        {
            while (_running)
            {
                WriteStatus();
                Thread.Sleep(2000);
            }
        }

        private static void SetState(string state, string label, string detail, string evt)
        {
            lock (StateLock)
            {
                _state = state;
                _label = label;
                _detail = detail;
                TouchEvent(evt);
            }
        }

        private static void WriteStatus()
        {
            if (!_monitoring) return;
            try
            {
                Directory.CreateDirectory(DataDir());
                string state;
                string label;
                string detail;
                string lastEvent;
                DateTime lastEventAt;
                int activeCount;
                lock (StateLock)
                {
                    state = _state;
                    label = _label;
                    detail = _detail;
                    lastEvent = _lastEvent;
                    lastEventAt = _lastEventAt;
                    activeCount = ActiveTurns.Count;
                }

                var json = "{"
                    + "\"running\":" + (_running ? "true" : "false") + ","
                    + "\"proxy_pid\":" + Process.GetCurrentProcess().Id + ","
                    + "\"child_pid\":" + _childPid + ","
                    + "\"real_codex_path\":\"" + JsonEscape(_realCodexPath) + "\","
                    + "\"state\":\"" + JsonEscape(state) + "\","
                    + "\"label\":\"" + JsonEscape(label) + "\","
                    + "\"detail\":\"" + JsonEscape(detail) + "\","
                    + "\"source\":\"app-server-proxy\","
                    + "\"active_turn_count\":" + activeCount + ","
                    + "\"waiting_thread_count\":" + (state == "waiting" ? 1 : 0) + ","
                    + "\"thread_count\":" + (activeCount > 0 ? activeCount : 0) + ","
                    + "\"last_event\":\"" + JsonEscape(lastEvent) + "\","
                    + "\"last_event_at\":\"" + JsonEscape(lastEventAt == DateTime.MinValue ? "" : lastEventAt.ToString("o")) + "\","
                    + "\"heartbeat_at\":\"" + JsonEscape(DateTime.UtcNow.ToString("o")) + "\""
                    + "}";
                AtomicWrite(StatusPath(), json);
            }
            catch { }
        }

        private static void AtomicWrite(string path, string content)
        {
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, content, new UTF8Encoding(false));
            if (File.Exists(path)) File.Delete(path);
            File.Move(tmp, path);
        }

        private static string ResolveRealCodexPath()
        {
            var envReal = Environment.GetEnvironmentVariable("CODEX_DOCK_REAL_CODEX_CLI_PATH");
            if (IsUsableCodexPath(envReal)) return envReal;

            try
            {
                var config = ConfigPath();
                if (File.Exists(config))
                {
                    var raw = File.ReadAllText(config, Encoding.UTF8);
                    var configured = MatchJsonString(raw, "realCodexPath");
                    if (IsUsableCodexPath(configured)) return configured;
                }
            }
            catch { }

            return FindBundledCodexExe();
        }

        private static string FindBundledCodexExe()
        {
            try
            {
                var binRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpenAI", "Codex", "bin");
                if (!Directory.Exists(binRoot)) return "";
                string newest = null;
                DateTime newestWrite = DateTime.MinValue;
                foreach (var file in Directory.EnumerateFiles(binRoot, "codex.exe", SearchOption.AllDirectories))
                {
                    if (!IsUsableCodexPath(file)) continue;
                    var write = File.GetLastWriteTimeUtc(file);
                    if (newest == null || write > newestWrite)
                    {
                        newest = file;
                        newestWrite = write;
                    }
                }
                return newest ?? "";
            }
            catch
            {
                return "";
            }
        }

        private static bool IsUsableCodexPath(string path)
        {
            if (string.IsNullOrWhiteSpace(path) || !File.Exists(path)) return false;
            var own = Process.GetCurrentProcess().MainModule.FileName;
            return !SamePath(path, own) && !Path.GetFileName(path).Equals("CodexAppServerProxy.exe", StringComparison.OrdinalIgnoreCase);
        }

        private static string QuoteArguments(string[] args)
        {
            var parts = new List<string>();
            foreach (var arg in args)
            {
                parts.Add(QuoteArgument(arg));
            }
            return string.Join(" ", parts.ToArray());
        }

        private static bool IsAppServerInvocation(string[] args)
        {
            foreach (var arg in args)
            {
                if (string.Equals(arg, "app-server", StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        private static string QuoteArgument(string value)
        {
            if (string.IsNullOrEmpty(value)) return "\"\"";
            if (value.IndexOfAny(new[] { ' ', '\t', '\r', '\n', '"' }) < 0) return value;
            return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        }

        private static string DataDir()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CodexDock");
        }

        private static string ConfigPath()
        {
            return Path.Combine(DataDir(), "app-server-proxy.json");
        }

        private static string StatusPath()
        {
            return Path.Combine(DataDir(), "codex-app-server-proxy-status.json");
        }

        private static string MatchJsonString(string json, string field)
        {
            var match = Regex.Match(json ?? "", "\"" + Regex.Escape(field) + "\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\"");
            return match.Success ? JsonUnescape(match.Groups[1].Value) : "";
        }

        private static string JsonEscape(string value)
        {
            return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
        }

        private static string JsonUnescape(string value)
        {
            return (value ?? "").Replace("\\\"", "\"").Replace("\\\\", "\\");
        }

        private static bool SamePath(string a, string b)
        {
            try
            {
                return string.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
            }
        }
    }
}

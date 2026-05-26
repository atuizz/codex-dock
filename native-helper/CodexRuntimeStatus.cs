using System;
using System.Globalization;

namespace CodexPlusLocalHelper
{
    internal sealed class CodexRuntimeStatus
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

        private static string JsonEscape(string value)
        {
            return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
        }
    }
}

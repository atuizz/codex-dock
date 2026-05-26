namespace CodexPlusLocalHelper
{
    internal sealed class AuthWriteResult
    {
        public string Target;
        public string Backup;
    }

    internal sealed class ProcessRecord
    {
        public int Id;
        public int ParentId;
        public string Name;
        public string CommandLine;
    }

    internal sealed class CodexRestoreTarget
    {
        public string ThreadId = "";
        public string Url = "";
        public string Source = "";
        public string Title = "";
        public string Cwd = "";
        public bool IsGoal;
        public string Reason = "";
    }

    internal sealed class ProtocolProbeResult
    {
        public bool Connected;
        public string Error = "";
        public string UserAgent = "";
        public int LoadedThreadCount;
        public int ActiveThreadCount;
        public int WaitingThreadCount;
        public int ThreadCount;
    }
}

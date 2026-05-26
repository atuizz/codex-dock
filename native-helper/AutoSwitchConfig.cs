namespace CodexPlusLocalHelper
{
    internal sealed class AutoSwitchConfig
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
            OnlyWhenIdle = true;
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
}

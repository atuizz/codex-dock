using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace CodexPlusLocalHelper
{
    internal static class HelperDesktopUi
    {
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool DestroyIcon(IntPtr hIcon);

        public static Label MakeLabel(string text, float size, FontStyle style, Color color)
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

        public static void RoundControl(Control control, int radius)
        {
            Action update = delegate
            {
                if (control.Width <= 0 || control.Height <= 0) return;
                using (var path = RoundedRectangle(new Rectangle(0, 0, control.Width - 1, control.Height - 1), radius))
                {
                    var next = new Region(path);
                    var previous = control.Region;
                    control.Region = next;
                    if (previous != null) previous.Dispose();
                }
            };
            control.Resize += delegate { update(); };
            update();
        }

        public static Icon CreateAppIcon()
        {
            try
            {
                return CreateGeneratedAppIcon();
            }
            catch
            {
                return (Icon)SystemIcons.Application.Clone();
            }
        }

        public static GraphicsPath RoundedRectangle(Rectangle bounds, int radius)
        {
            var diameter = radius * 2;
            var path = new GraphicsPath();
            path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
            path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
            path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }

        public static Color ResolveControlBackColor(Control control, Color fallback)
        {
            var current = control == null ? null : control.Parent;
            while (current != null)
            {
                if (current.BackColor != Color.Transparent && current.BackColor.A > 0) return current.BackColor;
                current = current.Parent;
            }
            return fallback;
        }

        private static Icon CreateGeneratedAppIcon()
        {
            using (var bitmap = new Bitmap(64, 64))
            using (var graphics = Graphics.FromImage(bitmap))
            {
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                graphics.Clear(Color.Transparent);
                using (var stroke = new Pen(Color.FromArgb(35, 44, 51), 4))
                using (var dot = new SolidBrush(Color.FromArgb(20, 181, 141)))
                {
                    stroke.LineJoin = LineJoin.Round;
                    using (var top = RoundedRectangle(new Rectangle(11, 13, 42, 16), 4))
                    using (var bottom = RoundedRectangle(new Rectangle(11, 35, 42, 16), 4))
                    {
                        graphics.DrawPath(stroke, top);
                        graphics.DrawPath(stroke, bottom);
                    }
                    graphics.FillEllipse(dot, 18, 19, 5, 5);
                    graphics.FillEllipse(dot, 18, 41, 5, 5);
                }

                var handle = bitmap.GetHicon();
                try
                {
                    return (Icon)Icon.FromHandle(handle).Clone();
                }
                finally
                {
                    DestroyIcon(handle);
                }
            }
        }
    }

    internal sealed class LogDisplayStyle
    {
        public readonly string Label;
        public readonly Color TagColor;
        public readonly Color TextColor;

        public LogDisplayStyle(string label, Color tagColor, Color textColor)
        {
            Label = label;
            TagColor = tagColor;
            TextColor = textColor;
        }
    }

    internal sealed class RoundedTrayMenu : ContextMenuStrip
    {
        public RoundedTrayMenu()
        {
            Padding = new Padding(8, 10, 8, 10);
            Renderer = new TrayMenuRenderer();
            DropShadowEnabled = true;
        }

        protected override void OnSizeChanged(EventArgs e)
        {
            base.OnSizeChanged(e);
            if (Width <= 0 || Height <= 0) return;
            using (var path = HelperDesktopUi.RoundedRectangle(new Rectangle(0, 0, Width - 1, Height - 1), 12))
            {
                var old = Region;
                Region = new Region(path);
                if (old != null) old.Dispose();
            }
        }
    }

    internal sealed class TrayMenuRenderer : ToolStripProfessionalRenderer
    {
        public TrayMenuRenderer() : base(new TrayMenuColorTable())
        {
            RoundedEdges = true;
        }

        protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var pen = new Pen(Color.FromArgb(220, 224, 227)))
            using (var path = HelperDesktopUi.RoundedRectangle(new Rectangle(0, 0, e.ToolStrip.Width - 1, e.ToolStrip.Height - 1), 12))
            {
                e.Graphics.DrawPath(pen, path);
            }
        }

        protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
        {
            if (!e.Item.Selected || !e.Item.Enabled) return;
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var brush = new SolidBrush(Color.FromArgb(239, 248, 245)))
            using (var path = HelperDesktopUi.RoundedRectangle(new Rectangle(5, 2, e.Item.Width - 10, e.Item.Height - 4), 9))
            {
                e.Graphics.FillPath(brush, path);
            }
        }

        protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
        {
            using (var pen = new Pen(Color.FromArgb(235, 237, 238)))
            {
                e.Graphics.DrawLine(pen, 10, e.Item.Height / 2, e.Item.Width - 10, e.Item.Height / 2);
            }
        }
    }

    internal sealed class TrayMenuColorTable : ProfessionalColorTable
    {
        public override Color ToolStripDropDownBackground { get { return Color.White; } }
        public override Color MenuItemBorder { get { return Color.Transparent; } }
        public override Color MenuItemSelected { get { return Color.FromArgb(242, 247, 246); } }
        public override Color ImageMarginGradientBegin { get { return Color.White; } }
        public override Color ImageMarginGradientMiddle { get { return Color.White; } }
        public override Color ImageMarginGradientEnd { get { return Color.White; } }
        public override Color SeparatorDark { get { return Color.FromArgb(235, 237, 238); } }
        public override Color SeparatorLight { get { return Color.FromArgb(235, 237, 238); } }
    }

    internal sealed class SurfacePanel : Panel
    {
        public SurfacePanel()
        {
            DoubleBuffered = true;
            ResizeRedraw = true;
        }

        protected override void OnResize(EventArgs eventargs)
        {
            base.OnResize(eventargs);
            if (Width <= 0 || Height <= 0) return;
            using (var path = HelperDesktopUi.RoundedRectangle(new Rectangle(0, 0, Width - 1, Height - 1), 12))
            {
                var previous = Region;
                Region = new Region(path);
                if (previous != null) previous.Dispose();
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var border = new Pen(BackColor == Color.FromArgb(28, 28, 28) ? Color.FromArgb(28, 28, 28) : Color.FromArgb(220, 223, 225)))
            using (var path = HelperDesktopUi.RoundedRectangle(new Rectangle(0, 0, Width - 1, Height - 1), 12))
            {
                e.Graphics.DrawPath(border, path);
            }
        }
    }

    internal sealed class InfoBox : Control
    {
        public InfoBox()
        {
            DoubleBuffered = true;
            TabStop = false;
            SetStyle(
                ControlStyles.UserPaint
                | ControlStyles.AllPaintingInWmPaint
                | ControlStyles.OptimizedDoubleBuffer
                | ControlStyles.ResizeRedraw
                | ControlStyles.SupportsTransparentBackColor,
                true);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var fill = new SolidBrush(BackColor))
            using (var border = new Pen(Color.FromArgb(222, 226, 229), 1F))
            using (var path = HelperDesktopUi.RoundedRectangle(new Rectangle(0, 0, Width - 1, Height - 1), 8))
            {
                e.Graphics.FillPath(fill, path);
                e.Graphics.DrawPath(border, path);
            }

            var textRect = new Rectangle(10, 9, Math.Max(0, Width - 20), Math.Max(0, Height - 18));
            TextRenderer.DrawText(
                e.Graphics,
                Text,
                Font,
                textRect,
                ForeColor,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.NoPadding | TextFormatFlags.WordBreak);
        }
    }

    internal enum SoftButtonGlyph
    {
        None,
        Stop
    }

    internal sealed class SoftButton : Control
    {
        private readonly bool _primary;
        private bool _hover;
        private bool _pressed;
        public SoftButtonGlyph Glyph { get; set; }

        public SoftButton(bool primary)
        {
            _primary = primary;
            BackColor = primary ? Color.FromArgb(10, 10, 10) : Color.FromArgb(252, 252, 251);
            ForeColor = primary ? Color.White : Color.FromArgb(35, 37, 39);
            DoubleBuffered = true;
            TabStop = false;
            SetStyle(
                ControlStyles.UserPaint
                | ControlStyles.AllPaintingInWmPaint
                | ControlStyles.OptimizedDoubleBuffer
                | ControlStyles.ResizeRedraw
                | ControlStyles.SupportsTransparentBackColor,
                true);
            SetStyle(ControlStyles.Selectable, false);
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            Invalidate();
        }

        protected override void OnPaintBackground(PaintEventArgs pevent)
        {
            var background = HelperDesktopUi.ResolveControlBackColor(this, Color.FromArgb(246, 246, 243));
            using (var brush = new SolidBrush(background))
            {
                pevent.Graphics.FillRectangle(brush, ClientRectangle);
            }
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            _hover = true;
            Invalidate();
            base.OnMouseEnter(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            _hover = false;
            _pressed = false;
            Invalidate();
            base.OnMouseLeave(e);
        }

        protected override void OnMouseDown(MouseEventArgs mevent)
        {
            if (mevent.Button == MouseButtons.Left) _pressed = true;
            Invalidate();
            base.OnMouseDown(mevent);
        }

        protected override void OnMouseUp(MouseEventArgs mevent)
        {
            _pressed = false;
            Invalidate();
            base.OnMouseUp(mevent);
        }

        protected override void OnPaint(PaintEventArgs pevent)
        {
            pevent.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            pevent.Graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
            var fillColor = _primary
                ? (_pressed ? Color.FromArgb(0, 0, 0) : (_hover ? Color.FromArgb(34, 34, 34) : Color.FromArgb(10, 10, 10)))
                : (_pressed ? Color.FromArgb(236, 239, 241) : (_hover ? Color.FromArgb(244, 246, 247) : Color.FromArgb(252, 252, 251)));
            if (!Enabled) fillColor = _primary ? Color.FromArgb(166, 166, 166) : Color.FromArgb(250, 250, 249);
            var borderColor = _primary
                ? (_hover ? Color.FromArgb(46, 46, 46) : Color.FromArgb(10, 10, 10))
                : (_hover ? Color.FromArgb(146, 156, 164) : Color.FromArgb(190, 197, 203));

            using (var borderFill = new SolidBrush(borderColor))
            using (var fill = new SolidBrush(fillColor))
            using (var outer = HelperDesktopUi.RoundedRectangle(new Rectangle(0, 0, Width - 1, Height - 1), 10))
            using (var inner = HelperDesktopUi.RoundedRectangle(new Rectangle(1, 1, Width - 3, Height - 3), 9))
            {
                pevent.Graphics.FillPath(borderFill, outer);
                pevent.Graphics.FillPath(fill, inner);
            }

            if (Glyph == SoftButtonGlyph.Stop)
            {
                var size = 10;
                var left = (Width - size) / 2;
                var top = (Height - size) / 2;
                using (var stop = new SolidBrush(Enabled ? Color.FromArgb(255, 91, 64) : Color.FromArgb(210, 154, 141)))
                using (var path = HelperDesktopUi.RoundedRectangle(new Rectangle(left, top, size, size), 2))
                {
                    pevent.Graphics.FillPath(stop, path);
                }
                return;
            }

            var color = Enabled ? ForeColor : Color.FromArgb(154, 157, 159);
            TextRenderer.DrawText(
                pevent.Graphics,
                Text,
                Font,
                new Rectangle(8, 0, Math.Max(0, Width - 16), Height),
                color,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        }
    }

    internal sealed class CloseGlyphButton : Control
    {
        private bool _hover;
        private bool _pressed;

        public CloseGlyphButton()
        {
            Cursor = Cursors.Hand;
            TabStop = false;
            DoubleBuffered = true;
            SetStyle(
                ControlStyles.UserPaint
                | ControlStyles.AllPaintingInWmPaint
                | ControlStyles.OptimizedDoubleBuffer
                | ControlStyles.ResizeRedraw
                | ControlStyles.SupportsTransparentBackColor,
                true);
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            _hover = true;
            Invalidate();
            base.OnMouseEnter(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            _hover = false;
            _pressed = false;
            Invalidate();
            base.OnMouseLeave(e);
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left) _pressed = true;
            Invalidate();
            base.OnMouseDown(e);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            _pressed = false;
            Invalidate();
            base.OnMouseUp(e);
        }

        protected override void OnPaintBackground(PaintEventArgs pevent)
        {
            var background = HelperDesktopUi.ResolveControlBackColor(this, Color.FromArgb(251, 252, 251));
            using (var brush = new SolidBrush(background))
            {
                pevent.Graphics.FillRectangle(brush, ClientRectangle);
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            if (_hover || _pressed)
            {
                using (var brush = new SolidBrush(_pressed ? Color.FromArgb(226, 231, 233) : Color.FromArgb(238, 242, 243)))
                using (var path = HelperDesktopUi.RoundedRectangle(new Rectangle(2, 2, Width - 5, Height - 5), 9))
                {
                    e.Graphics.FillPath(brush, path);
                }
            }

            using (var pen = new Pen(Color.FromArgb(40, 48, 54), 1.55F))
            {
                pen.StartCap = LineCap.Round;
                pen.EndCap = LineCap.Round;
                var left = Width / 2F - 4.5F;
                var right = Width / 2F + 4.5F;
                var top = Height / 2F - 4.5F;
                var bottom = Height / 2F + 4.5F;
                e.Graphics.DrawLine(pen, left, top, right, bottom);
                e.Graphics.DrawLine(pen, right, top, left, bottom);
            }
        }
    }

    internal sealed class RoundedProgressBar : Control
    {
        private int _value;
        public bool Failed { get; set; }

        public int Value
        {
            get { return _value; }
            set
            {
                _value = Math.Max(0, Math.Min(100, value));
                Invalidate();
            }
        }

        public RoundedProgressBar()
        {
            DoubleBuffered = true;
            SetStyle(
                ControlStyles.UserPaint
                | ControlStyles.AllPaintingInWmPaint
                | ControlStyles.OptimizedDoubleBuffer
                | ControlStyles.ResizeRedraw
                | ControlStyles.SupportsTransparentBackColor,
                true);
        }

        protected override void OnPaintBackground(PaintEventArgs pevent)
        {
            var background = HelperDesktopUi.ResolveControlBackColor(this, Color.White);
            using (var brush = new SolidBrush(background))
            {
                pevent.Graphics.FillRectangle(brush, ClientRectangle);
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var track = new SolidBrush(Color.FromArgb(233, 237, 238)))
            using (var path = HelperDesktopUi.RoundedRectangle(new Rectangle(0, 0, Width - 1, Height - 1), Height / 2))
            {
                e.Graphics.FillPath(track, path);
            }
            var fillWidth = Math.Max(Height, (int)Math.Round((Width - 1) * (_value / 100D)));
            fillWidth = Math.Min(Width - 1, fillWidth);
            using (var fill = new SolidBrush(Failed ? Color.FromArgb(221, 74, 74) : Color.FromArgb(20, 181, 141)))
            using (var path = HelperDesktopUi.RoundedRectangle(new Rectangle(0, 0, fillWidth, Height - 1), Height / 2))
            {
                e.Graphics.FillPath(fill, path);
            }
        }
    }

    internal sealed class SafeLogRichTextBox : RichTextBox
    {
        private readonly Action<Exception> _faultHandler;

        public SafeLogRichTextBox(Action<Exception> faultHandler)
        {
            _faultHandler = faultHandler;
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            try
            {
                base.OnHandleCreated(e);
            }
            catch (ArgumentException ex)
            {
                RecoverRichTextState(ex);
            }
            catch (InvalidOperationException ex)
            {
                RecoverRichTextState(ex);
            }
        }

        protected override void WndProc(ref Message m)
        {
            try
            {
                base.WndProc(ref m);
            }
            catch (ArgumentException ex)
            {
                RecoverRichTextState(ex);
            }
            catch (InvalidOperationException ex)
            {
                RecoverRichTextState(ex);
            }
        }

        private void RecoverRichTextState(Exception ex)
        {
            if (_faultHandler != null) _faultHandler(ex);
            try
            {
                Clear();
                Text = "";
                SelectionStart = 0;
                SelectionLength = 0;
            }
            catch { }
        }

        public void SimulateRecoverForSelfTest(Exception ex)
        {
            RecoverRichTextState(ex);
        }
    }

    internal sealed class OperationProgressForm : Form
    {
        private readonly Label _titleLabel;
        private readonly Label _detailLabel;
        private readonly Label _percentLabel;
        private readonly RoundedProgressBar _progressBar;

        public OperationProgressForm()
        {
            Text = "Codex Dock Agent";
            Icon = HelperDesktopUi.CreateAppIcon();
            Width = 488;
            Height = 196;
            MinimumSize = new Size(448, 184);
            MaximumSize = new Size(548, 220);
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            BackColor = Color.FromArgb(255, 255, 255);
            ForeColor = Color.FromArgb(24, 26, 27);
            Font = new Font("Microsoft YaHei UI", 9F);
            Padding = new Padding(1);
            DoubleBuffered = true;
            Paint += OperationProgressForm_Paint;
            Resize += delegate { ApplyRoundedWindow(); };

            var topBar = new Panel
            {
                BackColor = Color.FromArgb(251, 252, 251),
                Dock = DockStyle.Top,
                Height = 40,
            };
            Controls.Add(topBar);

            var appMark = new Label
            {
                Text = "▤",
                Font = new Font("Segoe UI Symbol", 10F, FontStyle.Regular),
                ForeColor = Color.FromArgb(42, 54, 60),
                TextAlign = ContentAlignment.MiddleCenter,
                Location = new Point(14, 8),
                Size = new Size(22, 24),
            };
            topBar.Controls.Add(appMark);

            var windowTitle = HelperDesktopUi.MakeLabel("Codex Dock Agent", 9F, FontStyle.Regular, Color.FromArgb(48, 55, 64));
            windowTitle.Location = new Point(38, 10);
            windowTitle.Size = new Size(180, 22);
            topBar.Controls.Add(windowTitle);

            var closeButton = new CloseGlyphButton
            {
                BackColor = Color.Transparent,
                Location = new Point(446, 5),
                Size = new Size(30, 30),
                Anchor = AnchorStyles.Top | AnchorStyles.Right,
            };
            closeButton.Click += delegate { Close(); };
            topBar.Controls.Add(closeButton);
            topBar.Resize += delegate
            {
                closeButton.Left = Math.Max(0, topBar.ClientSize.Width - closeButton.Width - 12);
            };

            var statusDot = new Panel
            {
                BackColor = Color.FromArgb(20, 181, 141),
                Location = new Point(25, 65),
                Size = new Size(8, 8),
            };
            HelperDesktopUi.RoundControl(statusDot, 4);
            Controls.Add(statusDot);

            _titleLabel = new Label
            {
                Text = "正在执行",
                Font = new Font("Microsoft YaHei UI", 13F, FontStyle.Bold),
                ForeColor = Color.FromArgb(18, 18, 18),
                BackColor = Color.Transparent,
                Location = new Point(43, 57),
                Size = new Size(398, 28),
                AutoEllipsis = true,
            };
            Controls.Add(_titleLabel);

            _detailLabel = new Label
            {
                Text = "",
                Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular),
                ForeColor = Color.FromArgb(89, 94, 99),
                BackColor = Color.Transparent,
                Location = new Point(25, 91),
                Size = new Size(420, 24),
                AutoEllipsis = true,
            };
            Controls.Add(_detailLabel);

            _percentLabel = new Label
            {
                Text = "0%",
                Font = new Font("Segoe UI", 10F, FontStyle.Bold),
                ForeColor = Color.FromArgb(5, 130, 96),
                BackColor = Color.Transparent,
                TextAlign = ContentAlignment.MiddleRight,
                Location = new Point(382, 122),
                Size = new Size(76, 22),
            };
            Controls.Add(_percentLabel);

            _progressBar = new RoundedProgressBar
            {
                Value = 0,
                Location = new Point(25, 150),
                Size = new Size(432, 10),
                Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top,
            };
            Controls.Add(_progressBar);
            _progressBar.BringToFront();

            ApplyRoundedWindow();
        }

        private void OperationProgressForm_Paint(object sender, PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var outer = new Pen(Color.FromArgb(219, 223, 226)))
            using (var divider = new Pen(Color.FromArgb(238, 240, 241)))
            using (var path = HelperDesktopUi.RoundedRectangle(new Rectangle(0, 0, ClientSize.Width - 1, ClientSize.Height - 1), 14))
            {
                e.Graphics.DrawPath(outer, path);
                e.Graphics.DrawLine(divider, 1, 40, ClientSize.Width - 2, 40);
            }
        }

        protected override CreateParams CreateParams
        {
            get
            {
                const int DropShadow = 0x00020000;
                var cp = base.CreateParams;
                cp.ClassStyle |= DropShadow;
                return cp;
            }
        }

        private void ApplyRoundedWindow()
        {
            if (Width <= 0 || Height <= 0) return;
            using (var path = HelperDesktopUi.RoundedRectangle(new Rectangle(0, 0, Width - 1, Height - 1), 14))
            {
                var old = Region;
                Region = new Region(path);
                if (old != null) old.Dispose();
            }
            Invalidate();
        }

        public void SetStep(string title, string detail, int percent)
        {
            if (!string.IsNullOrWhiteSpace(title)) _titleLabel.Text = title;
            _detailLabel.Text = detail ?? "";
            var value = Math.Max(0, Math.Min(100, percent));
            _progressBar.Value = value;
            _progressBar.Failed = false;
            _percentLabel.Text = value.ToString(CultureInfo.InvariantCulture) + "%";
            _percentLabel.ForeColor = Color.FromArgb(5, 130, 96);
        }

        public void SetCompleted(bool success, string detail)
        {
            _titleLabel.Text = success ? "任务已完成" : "任务失败";
            _detailLabel.Text = detail ?? "";
            _progressBar.Value = success ? 100 : Math.Max(6, _progressBar.Value);
            _progressBar.Failed = !success;
            _percentLabel.Text = success ? "100%" : "失败";
            _percentLabel.ForeColor = success ? Color.FromArgb(5, 130, 96) : Color.FromArgb(180, 45, 45);
        }
    }
}

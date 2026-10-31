// Meridian for Windows: double-click to open the terminal in its own window.
// Starts the local data server (node serve.mjs) without a console window, waits until it
// answers, then opens Microsoft Edge (or Chrome) in app mode with its own profile. When that
// window closes, the server it started stops too. "--lan" also serves your phone and shows
// its address. Before starting, it offers any newer version published on GitHub.
// Built by tools/install.mjs with the C# compiler that ships with Windows.
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Management;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Program
{
    const int Port = 8173;
    const string Title = "Meridian";
    const string Repo = "petarsokolov2000-creator/meridian-terminal";
    static readonly string Dir = AppDomain.CurrentDomain.BaseDirectory;
    static readonly string Profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Meridian", "profile");

    static bool ServerUp()
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Port + "/api/status");
            req.Timeout = 1500;
            req.Proxy = null;
            using (var res = (HttpWebResponse)req.GetResponse()) return res.StatusCode == HttpStatusCode.OK;
        }
        catch (Exception) { return false; }
    }

    static string FindNode()
    {
        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string d in path.Split(';'))
        {
            try
            {
                string p = Path.Combine(d.Trim().Trim('"'), "node.exe");
                if (d.Trim().Length > 0 && File.Exists(p)) return p;
            }
            catch (Exception) { /* malformed PATH entry */ }
        }
        foreach (string root in new[] { Environment.GetEnvironmentVariable("ProgramFiles"), Environment.GetEnvironmentVariable("ProgramFiles(x86)"), Environment.GetEnvironmentVariable("LocalAppData") + @"\Programs" })
        {
            if (string.IsNullOrEmpty(root)) continue;
            string p = Path.Combine(root, @"nodejs\node.exe");
            if (File.Exists(p)) return p;
        }
        return null;
    }

    static string FindBrowser(string exe)
    {
        foreach (RegistryHive hive in new[] { RegistryHive.LocalMachine, RegistryHive.CurrentUser })
        {
            try
            {
                using (RegistryKey baseKey = RegistryKey.OpenBaseKey(hive, RegistryView.Registry64))
                using (RegistryKey k = baseKey.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exe))
                {
                    string p = k == null ? null : k.GetValue(null) as string;
                    if (!string.IsNullOrEmpty(p) && File.Exists(p)) return p;
                }
            }
            catch (Exception) { /* try the next place */ }
        }
        foreach (string root in new[] { Environment.GetEnvironmentVariable("ProgramFiles(x86)"), Environment.GetEnvironmentVariable("ProgramFiles"), Environment.GetEnvironmentVariable("LocalAppData") })
        {
            if (string.IsNullOrEmpty(root)) continue;
            string p = Path.Combine(root, exe == "msedge.exe" ? @"Microsoft\Edge\Application\msedge.exe" : @"Google\Chrome\Application\chrome.exe");
            if (File.Exists(p)) return p;
        }
        return null;
    }

    // True while a browser window on Meridian's own profile folder is open.
    // (The first browser process can hand its window to another and exit early.)
    static bool WindowOpen()
    {
        try
        {
            using (var q = new ManagementObjectSearcher("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='msedge.exe' OR Name='chrome.exe'"))
            {
                foreach (ManagementObject o in q.Get())
                {
                    string cmd = o["CommandLine"] as string;
                    if (cmd == null || cmd.IndexOf(Profile, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    try
                    {
                        // Only a visible window counts: Edge can keep running in the background.
                        if (Process.GetProcessById(Convert.ToInt32(o["ProcessId"])).MainWindowHandle != IntPtr.Zero) return true;
                    }
                    catch (Exception) { /* the process just ended */ }
                }
            }
        }
        catch (Exception) { /* WMI unavailable: rely on the process handle */ }
        return false;
    }

    static string LanAddress()
    {
        try
        {
            var ip = Dns.GetHostEntry(Dns.GetHostName()).AddressList.FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(a) && !a.ToString().StartsWith("169.254."));
            return ip == null ? null : ip.ToString();
        }
        catch (Exception) { return null; }
    }

    static string LogTail(string log)
    {
        try
        {
            var lines = File.ReadAllLines(log);
            return string.Join("\n", lines.Skip(Math.Max(0, lines.Length - 8)));
        }
        catch (Exception) { return ""; }
    }

    static int RunHidden(string exe, string args, string dir, out string output)
    {
        var psi = new ProcessStartInfo(exe, args) { WorkingDirectory = dir, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        var err = new System.Text.StringBuilder();
        using (var p = Process.Start(psi))
        {
            p.ErrorDataReceived += (s, e) => { if (e.Data != null) lock (err) err.AppendLine(e.Data); };
            p.BeginErrorReadLine();
            output = p.StandardOutput.ReadToEnd();
            p.WaitForExit();
            lock (err) output += err.ToString();
            return p.ExitCode;
        }
    }

    // Stops a Meridian server that is still running (for example one left behind by an
    // earlier window): asks it to quit, then ends the node process listening on our port.
    static void StopServer()
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Port + "/api/shutdown");
            req.Method = "POST";
            req.ContentType = "application/json";
            req.Proxy = null;
            req.Timeout = 2000;
            byte[] body = System.Text.Encoding.UTF8.GetBytes("{}");
            using (var st = req.GetRequestStream()) st.Write(body, 0, body.Length);
            using (req.GetResponse()) { }
        }
        catch (Exception) { /* older servers have no shutdown route */ }
        for (int i = 0; i < 16 && ServerUp(); i++) Thread.Sleep(250);
        if (!ServerUp()) return;
        try
        {
            string output;
            RunHidden("netstat.exe", "-ano -p TCP", Dir, out output);
            foreach (string line in output.Split('\n'))
            {
                string[] f = line.Split(new[] { ' ', '\t', '\r' }, StringSplitOptions.RemoveEmptyEntries);
                int pid;
                if (f.Length >= 5 && f[1].EndsWith(":" + Port) && f[3] == "LISTENING" && int.TryParse(f[4], out pid))
                {
                    var p = Process.GetProcessById(pid);
                    if (p.ProcessName.Equals("node", StringComparison.OrdinalIgnoreCase)) p.Kill();
                }
            }
        }
        catch (Exception) { /* nothing more we can do */ }
        for (int i = 0; i < 16 && ServerUp(); i++) Thread.Sleep(250);
    }

    // Offers the newest published version. The check and download run in Node.js
    // (tools/update.mjs), which logs every attempt to .cache\update.log.
    static void CheckForUpdate(string node)
    {
        if (!File.Exists(Path.Combine(Dir, "tools", "update.mjs"))) return;
        string output;
        try { RunHidden(node, "tools\\update.mjs check", Dir, out output); }
        catch (Exception) { return; }
        string[] lines = output.Replace("\r", "").Split('\n');
        if (lines.Length < 2) return;
        string current = lines[0].Trim();
        string latest = lines[1].Trim();
        if (latest.Length == 0 || latest.StartsWith("error:") || latest == current) return; // offline or up to date
        if (MessageBox.Show("A new version of Meridian is available (" + latest + ").\n\nUpdate now? It takes about a minute. Your keys and settings stay.", Title, MessageBoxButtons.YesNo, MessageBoxIcon.Information) != DialogResult.Yes) return;
        if (ServerUp()) StopServer();
        if (ServerUp())
        {
            MessageBox.Show("Meridian is still running, so it can't be updated right now.\n\nClose every Meridian window, wait a few seconds, and open Meridian again.", Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        int code;
        try { code = RunHidden(node, "tools\\update.mjs apply", Dir, out output); }
        catch (Exception e) { code = 1; output = e.Message; }
        if (code == 0)
            MessageBox.Show("Meridian is updated to " + latest + ".", Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
        else
            MessageBox.Show("The update didn't finish, so Meridian opens with the version you have.\n\n" + output.Trim() + "\n\nDetails: " + Path.Combine(Dir, ".cache", "update.log"), Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }

    static void Fail(string msg)
    {
        MessageBox.Show(msg, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    [STAThread]
    static void Main(string[] args)
    {
        bool lan = args.Contains("--lan");
        Process server = null;
        try
        {
            if (!File.Exists(Path.Combine(Dir, "serve.mjs")))
            {
                Fail("Meridian.exe has to stay inside the meridian-terminal folder (it runs serve.mjs from there).\n\nRun \"Install Meridian.cmd\" again to rebuild it and its shortcuts.");
                return;
            }

            string node = FindNode();
            if (node == null)
            {
                if (MessageBox.Show("Meridian needs Node.js, which isn't installed.\n\nOpen nodejs.org to download it (choose the LTS version)?", Title, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                    Process.Start(new ProcessStartInfo("https://nodejs.org/") { UseShellExecute = true });
                return;
            }
            // Every start, even when a server is still running from before.
            CheckForUpdate(node);

            if (!ServerUp())
            {
                string cache = Path.Combine(Dir, ".cache");
                Directory.CreateDirectory(cache);
                string log = Path.Combine(cache, "server.log");
                var writer = new StreamWriter(log, false) { AutoFlush = true };
                var psi = new ProcessStartInfo(node, "serve.mjs" + (lan ? " --lan" : ""))
                {
                    WorkingDirectory = Dir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                server = Process.Start(psi);
                server.OutputDataReceived += (s, e) => { if (e.Data != null) lock (writer) writer.WriteLine(e.Data); };
                server.ErrorDataReceived += (s, e) => { if (e.Data != null) lock (writer) writer.WriteLine(e.Data); };
                server.BeginOutputReadLine();
                server.BeginErrorReadLine();

                var sw = Stopwatch.StartNew();
                while (!ServerUp())
                {
                    if (server.HasExited)
                    {
                        Thread.Sleep(300);
                        Fail("Meridian's server stopped while starting.\n\n" + LogTail(log) + "\n\nFull log: " + log);
                        return;
                    }
                    if (sw.Elapsed.TotalSeconds > 30)
                    {
                        Fail("Meridian's server didn't answer within 30 seconds.\n\n" + LogTail(log) + "\n\nFull log: " + log);
                        server.Kill();
                        return;
                    }
                    Thread.Sleep(250);
                }
            }
            else if (lan)
            {
                MessageBox.Show("Meridian is already running, so phone access can't be switched on now.\n\nClose the open Meridian window, then start \"Meridian (phone access)\" again.", Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
            }

            string url = "http://localhost:" + Port + "/";
            string browser = FindBrowser("msedge.exe") ?? FindBrowser("chrome.exe");
            Process window = null;
            if (browser != null)
            {
                Directory.CreateDirectory(Profile);
                string bargs = "--app=" + url + " --user-data-dir=\"" + Profile + "\" --window-size=1600,1000 --no-first-run --no-default-browser-check --disable-background-mode";
                window = Process.Start(new ProcessStartInfo(browser, bargs) { UseShellExecute = false });
            }
            else
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }

            if (lan && server != null)
            {
                string key = "";
                try { key = File.ReadAllText(Path.Combine(Dir, ".access-key")).Trim(); } catch (Exception) { }
                string ip = LanAddress();
                string phone = ip == null ? "(couldn't find this PC's Wi-Fi address — see .cache\\server.log)" : "http://" + ip + ":" + Port + "/?key=" + key;
                Clipboard.SetText(phone);
                MessageBox.Show("Open this on your phone (same Wi-Fi). It's also copied to the clipboard:\n\n" + phone + "\n\nIf the phone can't connect, allow Node.js through the Windows firewall on private networks.\n\nMeridian keeps running while this box is open. Click OK to stop it.", Title + " — phone access", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            else if (server != null)
            {
                if (window != null)
                {
                    window.WaitForExit();
                    // Keep going while any window on Meridian's profile is still open.
                    while (WindowOpen()) Thread.Sleep(2000);
                }
                else
                {
                    MessageBox.Show("Meridian is running in your browser.\n\nClick OK when you're done to stop it.", Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            }
        }
        catch (Exception e)
        {
            Fail("Meridian could not start.\n\n" + e.Message);
        }
        finally
        {
            if (server != null && !server.HasExited)
            {
                try { server.Kill(); } catch (Exception) { /* already gone */ }
            }
        }
    }
}

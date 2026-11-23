param([Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ProtocolSha256)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# This reviewed file embeds its entire C# closure. Add-Type uses the installed PS7/.NET
# platform; no compiler child, downloaded code, assembly output or application is used.
# Native compilation and dispatch require a separately reviewed, exact parent allocation.
$source = @'
using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Linq;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

public static class R20InstalledRuntimeCustody
{
    // The signed-in user's profile (known folder, from the process token, not USERPROFILE).
    static readonly string Profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    static readonly string FixtureRoot = Profile + @"\.codex\worktrees\capital-completion-v2\personal-finance-app\.local\r20-installed-component-oct28a";
    static string Root, Scenario, HashMismatchPath;
    static volatile bool EntryStarted;
    static volatile string ChildRefusal, ControlAttempt, OutputFailure;
    static volatile bool AckAllowed;
    const string Fixture = "sharp-geoip-v1";
    static readonly string Node = Profile + @"\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\capital-r00-runtime\node-v24.22.0-win-arm64\node.exe";
    static readonly string Temp = FixtureRoot + @"\native-temp";
    const string NodeSha = "df4b0e71e4e4d022bf8582fbe75f6061feb9c4a111a86f3fec6300d24b6fe5e0";
    const uint Read = 0x80000000, ShareRead = 1, OpenExisting = 3, OpenReparse = 0x00200000, Backup = 0x02000000;
    const uint Suspended = 4, UnicodeEnvironment = 0x400, ExtendedStartup = 0x80000, NoWindow = 0x08000000;
    const uint InheritFlag = 1, WaitTimeout = 258;
    static string Phase = "INPUT";
    static Exception Refuse() { return new InvalidOperationException("INSTALLED_CUSTODY_REFUSED:" + Phase); }
    static void Need(bool value) { if (!value) throw Refuse(); }

    [StructLayout(LayoutKind.Sequential)] struct Security { public int Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit; }
    [StructLayout(LayoutKind.Sequential)] struct FileInfo {
        public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Startup {
        public int Size; public string Reserved, Desktop, Title; public uint X, Y, XSize, YSize, XCount, YCount, Fill, Flags;
        public ushort Show, ReservedSize; public IntPtr ReservedPointer, Stdin, Stdout, Stderr;
    }
    [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup Startup; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
    [StructLayout(LayoutKind.Sequential)] struct JobBasic {
        public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWorking, MaxWorking; public uint ActiveLimit;
        public UIntPtr Affinity; public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct JobExtended {
        public JobBasic Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern SafeFileHandle CreateFileW(string name, uint access, uint share, ref Security security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInfo info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle file, StringBuilder path, uint length, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetFilePointerEx(SafeFileHandle file, long distance, out long position, uint method);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out SafeFileHandle read, out SafeFileHandle write, ref Security security, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(SafeFileHandle handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr length, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string app, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string directory, ref StartupEx startup, out ProcessInfo info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObjectW(IntPtr security, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref JobExtended info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, [MarshalAs(UnmanagedType.Bool)] out bool assigned);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr value, uint timeout);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("psapi.dll", SetLastError = true)] static extern bool EnumProcessModulesEx(IntPtr process, IntPtr[] modules, uint size, out uint needed, uint filter);
    [DllImport("psapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern uint GetModuleFileNameExW(IntPtr process, IntPtr module, StringBuilder path, uint size);

    sealed class Pin { public string Name, Hash; public long Size; public bool Directory; }
    sealed class Held { public Pin Pin; public SafeFileHandle Handle; public FileInfo Info; }
    static string Hex(byte[] bytes) { return Convert.ToHexString(bytes).ToLowerInvariant(); }
    static string Digest(string text) { return Hex(SHA256.HashData(Encoding.UTF8.GetBytes(text))); }
    static void Keys(JsonElement item, params string[] names) {
        Need(item.ValueKind == JsonValueKind.Object && item.EnumerateObject().Select(p => p.Name).OrderBy(s => s, StringComparer.Ordinal).SequenceEqual(names.OrderBy(s => s, StringComparer.Ordinal)));
    }
    static string Text(JsonElement item, string key) { Need(item.GetProperty(key).ValueKind == JsonValueKind.String); return item.GetProperty(key).GetString(); }
    static string Relative(string value) {
        Need(value.Length > 0 && value.Length <= 1024 && System.Text.RegularExpressions.Regex.IsMatch(value, "^[A-Za-z0-9@._/-]+$") &&
            value.Split('/').All(part => part.Length > 0 && part != "." && part != ".."));
        string full = Path.Combine(Root, value.Replace('/', '\\'));
        Need(Path.GetFullPath(full) == full && full.StartsWith(Root + "\\", StringComparison.Ordinal)); return full;
    }
    static Pin PinRow(JsonElement item) {
        Keys(item, "relativePath", "size", "sha256", "assetKind"); string name = Text(item, "relativePath"), hash = Text(item, "sha256");
        long size = item.GetProperty("size").GetInt64(); Need(size >= 0 && size <= 100 * 1024 * 1024 && System.Text.RegularExpressions.Regex.IsMatch(hash, "^[a-f0-9]{64}$"));
        Need(new[] { "module", "commonjs", "json", "native-addon", "native-dll", "wasm", "opaque", "data" }.Contains(Text(item, "assetKind"), StringComparer.Ordinal));
        return new Pin { Name = Relative(name), Size = size, Hash = hash };
    }
    static List<Pin> Protocol(string text, string expected) {
        Need(text.Length > 0 && Encoding.UTF8.GetByteCount(text) <= 16 * 1024 * 1024 && Digest(text) == expected);
        using (JsonDocument document = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 8 })) {
            JsonElement value = document.RootElement;
            Keys(value, "kind", "version", "componentId", "scenario", "stageRoot", "entryRelativePath", "componentEntryRelativePath", "treeSha256", "rootInventorySha256", "profileManifestSha256", "buildCommitSha", "harnessCommitSha", "nativeDataSha256", "runtime", "files", "directories", "absencePaths");
            Scenario = Text(value, "scenario"); Need(new[] { "normal", "timeout", "supervisor-loss", "preexisting-writer", "unknown-member", "unknown-module", "unknown-data", "native-substitution", "digest-drift" }.Contains(Scenario, StringComparer.Ordinal));
            Root = FixtureRoot + "\\cases\\" + Scenario + "\\stage";
            Need(Text(value, "kind") == "pfa-installed-component-loading" && value.GetProperty("version").GetInt32() == 1 && Text(value, "componentId") == Fixture && Text(value, "stageRoot") == Root &&
                Text(value, "entryRelativePath") == "dist/index.js" && Text(value, "componentEntryRelativePath") == ".runtime/runtime-installed-component.mjs");
            foreach (string field in new[] { "treeSha256", "rootInventorySha256", "profileManifestSha256", "nativeDataSha256" }) Need(System.Text.RegularExpressions.Regex.IsMatch(Text(value, field), "^[a-f0-9]{64}$"));
            foreach (string field in new[] { "buildCommitSha", "harnessCommitSha" }) Need(System.Text.RegularExpressions.Regex.IsMatch(Text(value, field), "^[a-f0-9]{40}$"));
            JsonElement runtime = value.GetProperty("runtime"); Keys(runtime, "executable", "version", "platform", "arch");
            Need(Text(runtime, "version") == "24.22.0" && Text(runtime, "platform") == "win32" && Text(runtime, "arch") == "arm64");
            JsonElement executable = runtime.GetProperty("executable"); Keys(executable, "path", "size", "sha256");
            Need(Text(executable, "path") == Node && executable.GetProperty("size").GetInt64() == 82123080 && Text(executable, "sha256") == NodeSha);
            var files = value.GetProperty("files"); Need(files.ValueKind == JsonValueKind.Array && files.GetArrayLength() >= 10 && files.GetArrayLength() <= 40000);
            var pins = new List<Pin>(); string previous = ""; long total = 0;
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (JsonElement file in files.EnumerateArray()) {
                string relative = Text(file, "relativePath"); Need(String.CompareOrdinal(relative, previous) > 0 && names.Add(relative)); previous = relative;
                Pin pin = PinRow(file); total += pin.Size; Need(total <= 1013L * 1024 * 1024); pins.Add(pin);
            }
            foreach (string name in new[] { "dist/index.js", "package.json", "package-lock.json", ".runtime/runtime-installed-bootstrap.mjs", ".runtime/runtime-installed-component.mjs", ".runtime/runtime-installed-loading.mjs", ".runtime/runtime-installed-data.mjs", "node_modules/@img/sharp-win32-arm64/lib/sharp-win32-arm64-0.35.5.node", "node_modules/@img/sharp-win32-arm64/lib/libvips-42.dll", "node_modules/@img/sharp-win32-arm64/lib/libvips-cpp-8.18.7.dll" }) Need(names.Contains(name));
            var declared = value.GetProperty("directories"); Need(declared.ValueKind == JsonValueKind.Array && declared.GetArrayLength() <= 30000); previous = "";
            var declaredDirectories = new List<string>();
            foreach (JsonElement directory in declared.EnumerateArray()) { string name = directory.GetString(); Need(String.CompareOrdinal(name, previous) > 0 && names.Add(name)); previous = name; declaredDirectories.Add(Relative(name)); }
            var absent = value.GetProperty("absencePaths"); Need(absent.ValueKind == JsonValueKind.Array && absent.GetArrayLength() >= 2 && absent.GetArrayLength() <= 512); previous = "";
            foreach (JsonElement item in absent.EnumerateArray()) { string name = item.GetString(); Need(String.CompareOrdinal(name, previous) > 0 && !names.Contains(name)); previous = name; Need(!File.Exists(Relative(name)) && !Directory.Exists(Relative(name))); }
            pins.Add(new Pin { Name = Node, Size = 82123080, Hash = NodeSha });
            var directories = new HashSet<string>(StringComparer.Ordinal);
            foreach (string directory in declaredDirectories) directories.Add(directory);
            foreach (Pin pin in pins) { string parent = Path.GetDirectoryName(pin.Name); while (parent != null) { directories.Add(parent); parent = Path.GetDirectoryName(parent); } }
            pins.InsertRange(0, directories.OrderBy(s => s.Length).ThenBy(s => s, StringComparer.Ordinal).Select(name => new Pin { Name = name, Directory = true }));
            Need(pins.Count <= 70000); return pins;
        }
    }
    static string FinalName(SafeFileHandle handle) {
        var value = new StringBuilder(2048); uint count = GetFinalPathNameByHandleW(handle, value, (uint)value.Capacity, 0);
        Need(count > 0 && count < value.Capacity && value.ToString().StartsWith(@"\\?\", StringComparison.Ordinal)); return value.ToString().Substring(4);
    }
    static void Verify(Held held) {
        FileInfo current; Need(GetFileInformationByHandle(held.Handle, out current));
        Need((current.Attributes & 0x400) == 0 && ((current.Attributes & 16) != 0) == held.Pin.Directory && FinalName(held.Handle) == held.Pin.Name);
        Need(current.Volume == held.Info.Volume && current.IndexHigh == held.Info.IndexHigh && current.IndexLow == held.Info.IndexLow &&
            current.Attributes == held.Info.Attributes && current.Creation.dwHighDateTime == held.Info.Creation.dwHighDateTime && current.Creation.dwLowDateTime == held.Info.Creation.dwLowDateTime);
        if (!held.Pin.Directory) {
            Need(current.Links == 1 && (((long)current.SizeHigh << 32) | current.SizeLow) == held.Pin.Size);
            long position; Need(SetFilePointerEx(held.Handle, 0, out position, 0) && position == 0);
            using (var alias = new SafeFileHandle(held.Handle.DangerousGetHandle(), false))
            using (var stream = new FileStream(alias, FileAccess.Read, 65536, false)) {
                if (Hex(SHA256.HashData(stream)) != held.Pin.Hash) { HashMismatchPath = held.Pin.Name; Phase = "FILE_HASH"; throw Refuse(); }
            }
            Need(GetFileInformationByHandle(held.Handle, out current) && current.Write.dwHighDateTime == held.Info.Write.dwHighDateTime && current.Write.dwLowDateTime == held.Info.Write.dwLowDateTime);
        }
    }
    static Held Acquire(Pin pin) {
        var security = new Security { Length = Marshal.SizeOf<Security>(), Inherit = true };
        SafeFileHandle handle = CreateFileW(pin.Name, pin.Directory ? 0x80u : Read, ShareRead, ref security, OpenExisting, OpenReparse | (pin.Directory ? Backup : 0), IntPtr.Zero);
        if (handle.IsInvalid) {
            int error = Marshal.GetLastWin32Error(); handle.Dispose();
            if (Scenario == "preexisting-writer" && pin.Name == Root + "\\.runtime\\runtime-installed-component.mjs" && error == 32) Phase = "PREEXISTING_WRITER";
            throw Refuse();
        }
        try {
            FileInfo info; Need(GetFileInformationByHandle(handle, out info));
            var held = new Held { Pin = pin, Handle = handle, Info = info }; Verify(held); return held;
        } catch { handle.Dispose(); throw; }
    }
    static void ExactMembers(List<Pin> pins) {
        var expectedFiles = new HashSet<string>(pins.Where(p => !p.Directory && p.Name.StartsWith(Root + "\\", StringComparison.Ordinal)).Select(p => p.Name), StringComparer.Ordinal);
        var expectedDirs = new HashSet<string>(pins.Where(p => p.Directory && (p.Name == Root || p.Name.StartsWith(Root + "\\", StringComparison.Ordinal))).Select(p => p.Name), StringComparer.Ordinal);
        var queue = new Queue<string>(); queue.Enqueue(Root); int count = 0;
        while (queue.Count > 0) {
            string directory = queue.Dequeue(); Need(expectedDirs.Contains(directory));
            foreach (string name in Directory.EnumerateFileSystemEntries(directory)) {
                Need(++count <= 70000 && (File.GetAttributes(name) & FileAttributes.ReparsePoint) == 0);
                if (Directory.Exists(name)) {
                    if (!expectedDirs.Contains(name)) { Phase = "UNKNOWN_MEMBER"; throw Refuse(); }
                    queue.Enqueue(name);
                } else if (!expectedFiles.Contains(name)) { Phase = "UNKNOWN_MEMBER"; throw Refuse(); }
            }
        }
    }
    static string Output(SafeFileHandle handle) {
        using (var stream = new FileStream(handle, FileAccess.Read, 4096, false)) {
            var bytes = new byte[4096]; int count, index = 0; var line = new StringBuilder();
            string[] expected = { "R20_INSTALLED_HOOKS:" + Fixture, "R20_INSTALLED_READS:3:1", "R20_INSTALLED_READY:" + Fixture, "R20_INSTALLED_COMPLETE:" + Fixture };
            using (var output = new MemoryStream()) {
                void Bad(string reason) { OutputFailure = OutputFailure ?? reason; }
                void Record(string current) {
                    if (OutputFailure != null) return;
                    if (current.StartsWith("(node:", StringComparison.Ordinal) && current.Contains("SecurityWarning: The flag --allow-addons", StringComparison.Ordinal) ||
                        current.StartsWith("(Use `node --trace-warnings", StringComparison.Ordinal)) {
                        Console.WriteLine("R20_CHILD_WARNING:" + current); return;
                    }
                    if (current.StartsWith("INSTALLED_LOADING_REFUSED:", StringComparison.Ordinal)) {
                        string phase = current.Substring("INSTALLED_LOADING_REFUSED:".Length);
                        if (ChildRefusal != null || index != 1 || !System.Text.RegularExpressions.Regex.IsMatch(phase, "^[A-Z_]{1,64}$")) { Bad("REFUSAL_ORDER"); return; }
                        ChildRefusal = phase; Console.WriteLine("R20_CHILD_EVENT:" + current); return;
                    }
                    if (current.StartsWith("R20_INSTALLED_CONTROL:", StringComparison.Ordinal)) {
                        string phase = current.Substring("R20_INSTALLED_CONTROL:".Length);
                        if (ControlAttempt != null || index != 1 || phase != ExpectedRefusal()) { Bad("CONTROL"); return; }
                        ControlAttempt = phase; Console.WriteLine("R20_CHILD_EVENT:" + current); return;
                    }
                    if (index >= expected.Length || current != expected[index]) { Bad("EVENT_ORDER"); return; }
                    if (index == 2) EntryStarted = true;
                    Console.WriteLine("R20_CHILD_EVENT:" + current); index++; Console.Out.Flush();
                }
                while (true) {
                    try { count = stream.Read(bytes, 0, bytes.Length); } catch { Bad("PIPE_IO"); break; }
                    if (count == 0) break;
                    int remaining = 65536 - (int)output.Length;
                    output.Write(bytes, 0, Math.Min(count, remaining));
                    if (count > remaining) Bad("OVERFLOW");
                    for (int i = 0; i < count; i++) {
                        byte value = bytes[i];
                        if (value == 13) continue;
                        if (value == 10) {
                            string current = line.ToString(); line.Clear();
                            Record(current);
                        } else {
                            if (value < 32 || value > 126) Bad("BYTE");
                            if (line.Length >= 1024) Bad("LINE"); else line.Append((char)value);
                        }
                    }
                }
                if (line.Length != 0) Bad("TRAILING_LINE");
                byte[] captured = output.ToArray();
                // Preserve the bounded original byte prefix even for invalid UTF-8, malformed
                // events or an early bootstrap refusal. Never render child bytes as instructions.
                Console.WriteLine("R20_CHILD_RAW_BASE64:" + Convert.ToBase64String(captured));
                if (OutputFailure != null) { Console.WriteLine("R20_CHILD_OUTPUT_FAILURE:" + OutputFailure); throw new InvalidOperationException("INSTALLED_CUSTODY_REFUSED:OUTPUT"); }
                return Encoding.ASCII.GetString(captured);
            }
        }
    }
    static void Send(SafeFileHandle handle, string text, System.Threading.ManualResetEventSlim signal) {
        using (var stream = new FileStream(handle, FileAccess.Write, 65536, false)) {
            byte[] bytes = Encoding.UTF8.GetBytes(text + "\n"); stream.Write(bytes, 0, bytes.Length); stream.Flush();
            // These refusal controls have no ACK; EOF lets the refused Node child exit.
            if (Scenario == "unknown-module" || Scenario == "unknown-data" || Scenario == "native-substitution") return;
            Need(signal.Wait(65000));
            if (AckAllowed) { bytes = Encoding.UTF8.GetBytes("R20_INSTALLED_ACK:" + Fixture + "\n"); stream.Write(bytes, 0, bytes.Length); stream.Flush(); }
        }
    }
    static string ExpectedRefusal() { return Scenario == "unknown-module" ? "MODULE_PATH" : Scenario == "unknown-data" ? "DATA_PATH" : Scenario == "native-substitution" ? "NATIVE_PATH" : null; }
    static void WriterRefused(string relative) {
        var security = new Security { Length = Marshal.SizeOf<Security>(), Inherit = false };
        using (SafeFileHandle writer = CreateFileW(Relative(relative), 0x40000000, 7, ref security, OpenExisting, OpenReparse, IntPtr.Zero)) {
            Need(writer.IsInvalid && Marshal.GetLastWin32Error() == 32);
        }
        Console.WriteLine("R20_INSTALLED_WRITER_REFUSED:" + relative); Console.Out.Flush();
    }
    static void MappedModules(IntPtr process) {
        var modules = new IntPtr[512]; uint needed;
        Need(EnumProcessModulesEx(process, modules, (uint)(modules.Length * IntPtr.Size), out needed, 3) && needed > 0 && needed <= modules.Length * IntPtr.Size && needed % IntPtr.Size == 0);
        string[] selected = { "sharp-win32-arm64-0.35.5.node", "libvips-42.dll", "libvips-cpp-8.18.7.dll" };
        var observed = new HashSet<string>(StringComparer.Ordinal); bool node = false;
        for (int i = 0; i < needed / IntPtr.Size; i++) {
            var name = new StringBuilder(2048); uint count = GetModuleFileNameExW(process, modules[i], name, (uint)name.Capacity); Need(count > 0 && count < name.Capacity);
            string full = name.ToString(); if (full.StartsWith(@"\\?\", StringComparison.Ordinal)) full = full.Substring(4);
            string leaf = Path.GetFileName(full);
            string selectedName = selected.SingleOrDefault(value => String.Equals(value, leaf, StringComparison.OrdinalIgnoreCase));
            if (selectedName != null) {
                Need(full == Root + @"\node_modules\@img\sharp-win32-arm64\lib\" + selectedName && observed.Add(selectedName));
                Console.WriteLine("R20_INSTALLED_NATIVE_PATH:" + full);
            } else if (full == Node) node = true;
            else Need(full.StartsWith(@"C:\WINDOWS\", StringComparison.OrdinalIgnoreCase)); // Explicit trusted Windows platform base, not a closed native sandbox.
        }
        Need(node && observed.Count == 3); Console.Out.Flush();
    }
    public static int Run(string text, string expected) {
        var held = new List<Held>(); SafeFileHandle childIn = null, parentIn = null, parentOut = null, childOut = null;
        IntPtr job = IntPtr.Zero, list = IntPtr.Zero, handleList = IntPtr.Zero, jobList = IntPtr.Zero, environment = IntPtr.Zero; ProcessInfo process = default;
        bool assigned = false, exited = false, listReady = false; int result = 1;
        var inputSignal = new System.Threading.ManualResetEventSlim(false);
        Task<string> output = null; Task input = null; string refusalPhase = null;
        try {
            Need(RuntimeInformation.IsOSPlatform(OSPlatform.Windows) && RuntimeInformation.ProcessArchitecture == Architecture.Arm64);
            Need(Environment.Version.ToString() == "10.0.12" && Marshal.SizeOf<Security>() == 24 && Marshal.SizeOf<FileInfo>() == 52 &&
                Marshal.SizeOf<Startup>() == 104 && Marshal.SizeOf<StartupEx>() == 112 && Marshal.SizeOf<ProcessInfo>() == 24 &&
                Marshal.SizeOf<JobBasic>() == 64 && Marshal.SizeOf<IoCounters>() == 48 && Marshal.SizeOf<JobExtended>() == 144);
            Need(Directory.Exists(Temp) && (File.GetAttributes(Temp) & FileAttributes.ReparsePoint) == 0);
            List<Pin> pins = Protocol(text, expected);
            Phase = "CUSTODY"; foreach (Pin pin in pins) held.Add(Acquire(pin));
            Phase = "MEMBERSHIP"; ExactMembers(pins); foreach (Held item in held) Verify(item);
            Phase = "EXPECTED_REFUSAL"; Need(Scenario != "preexisting-writer" && Scenario != "unknown-member");
            Phase = "PIPES";
            var security = new Security { Length = Marshal.SizeOf<Security>(), Inherit = true };
            Need(CreatePipe(out childIn, out parentIn, ref security, 131072) && CreatePipe(out parentOut, out childOut, ref security, 131072));
            Need(SetHandleInformation(parentIn, InheritFlag, 0) && SetHandleInformation(parentOut, InheritFlag, 0));
            Phase = "JOB"; job = CreateJobObjectW(IntPtr.Zero, null); Need(job != IntPtr.Zero);
            var limits = new JobExtended { Basic = new JobBasic { Flags = 0x2000, ActiveLimit = 0 } }; // KILL_ON_JOB_CLOSE; no breakaway flags.
            Need(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<JobExtended>()));
            Phase = "INHERITANCE";
            IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size); Need(size.ToInt64() > 0 && size.ToInt64() < 65536);
            list = Marshal.AllocHGlobal(size); Need(InitializeProcThreadAttributeList(list, 2, 0, ref size)); listReady = true;
            var handles = held.Select(item => item.Handle.DangerousGetHandle()).Concat(new[] { childIn.DangerousGetHandle(), childOut.DangerousGetHandle() }).ToArray();
            handleList = Marshal.AllocHGlobal(handles.Length * IntPtr.Size); Marshal.Copy(handles, 0, handleList, handles.Length);
            Need(UpdateProcThreadAttribute(list, 0, new IntPtr(0x20002), handleList, new IntPtr(handles.Length * IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
            // Windows10+ JOB_LIST assigns at creation, closing the suspended-orphan gap
            // between CreateProcess and a later AssignProcessToJobObject call.
            jobList = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobList, job);
            Need(UpdateProcThreadAttribute(list, 0, new IntPtr(0x2000d), jobList, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
            var startup = new StartupEx { Startup = new Startup { Size = Marshal.SizeOf<StartupEx>(), Flags = 0x100,
                Stdin = childIn.DangerousGetHandle(), Stdout = childOut.DangerousGetHandle(), Stderr = childOut.DangerousGetHandle() }, Attributes = list };
            string env = "SystemRoot=C:\\WINDOWS\0TEMP=" + Temp + "\0TMP=" + Temp + "\0TZ=UTC\0\0"; environment = Marshal.StringToHGlobalUni(env);
            var command = new StringBuilder("\"" + Node + "\" --permission \"--allow-fs-read=" + Root + "\" --allow-addons \"" + Root + "\\.runtime\\runtime-installed-bootstrap.mjs\" " + expected);
            Phase = "CREATE_SUSPENDED";
            Need(CreateProcessW(Node, command, IntPtr.Zero, IntPtr.Zero, true, Suspended | UnicodeEnvironment | ExtendedStartup | NoWindow, environment, Root, ref startup, out process));
            assigned = true; // Successful creation includes atomic JOB_LIST membership.
            childIn.Dispose(); childIn = null; childOut.Dispose(); childOut = null;
            Phase = "VERIFY_JOB"; bool inJob; Need(IsProcessInJob(process.Process, job, out inJob) && inJob);
            foreach (Held item in held) Verify(item); ExactMembers(pins);
            Console.WriteLine("R20_INSTALLED_CHILD_PID:" + Scenario + ":" + process.ProcessId); Console.Out.Flush();
            Phase = "RESUME"; Need(ResumeThread(process.Thread) == 1);
            Phase = "WAIT";
            output = Task.Run(() => Output(parentOut)); input = Task.Run(() => Send(parentIn, text, inputSignal));
            var watch = System.Diagnostics.Stopwatch.StartNew(); bool mapped = false; long readyAt = 0; uint wait;
            do {
                wait = WaitForSingleObject(process.Process, 50);
                if (OutputFailure != null) { Phase = "OUTPUT"; throw Refuse(); }
                if (EntryStarted && !mapped) {
                    Phase = "MAPPED_MODULES"; MappedModules(process.Process);
                    Phase = "WRITER_CONTROLS";
                    foreach (string name in new[] { ".runtime/runtime-installed-component.mjs", "node_modules/fast-geoip/data/index.json", "node_modules/@img/sharp-win32-arm64/lib/sharp-win32-arm64-0.35.5.node", "node_modules/@img/sharp-win32-arm64/lib/libvips-42.dll", "node_modules/@img/sharp-win32-arm64/lib/libvips-cpp-8.18.7.dll" }) WriterRefused(name);
                    mapped = true; readyAt = watch.ElapsedMilliseconds;
                    if (Scenario != "timeout" && Scenario != "supervisor-loss") { AckAllowed = true; inputSignal.Set(); }
                }
                if (output.IsFaulted) { Phase = "OUTPUT"; throw output.Exception; }
                if (input.IsFaulted) { Phase = "INPUT_PIPE"; throw input.Exception; }
                if (Scenario == "timeout" && mapped && watch.ElapsedMilliseconds - readyAt >= 1000) break;
            } while (wait == WaitTimeout && watch.ElapsedMilliseconds < 60000);
            if (wait == WaitTimeout) {
                Phase = "TIMEOUT"; Need(TerminateJobObject(job, 125)); Need(WaitForSingleObject(process.Process, 5000) == 0); exited = true;
                inputSignal.Set();
                Need(Task.WaitAll(new Task[] { output, input }, 5000));
                Phase = "TIMEOUT_BEFORE_ENTRY"; Need(Scenario == "timeout" && EntryStarted && mapped && ChildRefusal == null);
            } else {
                Need(wait == 0); exited = true; inputSignal.Set(); Need(Task.WaitAll(new Task[] { output, input }, 5000));
                Phase = "CHILD_RESULT"; uint code = uint.MaxValue; Need(Scenario != "timeout" && GetExitCodeProcess(process.Process, out code));
                bool negative = new[] { "unknown-module", "unknown-data", "native-substitution" }.Contains(Scenario, StringComparer.Ordinal);
                if (negative) Need(code == 1 && ChildRefusal == ExpectedRefusal() && ControlAttempt == ExpectedRefusal() && !EntryStarted && !mapped);
                else Need(code == 0 && ChildRefusal == null && EntryStarted && mapped && output.Result.Contains("R20_INSTALLED_COMPLETE:" + Fixture, StringComparison.Ordinal));
            }
            Phase = "POST"; ExactMembers(pins); foreach (Held item in held) Verify(item);
            Console.WriteLine(Scenario == "timeout" ? "R20_INSTALLED_TIMEOUT_CHILD_TERMINATED:" + Fixture : ChildRefusal != null ? "R20_INSTALLED_EXPECTED_REFUSAL:" + Scenario + ":" + ChildRefusal : "R20_INSTALLED_CUSTODY_COMPLETE:" + Fixture); result = 0;
        } catch (Exception error) {
            if (process.Process == IntPtr.Zero && Scenario == "preexisting-writer" && Phase == "PREEXISTING_WRITER") {
                Console.WriteLine("R20_INSTALLED_PREEXISTING_WRITER_REFUSED:" + Fixture); result = 0;
            } else if (process.Process == IntPtr.Zero && Scenario == "unknown-member" && Phase == "UNKNOWN_MEMBER") {
                Console.WriteLine("R20_INSTALLED_UNKNOWN_MEMBER_REFUSED:" + Fixture); result = 0;
            } else if (process.Process == IntPtr.Zero && Scenario == "digest-drift" && Phase == "FILE_HASH" && HashMismatchPath == Root + "\\.runtime\\runtime-installed-component.mjs") {
                Console.WriteLine("R20_INSTALLED_DIGEST_DRIFT_REFUSED:" + Fixture); result = 0;
            } else {
                if (error is AggregateException aggregate && aggregate.Flatten().InnerExceptions.Any(item => item.Message == "INSTALLED_CUSTODY_REFUSED:OUTPUT")) Phase = "OUTPUT";
                refusalPhase = Phase;
            }
        }
        finally {
            inputSignal.Set();
            // Job closure terminates a running assigned child. The child's inherited custody
            // handles remain alive through its own exit even if this supervisor dies here.
            if (process.Process != IntPtr.Zero && !exited) {
                if (assigned) TerminateJobObject(job, 126); else TerminateProcess(process.Process, 126);
                if (WaitForSingleObject(process.Process, 5000) != 0) { Console.Error.WriteLine("INSTALLED_CUSTODY_REFUSED:TERMINATION_WAIT"); result = 1; }
            }
            // Observe/drain every pipe task after the child's waited termination and before
            // disposing its parent pipe handles. Preserve the original failure phase.
            var tasks = new Task[] { output, input }.Where(task => task != null).ToArray();
            if (tasks.Length > 0) {
                try { if (!Task.WaitAll(tasks, 5000)) { Console.Error.WriteLine("INSTALLED_CUSTODY_CLEANUP_REFUSED:TASK_TIMEOUT"); result = 1; refusalPhase = refusalPhase ?? "TASK_DRAIN"; } }
                catch { Console.Error.WriteLine("INSTALLED_CUSTODY_CLEANUP_REFUSED:TASKS"); result = 1; refusalPhase = refusalPhase ?? "TASK_DRAIN"; }
            }
            if (job != IntPtr.Zero && !CloseHandle(job)) result = 1;
            childIn?.Dispose(); parentIn?.Dispose(); parentOut?.Dispose(); childOut?.Dispose();
            if (process.Thread != IntPtr.Zero && !CloseHandle(process.Thread)) result = 1;
            if (process.Process != IntPtr.Zero && !CloseHandle(process.Process)) result = 1;
            if (listReady) DeleteProcThreadAttributeList(list);
            if (list != IntPtr.Zero) Marshal.FreeHGlobal(list);
            if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
            if (jobList != IntPtr.Zero) Marshal.FreeHGlobal(jobList);
            if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
            foreach (Held item in held) item.Handle.Dispose();
            if (refusalPhase != null) Console.Error.WriteLine("INSTALLED_CUSTODY_REFUSED:" + refusalPhase);
        }
        return result;
    }
}
'@
$phase = 'HOST'
try {
    if ($PSVersionTable.PSEdition -ne 'Core' -or $PSVersionTable.PSVersion.ToString() -ne '7.6.6') { throw 'host' }
    [Console]::InputEncoding = [Text.UTF8Encoding]::new($false, $true)
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false, $true)
    # Bounded read before compilation; never ReadToEnd on a caller-controlled stream.
    $phase = 'INPUT'
    $builder = [Text.StringBuilder]::new()
    $buffer = [char[]]::new(4096)
    while (($count = [Console]::In.Read($buffer, 0, $buffer.Length)) -gt 0) {
        if ($builder.Length + $count -gt 16777216) { throw 'input' }
        [void]$builder.Append($buffer, 0, $count)
    }
    $phase = 'COMPILE'
    Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop
    exit [R20InstalledRuntimeCustody]::Run($builder.ToString(), $ProtocolSha256)
} catch {
    [Console]::Error.WriteLine("INSTALLED_CUSTODY_REFUSED:$phase")
    exit 1
}

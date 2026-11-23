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

public static class R20RuntimeCustody
{
    // The signed-in user's profile (known folder, from the process token, not USERPROFILE).
    static readonly string Profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    static readonly string FixtureRoot = Profile + @"\.codex\worktrees\capital-completion-v2\personal-finance-app\.local\r20-stage-native-oct28a";
    static string Root, Scenario;
    static volatile bool EntryStarted;
    const string Fixture = "r20stage20261028a1";
    static readonly string Node = Profile + @"\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\capital-r00-runtime\node-v24.22.0-win-arm64\node.exe";
    static readonly string Temp = Profile + @"\.codex\worktrees\capital-completion-v2\personal-finance-app\.local\r20-staged-boundary-oct28\native-temp";
    const string NodeSha = "df4b0e71e4e4d022bf8582fbe75f6061feb9c4a111a86f3fec6300d24b6fe5e0";
    const uint Read = 0x80000000, ShareRead = 1, OpenExisting = 3, OpenReparse = 0x00200000, Backup = 0x02000000;
    const uint Suspended = 4, UnicodeEnvironment = 0x400, ExtendedStartup = 0x80000, NoWindow = 0x08000000;
    const uint InheritFlag = 1, WaitTimeout = 258;
    static string Phase = "INPUT";
    static Exception Refuse() { return new InvalidOperationException("RUNTIME_CUSTODY_REFUSED:" + Phase); }
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

    sealed class Pin { public string Name, Hash; public long Size; public bool Directory; }
    sealed class Held { public Pin Pin; public SafeFileHandle Handle; public FileInfo Info; }
    static string Hex(byte[] bytes) { return Convert.ToHexString(bytes).ToLowerInvariant(); }
    static string Digest(string text) { return Hex(SHA256.HashData(Encoding.UTF8.GetBytes(text))); }
    static void Keys(JsonElement item, params string[] names) {
        Need(item.ValueKind == JsonValueKind.Object && item.EnumerateObject().Select(p => p.Name).OrderBy(s => s, StringComparer.Ordinal).SequenceEqual(names.OrderBy(s => s, StringComparer.Ordinal)));
    }
    static string Text(JsonElement item, string key) { Need(item.GetProperty(key).ValueKind == JsonValueKind.String); return item.GetProperty(key).GetString(); }
    static Pin PinRow(JsonElement item, string name, long size, string hash) {
        Keys(item, "relativePath", "size", "sha256"); Need(Text(item, "relativePath") == name && item.GetProperty("size").GetInt64() == size && Text(item, "sha256") == hash);
        return new Pin { Name = Path.Combine(Root, name.Replace('/', '\\')), Size = size, Hash = hash };
    }
    static List<Pin> Protocol(string text, string expected) {
        Need(text.Length > 0 && Encoding.UTF8.GetByteCount(text) <= 65536 && Digest(text) == expected);
        using (JsonDocument document = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 8 })) {
            JsonElement value = document.RootElement;
            Keys(value, "kind", "version", "fixtureId", "scenario", "stageRoot", "treeSha256", "runtime", "files", "harness");
            Scenario = Text(value, "scenario"); Need(new[] { "normal", "timeout", "supervisor-loss", "preexisting-writer", "unknown-member" }.Contains(Scenario, StringComparer.Ordinal));
            Root = FixtureRoot + "\\cases\\" + Scenario + "\\stage";
            Need(Text(value, "kind") == "pfa-inert-runtime-boundary" && value.GetProperty("version").GetInt32() == 1 && Text(value, "fixtureId") == Fixture && Text(value, "stageRoot") == Root);
            Need(System.Text.RegularExpressions.Regex.IsMatch(Text(value, "treeSha256"), "^[a-f0-9]{64}$"));
            JsonElement runtime = value.GetProperty("runtime"); Keys(runtime, "executable", "version", "platform", "arch");
            Need(Text(runtime, "version") == "24.22.0" && Text(runtime, "platform") == "win32" && Text(runtime, "arch") == "arm64");
            JsonElement executable = runtime.GetProperty("executable"); Keys(executable, "path", "size", "sha256");
            Need(Text(executable, "path") == Node && executable.GetProperty("size").GetInt64() == 82123080 && Text(executable, "sha256") == NodeSha);
            var expectedFiles = new (string, long, string)[] {
                ("dist/index.js",689,"f0e33a3d436953861d5de6897633d7f0f8e7d35877a84db34e470bab04a1df78"),
                ("dist/public/assets/app.js",31,"06c3033ebc45d006ef09c440a921bbdf85f86fa78eb78ac9a79a3907805cb86b"),
                ("dist/public/index.html",48,"bdb041f3130368e95224a28aaf67a230938543f863ef1b8a7e6d917b5c455fe8"),
                ("node_modules/fixture-pkg/data.json",14,"7df4c3a5d2d577e3d08a941a2c77ba83defcee03618320b2e3643854336df3e4"),
                ("node_modules/fixture-pkg/dynamic.js",27,"b61553b80ac638fc68709ca31f4df721ce7db961b534ef7a9196c0b931ded426"),
                ("node_modules/fixture-pkg/import.js",22,"83150b69e16b97602705c30bb9a9514bc7bc65a6eca5dc3b731de700c6262a01"),
                ("node_modules/fixture-pkg/package.json",179,"f3d4ffccdf0f9c1449eb91c0d08d9ebd483c484f019e3738b7d4a068d971e58b"),
                ("node_modules/fixture-pkg/require.cjs",24,"450213e9467961bbf4b0ae315e48ff02167788b407581f01f125765833ef5f32"),
                ("package-lock.json",171,"3afd85618e2211525024d31cce10ba1530fd7d5e71d31cc5ffda72afa7dec900"),
                ("package.json",102,"58874ffc1c4aab1e119aa00672f32948c1c6dc5bce883052b6a281707a212bfc")
            };
            var files = value.GetProperty("files"); Need(files.ValueKind == JsonValueKind.Array && files.GetArrayLength() == expectedFiles.Length);
            var pins = new List<Pin>(); int index = 0;
            foreach (JsonElement file in files.EnumerateArray()) { var pin = expectedFiles[index++]; pins.Add(PinRow(file, pin.Item1, pin.Item2, pin.Item3)); }
            var harness = value.GetProperty("harness"); Need(harness.ValueKind == JsonValueKind.Array && harness.GetArrayLength() == 2);
            pins.Add(PinRow(harness[0], ".runtime/runtime-bootstrap.mjs",1017,"9526e81adfe0a1d08436d7dfdd7dee388ad27b5fc75d758da9e20586ee217aaa"));
            pins.Add(PinRow(harness[1], ".runtime/runtime-enforcement.mjs",11531,"e8426ac643fb9a0313015d8d4f357cdd5a96e02f9b783f88709791085ec3c780"));
            pins.Add(new Pin { Name = Node, Size = 82123080, Hash = NodeSha });
            var directories = new HashSet<string>(StringComparer.Ordinal);
            foreach (Pin pin in pins) { string parent = Path.GetDirectoryName(pin.Name); while (parent != null) { directories.Add(parent); parent = Path.GetDirectoryName(parent); } }
            pins.InsertRange(0, directories.OrderBy(s => s.Length).ThenBy(s => s, StringComparer.Ordinal).Select(name => new Pin { Name = name, Directory = true }));
            Need(pins.Count <= 128); return pins;
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
            using (var stream = new FileStream(alias, FileAccess.Read, 65536, false)) Need(Hex(SHA256.HashData(stream)) == held.Pin.Hash);
            Need(GetFileInformationByHandle(held.Handle, out current) && current.Write.dwHighDateTime == held.Info.Write.dwHighDateTime && current.Write.dwLowDateTime == held.Info.Write.dwLowDateTime);
        }
    }
    static Held Acquire(Pin pin) {
        var security = new Security { Length = Marshal.SizeOf<Security>(), Inherit = true };
        SafeFileHandle handle = CreateFileW(pin.Name, pin.Directory ? 0x80u : Read, ShareRead, ref security, OpenExisting, OpenReparse | (pin.Directory ? Backup : 0), IntPtr.Zero);
        if (handle.IsInvalid) {
            int error = Marshal.GetLastWin32Error(); handle.Dispose();
            if (Scenario == "preexisting-writer" && pin.Name == Root + "\\dist\\index.js" && error == 32) Phase = "PREEXISTING_WRITER";
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
                Need(++count <= 128 && (File.GetAttributes(name) & FileAttributes.ReparsePoint) == 0);
                if (Directory.Exists(name)) {
                    if (!expectedDirs.Contains(name)) { Phase = "UNKNOWN_MEMBER"; throw Refuse(); }
                    queue.Enqueue(name);
                } else if (!expectedFiles.Contains(name)) { Phase = "UNKNOWN_MEMBER"; throw Refuse(); }
            }
        }
    }
    static string Output(SafeFileHandle handle) {
        using (var stream = new FileStream(handle, FileAccess.Read, 4096, false)) {
            var bytes = new byte[4096]; int count, total = 0, index = 0; var line = new StringBuilder();
            string[] expected = { "R20_HOOKS_INSTALLED:" + Fixture, "R20_ENTRY_STARTED:" + Fixture, "R20_ENTRY_COMPLETE:" + Fixture };
            using (var output = new MemoryStream()) {
                while ((count = stream.Read(bytes, 0, bytes.Length)) > 0) {
                    if ((total += count) > 65536) throw new InvalidOperationException("RUNTIME_CUSTODY_REFUSED:OUTPUT");
                    output.Write(bytes, 0, count);
                    for (int i = 0; i < count; i++) {
                        byte value = bytes[i];
                        if (value == 13) continue;
                        if (value == 10) {
                            if (index >= expected.Length || line.ToString() != expected[index]) throw new InvalidOperationException("RUNTIME_CUSTODY_REFUSED:OUTPUT");
                            if (index == 1) EntryStarted = true;
                            Console.WriteLine("R20_CHILD_EVENT:" + expected[index++]); Console.Out.Flush(); line.Clear();
                        } else {
                            if (value < 32 || value > 126 || line.Length >= 256) throw new InvalidOperationException("RUNTIME_CUSTODY_REFUSED:OUTPUT");
                            line.Append((char)value);
                        }
                    }
                }
                if (line.Length != 0) throw new InvalidOperationException("RUNTIME_CUSTODY_REFUSED:OUTPUT");
                return new UTF8Encoding(false, true).GetString(output.ToArray());
            }
        }
    }
    static void Send(SafeFileHandle handle, string text) {
        using (var stream = new FileStream(handle, FileAccess.Write, 4096, false)) { byte[] bytes = Encoding.UTF8.GetBytes(text); stream.Write(bytes, 0, bytes.Length); }
    }
    public static int Run(string text, string expected) {
        var held = new List<Held>(); SafeFileHandle childIn = null, parentIn = null, parentOut = null, childOut = null;
        IntPtr job = IntPtr.Zero, list = IntPtr.Zero, handleList = IntPtr.Zero, jobList = IntPtr.Zero, environment = IntPtr.Zero; ProcessInfo process = default;
        bool assigned = false, exited = false, listReady = false; int result = 1;
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
            var command = new StringBuilder("\"" + Node + "\" --permission \"--allow-fs-read=" + Root + "\" \"" + Root + "\\.runtime\\runtime-bootstrap.mjs\" " + Fixture);
            Phase = "CREATE_SUSPENDED";
            Need(CreateProcessW(Node, command, IntPtr.Zero, IntPtr.Zero, true, Suspended | UnicodeEnvironment | ExtendedStartup | NoWindow, environment, Root, ref startup, out process));
            assigned = true; // Successful creation includes atomic JOB_LIST membership.
            childIn.Dispose(); childIn = null; childOut.Dispose(); childOut = null;
            Phase = "VERIFY_JOB"; bool inJob; Need(IsProcessInJob(process.Process, job, out inJob) && inJob);
            foreach (Held item in held) Verify(item); ExactMembers(pins);
            Console.WriteLine("R20_CHILD_PID:" + Scenario + ":" + process.ProcessId); Console.Out.Flush();
            Phase = "RESUME"; Need(ResumeThread(process.Thread) == 1);
            Phase = "WAIT";
            Task<string> output = Task.Run(() => Output(parentOut)); Task input = Task.Run(() => Send(parentIn, text));
            uint wait = WaitForSingleObject(process.Process, Scenario == "timeout" ? 2000u : 15000u);
            if (wait == WaitTimeout) {
                Phase = "TIMEOUT"; Need(TerminateJobObject(job, 125)); Need(WaitForSingleObject(process.Process, 5000) == 0); exited = true;
                Need(Task.WaitAll(new Task[] { output, input }, 5000));
                Phase = "TIMEOUT_BEFORE_ENTRY"; Need(Scenario == "timeout" && EntryStarted);
                Need(output.Result.Replace("\r\n", "\n") == "R20_HOOKS_INSTALLED:" + Fixture + "\nR20_ENTRY_STARTED:" + Fixture + "\n");
            } else {
                Need(wait == 0); exited = true; Need(Task.WaitAll(new Task[] { output, input }, 5000));
                Phase = "CHILD_RESULT"; uint code; Need(Scenario != "timeout" && GetExitCodeProcess(process.Process, out code) && code == 0);
                string expectedOutput = "R20_HOOKS_INSTALLED:" + Fixture + "\nR20_ENTRY_STARTED:" + Fixture + "\nR20_ENTRY_COMPLETE:" + Fixture + "\n";
                Need(output.Result.Replace("\r\n", "\n") == expectedOutput);
            }
            Phase = "POST"; ExactMembers(pins); foreach (Held item in held) Verify(item);
            Console.WriteLine((Scenario == "timeout" ? "R20_TIMEOUT_CHILD_TERMINATED:" : "R20_CUSTODY_CHILD_COMPLETE:") + Fixture); result = 0;
        } catch (Exception error) {
            if (process.Process == IntPtr.Zero && Scenario == "preexisting-writer" && Phase == "PREEXISTING_WRITER") {
                Console.WriteLine("R20_PREEXISTING_WRITER_REFUSED:" + Fixture); result = 0;
            } else if (process.Process == IntPtr.Zero && Scenario == "unknown-member" && Phase == "UNKNOWN_MEMBER") {
                Console.WriteLine("R20_UNKNOWN_MEMBER_REFUSED:" + Fixture); result = 0;
            } else {
                if (error is AggregateException aggregate && aggregate.Flatten().InnerExceptions.Any(item => item.Message == "RUNTIME_CUSTODY_REFUSED:OUTPUT")) Phase = "OUTPUT";
                Console.Error.WriteLine("RUNTIME_CUSTODY_REFUSED:" + Phase);
            }
        }
        finally {
            // Job closure terminates a running assigned child. The child's inherited custody
            // handles remain alive through its own exit even if this supervisor dies here.
            if (process.Process != IntPtr.Zero && !exited) {
                if (assigned) TerminateJobObject(job, 126); else TerminateProcess(process.Process, 126);
                if (WaitForSingleObject(process.Process, 5000) != 0) { Console.Error.WriteLine("RUNTIME_CUSTODY_REFUSED:TERMINATION_WAIT"); result = 1; }
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
        if ($builder.Length + $count -gt 65536) { throw 'input' }
        [void]$builder.Append($buffer, 0, $count)
    }
    $phase = 'COMPILE'
    Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop
    exit [R20RuntimeCustody]::Run($builder.ToString(), $ProtocolSha256)
} catch {
    [Console]::Error.WriteLine("RUNTIME_CUSTODY_REFUSED:$phase")
    exit 1
}

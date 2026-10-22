using System;
using System.ComponentModel;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.IO;
using System.IO.Pipes;
using System.Threading;
using System.Threading.Tasks;
using System.Globalization;
using System.Security.Cryptography;

namespace AgentStudioAcceptance {
  public sealed class OwnedJsonPin : IDisposable {
    private FileStream stream;
    private readonly byte[] original;
    public string Text { get; private set; }
    public string Sha256 { get; private set; }
    public bool IsClosed { get { return stream == null || stream.SafeFileHandle.IsClosed; } }
    private OwnedJsonPin(FileStream file, byte[] bytes) {
      stream = file; original = bytes;
      Text = new UTF8Encoding(false, true).GetString(bytes);
      Sha256 = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant();
    }
    public static OwnedJsonPin Create(string path, string text, int maximum) {
      if (!Path.IsPathFullyQualified(path) || text == null || maximum < 1 || maximum > 4 * 1024 * 1024)
        throw new ArgumentException("有界自有文件无效");
      byte[] bytes = new UTF8Encoding(false, true).GetBytes(text);
      if (bytes.Length < 1 || bytes.Length > maximum) throw new ArgumentException("自有文件超过上限");
      var file = new FileStream(path, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read);
      bool transferred = false;
      try {
        file.Write(bytes, 0, bytes.Length); file.Flush(true);
        FileInformation information;
        if (!GetFileInformationByHandle(file.SafeFileHandle, out information) || (information.Attributes & 0x410) != 0
          || information.Links != 1 || information.SizeHigh != 0 || information.SizeLow != bytes.Length)
          throw new InvalidOperationException("自建文件身份未确认");
        var pin = new OwnedJsonPin(file, bytes); transferred = true; return pin;
      } finally { if (!transferred) file.Dispose(); }
    }
    public static OwnedJsonPin Open(string path, int maximum) {
      if (!Path.IsPathFullyQualified(path) || maximum < 1 || maximum > 4 * 1024 * 1024)
        throw new ArgumentException("有界回执路径无效");
      var handle = CreateFile(path, 0x80000000, 1, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero);
      if (handle.IsInvalid) { handle.Dispose(); throw new Win32Exception(); }
      FileStream file = null; bool transferred = false;
      try {
        FileInformation information;
        if (!GetFileInformationByHandle(handle, out information) || (information.Attributes & 0x410) != 0
          || information.Links != 1 || information.SizeHigh != 0 || information.SizeLow < 1 || information.SizeLow > maximum)
          throw new InvalidOperationException("回执重解析、硬链接或容量未知");
        file = new FileStream(handle, FileAccess.Read);
        var bytes = new byte[checked((int)information.SizeLow)]; file.ReadExactly(bytes);
        FileInformation after;
        if (file.ReadByte() != -1 || !GetFileInformationByHandle(handle, out after)
          || after.Volume != information.Volume || after.IndexHigh != information.IndexHigh
          || after.IndexLow != information.IndexLow || after.Links != 1 || after.SizeHigh != 0 || after.SizeLow != bytes.Length)
          throw new InvalidOperationException("回执身份或字节长度发生变化");
        var pin = new OwnedJsonPin(file, bytes); transferred = true; return pin;
      } finally { if (!transferred) { if (file != null) file.Dispose(); else handle.Dispose(); } }
    }
    public bool OriginalBytesUnchanged() {
      if (IsClosed) return false;
      FileInformation information;
      if (!GetFileInformationByHandle(stream.SafeFileHandle, out information) || (information.Attributes & 0x410) != 0
        || information.Links != 1 || information.SizeHigh != 0 || information.SizeLow != original.Length) return false;
      stream.Position = 0; var bytes = new byte[original.Length]; stream.ReadExactly(bytes);
      return stream.ReadByte() == -1 && System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(original, bytes);
    }
    public void Dispose() { if (stream == null) return; stream.Dispose(); stream = null; }
    [StructLayout(LayoutKind.Sequential)] private struct FileInformation {
      public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written;
      public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern Microsoft.Win32.SafeHandles.SafeFileHandle CreateFile(
      string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileInformationByHandle(
      Microsoft.Win32.SafeHandles.SafeFileHandle handle, out FileInformation information);
  }
  public sealed class OwnedDirectoryPins : IDisposable {
    private readonly List<IntPtr> handles = new List<IntPtr>();
    private readonly HashSet<string> paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    public bool IsClosed { get; private set; }
    public void Pin(string directory) {
      if (IsClosed || !Path.IsPathFullyQualified(directory)) throw new InvalidOperationException("目录固定状态无效");
      string current = Path.GetFullPath(directory);
      try {
        while (!String.IsNullOrEmpty(current)) {
          if (paths.Add(current)) {
            var handle = CreateFile(current, 0x80, 1, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
            if (handle == new IntPtr(-1)) throw new Win32Exception();
            handles.Add(handle);
            DirectoryInformation information;
            if (!GetFileInformationByHandle(handle, out information) || (information.Attributes & 0x10) == 0
              || (information.Attributes & 0x400) != 0) throw new InvalidOperationException("目录重解析或身份未知");
          }
          string parent = Path.GetDirectoryName(current);
          if (parent == current) break;
          current = parent;
        }
      } catch { Dispose(); throw; }
    }
    public void Dispose() {
      if (IsClosed) return;
      IsClosed = true;
      foreach (var handle in handles) CloseHandle(handle);
      handles.Clear(); paths.Clear();
    }
    [StructLayout(LayoutKind.Sequential)] private struct DirectoryInformation {
      public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written;
      public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateFile(
      string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileInformationByHandle(IntPtr handle, out DirectoryInformation information);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
  }
  public sealed class OwnedBinaryPin : IDisposable {
    private const long MaximumBytes = 256L * 1024 * 1024;
    private const string EsbuildSha256 = "c7bee37877d0aa6a046e52783fa0a2cf1a9ce5579d68bb3083bda99d4bff18ef";
    private FileStream stream;
    private OwnedDirectoryPins directories;
    private readonly FileInformation identity;
    public string ImagePath { get; private set; }
    public string Sha256 { get; private set; }
    public long ByteLength { get; private set; }
    public uint VolumeSerialNumber { get { return identity.Volume; } }
    public string FileIndex { get { return (((ulong)identity.IndexHigh << 32) | identity.IndexLow).ToString("x16", CultureInfo.InvariantCulture); } }
    public string PinnedAt { get; private set; }
    public bool IsClosed { get { return stream == null || stream.SafeFileHandle.IsClosed || directories == null || directories.IsClosed; } }

    private OwnedBinaryPin(FileStream file, OwnedDirectoryPins ancestors, FileInformation information, string path, string hash) {
      stream = file; directories = ancestors; identity = information; ImagePath = path; Sha256 = hash;
      ByteLength = ((long)information.SizeHigh << 32) | information.SizeLow;
      PinnedAt = Timestamp(DateTimeOffset.UtcNow);
    }
    public static OwnedBinaryPin OpenNode(string path) { return Open(path, "node.exe", null); }
    public static OwnedBinaryPin OpenEsbuild(string path) { return Open(path, "esbuild.exe", EsbuildSha256); }
    private static OwnedBinaryPin Open(string path, string basename, string expectedHash) {
      if (!Path.IsPathFullyQualified(path)) throw new ArgumentException("镜像路径必须为本地绝对路径");
      string requested = CanonicalLocalPath(Path.GetFullPath(path.Replace('/', '\\')));
      if (!String.Equals(Path.GetFileName(requested), basename, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("固定镜像类别无效");
      var ancestors = new OwnedDirectoryPins();
      Microsoft.Win32.SafeHandles.SafeFileHandle handle = null;
      FileStream file = null; bool transferred = false;
      try {
        ancestors.Pin(Path.GetDirectoryName(requested));
        handle = CreateFile(requested, 0x80000000, 1, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero);
        if (handle.IsInvalid) throw new Win32Exception();
        FileInformation before;
        if (!GetFileInformationByHandle(handle, out before) || !ValidFile(before) || GetFileType(handle) != 1) throw new InvalidOperationException("镜像文件身份或容量未知");
        string final = FinalLocalPath(handle);
        if (!String.Equals(requested, final, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("镜像路径没有固定到实际文件");
        file = new FileStream(handle, FileAccess.Read);
        long length = ((long)before.SizeHigh << 32) | before.SizeLow;
        string hash = HashBounded(file, length);
        FileInformation after;
        if (!GetFileInformationByHandle(handle, out after) || !SameIdentity(before, after)
          || !String.Equals(final, FinalLocalPath(handle), StringComparison.OrdinalIgnoreCase)
          || expectedHash != null && !String.Equals(hash, expectedHash, StringComparison.Ordinal)) throw new InvalidOperationException("固定镜像身份或字节不一致");
        var pin = new OwnedBinaryPin(file, ancestors, before, final, hash); transferred = true; return pin;
      } finally {
        if (!transferred) { if (file != null) file.Dispose(); else if (handle != null) handle.Dispose(); ancestors.Dispose(); }
      }
    }
    private static bool ValidFile(FileInformation value) {
      long length = ((long)value.SizeHigh << 32) | value.SizeLow;
      return (value.Attributes & 0x410) == 0 && value.Links > 0 && length > 0 && length <= MaximumBytes;
    }
    private static bool SameIdentity(FileInformation before, FileInformation after) {
      return ValidFile(after) && before.Volume == after.Volume && before.IndexHigh == after.IndexHigh && before.IndexLow == after.IndexLow
        && before.SizeHigh == after.SizeHigh && before.SizeLow == after.SizeLow
        && before.Created.dwHighDateTime == after.Created.dwHighDateTime && before.Created.dwLowDateTime == after.Created.dwLowDateTime
        && before.Written.dwHighDateTime == after.Written.dwHighDateTime && before.Written.dwLowDateTime == after.Written.dwLowDateTime;
    }
    private static string HashBounded(FileStream file, long length) {
      if (length < 1 || length > MaximumBytes) throw new InvalidOperationException("镜像字节超过上限");
      file.Position = 0;
      using (var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256)) {
        var buffer = new byte[64 * 1024]; long remaining = length;
        while (remaining > 0) {
          int read = file.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
          if (read == 0) throw new InvalidOperationException("镜像字节长度发生变化");
          hash.AppendData(buffer, 0, read); remaining -= read;
        }
        if (file.ReadByte() != -1) throw new InvalidOperationException("镜像字节长度发生变化");
        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
      }
    }
    internal static string CanonicalLocalPath(string path) {
      if (path == null || path.Length < 4 || path.Length > 2048 || !((path[0] >= 'A' && path[0] <= 'Z') || (path[0] >= 'a' && path[0] <= 'z'))
        || path[1] != ':' || path[2] != '\\') throw new InvalidOperationException("镜像不是规范的本地 Windows 路径");
      foreach (char value in path) {
        if (value < 32 || value == 127 || "/\"<>|?*".IndexOf(value) >= 0) throw new InvalidOperationException("镜像路径字符无效");
      }
      foreach (string part in path.Substring(3).Split('\\')) {
        if (part.Length == 0 || part == "." || part == ".." || part.Contains(":") || part.EndsWith(".", StringComparison.Ordinal)
          || part.EndsWith(" ", StringComparison.Ordinal)) throw new InvalidOperationException("镜像路径没有规范化");
      }
      return path;
    }
    private static string FinalLocalPath(Microsoft.Win32.SafeHandles.SafeFileHandle handle) {
      var buffer = new StringBuilder(4096);
      uint length = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 0);
      if (length == 0 || length >= buffer.Capacity || buffer.Length != length) throw new Win32Exception();
      string path = buffer.ToString();
      if (path.StartsWith("\\\\?\\", StringComparison.Ordinal)) path = path.Substring(4);
      return CanonicalLocalPath(path);
    }
    internal static string Timestamp(DateTimeOffset time) { return time.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture); }
    internal bool IdentityUnchanged() {
      if (IsClosed) return false;
      FileInformation current;
      return GetFileInformationByHandle(stream.SafeFileHandle, out current) && SameIdentity(identity, current)
        && String.Equals(ImagePath, FinalLocalPath(stream.SafeFileHandle), StringComparison.OrdinalIgnoreCase);
    }
    public bool OriginalBytesUnchanged() {
      try { return IdentityUnchanged() && HashBounded(stream, ByteLength) == Sha256 && IdentityUnchanged(); }
      catch { return false; }
    }
    internal bool SameImage(OwnedBinaryPin actual) {
      return String.Equals(ImagePath, actual.ImagePath, StringComparison.OrdinalIgnoreCase) && Sha256 == actual.Sha256
        && ByteLength == actual.ByteLength && VolumeSerialNumber == actual.VolumeSerialNumber && FileIndex == actual.FileIndex;
    }
    public Dictionary<string,object> Snapshot() {
      return new Dictionary<string,object> { { "imagePath", ImagePath }, { "sha256", Sha256 }, { "byteLength", ByteLength },
        { "volumeSerialNumber", (long)VolumeSerialNumber }, { "fileIndex", FileIndex }, { "pinnedAt", PinnedAt } };
    }
    public void Dispose() {
      if (stream != null) { stream.Dispose(); stream = null; }
      if (directories != null) { directories.Dispose(); directories = null; }
    }
    [StructLayout(LayoutKind.Sequential)] private struct FileInformation {
      public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written;
      public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CreateFileW")] private static extern Microsoft.Win32.SafeHandles.SafeFileHandle CreateFile(
      string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool GetFileInformationByHandle(Microsoft.Win32.SafeHandles.SafeFileHandle handle, out FileInformation information);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern uint GetFileType(Microsoft.Win32.SafeHandles.SafeFileHandle handle);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="GetFinalPathNameByHandleW")] private static extern uint GetFinalPathNameByHandle(
      Microsoft.Win32.SafeHandles.SafeFileHandle handle, StringBuilder path, uint capacity, uint flags);
  }
  // A suspended child joins the non-breakaway job before executing any user code.
  public sealed class OwnedProcessDomain : IDisposable {
    private IntPtr job;
    private IntPtr process;
    private IntPtr completionPort;
    private readonly HashSet<ulong> observedProcesses = new HashSet<ulong>();
    private readonly Dictionary<ulong, IntPtr> ownedProcessHandles = new Dictionary<ulong, IntPtr>();
    private readonly Dictionary<ulong, uint> observedExitCodes = new Dictionary<ulong, uint>();
    private readonly Dictionary<ulong, Dictionary<string,object>> observedImages = new Dictionary<ulong, Dictionary<string,object>>();
    private readonly OwnedBinaryPin nodeImage, esbuildImage;
    private bool imageObservationUnknown;
    private bool imagePinsUnknown;
    private string startedAt;
    private bool memberObservationUnknown;
    private bool abnormalMemberExit;
    private AnonymousPipeServerStream stdoutPipe, stderrPipe, stdinPipe;
    private Task stdoutDrain, stderrDrain;
    private long outputBytes;
    private bool disposed;
    public uint ProcessId { get; private set; }
    public bool ForcedTermination { get; private set; }

    public OwnedProcessDomain(OwnedBinaryPin nodePin, OwnedBinaryPin esbuildPin) {
      if (nodePin == null || esbuildPin == null || nodePin.IsClosed || esbuildPin.IsClosed
        || !String.Equals(Path.GetFileName(nodePin.ImagePath), "node.exe", StringComparison.OrdinalIgnoreCase)
        || !String.Equals(Path.GetFileName(esbuildPin.ImagePath), "esbuild.exe", StringComparison.OrdinalIgnoreCase)
        || nodePin.VolumeSerialNumber == esbuildPin.VolumeSerialNumber && nodePin.FileIndex == esbuildPin.FileIndex)
        throw new InvalidOperationException("执行域必须使用父持有的两个独立镜像固定句柄");
      nodeImage = nodePin; esbuildImage = esbuildPin;
      job = CreateJobObject(IntPtr.Zero, null);
      if (job == IntPtr.Zero) throw new Win32Exception();
      var limits = new ExtendedLimits();
      limits.Basic.LimitFlags = 0x00002000; // Kill-on-close never counts as natural completion.
      if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimits>())) {
        CloseHandle(job); job = IntPtr.Zero; throw new Win32Exception();
      }
      completionPort = CreateIoCompletionPort(new IntPtr(-1), IntPtr.Zero, UIntPtr.Zero, 1);
      if (completionPort == IntPtr.Zero) { Dispose(); throw new Win32Exception(); }
      var association = new CompletionAssociation { Key = job, Port = completionPort };
      if (!SetCompletionAssociation(job, 7, ref association, (uint)Marshal.SizeOf<CompletionAssociation>())) {
        Dispose(); throw new Win32Exception();
      }
    }

    public void Start(string executable, string quotedArguments, string directory, IDictionary<string,string> environment,
      IntPtr stdoutWrite, IntPtr stderrWrite, IntPtr stdinRead) {
      if (disposed || process != IntPtr.Zero) throw new InvalidOperationException("执行域已启动或关闭");
      if (!System.IO.Path.IsPathFullyQualified(executable) || !System.IO.Path.IsPathFullyQualified(directory)
        || executable.Contains("\"") || executable.Contains("\0") || quotedArguments.Contains("\0"))
        throw new ArgumentException("执行路径或参数无效");
      if (stdoutWrite == IntPtr.Zero || stderrWrite == IntPtr.Zero || stdinRead == IntPtr.Zero)
        throw new ArgumentException("必须使用父控制器自有重定向句柄");
      string canonicalExecutable = OwnedBinaryPin.CanonicalLocalPath(Path.GetFullPath(executable.Replace('/', '\\')));
      if (!nodeImage.IdentityUnchanged() || !esbuildImage.IdentityUnchanged()
        || !String.Equals(nodeImage.ImagePath, canonicalExecutable, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("启动前固定镜像归属已失效");
      var keys = new List<string>(environment.Keys); keys.Sort(StringComparer.OrdinalIgnoreCase);
      var block = new StringBuilder();
      foreach (var key in keys) {
        var value = environment[key];
        if (String.IsNullOrEmpty(key) || key.Contains("=") || key.Contains("\0") || value == null || value.Contains("\0"))
          throw new ArgumentException("执行域环境无效");
        block.Append(key).Append('=').Append(value).Append('\0');
      }
      block.Append('\0');
      IntPtr env = Marshal.StringToHGlobalUni(block.ToString());
      var startup = new StartupInfoEx(); startup.Startup.Size = (uint)Marshal.SizeOf<StartupInfoEx>();
      startup.Startup.Flags = 0x00000100; startup.Startup.StdOutput = stdoutWrite;
      startup.Startup.StdError = stderrWrite; startup.Startup.StdInput = stdinRead;
      IntPtr attributes = IntPtr.Zero, handles = IntPtr.Zero;
      ProcessInfo info;
      try {
        UIntPtr bytes = UIntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref bytes);
        if (bytes.ToUInt64() == 0 || bytes.ToUInt64() > 65536) throw new Win32Exception();
        attributes = Marshal.AllocHGlobal(checked((int)bytes.ToUInt64()));
        if (!InitializeProcThreadAttributeList(attributes, 1, 0, ref bytes)) throw new Win32Exception();
        startup.Attributes = attributes;
        handles = Marshal.AllocHGlobal(IntPtr.Size * 3);
        Marshal.WriteIntPtr(handles, 0, stdinRead);
        Marshal.WriteIntPtr(handles, IntPtr.Size, stdoutWrite);
        Marshal.WriteIntPtr(handles, IntPtr.Size * 2, stderrWrite);
        if (!UpdateProcThreadAttribute(attributes, 0, new UIntPtr(0x00020002), handles,
          new UIntPtr((uint)(IntPtr.Size * 3)), IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception();
        var command = new StringBuilder("\"" + executable + "\" " + quotedArguments);
        startedAt = OwnedBinaryPin.Timestamp(DateTimeOffset.UtcNow);
        if (String.CompareOrdinal(nodeImage.PinnedAt, startedAt) > 0 || String.CompareOrdinal(esbuildImage.PinnedAt, startedAt) > 0)
          throw new InvalidOperationException("镜像固定与启动时间发生回退");
        if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true, 0x00000004 | 0x00000400 | 0x08000000 | 0x00080000,
          env, directory, ref startup, out info)) throw new Win32Exception();
      } finally {
        Marshal.ZeroFreeGlobalAllocUnicode(env);
        if (startup.Attributes != IntPtr.Zero) DeleteProcThreadAttributeList(startup.Attributes);
        if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
        if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
      }
      process = info.Process; ProcessId = info.Id;
      try {
        if (!AssignProcessToJobObject(job, process)) throw new Win32Exception();
        DrainProcessEvents();
        if (ResumeThread(info.Thread) == UInt32.MaxValue) throw new Win32Exception();
      } catch {
        ForcedTermination = true;
        // Only the suspended child created by this instance may be stopped here.
        TerminateProcess(process, 1);
        throw;
      } finally { CloseHandle(info.Thread); }
    }

    public void StartRedirected(string executable, string quotedArguments, string directory, IDictionary<string,string> environment) {
      if (disposed || process != IntPtr.Zero || stdoutPipe != null) throw new InvalidOperationException("执行域已经启动或关闭");
      stdoutPipe = new AnonymousPipeServerStream(PipeDirection.In, HandleInheritability.Inheritable);
      stderrPipe = new AnonymousPipeServerStream(PipeDirection.In, HandleInheritability.Inheritable);
      stdinPipe = new AnonymousPipeServerStream(PipeDirection.Out, HandleInheritability.Inheritable);
      try {
        Start(executable, quotedArguments, directory, environment,
          stdoutPipe.ClientSafePipeHandle.DangerousGetHandle(), stderrPipe.ClientSafePipeHandle.DangerousGetHandle(),
          stdinPipe.ClientSafePipeHandle.DangerousGetHandle());
        stdoutPipe.DisposeLocalCopyOfClientHandle(); stderrPipe.DisposeLocalCopyOfClientHandle();
        stdinPipe.DisposeLocalCopyOfClientHandle(); stdinPipe.Dispose(); stdinPipe = null;
        stdoutDrain = DrainBounded(stdoutPipe); stderrDrain = DrainBounded(stderrPipe);
      } catch {
        ForcedTermination = true;
        throw;
      }
    }

    private async Task DrainBounded(Stream stream) {
      var buffer = new byte[8192];
      while (true) {
        int length = await stream.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false);
        if (length == 0) return;
        // Drain without retaining or exposing potential credentials from SDK output.
        Interlocked.Add(ref outputBytes, length);
      }
    }

    public bool OutputEofConfirmed() {
      return StdoutEofConfirmed() && StderrEofConfirmed();
    }
    public bool StdoutEofConfirmed() { return stdoutDrain != null && stdoutDrain.IsCompletedSuccessfully && Interlocked.Read(ref outputBytes) <= 512 * 1024; }
    public bool StderrEofConfirmed() { return stderrDrain != null && stderrDrain.IsCompletedSuccessfully && Interlocked.Read(ref outputBytes) <= 512 * 1024; }

    public bool WaitForOutputEof(uint milliseconds) {
      if (stdoutDrain == null || stderrDrain == null) return false;
      try { return Task.WhenAll(stdoutDrain, stderrDrain).Wait(checked((int)milliseconds)) && OutputEofConfirmed(); }
      catch { return false; }
    }

    public bool WaitForRootExit(uint milliseconds) {
      RequireProcess();
      var clock = System.Diagnostics.Stopwatch.StartNew();
      while (true) {
        DrainProcessEvents();
        long remaining = Math.Max(0, (long)milliseconds - clock.ElapsedMilliseconds);
        uint result = WaitForSingleObject(process, (uint)Math.Min(20, remaining));
        if (result == 0xFFFFFFFF) throw new Win32Exception();
        if (result == 0) { DrainProcessEvents(); return true; }
        if (clock.ElapsedMilliseconds >= milliseconds) return false;
      }
    }

    public uint RootExitCode() {
      RequireProcess();
      if (!WaitForRootExit(0)) throw new InvalidOperationException("父执行进程尚未结束");
      uint code; if (!GetExitCodeProcess(process, out code)) throw new Win32Exception(); return code;
    }

    public uint RemainingProcesses() {
      if (disposed) throw new InvalidOperationException("执行域观测句柄已关闭");
      Accounting value; uint size;
      if (!QueryInformationJobObject(job, 1, out value, (uint)Marshal.SizeOf<Accounting>(), out size)
        || size != Marshal.SizeOf<Accounting>()) throw new Win32Exception();
      return value.ActiveProcesses;
    }

    public ulong[] ObservedProcessIds() {
      if (disposed || completionPort == IntPtr.Zero) throw new InvalidOperationException("执行域历史观测不可用");
      DrainProcessEvents();
      var values = new ulong[observedProcesses.Count]; observedProcesses.CopyTo(values); Array.Sort(values); return values;
    }

    private void DrainProcessEvents() {
      uint message; UIntPtr key; IntPtr value;
      while (GetQueuedCompletionStatus(completionPort, out message, out key, out value, 0)) {
        if (key.ToUInt64() != unchecked((ulong)job.ToInt64())) throw new InvalidOperationException("执行域事件归属无效");
        ulong id = unchecked((ulong)value.ToInt64());
        if (message == 6) {
          if (id == 0 || id > UInt32.MaxValue || !observedProcesses.Add(id)) { memberObservationUnknown = true; continue; }
          IntPtr handle = id == ProcessId ? process : OpenProcess(0x00101000, false, (uint)id);
          bool member;
          if (handle == IntPtr.Zero || !IsProcessInJob(handle, job, out member) || !member) {
            if (handle != IntPtr.Zero && handle != process) CloseHandle(handle);
            memberObservationUnknown = true;
          } else {
            ownedProcessHandles.Add(id, handle);
            CaptureProcessImage(id, handle);
          }
        }
        if (message == 7 || message == 8) {
          if (message == 8) abnormalMemberExit = true;
          IntPtr handle; uint code;
          if (!ownedProcessHandles.TryGetValue(id, out handle) || WaitForSingleObject(handle, 0) != 0
            || !GetExitCodeProcess(handle, out code) || observedExitCodes.ContainsKey(id)) memberObservationUnknown = true;
          else observedExitCodes.Add(id, code);
        }
      }
      if (Marshal.GetLastWin32Error() != 258) throw new Win32Exception();
    }

    private void CaptureProcessImage(ulong id, IntPtr handle) {
      try {
        var path = new StringBuilder(2049); uint length = (uint)path.Capacity;
        if (!QueryFullProcessImageName(handle, 0, path, ref length) || length == 0 || length >= path.Capacity || path.Length != length)
          throw new InvalidOperationException("实际进程镜像路径未知");
        string actualPath = OwnedBinaryPin.CanonicalLocalPath(path.ToString());
        OwnedBinaryPin expected; string kind;
        if (String.Equals(actualPath, nodeImage.ImagePath, StringComparison.OrdinalIgnoreCase)) { expected = nodeImage; kind = "node"; }
        else if (String.Equals(actualPath, esbuildImage.ImagePath, StringComparison.OrdinalIgnoreCase)) { expected = esbuildImage; kind = "esbuild"; }
        else throw new InvalidOperationException("本次 Job 含未知镜像");
        if (id == ProcessId && kind != "node" || !expected.IdentityUnchanged()) throw new InvalidOperationException("实际镜像归属发生变化");
        using (var actual = kind == "node" ? OwnedBinaryPin.OpenNode(actualPath) : OwnedBinaryPin.OpenEsbuild(actualPath)) {
          if (!expected.SameImage(actual) || !expected.IdentityUnchanged()) throw new InvalidOperationException("实际镜像文件没有匹配父固定字节");
          string observedAt = OwnedBinaryPin.Timestamp(DateTimeOffset.UtcNow);
          if (String.CompareOrdinal(observedAt, startedAt) < 0) throw new InvalidOperationException("镜像观察时间发生回退");
          var image = actual.Snapshot(); image.Remove("pinnedAt");
          image.Add("kind", kind); image.Add("observedAt", observedAt);
          observedImages.Add(id, image);
        }
      } catch { imageObservationUnknown = true; }
    }

    public bool AllProcessImagesConfirmed() {
      if (disposed || imageObservationUnknown || observedProcesses.Count < 1 || observedProcesses.Count > 64
        || observedImages.Count != observedProcesses.Count || !ImagePinsUnchanged()) return false;
      foreach (ulong id in observedProcesses) { if (!observedImages.ContainsKey(id)) return false; }
      return observedImages.ContainsKey(ProcessId) && (string)observedImages[ProcessId]["kind"] == "node";
    }

    private bool ImagePinsUnchanged() {
      if (imagePinsUnknown) return false;
      bool valid = nodeImage.OriginalBytesUnchanged() && esbuildImage.OriginalBytesUnchanged();
      if (!valid) { imagePinsUnknown = true; imageObservationUnknown = true; }
      return valid;
    }

    public Dictionary<string,object> SnapshotProcessFacts() {
      RequireProcess();
      try { DrainProcessEvents(); } catch { memberObservationUnknown = true; }
      if (!observedProcesses.Contains(ProcessId)) memberObservationUnknown = true;
      if (ProcessId == 0) throw new InvalidOperationException("没有实际创建的根进程身份");
      bool pinsValid = ImagePinsUnchanged();
      bool zero = false;
      try { zero = AllMembersExitedZero(); } catch { memberObservationUnknown = true; }
      Accounting accounting; uint size;
      bool counted = QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf<Accounting>(), out size) && size == Marshal.SizeOf<Accounting>();
      // The real creation handle survives a missing notification; this union never fabricates a NEW event.
      var actualIds = new HashSet<ulong>(observedProcesses); actualIds.Add(ProcessId);
      if (actualIds.Count > 64) throw new InvalidOperationException("实际全量进程清单超出共享边界");
      bool complete = zero && counted && accounting.TotalProcesses == actualIds.Count && accounting.ActiveProcesses == 0;
      bool stdoutEof = StdoutEofConfirmed(), stderrEof = StderrEofConfirmed();
      string stopped = complete && stdoutEof && stderrEof ? OwnedBinaryPin.Timestamp(DateTimeOffset.UtcNow) : null;
      if (stopped != null && String.CompareOrdinal(stopped, startedAt) < 0) throw new InvalidOperationException("实际启动与停止时间发生回退");
      var ids = new ulong[actualIds.Count]; actualIds.CopyTo(ids); Array.Sort(ids);
      var members = new Dictionary<string,object>[ids.Length];
      for (int index = 0; index < ids.Length; index++) {
        ulong id = ids[index]; uint exit;
        bool exitKnown = observedExitCodes.TryGetValue(id, out exit);
        if (!exitKnown && id == ProcessId) exitKnown = WaitForSingleObject(process, 0) == 0 && GetExitCodeProcess(process, out exit);
        bool known = pinsValid && observedImages.ContainsKey(id);
        if (known && stopped != null && String.CompareOrdinal((string)observedImages[id]["observedAt"], stopped) > 0)
          throw new InvalidOperationException("镜像观察与停止时间发生回退");
        members[index] = new Dictionary<string,object> { { "processId", (long)id }, { "imageObservationStatus", known ? "observed" : "unknown" },
          { "image", known ? new Dictionary<string,object>(observedImages[id]) : null },
          { "exitCode", exitKnown ? (object)(long)exit : null } };
      }
      // Zero exit alone never establishes a kill-free SDK/worker lifecycle.
      return new Dictionary<string,object> { { "rootProcessId", (long)ProcessId }, { "startedAt", startedAt }, { "stoppedAt", stopped },
        { "expectedImages", new Dictionary<string,object> { { "node", nodeImage.Snapshot() }, { "esbuild", esbuildImage.Snapshot() } } },
        { "members", members }, { "totalProcesses", counted && accounting.TotalProcesses > 0 ? (object)(long)accounting.TotalProcesses : null },
        { "remainingOwnedProcesses", counted ? (object)(long)accounting.ActiveProcesses : null }, { "inventoryComplete", complete },
        { "stdoutEof", stdoutEof }, { "stderrEof", stderrEof }, { "termination", ForcedTermination ? "forced" : "unknown" }, { "observationStatus", "unknown" } };
    }

    public bool ProcessInventoryComplete() {
      if (!AllMembersExitedZero()) return false;
      DrainProcessEvents();
      Accounting value; uint size;
      if (!QueryInformationJobObject(job, 1, out value, (uint)Marshal.SizeOf<Accounting>(), out size)) throw new Win32Exception();
      return size == Marshal.SizeOf<Accounting>() && value.ActiveProcesses == 0
        && observedProcesses.Contains(ProcessId) && value.TotalProcesses == observedProcesses.Count;
    }

    public bool AllMembersExitedZero() {
      if (ForcedTermination || !WaitForRootExit(0) || RootExitCode() != 0 || RemainingProcesses() != 0) return false;
      DrainProcessEvents();
      if (memberObservationUnknown || abnormalMemberExit || observedProcesses.Count == 0
        || observedProcesses.Count != ownedProcessHandles.Count || observedProcesses.Count != observedExitCodes.Count) return false;
      foreach (uint code in observedExitCodes.Values) { if (code != 0) return false; }
      return true;
    }

    public bool WaitForZeroExitDomainStop(uint milliseconds) {
      var clock = System.Diagnostics.Stopwatch.StartNew();
      while (true) {
        if (ForcedTermination) return false;
        if (WaitForRootExit(0)) {
          if (RootExitCode() != 0) return false;
          // Fresh accounting is authoritative for remaining processes; notifications only identify observed members.
          if (RemainingProcesses() == 0 && ProcessInventoryComplete()) return true;
        }
        long remaining = (long)milliseconds - clock.ElapsedMilliseconds;
        if (remaining <= 0) return false;
        Thread.Sleep((int)Math.Min(20, remaining));
      }
    }

    public void Dispose() {
      if (disposed) return;
      // Remaining writers killed by disposal invalidate success, even if the root exited zero.
      try { if (RemainingProcesses() != 0) ForcedTermination = true; }
      catch { ForcedTermination = true; }
      disposed = true;
      if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; }
      foreach (var handle in ownedProcessHandles.Values) { if (handle != process) CloseHandle(handle); }
      ownedProcessHandles.Clear(); observedExitCodes.Clear(); observedImages.Clear();
      if (process != IntPtr.Zero) { CloseHandle(process); process = IntPtr.Zero; }
      if (completionPort != IntPtr.Zero) { CloseHandle(completionPort); completionPort = IntPtr.Zero; }
      if (stdoutPipe != null) stdoutPipe.Dispose();
      if (stderrPipe != null) stderrPipe.Dispose();
      if (stdinPipe != null) stdinPipe.Dispose();
    }

    private void RequireProcess() {
      if (disposed || process == IntPtr.Zero) throw new InvalidOperationException("没有自有运行进程");
    }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInfo { public IntPtr Process, Thread; public uint Id, ThreadId; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] private struct StartupInfo {
      public uint Size; public string Reserved, Desktop, Title; public uint X,Y,XSize,YSize,XChars,YChars,Fill,Flags;
      public ushort Show, ReservedSize; public IntPtr ReservedBytes, StdInput, StdOutput, StdError;
    }
    [StructLayout(LayoutKind.Sequential)] private struct StartupInfoEx { public StartupInfo Startup; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct BasicLimits {
      public long ProcessTime, JobTime; public uint LimitFlags; public UIntPtr MinWorkingSet, MaxWorkingSet;
      public uint ActiveProcessLimit; public UIntPtr Affinity; public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimits {
      public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Accounting {
      public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
      public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
    }
    [StructLayout(LayoutKind.Sequential)] private struct CompletionAssociation { public IntPtr Key, Port; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits value, uint length);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting value, uint length, out uint returned);
    [DllImport("kernel32.dll", SetLastError=true, EntryPoint="SetInformationJobObject")] private static extern bool SetCompletionAssociation(IntPtr job, int kind, ref CompletionAssociation value, uint length);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern IntPtr CreateIoCompletionPort(IntPtr file, IntPtr port, UIntPtr key, uint threads);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool GetQueuedCompletionStatus(IntPtr port, out uint bytes, out UIntPtr key, out IntPtr overlapped, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CreateProcessW")] private static extern bool CreateProcess(string executable, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref UIntPtr size);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, UIntPtr attribute, IntPtr value, UIntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint id);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="QueryFullProcessImageNameW")] private static extern bool QueryFullProcessImageName(
      IntPtr process, uint flags, StringBuilder path, ref uint length);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool CloseHandle(IntPtr handle);
  }
}

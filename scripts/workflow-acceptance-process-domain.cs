using System;
using System.ComponentModel;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.IO;
using System.IO.Pipes;
using System.Threading;
using System.Threading.Tasks;

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
  // A suspended child joins the non-breakaway job before executing any user code.
  public sealed class OwnedProcessDomain : IDisposable {
    private IntPtr job;
    private IntPtr process;
    private IntPtr completionPort;
    private readonly HashSet<ulong> observedProcesses = new HashSet<ulong>();
    private readonly Dictionary<ulong, IntPtr> ownedProcessHandles = new Dictionary<ulong, IntPtr>();
    private readonly Dictionary<ulong, uint> observedExitCodes = new Dictionary<ulong, uint>();
    private bool memberObservationUnknown;
    private bool abnormalMemberExit;
    private AnonymousPipeServerStream stdoutPipe, stderrPipe, stdinPipe;
    private Task stdoutDrain, stderrDrain;
    private long outputBytes;
    private bool disposed;
    public uint ProcessId { get; private set; }
    public bool ForcedTermination { get; private set; }

    public OwnedProcessDomain() {
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
      return stdoutDrain != null && stderrDrain != null && stdoutDrain.IsCompletedSuccessfully
        && stderrDrain.IsCompletedSuccessfully && Interlocked.Read(ref outputBytes) <= 512 * 1024;
    }

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
          } else ownedProcessHandles.Add(id, handle);
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
      ownedProcessHandles.Clear(); observedExitCodes.Clear();
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
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool CloseHandle(IntPtr handle);
  }
}

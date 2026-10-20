param(
  [ValidateSet('identity','recover')][string]$Action,
  [int]$OwnerProcessId,
  [string]$OwnerCreated,
  [string]$OwnerSid,
  [string]$WorkspaceRoot,
  [string]$ArgumentsBase64
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class PixelVoiceProcess {
  [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr OpenProcess(uint access,bool inherit,int id);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr h,out long created,out long exited,out long kernel,out long user);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr h,int flags,StringBuilder path,ref int size);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr h,uint access,out IntPtr token);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool TerminateProcess(IntPtr h,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern uint WaitForSingleObject(IntPtr h,uint ms);
  [DllImport("shell32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CommandLineToArgvW(string command,out int count);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr h);
  public static string Created(IntPtr h) { long a,b,c,d;if(!GetProcessTimes(h,out a,out b,out c,out d))throw new Exception("PROCESS_TIME_UNVERIFIABLE");return a.ToString(); }
  public static string Image(IntPtr h) { var b=new StringBuilder(32768);int n=b.Capacity;if(!QueryFullProcessImageName(h,0,b,ref n))throw new Exception("PROCESS_IMAGE_UNVERIFIABLE");return b.ToString(); }
  public static string Sid(IntPtr h) { IntPtr token;if(!OpenProcessToken(h,8,out token))throw new Exception("PROCESS_OWNER_UNVERIFIABLE");try{using(var identity=new WindowsIdentity(token)){return identity.User.Value;}}finally{CloseHandle(token);} }
  public static string[] Arguments(string command) { int n;IntPtr p=CommandLineToArgvW(command,out n);if(p==IntPtr.Zero)throw new Exception("PROCESS_ARGUMENTS_UNVERIFIABLE");try{var result=new string[n];for(int i=0;i<n;i++)result[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(p,i*IntPtr.Size));return result;}finally{LocalFree(p);} }
}
'@
function Open-VoiceProcess([int]$ProcessId,[bool]$Terminate) {
  $access = [uint32]0x101000
  if ($Terminate) { $access = $access -bor 1 }
  $handle = [PixelVoiceProcess]::OpenProcess($access,$false,$ProcessId)
  if ($handle -eq [IntPtr]::Zero) {
    $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($code -eq 87) { return [IntPtr]::Zero }
    throw 'PROCESS_HANDLE_UNVERIFIABLE'
  }
  return $handle
}
function Owner-IsLive {
  $h = Open-VoiceProcess $OwnerProcessId $false
  if ($h -eq [IntPtr]::Zero) { return $false }
  try {
    if ([PixelVoiceProcess]::Created($h) -ne $OwnerCreated) { return $false }
    if ([PixelVoiceProcess]::Sid($h) -ne $OwnerSid) { throw 'PROCESS_OWNER_UNVERIFIABLE' }
    return [PixelVoiceProcess]::WaitForSingleObject($h,0) -ne 0
  } finally { [void][PixelVoiceProcess]::CloseHandle($h) }
}
try {
  if ($Action -eq 'identity') {
    $h = Open-VoiceProcess $OwnerProcessId $false
    if ($h -eq [IntPtr]::Zero) { throw 'PROCESS_OWNER_GONE' }
    try { @{ pid=$OwnerProcessId; created=[PixelVoiceProcess]::Created($h); sid=[PixelVoiceProcess]::Sid($h); executable=[PixelVoiceProcess]::Image($h) } | ConvertTo-Json -Compress }
    finally { [void][PixelVoiceProcess]::CloseHandle($h) }
    exit 0
  }
  $expected = ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ArgumentsBase64)))
  if ($expected.Count -ne 16 -or [IO.Path]::GetFileName($expected[0]) -ne 'whisper-cli.exe' -or $expected[3] -ne '-f') { throw 'PROCESS_ARGUMENTS_INVALID' }
  $rootPath = [IO.Path]::GetFullPath($WorkspaceRoot)
  $candidateId = Split-Path (Split-Path $expected[4] -Parent) -Leaf
  if ($candidateId -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') { throw 'PROCESS_SCOPE_INVALID' }
  $required = @((Join-Path $rootPath '.local\voice-runtime\bin\Release\whisper-cli.exe'),'-m',(Join-Path $rootPath '.local\voice-runtime\ggml-tiny.bin'),'-f',(Join-Path $rootPath ".local\voice-temp\$candidateId\audio.wav"),'-l','ko','-t','2','-ng','-nt','-np','-bs','1','-bo','1')
  for ($i=0;$i -lt $required.Count;$i++) { if ($expected[$i] -ine $required[$i]) { throw 'PROCESS_SCOPE_INVALID' } }
  if (Owner-IsLive) { @{state='OWNER_ALIVE';stopped=0} | ConvertTo-Json -Compress; exit 0 }
  $targets = New-Object System.Collections.Generic.List[object]
  try {
    # Open handles pin identity while CIM supplies argv. No process-name-only termination.
    foreach ($row in @(Get-CimInstance Win32_Process -Filter "Name='whisper-cli.exe'")) {
      if ([string]::IsNullOrWhiteSpace([string]$row.CommandLine)) { throw 'PROCESS_ARGUMENTS_UNVERIFIABLE' }
      $preliminary = [PixelVoiceProcess]::Arguments([string]$row.CommandLine)
      if (@($preliminary | Where-Object { $_ -eq $expected[4] }).Count -eq 0) { continue }
      $h = Open-VoiceProcess ([int]$row.ProcessId) $true
      if ($h -eq [IntPtr]::Zero) { continue }
      $keep = $false
      try {
        if ([PixelVoiceProcess]::WaitForSingleObject($h,0) -eq 0) { continue }
        $row = Get-CimInstance Win32_Process -Filter "ProcessId=$($row.ProcessId)"
        if (-not $row -or [string]::IsNullOrWhiteSpace([string]$row.CommandLine)) { throw 'PROCESS_ARGUMENTS_UNVERIFIABLE' }
        $actual = [PixelVoiceProcess]::Arguments([string]$row.CommandLine)
        $mentionsInput = @($actual | Where-Object { $_ -eq $expected[4] }).Count -gt 0
        if (-not $mentionsInput) { continue }
        if ([PixelVoiceProcess]::Image($h) -ine $expected[0] -or [PixelVoiceProcess]::Sid($h) -ne $OwnerSid -or $actual.Count -ne $expected.Count) { throw 'PROCESS_SCOPE_UNVERIFIABLE' }
        for ($i=0;$i -lt $expected.Count;$i++) { if ($actual[$i] -ine $expected[$i]) { throw 'PROCESS_ARGUMENTS_UNVERIFIABLE' } }
        $targets.Add(@{handle=$h;pid=[int]$row.ProcessId;created=[PixelVoiceProcess]::Created($h)})
        $keep = $true
      } finally { if (-not $keep) { [void][PixelVoiceProcess]::CloseHandle($h) } }
    }
    if ($targets.Count -gt 1) { throw 'PROCESS_MULTIPLE_MATCHES' }
    $stopped = 0
    foreach ($target in $targets) {
      if (Owner-IsLive) { throw 'PROCESS_OWNER_ALIVE' }
      if ([PixelVoiceProcess]::Created($target.handle) -ne $target.created -or [PixelVoiceProcess]::Image($target.handle) -ine $expected[0] -or [PixelVoiceProcess]::Sid($target.handle) -ne $OwnerSid) { throw 'PROCESS_IDENTITY_CHANGED' }
      if ([PixelVoiceProcess]::WaitForSingleObject($target.handle,0) -ne 0) {
        if (-not [PixelVoiceProcess]::TerminateProcess($target.handle,125) -or [PixelVoiceProcess]::WaitForSingleObject($target.handle,5000) -ne 0) { throw 'PROCESS_STOP_UNVERIFIABLE' }
        $stopped++
      }
    }
    @{state='OWNER_GONE_NATIVE_CLOSED';stopped=$stopped} | ConvertTo-Json -Compress
  } finally { foreach ($target in $targets) { [void][PixelVoiceProcess]::CloseHandle($target.handle) } }
} catch {
  # Never disclose CIM argv or raw exception text to application output.
  $safeCode = 'VOICE_PROCESS_UNVERIFIABLE'
  if ($_.Exception.Message -match '^PROCESS_[A-Z_]+$') { $safeCode = 'VOICE_' + $_.Exception.Message }
  @{state='UNVERIFIABLE';code=$safeCode;stopped=0} | ConvertTo-Json -Compress
  exit 1
}

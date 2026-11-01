Option Explicit

' A GUI script host hides PowerShell at process creation, before its own
' -WindowStyle parameter can run. Wait so the scheduled job owns its lifetime.
If WScript.Arguments.Count <> 1 Then WScript.Quit 2
Dim files, shell, nodePath, scriptPath, powerShell, command
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
nodePath = WScript.Arguments(0)
If InStr(nodePath, Chr(34)) Or InStr(nodePath, "%") Or InStr(nodePath, vbCr) Or InStr(nodePath, vbLf) Then WScript.Quit 2
If Not files.FileExists(nodePath) Then WScript.Quit 2
If LCase(files.GetFileName(nodePath)) <> "node.exe" Then WScript.Quit 2
scriptPath = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "windows-local-api.ps1")
powerShell = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
command = Chr(34) & powerShell & Chr(34) & " -NoProfile -NonInteractive -WindowStyle Hidden -File " & Chr(34) & scriptPath & Chr(34) & " -Action Run -NodePath " & Chr(34) & nodePath & Chr(34)
WScript.Quit shell.Run(command, 0, True)

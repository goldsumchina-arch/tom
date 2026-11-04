' ============================================================================
' hidden_launcher.vbs  --  NO-WINDOW launcher for scheduled tasks
' 计划任务专用「无窗口启动器」：任何 .ps1 / .bat / .cmd / .exe 都能在完全不可见
' 的情况下运行，桌面上不会再出现黑色控制台窗口。
'
' 为什么需要它（根因，与 backup_hidden.vbs 同一套原理）：
'   任务计划程序用当前登录用户（InteractiveToken）直接启动 powershell.exe /
'   cmd.exe 时，Windows 会先在交互桌面上给这个【控制台子系统程序】创建一个控制台
'   窗口，之后程序才解析自己的参数（例如 powershell 的 -WindowStyle Hidden）——
'   窗口已经先出现了。脚本里再调用 python.exe / ssh.exe / scp.exe，它们会把输出
'   画进那个窗口，于是黑框会一直停在屏幕上。
'
'   用 wscript.exe（GUI 子系统程序，本身没有控制台）来启动，并调用
'   WScript.Shell.Run(cmd, 0, False)：
'       · 第 2 参数 0  = SW_HIDE，子进程控制台从创建那一刻就是隐藏的；
'       · 第 3 参数 False = 不等待，任务立刻结束，实际工作在后台跑完。
'   这样从任务启动到所有子进程结束，全链路都不会出现可见窗口。
'
' 用法（放在任务计划的「操作」里）：
'   wscript.exe //nologo "C:\gs-project\hidden_launcher.vbs" "C:\gs-project\refresh_prices.ps1"
'   目标文件不存在时静默退出（退出码 3），绝不弹任何提示框。
'
' 手动测试：双击本文件不会做任何事（没参数）；命令行可带参数运行做验证。
' ============================================================================
Option Explicit

Dim fso, sh, args, target, extra, i, cmd, ext

Set fso  = CreateObject("Scripting.FileSystemObject")
Set sh   = CreateObject("WScript.Shell")
Set args = WScript.Arguments

If args.Count = 0 Then WScript.Quit 2

target = args(0)
extra  = ""
For i = 1 To args.Count - 1
    extra = extra & " " & Chr(34) & args(i) & Chr(34)
Next

' 目标不存在 → 静默退出（不能在无人值守的清晨弹出任何东西）
If Not fso.FileExists(target) Then WScript.Quit 3

' 工作目录设为脚本所在目录（与原计划任务 "Start In" 的语义一致）
sh.CurrentDirectory = fso.GetParentFolderName(target)

ext = LCase(fso.GetExtensionName(target))

If ext = "ps1" Then
    cmd = "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden" & _
          " -ExecutionPolicy Bypass -File """ & target & """" & extra
ElseIf ext = "bat" Or ext = "cmd" Then
    cmd = "cmd.exe /c """ & target & """" & extra
Else
    cmd = """" & target & """" & extra
End If

' 0 = 隐藏窗口；False = 不等待
sh.Run cmd, 0, False
WScript.Quit 0

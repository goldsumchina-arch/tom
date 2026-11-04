' ============================================================================
' backup_hidden.vbs  --  BACKUP-NOWINDOW-20261104
' 作用：把每日数据库备份（backup_tencent.ps1）在【完全无窗口】的情况下启动。
'
' 为什么需要它（根因）：
'   计划任务原来直接调用
'       powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File backup_tencent.ps1
'   powershell.exe 是【控制台程序】：任务计划程序用当前登录用户（InteractiveToken）
'   启动它时，Windows 会先给它在交互桌面上创建一个控制台窗口（黑框），
'   之后 PowerShell 才解析 -WindowStyle Hidden —— 于是黑框已经先出现了，
'   而且脚本里调用的 ssh.exe / scp.exe 还会把自己的进度条输出到那个黑框里。
'   结论：-WindowStyle Hidden 挡不住「控制台程序被任务计划程序启动」这一件事。
'
' 正确做法：
'   改用 wscript.exe（GUI 子系统程序，本身没有控制台）来启动 PowerShell，
'   并用 WScript.Shell.Run(cmd, 0, False)：
'       · 第 2 参数 0 = SW_HIDE，子进程的控制台窗口创建时就是隐藏的；
'       · 第 3 参数 False = 不等待（任务立刻结束，备份在后台自己跑完）。
'   这样从任务启动到 ssh/scp 结束，全链路都不会出现任何可见窗口。
'
' 手动测试：双击本文件即可（同样不会弹窗），结果看 backup.log。
' ============================================================================
Option Explicit

Dim fso, sh, base, ps1, cmd

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

base = fso.GetParentFolderName(WScript.ScriptFullName)
ps1  = base & "\backup_tencent.ps1"

If Not fso.FileExists(ps1) Then
    ' 脚本缺失时静默退出（不能再弹 MsgBox，否则又变成"每天一个窗口"）
    WScript.Quit 2
End If

cmd = "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden" & _
      " -ExecutionPolicy Bypass -File """ & ps1 & """"

' 0 = 隐藏窗口；False = 不等待
sh.Run cmd, 0, False
WScript.Quit 0

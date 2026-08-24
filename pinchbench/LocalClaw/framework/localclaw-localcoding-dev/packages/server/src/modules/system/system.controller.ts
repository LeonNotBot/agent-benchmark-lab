import { Controller, Post } from "@nestjs/common";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

@Controller("api/system")
export class SystemController {
  @Post("browse-folder")
  async browseFolder(): Promise<{ path: string | null }> {
    try {
      const selected = await this.openFolderDialog();
      return { path: selected || null };
    } catch {
      return { path: null };
    }
  }

  private async openFolderDialog(): Promise<string> {
    if (process.platform === "win32") {
      return this.openFolderDialogWindows();
    }
    // macOS / Linux fallback using zenity or osascript
    if (process.platform === "darwin") {
      return this.openFolderDialogMac();
    }
    return this.openFolderDialogLinux();
  }

  private async openFolderDialogWindows(): Promise<string> {
    // 用一个 TopMost 隐藏窗口作 owner，确保对话框弹到最前，
    // 否则 FolderBrowserDialog 常被主窗口遮挡，用户看不到误以为「卡住没反应」。
    const script = `
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "选择工作目录"
$dialog.ShowNewFolderButton = $true
$result = $dialog.ShowDialog($owner)
$owner.Dispose()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.SelectedPath
}`.trim();
    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile", "-NonInteractive", "-STA", "-Command", script,
    ], { timeout: 120000 });
    return stdout.trim();
  }

  private async openFolderDialogMac(): Promise<string> {
    const script = 'choose folder';
    const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 60000 });
    // osascript returns "alias Macintosh HD:Users:..." — convert to POSIX
    const raw = stdout.trim().replace(/^alias /, "");
    return "/" + raw.split(":").slice(1).join("/");
  }

  private async openFolderDialogLinux(): Promise<string> {
    const { stdout } = await execFileAsync("zenity", [
      "--file-selection", "--directory", "--title=Select folder",
    ], { timeout: 60000 });
    return stdout.trim();
  }
}

/**
 * The platform folder picker, so the wizard's path fields can be chosen in
 * the system file explorer instead of typed by hand.
 *
 * A browser page cannot learn a native absolute path, but this console is a
 * local CLI's page, so the CLI opens the real dialog and hands the path back.
 * On Windows that means the modern IFileDialog (explorer-style, with the
 * navigation pane), driven through an inline C# interop shim — not the aged
 * WinForms tree dialog.
 *
 * @module a2a-host/pick
 */

import { spawn } from 'node:child_process'

/** Run one command and collect its output, on a human timescale. */
function run(command: string, args: string[], timeoutMs = 600_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args)
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { child.kill() }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: String(error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

/** The modern explorer-style folder dialog, via IFileDialog + FOS_PICKFOLDERS. */
const FOLDER_PICKER_CS = `using System;
using System.Runtime.InteropServices;

public class FolderPicker
{
    public string InitialPath;
    public string Title;

    [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
    private class FileOpenDialogRCW { }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItem item);

    [Flags]
    private enum FOS : uint
    {
        PICKFOLDERS = 0x20,
        FORCEFILESYSTEM = 0x40,
        PATHMUSTEXIST = 0x800,
    }

    private enum SIGDN : uint
    {
        FILESYSPATH = 0x80058000,
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName(SIGDN sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        void Compare(IShellItem psi, uint hint, out int piOrder);
    }

    [ComImport, Guid("D57C7288-D4AD-4768-BE02-9D969532D960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOpenDialog
    {
        [PreserveSig] int Show(IntPtr hwndOwner);
        void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
        void SetFileTypeIndex(uint iFileType);
        void GetFileTypeIndex(out uint piFileType);
        void Advise(IntPtr pfde, out uint pdwCookie);
        void Unadvise(uint dwCookie);
        void SetOptions(FOS fos);
        void GetOptions(out FOS pfos);
        void SetDefaultFolder(IShellItem psi);
        void SetFolder(IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName(string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle(string pszTitle);
        void SetOkButtonLabel(string pszText);
        void SetFileNameLabel(string pszLabel);
        void GetResult(out IShellItem ppsi);
        void AddPlace(IShellItem psi, int fdap);
        void SetDefaultExtension(string pszDefaultExtension);
        void Close(int hr);
        void SetClientGuid(IntPtr guid);
        void ClearClientData();
        void SetFilter(IntPtr pFilter);
        void GetResults(out IntPtr ppenum);
        void GetSelectedItems(out IntPtr ppsai);
    }

    public string Show()
    {
        var dialog = (IFileOpenDialog)new FileOpenDialogRCW();
        try
        {
            if (!string.IsNullOrEmpty(InitialPath))
            {
                var gid = typeof(IShellItem).GUID;
                IShellItem item;
                SHCreateItemFromParsingName(InitialPath, IntPtr.Zero, ref gid, out item);
                dialog.SetFolder(item);
            }
            FOS options;
            dialog.GetOptions(out options);
            dialog.SetOptions(options | FOS.PICKFOLDERS | FOS.FORCEFILESYSTEM | FOS.PATHMUSTEXIST);
            if (!string.IsNullOrEmpty(Title)) dialog.SetTitle(Title);
            int hr = dialog.Show(GetForegroundWindow());
            if (hr != 0) return null;
            IShellItem result;
            dialog.GetResult(out result);
            string path;
            result.GetDisplayName(SIGDN.FILESYSPATH, out path);
            return path;
        }
        finally
        {
            Marshal.ReleaseComObject(dialog);
        }
    }
}
`

/** The PowerShell driving script (compiled C# + one dialog round-trip). */
const WINDOWS_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  "$cs = @'",
  FOLDER_PICKER_CS,
  "'@",
  'Add-Type -TypeDefinition $cs',
  "$picker = New-Object FolderPicker",
  "$picker.Title = 'Talk2MyAgent: choose a directory'",
  '$result = $picker.Show()',
  'if ($null -ne $result -and $result.Length -gt 0) { Write-Output $result }',
].join('\n')

/** powershell.exe -EncodedCommand wants UTF-16LE base64. */
const encoded = (script: string): string => Buffer.from(script, 'utf16le').toString('base64')

/**
 * Open the platform folder dialog and resolve the chosen path.
 * @returns the path, or a short reason none was chosen (cancel included).
 */
export async function pickDirectory(): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  if (process.platform === 'win32') {
    const result = await run('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encoded(WINDOWS_SCRIPT)])
    const path = result.stdout.trim()
    if (result.code === 0 && path.length > 0) return { ok: true, path }
    return { ok: false, reason: 'canceled' }
  }
  if (process.platform === 'darwin') {
    const result = await run('osascript', ['-e', 'POSIX path of (choose folder with prompt "Talk2MyAgent: choose a directory")'])
    // AppleScript returns the chosen folder with a trailing slash.
    const path = result.stdout.trim().replace(/\/+$/, '')
    if (result.code === 0 && path.length > 0) return { ok: true, path }
    return { ok: false, reason: 'canceled' }
  }
  const result = await run('zenity', ['--file-selection', '--directory', '--title=Talk2MyAgent: choose a directory'])
  const path = result.stdout.trim()
  if (result.code === 0 && path.length > 0) return { ok: true, path }
  if (result.code === -1) {
    return { ok: false, reason: 'zenity not installed (Linux needs zenity for the folder dialog)' }
  }
  return { ok: false, reason: 'canceled' }
}

/** Whether the Windows picker shim compiles — the smoke test for the dialog. */
export async function smokeTestWindowsPicker(): Promise<{ ok: boolean; output: string }> {
  const lines = WINDOWS_SCRIPT.split('\n')
  const end = lines.indexOf("'@")
  const compileOnly = lines.slice(0, end + 1 + 1).join('\n')
  const result = await run('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encoded(compileOnly)])
  return { ok: result.code === 0, output: result.stderr.trim() || result.stdout.trim() }
}

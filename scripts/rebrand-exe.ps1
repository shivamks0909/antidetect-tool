$script = @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public class PeBrander {
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr BeginUpdateResource(string pFileName, bool bDeleteExistingResources);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool UpdateResource(IntPtr hUpdate, IntPtr lpType, IntPtr lpName, ushort wLanguage, byte[] lpData, uint cbData);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool EndUpdateResource(IntPtr hUpdate, bool fDiscard);
}
'@
Add-Type -TypeDefinition $script -ErrorAction SilentlyContinue

$exes = @(
    (Resolve-Path "src-tauri/resources/Opinion-Insights-Engine/chrome.exe").Path,
    "$env:APPDATA\opinion-insights-browser\runtime\Opinion-Insights-Engine\chrome.exe"
)

$dlls = @(
    (Resolve-Path "src-tauri/resources/Opinion-Insights-Engine/chrome.dll").Path,
    "$env:APPDATA\opinion-insights-browser\runtime\Opinion-Insights-Engine\chrome.dll"
)

$vBytes = [System.IO.File]::ReadAllBytes((Resolve-Path "scripts/test-version.bin").Path)
$grpBytes = [System.IO.File]::ReadAllBytes((Resolve-Path "scripts/grp_mainframe.bin").Path)

foreach ($exe in $exes) {
    if (-not (Test-Path $exe)) {
        Write-Host "File not found: $exe"
        continue
    }
    Write-Host "Rebranding $exe..."
    $h = [PeBrander]::BeginUpdateResource($exe, $false)
    if ($h -eq [IntPtr]::Zero) {
        Write-Error "Failed to begin resource update on $exe"
        continue
    }

    # 1. Update RT_VERSION (16)
    $okV = [PeBrander]::UpdateResource($h, [IntPtr]16, [IntPtr]1, 1033, $vBytes, $vBytes.Length)
    Write-Host "  RT_VERSION update: $okV"

    # 2. Update IDR_MAINFRAME (14)
    $namePtr = [System.Runtime.InteropServices.Marshal]::StringToHGlobalUni("IDR_MAINFRAME")
    $okGrp = [PeBrander]::UpdateResource($h, [IntPtr]14, $namePtr, 1033, $grpBytes, $grpBytes.Length)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($namePtr)
    Write-Host "  IDR_MAINFRAME update: $okGrp"

    # 3. Update RT_ICON (3) #1 to #6
    for ($i = 1; $i -le 6; $i++) {
        $icBytes = [System.IO.File]::ReadAllBytes((Resolve-Path "scripts/icon_$i.bin").Path)
        $icOk = [PeBrander]::UpdateResource($h, [IntPtr]3, [IntPtr]$i, 1033, $icBytes, $icBytes.Length)
        Write-Host "  RT_ICON #$($i) update: $icOk"
    }

    $endOk = [PeBrander]::EndUpdateResource($h, $false)
    Write-Host "  EndUpdateResource: $endOk"

    $vi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
    Write-Host "  Verified FileDescription: $($vi.FileDescription)"
    Write-Host "  Verified ProductName: $($vi.ProductName)"
    Write-Host "  Verified CompanyName: $($vi.CompanyName)"
}

foreach ($dll in $dlls) {
    if (-not (Test-Path $dll)) {
        Write-Host "File not found: $dll"
        continue
    }
    Write-Host "Rebranding RT_VERSION in $dll..."
    $h = [PeBrander]::BeginUpdateResource($dll, $false)
    if ($h -ne [IntPtr]::Zero) {
        $okV = [PeBrander]::UpdateResource($h, [IntPtr]16, [IntPtr]1, 1033, $vBytes, $vBytes.Length)
        $endOk = [PeBrander]::EndUpdateResource($h, $false)
        Write-Host "  RT_VERSION update in dll: $okV, EndUpdate: $endOk"
    }
}

Write-Host "All PE binary resources updated successfully!"

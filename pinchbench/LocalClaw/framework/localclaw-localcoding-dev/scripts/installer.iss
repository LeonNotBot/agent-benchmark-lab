; Local Claw - Inno Setup Installer Script
; Usage: ISCC.exe /DMyAppVersion="x.y.z" scripts\installer.iss

#ifndef MyAppVersion
  #define MyAppVersion "0.1.0"
#endif

#define MyAppName "LocalCoding"
#define MyAppPublisher "lenovo LocalClaw"
#define MyAppURL "https://www.lenovo.com"
#define MyAppExeName "LocalCoding.exe"

[Setup]
AppId={{B0F5A6D2-3E8C-4F91-9D7A-2C8E5F1B6A3D}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DisableDirPage=no
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\release
OutputBaseFilename=LocalCoding-win-setup-{#MyAppVersion}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\release\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
function GetUninstallString: String;
var
  UninstallKey: String;
begin
  Result := '';
  UninstallKey := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#emit SetupSetting("AppId")}_is1';
  if not RegQueryStringValue(HKLM, UninstallKey, 'UninstallString', Result) then
    RegQueryStringValue(HKCU, UninstallKey, 'UninstallString', Result);
end;

function IsUpgrade: Boolean;
begin
  Result := (GetUninstallString <> '');
end;

function InitializeSetup: Boolean;
var
  UninstallPath: String;
  ResultCode: Integer;
begin
  Result := True;
  if IsUpgrade then
  begin
    UninstallPath := RemoveQuotes(GetUninstallString);
    if UninstallPath <> '' then
    begin
      if MsgBox('检测到已安装的旧版本，是否先卸载？', mbConfirmation, MB_YESNO) = IDYES then
      begin
        if not Exec(RemoveQuotes(UninstallPath), '/SILENT', '', SW_SHOW, ewWaitUntilTerminated, ResultCode) then
        begin
          MsgBox('卸载失败，请手动卸载后再安装。', mbError, MB_OK);
          Result := False;
        end;
      end;
    end;
  end;
end;

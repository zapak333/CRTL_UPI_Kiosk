; CRTL Canteen Kiosk - Windows installer (Inno Setup 6)
; Built by packaging\windows\build.ps1, which passes AppVersion, StageDir and OutputDir.

#ifndef AppVersion
  #define AppVersion "1.0.0.0"
#endif
#ifndef StageDir
  #define StageDir "..\..\build\stage"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\build\installer"
#endif

#define AppName "CRTL Canteen Kiosk"
#define DataDir "{commonappdata}\CRTLKiosk"

[Setup]
AppId={{CDD6B130-4EB7-4516-834C-F6FC70EB8AB8}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=CRTL
VersionInfoVersion={#AppVersion}
DefaultDirName={autopf}\CRTL Kiosk
DefaultGroupName=CRTL Kiosk
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=CRTL-Kiosk-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\node\node.exe
CloseApplications=no
InfoBeforeFile={#StageDir}\README-INSTALL.txt

[Tasks]
Name: "autostart"; Description: "Open the kiosk screen automatically when Windows starts (tick this on the touchscreen PC)"; Flags: unchecked
Name: "desktopicons"; Description: "Create desktop shortcuts (Kiosk screen, Admin panel)"
Name: "firewall"; Description: "Allow other PCs/phones on the local network to open the kiosk and admin pages"; Flags: unchecked
Name: "nosleep"; Description: "Keep this PC and its screen awake (no sleep on mains power)"; Flags: unchecked

[InstallDelete]
; Remove the previous version's app code so deleted files do not linger after an upgrade
Type: filesandordirs; Name: "{app}\app"

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Dirs]
Name: "{#DataDir}"

[INI]
Filename: "{group}\Open admin panel.url"; Section: "InternetShortcut"; Key: "URL"; String: "http://localhost:{code:GetPort}/admin"
Filename: "{autodesktop}\CRTL Admin panel.url"; Section: "InternetShortcut"; Key: "URL"; String: "http://localhost:{code:GetPort}/admin"; Tasks: desktopicons

[Icons]
Name: "{group}\Open kiosk screen"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\scripts\start-kiosk.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\node\node.exe"
Name: "{group}\Edit settings (Razorpay keys, port, backups)"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\scripts\run-as-admin.ps1"" edit-settings"
Name: "{group}\Restart kiosk server"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\scripts\run-as-admin.ps1"" restart"
Name: "{group}\Maintenance\Create an admin account"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\scripts\run-as-admin.ps1"" create-admin"
Name: "{group}\Maintenance\Back up database now"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\scripts\run-as-admin.ps1"" backup"
Name: "{group}\Maintenance\Log files"; Filename: "{#DataDir}\logs"
Name: "{group}\Maintenance\Backups folder"; Filename: "{#DataDir}\backups"
Name: "{group}\Documentation"; Filename: "{app}\docs"
Name: "{group}\Uninstall CRTL Kiosk"; Filename: "{uninstallexe}"
Name: "{autodesktop}\CRTL Kiosk screen"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\scripts\start-kiosk.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\node\node.exe"; Tasks: desktopicons
Name: "{commonstartup}\CRTL Kiosk screen"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\scripts\start-kiosk.ps1"""; WorkingDir: "{app}"; Tasks: autostart

[Run]
Filename: "{code:GetSetupUrl}"; Description: "Create the first administrator account now (opens the browser)"; Flags: shellexec postinstall nowait runasoriginaluser skipifsilent; Check: HasSetupUrl
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\scripts\start-kiosk.ps1"""; Description: "Open the kiosk screen now (press Alt+F4 to close it)"; Flags: postinstall nowait runasoriginaluser skipifsilent unchecked; Check: SetupSucceeded

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\uninstall.ps1"" -AppDir ""{app}"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveServices"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\config"
Type: filesandordirs; Name: "{app}\service"

[Code]
var
  PortPage: TInputQueryWizardPage;
  PayModePage: TInputOptionWizardPage;
  KeysPage: TInputQueryWizardPage;
  IsUpgrade: Boolean;
  SetupOk: Boolean;
  SetupUrl: String;
  ExistingPort: String;

function EnvFile(): String;
begin
  Result := ExpandConstant('{commonappdata}\CRTLKiosk\.env');
end;

function ReadEnvValue(Key: String): String;
var
  Lines: TArrayOfString;
  I: Integer;
begin
  Result := '';
  if LoadStringsFromFile(EnvFile(), Lines) then
    for I := 0 to GetArrayLength(Lines) - 1 do
      if Pos(Key + '=', Trim(Lines[I])) = 1 then
        Result := Trim(Copy(Trim(Lines[I]), Length(Key) + 2, 1000));
end;

procedure InitializeWizard();
begin
  IsUpgrade := FileExists(EnvFile());
  if IsUpgrade then
    ExistingPort := ReadEnvValue('PORT');

  PortPage := CreateInputQueryPage(wpSelectTasks,
    'Server port', 'Which port should the kiosk server use?',
    'The kiosk screen and the admin panel will open at http://localhost:<port>. Keep 8080 unless another program already uses it.');
  PortPage.Add('Port:', False);
  PortPage.Values[0] := '8080';

  PayModePage := CreateInputOptionPage(PortPage.ID,
    'Payments', 'How should customers pay?',
    'You can change this later from Start menu > CRTL Kiosk > Edit settings.', True, False);
  PayModePage.Add('Simulated payments (for testing - no real money moves)');
  PayModePage.Add('Razorpay UPI QR (real payments - needs your Razorpay API keys)');
  PayModePage.SelectedValueIndex := 0;

  KeysPage := CreateInputQueryPage(PayModePage.ID,
    'Razorpay keys', 'Enter the API keys from your Razorpay dashboard',
    'Dashboard > Account & Settings > API Keys. Use TEST keys (rzp_test_...) until you have tested a full order. The keys are stored only on this PC, in a file that only administrators can read. The webhook secret can be left empty and added later.');
  KeysPage.Add('Key ID:', False);
  KeysPage.Add('Key secret:', True);
  KeysPage.Add('Webhook secret (optional):', True);
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  { On an upgrade the existing settings file is kept, so these pages are not needed }
  if IsUpgrade and ((PageID = PortPage.ID) or (PageID = PayModePage.ID) or (PageID = KeysPage.ID)) then
    Result := True
  else if (PageID = KeysPage.ID) and (PayModePage.SelectedValueIndex <> 1) then
    Result := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  P: Integer;
begin
  Result := True;
  if CurPageID = PortPage.ID then
  begin
    P := StrToIntDef(Trim(PortPage.Values[0]), 0);
    if (P < 1) or (P > 65535) then
    begin
      MsgBox('Please enter a port number between 1 and 65535.', mbError, MB_OK);
      Result := False;
    end;
  end
  else if CurPageID = KeysPage.ID then
  begin
    if (Pos('rzp_', Trim(KeysPage.Values[0])) <> 1) or (Trim(KeysPage.Values[1]) = '') then
    begin
      MsgBox('Enter the Razorpay Key ID (starts with rzp_) and the Key secret, or go Back and choose simulated payments.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function GetPort(Param: String): String;
begin
  if IsUpgrade and (ExistingPort <> '') then
    Result := ExistingPort
  else
    Result := IntToStr(StrToIntDef(Trim(PortPage.Values[0]), 8080));
end;

function HasSetupUrl(): Boolean;
begin
  Result := SetupOk and (SetupUrl <> '');
end;

function SetupSucceeded(): Boolean;
begin
  Result := SetupOk;
end;

function GetSetupUrl(Param: String): String;
begin
  Result := SetupUrl;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  RC: Integer;
begin
  { Upgrade: stop the services so their files can be replaced; setup.ps1 starts them again }
  Exec(ExpandConstant('{sys}\net.exe'), 'stop CRTLKioskServer', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(ExpandConstant('{sys}\net.exe'), 'stop CRTLKioskDB', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Result := '';
end;

function BoolStr(B: Boolean): String;
begin
  if B then Result := '1' else Result := '0';
end;

procedure RunPostInstallSetup();
var
  Opts: TArrayOfString;
  Res: TArrayOfString;
  OptFile, ResFile, Provider, Params: String;
  RC, I: Integer;
begin
  OptFile := ExpandConstant('{tmp}\install-options.txt');
  ResFile := ExpandConstant('{tmp}\install-result.txt');
  if PayModePage.SelectedValueIndex = 1 then Provider := 'razorpay' else Provider := 'simulated';
  SetArrayLength(Opts, 7);
  Opts[0] := 'PORT=' + GetPort('');
  Opts[1] := 'PAYMENT_PROVIDER=' + Provider;
  if Provider = 'razorpay' then
  begin
    Opts[2] := 'RAZORPAY_KEY_ID=' + Trim(KeysPage.Values[0]);
    Opts[3] := 'RAZORPAY_KEY_SECRET=' + Trim(KeysPage.Values[1]);
    Opts[4] := 'RAZORPAY_WEBHOOK_SECRET=' + Trim(KeysPage.Values[2]);
  end;
  Opts[5] := 'FIREWALL=' + BoolStr(WizardIsTaskSelected('firewall'));
  Opts[6] := 'NOSLEEP=' + BoolStr(WizardIsTaskSelected('nosleep'));
  SaveStringsToFile(OptFile, Opts, False);

  WizardForm.StatusLabel.Caption := 'Setting up the database and starting the kiosk server. This can take a minute...';
  WizardForm.ProgressGauge.Style := npbstMarquee;
  Params := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\scripts\setup.ps1') + '"' +
            ' -AppDir "' + ExpandConstant('{app}') + '" -OptionsFile "' + OptFile + '" -ResultFile "' + ResFile + '"';
  SetupOk := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Params, '', SW_HIDE, ewWaitUntilTerminated, RC) and (RC = 0);
  WizardForm.ProgressGauge.Style := npbstNormal;
  DeleteFile(OptFile);

  if SetupOk then
  begin
    if LoadStringsFromFile(ResFile, Res) then
      for I := 0 to GetArrayLength(Res) - 1 do
        if Pos('SETUP_URL=', Res[I]) = 1 then
          SetupUrl := Copy(Res[I], 11, 1000);
    DeleteFile(ResFile);
    Log('Post-install setup finished. Server port ' + GetPort(''));
  end
  else
  begin
    Log('Post-install setup FAILED, exit code ' + IntToStr(RC));
    SuppressibleMsgBox('The files were installed, but the kiosk server could not be set up or started.' + #13#10#13#10 +
      'Details are in ' + ExpandConstant('{commonappdata}\CRTLKiosk\logs\install.log') + '.' + #13#10 +
      'You can run the installer again to retry.', mbError, MB_OK, IDOK);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    RunPostInstallSetup();
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = wpFinished) and SetupOk then
    WizardForm.FinishedLabel.Caption :=
      'The kiosk server is installed and running as a Windows service (it starts automatically with Windows).' + #13#10#13#10 +
      'Kiosk screen:  http://localhost:' + GetPort('') + '/kiosk' + #13#10 +
      'Admin panel:   http://localhost:' + GetPort('') + '/admin' + #13#10#13#10 +
      'Shortcuts are in the Start menu under "CRTL Kiosk". Configure the receipt printer in the admin panel under Settings.';
end;

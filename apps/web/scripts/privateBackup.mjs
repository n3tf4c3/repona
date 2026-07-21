import {
  chmodSync,
  lstatSync,
  mkdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { isAbsolute } from "node:path";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const FULL_CONTROL = 2_032_127;
const SYSTEM_SID = "S-1-5-18";
const ADMINISTRATORS_SID = "S-1-5-32-544";

// Windows PowerShell 5.1 exposes the .NET ACL APIs on every supported Windows
// host. The target travels through the process environment, never interpolated
// into PowerShell source, so spaces/metacharacters cannot become commands.
const WINDOWS_ACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'

$target = [Environment]::GetEnvironmentVariable('REPONA_PRIVATE_PATH', 'Process')
$kind = [Environment]::GetEnvironmentVariable('REPONA_PRIVATE_KIND', 'Process')
$action = [Environment]::GetEnvironmentVariable('REPONA_PRIVATE_ACTION', 'Process')
if ([string]::IsNullOrWhiteSpace($target)) { throw 'PRIVATE_PATH_MISSING' }
if ($kind -ne 'directory' -and $kind -ne 'file') { throw 'PRIVATE_KIND_INVALID' }

$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$administratorsSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$sids = @($currentSid, $systemSid, $administratorsSid) |
  Group-Object -Property Value |
  ForEach-Object { $_.Group[0] }

if ($action -eq 'secure') {
  if ($kind -eq 'directory') {
    $security = [System.Security.AccessControl.DirectorySecurity]::new()
    $security.SetAccessRuleProtection($true, $false)
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    foreach ($sid in $sids) {
      $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $sid,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        $inheritance,
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
      )
      [void]$security.AddAccessRule($rule)
    }
    [System.IO.Directory]::SetAccessControl($target, $security)
  } else {
    $security = [System.Security.AccessControl.FileSecurity]::new()
    $security.SetAccessRuleProtection($true, $false)
    foreach ($sid in $sids) {
      $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $sid,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.AccessControlType]::Allow
      )
      [void]$security.AddAccessRule($rule)
    }
    [System.IO.File]::SetAccessControl($target, $security)
  }
} elseif ($action -ne 'inspect') {
  throw 'PRIVATE_ACTION_INVALID'
}

$sections = [System.Security.AccessControl.AccessControlSections]::Access
if ($kind -eq 'directory') {
  $actual = [System.IO.Directory]::GetAccessControl($target, $sections)
} else {
  $actual = [System.IO.File]::GetAccessControl($target, $sections)
}
$rules = @($actual.GetAccessRules(
  $true,
  $true,
  [System.Security.Principal.SecurityIdentifier]
)) | ForEach-Object {
  [PSCustomObject]@{
    sid = $_.IdentityReference.Value
    rights = [int]$_.FileSystemRights
    type = [int]$_.AccessControlType
    inherited = [bool]$_.IsInherited
    inheritance = [int]$_.InheritanceFlags
    propagation = [int]$_.PropagationFlags
  }
}

[PSCustomObject]@{
  protected = [bool]$actual.AreAccessRulesProtected
  currentSid = $currentSid.Value
  rules = @($rules)
} | ConvertTo-Json -Compress -Depth 4
`;

const WINDOWS_ACL_COMMAND = Buffer.from(WINDOWS_ACL_SCRIPT, "utf16le").toString("base64");

function assertAbsolute(path) {
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw new Error("PRIVATE_BACKUP_PATH_MUST_BE_ABSOLUTE");
  }
}

function assertExpectedType(path, kind) {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink()) throw new Error("PRIVATE_BACKUP_SYMLINK_REJECTED");
  if (kind === "directory" ? !entry.isDirectory() : !entry.isFile()) {
    throw new Error(`PRIVATE_BACKUP_NOT_${kind.toUpperCase()}`);
  }
}

function runWindowsAcl(path, kind, action) {
  let output;
  try {
    output = execFileSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-InputFormat",
        "None",
        "-OutputFormat",
        "Text",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        WINDOWS_ACL_COMMAND,
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        // Windows PowerShell 5.1 may emit a serialized first-use progress record
        // on stderr even on success. ACL errors are fail-closed by exit status;
        // suppress that noisy, localized stream and expose only sanitized codes.
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 15_000,
        env: {
          ...process.env,
          REPONA_PRIVATE_PATH: path,
          REPONA_PRIVATE_KIND: kind,
          REPONA_PRIVATE_ACTION: action,
          POWERSHELL_TELEMETRY_OPTOUT: "1",
        },
      },
    );
  } catch (error) {
    throw new Error("PRIVATE_BACKUP_WINDOWS_ACL_FAILED", { cause: error });
  }

  try {
    return JSON.parse(output.trim());
  } catch (error) {
    throw new Error("PRIVATE_BACKUP_WINDOWS_ACL_INVALID_RESULT", { cause: error });
  }
}

function validateWindowsSummary(summary, kind) {
  const expected = new Set([summary.currentSid, SYSTEM_SID, ADMINISTRATORS_SID]);
  if (!summary.protected || !Array.isArray(summary.rules) || summary.rules.length !== expected.size) {
    throw new Error("PRIVATE_BACKUP_WINDOWS_ACL_NOT_PRIVATE");
  }

  for (const rule of summary.rules) {
    const directoryInheritance = kind === "directory" ? 3 : 0;
    if (
      !expected.delete(rule.sid) ||
      rule.inherited !== false ||
      rule.type !== 0 ||
      (rule.rights & FULL_CONTROL) !== FULL_CONTROL ||
      rule.inheritance !== directoryInheritance ||
      rule.propagation !== 0
    ) {
      throw new Error("PRIVATE_BACKUP_WINDOWS_ACL_NOT_PRIVATE");
    }
  }
  if (expected.size !== 0) throw new Error("PRIVATE_BACKUP_WINDOWS_ACL_NOT_PRIVATE");
}

function secureExistingPath(path, kind) {
  assertAbsolute(path);
  assertExpectedType(path, kind);

  if (process.platform === "win32") {
    validateWindowsSummary(runWindowsAcl(path, kind, "secure"), kind);
    return;
  }

  const expectedMode = kind === "directory" ? DIRECTORY_MODE : FILE_MODE;
  // chmod is deliberately unconditional: mkdir/write modes do not repair an
  // already-existing permissive path and are affected by umask.
  chmodSync(path, expectedMode);
  const actualMode = statSync(path).mode & 0o777;
  if (actualMode !== expectedMode) throw new Error("PRIVATE_BACKUP_POSIX_MODE_NOT_PRIVATE");
}

export function ensurePrivateDirectorySync(path) {
  assertAbsolute(path);
  mkdirSync(path, { recursive: true, mode: DIRECTORY_MODE });
  secureExistingPath(path, "directory");
}

export function ensurePrivateFileSync(path) {
  secureExistingPath(path, "file");
}

export function writePrivateFileSync(path, data) {
  assertAbsolute(path);
  let created = false;
  try {
    // Never truncate an existing backup if two invocations produce the same
    // name. The parent directory must already have been secured by the caller.
    writeFileSync(path, data, { encoding: "utf8", mode: FILE_MODE, flag: "wx" });
    created = true;
    ensurePrivateFileSync(path);
  } catch (error) {
    if (created) {
      try {
        unlinkSync(path);
      } catch {
        // The original ACL/verification error is more actionable. The parent
        // directory is already private, so a failed cleanup does not expose it.
      }
    }
    throw error;
  }
}

// Exported for an OS-level regression test and for an operator-side audit. It
// reads metadata/ACL only, never file contents.
export function verifyPrivatePathSync(path, kind) {
  assertAbsolute(path);
  assertExpectedType(path, kind);
  if (process.platform === "win32") {
    validateWindowsSummary(runWindowsAcl(path, kind, "inspect"), kind);
    return true;
  }
  const expectedMode = kind === "directory" ? DIRECTORY_MODE : FILE_MODE;
  if ((statSync(path).mode & 0o777) !== expectedMode) {
    throw new Error("PRIVATE_BACKUP_POSIX_MODE_NOT_PRIVATE");
  }
  return true;
}

param(
  [switch] $SelfTest
)

$ErrorActionPreference = "Stop"
$MinimumPasswordLength = 14
$PasswordIterations = 310000

function ConvertTo-Base64Url([byte[]] $Bytes) {
  return [Convert]::ToBase64String($Bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function New-SecureRandomBytes([int] $Length) {
  $bytes = [byte[]]::new($Length)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  }
  finally {
    $generator.Dispose()
  }
  return ,$bytes
}

function New-JamesPasswordHash([string] $Password, [byte[]] $Salt) {
  $deriver = [Security.Cryptography.Rfc2898DeriveBytes]::new(
    $Password,
    $Salt,
    $PasswordIterations,
    [Security.Cryptography.HashAlgorithmName]::SHA256
  )
  try {
    $digest = $deriver.GetBytes(32)
    return "pbkdf2_sha256`$$PasswordIterations`$$(ConvertTo-Base64Url $Salt)`$$(ConvertTo-Base64Url $digest)"
  }
  finally {
    $deriver.Dispose()
  }
}

if ($SelfTest) {
  $knownSalt = [byte[]](0..15)
  $knownHash = New-JamesPasswordHash "James helper compatibility" $knownSalt
  $expectedHash = "pbkdf2_sha256`$310000`$AAECAwQFBgcICQoLDA0ODw`$-2HYy2ez1ICjUQr7Fzp0a_nFh0VhHvtmwGCRflVs-CI"
  if (-not [String]::Equals($knownHash, $expectedHash, [StringComparison]::Ordinal)) {
    throw "PBKDF2 compatibility self-test failed."
  }

  $firstRandomValue = New-SecureRandomBytes 32
  $secondRandomValue = New-SecureRandomBytes 32
  if ($firstRandomValue.Length -ne 32 -or $secondRandomValue.Length -ne 32) {
    throw "Secure random generator length self-test failed."
  }
  $randomValuesMatch = $true
  for ($index = 0; $index -lt $firstRandomValue.Length; $index += 1) {
    if ($firstRandomValue[$index] -ne $secondRandomValue[$index]) {
      $randomValuesMatch = $false
      break
    }
  }
  if ($randomValuesMatch) {
    throw "Secure random generator uniqueness self-test failed."
  }

  Write-Host "Credential helper compatibility self-test passed."
  exit 0
}

$identity = (Read-Host "Enter the private James login email").Trim().ToLowerInvariant()
if (-not [Uri]::IsWellFormedUriString("mailto:$identity", [UriKind]::Absolute) -or $identity.Length -gt 254) {
  throw "Enter a valid email address no longer than 254 characters."
}

$securePassword = $null
$secureConfirmation = $null
$passwordPointer = [IntPtr]::Zero
$confirmationPointer = [IntPtr]::Zero
$password = $null
$confirmation = $null

try {
  $securePassword = Read-Host "Enter the private James login password" -AsSecureString
  $secureConfirmation = Read-Host "Confirm the private James login password" -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $confirmationPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureConfirmation)
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $confirmation = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmationPointer)

  if ([String]::IsNullOrEmpty($password)) {
    throw "The password must not be empty."
  }
  if ($password.Length -lt $MinimumPasswordLength) {
    throw "The password must be at least $MinimumPasswordLength characters."
  }
  if ([Text.Encoding]::UTF8.GetByteCount($password) -gt 512) {
    throw "The password must be no longer than 512 UTF-8 bytes."
  }
  if (-not [String]::Equals($password, $confirmation, [StringComparison]::Ordinal)) {
    throw "The password confirmation did not match. No credentials were generated."
  }

  $salt = New-SecureRandomBytes 16
  $passwordHash = New-JamesPasswordHash $password $salt
  $sessionSecret = ConvertTo-Base64Url (New-SecureRandomBytes 32)

  Write-Host ""
  Write-Host "Copy these three values directly into Vercel Preview environment variables:"
  Write-Host "JAMES_AUTH_EMAIL=$identity"
  Write-Host "JAMES_AUTH_PASSWORD_HASH=$passwordHash"
  Write-Host "JAMES_SESSION_SECRET=$sessionSecret"
  Write-Host ""
  Write-Host "Do not save or send this output. Close this window after the values are in Vercel."
}
finally {
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  if ($confirmationPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmationPointer)
  }
  $password = $null
  $confirmation = $null
  if ($securePassword) { $securePassword.Dispose() }
  if ($secureConfirmation) { $secureConfirmation.Dispose() }
}

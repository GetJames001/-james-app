$ErrorActionPreference = "Stop"

function ConvertTo-Base64Url([byte[]] $Bytes) {
  return [Convert]::ToBase64String($Bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

$identity = (Read-Host "Enter the private James login email").Trim().ToLowerInvariant()
if (-not [Uri]::IsWellFormedUriString("mailto:$identity", [UriKind]::Absolute) -or $identity.Length -gt 254) {
  throw "Enter a valid email address no longer than 254 characters."
}

$securePassword = Read-Host "Enter the private James login password" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$password = $null
$deriver = $null

try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  if ([Text.Encoding]::UTF8.GetByteCount($password) -gt 512) {
    throw "The password must be no longer than 512 UTF-8 bytes."
  }

  $salt = [byte[]]::new(16)
  [Security.Cryptography.RandomNumberGenerator]::Fill($salt)
  $deriver = [Security.Cryptography.Rfc2898DeriveBytes]::new(
    $password,
    $salt,
    310000,
    [Security.Cryptography.HashAlgorithmName]::SHA256
  )
  $digest = $deriver.GetBytes(32)

  $sessionBytes = [byte[]]::new(32)
  [Security.Cryptography.RandomNumberGenerator]::Fill($sessionBytes)

  $passwordHash = "pbkdf2_sha256`$310000`$$(ConvertTo-Base64Url $salt)`$$(ConvertTo-Base64Url $digest)"
  $sessionSecret = ConvertTo-Base64Url $sessionBytes

  Write-Host ""
  Write-Host "Copy these three values directly into Vercel Preview environment variables:"
  Write-Host "JAMES_AUTH_EMAIL=$identity"
  Write-Host "JAMES_AUTH_PASSWORD_HASH=$passwordHash"
  Write-Host "JAMES_SESSION_SECRET=$sessionSecret"
  Write-Host ""
  Write-Host "Do not save or send this output. Close this window after the values are in Vercel."
}
finally {
  if ($deriver) { $deriver.Dispose() }
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  $password = $null
  $securePassword.Dispose()
}

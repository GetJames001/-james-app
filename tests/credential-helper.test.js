const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const helperPath = path.join(root, "tools", "Generate-JamesPreviewCredentials.ps1");
const helper = fs.readFileSync(helperPath, "utf8");
const vercelIgnore = fs.readFileSync(path.join(root, ".vercelignore"), "utf8");

test("credential helper uses Windows PowerShell 5.1-compatible cryptography", () => {
  assert.match(helper, /RandomNumberGenerator\]::Create\(\)/);
  assert.match(helper, /\.GetBytes\(\$bytes\)/);
  assert.match(helper, /\$generator\.Dispose\(\)/);
  assert.doesNotMatch(helper, /RandomNumberGenerator\]::Fill/);
  assert.match(helper, /Rfc2898DeriveBytes/);
  assert.match(helper, /HashAlgorithmName\]::SHA256/);
  assert.match(helper, /\$PasswordIterations = 310000/);
  assert.match(helper, /New-SecureRandomBytes 16/);
  assert.match(helper, /New-SecureRandomBytes 32/);
});

test("credential helper requires masked confirmation and rejects unsafe passwords", () => {
  assert.equal((helper.match(/-AsSecureString/g) || []).length, 2);
  assert.match(helper, /\$MinimumPasswordLength = 14/);
  assert.match(helper, /IsNullOrEmpty\(\$password\)/);
  assert.match(helper, /password confirmation did not match/i);
  assert.match(helper, /StringComparison\]::Ordinal/);
  assert.match(helper, /ZeroFreeBSTR\(\$passwordPointer\)/);
  assert.match(helper, /ZeroFreeBSTR\(\$confirmationPointer\)/);
});

test("credential helper self-test exposes no generated credentials and makes no network request", () => {
  assert.match(helper, /\[switch\] \$SelfTest/);
  assert.match(helper, /Credential helper compatibility self-test passed\./);
  assert.match(helper, /PBKDF2 compatibility self-test failed\./);
  assert.doesNotMatch(helper, /Invoke-WebRequest|Invoke-RestMethod|WebClient|HttpClient|https?:\/\//i);
  assert.match(vercelIgnore, /^tools\/$/m);
});

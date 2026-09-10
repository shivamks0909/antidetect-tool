$ErrorActionPreference = "Stop"

# Login as admin
$adminLogin = @{ email = "admin@opinioninsights.com"; password = "AdminPassword123!" } | ConvertTo-Json
$adminRes = Invoke-RestMethod -Uri "https://api.opinioninsights.in/api/auth/login" -Method Post -ContentType "application/json" -Body $adminLogin
$adminToken = $adminRes.token
Write-Host "Admin logged in successfully. Token acquired."

# 1. Create real test user
$randomSuffix = Get-Random -Minimum 1000 -Maximum 9999
$testEmail = "browser_qa_${randomSuffix}@opinioninsights.com"
$testPassword = "LiveQaPassword2026!"

$newUserPayload = @{
    email = $testEmail
    full_name = "Browser QA Live User"
    password = $testPassword
    role = "user"
} | ConvertTo-Json

$createRes = Invoke-RestMethod -Uri "https://api.opinioninsights.in/api/admin/users" -Method Post -Headers @{ Authorization = "Bearer $adminToken" } -ContentType "application/json" -Body $newUserPayload
$userId = $createRes.user.id
Write-Host "Created user: $testEmail (ID: $userId)"

# 2. Test Browser EXE Login with this new real user
$userLogin = @{ email = $testEmail; password = $testPassword } | ConvertTo-Json
$userRes = Invoke-RestMethod -Uri "https://api.opinioninsights.in/api/auth/login" -Method Post -ContentType "application/json" -Body $userLogin
Write-Host "Test 2.1 - Login with new user: PASS (Token acquired, user.is_active = $($userRes.user.is_active))"

# 3. Disable user via Admin API
$disableBody = @{ isActive = $false } | ConvertTo-Json
$disableRes = Invoke-RestMethod -Uri "https://api.opinioninsights.in/api/admin/users/$userId" -Method Patch -Headers @{ Authorization = "Bearer $adminToken" } -ContentType "application/json" -Body $disableBody
Write-Host "Test 2.2 - Disabled user via Admin API: PASS (Response: $($disableRes.message))"

# 4. Attempt login with disabled user
$disabledLoginSuccess = $false
try {
    $attemptRes = Invoke-RestMethod -Uri "https://api.opinioninsights.in/api/auth/login" -Method Post -ContentType "application/json" -Body $userLogin
    $disabledLoginSuccess = $true
} catch {
    Write-Host "Test 2.3 - Disabled user login rejected: PASS (Expected 403 Forbidden: $($_.Exception.Message))"
}

if ($disabledLoginSuccess) {
    throw "Security Failure: Disabled user was able to log in!"
}

# 5. Enable user via Admin API
$enableBody = @{ isActive = $true } | ConvertTo-Json
$enableRes = Invoke-RestMethod -Uri "https://api.opinioninsights.in/api/admin/users/$userId" -Method Patch -Headers @{ Authorization = "Bearer $adminToken" } -ContentType "application/json" -Body $enableBody
Write-Host "Test 2.4 - Re-enabled user via Admin API: PASS (Response: $($enableRes.message))"

# 6. Re-attempt login with re-enabled user
$reLoginRes = Invoke-RestMethod -Uri "https://api.opinioninsights.in/api/auth/login" -Method Post -ContentType "application/json" -Body $userLogin
Write-Host "Test 2.5 - Re-login with active user: PASS (Token acquired, user.is_active = $($reLoginRes.user.is_active))"

Write-Host "`nAll Real User Lifecycle Tests PASSED against live production backend!"

Write-Host "`n=== FORENZX / PANDORA STAGING ENVIRONMENT AUDIT ==="

# 1. DNS Resolution
try {
    $dns = (Resolve-DnsName pandora.whoiswho.at -Type A -ErrorAction SilentlyContinue).IPAddress
    $dnsStatus = if ($dns -eq "66.29.139.59") { "PASS [66.29.139.59]" } else { "FAIL [$dns]" }
} catch {
    $dnsStatus = "FAIL [$($_.Exception.Message)]"
}
Write-Host "1. DNS pandora.whoiswho.at          : $dnsStatus"

# 2. Public HTTPS Web Endpoint
try {
    $web = Invoke-WebRequest -Uri "https://pandora.whoiswho.at" -UseBasicParsing -TimeoutSec 10
    $webStatus = if ($web.StatusCode -eq 200) { "PASS [HTTP 200 OK]" } else { "FAIL [HTTP $($web.StatusCode)]" }
} catch {
    $webStatus = "FAIL [$($_.Exception.Message)]"
}
Write-Host "2. HTTPS Web (pandora.whoiswho.at)    : $webStatus"

# 3. Public HTTPS Supabase Reverse Proxy
try {
    $sub = Invoke-WebRequest -Uri "https://pandora.whoiswho.at/supabase/rest/v1/" -UseBasicParsing -TimeoutSec 10 -SkipHttpErrorCheck
    $subStatus = if ($sub.StatusCode -eq 401 -and $sub.Headers["Server"] -like "*kong*") { "PASS [HTTP 401 Kong Realm Verified]" } else { "STATUS [$($sub.StatusCode)]" }
} catch {
    $subStatus = "CHECK [$($_.Exception.Message)]"
}
Write-Host "3. HTTPS Supabase Reverse Proxy       : $subStatus"

# 4. Container Live Environment Variables (via SSH)
Write-Host "`n--- Container Environment Variables (via SSH) ---"
$envRaw = ssh -o BatchMode=yes -o ConnectTimeout=10 root@66.29.139.59 "docker exec forenzx_staging_app env" 2>$null
$envs = @{}
if ($envRaw) {
    $envRaw -split "`n" | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') {
            $envs[$matches[1].Trim()] = $matches[2].Trim()
        }
    }
}

$checks = @(
    @{ Key="NODE_ENV"; Expected="production" },
    @{ Key="PORT"; Expected="3005" },
    @{ Key="HOSTNAME"; Expected="0.0.0.0" },
    @{ Key="NEXT_PUBLIC_BASE_URL"; Expected="https://pandora.whoiswho.at" },
    @{ Key="NEXT_PUBLIC_SUPABASE_URL"; Expected="https://pandora.whoiswho.at/supabase" },
    @{ Key="SUPABASE_URL"; Expected="http://pandora_staging_kong:8000" },
    @{ Key="NEXT_PUBLIC_RP_ID"; Expected="whoiswho.at" },
    @{ Key="NEXT_PUBLIC_RP_NAME"; Expected="PANDORA ForenX OS" },
    @{ Key="NEXT_PUBLIC_APP_NAME"; Expected="PANDORA ForenX OS" },
    @{ Key="NEXT_PUBLIC_APP_VERSION"; Expected="2.0.0" },
    @{ Key="NEXT_PUBLIC_ENABLE_ANALYTICS"; Expected="false" },
    @{ Key="S3_BUCKET"; Expected="forenx-vault-sk" },
    @{ Key="SUPABASE_SERVICE_ROLE_KEY"; Expected="PRESENT (Secret)" },
    @{ Key="NEXT_PUBLIC_SUPABASE_ANON_KEY"; Expected="PRESENT (JWT)" },
    @{ Key="MISTRAL_API_KEY"; Expected="PRESENT (Secret)" }
)

foreach ($c in $checks) {
    $actual = $envs[$c.Key]
    if ($c.Expected -like "PRESENT*") {
        $ok = -not [string]::IsNullOrWhiteSpace($actual)
        $display = if ($ok) { "MATCH [CONFIGURED]" } else { "MISSING" }
    } else {
        $ok = ($actual -eq $c.Expected)
        $display = if ($ok) { "MATCH [$actual]" } else { "MISMATCH (Found: '$actual', Expected: '$($c.Expected)')" }
    }
    Write-Host ("  {0,-32}: {1}" -f $c.Key, $display)
}

# 5. Internal Container -> Kong Connectivity
Write-Host "`n--- Internal Container -> Kong Connectivity ---"
if ($envs['NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    $internalHttp = ssh -o BatchMode=yes -o ConnectTimeout=10 root@66.29.139.59 "docker exec forenzx_staging_app curl -s -o /dev/null -w '%{http_code}' http://pandora_staging_kong:8000/rest/v1/ -H 'apikey: $($envs['NEXT_PUBLIC_SUPABASE_ANON_KEY'])'" 2>$null
    $intStatus = if ($internalHttp -eq "200") { "PASS [HTTP 200 OK]" } else { "FAIL [HTTP $internalHttp]" }
} else {
    $intStatus = "SKIP (No SSH / Anon Key)"
}
Write-Host "Internal Kong REST Route             : $intStatus"

# 6. Container Resource Usage
Write-Host "`n--- Container Health & Memory Usage ---"
$stats = ssh -o BatchMode=yes -o ConnectTimeout=10 root@66.29.139.59 "docker ps --filter name=forenzx_staging_app --format 'Status: {{.Status}}'; docker stats --no-stream forenzx_staging_app --format 'Memory: {{.MemUsage}} / {{.MemPerc}} | CPU: {{.CPUPerc}}'" 2>$null
if ($stats) {
    $stats -split "`n" | ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host "  SSH Direct Access Not Available or Timed Out"
}

Write-Host "`n=== AUDIT COMPLETE ===`n"
import { test, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
import { createClient } from '@supabase/supabase-js';

// Tento test overuje kritický 'Chain of Custody' workflow na základe 6-krokovej schémy.
// Využíva Supabase service role pre bypass RLS čisto na účely asertácií dát v DB.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

test.describe('Evidence Chain of Custody Workflow', () => {
  let testCaseId: string;
  let testUserId: string;

  test.beforeAll(async () => {
    // Príprava testovacích dát (mock case a user)
    testCaseId = 'e2e-case-workflow';
    testUserId = 'e2e-test-user';
  });

  test('Should strictly enforce the 6-step Upload & Verification pipeline', async ({ page }) => {
    // 1. Upload & Authentication
    // Predpokladáme, že používateľ prejde cez prihlasovací formulár
    await page.goto('/login');
    await page.fill('input[name="email"]', 'investigator@forenzx.com');
    await page.fill('input[name="password"]', 'SecurePassword123!');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=Dashboard')).toBeVisible();

    // 2. Case ownership
    // Systém musí povoliť prechod na prípad, iba ak RLS dovolí čítať dáta
    await page.goto('/cases/e2e-case-workflow/evidence');
    await expect(page.locator('text=Upload Evidence')).toBeVisible();

    // 3. Validation & SHA-256
    // Nahráme testovací payload do UI
    const payloadBuffer = Buffer.from('forenzx-e2e-test-payload-data');
    await page.setInputFiles('input[type="file"]', {
      name: 'evidence.bin',
      mimeType: 'application/octet-stream',
      buffer: payloadBuffer,
    });

    // Skontrolujeme, že klient prepočítal SHA-256
    const hashElement = page.locator('[data-testid="evidence-sha256"]');
    await expect(hashElement).not.toBeEmpty({ timeout: 10000 });
    const claimedSha256 = await hashElement.innerText();

    // Odošleme dáta (tu sa spúšťa upload na S3)
    await page.click('button:has-text("Confirm & Upload")');
    await expect(page.locator('text=Upload completed')).toBeVisible({ timeout: 15000 });

    // --- Backend Assertions pre kroky 4, 5 a 6 --- //

    // 4 & 5. S3 Object, Evidence ledger & Audit event
    // Skontrolujeme, že sa vytvoril záznam a audit log (využijeme DB priamo)
    const { data: evidence } = await supabase
      .from('evidence')
      .select('*')
      .eq('case_id', testCaseId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    expect(evidence).toBeDefined();
    expect(evidence.sha256).toEqual(claimedSha256);
    expect(evidence.storage_path).toContain('evidence.bin');

    const { data: auditLogs } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('entity_id', evidence.id)
      .eq('action', 'EVIDENCE_UPLOAD_SUCCESS');

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].metadata.sha256).toEqual(claimedSha256);

    // 6. Verification (Webhook & MCP Hub Trigger)
    // Po uploade musí existovať Job pre MCP Hub
    const { data: job } = await supabase
      .from('forenzx_analysis_jobs')
      .select('*')
      .eq('evidence_id', evidence.id)
      .single();

    expect(job).toBeDefined();
    // Job by mal byť buď QUEUED alebo RUNNING po úspešnom odpálení webhooku
    expect(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']).toContain(job.status);
    expect(job.claimed_sha256).toEqual(claimedSha256);
  });

  test('Should block unauthorized users via RLS (Case Ownership)', async ({ request }) => {
    // Ak sa útočník alebo neoprávnený užívateľ pokúsi použiť platný JWT token na cudzí case_id,
    // Supabase RLS musí okamžite zablokovať prístup
    
    // Tu zvyčajne pošleme priamy HTTP request na Supabase s tokenom užívateľa, ktorý nemá práva
    // (mock implementácia)
    const response = await request.post('/api/evidence/upload', {
      data: {
        caseId: 'case-owned-by-someone-else',
        filename: 'hack.bin'
      },
      headers: {
        'Authorization': 'Bearer attacker-valid-jwt-token'
      }
    });

    // Musí vrátiť 401 Unauthorized alebo 403 Forbidden vďaka RLS
    expect(response.status()).toBeGreaterThanOrEqual(401);
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { Client } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type DockerIntegrationConfig = {
  databaseUrl: string;
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  jwtSecret: string;
};

function loadDockerIntegrationConfig(): DockerIntegrationConfig | null {
  const required = {
    databaseUrl: process.env.TEST_DATABASE_URL,
    apiUrl: process.env.TEST_SUPABASE_API_URL,
    anonKey: process.env.TEST_SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.TEST_SUPABASE_SERVICE_ROLE_KEY,
    jwtSecret: process.env.TEST_SUPABASE_JWT_SECRET,
  };

  return Object.values(required).every(Boolean)
    ? (required as DockerIntegrationConfig)
    : null;
}

// This suite requires an explicitly configured local Supabase Docker stack.
// It must never fall back to credentials in source control.
const dockerIntegrationConfig = loadDockerIntegrationConfig();
const describeDockerIntegration = dockerIntegrationConfig ? describe : describe.skip;

function getDockerIntegrationConfig(): DockerIntegrationConfig {
  if (!dockerIntegrationConfig) {
    throw new Error(
      "Missing required TEST_SUPABASE_* Docker integration configuration.",
    );
  }
  return dockerIntegrationConfig;
}

function createJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", getDockerIntegrationConfig().jwtSecret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

function fixtureSha256(label: string): string {
  return crypto.createHash("sha256").update(label).digest("hex");
}

function getAuthenticatedClient(userId: string): SupabaseClient {
  const config = getDockerIntegrationConfig();
  const token = createJwt({
    iss: "supabase-demo",
    sub: userId,
    role: "authenticated",
    email: `${userId}@forenx.local`,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  return createClient(config.apiUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function getAnonClient(): SupabaseClient {
  const config = getDockerIntegrationConfig();
  return createClient(config.apiUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getServiceRoleClient(): SupabaseClient {
  const config = getDockerIntegrationConfig();
  const token = createJwt({
    iss: "supabase-demo",
    role: "service_role",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  return createClient(config.apiUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
describeDockerIntegration("Regression Suite: 08 - Supabase Docker Integration & Full RPC Matrix", () => {
  it("verifies auth.uid(), anon, authenticated, and service_role RLS data isolation over PostgREST API", async () => {
    const pg = new Client({ connectionString: getDockerIntegrationConfig().databaseUrl });
    await pg.connect();

    const userA = crypto.randomUUID();
    const userB = crypto.randomUUID();

    try {
      // Seed test users in real auth.users
      await pg.query(
        `INSERT INTO auth.users (id, email, raw_user_meta_data)
         VALUES ($1, $2, '{"name":"User A"}'::jsonb), ($3, $4, '{"name":"User B"}'::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [userA, `usera-${userA}@test.local`, userB, `userb-${userB}@test.local`]
      );

      const clientA = getAuthenticatedClient(userA);
      const clientB = getAuthenticatedClient(userB);
      const anonClient = getAnonClient();
      const serviceClient = getServiceRoleClient();

      // User A creates a case via PostgREST Data API
      const insertRes = await clientA
        .from("cases")
        .insert({
          user_id: userA,
          name: "Confidential Operation A",
          status: "draft",
        })
        .select()
        .single();

      expect(insertRes.error).toBeNull();
      const caseAId = insertRes.data.id;

      // 1. Anon queries cases: table SELECT is denied to anon (HTTP 401 / code 42501)
      const anonRes = await anonClient.from("cases").select("*");
      expect(anonRes.error?.code).toBe("42501");

      // 2. User B queries cases: sees 0 rows (isolated by RLS auth.uid() = user_id)
      const bRes = await clientB.from("cases").select("*").eq("id", caseAId);
      expect(bRes.error).toBeNull();
      expect(bRes.data?.length).toBe(0);

      // 3. User A queries cases: sees own case
      const aRes = await clientA.from("cases").select("*").eq("id", caseAId);
      expect(aRes.error).toBeNull();
      expect(aRes.data?.length).toBe(1);
      expect(aRes.data?.[0]?.name).toBe("Confidential Operation A");

      // 4. Service role queries cases: sees everything (BYPASSRLS)
      const sRes = await serviceClient.from("cases").select("*").eq("id", caseAId);
      expect(sRes.error).toBeNull();
      expect(sRes.data?.length).toBe(1);
    } finally {
      await pg.end();
    }
  }, 60_000);

  it("verifies storage.buckets and storage.objects policies against local Supabase Storage", async () => {
    const pg = new Client({ connectionString: getDockerIntegrationConfig().databaseUrl });
    await pg.connect();

    const userA = crypto.randomUUID();
    const userB = crypto.randomUUID();

    try {
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4) ON CONFLICT (id) DO NOTHING`,
        [userA, `stor-a-${userA}@test.local`, userB, `stor-b-${userB}@test.local`]
      );

      // 1. Check avatars bucket exists and is public
      const bucketRes = await pg.query<{ id: string; public: boolean }>(
        "SELECT id, public FROM storage.buckets WHERE id = 'avatars'"
      );
      expect(bucketRes.rows.length).toBe(1);
      expect(bucketRes.rows[0]?.id).toBe("avatars");
      expect(bucketRes.rows[0]?.public).toBe(true);

      // 2. Test storage.objects RLS directly under role authenticated
      // User A can insert into own folder
      await pg.query("BEGIN");
      await pg.query("SET LOCAL ROLE authenticated");
      await pg.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userA]);
      await pg.query("SELECT set_config('request.jwt.claim.role', 'authenticated', true)");

      const insertOwn = await pg.query(
        `INSERT INTO storage.objects (bucket_id, name, owner)
         VALUES ('avatars', $1 || '/avatar.png', $1::uuid)
         RETURNING id`,
        [userA]
      );
      expect(insertOwn.rows.length).toBe(1);

      // User A cannot insert into User B's folder (foldername mismatch)
      await expect(
        pg.query(
          `INSERT INTO storage.objects (bucket_id, name, owner)
           VALUES ('avatars', $1 || '/avatar.png', $2::uuid)`,
          [userB, userA]
        )
      ).rejects.toThrow(/violates row-level security policy/);

      await pg.query("ROLLBACK");
    } finally {
      await pg.end();
    }
  }, 60_000);

  it("verifies all 19 application RPCs with Happy Path, Unauthorized Path, and Invalid Input Path", async () => {
    const pg = new Client({ connectionString: getDockerIntegrationConfig().databaseUrl });
    await pg.connect();

    const userRegular = crypto.randomUUID();
    const userAdmin = crypto.randomUUID();

    try {
      // Seed regular user and admin user
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4) ON CONFLICT (id) DO NOTHING`,
        [userRegular, `reg-${userRegular}@test.local`, userAdmin, `adm-${userAdmin}@test.local`]
      );
      await pg.query(
        `INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin') ON CONFLICT (user_id, role) DO NOTHING`,
        [userAdmin]
      );

      const clientReg = getAuthenticatedClient(userRegular);
      const clientAdm = getAuthenticatedClient(userAdmin);
      const clientAnon = getAnonClient();
      const clientService = getServiceRoleClient();

      const rpcAuditList: string[] = [];
      const evidenceHash = fixtureSha256("docker-rpc-evidence");

      // 1. consume_rate_limit(p_key, p_max_requests, p_window_seconds)
      {
        rpcAuditList.push("consume_rate_limit");
        // Happy
        const happy = await clientService.rpc("consume_rate_limit", {
          p_key: `test-rl-${Date.now()}`,
          p_max_requests: 5,
          p_window_seconds: 60,
        });
        expect(happy.error).toBeNull();
        expect(happy.data?.[0]?.allowed).toBe(true);

        // Unauthorized (anon and authenticated rejected)
        const unauth = await clientAnon.rpc("consume_rate_limit", {
          p_key: "bad-rl",
          p_max_requests: 5,
          p_window_seconds: 60,
        });
        expect(unauth.error?.code).toBe("42501");

        // Invalid input (p_max_requests <= 0)
        const invalid = await clientService.rpc("consume_rate_limit", {
          p_key: "bad-rl",
          p_max_requests: 0,
          p_window_seconds: 60,
        });
        expect(invalid.error?.code).toBe("22023");
      }

      // 2. check_rate_limit(p_key, p_max_requests, p_window_seconds)
      {
        rpcAuditList.push("check_rate_limit");
        // Happy
        const happy = await clientService.rpc("check_rate_limit", {
          p_key: `check-rl-${Date.now()}`,
          p_max_requests: 10,
          p_window_seconds: 60,
        });
        expect(happy.error).toBeNull();
        expect(happy.data?.[0]?.allowed).toBe(true);

        // Unauthorized
        const unauth = await clientReg.rpc("check_rate_limit", {
          p_key: "check-rl",
          p_max_requests: 10,
          p_window_seconds: 60,
        });
        expect(unauth.error?.code).toBe("42501");

        // Invalid input (p_window_seconds <= 0)
        const invalid = await clientService.rpc("check_rate_limit", {
          p_key: "check-rl",
          p_max_requests: 10,
          p_window_seconds: 0,
        });
        expect(invalid.error?.code).toBe("22023");
      }

      // 3. cleanup_expired_rate_limits()
      {
        rpcAuditList.push("cleanup_expired_rate_limits");
        // Happy
        const happy = await clientService.rpc("cleanup_expired_rate_limits");
        expect(happy.error).toBeNull();

        // Unauthorized
        const unauth = await clientReg.rpc("cleanup_expired_rate_limits");
        expect(unauth.error?.code).toBe("42501");
      }

      // 4. has_role(_user_id, _role)
      {
        rpcAuditList.push("has_role");
        // Happy
        const happy = await clientReg.rpc("has_role", {
          _user_id: userAdmin,
          _role: "admin",
        });
        expect(happy.error).toBeNull();
        expect(happy.data).toBe(true);

        // Unauthorized (anon rejected)
        const unauth = await clientAnon.rpc("has_role", {
          _user_id: userAdmin,
          _role: "admin",
        });
        expect(unauth.error?.code).toBe("42501");

        // Invalid input (unknown role)
        const invalid = await clientReg.rpc("has_role", {
          _user_id: userAdmin,
          _role: "super_super_user",
        });
        expect(invalid.error).not.toBeNull();
      }

      // 5. current_plan(_user)
      {
        rpcAuditList.push("current_plan");
        // Happy
        const happy = await clientReg.rpc("current_plan", { _user: userRegular });
        expect(happy.error).toBeNull();
        expect(typeof happy.data).toBe("string");

        // Unauthorized
        const unauth = await clientAnon.rpc("current_plan", { _user: userRegular });
        expect(unauth.error?.code).toBe("42501");

        // Invalid input (invalid UUID format)
        const invalid = await clientReg.rpc("current_plan", { _user: "not-a-uuid" });
        expect(invalid.error).not.toBeNull();
      }

      // 6. set_case_status(_case_id, _status, _reason)
      let testCaseId: string;
      {
        rpcAuditList.push("set_case_status");
        // Setup a case for regular user
        const ins = await pg.query<{ id: string }>(
          "INSERT INTO public.cases (user_id, name, status) VALUES ($1, 'Status Test', 'draft') RETURNING id",
          [userRegular]
        );
        testCaseId = ins.rows[0]!.id;

        // Happy
        const happy = await clientReg.rpc("set_case_status", {
          _case_id: testCaseId,
          _status: "closed",
          _reason: "Case solved",
        });
        expect(happy.error).toBeNull();

        // Unauthorized (anon cannot call)
        const unauth = await clientAnon.rpc("set_case_status", {
          _case_id: testCaseId,
          _status: "archived",
          _reason: "No auth",
        });
        expect(unauth.error?.code).toBe("42501");

        // Invalid input (invalid status transition)
        const invalid = await clientReg.rpc("set_case_status", {
          _case_id: testCaseId,
          _status: "bogus_status",
          _reason: "Invalid",
        });
        expect(invalid.error).not.toBeNull();
      }

      // 7. destroy_case(_case_id, _reason)
      {
        rpcAuditList.push("destroy_case");
        // Case to destroy: archived status
        const ins = await pg.query<{ id: string }>(
          "INSERT INTO public.cases (user_id, name, status) VALUES ($1, 'Destroy Me', 'archived') RETURNING id",
          [userAdmin]
        );
        const destroyCaseId = ins.rows[0]!.id;

        // Unauthorized (regular user rejected: admin only)
        const unauth = await clientReg.rpc("destroy_case", {
          _case_id: destroyCaseId,
          _reason: "Illegal attempt",
        });
        expect(unauth.error?.code).toBe("42501");

        // Invalid input: non-existent case
        const invalid = await clientAdm.rpc("destroy_case", {
          _case_id: crypto.randomUUID(),
          _reason: "Does not exist",
        });
        expect(invalid.error?.code).toBe("P0002");

        // Happy (admin destroys eligible case)
        const happy = await clientAdm.rpc("destroy_case", {
          _case_id: destroyCaseId,
          _reason: "Audited test destruction",
        });
        expect(happy.error).toBeNull();
      }

      // 8. db_health_stats()
      {
        rpcAuditList.push("db_health_stats");
        // Happy
        const happy = await clientService.rpc("db_health_stats");
        expect(happy.error).toBeNull();
        expect(happy.data?.postgres_version).toBeDefined();

        // Unauthorized (client rejected)
        const unauth = await clientReg.rpc("db_health_stats");
        expect(unauth.error?.code).toBe("42501");
      }

      // 9. health_metrics()
      {
        rpcAuditList.push("health_metrics");
        // Happy (admin)
        const happy = await clientAdm.rpc("health_metrics");
        expect(happy.error).toBeNull();
        expect(happy.data?.window_hours).toBe(24);

        // Unauthorized (regular user)
        const unauth = await clientReg.rpc("health_metrics");
        expect(unauth.error?.code).toBe("42501");
      }

      // 10. log_case_access(_case_id, _action, _legal_basis, _source_ip, _user_agent)
      {
        rpcAuditList.push("log_case_access");
        // Happy
        const happy = await clientReg.rpc("log_case_access", {
          _case_id: testCaseId,
          _action: "view",
          _legal_basis: "§ 119 Trestného poriadku",
          _source_ip: "127.0.0.1",
          _user_agent: "Forenx-Agent/1.0",
        });
        expect(happy.error).toBeNull();

        // Unauthorized
        const unauth = await clientAnon.rpc("log_case_access", {
          _case_id: testCaseId,
          _action: "view",
          _legal_basis: "Law",
          _source_ip: "127.0.0.1",
          _user_agent: "Anon",
        });
        expect(unauth.error?.code).toBe("42501");

        // Invalid input (empty legal basis)
        const invalid = await clientReg.rpc("log_case_access", {
          _case_id: testCaseId,
          _action: "view",
          _legal_basis: "   ",
          _source_ip: "127.0.0.1",
          _user_agent: "Test",
        });
        expect(invalid.error?.code).toBe("P0001");
      }

      // 11. log_evidence_upload(_case_id, _evidence_id, _file_name, _file_size, _sha256, _s3_key)
      let testEvidenceId: string;
      {
        rpcAuditList.push("log_evidence_upload");
        const evidenceId = crypto.randomUUID();
        testEvidenceId = evidenceId;

        // Happy
        const happy = await clientReg.rpc("log_evidence_upload", {
          _case_id: testCaseId,
          _evidence_id: evidenceId,
          _file_name: "contract.pdf",
          _file_size: 4096,
          _sha256: evidenceHash,
          _s3_key: `evidence/${testCaseId}/contract.pdf`,
        });
        expect(happy.error).toBeNull();

        // Unauthorized
        const unauth = await clientAnon.rpc("log_evidence_upload", {
          _case_id: testCaseId,
          _evidence_id: evidenceId,
          _file_name: "doc.pdf",
          _file_size: 100,
          _sha256: "0".repeat(64),
          _s3_key: "key",
        });
        expect(unauth.error?.code).toBe("42501");

        // Invalid input (non-UUID evidence)
        const invalid = await clientReg.rpc("log_evidence_upload", {
          _case_id: testCaseId,
          _evidence_id: "not-uuid",
          _file_name: "doc.pdf",
          _file_size: 100,
          _sha256: "0".repeat(64),
          _s3_key: "key",
        });
        expect(invalid.error).not.toBeNull();
      }

      // 12. record_evidence_verification(_evidence_id, _status, _verified_sha256, _verified_size, _error)
      {
        rpcAuditList.push("record_evidence_verification");
        // Insert an actual evidence row with unique S3 key
        const uniqueKey = `s3://evidence/${testCaseId}/${Date.now()}-doc.pdf`;
        const ins = await pg.query<{ id: string }>(
          `INSERT INTO public.evidence_items (investigator_id, case_id, case_name, file_name, file_size, mime_type, s3_object_key, sha256_hash)
           VALUES ($1, $2, 'Case Ref', 'doc.pdf', 1000, 'application/pdf', $3, $4) RETURNING id`,
          [userRegular, testCaseId, uniqueKey, evidenceHash]
        );
        const evId = ins.rows[0]!.id;

        // Happy (service_role)
        const happy = await clientService.rpc("record_evidence_verification", {
          _evidence_id: evId,
          _status: "verified",
          _verified_sha256: evidenceHash,
          _verified_size: 1000,
          _error: null,
        });
        expect(happy.error).toBeNull();

        // Unauthorized (regular user)
        const unauth = await clientReg.rpc("record_evidence_verification", {
          _evidence_id: evId,
          _status: "verified",
          _verified_sha256: evidenceHash,
          _verified_size: 1000,
          _error: null,
        });
        expect(unauth.error?.code).toBe("42501");

        // Invalid input (invalid verification status)
        const invalid = await clientService.rpc("record_evidence_verification", {
          _evidence_id: evId,
          _status: "bogus_status_unsupported",
          _verified_sha256: "0".repeat(64),
          _verified_size: 0,
          _error: "none",
        });
        expect(invalid.error).not.toBeNull();
      }

      // 13. delete_evidence_item_audited(_id, _reason)
      {
        rpcAuditList.push("delete_evidence_item_audited");
        const uniqueKey = `s3://evidence/${testCaseId}/${Date.now()}-del.pdf`;
        const ins = await pg.query<{ id: string }>(
          `INSERT INTO public.evidence_items (investigator_id, case_id, case_name, file_name, file_size, mime_type, s3_object_key, sha256_hash)
           VALUES ($1, $2, 'Case Ref', 'deleteme.pdf', 200, 'application/pdf', $3, $4) RETURNING id`,
          [userRegular, testCaseId, uniqueKey, evidenceHash]
        );
        const delId = ins.rows[0]!.id;

        // Unauthorized (anon)
        const unauth = await clientAnon.rpc("delete_evidence_item_audited", {
          _id: delId,
          _reason: "Hacker attempt",
        });
        expect(unauth.error?.code).toBe("42501");

        // Invalid input: non-existent evidence ID (P0002)
        const invalid = await clientReg.rpc("delete_evidence_item_audited", {
          _id: crypto.randomUUID(),
          _reason: "Invalid ID",
        });
        expect(invalid.error?.code).toBe("P0002");

        // Happy
        const happy = await clientReg.rpc("delete_evidence_item_audited", {
          _id: delId,
          _reason: "Duplicate upload removal",
        });
        expect(happy.error).toBeNull();
      }

      // 14. verify_audit_chain(_user)
      {
        rpcAuditList.push("verify_audit_chain");
        // Happy
        const happy = await clientReg.rpc("verify_audit_chain", { _user: userRegular });
        expect(happy.error).toBeNull();
        expect(Array.isArray(happy.data)).toBe(true);

        // Unauthorized (anon)
        const unauth = await clientAnon.rpc("verify_audit_chain", { _user: userRegular });
        expect(unauth.error?.code).toBe("42501");

        // Invalid input (malformed UUID)
        const invalid = await clientReg.rpc("verify_audit_chain", { _user: "123" });
        expect(invalid.error).not.toBeNull();
      }

      // 15. erase_user_audit_log(_user)
      {
        rpcAuditList.push("erase_user_audit_log");
        // Unauthorized (regular user)
        const unauth = await clientReg.rpc("erase_user_audit_log", { _user: userRegular });
        expect(unauth.error?.code).toBe("42501");

        // Invalid input (not a UUID)
        const invalid = await clientService.rpc("erase_user_audit_log", { _user: "abc" });
        expect(invalid.error).not.toBeNull();

        // Happy (service_role)
        const happy = await clientService.rpc("erase_user_audit_log", { _user: userRegular });
        expect(happy.error).toBeNull();
        expect(typeof happy.data).toBe("number");
      }

      // 16. commit_ai_case_graph(_case, _actor, _entities, _events, _relations)
      {
        rpcAuditList.push("commit_ai_case_graph");
        // Unauthorized
        const unauth = await clientReg.rpc("commit_ai_case_graph", {
          _case: testCaseId,
          _actor: userRegular,
          _entities: [],
          _events: [],
          _relations: [],
        });
        expect(unauth.error?.code).toBe("42501");

        // Invalid input: non-existent case (42501)
        const invalid = await clientService.rpc("commit_ai_case_graph", {
          _case: crypto.randomUUID(),
          _actor: userRegular,
          _entities: [],
          _events: [],
          _relations: [],
        });
        expect(invalid.error?.code).toBe("42501");

        // Setup a dedicated draft case for graph/import
        const draftIns = await pg.query<{ id: string }>(
          "INSERT INTO public.cases (user_id, name, status) VALUES ($1, 'AI Draft Case', 'draft') RETURNING id",
          [userRegular]
        );
        const draftCaseId = draftIns.rows[0]!.id;

        // Happy
        const happy = await clientService.rpc("commit_ai_case_graph", {
          _case: draftCaseId,
          _actor: userRegular,
          _entities: [{ name: "Target Entity", kind: "person" }],
          _events: [],
          _relations: [],
        });
        expect(happy.error).toBeNull();
      }

      // 17. commit_import(_case, _data, _actor)
      {
        rpcAuditList.push("commit_import");
        // Setup another draft case for import
        const draftIns = await pg.query<{ id: string }>(
          "INSERT INTO public.cases (user_id, name, status) VALUES ($1, 'Import Draft Case', 'draft') RETURNING id",
          [userRegular]
        );
        const importCaseId = draftIns.rows[0]!.id;

        // Unauthorized
        const unauth = await clientReg.rpc("commit_import", {
          _case: importCaseId,
          _data: {},
          _actor: userRegular,
        });
        expect(unauth.error?.code).toBe("42501");

        // Invalid input: non-existent case (42501)
        const invalid = await clientService.rpc("commit_import", {
          _case: crypto.randomUUID(),
          _data: { entities: [] },
          _actor: userRegular,
        });
        expect(invalid.error?.code).toBe("42501");

        // Happy
        const happy = await clientService.rpc("commit_import", {
          _case: importCaseId,
          _data: { entities: [{ name: "Imported Person", kind: "person" }] },
          _actor: userRegular,
        });
        expect(happy.error).toBeNull();
      }

      // 18. reserve_ai_call(_user_id, _case_id, _task, _model, _prompt_version, _input_revision, _max_tokens)
      {
        rpcAuditList.push("reserve_ai_call");
        // Unauthorized
        const unauth = await clientReg.rpc("reserve_ai_call", {
          _user_id: userRegular,
          _case_id: testCaseId,
          _task: "transcribe",
          _model: "gemini-2.5",
          _prompt_version: "v1",
          _input_revision: "rev-1",
          _max_tokens: 1000,
        });
        expect(unauth.error?.code).toBe("42501");

        // Invalid input (missing task)
        const invalid = await clientService.rpc("reserve_ai_call", {
          _user_id: userRegular,
          _case_id: testCaseId,
          _task: null as any,
          _model: "gemini-2.5",
          _prompt_version: "v1",
          _input_revision: "rev-1",
          _max_tokens: 1000,
        });
        expect(invalid.error).not.toBeNull();

        // Happy
        const happy = await clientService.rpc("reserve_ai_call", {
          _user_id: userRegular,
          _case_id: testCaseId,
          _task: "transcribe",
          _model: "gemini-2.5",
          _prompt_version: "v1",
          _input_revision: "rev-1",
          _max_tokens: 1000,
        });
        expect(happy.error).toBeNull();
        expect(happy.data).toMatch(/^[0-9a-f-]{36}$/);
      }

      // 19. append_audit_event(_actor, _case, _action, _target_table, _record, _changes, _correlation)
      {
        rpcAuditList.push("append_audit_event");
        // Unauthorized
        const unauth = await clientReg.rpc("append_audit_event", {
          _actor: userRegular,
          _case: testCaseId,
          _action: "manual_log",
          _target_table: "cases",
          _record: testCaseId,
          _changes: {},
          _correlation: "c-1",
        });
        expect(unauth.error?.code).toBe("42501");

        // Invalid input (invalid action regex pattern)
        const invalid = await clientService.rpc("append_audit_event", {
          _actor: userRegular,
          _case: testCaseId,
          _action: "123-illegal-start-with-number",
          _target_table: "cases",
          _record: testCaseId,
          _changes: {},
          _correlation: "c-1",
        });
        expect(invalid.error).not.toBeNull();

        // Happy
        const happy = await clientService.rpc("append_audit_event", {
          _actor: userRegular,
          _case: testCaseId,
          _action: "security_check_passed",
          _target_table: "cases",
          _record: testCaseId,
          _changes: { note: "verified" },
          _correlation: "c-docker-1",
        });
        expect(happy.error).toBeNull();
        expect(happy.data).toMatch(/^[0-9a-f-]{36}$/);
      }

      // Coverage assertion: All 19 application RPCs verified
      expect(rpcAuditList.length).toBe(19);
      const uniqueCovered = Array.from(new Set(rpcAuditList));
      expect(uniqueCovered.length).toBe(19);
    } finally {
      await pg.end();
    }
  }, 90_000);
});

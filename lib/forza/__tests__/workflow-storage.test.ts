// @vitest-environment node
import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ensureWorkflowStorageDir } from "../workflow-storage.server";

describe("ensureWorkflowStorageDir", () => {
  const originalEnv = process.env.WORKFLOW_LOCAL_DATA_DIR;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.WORKFLOW_LOCAL_DATA_DIR = originalEnv;
    } else {
      delete process.env.WORKFLOW_LOCAL_DATA_DIR;
    }
  });

  it("ensures runs directory exists and is writable", async () => {
    const dir = await ensureWorkflowStorageDir();
    expect(dir).toBeTruthy();
    const runsPath = path.join(dir, "runs");
    expect(fs.existsSync(runsPath)).toBe(true);
    expect(process.env.WORKFLOW_LOCAL_DATA_DIR).toBe(dir);
  });

  it("respects custom WORKFLOW_LOCAL_DATA_DIR if writable", async () => {
    const custom = path.join(os.tmpdir(), "test-workflow-" + Date.now());
    process.env.WORKFLOW_LOCAL_DATA_DIR = custom;
    const dir = await ensureWorkflowStorageDir();
    expect(dir).toBe(custom);
    expect(fs.existsSync(path.join(custom, "runs"))).toBe(true);
    // Cleanup
    fs.rmSync(custom, { recursive: true, force: true });
  });
});

import * as account from "@/lib/forza/account.functions";
import * as ai from "@/lib/forza/ai.functions";
import * as caseGraph from "@/lib/forza/case-graph.functions";
import * as caseWrite from "@/lib/forza/case-write.functions";
import * as dimitri from "@/lib/forza/dimitri.functions";
import * as forenzx from "@/lib/forza/forenzx-mcp.functions";
import * as health from "@/lib/forza/health.functions";
import * as importFns from "@/lib/forza/import.functions";
import * as profile from "@/lib/forza/profile.functions";
import * as quarantine from "@/lib/forza/quarantine.functions";
import { SERVER_FN_ID_PATTERN } from "@/lib/tanstack-start-shim";

/**
 * Jediný zoznam serverových funkcií volateľných cez /api/fn/<id>. Funkcia,
 * ktorá tu nie je, sa z prehliadača zavolať nedá (fail-closed).
 */
export const SERVER_FN_MODULES: Record<string, Record<string, unknown>> = {
  account,
  ai,
  "case-graph": caseGraph,
  "case-write": caseWrite,
  dimitri,
  forenzx,
  health,
  import: importFns,
  profile,
  quarantine,
};

export type RegisteredServerFn = ((args: { data: unknown }) => Promise<unknown>) & {
  _isServerFn: true;
  id: string | undefined;
};

function isServerFn(value: unknown): value is RegisteredServerFn {
  return typeof value === "function" && (value as { _isServerFn?: unknown })._isServerFn === true;
}

export function buildServerFnRegistry(
  modules: Record<string, Record<string, unknown>> = SERVER_FN_MODULES,
): Map<string, RegisteredServerFn> {
  const registry = new Map<string, RegisteredServerFn>();
  for (const [moduleName, exports] of Object.entries(modules)) {
    for (const [exportName, value] of Object.entries(exports)) {
      if (!isServerFn(value)) continue;
      const expected = `${moduleName}/${exportName}`;
      if (value.id !== expected || !SERVER_FN_ID_PATTERN.test(expected)) {
        throw new Error(`Serverová funkcia ${expected} má nesprávne id "${value.id ?? ""}".`);
      }
      if (registry.has(expected)) throw new Error(`Duplicitné id serverovej funkcie ${expected}.`);
      registry.set(expected, value);
    }
  }
  return registry;
}

let cached: Map<string, RegisteredServerFn> | undefined;

export function getServerFn(id: string): RegisteredServerFn | undefined {
  cached ??= buildServerFnRegistry();
  return cached.get(id);
}

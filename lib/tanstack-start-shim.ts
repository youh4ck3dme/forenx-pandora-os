/**
 * Next.js compatibility shim for @tanstack/react-start.
 * Allows using createServerFn, createMiddleware, useServerFn, and getRequest
 * inside Next.js without pulling in TanStack Start's SSR Vite runtime / node:async_hooks.
 *
 * P0: handler sa NIKDY nespúšťa v prehliadači. Klient volá POST /api/fn/<id>
 * (app/api/fn/[...id]/route.ts) s Bearer tokenom používateľa; middleware aj
 * handler bežia na serveri so skutočnými hlavičkami requestu.
 */
import { newTraceId } from "./forza/trace";
import type { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type AppSupabaseClient = Omit<ReturnType<typeof createClient<Database>>, "rpc"> & {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

export interface ServerFnContext {
  traceId: string;
  supabase: AppSupabaseClient;
  userId: string;
  claims: Record<string, unknown>;
  [key: string]: unknown;
}

export type MiddlewareNextResult<TContext = unknown> = {
  context?: TContext;
  headers?: HeadersInit;
};

export type MiddlewareServerFn<TContext = unknown> = (args: {
  next: (result?: MiddlewareNextResult<Record<string, unknown>>) => Promise<unknown>;
  context?: TContext;
}) => Promise<unknown>;

export type MiddlewareClientFn = (args: {
  next: (result?: { headers?: HeadersInit }) => Promise<unknown>;
}) => Promise<unknown>;

export interface Middleware {
  readonly _isMiddleware: true;
  server: (fn: MiddlewareServerFn<Record<string, unknown>>) => Middleware;
  client: (fn: MiddlewareClientFn) => Middleware;
  execute: (
    ctx: Record<string, unknown>,
    next: (newCtx: Record<string, unknown>) => Promise<unknown>,
  ) => Promise<unknown>;
}

export function createMiddleware(_options?: { type?: string }): Middleware {
  let executeFn: (
    ctx: Record<string, unknown>,
    next: (newCtx: Record<string, unknown>) => Promise<unknown>,
  ) => Promise<unknown> = async (ctx, next) => next(ctx);

  const mw: Middleware = {
    _isMiddleware: true,
    server(fn) {
      executeFn = async (ctx, next) => {
        return fn({
          context: ctx,
          next: async (res) => {
            const mergedContext: Record<string, unknown> = {
              ...ctx,
              ...(res?.context ?? {}),
            };
            return next(mergedContext);
          },
        });
      };
      return mw;
    },
    client(_fn) {
      return mw;
    },
    execute: (ctx, next) => executeFn(ctx, next),
  };
  return mw;
}

export function getRequest(): { headers: Headers } | undefined {
  if (typeof window !== "undefined") return undefined;
  // Request aktuálneho volania /api/fn/<id> (AsyncLocalStorage nastavené v
  // lib/server-fn/request-context.server.ts — shim nesmie importovať node:*).
  const current = (
    globalThis as { __pandoraServerFnRequest?: { getStore(): { headers: Headers } | undefined } }
  ).__pandoraServerFnRequest?.getStore();
  if (current) return current;
  if (typeof Headers !== "undefined") {
    return { headers: new Headers() };
  }
  return undefined;
}

export type ValidatorFn<TInput, TOutput> =
  | ((input: TInput) => TOutput)
  | { parse: (input: TInput) => TOutput; _input?: TInput; _output?: TOutput };

export interface ServerFnCallable<TInput, TOutput> {
  (args?: { data?: TInput } | TInput | void): Promise<TOutput>;
  readonly _isServerFn: true;
  /** Stabilný identifikátor pre /api/fn/<id> ("modul/export"). */
  readonly id: string | undefined;
  readonly handler: (args: { data: unknown; context: ServerFnContext }) => Promise<TOutput> | TOutput;
}

export interface ServerFnBuilder<TInput = unknown, TData = TInput> {
  middleware(
    mws: Array<Middleware | unknown>,
  ): ServerFnBuilder<TInput, TData>;

  validator<TValInput, TValOutput = TValInput>(
    val: ValidatorFn<TValInput, TValOutput>,
  ): ServerFnBuilder<TValInput, TValOutput>;

  inputValidator<TValInput, TValOutput = TValInput>(
    val: ValidatorFn<TValInput, TValOutput>,
  ): ServerFnBuilder<TValInput, TValOutput>;

  outputValidator<TOut>(_val: unknown): ServerFnBuilder<TInput, TData>;

  handler<TOutput>(
    handlerFn: (args: { data: TData; context: ServerFnContext }) => Promise<TOutput> | TOutput,
  ): ServerFnCallable<TInput, TOutput>;
}

export const SERVER_FN_ID_PATTERN = /^[a-z0-9-]+\/[A-Za-z0-9_]+$/;

/** Prehliadač (nie vitest/jsdom): handler sa spúšťa iba na serveri. */
function mustCallRemotely(): boolean {
  return typeof window !== "undefined" && process.env.NODE_ENV !== "test";
}

/** Volanie serverovej funkcie cez /api/fn/<id> s Bearer tokenom používateľa. */
export async function callServerFnRemote<TOutput>(
  id: string | undefined,
  data: unknown,
  deps: {
    fetch?: typeof fetch;
    getToken?: () => Promise<string | null>;
  } = {},
): Promise<TOutput> {
  if (!id || !SERVER_FN_ID_PATTERN.test(id)) {
    throw new Error("Serverová funkcia nemá platný identifikátor.");
  }
  const getToken =
    deps.getToken ??
    (async () => (await import("@/lib/forza/access-audit")).getSupabaseSessionToken());
  const token = await getToken();
  // trailingSlash: true — bez koncovej lomky by 308 poslal telo (až 240 MB) dvakrát.
  const response = await (deps.fetch ?? fetch)(`/api/fn/${id}/`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data: data === undefined ? null : data }),
  });
  type Payload = { ok?: boolean; result?: unknown; error?: unknown };
  let payload: Payload | null = null;
  try {
    payload = (await response.json()) as Payload;
  } catch {
    payload = null;
  }
  if (!response.ok || !payload?.ok) {
    const message =
      typeof payload?.error === "string" && payload.error
        ? payload.error
        : `Serverová funkcia zlyhala (HTTP ${response.status}).`;
    throw new Error(message);
  }
  return payload.result as TOutput;
}

function createBuilder<TInput = unknown, TData = TInput>(
  middlewares: Array<Middleware | unknown> = [],
  validator: unknown = null,
  id: string | undefined = undefined,
): ServerFnBuilder<TInput, TData> {
  return {
    middleware(mws) {
      return createBuilder<TInput, TData>(mws || [], validator, id);
    },
    validator<TValInput, TValOutput = TValInput>(val: ValidatorFn<TValInput, TValOutput>) {
      return createBuilder<TValInput, TValOutput>(middlewares, val, id);
    },
    inputValidator<TValInput, TValOutput = TValInput>(val: ValidatorFn<TValInput, TValOutput>) {
      return createBuilder<TValInput, TValOutput>(middlewares, val, id);
    },
    outputValidator<TOut>(_val: unknown) {
      return createBuilder<TInput, TData>(middlewares, validator, id);
    },
    handler<TOutput>(
      handlerFn: (args: { data: TData; context: ServerFnContext }) => Promise<TOutput> | TOutput,
    ): ServerFnCallable<TInput, TOutput> {
      const callable = async (inputArgs?: { data?: TInput } | TInput | void): Promise<TOutput> => {
        const rawData =
          inputArgs !== null &&
          typeof inputArgs === "object" &&
          "data" in inputArgs
            ? (inputArgs as { data: unknown }).data
            : inputArgs;

        if (mustCallRemotely()) {
          return callServerFnRemote<TOutput>(id, rawData);
        }

        let validData: unknown = rawData;
        if (validator !== null) {
          if (typeof validator === "function") {
            validData = (validator as (val: unknown) => unknown)(rawData);
          } else if (
            typeof validator === "object" &&
            validator !== null &&
            "parse" in validator &&
            typeof (validator as { parse: unknown }).parse === "function"
          ) {
            validData = (validator as { parse: (val: unknown) => unknown }).parse(rawData);
          }
        }

        // Execute middleware chain
        // P0-04: každé volanie serverovej funkcie dostane trace id (UUIDv4).
        const contextRecord: Record<string, unknown> = { traceId: newTraceId() };
        const runMws = async (
          idx: number,
          currentCtx: Record<string, unknown>,
        ): Promise<unknown> => {
          if (idx >= middlewares.length) {
            return handlerFn({
              data: validData as TData,
              context: currentCtx as ServerFnContext,
            });
          }
          const mw = middlewares[idx];
          if (
            typeof mw === "object" &&
            mw !== null &&
            "execute" in mw &&
            typeof (mw as { execute: unknown }).execute === "function"
          ) {
            const executeMw = (
              mw as {
                execute: (
                  ctx: Record<string, unknown>,
                  next: (nextCtx: Record<string, unknown>) => Promise<unknown>,
                ) => Promise<unknown>;
              }
            ).execute;
            return executeMw(currentCtx, (nextCtx: Record<string, unknown>) =>
              runMws(idx + 1, nextCtx),
            );
          }
          return runMws(idx + 1, currentCtx);
        };

        const res = await runMws(0, contextRecord);
        return res as TOutput;
      };

      const result: ServerFnCallable<TInput, TOutput> = Object.assign(callable, {
        _isServerFn: true as const,
        id,
        handler: handlerFn as (args: { data: unknown; context: ServerFnContext }) => Promise<TOutput> | TOutput,
      });

      return result;
    },
  };
}

export function createServerFn(options?: {
  method?: "GET" | "POST";
  /** "modul/export" — povinné pre volanie z prehliadača (/api/fn/<id>). */
  id?: string;
}): ServerFnBuilder<unknown, unknown> {
  return createBuilder<unknown, unknown>([], null, options?.id);
}

export function useServerFn<T>(fn: T): T {
  return fn;
}

export default {
  createServerFn,
  createMiddleware,
  useServerFn,
  getRequest,
};

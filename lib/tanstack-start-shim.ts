/**
 * Next.js compatibility shim for @tanstack/react-start.
 * Allows using createServerFn, createMiddleware, useServerFn, and getRequest
 * inside Next.js without pulling in TanStack Start's SSR Vite runtime / node:async_hooks.
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

function createBuilder<TInput = unknown, TData = TInput>(
  middlewares: Array<Middleware | unknown> = [],
  validator: unknown = null,
): ServerFnBuilder<TInput, TData> {
  return {
    middleware(mws) {
      return createBuilder<TInput, TData>(mws || [], validator);
    },
    validator<TValInput, TValOutput = TValInput>(val: ValidatorFn<TValInput, TValOutput>) {
      return createBuilder<TValInput, TValOutput>(middlewares, val);
    },
    inputValidator<TValInput, TValOutput = TValInput>(val: ValidatorFn<TValInput, TValOutput>) {
      return createBuilder<TValInput, TValOutput>(middlewares, val);
    },
    outputValidator<TOut>(_val: unknown) {
      return createBuilder<TInput, TData>(middlewares, validator);
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
        handler: handlerFn as (args: { data: unknown; context: ServerFnContext }) => Promise<TOutput> | TOutput,
      });

      return result;
    },
  };
}

export function createServerFn(_options?: { method?: "GET" | "POST" }): ServerFnBuilder<unknown, unknown> {
  return createBuilder<unknown, unknown>();
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

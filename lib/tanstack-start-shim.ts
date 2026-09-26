/**
 * Next.js compatibility shim for @tanstack/react-start.
 * Allows using createServerFn, createMiddleware, useServerFn, and getRequest
 * inside Next.js without pulling in TanStack Start's SSR Vite runtime / node:async_hooks.
 */

export type MiddlewareServerFn<TContext = any> = (args: {
  next: (result?: { context?: any; headers?: HeadersInit }) => Promise<any>;
  context?: TContext;
}) => Promise<any>;

export type MiddlewareClientFn = (args: {
  next: (result?: { headers?: HeadersInit }) => Promise<any>;
}) => Promise<any>;

export interface Middleware {
  _isMiddleware: true;
  server: (fn: MiddlewareServerFn) => Middleware;
  client: (fn: MiddlewareClientFn) => Middleware;
  execute: (ctx: any, next: (newCtx: any) => Promise<any>) => Promise<any>;
}

export function createMiddleware(options?: { type?: string }): Middleware {
  const mw: Middleware = {
    _isMiddleware: true,
    server(fn) {
      this.execute = async (ctx, next) => {
        return await fn({
          context: ctx,
          next: async (res) => {
            const mergedContext = { ...ctx, ...(res?.context || {}) };
            return await next(mergedContext);
          },
        });
      };
      return this;
    },
    client(fn) {
      return this;
    },
    execute: async (ctx, next) => next(ctx),
  };
  return mw;
}

export function getRequest() {
  if (typeof window !== "undefined") return undefined;
  return {
    headers: typeof Headers !== "undefined" ? new Headers() : ({} as any),
  };
}

export function createServerFn(options?: { method?: "GET" | "POST" }) {
  let middlewares: any[] = [];
  let validator: any = null;

  const builder = {
    middleware(mws: any[]) {
      middlewares = mws || [];
      return builder;
    },
    validator(val: any) {
      validator = val;
      return builder;
    },
    inputValidator(val: any) {
      validator = val;
      return builder;
    },
    outputValidator(_val: any) {
      return builder;
    },
    handler(handlerFn: (args: { data: any; context: any }) => Promise<any>) {
      const callable: any = async (inputArgs?: any) => {
        const rawData =
          inputArgs && typeof inputArgs === "object" && "data" in inputArgs
            ? inputArgs.data
            : inputArgs;

        let validData = rawData;
        if (validator) {
          if (typeof validator === "function") {
            validData = validator(rawData);
          } else if (validator && typeof validator.parse === "function") {
            validData = validator.parse(rawData);
          }
        }

        // Execute middleware chain
        let context: any = {};
        const runMws = async (idx: number, currentCtx: any): Promise<any> => {
          if (idx >= middlewares.length) {
            return await handlerFn({ data: validData, context: currentCtx });
          }
          const mw = middlewares[idx];
          if (mw && typeof mw.execute === "function") {
            return await mw.execute(currentCtx, (nextCtx: any) =>
              runMws(idx + 1, nextCtx),
            );
          }
          return await runMws(idx + 1, currentCtx);
        };

        return await runMws(0, context);
      };

      callable._isServerFn = true;
      callable.handler = handlerFn;
      return callable;
    },
  };

  return builder;
}

export function useServerFn<T extends (...args: any[]) => any>(fn: T): T {
  return fn;
}

export default {
  createServerFn,
  createMiddleware,
  useServerFn,
  getRequest,
};

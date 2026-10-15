import "server-only";

export type SumUpEnvironment = "sandbox" | "live";

export type SumUpBillingConfig = {
  apiKey: string;
  merchantCode: string;
  environment: SumUpEnvironment;
  baseUrl: string;
};

export class BillingConfigurationError extends Error {
  constructor() {
    super("SumUp billing is not fully configured.");
    this.name = "BillingConfigurationError";
  }
}

export class SumUpApiError extends Error {
  constructor(readonly status: number) {
    super(`SumUp API request failed with status ${status}.`);
    this.name = "SumUpApiError";
  }
}

export class SumUpEnvironmentMismatchError extends Error {
  constructor() {
    super("Configured SumUp environment does not match the merchant account.");
    this.name = "SumUpEnvironmentMismatchError";
  }
}

export function getSumUpBillingConfig(requestOrigin?: string): SumUpBillingConfig {
  const apiKey = process.env.SUMUP_API_KEY?.trim();
  const merchantCode = process.env.SUMUP_MERCHANT_CODE?.trim();
  const environment = process.env.SUMUP_ENVIRONMENT?.trim();
  const configuredBaseUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim();

  if (
    !apiKey || apiKey.length < 16 || /\s/.test(apiKey) ||
    !merchantCode || !/^[A-Za-z0-9]{4,24}$/.test(merchantCode) ||
    (environment !== "sandbox" && environment !== "live")
  ) {
    throw new BillingConfigurationError();
  }

  const requestUrl = requestOrigin ? new URL(requestOrigin) : null;
  const isLocalRequest = requestUrl &&
    (requestUrl.hostname === "localhost" || requestUrl.hostname === "127.0.0.1");
  const candidate = process.env.NODE_ENV !== "production" && isLocalRequest
    ? requestOrigin
    : configuredBaseUrl || requestOrigin;
  if (!candidate) throw new BillingConfigurationError();

  let baseUrl: URL;
  try {
    baseUrl = new URL(candidate);
  } catch {
    throw new BillingConfigurationError();
  }
  const isLoopback = baseUrl.hostname === "localhost" || baseUrl.hostname === "127.0.0.1";
  if (
    (baseUrl.protocol !== "https:" && !(isLoopback && baseUrl.protocol === "http:")) ||
    baseUrl.username || baseUrl.password ||
    (requestOrigin && process.env.NODE_ENV === "production" && new URL(requestOrigin).origin !== baseUrl.origin)
  ) {
    throw new BillingConfigurationError();
  }

  return { apiKey, merchantCode, environment, baseUrl: baseUrl.origin };
}

export async function sumupGet<T>(config: SumUpBillingConfig, path: string): Promise<T> {
  return sumupRequest<T>(config, path, "GET");
}

export async function sumupPost<T>(
  config: SumUpBillingConfig,
  path: string,
  body: unknown,
): Promise<T> {
  return sumupRequest<T>(config, path, "POST", body);
}

export async function sumupPut<T>(
  config: SumUpBillingConfig,
  path: string,
  body: unknown,
): Promise<T> {
  return sumupRequest<T>(config, path, "PUT", body);
}

export async function sumupDelete(config: SumUpBillingConfig, path: string): Promise<void> {
  await sumupRequest<unknown>(config, path, "DELETE");
}

export async function verifySumUpEnvironment(config: SumUpBillingConfig): Promise<void> {
  const merchant = await sumupGet<{ sandbox?: boolean }>(
    config,
    `v1/merchants/${encodeURIComponent(config.merchantCode)}`,
  );
  if (merchant.sandbox !== (config.environment === "sandbox")) {
    throw new SumUpEnvironmentMismatchError();
  }
}

async function sumupRequest<T>(
  config: SumUpBillingConfig,
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: unknown,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const apiPath = path.startsWith("v1/") ? path : `v0.1/${path}`;
    const response = await fetch(`https://api.sumup.com/${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new SumUpApiError(response.status);
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

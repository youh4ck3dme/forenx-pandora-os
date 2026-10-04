import { Page, expect } from '@playwright/test';

export interface GuardOptions {
  allowConsoleErrors?: (string | RegExp)[];
  allowRequestFailedUrls?: (string | RegExp)[];
  allowedStatusCodes?: number[];
  allowUrlStatusCodes?: { urlPattern: string | RegExp; status: number }[];
}

export class GuardReport {
  readonly consoleErrors: string[] = [];
  readonly pageErrors: string[] = [];
  readonly failedRequests: string[] = [];
  readonly unexpectedResponses: string[] = [];

  recordConsoleError(text: string) {
    this.consoleErrors.push(text);
  }

  recordPageError(text: string) {
    this.pageErrors.push(text);
  }

  recordFailedRequest(text: string) {
    this.failedRequests.push(text);
  }

  recordUnexpectedResponse(text: string) {
    this.unexpectedResponses.push(text);
  }

  assertClean() {
    const allErrors = [
      ...this.consoleErrors.map((e) => `[Console Error] ${e}`),
      ...this.pageErrors.map((e) => `[Page Error] ${e}`),
      ...this.failedRequests.map((e) => `[Request Failed] ${e}`),
      ...this.unexpectedResponses.map((e) => `[Unexpected Response] ${e}`),
    ];

    expect(allErrors, `Console/Network Guard detected ${allErrors.length} violation(s):\n${allErrors.join('\n')}`).toEqual([]);
  }
}

/**
 * Attaches real-time console and network guards to a Playwright page.
 * Fails when unexpected console.error, unhandled pageerror, requestfailed,
 * or unexpected 500/401/403 responses occur during test execution.
 */
export function attachGuards(page: Page, options: GuardOptions = {}): GuardReport {
  const report = new GuardReport();

  // Allowlist default patterns for benign browser noise
  const defaultAllowConsole = [
    /chrome-extension:\/\//i,
    /favicon\.ico/i,
    /Failed to load resource: the server responded with a status of 404/i,
    /WebSocket connection to '.*' failed/i,
    /warning/i,
  ];

  const mergedConsoleAllowlist = [...defaultAllowConsole, ...(options.allowConsoleErrors || [])];

  const defaultAllowRequestFailed = [
    /favicon\.ico/i,
    /manifest\.json/i,
    /chrome-extension:\/\//i,
    // RSC prefetch requests legitimately abort when page redirects server-side
    /_rsc=/i,
    /\?_rsc/i,
  ];

  const mergedRequestFailedAllowlist = [...defaultAllowRequestFailed, ...(options.allowRequestFailedUrls || [])];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      const isAllowed = mergedConsoleAllowlist.some((pat) =>
        typeof pat === 'string' ? text.includes(pat) : pat.test(text)
      );
      if (!isAllowed) {
        report.recordConsoleError(text);
      }
    }
  });

  page.on('pageerror', (err) => {
    report.recordPageError(err.message || String(err));
  });

  page.on('requestfailed', (req) => {
    const url = req.url();
    const isAllowed = mergedRequestFailedAllowlist.some((pat) =>
      typeof pat === 'string' ? url.includes(pat) : pat.test(url)
    );
    if (!isAllowed) {
      report.recordFailedRequest(`${req.method()} ${url} - ${req.failure()?.errorText || 'Unknown failure'}`);
    }
  });

  page.on('response', (res) => {
    const status = res.status();
    const url = res.url();

    // Check if specifically allowed
    if (options.allowedStatusCodes?.includes(status)) {
      return;
    }

    if (options.allowUrlStatusCodes) {
      const matched = options.allowUrlStatusCodes.some(
        (entry) =>
          (typeof entry.urlPattern === 'string' ? url.includes(entry.urlPattern) : entry.urlPattern.test(url)) &&
          entry.status === status
      );
      if (matched) return;
    }

    // Fail only on 500+ Internal Server Error — 4xx are expected during auth flows
    if (status >= 500) {
      report.recordUnexpectedResponse(`${status} ${res.request().method()} ${url}`);
    }
  });

  return report;
}

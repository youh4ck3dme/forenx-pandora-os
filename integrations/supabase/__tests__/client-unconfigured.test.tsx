/**
 * Fail-closed správanie browser Supabase klienta pri chýbajúcej verejnej
 * konfigurácii. Prehliadačový klient číta NEXT_PUBLIC_SUPABASE_URL a
 * NEXT_PUBLIC_SUPABASE_ANON_KEY (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY nečíta).
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ALL_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "VITE_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
] as const;

const CASES: Array<{ name: string; set: Partial<Record<(typeof ALL_VARS)[number], string>>; missing: string[] }> = [
  {
    name: "chýba NEXT_PUBLIC_SUPABASE_URL",
    set: { NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key-value" },
    missing: ["NEXT_PUBLIC_SUPABASE_URL"],
  },
  {
    name: "chýba NEXT_PUBLIC_SUPABASE_ANON_KEY",
    set: { NEXT_PUBLIC_SUPABASE_URL: "https://test-project.supabase.invalid" },
    missing: ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
  },
  {
    name: "chýbajú obe premenné",
    set: {},
    missing: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
  },
];

async function loadClient() {
  vi.resetModules();
  const mod = await import("@/integrations/supabase/client");
  mod.resetSupabaseClientForTests();
  return mod;
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  for (const name of ALL_VARS) vi.stubEnv(name, "");
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each(CASES)("browser Supabase klient — $name", ({ set, missing }) => {
  beforeEach(() => {
    for (const [name, value] of Object.entries(set)) vi.stubEnv(name, value);
  });

  it("isSupabaseConfigured() je false a auth stuby nikdy nevrátia session ani nehodia TypeError", async () => {
    const { supabase, isSupabaseConfigured, SupabaseConfigError } = await loadClient();
    expect(isSupabaseConfigured()).toBe(false);

    const session = await supabase.auth.getSession();
    expect(session.data.session).toBeNull();
    expect(session.error).toBeInstanceOf(SupabaseConfigError);
    expect((session.error as InstanceType<typeof SupabaseConfigError>).missing).toEqual(missing);

    const user = await supabase.auth.getUser();
    expect(user.data.user).toBeNull();

    const signIn = await supabase.auth.signInWithPassword({ email: "a@b.test", password: "x" });
    expect(signIn.data.session).toBeNull();
    expect(signIn.error).toBeInstanceOf(SupabaseConfigError);

    const signUp = await supabase.auth.signUp({ email: "a@b.test", password: "xxxxxxxx" });
    expect(signUp.error).toBeInstanceOf(SupabaseConfigError);

    const reset = await supabase.auth.resetPasswordForEmail("a@b.test");
    expect(reset.error).toBeInstanceOf(SupabaseConfigError);

    const { data } = supabase.auth.onAuthStateChange(() => {});
    expect(() => data.subscription.unsubscribe()).not.toThrow();
  });

  it("ostatné API (from/storage/rpc) hodia kontrolovanú SupabaseConfigError, nie TypeError", async () => {
    const { supabase, SupabaseConfigError } = await loadClient();
    expect(() => supabase.from("cases")).toThrow(SupabaseConfigError);
    expect(() => supabase.storage).toThrow(SupabaseConfigError);
    expect(() => supabase.rpc("noop" as never)).toThrow(SupabaseConfigError);
  });

  it("zaloguje jeden diagnostický riadok iba s názvami premenných (bez hodnôt)", async () => {
    const { supabase } = await loadClient();
    await supabase.auth.getSession();
    await supabase.auth.getSession();
    void supabase.auth;
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    const line = String(errorSpy.mock.calls[0]?.[0]);
    expect(line).toContain("Supabase configuration missing");
    for (const name of missing) expect(line).toContain(name);
    for (const value of Object.values(set)) expect(line).not.toContain(value);
    expect(line).not.toMatch(/service[_-]?role/i);
  });

  it("AuthCookieSync sa vyrenderuje bez pádu (žiadny getSession na null klientovi)", async () => {
    await loadClient();
    const { AuthCookieSync } = await import("@/components/core/providers/auth-cookie-sync");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    expect(() => render(<AuthCookieSync />)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringMatching(/TypeError|getSession/));
  });

  it("prihlasovací formulár je vypnutý a zobrazí slovenské upozornenie", async () => {
    await loadClient();
    const { AccountSignInForm } = await import("@/components/malte/AccountSignInForm");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AccountSignInForm dark />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("auth-config-missing").textContent).toMatch(/Prihlásenie je dočasne nedostupné/);
    // Vypnuté cez <fieldset disabled> → :disabled platí pre všetky ovládacie prvky.
    expect(screen.getByLabelText("E-mail účtu").matches(":disabled")).toBe(true);
    expect(screen.getByLabelText("Heslo účtu").matches(":disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Prihlásiť sa do účtu" }).matches(":disabled")).toBe(true);
  });
});

describe("browser Supabase klient — nakonfigurovaný", () => {
  it("s URL + ANON_KEY je isSupabaseConfigured() true a formulár je aktívny", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test-project.supabase.invalid");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key-value");
    const { isSupabaseConfigured } = await loadClient();
    expect(isSupabaseConfigured()).toBe(true);
    const { AccountSignInForm } = await import("@/components/malte/AccountSignInForm");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AccountSignInForm dark />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("auth-config-missing")).toBeNull();
    expect(screen.getByLabelText("E-mail účtu").matches(":disabled")).toBe(false);
  });
});

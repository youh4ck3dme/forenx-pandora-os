// Adapted from Vite import.meta.env to Next.js process.env
const clientToken = process.env.NEXT_PUBLIC_PAYMENTS_CLIENT_TOKEN as
  string | undefined;

export function PaymentTestModeBanner() {
  if (!clientToken) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-[11px] text-destructive">
        Platby nie sú pre toto zostavenie nakonfigurované — skutočné platby
        zatiaľ nie sú možné.
      </div>
    );
  }
  if (clientToken.startsWith("pk_test_")) {
    return (
      <div className="rounded-2xl border border-risk-medium/40 bg-risk-medium/10 px-4 py-2 text-center text-[11px] text-risk-medium">
        Testovací režim — žiadne skutočné peniaze. Testovacia karta 4242 4242
        4242 4242.
      </div>
    );
  }
  return null;
}

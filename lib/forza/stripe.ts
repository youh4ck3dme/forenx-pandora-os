// Adapted for Next.js: uses process.env instead of import.meta.env

type StripeEnv = "sandbox" | "live";

const clientToken = typeof window !== "undefined"
  ? process.env.NEXT_PUBLIC_PAYMENTS_CLIENT_TOKEN
  : undefined;

/** True keď je platobná integrácia nakonfigurovaná pre tento build. */
export function paymentsConfigured(): boolean {
  return Boolean(
    clientToken?.startsWith("pk_test_") || clientToken?.startsWith("pk_live_"),
  );
}

function paymentsEnvironment(): StripeEnv {
  if (clientToken?.startsWith("pk_test_")) return "sandbox";
  if (clientToken?.startsWith("pk_live_")) return "live";
  throw new Error(
    "Platby nie sú pre toto zostavenie nakonfigurované. Dokončite nastavenie platieb v projekte.",
  );
}

let stripePromise: Promise<import("@stripe/stripe-js").Stripe | null> | null = null;

/**
 * Načíta Stripe.js až pri prvom volaní (po kliknutí na plán / mount checkoute).
 * Import tohto modulu sám o sebe nenaťahuje js.stripe.com.
 */
export async function getStripe() {
  if (!stripePromise) {
    paymentsEnvironment();
    stripePromise = import("@stripe/stripe-js").then(({ loadStripe }) =>
      loadStripe(clientToken as string),
    );
  }
  return stripePromise;
}

export function getStripeEnvironment(): StripeEnv {
  return paymentsEnvironment();
}

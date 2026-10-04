// Stub: StripeEmbeddedCheckout — will be implemented when Stripe is configured
export function StripeEmbeddedCheckout({ clientSecret }: { clientSecret: string }) {
  return (
    <div className="rounded-2xl border border-muted p-6 text-center text-sm text-muted-foreground">
      Stripe Checkout sa načítava… (clientSecret: {clientSecret ? "✓" : "chýba"})
    </div>
  );
}

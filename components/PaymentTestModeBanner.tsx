type PaymentEnvironmentBannerProps = {
  configured?: boolean;
  sandboxMode?: boolean;
};

export function PaymentTestModeBanner({
  configured,
  sandboxMode,
}: PaymentEnvironmentBannerProps) {
  if (configured === false) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-[11px] text-destructive">
        SumUp platby nie sú na serveri nakonfigurované.
      </div>
    );
  }
  if (sandboxMode) {
    return (
      <div className="rounded-2xl border border-risk-medium/40 bg-risk-medium/10 px-4 py-2 text-center text-[11px] text-risk-medium">
        SumUp sandbox — skutočné platby sú vypnuté.
      </div>
    );
  }
  return null;
}

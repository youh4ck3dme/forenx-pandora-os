import { Metadata } from "next";

export const metadata: Metadata = {
  title: "A.R.C. Forge | PΛND0RΛ Browser",
  description: "AI React Creator - Build apps at the speed of thought",
};

export default function ForgeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

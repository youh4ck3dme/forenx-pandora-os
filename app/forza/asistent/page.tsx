"use client";

import { Suspense } from "react";
import { Assistant } from "@/components/malte/Assistant";

export default function AsistentPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background text-foreground" />}>
      <Assistant />
    </Suspense>
  );
}

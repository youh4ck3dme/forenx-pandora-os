"use client"

import { BrowserClient } from "@/components/features/browser/browser-client"
import { Leva } from "leva"

export default function Home() {
  return (
    <>
      <BrowserClient />
      <Leva hidden />
    </>
  )
}

"use client";

import { useState, useEffect } from "react";

export type AccountProfileValue = {
  fullName: string;
  email: string;
  office: string;
  role?: string;
  avatarUrl: string;
  completed: boolean;
  /** true = profil je uložený v účte, false = len na tomto zariadení. */
  cloud: boolean;
};

const LOCAL_PROFILE_KEY = "forza-local-profile";

function readLocalProfile(): AccountProfileValue {
  if (typeof window === "undefined") {
    return {
      fullName: "",
      email: "",
      office: "",
      avatarUrl: "",
      completed: false,
      cloud: false,
    };
  }
  try {
    const raw = localStorage.getItem(LOCAL_PROFILE_KEY);
    if (raw) return { ...JSON.parse(raw), cloud: false };
  } catch { /* ignore */ }
  return {
    fullName: "",
    email: "",
    office: "",
    avatarUrl: "",
    completed: false,
    cloud: false,
  };
}

/**
 * Hook na čítanie profilu používateľa.
 * Momentálne číta len z localStorage (offline-first mód).
 * Supabase integrácia sa pridá neskôr.
 */
export function useAccountProfile() {
  const [data, setData] = useState<AccountProfileValue | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setData(readLocalProfile());
    setIsLoading(false);
  }, []);

  return {
    data,
    isLoading,
    isError: false,
    identity: null,
    accountKey: "local",
    refetch: async () => {
      setData(readLocalProfile());
      return { data: readLocalProfile() };
    },
  };
}

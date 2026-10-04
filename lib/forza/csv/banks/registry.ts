import type { BankId, BankProfile } from "./types";
import { tatraProfile } from "./tatra.profile";
import { slspProfile } from "./slsp.profile";
import { vubProfile } from "./vub.profile";
import { csobProfile } from "./csob.profile";
import { fioProfile } from "./fio.profile";

/**
 * Predvolené profily podporovaných bánk (SK / CZ).
 */
const DEFAULT_PROFILES: BankProfile[] = [
  tatraProfile,
  slspProfile,
  vubProfile,
  csobProfile,
  fioProfile,
];

class BankProfileRegistry {
  private profiles = new Map<string, BankProfile>();

  constructor(initialProfiles: BankProfile[] = DEFAULT_PROFILES) {
    for (const profile of initialProfiles) {
      this.profiles.set(profile.id, profile);
    }
  }

  /**
   * Zaregistruje nový alebo aktualizuje existujúci profil banky (Strategy Pattern).
   */
  register(profile: BankProfile): void {
    this.profiles.set(profile.id, profile);
  }

  /**
   * Odstráni profil banky z registra.
   */
  unregister(bankId: string): boolean {
    return this.profiles.delete(bankId);
  }

  /**
   * Získa profil banky podľa ID.
   */
  get(bankId: string): BankProfile | undefined {
    return this.profiles.get(bankId);
  }

  /**
   * Vráti všetky registrované profily bánk.
   */
  getAll(): BankProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Resetuje register na predvolené profily.
   */
  reset(): void {
    this.profiles.clear();
    for (const profile of DEFAULT_PROFILES) {
      this.profiles.set(profile.id, profile);
    }
  }
}

export const bankRegistry = new BankProfileRegistry();

export function registerBankProfile(profile: BankProfile): void {
  bankRegistry.register(profile);
}

export function unregisterBankProfile(bankId: string): boolean {
  return bankRegistry.unregister(bankId);
}

export function getBankProfile(bankId: string): BankProfile | undefined {
  return bankRegistry.get(bankId);
}

export function getRegisteredBankProfiles(): BankProfile[] {
  return bankRegistry.getAll();
}

/**
 * Spätne kompatibilné pole profilov bánk.
 */
export const BANK_PROFILES: BankProfile[] = DEFAULT_PROFILES;

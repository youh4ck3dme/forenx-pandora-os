import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/malte/Shell";
import type {
  CaseEvent,
  Entity,
  Relation,
  Transaction,
  Weapon,
} from "@/forensic";
import {
  upsertEntity,
  upsertEvent,
  upsertRelation,
  upsertTransaction,
  upsertWeapon,
} from "@/lib/case-data";

export const inputClass =
  "h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Spoločný obal: priebeh ukladania, chyby a ochrana pred dvojitým odoslaním. */
function useSubmit(onSaved: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, successMessage: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      toast.success(successMessage);
      onSaved();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Uloženie zlyhalo.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, run };
}

function FormFooter({
  busy,
  error,
  label,
  onCancel,
}: {
  busy: boolean;
  error: string | null;
  label: string;
  onCancel?: (() => void) | undefined;
}) {
  return (
    <>
      {error ? (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            className="flex-1"
            onClick={onCancel}
          >
            Zrušiť
          </Button>
        ) : null}
        <Button type="submit" className="flex-1" disabled={busy}>
          {busy ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
          ) : null}
          {label}
        </Button>
      </div>
    </>
  );
}

type Common = {
  caseId: string;
  onSaved: () => void;
  onCancel?: (() => void) | undefined;
  revision?: number | undefined;
};

/* --------------------------------- subjekt --------------------------------- */

export function EntityForm({
  caseId,
  onSaved,
  onCancel,
  revision,
  initial,
}: Common & { initial?: Entity }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<"person" | "company">(
    initial?.kind ?? "person",
  );
  const [role, setRole] = useState(initial?.role ?? "");
  const [ico, setIco] = useState(initial?.ico ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [registeredAddress, setRegisteredAddress] = useState(
    initial?.registeredAddress ?? "",
  );
  const [country, setCountry] = useState(initial?.country ?? "SK");
  const { busy, error, run } = useSubmit(onSaved);

  return (
    <Card className="space-y-3">
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            () =>
              upsertEntity({
                data: {
                  ...(initial
                    ? { id: initial.id, expectedRevision: revision }
                    : {}),
                  caseId,
                  name,
                  kind,
                  role,
                  ico: ico || null,
                  address: address || null,
                  registeredAddress: registeredAddress || null,
                  country,
                },
              }),
            initial ? "Subjekt upravený." : "Subjekt pridaný.",
          );
        }}
      >
        <Field label="Meno alebo názov">
          <input
            required
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="flex gap-2">
          {(["person", "company"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
              className={
                kind === value
                  ? "h-9 flex-1 rounded-xl border border-transparent gradient-brand text-xs font-medium"
                  : "h-9 flex-1 rounded-xl border border-border bg-card text-xs font-medium text-muted-foreground"
              }
            >
              {value === "person" ? "Osoba" : "Firma"}
            </button>
          ))}
        </div>
        <Field label="Rola v prípade">
          <input
            className={inputClass}
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
        </Field>
        {kind === "company" ? (
          <>
            <Field label="IČO">
              <input
                className={inputClass}
                value={ico}
                onChange={(e) => setIco(e.target.value)}
              />
            </Field>
            <Field label="Deklarovaná adresa">
              <input
                className={inputClass}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </Field>
            <Field label="Adresa v registri">
              <input
                className={inputClass}
                value={registeredAddress}
                onChange={(e) => setRegisteredAddress(e.target.value)}
              />
            </Field>
          </>
        ) : null}
        <Field label="Krajina (dvojpísmenový kód)">
          <input
            className={inputClass}
            maxLength={2}
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
          />
        </Field>
        <FormFooter
          busy={busy}
          error={error}
          label={initial ? "Uložiť zmeny" : "Pridať subjekt"}
          onCancel={onCancel}
        />
      </form>
    </Card>
  );
}

/* -------------------------------- transakcia ------------------------------- */

export function TransactionForm({
  caseId,
  entities,
  baseCurrency,
  onSaved,
  onCancel,
  revision,
  initial,
}: Common & {
  entities: Entity[];
  baseCurrency: string;
  initial?: Transaction;
}) {
  const [date, setDate] = useState(
    initial?.date ?? new Date().toISOString().slice(0, 10),
  );
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [currency, setCurrency] = useState(
    initial?.currency ?? baseCurrency ?? "EUR",
  );
  const [method, setMethod] = useState<"cash" | "transfer">(
    initial?.method ?? "transfer",
  );
  const [fromId, setFromId] = useState(
    initial?.fromId ?? entities[0]?.id ?? "",
  );
  const [toId, setToId] = useState(initial?.toId ?? entities[1]?.id ?? "");
  const [payerId, setPayerId] = useState(initial?.payerId ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const { busy, error, run } = useSubmit(onSaved);

  if (entities.length < 2) {
    return (
      <Card>
        <p className="text-caption">
          Na zadanie transakcie potrebujete aspoň dva subjekty v prípade.
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-3">
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            () =>
              upsertTransaction({
                data: {
                  ...(initial
                    ? { id: initial.id, expectedRevision: revision }
                    : {}),
                  caseId,
                  date,
                  amount: Number(amount.replace(",", ".")),
                  currency,
                  method,
                  fromId,
                  toId,
                  payerId: payerId || null,
                  description,
                },
              }),
            initial ? "Transakcia upravená." : "Transakcia pridaná.",
          );
        }}
      >
        <Field label="Dátum">
          <input
            type="date"
            required
            className={inputClass}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <div className="flex gap-2">
          <div className="flex-1">
            <Field label="Suma (záporná = opačný smer)">
              <input
                required
                inputMode="decimal"
                placeholder="0.00"
                className={inputClass}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
          </div>
          <div className="w-24">
            <Field label="Mena">
              <input
                className={inputClass}
                maxLength={3}
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </Field>
          </div>
        </div>
        <div className="flex gap-2">
          {(["transfer", "cash"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={method === value}
              onClick={() => setMethod(value)}
              className={
                method === value
                  ? "h-9 flex-1 rounded-xl border border-transparent gradient-brand text-xs font-medium"
                  : "h-9 flex-1 rounded-xl border border-border bg-card text-xs font-medium text-muted-foreground"
              }
            >
              {value === "cash" ? "Hotovosť" : "Prevod"}
            </button>
          ))}
        </div>
        <Field label="Odosielateľ">
          <select
            className={inputClass}
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
          >
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Príjemca">
          <select
            className={inputClass}
            value={toId}
            onChange={(e) => setToId(e.target.value)}
          >
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Skutočný platiteľ (nepovinné)">
          <select
            className={inputClass}
            value={payerId}
            onChange={(e) => setPayerId(e.target.value)}
          >
            <option value="">— rovnaký ako odosielateľ —</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Popis">
          <input
            className={inputClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <FormFooter
          busy={busy}
          error={error}
          label={initial ? "Uložiť zmeny" : "Pridať transakciu"}
          onCancel={onCancel}
        />
      </form>
    </Card>
  );
}

/* ---------------------------------- vzťah ---------------------------------- */

export function RelationForm({
  caseId,
  entities,
  onSaved,
  onCancel,
  revision,
  initial,
}: Common & { entities: Entity[]; initial?: Relation & { id?: string } }) {
  const [fromId, setFromId] = useState(
    initial?.fromId ?? entities[0]?.id ?? "",
  );
  const [toId, setToId] = useState(initial?.toId ?? entities[1]?.id ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const { busy, error, run } = useSubmit(onSaved);

  if (entities.length < 2) {
    return (
      <Card>
        <p className="text-caption">
          Na zadanie vzťahu potrebujete aspoň dva subjekty.
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-3">
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            () =>
              upsertRelation({
                data: {
                  ...(initial?.id
                    ? { id: initial.id, expectedRevision: revision }
                    : {}),
                  caseId,
                  fromId,
                  toId,
                  label,
                },
              }),
            initial?.id ? "Vzťah upravený." : "Vzťah pridaný.",
          );
        }}
      >
        <Field label="Od subjektu">
          <select
            className={inputClass}
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
          >
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="K subjektu">
          <select
            className={inputClass}
            value={toId}
            onChange={(e) => setToId(e.target.value)}
          >
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Popis vzťahu">
          <input
            required
            className={inputClass}
            placeholder="napr. konateľ, dodávateľ"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <FormFooter
          busy={busy}
          error={error}
          label="Uložiť vzťah"
          onCancel={onCancel}
        />
      </form>
    </Card>
  );
}

/* ---------------------------------- zbraň ---------------------------------- */

export function WeaponForm({
  caseId,
  entities,
  onSaved,
  onCancel,
  revision,
  initial,
}: Common & { entities: Entity[]; initial?: Weapon }) {
  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [serial, setSerial] = useState(initial?.serial ?? "");
  const [holderId, setHolderId] = useState(
    initial?.holderId ?? entities[0]?.id ?? "",
  );
  const [supplierId, setSupplierId] = useState(
    initial?.supplierId ?? entities[0]?.id ?? "",
  );
  const [acquiredAt, setAcquiredAt] = useState(initial?.acquiredAt ?? "");
  const [licence, setLicence] = useState(initial?.licence ?? "");
  const { busy, error, run } = useSubmit(onSaved);

  if (entities.length === 0) {
    return (
      <Card>
        <p className="text-caption">
          Najprv pridajte subjekty — držiteľa a dodávateľa.
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-3">
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            () =>
              upsertWeapon({
                data: {
                  ...(initial
                    ? { id: initial.id, expectedRevision: revision }
                    : {}),
                  caseId,
                  brand,
                  model,
                  serial,
                  holderId,
                  supplierId,
                  acquiredAt: acquiredAt || null,
                  licence: licence || null,
                },
              }),
            initial ? "Zbraň upravená." : "Zbraň pridaná.",
          );
        }}
      >
        <Field label="Značka">
          <input
            required
            className={inputClass}
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          />
        </Field>
        <Field label="Model">
          <input
            className={inputClass}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </Field>
        <Field label="Výrobné číslo">
          <input
            required
            className={inputClass}
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
          />
        </Field>
        <Field label="Držiteľ">
          <select
            className={inputClass}
            value={holderId}
            onChange={(e) => setHolderId(e.target.value)}
          >
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Dodávateľ">
          <select
            className={inputClass}
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Dátum nadobudnutia">
          <input
            type="date"
            className={inputClass}
            value={acquiredAt}
            onChange={(e) => setAcquiredAt(e.target.value)}
          />
        </Field>
        <Field label="Číslo preukazu">
          <input
            className={inputClass}
            value={licence}
            onChange={(e) => setLicence(e.target.value)}
          />
        </Field>
        <FormFooter
          busy={busy}
          error={error}
          label="Uložiť zbraň"
          onCancel={onCancel}
        />
      </form>
    </Card>
  );
}

/* --------------------------------- udalosť --------------------------------- */

export function EventForm({
  caseId,
  onSaved,
  onCancel,
  revision,
  initial,
}: Common & { initial?: CaseEvent & { id?: string } }) {
  const [date, setDate] = useState(
    initial?.date ?? new Date().toISOString().slice(0, 10),
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [detail, setDetail] = useState(initial?.detail ?? "");
  const [severity, setSeverity] = useState(initial?.severity ?? "low");
  const { busy, error, run } = useSubmit(onSaved);

  return (
    <Card className="space-y-3">
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            () =>
              upsertEvent({
                data: {
                  ...(initial?.id
                    ? { id: initial.id, expectedRevision: revision }
                    : {}),
                  caseId,
                  date,
                  title,
                  detail,
                  severity,
                },
              }),
            initial?.id ? "Udalosť upravená." : "Udalosť pridaná.",
          );
        }}
      >
        <Field label="Dátum">
          <input
            type="date"
            required
            className={inputClass}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Názov udalosti">
          <input
            required
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Detail">
          <input
            className={inputClass}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
        </Field>
        <Field label="Závažnosť">
          <select
            className={inputClass}
            value={severity}
            onChange={(e) => setSeverity(e.target.value as typeof severity)}
          >
            <option value="low">Nízka</option>
            <option value="medium">Stredná</option>
            <option value="high">Vysoká</option>
            <option value="critical">Kritická</option>
          </select>
        </Field>
        <FormFooter
          busy={busy}
          error={error}
          label="Uložiť udalosť"
          onCancel={onCancel}
        />
      </form>
    </Card>
  );
}

/** Rozbaľovací panel na pridanie záznamu priamo na príslušnej obrazovke. */
export function AddPanel({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant={open ? "ghost" : "secondary"}
        className="w-full"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Zavrieť formulár" : label}
      </Button>
      {open ? <div>{children}</div> : null}
    </div>
  );
}

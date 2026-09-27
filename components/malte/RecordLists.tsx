import { useState } from "react";
import { Pencil } from "lucide-react";
import { Card, SectionTitle } from "@/components/malte/Shell";
import { DeleteRecordButton } from "@/components/malte/DeleteRecordButton";
import { EntityForm, TransactionForm } from "@/components/malte/CaseForms";
import { VirtualTransactionList } from "@/components/malte/VirtualTransactionList";
import { formatDate } from "@/forensic";
import { formatMoney } from "@/forensic/core/money";
import type { Entity, Transaction } from "@/forensic";

type ListProps = {
  caseId: string;
  entities: Entity[];
  revisions: Record<string, number>;
  onChanged: () => void;
};

/** Nad touto hranicou sa zoznam virtualizuje (P3-02: 10 000+ položiek, 60 FPS). */
export const VIRTUAL_TRANSACTION_THRESHOLD = 200;

export function TransactionList({
  caseId,
  entities,
  transactions,
  baseCurrency,
  revisions,
  onChanged,
}: ListProps & { transactions: Transaction[]; baseCurrency: string }) {
  const [editing, setEditing] = useState<string | null>(null);
  const names = new Map(entities.map((entity) => [entity.id, entity.name]));

  if (transactions.length === 0) return null;

  if (transactions.length > VIRTUAL_TRANSACTION_THRESHOLD) {
    return (
      <VirtualTransactionList
        caseId={caseId}
        entities={entities}
        transactions={transactions}
        baseCurrency={baseCurrency}
        revisions={revisions}
        onChanged={onChanged}
      />
    );
  }

  return (
    <>
      <SectionTitle>Zadané transakcie</SectionTitle>
      <div className="space-y-2">
        {transactions.map((transaction) => (
          <TransactionRow
            key={transaction.id}
            transaction={transaction}
            caseId={caseId}
            entities={entities}
            baseCurrency={baseCurrency}
            names={names}
            revision={revisions[transaction.id]}
            editing={editing === transaction.id}
            onEdit={setEditing}
            onChanged={onChanged}
          />
        ))}
      </div>
    </>
  );
}

/** Jeden riadok transakcie; používa ho obyčajný aj virtualizovaný zoznam. */
export function TransactionRow({
  transaction,
  caseId,
  entities,
  baseCurrency,
  names,
  revision,
  editing,
  onEdit,
  onChanged,
}: {
  transaction: Transaction;
  caseId: string;
  entities: Entity[];
  baseCurrency: string;
  names: Map<string, string>;
  revision?: number;
  editing: boolean;
  onEdit: (id: string | null) => void;
  onChanged: () => void;
}) {
  if (editing) {
    return (
      <TransactionForm
        caseId={caseId}
        entities={entities}
        baseCurrency={baseCurrency}
        initial={transaction}
        revision={revision}
        onCancel={() => onEdit(null)}
        onSaved={() => {
          onEdit(null);
          onChanged();
        }}
      />
    );
  }
  return (
    <Card
      data-transaction-id={transaction.id}
      className="flex items-center gap-3"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold tnum">
          {formatMoney(transaction.amount, transaction.currency)}
        </p>
        <p className="text-caption truncate">
          {formatDate(transaction.date)} •{" "}
          {names.get(transaction.fromId) ?? "?"} →{" "}
          {names.get(transaction.toId) ?? "?"}
          {transaction.description ? ` • ${transaction.description}` : ""}
        </p>
      </div>
      <button
        type="button"
        aria-label={`Upraviť transakciu z ${transaction.date}`}
        onClick={() => onEdit(transaction.id)}
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        <Pencil className="h-4 w-4" aria-hidden />
      </button>
      <DeleteRecordButton
        type="transaction"
        id={transaction.id}
        label="transakciu"
        onDeleted={onChanged}
      />
    </Card>
  );
}

export function EntityList({
  caseId,
  entities,
  revisions,
  onChanged,
}: ListProps) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {entities.map((entity) =>
        editing === entity.id ? (
          <EntityForm
            key={entity.id}
            caseId={caseId}
            initial={entity}
            revision={revisions[entity.id]}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              onChanged();
            }}
          />
        ) : (
          <Card key={entity.id} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{entity.name}</p>
              <p className="text-caption truncate">
                {entity.kind === "company" ? "Firma" : "Osoba"}
                {entity.role ? ` • ${entity.role}` : ""}
              </p>
            </div>
            <button
              type="button"
              aria-label={`Upraviť subjekt ${entity.name}`}
              onClick={() => setEditing(entity.id)}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <Pencil className="h-4 w-4" aria-hidden />
            </button>
            <DeleteRecordButton
              type="entity"
              id={entity.id}
              label={entity.name}
              onDeleted={onChanged}
            />
          </Card>
        ),
      )}
    </div>
  );
}

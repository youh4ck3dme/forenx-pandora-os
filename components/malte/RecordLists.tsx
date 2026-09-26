import { useState } from "react";
import { Pencil } from "lucide-react";
import { Card, SectionTitle } from "@/components/malte/Shell";
import { DeleteRecordButton } from "@/components/malte/DeleteRecordButton";
import { EntityForm, TransactionForm } from "@/components/malte/CaseForms";
import { formatDate } from "@/forensic";
import { formatMoney } from "@/forensic/core/money";
import type { Entity, Transaction } from "@/forensic";

type ListProps = {
  caseId: string;
  entities: Entity[];
  revisions: Record<string, number>;
  onChanged: () => void;
};

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

  return (
    <>
      <SectionTitle>Zadané transakcie</SectionTitle>
      <div className="space-y-2">
        {transactions.map((transaction) =>
          editing === transaction.id ? (
            <TransactionForm
              key={transaction.id}
              caseId={caseId}
              entities={entities}
              baseCurrency={baseCurrency}
              initial={transaction}
              revision={revisions[transaction.id]}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                onChanged();
              }}
            />
          ) : (
            <Card key={transaction.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold tnum">
                  {formatMoney(transaction.amount, transaction.currency)}
                </p>
                <p className="text-caption truncate">
                  {formatDate(transaction.date)} •{" "}
                  {names.get(transaction.fromId) ?? "?"} →{" "}
                  {names.get(transaction.toId) ?? "?"}
                  {transaction.description
                    ? ` • ${transaction.description}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Upraviť transakciu z ${transaction.date}`}
                onClick={() => setEditing(transaction.id)}
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
          ),
        )}
      </div>
    </>
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

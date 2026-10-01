import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Hlavičky requestu aktuálneho volania /api/fn/<id>. Shim (getRequest) ich číta
 * cez globalThis, aby sám nemusel importovať node:async_hooks (ide aj do
 * klientskeho bundlu).
 */
type RequestStore = { headers: Headers; url: string };

const globalRef = globalThis as {
  __pandoraServerFnRequest?: AsyncLocalStorage<RequestStore>;
};
const storage = (globalRef.__pandoraServerFnRequest ??= new AsyncLocalStorage<RequestStore>());

export function runWithRequestHeaders<T>(
  headers: Headers,
  fn: () => Promise<T>,
  url = "",
): Promise<T> {
  return storage.run({ headers, url }, fn);
}

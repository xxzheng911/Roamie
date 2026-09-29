import { AsyncLocalStorage } from "node:async_hooks";
import { registerWorkerStorage, type WorkerRequestScope } from "@/lib/worker-request-scope";

let installed = false;

/** Idempotent. The Worker entry calls this so the production bundle keeps the binding. */
export function installWorkerRequestStorage(): void {
  if (installed) return;
  installed = true;
  registerWorkerStorage(new AsyncLocalStorage<WorkerRequestScope>());
}

import { applyGuardCommand, type CounterStore, type GuardCommand, type StoredCharge } from "@/lib/abuse-guard-logic";

type MemoryObject = {
  fetch(request: Request): Promise<Response>;
  counter(key: string): number;
};

function createObject(): MemoryObject {
  const counters = new Map<string, number>();
  const operations = new Map<string, StoredCharge>();
  let chain: Promise<unknown> = Promise.resolve();
  const store: CounterStore = {
    get: (key) => counters.get(key) ?? 0,
    set: (key, value) => {
      if (value <= 0) counters.delete(key);
      else counters.set(key, value);
    },
    getOperation: (id) => operations.get(id),
    putOperation: (id, value) => {
      operations.set(id, value);
    },
  };
  return {
    counter: (key) => counters.get(key) ?? 0,
    fetch(request: Request) {
      const run = chain.then(async () => {
        const command = (await request.json()) as GuardCommand;
        return Response.json(applyGuardCommand(store, command));
      });
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

export function createMemoryAbuseGuard() {
  const objects = new Map<string, MemoryObject>();
  const namespace = {
    idFromName(name: string) {
      return name;
    },
    get(id: string) {
      let object = objects.get(id);
      if (!object) {
        object = createObject();
        objects.set(id, object);
      }
      return object;
    },
  };
  return {
    namespace,
    counter(name: string, key: string) {
      return objects.get(name)?.counter(key) ?? 0;
    },
  };
}

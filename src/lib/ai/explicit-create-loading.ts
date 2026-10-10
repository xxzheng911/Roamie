/** UI-only leases: nested planner/persistence work shares one generation owner.
 * Stale completion must never dismiss the next generation's loading bubble. */
export function createExplicitCreateLoading(
  start: (generationId: string) => void,
  stop: (generationId: string) => void,
) {
  let owner: { id: string; leases: number } | undefined;
  return {
    begin(authority: { explicitCreate?: boolean; generationId?: string } | undefined) {
      if (authority?.explicitCreate !== true || !authority.generationId) return () => {};
      const id = authority.generationId;
      if (!owner || owner.id !== id) {
        owner = { id, leases: 0 };
        start(id);
      }
      const leaseOwner = owner;
      leaseOwner.leases++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        leaseOwner.leases--;
        if (owner === leaseOwner && leaseOwner.leases === 0) {
          owner = undefined;
          stop(id);
        }
      };
    },
  };
}

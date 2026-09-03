export type DestinationAdministrativeScope = {
  name: string;
  administrativeNames?: string[];
};

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/臺/g, "台")
    .replace(/\s+/g, "")
    .replace(/[縣市都府道]$/u, "")
    .toLocaleLowerCase();
}

export function matchDestinationAdministrativeScope(
  place: { address?: string | null },
  destinationScope: DestinationAdministrativeScope,
): { match: boolean; matchedAlias?: string; reason: "matched_alias" | "missing_address" | "admin_mismatch" } {
  const address = normalize(place.address ?? "");
  if (!address) return { match: false, reason: "missing_address" };
  const aliases = [...new Set([destinationScope.name, ...(destinationScope.administrativeNames ?? [])])]
    .map((alias) => ({ raw: alias, normalized: normalize(alias) }))
    .filter(({ normalized }) => normalized.length >= 2);
  const matched = aliases.find(({ normalized }) => address.includes(normalized));
  return matched
    ? { match: true, matchedAlias: matched.raw, reason: "matched_alias" }
    : { match: false, reason: "admin_mismatch" };
}

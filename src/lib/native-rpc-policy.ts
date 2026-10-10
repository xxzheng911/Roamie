export const NATIVE_RPC_ORIGIN = "capacitor://localhost";
export function isServerFunctionPath(pathname: string): boolean {
  return /^\/_serverFn\/[A-Za-z0-9_-]+$/.test(pathname);
}

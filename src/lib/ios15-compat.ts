/**
 * iOS 15.0–15.3 JavaScriptCore lacks these built-ins (all shipped in iOS 15.4):
 * Object.hasOwn, Array/String.prototype.at, structuredClone.
 * Each is installed only when missing; native implementations are never replaced.
 * Must be the first import of the client bundle (router.tsx).
 */

function install(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value, writable: true, enumerable: false, configurable: true });
}

/** ECMA-262 ToIntegerOrInfinity; unary + throws for Symbol/BigInt like ToNumber. */
function toIntegerOrInfinity(value: unknown): number {
  const number = +(value as number);
  return number !== number || number === 0 ? 0 : Math.trunc(number);
}

function relativeAt(length: number, index: unknown): number | undefined {
  const relative = toIntegerOrInfinity(index);
  const k = relative >= 0 ? relative : length + relative;
  return k < 0 || k >= length ? undefined : k;
}

if (typeof Object.hasOwn !== "function") {
  install(Object, "hasOwn", function hasOwn(object: unknown, key: PropertyKey): boolean {
    if (object == null) throw new TypeError("Cannot convert undefined or null to object");
    return Object.prototype.hasOwnProperty.call(Object(object), key);
  });
}

if (typeof Array.prototype.at !== "function") {
  install(Array.prototype, "at", function at(this: unknown, index: unknown) {
    if (this == null) throw new TypeError("Array.prototype.at called on null or undefined");
    const object = Object(this) as ArrayLike<unknown>;
    const length = Math.min(Math.max(toIntegerOrInfinity(object.length), 0), Number.MAX_SAFE_INTEGER);
    const k = relativeAt(length, index);
    return k === undefined ? undefined : object[k];
  });
}

if (typeof String.prototype.at !== "function") {
  install(String.prototype, "at", function at(this: unknown, index: unknown) {
    if (this == null) throw new TypeError("String.prototype.at called on null or undefined");
    const string = String(this);
    const k = relativeAt(string.length, index);
    return k === undefined ? undefined : string[k];
  });
}

function dataCloneError(message: string): Error {
  return typeof DOMException === "function"
    ? new DOMException(message, "DataCloneError")
    : Object.assign(new Error(message), { name: "DataCloneError" });
}

/**
 * Structured clone for data values: primitives, ordinary objects, arrays, Date,
 * RegExp, Map and Set, preserving shared and cyclic references. Any other value
 * throws DataCloneError instead of producing a silently different copy.
 */
function cloneStructured(value: unknown, seen: Map<object, unknown>): unknown {
  if (typeof value === "function" || typeof value === "symbol") {
    throw dataCloneError(`${String(value)} could not be cloned.`);
  }
  if (value === null || typeof value !== "object") return value;
  const existing = seen.get(value);
  if (existing !== undefined) return existing;
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object Date]") {
    const copy = new Date((value as Date).getTime());
    seen.set(value, copy);
    return copy;
  }
  if (tag === "[object RegExp]") {
    const source = value as RegExp;
    const copy = new RegExp(source.source, source.flags);
    seen.set(value, copy);
    return copy;
  }
  if (tag === "[object Map]") {
    const copy = new Map();
    seen.set(value, copy);
    for (const [key, item] of value as Map<unknown, unknown>) {
      copy.set(cloneStructured(key, seen), cloneStructured(item, seen));
    }
    return copy;
  }
  if (tag === "[object Set]") {
    const copy = new Set();
    seen.set(value, copy);
    for (const item of value as Set<unknown>) copy.add(cloneStructured(item, seen));
    return copy;
  }
  let copy: Record<string, unknown>;
  if (Array.isArray(value)) copy = new Array(value.length) as unknown as Record<string, unknown>;
  else if (tag === "[object Object]") copy = {};
  else throw dataCloneError(`${tag} could not be cloned.`);
  seen.set(value, copy);
  for (const key of Object.keys(value)) {
    copy[key] = cloneStructured((value as Record<string, unknown>)[key], seen);
  }
  return copy;
}

if (typeof globalThis.structuredClone !== "function") {
  install(globalThis, "structuredClone", function structuredClone<T>(value: T, options?: { transfer?: unknown[] }): T {
    if (options?.transfer?.length) throw dataCloneError("Transfer is not supported.");
    return cloneStructured(value, new Map()) as T;
  });
}

export {};

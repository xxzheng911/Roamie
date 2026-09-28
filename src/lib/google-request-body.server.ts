/** Enforce the actual byte count even when Content-Length is absent or forged. */
export async function readGoogleRequestJson(request: Request, maximum = 16_384): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > maximum)
    throw new RangeError("request_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_request");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maximum) {
      await reader.cancel();
      throw new RangeError("request_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

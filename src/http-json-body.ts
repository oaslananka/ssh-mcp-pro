class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large");
  }
}
class InvalidJsonBodyError extends Error {
  constructor() {
    super("Invalid JSON body");
  }
}

export async function readHttpJsonBody(
  req: AsyncIterable<Buffer | string>,
  maxBytes: number,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) {
      throw new RequestBodyTooLargeError();
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new InvalidJsonBodyError();
  }
}

export function httpErrorResponse(error: unknown): {
  statusCode: number;
  payload: Record<string, unknown>;
} {
  if (error && typeof error === "object" && "status" in error && "message" in error) {
    const status = Number((error as { status: number }).status);
    const message = String((error as { message: string }).message);
    const code = "code" in error ? String((error as { code: string }).code) : undefined;
    return {
      statusCode: Number.isFinite(status) ? status : 500,
      payload: { error: message, code },
    };
  }
  if (error instanceof RequestBodyTooLargeError) {
    return { statusCode: 413, payload: { error: "Request body is too large" } };
  }
  if (error instanceof InvalidJsonBodyError) {
    return { statusCode: 400, payload: { error: "Invalid JSON body" } };
  }
  return { statusCode: 500, payload: { error: "Internal server error" } };
}

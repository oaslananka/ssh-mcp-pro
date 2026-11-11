import type { FileHandle } from "node:fs/promises";

export interface OutputAccumulator {
  bytes: number;
  chunks: Buffer[];
  truncated: boolean;
}

function truncateBuffer(buffer: Buffer, maxBytes: number): { value: Buffer; truncated: boolean } {
  if (buffer.byteLength <= maxBytes) {
    return { value: buffer, truncated: false };
  }
  return appendTruncationMarker(buffer, maxBytes);
}

function truncationMarker(maxBytes: number): Buffer {
  return Buffer.from(`\n[truncated after ${maxBytes} bytes]\n`);
}

function appendTruncationMarker(
  buffer: Buffer,
  maxBytes: number,
): {
  value: Buffer;
  truncated: boolean;
} {
  if (maxBytes <= 0) {
    return { value: Buffer.alloc(0), truncated: true };
  }
  const marker = truncationMarker(maxBytes);
  if (marker.byteLength >= maxBytes) {
    return { value: marker.subarray(0, maxBytes), truncated: true };
  }
  const payloadBytes = Math.max(0, maxBytes - marker.byteLength);
  return {
    value: Buffer.concat([buffer.subarray(0, payloadBytes), marker], maxBytes),
    truncated: true,
  };
}

export function appendBoundedOutput(
  accumulator: OutputAccumulator,
  chunk: Buffer,
  maxBytes: number,
): void {
  if (maxBytes <= 0) {
    accumulator.truncated ||= chunk.byteLength > 0;
    return;
  }
  const remaining = maxBytes - accumulator.bytes;
  if (remaining <= 0) {
    accumulator.truncated = true;
    return;
  }
  const slice = chunk.subarray(0, remaining);
  accumulator.chunks.push(slice);
  accumulator.bytes += slice.byteLength;
  accumulator.truncated ||= slice.byteLength !== chunk.byteLength;
}

export function finalizeBoundedOutput(
  accumulator: OutputAccumulator,
  maxBytes: number,
): { value: Buffer; truncated: boolean } {
  const value = Buffer.concat(accumulator.chunks, accumulator.bytes);
  if (!accumulator.truncated) {
    return { value, truncated: false };
  }
  return appendTruncationMarker(value, maxBytes);
}

async function readHandleRange(file: FileHandle, start: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(Math.max(0, length));
  let offset = 0;
  while (offset < buffer.byteLength) {
    const { bytesRead } = await file.read(
      buffer,
      offset,
      buffer.byteLength - offset,
      start + offset,
    );
    if (bytesRead === 0) {
      break;
    }
    offset += bytesRead;
  }
  return buffer.subarray(0, offset);
}

export async function readFileBounded(
  file: FileHandle,
  maxBytes: number,
): Promise<{
  value: Buffer;
  truncated: boolean;
}> {
  const cappedBytes = Math.max(0, maxBytes);
  const buffer = await readHandleRange(file, 0, cappedBytes + 1);
  return truncateBuffer(buffer, cappedBytes);
}

/**
 * Read one page using byte offsets without buffering the entire file.
 * Unlike a legacy read, a page must not include a truncation marker in text.
 * Valid UTF-8 is kept at code-point boundaries when a page ends mid-character.
 */
export async function readFilePageBounded(
  file: FileHandle,
  offsetBytes: number,
  maxBytes: number,
): Promise<{ value: Buffer; truncated: boolean; nextOffsetBytes?: number }> {
  const raw = await readHandleRange(file, offsetBytes, maxBytes + 1);
  let page = raw.subarray(0, maxBytes);
  let truncated = raw.byteLength > maxBytes;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let validPage = false;
  for (let removed = 0; removed <= (truncated ? Math.min(3, page.byteLength) : 0); removed += 1) {
    try {
      decoder.decode(page.subarray(0, page.byteLength - removed));
      page = page.subarray(0, page.byteLength - removed);
      validPage = true;
      break;
    } catch {
      // A UTF-8 code point may cross the page boundary.
    }
  }
  if (!validPage || (truncated && page.byteLength === 0)) {
    throw Object.assign(
      new Error(
        "Page cannot advance at this UTF-8 boundary; increase max_bytes or use a valid offset",
      ),
      {
        code: "POLICY_DENIED" as const,
      },
    );
  }
  truncated ||= page.byteLength < raw.byteLength;
  return {
    value: page,
    truncated,
    ...(truncated && page.byteLength > 0 ? { nextOffsetBytes: offsetBytes + page.byteLength } : {}),
  };
}

const TAIL_SCAN_CHUNK_BYTES = 64 * 1024;
const MAX_TAIL_SCAN_BYTES = 8 * 1024 * 1024;

interface TailStart {
  offset: number;
  scanTruncated: boolean;
}

async function findTailStart(
  file: FileHandle,
  size: number,
  maxLines: number,
  maxScanBytes: number,
): Promise<TailStart> {
  if (size <= 0 || maxLines <= 0) {
    return { offset: size, scanTruncated: false };
  }

  let position = size;
  const minimumPosition = Math.max(0, size - Math.max(0, maxScanBytes));
  let includedLines = 1;
  while (position > minimumPosition) {
    const chunkSize = Math.min(TAIL_SCAN_CHUNK_BYTES, position - minimumPosition);
    position -= chunkSize;
    const chunk = await readHandleRange(file, position, chunkSize);
    for (let index = chunk.byteLength - 1; index >= 0; index -= 1) {
      const absoluteIndex = position + index;
      if (chunk[index] !== 0x0a || absoluteIndex === size - 1) {
        continue;
      }
      if (includedLines >= maxLines) {
        return { offset: absoluteIndex + 1, scanTruncated: false };
      }
      includedLines += 1;
    }
  }
  return { offset: minimumPosition, scanTruncated: minimumPosition > 0 };
}

export async function readFileTailBounded(
  file: FileHandle,
  maxBytes: number,
  maxLines = 100,
): Promise<{
  value: Buffer;
  truncated: boolean;
}> {
  const cappedBytes = Math.max(0, maxBytes);
  const stats = await file.stat();
  const scanBytes = Math.max(
    TAIL_SCAN_CHUNK_BYTES,
    Math.min(MAX_TAIL_SCAN_BYTES, cappedBytes * 4 + 1),
  );
  const { offset, scanTruncated } = await findTailStart(file, stats.size, maxLines, scanBytes);
  const bytesToRead = Math.min(stats.size - offset, cappedBytes + 1);
  const buffer = await readHandleRange(file, offset, bytesToRead);
  const bounded = truncateBuffer(buffer, cappedBytes);
  return scanTruncated && !bounded.truncated
    ? appendTruncationMarker(bounded.value, cappedBytes)
    : bounded;
}

/** Limit applies to decoded bytes, before they enter private storage. */
export const MAX_LICENSE_FILE_BYTES = 2 * 1024 * 1024;
export const licensedFileExtensions = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg',
  'audio/wav': 'wav', 'video/mp4': 'mp4',
} as const;
export type LicenseFileType = keyof typeof licensedFileExtensions;

export function detectLicenseFile(data: Uint8Array): LicenseFileType | null {
  if (data.length < 12 || data.length > MAX_LICENSE_FILE_BYTES) return null;
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const ascii = (start: number, end: number) => b.toString('latin1', start, end);
  if (/^%PDF-(?:1\.[0-7]|2\.0)/.test(ascii(0, 8)) && /%%EOF\s*$/.test(ascii(Math.max(0, b.length - 1024), b.length))) return 'application/pdf';
  if (b.length >= 45 && b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' && b.readUInt32BE(8) === 13 &&
    ascii(12, 16) === 'IHDR' && b.readUInt32BE(16) > 0 && b.readUInt32BE(20) > 0 &&
    b.subarray(-12).toString('hex') === '0000000049454e44ae426082') return 'image/png';
  if (b.length >= 12 && b.subarray(0, 3).toString('hex') === 'ffd8ff' && b.subarray(-2).toString('hex') === 'ffd9') return 'image/jpeg';
  if (b.length >= 44 && ascii(0, 4) === 'RIFF' && b.readUInt32LE(4) === b.length - 8 && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (b.length >= 24 && b.readUInt32BE(0) >= 16 && b.readUInt32BE(0) <= b.length && ascii(4, 8) === 'ftyp' &&
    ['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V '].includes(ascii(8, 12))) return 'video/mp4';
  return null;
}

export function declaredFileType(header: string | null) {
  const type = header?.split(';')[0].trim().toLowerCase();
  return type === 'audio/x-wav' || type === 'audio/wave' ? 'audio/wav' : type;
}

export async function readLicenseFile(body: ReadableStream<Uint8Array> | null): Promise<Buffer | null> {
  if (!body) return null;
  const reader = body.getReader();
  const data = Buffer.allocUnsafe(MAX_LICENSE_FILE_BYTES);
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return size ? data.subarray(0, size) : null;
      if (chunk.value.length > MAX_LICENSE_FILE_BYTES - size) {
        await reader.cancel();
        throw new RangeError('Fichier trop volumineux.');
      }
      data.set(chunk.value, size);
      size += chunk.value.length;
    }
  } finally { reader.releaseLock(); }
}

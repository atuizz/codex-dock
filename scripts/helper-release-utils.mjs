import { createHash } from "node:crypto";

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  crcTable[index] = value >>> 0;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const safe = Number.isFinite(date.getTime()) ? date : new Date("2026-01-01T00:00:00Z");
  const year = Math.max(1980, safe.getUTCFullYear());
  const month = safe.getUTCMonth() + 1;
  const day = safe.getUTCDate();
  const hours = safe.getUTCHours();
  const minutes = safe.getUTCMinutes();
  const seconds = Math.floor(safe.getUTCSeconds() / 2);
  return {
    time: (hours << 11) | (minutes << 5) | seconds,
    date: ((year - 1980) << 9) | (month << 5) | day,
  };
}

function fixedBuffer(size, writer) {
  const buffer = Buffer.alloc(size);
  writer(buffer);
  return buffer;
}

export function createStoreZip(entries, options = {}) {
  const date = options.date || new Date("2026-01-01T00:00:00Z");
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = String(entry.name || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!name || name.endsWith("/")) continue;
    const nameBytes = Buffer.from(name, "utf8");
    const bytes = Buffer.from(entry.bytes || "");
    const checksum = crc32(bytes);
    const stamp = dosDateTime(entry.date || date);

    const localHeader = fixedBuffer(30, (buffer) => {
      buffer.writeUInt32LE(0x04034b50, 0);
      buffer.writeUInt16LE(20, 4);
      buffer.writeUInt16LE(0, 6);
      buffer.writeUInt16LE(0, 8);
      buffer.writeUInt16LE(stamp.time, 10);
      buffer.writeUInt16LE(stamp.date, 12);
      buffer.writeUInt32LE(checksum, 14);
      buffer.writeUInt32LE(bytes.length, 18);
      buffer.writeUInt32LE(bytes.length, 22);
      buffer.writeUInt16LE(nameBytes.length, 26);
      buffer.writeUInt16LE(0, 28);
    });
    localParts.push(localHeader, nameBytes, bytes);

    const centralHeader = fixedBuffer(46, (buffer) => {
      buffer.writeUInt32LE(0x02014b50, 0);
      buffer.writeUInt16LE(20, 4);
      buffer.writeUInt16LE(20, 6);
      buffer.writeUInt16LE(0, 8);
      buffer.writeUInt16LE(0, 10);
      buffer.writeUInt16LE(stamp.time, 12);
      buffer.writeUInt16LE(stamp.date, 14);
      buffer.writeUInt32LE(checksum, 16);
      buffer.writeUInt32LE(bytes.length, 20);
      buffer.writeUInt32LE(bytes.length, 24);
      buffer.writeUInt16LE(nameBytes.length, 28);
      buffer.writeUInt16LE(0, 30);
      buffer.writeUInt16LE(0, 32);
      buffer.writeUInt16LE(0, 34);
      buffer.writeUInt16LE(0, 36);
      buffer.writeUInt32LE(0, 38);
      buffer.writeUInt32LE(offset, 42);
    });
    centralParts.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + bytes.length;
  }

  const centralOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const end = fixedBuffer(22, (buffer) => {
    buffer.writeUInt32LE(0x06054b50, 0);
    buffer.writeUInt16LE(0, 4);
    buffer.writeUInt16LE(0, 6);
    buffer.writeUInt16LE(centralParts.length / 2, 8);
    buffer.writeUInt16LE(centralParts.length / 2, 10);
    buffer.writeUInt32LE(centralDirectory.length, 12);
    buffer.writeUInt32LE(centralOffset, 16);
    buffer.writeUInt16LE(0, 20);
  });

  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function listStoreZipEntries(bytes) {
  const buffer = Buffer.from(bytes);
  const entries = [];
  for (let offset = 0; offset <= buffer.length - 46; offset++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    entries.push({
      name: buffer.slice(nameStart, nameEnd).toString("utf8"),
      bytes: uncompressedSize,
      compressedBytes: compressedSize,
    });
    offset = nameEnd + extraLength + commentLength - 1;
  }
  return entries;
}

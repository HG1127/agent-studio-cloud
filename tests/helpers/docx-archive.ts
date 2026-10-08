import { deflateRawSync } from "node:zlib";

interface ArchiveEntry {
  name: string;
  content: Uint8Array;
  method?: 0 | 8;
  declaredSize?: number;
  dataDescriptor?: boolean;
}

function crc32(bytes: Uint8Array): number {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ ((checksum & 1) ? 0xedb88320 : 0);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

export function buildDocxArchive(entries: ArchiveEntry[], comment = ""): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const method = entry.method ?? 8;
    const content = Buffer.from(entry.content);
    const compressed = method === 8 ? deflateRawSync(content) : content;
    const declaredSize = entry.declaredSize ?? content.byteLength;
    const checksum = crc32(content);
    const flags = 0x0800 | (entry.dataDescriptor ? 0x0008 : 0);
    const local = Buffer.alloc(30 + name.byteLength);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    if (!entry.dataDescriptor) {
      local.writeUInt32LE(checksum, 14);
      local.writeUInt32LE(compressed.byteLength, 18);
      local.writeUInt32LE(declaredSize, 22);
    }
    local.writeUInt16LE(name.byteLength, 26);
    name.copy(local, 30);
    const descriptor = entry.dataDescriptor ? Buffer.alloc(16) : Buffer.alloc(0);
    if (entry.dataDescriptor) {
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(checksum, 4);
      descriptor.writeUInt32LE(compressed.byteLength, 8);
      descriptor.writeUInt32LE(declaredSize, 12);
    }
    const record = Buffer.alloc(46 + name.byteLength);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(flags, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(compressed.byteLength, 20);
    record.writeUInt32LE(declaredSize, 24);
    record.writeUInt16LE(name.byteLength, 28);
    record.writeUInt32LE(localOffset, 42);
    name.copy(record, 46);
    locals.push(local, compressed, descriptor);
    central.push(record);
    localOffset += local.byteLength + compressed.byteLength + descriptor.byteLength;
  }
  const centralBytes = Buffer.concat(central);
  const commentBytes = Buffer.from(comment);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.byteLength, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(commentBytes.byteLength, 20);
  return Buffer.concat([...locals, centralBytes, end, commentBytes]);
}

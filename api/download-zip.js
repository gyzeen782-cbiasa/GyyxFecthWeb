export const config = {
  api: { bodyParser: { sizeLimit: "20mb" } },
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ── CRC32 ─────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++)
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

// ── Write helpers (little-endian into Uint8Array) ─────────────────────────────
function writeU16(arr, off, val) {
  arr[off]     = val & 0xff;
  arr[off + 1] = (val >>> 8) & 0xff;
}

function writeU32(arr, off, val) {
  arr[off]     = val & 0xff;
  arr[off + 1] = (val >>> 8)  & 0xff;
  arr[off + 2] = (val >>> 16) & 0xff;
  arr[off + 3] = (val >>> 24) & 0xff;
}

// ── Concat Uint8Arrays ────────────────────────────────────────────────────────
function concat(arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

// ── DOS date/time ─────────────────────────────────────────────────────────────
function dosDateTime() {
  const d = new Date();
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) >>> 0,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) >>> 0,
  };
}

// ── Build ZIP ─────────────────────────────────────────────────────────────────
function buildZip(files) {
  const enc = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const dt = dosDateTime();

  for (const file of files) {
    // Sanitize filename
    const safeName = (file.name || "file.txt")
      .replace(/[^\w.\-\/]/g, "_")
      .replace(/^\/+/, "");

    const nameBytes = enc.encode(safeName);
    const dataBytes = enc.encode(file.content || "");
    const crc       = crc32(dataBytes);
    const size      = dataBytes.length;

    // ── Local file header (30 bytes + name + data) ──
    const local = new Uint8Array(30 + nameBytes.length);
    writeU32(local, 0,  0x04034b50); // signature
    writeU16(local, 4,  20);          // version needed
    writeU16(local, 6,  0);           // flags
    writeU16(local, 8,  0);           // compression: store
    writeU16(local, 10, dt.time);
    writeU16(local, 12, dt.date);
    writeU32(local, 14, crc);
    writeU32(local, 18, size);        // compressed size
    writeU32(local, 22, size);        // uncompressed size
    writeU16(local, 26, nameBytes.length);
    writeU16(local, 28, 0);           // extra field length
    local.set(nameBytes, 30);

    localParts.push(local, dataBytes);

    // ── Central directory entry (46 bytes + name) ──
    const central = new Uint8Array(46 + nameBytes.length);
    writeU32(central, 0,  0x02014b50); // signature
    writeU16(central, 4,  20);          // version made by
    writeU16(central, 6,  20);          // version needed
    writeU16(central, 8,  0);           // flags
    writeU16(central, 10, 0);           // compression
    writeU16(central, 12, dt.time);
    writeU16(central, 14, dt.date);
    writeU32(central, 16, crc);
    writeU32(central, 20, size);
    writeU32(central, 24, size);
    writeU16(central, 28, nameBytes.length);
    writeU16(central, 30, 0);           // extra
    writeU16(central, 32, 0);           // comment
    writeU16(central, 34, 0);           // disk start
    writeU16(central, 36, 0);           // internal attr
    writeU32(central, 38, 0);           // external attr
    writeU32(central, 42, localOffset); // offset of local header
    central.set(nameBytes, 46);

    centralParts.push(central);
    localOffset += local.length + dataBytes.length;
  }

  const centralBuf = concat(centralParts);
  const cdSize     = centralBuf.length;
  const cdOffset   = localOffset;
  const fileCount  = files.length;

  // ── End of central directory (22 bytes) ──
  const eocd = new Uint8Array(22);
  writeU32(eocd, 0,  0x06054b50);  // signature
  writeU16(eocd, 4,  0);            // disk number
  writeU16(eocd, 6,  0);            // disk with CD
  writeU16(eocd, 8,  fileCount);    // entries on disk
  writeU16(eocd, 10, fileCount);    // total entries
  writeU32(eocd, 12, cdSize);       // central dir size
  writeU32(eocd, 16, cdOffset);     // central dir offset
  writeU16(eocd, 20, 0);            // comment length

  return concat([...localParts, centralBuf, eocd]);
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, message: "Method not allowed" });

  const { files } = req.body || {};
  if (!files || !Array.isArray(files) || files.length === 0)
    return res.status(400).json({ ok: false, message: "Tidak ada file untuk di-export." });

  try {
    const zip = buildZip(files);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="gyyxfetch-export.zip"');
    res.setHeader("Content-Length", zip.length);
    return res.status(200).send(Buffer.from(zip));

  } catch (e) {
    console.error("ZIP build error:", e);
    return res.status(500).json({ ok: false, message: "Gagal membuat ZIP: " + e.message });
  }
}

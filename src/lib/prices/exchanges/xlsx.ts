// Minimal XLSX reader (no dependency): ZIP central directory + DecompressionStream
// ("deflate-raw", available in Workers, Node 18+ and Bun) + regex over the sheet XML.
// Enough for small exchange reports; returns each sheet as rows of cell strings.

function u16(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice().buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads all entries of a ZIP archive into a name → bytes map. Throws on a non-ZIP. */
export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a ZIP/XLSX file");
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error("corrupt ZIP central directory");
    const method = u16(bytes, p + 10);
    const compSize = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (u32(bytes, local) !== 0x04034b50) throw new Error("corrupt ZIP local header");
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const raw = bytes.subarray(start, start + compSize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await inflateRaw(raw));
    // Other methods are not used by Excel; skip the entry.
  }
  return out;
}

function xmlText(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export interface Workbook {
  sheetNames: string[];
  sheets: Record<string, string[][]>;
}

/** Parses an XLSX file into sheets of string cells (numbers keep their raw text). */
export async function readXlsx(bytes: Uint8Array): Promise<Workbook> {
  const files = await unzip(bytes);
  const dec = new TextDecoder();
  const text = (name: string) => {
    const f = files.get(name);
    return f ? dec.decode(f) : "";
  };

  const shared: string[] = [];
  for (const m of text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const parts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1]));
    shared.push(parts.join(""));
  }

  const rels = new Map<string, string>();
  for (const m of text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/Id="([^"]+)"/)?.[1];
    const target = m[0].match(/Target="([^"]+)"/)?.[1];
    if (id && target) rels.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }

  const sheetNames: string[] = [];
  const sheets: Record<string, string[][]> = {};
  for (const m of text("xl/workbook.xml").matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = xmlText(m[0].match(/name="([^"]*)"/)?.[1] ?? "");
    const rid = m[0].match(/r:id="([^"]+)"/)?.[1] ?? "";
    const target = rels.get(rid);
    if (!target) continue;
    const xml = text(`xl/${target}`);
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: string[] = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
        const type = attrs.match(/t="([^"]+)"/)?.[1];
        const inner = c[2] ?? "";
        let value = "";
        if (type === "s") value = shared[Number(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1])] ?? "";
        else if (type === "inlineStr")
          value = xmlText(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? "");
        else value = xmlText(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
        const idx = ref ? colIndex(ref) : row.length;
        while (row.length < idx) row.push("");
        row[idx] = value.trim();
      }
      rows.push(row);
    }
    sheetNames.push(name);
    sheets[name] = rows;
  }
  return { sheetNames, sheets };
}

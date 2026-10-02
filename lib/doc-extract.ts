import { inflateRawSync, inflateSync } from "node:zlib";

/*
 * 채팅 첨부 문서에서 본문 텍스트를 뽑습니다. NanoGPT 채팅 API는 PDF만 파일 파트로
 * 받으므로(capabilities.pdf_upload), 그 밖의 문서는 텍스트로 바꿔 메시지 본문에
 * 붙여 넣습니다. 그래서 텍스트 입력을 받는 모든 채팅 모델에서 쓸 수 있습니다.
 *
 * - Word(.docx), PowerPoint(.pptx), 한글(.hwpx): ZIP 안의 XML 에서 글자만 읽습니다.
 * - 한글(.hwp, HWP 5.0): OLE 복합 문서의 BodyText/Section* 스트림(zlib 압축)에서
 *   문단 텍스트 레코드(HWPTAG_PARA_TEXT)를 읽습니다(한컴 공개 HWP 5.0 형식 문서 기준).
 *   배포용(암호화) 문서는 읽을 수 없습니다.
 * - PDF: pdf_upload 미지원 모델용으로 unpdf(pdf.js)로 텍스트를 뽑습니다. 스캔본처럼
 *   글자 층이 없는 PDF는 텍스트가 나오지 않습니다.
 * - 옛 바이너리 형식(.doc, .ppt)은 지원하지 않습니다(.docx/.pptx 로 저장해 첨부).
 */

export type DocFormat = "docx" | "pptx" | "hwpx" | "hwp" | "pdf" | "text";

export function docFormat(name: string, mime: string): DocFormat | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (ext === "docx" || mime.includes("wordprocessingml")) return "docx";
  if (ext === "pptx" || mime.includes("presentationml")) return "pptx";
  if (ext === "hwpx" || mime.includes("hwp+zip")) return "hwpx";
  if (ext === "hwp" || mime === "application/x-hwp" || mime === "application/haansofthwp") return "hwp";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (["txt", "md", "csv", "json"].includes(ext) || mime.startsWith("text/")) return "text";
  return null;
}

/* ------------------------------------------------------------------ ZIP */

function unzip(buffer: Buffer): Map<string, () => Buffer> {
  const entries = new Map<string, () => Buffer>();
  // End of central directory 레코드(서명 0x06054b50)를 뒤에서부터 찾습니다.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP 구조를 찾지 못했습니다.");
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && offset + 46 <= buffer.length; n++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.set(name, () => {
      const localName = buffer.readUInt16LE(localOffset + 26);
      const localExtra = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localName + localExtra;
      const data = buffer.subarray(start, start + compressedSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error("지원하지 않는 ZIP 압축 방식입니다.");
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

/** 문단 태그마다 줄을 바꾸고, 글자 태그 안의 텍스트만 모읍니다. */
function xmlText(xml: string, paragraphTag: string, textTag: string): string {
  const paragraphs = xml.split(new RegExp(`</${paragraphTag}>`));
  const textRe = new RegExp(`<${textTag}(?:\\s[^>]*)?>([^<]*)</${textTag}>|<${textTag.split(":")[0]}:tab\\b[^>]*/>`, "g");
  return paragraphs
    .map((part) => {
      let line = "";
      for (const match of part.matchAll(textRe)) line += match[1] !== undefined ? decodeXml(match[1]) : "\t";
      return line;
    })
    .filter((line) => line.trim())
    .join("\n");
}

function byNumber(a: string, b: string): number {
  return Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0) - Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0);
}

function extractDocx(buffer: Buffer): string {
  const zip = unzip(buffer);
  const parts = ["word/document.xml", ...[...zip.keys()].filter((key) => /^word\/(footnotes|endnotes)\.xml$/.test(key))];
  return parts
    .filter((key) => zip.has(key))
    .map((key) => xmlText(zip.get(key)!().toString("utf8"), "w:p", "w:t"))
    .join("\n\n");
}

function extractPptx(buffer: Buffer): string {
  const zip = unzip(buffer);
  const slides = [...zip.keys()].filter((key) => /^ppt\/slides\/slide\d+\.xml$/.test(key)).sort(byNumber);
  return slides
    .map((key, index) => {
      const body = xmlText(zip.get(key)!().toString("utf8"), "a:p", "a:t");
      const notesKey = `ppt/notesSlides/notesSlide${key.match(/(\d+)\.xml$/)?.[1]}.xml`;
      const notes = zip.has(notesKey) ? xmlText(zip.get(notesKey)!().toString("utf8"), "a:p", "a:t") : "";
      return `[슬라이드 ${index + 1}]\n${body}${notes.trim() ? `\n(발표자 노트) ${notes}` : ""}`;
    })
    .join("\n\n");
}

function extractHwpx(buffer: Buffer): string {
  const zip = unzip(buffer);
  const sections = [...zip.keys()].filter((key) => /^Contents\/section\d+\.xml$/i.test(key)).sort(byNumber);
  if (sections.length === 0) throw new Error("한글(hwpx) 본문을 찾지 못했습니다.");
  return sections.map((key) => xmlText(zip.get(key)!().toString("utf8"), "hp:p", "hp:t")).join("\n\n");
}

/* ------------------------------------------------- OLE 복합 문서(HWP 5.0) */

function readCfb(buffer: Buffer): Map<string, Buffer> {
  if (buffer.readUInt32LE(0) !== 0xe011cfd0) throw new Error("HWP 5.0 형식이 아닙니다.");
  const sectorSize = 1 << buffer.readUInt16LE(30);
  const miniSectorSize = 1 << buffer.readUInt16LE(32);
  const dirStart = buffer.readUInt32LE(48);
  const miniCutoff = buffer.readUInt32LE(56);
  const miniFatStart = buffer.readUInt32LE(60);
  let difatStart = buffer.readUInt32LE(68);
  const difatCount = buffer.readUInt32LE(72);
  const sectorOffset = (sector: number) => (sector + 1) * sectorSize;

  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const sector = buffer.readUInt32LE(76 + i * 4);
    if (sector < 0xfffffffa) fatSectors.push(sector);
  }
  for (let n = 0; n < difatCount && difatStart < 0xfffffffa; n++) {
    const base = sectorOffset(difatStart);
    for (let i = 0; i < sectorSize / 4 - 1; i++) {
      const sector = buffer.readUInt32LE(base + i * 4);
      if (sector < 0xfffffffa) fatSectors.push(sector);
    }
    difatStart = buffer.readUInt32LE(base + sectorSize - 4);
  }
  const fat: number[] = [];
  for (const sector of fatSectors) {
    const base = sectorOffset(sector);
    for (let i = 0; i < sectorSize / 4; i++) fat.push(buffer.readUInt32LE(base + i * 4));
  }
  const chain = (start: number, table: number[]) => {
    const out: number[] = [];
    for (let sector = start; sector < 0xfffffffa && out.length < table.length + 1; sector = table[sector]) out.push(sector);
    return out;
  };
  const readChain = (start: number) => Buffer.concat(chain(start, fat).map((s) => buffer.subarray(sectorOffset(s), sectorOffset(s) + sectorSize)));

  const dir = readChain(dirStart);
  type Entry = { name: string; type: number; start: number; size: number; left: number; right: number; child: number };
  const entries: Entry[] = [];
  for (let off = 0; off + 128 <= dir.length; off += 128) {
    const nameLength = dir.readUInt16LE(off + 64);
    entries.push({
      name: dir.toString("utf16le", off, off + Math.max(0, nameLength - 2)),
      type: dir[off + 66],
      left: dir.readUInt32LE(off + 68),
      right: dir.readUInt32LE(off + 72),
      child: dir.readUInt32LE(off + 76),
      start: dir.readUInt32LE(off + 116),
      size: dir.readUInt32LE(off + 120),
    });
  }
  const root = entries[0];
  const miniStream = root ? readChain(root.start) : Buffer.alloc(0);
  const miniFat: number[] = [];
  if (miniFatStart < 0xfffffffa) {
    const raw = readChain(miniFatStart);
    for (let i = 0; i + 4 <= raw.length; i += 4) miniFat.push(raw.readUInt32LE(i));
  }
  const readStream = (entry: Entry) => {
    if (entry.size < miniCutoff) {
      return Buffer.concat(chain(entry.start, miniFat).map((s) => miniStream.subarray(s * miniSectorSize, (s + 1) * miniSectorSize))).subarray(0, entry.size);
    }
    return readChain(entry.start).subarray(0, entry.size);
  };

  // 저장소(폴더) 트리를 따라가며 "폴더/이름" 경로로 스트림을 모읍니다.
  const files = new Map<string, Buffer>();
  const visit = (index: number, prefix: string, seen: Set<number>) => {
    if (index >= entries.length || index === 0xffffffff || seen.has(index)) return;
    seen.add(index);
    const entry = entries[index];
    visit(entry.left, prefix, seen);
    visit(entry.right, prefix, seen);
    const pathName = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.type === 2) files.set(pathName, readStream(entry));
    else if (entry.type === 1) visit(entry.child, pathName, seen);
  };
  if (root) visit(root.child, "", new Set());
  return files;
}

function extractHwp(buffer: Buffer): string {
  const files = readCfb(buffer);
  const header = files.get("FileHeader");
  if (!header) throw new Error("한글(hwp) 파일 헤더를 찾지 못했습니다.");
  const flags = header.readUInt32LE(36);
  if (flags & 0x2) throw new Error("암호가 걸린 한글 문서는 읽을 수 없습니다.");
  if (flags & 0x4) throw new Error("배포용 한글 문서는 읽을 수 없습니다. 일반 문서나 hwpx·PDF로 저장해 첨부해 주세요.");
  const compressed = (flags & 0x1) !== 0;
  const sections = [...files.keys()].filter((key) => /^BodyText\/Section\d+$/.test(key))
    .sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));
  const lines: string[] = [];
  for (const key of sections) {
    let data = files.get(key)!;
    if (compressed) {
      try {
        data = inflateRawSync(data);
      } catch {
        data = inflateSync(data);
      }
    }
    for (let off = 0; off + 4 <= data.length; ) {
      const head = data.readUInt32LE(off);
      const tag = head & 0x3ff;
      let size = head >>> 20;
      off += 4;
      if (size === 0xfff) {
        size = data.readUInt32LE(off);
        off += 4;
      }
      if (tag === 67) lines.push(hwpParaText(data.subarray(off, off + size)));
      off += size;
    }
  }
  return lines.filter((line) => line.trim()).join("\n");
}

/** HWPTAG_PARA_TEXT: UTF-16LE. 0~31 은 제어 문자입니다. */
function hwpParaText(data: Buffer): string {
  let out = "";
  for (let i = 0; i + 1 < data.length; ) {
    const code = data.readUInt16LE(i);
    if (code < 32) {
      // 문자 제어(1글자): 0, 10, 13, 24~31. 나머지(인라인·확장 제어)는 8글자 크기입니다.
      if (code === 0 || code === 10 || code === 13 || code >= 24) {
        if (code === 10 || code === 13) out += "\n";
        i += 2;
      } else {
        if (code === 9) out += "\t";
        i += 16;
      }
      continue;
    }
    out += String.fromCharCode(code);
    i += 2;
  }
  return out.replace(/\n+$/, "");
}

/* ------------------------------------------------------------------ PDF */

async function extractPdf(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text])
    .map((page, index) => `[${index + 1}쪽]\n${page.trim()}`)
    .join("\n\n");
}

export async function extractDocumentText(buffer: Buffer, name: string, mime: string): Promise<string> {
  const format = docFormat(name, mime);
  switch (format) {
    case "docx":
      return extractDocx(buffer);
    case "pptx":
      return extractPptx(buffer);
    case "hwpx":
      return extractHwpx(buffer);
    case "hwp":
      return extractHwp(buffer);
    case "pdf":
      return extractPdf(buffer);
    case "text":
      return buffer.toString("utf8");
    default:
      throw new Error("지원하지 않는 문서 형식입니다.");
  }
}

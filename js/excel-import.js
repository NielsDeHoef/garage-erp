function decodeUtf8(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const files = {};
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const method = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = decodeUtf8(bytes.subarray(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;
    const packed = bytes.subarray(dataStart, dataStart + compSize);
    let data = packed;
    if (method === 8) data = await inflateRaw(packed);
    else if (method !== 0) throw new Error(`Niet-ondersteunde zip-compressie (${method})`);
    files[name] = data;
    offset = dataStart + compSize;
  }
  return files;
}

function xmlText(node) {
  return (node?.textContent || "").trim();
}

function parseSharedStrings(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return [...doc.getElementsByTagName("si")].map((si) => xmlText(si));
}

function colIndex(ref) {
  const letters = String(ref).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(xml, strings) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const rows = [];
  for (const row of doc.getElementsByTagName("row")) {
    const cells = [];
    for (const cell of row.getElementsByTagName("c")) {
      const idx = colIndex(cell.getAttribute("r") || "A1");
      const type = cell.getAttribute("t");
      const valueNode = cell.getElementsByTagName("v")[0] || cell.getElementsByTagName("t")[0];
      let value = xmlText(valueNode);
      if (type === "s") value = strings[Number(value)] ?? "";
      else if (type === "inlineStr") value = xmlText(cell.getElementsByTagName("t")[0]);
      cells[idx] = value;
    }
    rows.push(cells);
  }
  return rows;
}

function parseCsv(text) {
  const sample = text.slice(0, 2000);
  const semi = (sample.match(/;/g) || []).length;
  const comma = (sample.match(/,/g) || []).length;
  const delim = semi > comma ? ";" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => String(value).trim())) rows.push(row);
  }
  return rows;
}

const HEADER_MAP = {
  sku: ["sku", "artikel", "artikelnummer", "artnr", "art.nr", "ref", "code", "partno", "part number", "referentie"],
  name: ["naam", "name", "omschrijving", "description", "artikelnaam", "onderdeel"],
  brand: ["merk", "brand", "manufacturer", "fabrikant"],
  category: ["categorie", "category", "groep", "group"],
  unitPrice: ["prijs", "unitprice", "verkoopprijs", "price", "excl", "prijs excl", "verkoopprijs excl"],
  purchasePrice: ["aankoopprijs", "inkoopprijs", "kostprijs", "cost", "purchase", "purchase price", "inkoop", "aankoop"],
  supplier: ["leverancier", "supplier", "vendor", "groothandel", "distributeur"],
  stock: ["voorraad", "stock", "qty", "aantal", "quantity"],
  minStock: ["min", "minimum", "minvoorraad", "minimumvoorraad", "min stock"],
  location: ["locatie", "location", "rek", "vak", "plaats"],
};

function normHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function mapHeaders(row) {
  const map = {};
  row.forEach((cell, index) => {
    const label = normHeader(cell);
    for (const [field, aliases] of Object.entries(HEADER_MAP)) {
      if (aliases.includes(label) && map[field] == null) map[field] = index;
    }
  });
  return map;
}

function numberValue(value) {
  if (value == null || value === "") return 0;
  const n = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export async function rowsFromSpreadsheet(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xls") && !name.endsWith(".xlsx")) {
    throw new Error("Oud .xls-formaat wordt niet ondersteund. Sla het bestand op als .xlsx of .csv.");
  }
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    return parseCsv(await file.text());
  }
  const zip = await unzip(await file.arrayBuffer());
  const stringsXml = zip["xl/sharedStrings.xml"];
  const strings = stringsXml ? parseSharedStrings(decodeUtf8(stringsXml)) : [];
  const sheetName =
    Object.keys(zip).find((key) => key.match(/^xl\/worksheets\/sheet1\.xml$/i)) ||
    Object.keys(zip).find((key) => key.startsWith("xl/worksheets/sheet"));
  if (!sheetName) throw new Error("Geen werkblad gevonden in het Excel-bestand.");
  return parseSheet(decodeUtf8(zip[sheetName]), strings);
}

export function partsFromRows(rows) {
  if (!rows.length) return [];
  let start = 0;
  let headers = mapHeaders(rows[0]);
  if (Object.keys(headers).length >= 2) start = 1;
  else {
    headers = {
      sku: 0,
      name: 1,
      brand: 2,
      category: 3,
      unitPrice: 4,
      stock: 5,
      minStock: 6,
      location: 7,
      supplier: 8,
      purchasePrice: 9,
    };
  }
  const parts = [];
  for (const row of rows.slice(start)) {
    const sku = String(row[headers.sku] ?? "").trim();
    const name = String(row[headers.name] ?? "").trim();
    if (!sku && !name) continue;
    parts.push({
      sku: sku || name.slice(0, 24),
      name: name || sku,
      brand: String(row[headers.brand] ?? "").trim(),
      category: String(row[headers.category] ?? "").trim(),
      unitPrice: numberValue(row[headers.unitPrice]),
      purchasePrice: numberValue(row[headers.purchasePrice]),
      supplier: String(row[headers.supplier] ?? "").trim(),
      stock: numberValue(row[headers.stock]),
      minStock: numberValue(row[headers.minStock]),
      location: String(row[headers.location] ?? "").trim(),
    });
  }
  return parts;
}

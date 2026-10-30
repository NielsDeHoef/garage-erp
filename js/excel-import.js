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

const PART_HEADERS = {
  sku: ["sku", "artikel", "artikelnummer", "artnr", "art.nr", "ref", "code", "partno", "part number", "referentie"],
  name: ["naam", "name", "omschrijving", "description", "artikelnaam", "onderdeel"],
  brand: ["merk", "brand", "manufacturer", "fabrikant"],
  category: ["categorie", "category", "groep", "group"],
  unitPrice: ["prijs", "unitprice", "verkoopprijs", "price", "excl", "prijs excl", "verkoopprijs excl"],
  purchasePrice: ["aankoopprijs", "inkoopprijs", "kostprijs", "cost", "purchase", "purchase price", "inkoop", "aankoop"],
  supplier: ["leverancier", "supplier", "vendor", "groothandel", "distributeur"],
  stock: ["voorraad", "stock", "qty", "aantal", "quantity"],
  minStock: ["min", "minimum", "minvoorraad", "minimumvoorraad", "min stock"],
  location: ["stockplaats", "stock plaats", "locatie", "location", "rek", "vak", "plaats"],
};

const CUSTOMER_HEADERS = {
  number: ["nummer", "klantnummer", "number", "nr"],
  name: ["naam", "name", "klant", "klantnaam"],
  company: ["bedrijf", "company", "firma", "vennootschap"],
  phone: ["telefoon", "telefoon 1", "gsm", "phone", "tel"],
  phone2: ["telefoon 2", "gsm 2", "phone2"],
  phone3: ["telefoon 3", "gsm 3", "phone3"],
  email: ["e-mail", "email", "mail"],
  address: ["adres", "address", "straat"],
  postalCode: ["postcode", "zip"],
  city: ["gemeente", "plaats", "stad", "city"],
  vatNumber: ["btw", "btw-nummer", "vat", "vat number"],
  peppolId: ["peppol", "peppol-id", "peppol id"],
  notes: ["notities", "notes", "opmerking", "opmerkingen"],
};

const SUPPLIER_HEADERS = {
  number: ["nummer", "leveranciersnummer", "number", "nr"],
  name: ["naam", "name", "leverancier", "leveranciersnaam"],
  contact: ["contact", "contactpersoon", "contact persoon"],
  phone: ["telefoon", "gsm", "phone", "tel"],
  email: ["e-mail", "email", "mail"],
  address: ["adres", "address", "straat"],
  notes: ["notities", "notes", "opmerking", "opmerkingen"],
};

const VEHICLE_HEADERS = {
  licensePlate: ["nummerplaat", "kenteken", "plate", "license", "license plate"],
  brand: ["merk", "brand"],
  model: ["model"],
  customer: ["klant", "klantnaam", "customer", "eigenaar"],
  company: ["bedrijf", "company", "firma"],
  fuel: ["brandstof", "fuel"],
  mileage: ["km", "kilometerstand", "mileage", "kilometers"],
  year: ["bouwjaar", "year", "jaar"],
  vin: ["vin", "chassisnummer", "chassis"],
};

function normHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function mapHeaders(row, aliases) {
  const map = {};
  row.forEach((cell, index) => {
    const label = normHeader(cell);
    for (const [field, names] of Object.entries(aliases)) {
      if (names.includes(label) && map[field] == null) map[field] = index;
    }
  });
  return map;
}

function cell(row, headers, key) {
  if (headers[key] == null) return "";
  return String(row[headers[key]] ?? "").trim();
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
  let headers = mapHeaders(rows[0], PART_HEADERS);
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
    const sku = cell(row, headers, "sku");
    const name = cell(row, headers, "name");
    if (!sku && !name) continue;
    parts.push({
      sku: sku || name.slice(0, 24),
      name: name || sku,
      brand: cell(row, headers, "brand"),
      category: cell(row, headers, "category"),
      unitPrice: numberValue(row[headers.unitPrice]),
      purchasePrice: numberValue(row[headers.purchasePrice]),
      supplier: cell(row, headers, "supplier"),
      stock: numberValue(row[headers.stock]),
      minStock: numberValue(row[headers.minStock]),
      location: cell(row, headers, "location"),
    });
  }
  return parts;
}

export function customersFromRows(rows) {
  if (!rows.length) return [];
  let start = 0;
  let headers = mapHeaders(rows[0], CUSTOMER_HEADERS);
  if (Object.keys(headers).length >= 2) start = 1;
  else {
    headers = {
      name: 0,
      company: 1,
      phone: 2,
      email: 3,
      address: 4,
      postalCode: 5,
      city: 6,
      vatNumber: 7,
    };
  }
  const customers = [];
  for (const row of rows.slice(start)) {
    const name = cell(row, headers, "name");
    const company = cell(row, headers, "company");
    const email = cell(row, headers, "email");
    if (!name && !company && !email) continue;
    customers.push({
      number: cell(row, headers, "number"),
      name: name || company,
      company,
      phone: cell(row, headers, "phone"),
      phone2: cell(row, headers, "phone2"),
      phone3: cell(row, headers, "phone3"),
      email,
      address: cell(row, headers, "address"),
      postalCode: cell(row, headers, "postalCode"),
      city: cell(row, headers, "city"),
      vatNumber: cell(row, headers, "vatNumber"),
      peppolId: cell(row, headers, "peppolId"),
      notes: cell(row, headers, "notes"),
    });
  }
  return customers;
}

export function suppliersFromRows(rows) {
  if (!rows.length) return [];
  let start = 0;
  let headers = mapHeaders(rows[0], SUPPLIER_HEADERS);
  if (Object.keys(headers).length >= 2) start = 1;
  else {
    headers = {
      number: 0,
      name: 1,
      contact: 2,
      phone: 3,
      email: 4,
      address: 5,
      notes: 6,
    };
  }
  const suppliers = [];
  for (const row of rows.slice(start)) {
    const name = cell(row, headers, "name");
    const email = cell(row, headers, "email");
    const number = cell(row, headers, "number");
    if (!name && !email && !number) continue;
    suppliers.push({
      number,
      name,
      contact: cell(row, headers, "contact"),
      phone: cell(row, headers, "phone"),
      email,
      address: cell(row, headers, "address"),
      notes: cell(row, headers, "notes"),
    });
  }
  return suppliers;
}

export function vehiclesFromRows(rows) {
  if (!rows.length) return [];
  let start = 0;
  let headers = mapHeaders(rows[0], VEHICLE_HEADERS);
  if (Object.keys(headers).length >= 2) start = 1;
  else {
    headers = {
      licensePlate: 0,
      brand: 1,
      model: 2,
      customer: 3,
      fuel: 4,
      mileage: 5,
      year: 6,
      vin: 7,
      company: 8,
    };
  }
  const vehicles = [];
  for (const row of rows.slice(start)) {
    const licensePlate = cell(row, headers, "licensePlate");
    if (!licensePlate) continue;
    vehicles.push({
      licensePlate,
      brand: cell(row, headers, "brand"),
      model: cell(row, headers, "model"),
      customer: cell(row, headers, "customer"),
      company: cell(row, headers, "company"),
      fuel: cell(row, headers, "fuel"),
      mileage: numberValue(row[headers.mileage]),
      year: numberValue(row[headers.year]),
      vin: cell(row, headers, "vin"),
    });
  }
  return vehicles;
}

function csvCell(value) {
  const s = String(value ?? "");
  if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadCsv(filename, headers, rows) {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(";"));
  const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

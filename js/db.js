const DB_NAME = "werkplaats-erp";
const DB_VERSION = 4;
export const STORES = [
  "garages",
  "customers",
  "vehicles",
  "technicians",
  "appointments",
  "parts",
  "workOrders",
  "workOrderLines",
  "invoices",
  "quotes",
  "quoteLines",
  "equipment",
  "cameraReads",
  "workOrderFiles",
];

let connection;

function openDb() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const txn = req.transaction;
      for (const name of STORES) {
        let store;
        if (!db.objectStoreNames.contains(name)) {
          store = db.createObjectStore(name, { keyPath: "id" });
          if (name !== "garages") store.createIndex("garageId", "garageId", { unique: false });
        } else {
          store = txn.objectStore(name);
        }
        if (name === "workOrderFiles" && store && !store.indexNames.contains("workOrderId")) {
          store.createIndex("workOrderId", "workOrderId", { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return connection;
}

function tx(storeName, mode = "readonly") {
  return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const db = {
  async get(store, id) {
    return reqToPromise((await tx(store)).get(id));
  },
  async getAll(store) {
    return reqToPromise((await tx(store)).getAll());
  },
  async byGarage(store, garageId) {
    const index = (await tx(store)).index("garageId");
    return reqToPromise(index.getAll(garageId));
  },
  async byIndex(store, indexName, value) {
    const index = (await tx(store)).index(indexName);
    return reqToPromise(index.getAll(value));
  },
  async put(store, record) {
    const request = (await tx(store, "readwrite")).put(record);
    await reqToPromise(request);
    return record;
  },
  async remove(store, id) {
    await reqToPromise((await tx(store, "readwrite")).delete(id));
  },
  async clear(store) {
    await reqToPromise((await tx(store, "readwrite")).clear());
  },
  async count(store) {
    return reqToPromise((await tx(store)).count());
  },
};

export async function exportAll() {
  const data = { version: 1, exportedAt: Date.now() };
  for (const name of STORES) data[name] = await db.getAll(name);
  return data;
}

export async function importAll(data) {
  if (!data || typeof data !== "object") throw new Error("Ongeldige backup");
  for (const name of STORES) {
    if (!Array.isArray(data[name])) continue;
    await db.clear(name);
    for (const row of data[name]) await db.put(name, row);
  }
}

export async function nextDocNumber(garageId, store, prefix) {
  const rows = await db.byGarage(store, garageId);
  const year = new Date().getFullYear();
  const marker = `${prefix}${year}-`;
  let max = 0;
  for (const row of rows) {
    if (typeof row.number === "string" && row.number.startsWith(marker)) {
      const n = Number(row.number.slice(marker.length));
      if (n > max) max = n;
    }
  }
  return `${marker}${String(max + 1).padStart(4, "0")}`;
}

export function lineTotals(lines, vatRate) {
  const excl = lines.reduce((sum, line) => sum + Number(line.qty) * Number(line.unitPrice), 0);
  const vat = excl * (vatRate / 100);
  return { excl, vat, incl: excl + vat };
}

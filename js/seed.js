import { db, STORES } from "./db.js?v=56";
import { normalizePlate, uid } from "./format.js?v=56";

export async function ensureSingleGarage(preferredId) {
  const garages = await db.getAll("garages");
  if (!garages.length) return preferredId;
  const keep = garages.find((g) => g.id === preferredId) || garages[0];
  if (garages.length > 1) {
    for (const name of STORES) {
      if (name === "garages") continue;
      const rows = await db.getAll(name);
      for (const row of rows) {
        if (row.garageId && row.garageId !== keep.id) {
          await db.put(name, { ...row, garageId: keep.id });
        }
      }
    }
    for (const extra of garages) {
      if (extra.id !== keep.id) await db.remove("garages", extra.id);
    }
  }
  localStorage.setItem("werkplaats-garage", keep.id);
  return keep.id;
}

export async function seedDemo() {
  const existing = await db.getAll("garages");
  if (existing.length) return existing[0].id;

  const g1 = uid();
  const now = Date.now();

  await db.put("garages", {
    id: g1,
    name: "AutoService De Waal",
    vatNumber: "BE0123.456.789",
    address: "Industrieweg 18",
    postalCode: "9000",
    city: "Gent",
    phone: "09 123 45 67",
    email: "info@autoservicedewaal.be",
    iban: "BE68 5390 0754 7034",
    vatRate: 21,
    paymentDays: 14,
    hourlyRate: 78,
    createdAt: now,
  });

  const c1 = uid();
  const c2 = uid();
  const c3 = uid();
  await db.put("customers", {
    id: c1,
    garageId: g1,
    number: "KL2026-0001",
    name: "Jan Vermeulen",
    company: "",
    phone: "0476 12 34 56",
    phone2: "09 234 11 00",
    phone3: "",
    email: "jan.vermeulen@email.be",
    address: "Kerkstraat 12",
    postalCode: "9000",
    city: "Gent",
    vatNumber: "",
    notes: "Vaste klant, altijd winter- én zomerbanden.",
    createdAt: now,
  });
  await db.put("customers", {
    id: c2,
    garageId: g1,
    number: "KL2026-0002",
    name: "Sophie Maes",
    company: "Maes Transport",
    phone: "0498 88 21 09",
    email: "sophie@maestransport.be",
    address: "Kaai 5",
    postalCode: "2000",
    city: "Antwerpen",
    vatNumber: "BE0456.112.334",
    notes: "Bedrijfsvoertuigen, factuur op firma.",
    createdAt: now,
  });
  await db.put("customers", {
    id: c3,
    garageId: g1,
    number: "KL2026-0003",
    name: "Thomas de Vries",
    company: "",
    phone: "06 1234 7788",
    email: "thomas@devries.nl",
    address: "Wilhelminaplein 8",
    postalCode: "5611",
    city: "Eindhoven",
    vatNumber: "",
    notes: "",
    createdAt: now,
  });

  const v1 = uid();
  const v2 = uid();
  const v3 = uid();
  await db.put("vehicles", {
    id: v1,
    garageId: g1,
    customerId: c1,
    licensePlate: "1-ABC-234",
    brand: "Volkswagen",
    model: "Golf 8",
    year: 2021,
    vin: "WVWZZZCDZMW123456",
    fuel: "benzine",
    mileage: 64210,
  });
  await db.put("vehicles", {
    id: v2,
    garageId: g1,
    customerId: c2,
    licensePlate: "2-TRS-901",
    brand: "Mercedes-Benz",
    model: "Sprinter",
    year: 2019,
    vin: "WDB9066331P123456",
    fuel: "diesel",
    mileage: 187400,
  });
  await db.put("vehicles", {
    id: v3,
    garageId: g1,
    customerId: c3,
    licensePlate: "K-834-TZ",
    brand: "Peugeot",
    model: "208",
    year: 2020,
    vin: "VF3CCHNZZKL123456",
    fuel: "benzine",
    mileage: 41500,
  });

  const t1 = uid();
  const t2 = uid();
  const t3 = uid();
  await db.put("technicians", { id: t1, garageId: g1, name: "Koen Janssens", active: true });
  await db.put("technicians", { id: t2, garageId: g1, name: "Lisa Declercq", active: true });
  await db.put("technicians", { id: t3, garageId: g1, name: "Mark Hendriks", active: true });

  const s1 = uid();
  const s2 = uid();
  const s3 = uid();
  await db.put("suppliers", {
    id: s1,
    garageId: g1,
    number: "LV2026-0001",
    name: "Castrol Belgium",
    contact: "Pieter Bosmans",
    phone: "02 123 45 67",
    email: "orders@castrol.be",
    address: "Havenlaan 86, 1000 Brussel",
    notes: "Smeermiddelen, levering op dinsdag.",
  });
  await db.put("suppliers", {
    id: s2,
    garageId: g1,
    number: "LV2026-0002",
    name: "Mann Filter",
    contact: "Klantendienst",
    phone: "03 210 44 11",
    email: "info@mann-filter.be",
    address: "Noorderlaan 21, 2030 Antwerpen",
    notes: "Filters en luchtinlaat.",
  });
  await db.put("suppliers", {
    id: s3,
    garageId: g1,
    number: "LV2026-0003",
    name: "Intertyre",
    contact: "Sales desk",
    phone: "09 330 12 80",
    email: "order@intertyre.be",
    address: "Industrieterrein Zuid 4, 9000 Gent",
    notes: "Banden, snelle voorraad.",
  });

  const p1 = uid();
  const p2 = uid();
  const p3 = uid();
  const p4 = uid();
  await db.put("parts", {
    id: p1,
    garageId: g1,
    sku: "OIL-5W30-5",
    name: "Motorolie 5W-30 5L",
    brand: "Castrol",
    category: "Smeermiddelen",
    supplier: "Castrol Belgium",
    supplierId: s1,
    purchasePrice: 28.4,
    unitPrice: 42.5,
    stock: 18,
    minStock: 6,
    location: "Rek A1",
  });
  await db.put("parts", {
    id: p2,
    garageId: g1,
    sku: "FLT-VW-GOLF",
    name: "Oliefilter Golf 8",
    brand: "Mann",
    category: "Filters",
    supplier: "Mann Filter",
    supplierId: s2,
    purchasePrice: 8.2,
    unitPrice: 14.9,
    stock: 4,
    minStock: 5,
    location: "Rek B3",
  });
  await db.put("parts", {
    id: p3,
    garageId: g1,
    sku: "TYR-205-55-16",
    name: "Band 205/55 R16",
    brand: "Michelin",
    category: "Banden",
    supplier: "Intertyre",
    supplierId: s3,
    purchasePrice: 78,
    unitPrice: 112,
    stock: 24,
    minStock: 8,
    location: "Bandenrek",
  });
  await db.put("parts", {
    id: p4,
    garageId: g1,
    sku: "TYR-195-65-15",
    name: "Band 195/65 R15",
    brand: "Continental",
    category: "Banden",
    supplier: "Intertyre",
    supplierId: s3,
    purchasePrice: 61,
    unitPrice: 89,
    stock: 16,
    minStock: 8,
    location: "Magazijn",
  });

  const w1 = uid();
  await db.put("workOrders", {
    id: w1,
    garageId: g1,
    number: "WB2026-0001",
    customerId: c1,
    vehicleId: v1,
    technicianId: t1,
    status: "in_uitvoering",
    complaint: "Onderhoudsbeurt + zomerbanden monteren",
    diagnosis: "",
    mileageIn: 64210,
    createdAt: now - 3600 * 1000 * 5,
    completedAt: null,
  });
  await db.put("workOrderLines", {
    id: uid(),
    garageId: g1,
    workOrderId: w1,
    type: "arbeid",
    description: "Onderhoudsbeurt",
    partId: null,
    qty: 1.5,
    unitPrice: 78,
  });
  await db.put("workOrderLines", {
    id: uid(),
    garageId: g1,
    workOrderId: w1,
    type: "onderdeel",
    description: "Motorolie 5W-30 5L",
    partId: p1,
    qty: 1,
    unitPrice: 42.5,
  });

  const q1 = uid();
  await db.put("quotes", {
    id: q1,
    garageId: g1,
    number: "OF2026-0001",
    customerId: c1,
    vehicleId: v1,
    title: "Remschijven voor + montage",
    notes: "Prijs inclusief afvoer oude schijven.",
    status: "concept",
    validUntil: now + 14 * 86400000,
    workOrderId: null,
    sentVia: null,
    createdAt: now - 86400 * 1000 * 2,
  });
  await db.put("quoteLines", {
    id: uid(),
    garageId: g1,
    quoteId: q1,
    type: "onderdeel",
    description: "Remschijven voor (set)",
    partId: null,
    qty: 1,
    unitPrice: 186,
  });
  await db.put("quoteLines", {
    id: uid(),
    garageId: g1,
    quoteId: q1,
    type: "arbeid",
    description: "Montage remschijven",
    partId: null,
    qty: 1.5,
    unitPrice: 78,
  });

  const w2 = uid();
  await db.put("workOrders", {
    id: w2,
    garageId: g1,
    number: "WB2026-0002",
    customerId: c2,
    vehicleId: v2,
    technicianId: t2,
    status: "gepland",
    complaint: "Remmen voor controleren, piept bij het remmen",
    diagnosis: "",
    mileageIn: 187400,
    createdAt: now - 86400 * 1000,
    completedAt: null,
  });

  const w3 = uid();
  await db.put("workOrders", {
    id: w3,
    garageId: g1,
    number: "WB2026-0003",
    customerId: c1,
    vehicleId: v1,
    technicianId: t1,
    status: "gefactureerd",
    complaint: "APK-keuring en nieuwe ruitenwissers",
    diagnosis: "Keuring oké. Ruitenwissers voor vervangen.",
    mileageIn: 63880,
    createdAt: now - 86400 * 1000 * 12,
    completedAt: now - 86400 * 1000 * 10,
  });
  await db.put("workOrderLines", {
    id: uid(),
    garageId: g1,
    workOrderId: w3,
    type: "arbeid",
    description: "Keuring + montage",
    partId: null,
    qty: 1,
    unitPrice: 78,
  });
  await db.put("invoices", {
    id: uid(),
    garageId: g1,
    number: "F2026-0001",
    workOrderId: w3,
    customerId: c1,
    status: "betaald",
    issuedAt: now - 86400 * 1000 * 10,
    dueAt: now - 86400 * 1000 * 10 + 14 * 86400000,
    paidAt: now - 86400 * 1000 * 6,
  });

  await db.put("appointments", {
    id: uid(),
    garageId: g1,
    customerId: c1,
    vehicleId: v1,
    technicianId: t1,
    workOrderId: w1,
    start: startToday(9, 0),
    end: startToday(11, 0),
    title: "Onderhoud Golf",
    notes: "",
  });
  await db.put("appointments", {
    id: uid(),
    garageId: g1,
    customerId: c2,
    vehicleId: v2,
    technicianId: t2,
    workOrderId: w2,
    start: startToday(13, 30),
    end: startToday(15, 30),
    title: "Remmen Sprinter",
    notes: "Klant wacht niet",
  });
  await db.put("appointments", {
    id: uid(),
    garageId: g1,
    customerId: c3,
    vehicleId: v3,
    technicianId: t3,
    workOrderId: null,
    start: startToday(10, 0),
    end: startToday(11, 0),
    title: "Bandenwissel Peugeot",
    notes: "",
  });

  const eLift = uid();
  const eTire = uid();
  const eBalance = uid();
  const eLift2 = uid();
  await db.put("equipment", {
    id: eLift,
    garageId: g1,
    type: "brug",
    brand: "TwinBusch",
    model: "TW 242",
    serial: "TB-242-88421",
    workstationNumber: "1",
    installedAt: "2023-03-12",
    nextInspectionAt: "2026-11-15",
    notes: "2-kolomsbrug, 4,2 t",
  });
  await db.put("equipment", {
    id: eTire,
    garageId: g1,
    type: "bandenmachine",
    brand: "Corghi",
    model: "Artiglio 50",
    serial: "CG-A50-11092",
    workstationNumber: "2",
    installedAt: "2024-01-20",
    nextInspectionAt: "2027-01-20",
    notes: "",
  });
  await db.put("equipment", {
    id: eBalance,
    garageId: g1,
    type: "balanceermachine",
    brand: "Hunter",
    model: "RoadForce Elite",
    serial: "HN-RF-33011",
    workstationNumber: "2",
    installedAt: "2024-01-20",
    nextInspectionAt: "2026-10-28",
    notes: "Keuring bijna vervallen",
  });
  await db.put("equipment", {
    id: eLift2,
    garageId: g1,
    type: "brug",
    brand: "Nussbaum",
    model: "Smart Lift 2.40",
    serial: "NB-SL-55210",
    workstationNumber: "1",
    installedAt: "2022-06-01",
    nextInspectionAt: "2026-12-01",
    notes: "",
  });

  const wo1 = await db.get("workOrders", w1);
  const wo2 = await db.get("workOrders", w2);
  const wo3 = await db.get("workOrders", w3);
  if (wo1) await db.put("workOrders", { ...wo1, equipmentId: eTire });
  if (wo2) await db.put("workOrders", { ...wo2, equipmentId: eLift });
  if (wo3) await db.put("workOrders", { ...wo3, equipmentId: eLift });

  await db.put("cameraReads", {
    id: uid(),
    garageId: g1,
    plate: "1-ABC-234",
    readAt: now - 12 * 60 * 1000,
    cameraName: "Poort inrit",
    matchedWorkOrderId: null,
  });
  await db.put("cameraReads", {
    id: uid(),
    garageId: g1,
    plate: "9-ZZZ-000",
    readAt: now - 4 * 60 * 1000,
    cameraName: "Poort inrit",
    matchedWorkOrderId: null,
  });

  return g1;
}

function startToday(hours, minutes) {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d.getTime();
}

const DEMO_WORKSTATIONS = {
  "TB-242-88421": "1",
  "CG-A50-11092": "2",
  "HN-RF-33011": "2",
  "NB-SL-55210": "1",
};

export async function ensureEquipmentWorkstations() {
  const rows = await db.getAll("equipment");
  for (const row of rows) {
    if (String(row.workstationNumber || "").trim()) continue;
    const known = DEMO_WORKSTATIONS[row.serial];
    if (!known) continue;
    await db.put("equipment", { ...row, workstationNumber: known });
  }
}

const DEMO_WORK_ORDER_EQUIPMENT = {
  "WB2026-0001": "CG-A50-11092",
  "WB2026-0002": "TB-242-88421",
  "WB2026-0003": "TB-242-88421",
};

export async function ensureWorkOrderEquipment() {
  const orders = await db.getAll("workOrders");
  const machines = await db.getAll("equipment");
  for (const order of orders) {
    if (order.equipmentId) continue;
    const serial = DEMO_WORK_ORDER_EQUIPMENT[order.number];
    if (!serial) continue;
    const machine = machines.find((e) => e.garageId === order.garageId && e.serial === serial);
    if (!machine) continue;
    await db.put("workOrders", { ...order, equipmentId: machine.id });
  }
}

const DEMO_SUPPLIERS = [
  {
    name: "Castrol Belgium",
    contact: "Pieter Bosmans",
    phone: "02 123 45 67",
    email: "orders@castrol.be",
    address: "Havenlaan 86, 1000 Brussel",
    notes: "Smeermiddelen, levering op dinsdag.",
  },
  {
    name: "Mann Filter",
    contact: "Klantendienst",
    phone: "03 210 44 11",
    email: "info@mann-filter.be",
    address: "Noorderlaan 21, 2030 Antwerpen",
    notes: "Filters en luchtinlaat.",
  },
  {
    name: "Intertyre",
    contact: "Sales desk",
    phone: "09 330 12 80",
    email: "order@intertyre.be",
    address: "Industrieterrein Zuid 4, 9000 Gent",
    notes: "Banden, snelle voorraad.",
  },
];

let demoSupplierEnsuring;

export async function ensureSuppliers(garageId) {
  if (demoSupplierEnsuring) return demoSupplierEnsuring;
  demoSupplierEnsuring = (async () => {
    const existing = await db.byGarage("suppliers", garageId);
    const byName = new Map(existing.map((row) => [String(row.name || "").trim().toLowerCase(), row]));
    const garage = await db.get("garages", garageId);
    if (garage?.name === "AutoService De Waal") {
      for (const demo of DEMO_SUPPLIERS) {
        const key = demo.name.toLowerCase();
        if (byName.has(key)) continue;
        const row = { id: uid(), garageId, ...demo };
        await db.put("suppliers", row);
        byName.set(key, row);
      }
    }
    const parts = await db.byGarage("parts", garageId);
    for (const part of parts) {
      const name = String(part.supplier || "").trim();
      if (!name) {
        if (part.supplierId) await db.put("parts", { ...part, supplierId: "" });
        continue;
      }
      let supplier = byName.get(name.toLowerCase());
      if (!supplier) {
        supplier = {
          id: uid(),
          garageId,
          name,
          contact: "",
          phone: "",
          email: "",
          address: "",
          notes: "",
        };
        await db.put("suppliers", supplier);
        byName.set(name.toLowerCase(), supplier);
      }
      if (part.supplierId !== supplier.id || part.supplier !== supplier.name) {
        await db.put("parts", { ...part, supplier: supplier.name, supplierId: supplier.id });
      }
    }
  })();
  return demoSupplierEnsuring;
}

let demoAnprEnsuring;

export async function ensureDemoCameraReads(garageId) {
  if (demoAnprEnsuring) return demoAnprEnsuring;
  demoAnprEnsuring = (async () => {
    const existing = await db.byGarage("cameraReads", garageId);
    if (existing.length) return;
    const vehicles = await db.byGarage("vehicles", garageId);
    if (!vehicles.some((v) => normalizePlate(v.licensePlate) === "1ABC234")) return;
    const now = Date.now();
    await db.put("cameraReads", {
      id: uid(),
      garageId,
      plate: "1-ABC-234",
      readAt: now - 12 * 60 * 1000,
      cameraName: "Poort inrit",
      matchedWorkOrderId: null,
    });
    await db.put("cameraReads", {
      id: uid(),
      garageId,
      plate: "9-ZZZ-000",
      readAt: now - 4 * 60 * 1000,
      cameraName: "Poort inrit",
      matchedWorkOrderId: null,
    });
  })();
  return demoAnprEnsuring;
}

let demoQuoteEnsuring;

export async function ensureDemoQuotes(garageId) {
  if (demoQuoteEnsuring) return demoQuoteEnsuring;
  demoQuoteEnsuring = (async () => {
    const existing = await db.byGarage("quotes", garageId);
    if (existing.length) return;
    const customers = await db.byGarage("customers", garageId);
    const vehicles = await db.byGarage("vehicles", garageId);
    const customer = customers.find((c) => c.name === "Jan Vermeulen");
    const vehicle = vehicles.find((v) => normalizePlate(v.licensePlate) === "1ABC234");
    if (!customer || !vehicle) return;
    const now = Date.now();
    const q1 = uid();
    await db.put("quotes", {
      id: q1,
      garageId,
      number: "OF2026-0001",
      customerId: customer.id,
      vehicleId: vehicle.id,
      title: "Remschijven voor + montage",
      notes: "Prijs inclusief afvoer oude schijven.",
      status: "concept",
      validUntil: now + 14 * 86400000,
      workOrderId: null,
      sentVia: null,
      createdAt: now - 86400 * 1000 * 2,
    });
    await db.put("quoteLines", {
      id: uid(),
      garageId,
      quoteId: q1,
      type: "onderdeel",
      description: "Remschijven voor (set)",
      partId: null,
      qty: 1,
      unitPrice: 186,
    });
    await db.put("quoteLines", {
      id: uid(),
      garageId,
      quoteId: q1,
      type: "arbeid",
      description: "Montage remschijven",
      partId: null,
      qty: 1.5,
      unitPrice: 78,
    });
  })();
  return demoQuoteEnsuring;
}

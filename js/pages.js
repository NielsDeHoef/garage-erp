import { db, nextDocNumber, lineTotals, exportAll, importAll } from "./db.js";
import { partsFromRows, rowsFromSpreadsheet } from "./excel-import.js";
import {
  EQUIPMENT_TYPES,
  FUELS,
  WORK_STATUSES,
  customerPhones,
  dateFmt,
  dateTimeFmt,
  equipmentLabel,
  euro,
  h,
  invoiceStatusLabel,
  QUOTE_STATUSES,
  quoteStatusLabel,
  normalizePlate,
  addDays,
  isoDate,
  mondayOf,
  parseIsoDate,
  startOfDay,
  startOfMonth,
  statusLabel,
  timeFmt,
  toDatetimeLocal,
  todayIso,
  uid,
} from "./format.js";

const ANPR_WINDOW_MS = 12 * 60 * 60 * 1000;

export const NAV = [
  ["dashboard", "Dashboard"],
  ["planning", "Planning"],
  ["werkbonnen", "Werkbonnen"],
  ["offertes", "Offertes"],
  ["inrit", "ANPR / Poort"],
  ["klanten", "Klanten"],
  ["voertuigen", "Voertuigen"],
  ["onderdelen", "Onderdelen"],
  ["facturen", "Facturen"],
  ["apparatuur", "Apparatuur"],
  ["instellingen", "Instellingen"],
];

export function navBadge(ctx, key) {
  if (key === "werkbonnen") return ctx.workOrders.filter((w) => w.status !== "gefactureerd").length;
  if (key === "offertes") return (ctx.quotes || []).filter((q) => q.status === "concept").length;
  if (key === "inrit") return anprUnclaimedCount(ctx);
  return 0;
}

function field(label, inner) {
  return `<div class="field"><label>${h(label)}</label>${inner}</div>`;
}

function input(name, value = "", extra = "") {
  return `<input class="input" name="${name}" value="${h(value)}" ${extra}>`;
}

function area(name, value = "") {
  return `<textarea name="${name}">${h(value)}</textarea>`;
}

function select(name, options, value, extra = "") {
  const html = options
    .map((o) => {
      const attrs = [
        o.customerId ? `data-customer-id="${h(o.customerId)}"` : "",
        o.vehicleId ? `data-vehicle-id="${h(o.vehicleId)}"` : "",
        o.technicianId ? `data-technician-id="${h(o.technicianId)}"` : "",
        o.equipmentId ? `data-equipment-id="${h(o.equipmentId)}"` : "",
        o.notes ? `data-notes="${h(o.notes)}"` : "",
        o.price != null ? `data-price="${h(o.price)}"` : "",
        o.name ? `data-name="${h(o.name)}"` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<option value="${h(o.value)}" ${attrs} ${String(o.value) === String(value) ? "selected" : ""}>${h(o.label)}</option>`;
    })
    .join("");
  return `<select name="${name}" ${extra}>${html}</select>`;
}

function customerChoiceOptions(ctx) {
  return ctx.customers.map((c) => ({
    value: c.id,
    label: [c.name, c.company, customerPhones(c)[0]].filter(Boolean).join(" · "),
  }));
}

function vehicleChoiceOptions(ctx, { empty = true } = {}) {
  const rows = ctx.vehicles.map((v) => ({
    value: v.id,
    label: `${v.licensePlate} · ${v.brand} ${v.model}`,
    customerId: v.customerId,
  }));
  return empty ? [{ value: "", label: "—" }, ...rows] : rows;
}

function searchSelect(name, options, value, extra = "") {
  const selected = options.find((o) => String(o.value) === String(value)) || options.find((o) => o.value) || options[0];
  const placeholder = name === "vehicleId" ? "Zoek nummerplaat of voertuig..." : "Zoek klant...";
  const items = options
    .map((o) => {
      const attrs = [
        `data-value="${h(o.value)}"`,
        o.customerId ? `data-customer-id="${h(o.customerId)}"` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<button type="button" class="combo-item" ${attrs}>${h(o.label)}</button>`;
    })
    .join("");
  return `<div class="combo" data-combo>
    ${select(name, options, value, `${extra} class="combo-select"`)}
    <input class="input combo-search" type="search" autocomplete="off" placeholder="${placeholder}" value="${h(selected?.label || "")}" data-combo-search>
    <div class="combo-panel" hidden>${items}</div>
  </div>`;
}

function empty(text) {
  return `<div class="empty">${h(text)}</div>`;
}

const tableSorts = {};

export function setTableSort(spec) {
  const split = spec.indexOf(":");
  const table = spec.slice(0, split);
  const key = spec.slice(split + 1);
  const cur = tableSorts[table];
  tableSorts[table] = { key, dir: cur?.key === key && cur.dir === "asc" ? "desc" : "asc" };
}

function sortInfo(table, defaultKey, defaultDir = "asc") {
  return tableSorts[table] || { key: defaultKey, dir: defaultDir };
}

function cmpVal(a, b) {
  const emptyA = a == null || a === "";
  const emptyB = b == null || b === "";
  if (emptyA && emptyB) return 0;
  if (emptyA) return 1;
  if (emptyB) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "nl", { numeric: true, sensitivity: "base" });
}

function sorted(table, rows, getters, defaultKey, defaultDir = "asc") {
  const st = sortInfo(table, defaultKey, defaultDir);
  const get = getters[st.key] || getters[defaultKey];
  if (!get) return [...rows];
  const mul = st.dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => mul * cmpVal(get(a), get(b)));
}

function ths(table, cols, defaultKey, defaultDir = "asc") {
  const st = sortInfo(table, defaultKey, defaultDir);
  return cols
    .map((col) => {
      const on = st.key === col.key;
      const mark = on ? (st.dir === "asc" ? "↑" : "↓") : "↕";
      const cls = ["th-sort-wrap", col.cls || "", on ? "sorted" : ""].filter(Boolean).join(" ");
      return `<th class="${cls}"><button type="button" class="th-sort" data-sort="${table}:${col.key}">${h(col.label)} <span class="th-sort-icon">${mark}</span></button></th>`;
    })
    .join("");
}

function fileSizeLabel(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function invoiceAmount(ctx, invoice) {
  return lineTotals(ctx.lines.filter((line) => line.workOrderId === invoice.workOrderId), ctx.garage.vatRate).incl;
}

function quoteAmount(ctx, quote) {
  return lineTotals((ctx.quoteLines || []).filter((line) => line.quoteId === quote.id), ctx.garage.vatRate).incl;
}

function invoiceRows(ctx, invoices, table = "klant-facturen") {
  if (!invoices.length) return empty("Nog geen facturen.");
  const cols = [
    { key: "number", label: "Nummer" },
    { key: "date", label: "Datum" },
    { key: "status", label: "Status" },
    { key: "amount", label: "Bedrag", cls: "right" },
  ];
  return `<table><thead><tr>${ths(table, cols, "date", "desc")}</tr></thead><tbody>
    ${sorted(
      table,
      invoices,
      {
        number: (invoice) => invoice.number,
        date: (invoice) => invoice.issuedAt,
        status: (invoice) => invoiceStatusLabel(invoice.status),
        amount: (invoice) => invoiceAmount(ctx, invoice),
      },
      "date",
      "desc"
    )
      .map((invoice) => {
        return `<tr class="clickable" data-go="#/facturen/${invoice.id}">
          <td class="mono">${h(invoice.number)}</td>
          <td>${dateFmt.format(invoice.issuedAt)}</td>
          <td><span class="badge ${invoice.status}">${h(invoiceStatusLabel(invoice.status))}</span></td>
          <td class="right">${euro.format(invoiceAmount(ctx, invoice))}</td>
        </tr>`;
      })
      .join("")}
  </tbody></table>`;
}

function quoteRows(ctx, quotes, table = "offertes") {
  if (!quotes.length) return empty("Nog geen offertes.");
  const cols = [
    { key: "number", label: "Nummer" },
    { key: "title", label: "Omschrijving" },
    { key: "status", label: "Status" },
    { key: "amount", label: "Bedrag", cls: "right" },
  ];
  return `<table><thead><tr>${ths(table, cols, "date", "desc")}</tr></thead><tbody>
    ${sorted(
      table,
      quotes,
      {
        number: (quote) => quote.number,
        title: (quote) => quote.title,
        status: (quote) => quoteStatusLabel(quote.status),
        amount: (quote) => quoteAmount(ctx, quote),
        date: (quote) => quote.createdAt,
      },
      "date",
      "desc"
    )
      .map((quote) => {
        return `<tr class="clickable" data-go="#/offertes/${quote.id}">
          <td class="mono">${h(quote.number)}</td>
          <td>${h(quote.title)}<div class="muted">${dateFmt.format(quote.createdAt)}</div></td>
          <td><span class="badge ${quote.status}">${h(quoteStatusLabel(quote.status))}</span></td>
          <td class="right">${euro.format(quoteAmount(ctx, quote))}</td>
        </tr>`;
      })
      .join("")}
  </tbody></table>`;
}

function vehicleRows(ctx, vehicles) {
  if (!vehicles.length) return empty("Nog geen voertuigen voor deze klant.");
  const table = "klant-voertuigen";
  const cols = [
    { key: "plate", label: "Nummerplaat" },
    { key: "vehicle", label: "Voertuig" },
    { key: "km", label: "Km" },
  ];
  return `<table><thead><tr>${ths(table, cols, "plate")}</tr></thead><tbody>
    ${sorted(
      table,
      vehicles,
      {
        plate: (v) => v.licensePlate,
        vehicle: (v) => `${v.brand} ${v.model}`,
        km: (v) => Number(v.mileage || 0),
      },
      "plate"
    )
      .map(
        (v) => `<tr class="clickable" data-go="#/voertuigen/${v.id}">
          <td class="mono">${h(v.licensePlate)}</td>
          <td>${h(v.brand)} ${h(v.model)}<div class="muted">${h(v.fuel)} · ${h(v.year)}</div></td>
          <td>${h(v.mileage)}</td>
        </tr>`
      )
      .join("")}
  </tbody></table>`;
}

function repairRows(ctx, vehicleId) {
  const rows = ctx.workOrders.filter((order) => order.vehicleId === vehicleId);
  if (!rows.length) return empty("Nog geen herstellingen voor dit voertuig.");
  const table = "voertuig-historiek";
  const cols = [
    { key: "date", label: "Datum" },
    { key: "number", label: "Werkbon" },
    { key: "job", label: "Opdracht" },
    { key: "km", label: "Km" },
    { key: "status", label: "Status" },
    { key: "amount", label: "Bedrag", cls: "right" },
  ];
  return `<table><thead><tr>${ths(table, cols, "date", "desc")}</tr></thead><tbody>
    ${sorted(
      table,
      rows,
      {
        date: (order) => order.createdAt,
        number: (order) => order.number,
        job: (order) => order.complaint || order.diagnosis,
        km: (order) => Number(order.mileageIn || 0),
        status: (order) => statusLabel(order.status),
        amount: (order) => lineTotals(ctx.lines.filter((line) => line.workOrderId === order.id), ctx.garage.vatRate).incl,
      },
      "date",
      "desc"
    )
      .map((order) => {
        const tot = lineTotals(
          ctx.lines.filter((line) => line.workOrderId === order.id),
          ctx.garage.vatRate
        );
        const invoice = ctx.invoices.find((row) => row.workOrderId === order.id);
        return `<tr class="clickable" data-go="#/werkbonnen/${order.id}">
          <td>${dateFmt.format(order.createdAt)}</td>
          <td class="mono">${h(order.number)}${invoice ? `<div class="muted">${h(invoice.number)}</div>` : ""}</td>
          <td>${h(order.complaint || order.diagnosis)}</td>
          <td>${h(order.mileageIn || "—")}</td>
          <td><span class="badge ${order.status}">${h(statusLabel(order.status))}</span></td>
          <td class="right">${euro.format(tot.incl)}</td>
        </tr>`;
      })
      .join("")}
  </tbody></table>`;
}

function customerName(ctx, id) {
  return ctx.customers.find((c) => c.id === id)?.name ?? "—";
}

function vehicleName(ctx, id) {
  const v = ctx.vehicles.find((x) => x.id === id);
  return v ? `${v.licensePlate} · ${v.brand} ${v.model}` : "—";
}

function planningJobsForVehicle(ctx, vehicleId) {
  if (!vehicleId) return [];
  const from = addDays(startOfDay(), -1);
  const to = addDays(startOfDay(), 21);
  return ctx.appointments
    .filter((a) => a.vehicleId === vehicleId && a.start >= from && a.start < to)
    .filter((a) => {
      const wo = a.workOrderId && ctx.workOrders.find((w) => w.id === a.workOrderId);
      return !wo || wo.status === "gefactureerd";
    })
    .sort((a, b) => a.start - b.start);
}

export function matchAnpr(ctx, plate) {
  const key = normalizePlate(plate);
  const vehicle = ctx.vehicles.find((v) => normalizePlate(v.licensePlate) === key) || null;
  if (!vehicle) {
    return { plate, vehicle: null, workOrder: null, appointment: null, appointments: [], kind: "unknown" };
  }
  const rank = (status) => (status === "in_uitvoering" ? 0 : status === "gepland" ? 1 : 2);
  const workOrder =
    ctx.workOrders
      .filter((w) => w.vehicleId === vehicle.id && w.status !== "gefactureerd")
      .sort((a, b) => rank(a.status) - rank(b.status) || b.createdAt - a.createdAt)[0] || null;
  const appointments = planningJobsForVehicle(ctx, vehicle.id);
  const dayStart = startOfDay();
  const appointment =
    appointments.find((a) => a.start >= dayStart && a.start < dayStart + 86400000) || appointments[0] || null;
  return {
    plate,
    vehicle,
    workOrder,
    appointment,
    appointments,
    kind: workOrder || appointment ? "booked" : "no_order",
  };
}

export async function ingestCameraRead(garageId, plate, cameraName = "Poort inrit", options = {}) {
  const trimmed = String(plate || "").trim();
  if (!trimmed) return null;
  const key = normalizePlate(trimmed);
  if (!key) return null;
  if (options.debounce) {
    const existing = await db.byGarage("cameraReads", garageId);
    const last = existing
      .filter((row) => normalizePlate(row.plate) === key)
      .sort((a, b) => b.readAt - a.readAt)[0];
    if (last && Date.now() - last.readAt < 8000) return last;
  }
  const record = {
    id: uid(),
    garageId,
    plate: trimmed.toUpperCase(),
    readAt: Date.now(),
    cameraName: cameraName || "Poort inrit",
    matchedWorkOrderId: null,
  };
  await db.put("cameraReads", record);
  return record;
}

function techName(ctx, id) {
  return ctx.technicians.find((t) => t.id === id)?.name ?? "—";
}

function equipmentName(ctx, id) {
  const e = ctx.equipment.find((row) => row.id === id);
  if (!e) return "—";
  const ws = e.workstationNumber ? `WS ${e.workstationNumber}` : "geen WS";
  return `${ws} · ${equipmentLabel(e.type)} · ${e.brand} ${e.model}`;
}

function equipmentSelectOptions(ctx) {
  return ctx.equipment
    .slice()
    .sort((a, b) =>
      String(a.workstationNumber || "").localeCompare(String(b.workstationNumber || ""), "nl", { numeric: true })
    )
    .map((e) => ({ value: e.id, label: equipmentName(ctx, e.id) }));
}

function formToObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

export async function dashboard(ctx) {
  const open = ctx.workOrders.filter((w) => w.status !== "gefactureerd");
  const tiles = NAV.filter(([key]) => key !== "dashboard")
    .map(([key, label]) => {
      const count = navBadge(ctx, key);
      return `<a class="dash-tile" href="#/${key}">
        <span>${h(label)}</span>
        ${count ? `<span class="nav-count">${count}</span>` : ""}
      </a>`;
    })
    .join("");
  return {
    title: "Dashboard",
    subtitle: ctx.garage.name,
    html: `
      <div class="dash-tiles">${tiles}</div>
      <div class="panel" style="margin-top:16px">
        <h3>Open werkbonnen</h3>
        ${
          open.length
            ? `<table><thead><tr>${ths(
                "dashboard-wo",
                [
                  { key: "number", label: "Nummer" },
                  { key: "customer", label: "Klant / opdracht" },
                  { key: "tech", label: "Monteur" },
                  { key: "status", label: "Status" },
                ],
                "number"
              )}</tr></thead><tbody>${sorted(
                "dashboard-wo",
                open,
                {
                  number: (w) => w.number,
                  customer: (w) => `${customerName(ctx, w.customerId)} ${w.complaint || ""}`,
                  tech: (w) => techName(ctx, w.technicianId),
                  status: (w) => statusLabel(w.status),
                },
                "number"
              )
                .slice(0, 6)
                .map(
                  (w) => `<tr class="clickable" data-go="#/werkbonnen/${w.id}">
                  <td class="mono">${h(w.number)}</td>
                  <td>${h(customerName(ctx, w.customerId))}<div class="muted">${h(w.complaint)}</div></td>
                  <td><div>${h(techName(ctx, w.technicianId))}</div><div class="muted">${h(equipmentName(ctx, w.equipmentId))}</div></td>
                  <td><span class="badge ${w.status}">${h(statusLabel(w.status))}</span></td>
                </tr>`
                )
                .join("")}</tbody></table>`
            : empty("Geen open werkbonnen.")
        }
      </div>
    `,
  };
}

export async function klanten(ctx, id) {
  if (id === "new" || (id && id !== "new")) {
    const row = id === "new" ? null : ctx.customers.find((c) => c.id === id);
    if (id !== "new" && !row) return { title: "Klant", html: empty("Klant niet gevonden.") };
    return {
      title: row ? row.name : "Nieuwe klant",
      subtitle: "Contact- en factuurgegevens",
      actions: row ? `<button class="btn danger" data-delete="customers:${row.id}">Verwijderen</button>` : "",
      html: `<form class="panel grid" data-save="customer">
        <input type="hidden" name="id" value="${h(row?.id || "")}">
        <div class="grid grid-2">
          ${field("Naam", input("name", row?.name, "required"))}
          ${field("Bedrijf", input("company", row?.company))}
        </div>
        ${field("E-mail", input("email", row?.email, 'type="email"'))}
        <div class="grid grid-3">
          ${field("Telefoon 1", input("phone", row?.phone, 'type="tel"'))}
          ${field("Telefoon 2", input("phone2", row?.phone2, 'type="tel"'))}
          ${field("Telefoon 3", input("phone3", row?.phone3, 'type="tel"'))}
        </div>
        <p class="muted">Maximaal 3 nummers. SMS en offertes gebruiken telefoon 1.</p>
        <div class="grid grid-3">
          ${field("Adres", input("address", row?.address))}
          ${field("Postcode", input("postalCode", row?.postalCode))}
          ${field("Gemeente", input("city", row?.city))}
        </div>
        ${field("BTW-nummer", input("vatNumber", row?.vatNumber))}
        ${field("Peppol-ID (optioneel, bv. 0208:0123456789)", input("peppolId", row?.peppolId))}
        ${field("Notities", area("notes", row?.notes))}
        <div class="row"><button class="btn accent" type="submit">Opslaan</button></div>
      </form>
      ${
        row
          ? `<div class="panel" style="margin-top:16px">
        <div class="topbar" style="margin-bottom:8px">
          <div><h3>Voertuigen</h3></div>
          <a class="btn accent" href="#/voertuigen/new/${row.id}">Voertuig toevoegen</a>
        </div>
        ${vehicleRows(
          ctx,
          ctx.vehicles.filter((v) => v.customerId === row.id)
        )}
      </div>
      <div class="panel" style="margin-top:16px">
        <h3>Vorige facturen</h3>
        ${invoiceRows(
          ctx,
          ctx.invoices.filter((invoice) => invoice.customerId === row.id)
        )}
      </div>
      <div class="panel" style="margin-top:16px">
        <h3>Offertes</h3>
        ${quoteRows(
          ctx,
          (ctx.quotes || []).filter((quote) => quote.customerId === row.id),
          "klant-offertes"
        )}
      </div>`
          : ""
      }`,
    };
  }

  const q = ctx.query;
  const rows = ctx.customers.filter((c) =>
    `${c.name} ${c.company} ${customerPhones(c).join(" ")} ${c.city}`.toLowerCase().includes(q)
  );
  return {
    title: "Klanten",
    subtitle: `${ctx.customers.length} klanten in deze garage`,
    actions: `<a class="btn accent" href="#/klanten/new">Nieuwe klant</a>`,
    html: `
      <div class="panel">
        <input class="input" data-search placeholder="Zoek op naam, telefoon of gemeente" value="${h(ctx.search)}">
        ${
          rows.length
            ? `<table><thead><tr>${ths(
                "klanten",
                [
                  { key: "name", label: "Naam" },
                  { key: "contact", label: "Contact" },
                  { key: "vehicles", label: "Voertuigen" },
                  { key: "city", label: "Plaats" },
                ],
                "name"
              )}</tr></thead><tbody>
          ${sorted(
            "klanten",
            rows,
            {
              name: (c) => `${c.name} ${c.company || ""}`,
              contact: (c) => customerPhones(c)[0] || c.email || "",
              vehicles: (c) => ctx.vehicles.filter((v) => v.customerId === c.id).length,
              city: (c) => `${c.postalCode || ""} ${c.city || ""}`,
            },
            "name"
          )
            .map((c) => {
              const cars = ctx.vehicles.filter((v) => v.customerId === c.id);
              const plates = cars.map((v) => v.licensePlate).join(", ") || "—";
              return `<tr class="clickable" data-go="#/klanten/${c.id}">
              <td><strong>${h(c.name)}</strong><div class="muted">${h(c.company)}</div></td>
              <td>${h(customerPhones(c).join(" · ") || "—")}<div class="muted">${h(c.email)}</div></td>
              <td class="mono">${h(plates)}<div class="muted">${cars.length} wagen${cars.length === 1 ? "" : "s"}</div></td>
              <td>${h(c.postalCode)} ${h(c.city)}</td>
            </tr>`;
            })
            .join("")}</tbody></table>`
            : empty("Nog geen klanten.")
        }
      </div>`,
  };
}

export async function voertuigen(ctx, id, extra) {
  if (id === "new" || id) {
    const row = id === "new" ? null : ctx.vehicles.find((v) => v.id === id);
    if (id !== "new" && !row) return { title: "Voertuig", html: empty("Voertuig niet gevonden.") };
    if (!ctx.customers.length) {
      return {
        title: "Nieuw voertuig",
        html: empty("Maak eerst een klant aan.") + `<p><a class="btn accent" href="#/klanten/new">Nieuwe klant</a></p>`,
      };
    }
    const presetCustomer = extra && ctx.customers.some((c) => c.id === extra) ? extra : row?.customerId;
    return {
      title: row ? row.licensePlate : "Nieuw voertuig",
      actions: row ? `<button class="btn danger" data-delete="vehicles:${row.id}">Verwijderen</button>` : "",
      html: `<form class="panel grid" data-save="vehicle">
        <input type="hidden" name="id" value="${h(row?.id || "")}">
        ${field("Klant", searchSelect("customerId", customerChoiceOptions(ctx), presetCustomer, "required"))}
        <div class="grid grid-3">
          ${field("Nummerplaat", input("licensePlate", row?.licensePlate, "required"))}
          ${field("Merk", input("brand", row?.brand, "required"))}
          ${field("Model", input("model", row?.model, "required"))}
        </div>
        <div class="grid grid-3">
          ${field("Bouwjaar", input("year", row?.year ?? "", 'type="number"'))}
          ${field("Kilometerstand", input("mileage", row?.mileage ?? "", 'type="number"'))}
          ${field(
            "Brandstof",
            select(
              "fuel",
              FUELS.map((f) => ({ value: f, label: f })),
              row?.fuel || "benzine"
            )
          )}
        </div>
        ${field("VIN / chassisnummer", input("vin", row?.vin))}
        <div class="row"><button class="btn accent" type="submit">Opslaan</button></div>
      </form>
      ${
        row
          ? `<div class="panel" style="margin-top:16px">
        <h3>Herstellingshistoriek</h3>
        <p class="muted">Vorige werkbonnen op ${h(row.licensePlate)}.</p>
        ${repairRows(ctx, row.id)}
      </div>`
          : ""
      }`,
    };
  }

  const rows = ctx.vehicles.filter((v) =>
    `${v.licensePlate} ${v.brand} ${v.model} ${customerName(ctx, v.customerId)}`.toLowerCase().includes(ctx.query)
  );
  return {
    title: "Voertuigen",
    actions: `<a class="btn accent" href="#/voertuigen/new">Nieuw voertuig</a>`,
    html: `<div class="panel">
      <input class="input" data-search placeholder="Zoek op nummerplaat of merk" value="${h(ctx.search)}">
      ${
        rows.length
          ? `<table><thead><tr>${ths(
              "voertuigen",
              [
                { key: "plate", label: "Nummerplaat" },
                { key: "vehicle", label: "Voertuig" },
                { key: "customer", label: "Klant" },
                { key: "km", label: "Km" },
              ],
              "plate"
            )}</tr></thead><tbody>
        ${sorted(
          "voertuigen",
          rows,
          {
            plate: (v) => v.licensePlate,
            vehicle: (v) => `${v.brand} ${v.model}`,
            customer: (v) => customerName(ctx, v.customerId),
            km: (v) => Number(v.mileage || 0),
          },
          "plate"
        )
          .map(
            (v) => `<tr class="clickable" data-go="#/voertuigen/${v.id}">
            <td class="mono">${h(v.licensePlate)}</td>
            <td>${h(v.brand)} ${h(v.model)}<div class="muted">${h(v.fuel)} · ${h(v.year)}</div></td>
            <td>${h(customerName(ctx, v.customerId))}</td>
            <td>${h(v.mileage)}</td>
          </tr>`
          )
          .join("")}</tbody></table>`
          : empty("Nog geen voertuigen.")
      }
    </div>`,
  };
}

export async function werkbonnen(ctx, id, extra) {
  if (id === "new" || id) {
    const row = id === "new" ? null : ctx.workOrders.find((w) => w.id === id);
    if (id !== "new" && !row) return { title: "Werkbon", html: empty("Werkbon niet gevonden.") };
    if (id === "new" && !ctx.customers.length) {
      return {
        title: "Nieuwe werkbon",
        html: empty("Maak eerst een klant en een voertuig aan.") + `<p><a class="btn accent" href="#/klanten/new">Nieuwe klant</a></p>`,
      };
    }
    const lines = row ? ctx.lines.filter((l) => l.workOrderId === row.id) : [];
    const totals = lineTotals(lines, ctx.garage.vatRate);
    const files = row ? await db.byIndex("workOrderFiles", "workOrderId", row.id) : [];
    const queue = id === "new" ? anprQueue(ctx) : [];
    const selectedRead =
      queue.find((r) => r.id === extra) ||
      queue.find((r) => matchAnpr(ctx, r.plate).vehicle) ||
      queue[0];
    const selectedMatch = selectedRead ? matchAnpr(ctx, selectedRead.plate) : null;
    const planFrom = addDays(startOfDay(), -1);
    const planTo = addDays(startOfDay(), 21);
    const planJobs = ctx.appointments
      .filter((a) => a.start >= planFrom && a.start < planTo)
      .filter((a) => {
        const wo = a.workOrderId && ctx.workOrders.find((w) => w.id === a.workOrderId);
        return !wo || wo.status === "gefactureerd";
      })
      .sort((a, b) => a.start - b.start);
    const selectedAppointmentId = selectedMatch?.appointment?.id || "";
    const anprPicker =
      id !== "new"
        ? ""
        : `<div class="panel anpr-pick" style="margin-bottom:16px">
        <h3>Kenteken van de camera</h3>
        <p class="muted">Kies de wagen die de ANPR aan de poort heeft gelezen. Daarna kies je de job uit de planning.</p>
        ${
          queue.length
            ? `<div class="anpr-queue">${queue
                .map((read) => {
                  const match = matchAnpr(ctx, read.plate);
                  const checked = selectedRead?.id === read.id ? "checked" : "";
                  const disabled = !match.vehicle ? "data-anpr-unknown" : "";
                  const jobs = (match.appointments || [])
                    .map((a) => `${timeFmt.format(a.start)} ${a.title}`)
                    .join(" · ");
                  return `<label class="anpr-card ${match.kind} anpr-pick-card">
                    <input type="radio" name="cameraReadId" value="${read.id}" data-anpr-pick
                      data-vehicle-id="${h(match.vehicle?.id || "")}"
                      data-customer-id="${h(match.vehicle?.customerId || "")}"
                      data-appointment-id="${h(match.appointment?.id || "")}"
                      ${disabled} ${checked}>
                    <div>
                      <div class="anpr-card-head">
                        <strong class="mono">${h(read.plate)}</strong>
                        <span class="muted">${timeFmt.format(read.readAt)}</span>
                      </div>
                      ${
                        match.vehicle
                          ? `<div>${h(match.vehicle.brand)} ${h(match.vehicle.model)} · ${h(customerName(ctx, match.vehicle.customerId))}</div>
                            <div class="muted">${jobs ? `Planning: ${h(jobs)}` : "Geen open planningjob"}</div>`
                          : `<div class="danger-text">Onbekende wagen — eerst registreren in Voertuigen.</div>`
                      }
                    </div>
                  </label>`;
                })
                .join("")}</div>`
            : `${empty("De camera heeft nog geen kenteken gelezen.")}<p><a class="btn secondary" href="#/inrit">Open ANPR / Poort</a></p>`
        }
        ${field(
          "Planningjob",
          select(
            "appointmentId",
            [
              { value: "", label: "Geen — vrije werkbon" },
              ...planJobs.map((a) => {
                const vehicle = ctx.vehicles.find((v) => v.id === a.vehicleId);
                return {
                  value: a.id,
                  label: `${dateTimeFmt.format(a.start)} · ${vehicle?.licensePlate || "—"} · ${a.title} · ${techName(ctx, a.technicianId)}`,
                  customerId: a.customerId,
                  name: a.title,
                  vehicleId: a.vehicleId,
                  technicianId: a.technicianId,
                  notes: a.notes || "",
                  equipmentId: a.equipmentId || "",
                };
              }),
            ],
            selectedAppointmentId
          )
        )}
      </div>`;
    return {
      title: row ? row.number : "Nieuwe werkbon",
      actions: row
        ? `${
            ctx.invoices.find((invoice) => invoice.workOrderId === row.id)
              ? `<a class="btn secondary" href="#/facturen/${ctx.invoices.find((invoice) => invoice.workOrderId === row.id).id}">Open factuur</a>`
              : `<button class="btn secondary" data-invoice="${row.id}">Maak factuur</button>`
          }
           <button class="btn danger" data-delete="workOrders:${row.id}">Verwijderen</button>`
        : "",
      html: `<form class="panel grid" data-save="workOrder">
        ${anprPicker}
        <input type="hidden" name="id" value="${h(row?.id || "")}">
        <div class="grid grid-2">
          ${field(
            "Klant",
            searchSelect(
              "customerId",
              customerChoiceOptions(ctx),
              row?.customerId || selectedMatch?.vehicle?.customerId,
              "required"
            )
          )}
          ${field(
            "Voertuig",
            searchSelect(
              "vehicleId",
              vehicleChoiceOptions(ctx, { empty: false }),
              row?.vehicleId || selectedMatch?.vehicle?.id,
              "required"
            )
          )}
        </div>
        <div class="grid grid-2">
          ${field(
            "Apparatuur / werkstation",
            select(
              "equipmentId",
              [
                {
                  value: "",
                  label: ctx.equipment.length ? "Kies apparatuur" : "Eerst apparatuur toevoegen",
                },
                ...equipmentSelectOptions(ctx),
              ],
              row?.equipmentId || selectedMatch?.appointment?.equipmentId,
              ctx.equipment.length ? "required" : ""
            )
          )}
          ${field(
            "Monteur",
            select(
              "technicianId",
              [
                {
                  value: "",
                  label: ctx.technicians.length ? "Kies monteur" : "Eerst monteur toevoegen",
                },
                ...ctx.technicians.map((t) => ({ value: t.id, label: t.name })),
              ],
              row?.technicianId || selectedMatch?.appointment?.technicianId,
              ctx.technicians.length ? "required" : ""
            )
          )}
        </div>
        <div class="grid grid-2">
          ${field(
            "Status",
            select(
              "status",
              WORK_STATUSES.map((s) => ({ value: s.id, label: s.label })),
              row?.status || (selectedRead ? "in_uitvoering" : "gepland")
            )
          )}
          ${field("Km bij binnenkomst", input("mileageIn", row?.mileageIn ?? "", 'type="number"'))}
        </div>
        ${field("Klacht / opdracht", area("complaint", row?.complaint || selectedMatch?.appointment?.title || ""))}
        ${field("Diagnose / werk uitgevoerd", area("diagnosis", row?.diagnosis || selectedMatch?.appointment?.notes || ""))}
        <div class="row"><button class="btn accent" type="submit">Opslaan</button></div>
      </form>
      ${
        row
          ? `<div class="panel" style="margin-top:16px">
        <div class="topbar"><div><h3>Regels</h3></div></div>
        <form class="row" data-save="workOrderLine">
          <input type="hidden" name="workOrderId" value="${row.id}">
          ${field(
            "Type",
            select("type", [
              { value: "arbeid", label: "Arbeid" },
              { value: "onderdeel", label: "Onderdeel" },
            ])
          )}
          ${field("Omschrijving", input("description", "", "required"))}
          ${field(
            "Onderdeel",
            select("partId", [
              { value: "", label: "—" },
              ...ctx.parts.map((p) => ({
                value: p.id,
                label: `${p.sku} ${p.name}`,
                price: p.unitPrice,
                name: p.name,
              })),
            ])
          )}
          ${field("Aantal / uren", input("qty", "1", 'type="number" step="0.25" required'))}
          ${field("Prijs", input("unitPrice", ctx.garage.hourlyRate, 'type="number" step="0.01" required'))}
          <button class="btn" type="submit">Regel toevoegen</button>
        </form>
        ${
          lines.length
            ? `<table><thead><tr>${ths(
                "wo-lines",
                [
                  { key: "type", label: "Type" },
                  { key: "description", label: "Omschrijving" },
                  { key: "qty", label: "Aantal", cls: "right" },
                  { key: "price", label: "Prijs", cls: "right" },
                  { key: "total", label: "Totaal", cls: "right" },
                ],
                "type"
              )}<th></th></tr></thead><tbody>
          ${sorted(
            "wo-lines",
            lines,
            {
              type: (l) => l.type,
              description: (l) => l.description,
              qty: (l) => Number(l.qty),
              price: (l) => Number(l.unitPrice),
              total: (l) => Number(l.qty) * Number(l.unitPrice),
            },
            "type"
          )
            .map(
              (l) => `<tr>
              <td>${h(l.type)}</td>
              <td>${h(l.description)}</td>
              <td class="right">${h(l.qty)}</td>
              <td class="right">${euro.format(l.unitPrice)}</td>
              <td class="right">${euro.format(l.qty * l.unitPrice)}</td>
              <td class="right"><button class="btn danger" data-delete="workOrderLines:${l.id}">×</button></td>
            </tr>`
            )
            .join("")}</tbody></table>
            <p class="right"><strong>Excl. ${euro.format(totals.excl)}</strong><br>BTW ${ctx.garage.vatRate}% ${euro.format(totals.vat)}<br><strong>Incl. ${euro.format(totals.incl)}</strong></p>`
            : empty("Nog geen regels.")
        }
      </div>
      <div class="panel" style="margin-top:16px">
        <h3>Bestanden</h3>
        <p class="muted">Voeg rapporten toe, zoals uitlijning (PDF) of foto’s van de wagen.</p>
        <label class="btn secondary" style="cursor:pointer;margin:8px 0 16px">Bestand toevoegen
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.pdf" data-wo-file="${row.id}" hidden multiple>
        </label>
        ${
          files.length
            ? `<table><thead><tr>${ths(
                "wo-files",
                [
                  { key: "name", label: "Bestand" },
                  { key: "type", label: "Type" },
                  { key: "date", label: "Datum" },
                ],
                "date",
                "desc"
              )}<th></th></tr></thead><tbody>
          ${sorted(
            "wo-files",
            files,
            {
              name: (f) => f.name,
              type: (f) => (String(f.type).includes("pdf") ? "PDF" : "Afbeelding"),
              date: (f) => f.addedAt,
            },
            "date",
            "desc"
          )
            .map(
              (f) => `<tr>
              <td>${h(f.name)}<div class="muted">${fileSizeLabel(f.size)}</div></td>
              <td>${h(String(f.type).includes("pdf") ? "PDF" : "Afbeelding")}</td>
              <td>${dateFmt.format(f.addedAt)}</td>
              <td class="right">
                <button class="btn secondary" type="button" data-open-file="${f.id}">Openen</button>
                <button class="btn danger" data-delete="workOrderFiles:${f.id}">×</button>
              </td>
            </tr>`
            )
            .join("")}</tbody></table>`
            : empty("Nog geen bestanden.")
        }
      </div>`
          : ""
      }`,
    };
  }

  const rows = ctx.workOrders.filter((w) =>
    `${w.number} ${w.complaint} ${customerName(ctx, w.customerId)} ${vehicleName(ctx, w.vehicleId)} ${techName(ctx, w.technicianId)} ${equipmentName(ctx, w.equipmentId)}`
      .toLowerCase()
      .includes(ctx.query)
  );
  return {
    title: "Werkbonnen",
    actions: `<a class="btn accent" href="#/werkbonnen/new">Nieuwe werkbon</a>`,
    html: `<div class="panel">
      <input class="input" data-search placeholder="Zoek werkbon, klant of nummerplaat" value="${h(ctx.search)}">
      ${
        rows.length
          ? `<table><thead><tr>${ths(
              "werkbonnen",
              [
                { key: "number", label: "Nummer" },
                { key: "customer", label: "Klant / voertuig" },
                { key: "equipment", label: "Apparatuur" },
                { key: "tech", label: "Monteur" },
                { key: "status", label: "Status" },
              ],
              "created",
              "desc"
            )}</tr></thead><tbody>
        ${sorted(
          "werkbonnen",
          rows,
          {
            number: (w) => w.number,
            customer: (w) => `${customerName(ctx, w.customerId)} ${vehicleName(ctx, w.vehicleId)}`,
            equipment: (w) => equipmentName(ctx, w.equipmentId),
            tech: (w) => techName(ctx, w.technicianId),
            status: (w) => statusLabel(w.status),
            created: (w) => w.createdAt,
          },
          "created",
          "desc"
        )
          .map(
            (w) => `<tr class="clickable" data-go="#/werkbonnen/${w.id}">
            <td class="mono">${h(w.number)}</td>
            <td>${h(customerName(ctx, w.customerId))}<div class="muted">${h(vehicleName(ctx, w.vehicleId))}</div></td>
            <td>${h(equipmentName(ctx, w.equipmentId))}</td>
            <td>${h(techName(ctx, w.technicianId))}</td>
            <td><span class="badge ${w.status}">${h(statusLabel(w.status))}</span></td>
          </tr>`
          )
          .join("")}</tbody></table>`
          : empty("Nog geen werkbonnen.")
      }
    </div>`,
  };
}

export async function onderdelen(ctx, id) {
  if (id === "new" || id) {
    const row = id === "new" ? null : ctx.parts.find((p) => p.id === id);
    if (id !== "new" && !row) return { title: "Onderdeel", html: empty("Onderdeel niet gevonden.") };
    return {
      title: row ? row.name : "Nieuw onderdeel",
      actions: row ? `<button class="btn danger" data-delete="parts:${row.id}">Verwijderen</button>` : "",
      html: `<form class="panel grid" data-save="part">
        <input type="hidden" name="id" value="${h(row?.id || "")}">
        <div class="grid grid-2">
          ${field("SKU", input("sku", row?.sku, "required"))}
          ${field("Naam", input("name", row?.name, "required"))}
        </div>
        <div class="grid grid-3">
          ${field("Merk", input("brand", row?.brand))}
          ${field("Categorie", input("category", row?.category))}
          ${field("Leverancier", input("supplier", row?.supplier))}
        </div>
        <div class="grid grid-3">
          ${field("Aankoopprijs excl.", input("purchasePrice", row?.purchasePrice ?? "", 'type="number" step="0.01"'))}
          ${field("Verkoopprijs excl.", input("unitPrice", row?.unitPrice ?? "", 'type="number" step="0.01" required'))}
          ${field("Locatie", input("location", row?.location))}
        </div>
        <div class="grid grid-2">
          ${field("Voorraad", input("stock", row?.stock ?? "0", 'type="number" step="1"'))}
          ${field("Minimumvoorraad", input("minStock", row?.minStock ?? "0", 'type="number"'))}
        </div>
        <div class="row"><button class="btn accent" type="submit">Opslaan</button></div>
      </form>`,
    };
  }
  const rows = ctx.parts.filter((p) =>
    `${p.sku} ${p.name} ${p.brand} ${p.supplier || ""}`.toLowerCase().includes(ctx.query)
  );
  return {
    title: "Onderdelen",
    actions: `<label class="btn secondary" style="cursor:pointer">Excel importeren
        <input type="file" accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" data-parts-excel hidden>
      </label>
      <a class="btn accent" href="#/onderdelen/new">Nieuw onderdeel</a>`,
    html: `<div class="panel">
      <p class="muted" style="margin-top:0">Importeer een Excel- of CSV-bestand. Eerste rij bij voorkeur: SKU, Naam, Merk, Categorie, Leverancier, Aankoopprijs, Verkoopprijs, Voorraad, Minimum, Locatie. Bestaande SKU’s worden bijgewerkt.</p>
      <input class="input" data-search placeholder="Zoek SKU, naam of leverancier" value="${h(ctx.search)}">
      ${
        rows.length
          ? `<table><thead><tr>${ths(
              "onderdelen",
              [
                { key: "sku", label: "SKU" },
                { key: "name", label: "Onderdeel" },
                { key: "supplier", label: "Leverancier" },
                { key: "purchase", label: "Aankoop", cls: "right" },
                { key: "price", label: "Verkoop", cls: "right" },
                { key: "stock", label: "Voorraad", cls: "right" },
              ],
              "sku"
            )}</tr></thead><tbody>
        ${sorted(
          "onderdelen",
          rows,
          {
            sku: (p) => p.sku,
            name: (p) => p.name,
            supplier: (p) => p.supplier || "",
            purchase: (p) => Number(p.purchasePrice || 0),
            price: (p) => Number(p.unitPrice || 0),
            stock: (p) => Number(p.stock || 0),
          },
          "sku"
        )
          .map(
            (p) => `<tr class="clickable" data-go="#/onderdelen/${p.id}">
            <td class="mono">${h(p.sku)}</td>
            <td>${h(p.name)}<div class="muted">${h(p.brand)} · ${h(p.location)}</div></td>
            <td>${h(p.supplier || "—")}</td>
            <td class="right">${p.purchasePrice ? euro.format(p.purchasePrice) : "—"}</td>
            <td class="right">${euro.format(p.unitPrice)}</td>
            <td class="right">${p.stock <= p.minStock ? `<span class="badge low">${p.stock}</span>` : p.stock}</td>
          </tr>`
          )
          .join("")}</tbody></table>`
          : empty("Nog geen onderdelen.")
      }
    </div>`,
  };
}

export async function facturen(ctx, id) {
  if (id) {
    const row = ctx.invoices.find((i) => i.id === id);
    if (!row) return { title: "Factuur", html: empty("Factuur niet gevonden.") };
    const wo = ctx.workOrders.find((w) => w.id === row.workOrderId);
    const customer = ctx.customers.find((c) => c.id === row.customerId);
    const lines = ctx.lines.filter((l) => l.workOrderId === row.workOrderId);
    const totals = lineTotals(lines, ctx.garage.vatRate);
    const sentViaLabel = { print: "afgedrukt", email: "per e-mail", peppol: "via Peppol" }[row.sentVia];
    return {
      title: row.number,
      actions:
        row.status === "betaald"
          ? `<button class="btn secondary no-print" type="button" data-invoice-pdf="${row.id}">PDF</button>`
          : `<button class="btn accent no-print" data-paid="${row.id}">Markeer als betaald</button>`,
      html: `
      <div class="panel send-choice no-print">
        <h3>${row.status === "concept" ? "Factuur is nog niet verstuurd" : "Opnieuw versturen"}</h3>
        <p class="muted">${
          row.status === "concept"
            ? "Kies hoe je deze factuur naar de klant wilt sturen. Tot dan blijft ze een concept."
            : sentViaLabel
              ? `Deze factuur is ${sentViaLabel}. Je kunt ze opnieuw versturen.`
              : "Kies een verzendwijze."
        }</p>
        <div class="row">
          <button class="btn accent" type="button" data-invoice-print="${row.id}">Afdrukken</button>
          <button class="btn accent" type="button" data-invoice-email="${row.id}">E-mail</button>
          <button class="btn accent" type="button" data-invoice-peppol="${row.id}">Peppol</button>
          <button class="btn secondary" type="button" data-invoice-pdf="${row.id}">PDF downloaden</button>
        </div>
      </div>
      <div class="panel invoice">
        <div class="grid grid-2">
          <div>
            <strong>${h(ctx.garage.name)}</strong><br>
            ${h(ctx.garage.address)}<br>
            ${h(ctx.garage.postalCode)} ${h(ctx.garage.city)}<br>
            BTW ${h(ctx.garage.vatNumber)}<br>
            ${h(ctx.garage.iban)}
          </div>
          <div>
            <h3 style="margin-top:0">Factuur ${h(row.number)}</h3>
            Datum: ${dateFmt.format(row.issuedAt)}<br>
            Vervaldatum: ${dateFmt.format(row.dueAt)}<br>
            Status: <span class="badge ${row.status}">${h(invoiceStatusLabel(row.status))}</span><br>
            Werkbon: ${h(wo?.number || "—")}
          </div>
        </div>
        <p><strong>Factuur aan</strong><br>${h(customer?.company || customer?.name)}<br>${h(customer?.address)} ${h(customer?.postalCode)} ${h(customer?.city)}<br>${h(customer?.vatNumber)}</p>
        <table><thead><tr>${ths(
          "factuur-regels",
          [
            { key: "description", label: "Omschrijving" },
            { key: "qty", label: "Aantal", cls: "right" },
            { key: "price", label: "Prijs", cls: "right" },
            { key: "total", label: "Totaal", cls: "right" },
          ],
          "description"
        )}</tr></thead><tbody>
          ${sorted(
            "factuur-regels",
            lines,
            {
              description: (l) => l.description,
              qty: (l) => Number(l.qty),
              price: (l) => Number(l.unitPrice),
              total: (l) => Number(l.qty) * Number(l.unitPrice),
            },
            "description"
          )
            .map(
              (l) => `<tr>
              <td>${h(l.description)}</td>
              <td class="right">${h(l.qty)}</td>
              <td class="right">${euro.format(l.unitPrice)}</td>
              <td class="right">${euro.format(l.qty * l.unitPrice)}</td>
            </tr>`
            )
            .join("")}
        </tbody></table>
        <p class="right">Excl. ${euro.format(totals.excl)}<br>BTW ${ctx.garage.vatRate}% ${euro.format(totals.vat)}<br><strong>Te betalen ${euro.format(totals.incl)}</strong></p>
        <p class="muted">Gelieve te betalen op ${h(ctx.garage.iban)} met mededeling ${h(row.number)}.</p>
      </div>`,
    };
  }

  const invoiceRows = ctx.invoices.filter((i) =>
    `${i.number} ${customerName(ctx, i.customerId)}`.toLowerCase().includes(ctx.query)
  );
  return {
    title: "Facturen",
    html: `<div class="panel">
      <input class="input" data-search placeholder="Zoek factuur of klant" value="${h(ctx.search)}">
      ${
      invoiceRows.length
        ? `<table><thead><tr>${ths(
            "facturen",
            [
              { key: "number", label: "Nummer" },
              { key: "customer", label: "Klant" },
              { key: "date", label: "Datum" },
              { key: "status", label: "Status" },
            ],
            "date",
            "desc"
          )}</tr></thead><tbody>
      ${sorted(
        "facturen",
        invoiceRows,
        {
          number: (i) => i.number,
          customer: (i) => customerName(ctx, i.customerId),
          date: (i) => i.issuedAt,
          status: (i) => invoiceStatusLabel(i.status),
        },
        "date",
        "desc"
      )
        .map((i) => {
          const lines = ctx.lines.filter((l) => l.workOrderId === i.workOrderId);
          const tot = lineTotals(lines, ctx.garage.vatRate);
          return `<tr class="clickable" data-go="#/facturen/${i.id}">
            <td class="mono">${h(i.number)}</td>
            <td>${h(customerName(ctx, i.customerId))}<div class="muted">${euro.format(tot.incl)}</div></td>
            <td>${dateFmt.format(i.issuedAt)}</td>
            <td><span class="badge ${i.status}">${h(invoiceStatusLabel(i.status))}</span></td>
          </tr>`;
        })
        .join("")}</tbody></table>`
        : empty("Nog geen facturen. Maak er een vanuit een werkbon.")
    }</div>`,
  };
}

export async function offertes(ctx, id) {
  if (id === "new" || id) {
    const row = id === "new" ? null : (ctx.quotes || []).find((q) => q.id === id);
    if (id !== "new" && !row) return { title: "Offerte", html: empty("Offerte niet gevonden.") };
    if (id === "new" && !ctx.customers.length) {
      return {
        title: "Nieuwe offerte",
        html: empty("Maak eerst een klant aan.") + `<p><a class="btn accent" href="#/klanten/new">Nieuwe klant</a></p>`,
      };
    }
    const lines = row ? (ctx.quoteLines || []).filter((l) => l.quoteId === row.id) : [];
    const totals = lineTotals(lines, ctx.garage.vatRate);
    const validDefault = todayIso(new Date(Date.now() + 14 * 86400000));
    return {
      title: row ? row.number : "Nieuwe offerte",
      subtitle: row ? quoteStatusLabel(row.status) : "Concept — nog niet verstuurd",
      actions: row
        ? `${
            row.workOrderId
              ? `<a class="btn secondary" href="#/werkbonnen/${row.workOrderId}">Open werkbon</a>`
              : `<button class="btn secondary" type="button" data-quote-workorder="${row.id}">Maak werkbon</button>`
          }
           <button class="btn danger" data-delete="quotes:${row.id}">Verwijderen</button>`
        : "",
      html: `
      ${
        row
          ? `<div class="panel send-choice no-print">
        <h3>${row.status === "concept" ? "Offerte is nog niet verstuurd" : "Opnieuw versturen of status wijzigen"}</h3>
        <p class="muted">Verstuur per e-mail of sms. Afdrukken en PDF blijven beschikbaar. Aanvaarden maakt er later een werkbon van.</p>
        <div class="row">
          <button class="btn accent" type="button" data-quote-email="${row.id}">Verstuur per e-mail</button>
          <button class="btn accent" type="button" data-quote-sms="${row.id}">Verstuur per sms</button>
          <button class="btn secondary" type="button" data-quote-print="${row.id}">Afdrukken</button>
          <button class="btn secondary" type="button" data-quote-pdf="${row.id}">PDF downloaden</button>
          ${row.status !== "aanvaard" ? `<button class="btn secondary" type="button" data-quote-status="${row.id}:aanvaard">Markeer als aanvaard</button>` : ""}
          ${row.status !== "geweigerd" ? `<button class="btn secondary" type="button" data-quote-status="${row.id}:geweigerd">Geweigerd</button>` : ""}
        </div>
      </div>`
          : ""
      }
      <form class="panel grid" data-save="quote">
        <input type="hidden" name="id" value="${h(row?.id || "")}">
        <div class="grid grid-2">
          ${field("Klant", searchSelect("customerId", customerChoiceOptions(ctx), row?.customerId, "required"))}
          ${field("Voertuig", searchSelect("vehicleId", vehicleChoiceOptions(ctx), row?.vehicleId))}
        </div>
        ${field("Titel / werkzaamheden", input("title", row?.title, "required"))}
        <div class="grid grid-2">
          ${field("Geldig tot", input("validUntil", row?.validUntil ? todayIso(new Date(row.validUntil)) : validDefault, 'type="date"'))}
          ${field(
            "Status",
            select("status", QUOTE_STATUSES.map((s) => ({ value: s.id, label: s.label })), row?.status || "concept")
          )}
        </div>
        ${field("Opmerkingen", area("notes", row?.notes))}
        <div class="row"><button class="btn accent" type="submit">Opslaan</button></div>
      </form>
      ${
        row
          ? `<div class="panel" style="margin-top:16px">
        <h3>Regels</h3>
        <form class="row" data-save="quoteLine">
          <input type="hidden" name="quoteId" value="${row.id}">
          ${field(
            "Type",
            select("type", [
              { value: "arbeid", label: "Arbeid" },
              { value: "onderdeel", label: "Onderdeel" },
            ])
          )}
          ${field("Omschrijving", input("description", "", "required"))}
          ${field(
            "Onderdeel",
            select("partId", [
              { value: "", label: "—" },
              ...ctx.parts.map((p) => ({
                value: p.id,
                label: `${p.sku} ${p.name}`,
                price: p.unitPrice,
                name: p.name,
              })),
            ])
          )}
          ${field("Aantal / uren", input("qty", "1", 'type="number" step="0.25" required'))}
          ${field("Prijs", input("unitPrice", ctx.garage.hourlyRate, 'type="number" step="0.01" required'))}
          <button class="btn" type="submit">Regel toevoegen</button>
        </form>
        ${
          lines.length
            ? `<table><thead><tr>${ths(
                "quote-lines",
                [
                  { key: "type", label: "Type" },
                  { key: "description", label: "Omschrijving" },
                  { key: "qty", label: "Aantal", cls: "right" },
                  { key: "price", label: "Prijs", cls: "right" },
                  { key: "total", label: "Totaal", cls: "right" },
                ],
                "type"
              )}<th></th></tr></thead><tbody>
          ${sorted(
            "quote-lines",
            lines,
            {
              type: (l) => l.type,
              description: (l) => l.description,
              qty: (l) => Number(l.qty),
              price: (l) => Number(l.unitPrice),
              total: (l) => Number(l.qty) * Number(l.unitPrice),
            },
            "type"
          )
            .map(
              (l) => `<tr>
              <td>${h(l.type)}</td>
              <td>${h(l.description)}</td>
              <td class="right">${h(l.qty)}</td>
              <td class="right">${euro.format(l.unitPrice)}</td>
              <td class="right">${euro.format(l.qty * l.unitPrice)}</td>
              <td class="right"><button class="btn danger" data-delete="quoteLines:${l.id}">×</button></td>
            </tr>`
            )
            .join("")}</tbody></table>
            <p class="right"><strong>Excl. ${euro.format(totals.excl)}</strong><br>BTW ${ctx.garage.vatRate}% ${euro.format(totals.vat)}<br><strong>Incl. ${euro.format(totals.incl)}</strong></p>`
            : empty("Nog geen regels.")
        }
      </div>`
          : ""
      }`,
    };
  }

  const rows = (ctx.quotes || []).filter((q) =>
    `${q.number} ${q.title} ${customerName(ctx, q.customerId)}`.toLowerCase().includes(ctx.query)
  );
  return {
    title: "Offertes",
    subtitle: "Offertes voor herstellingen en onderdelen",
    actions: `<a class="btn accent" href="#/offertes/new">Nieuwe offerte</a>`,
    html: `<div class="panel">
      <input class="input" data-search placeholder="Zoek offerte, klant of nummer" value="${h(ctx.search)}">
      ${quoteRows(ctx, rows)}
    </div>`,
  };
}

const PLAN_HOUR_START = 7;
const PLAN_HOUR_END = 19;
const PLAN_SLOT_PX = 48;
const PLAN_WEEK_KEY = "werkplaats-plan-week";

export function mondayNow() {
  return mondayOf();
}

export function planningMonday() {
  const stored = Number(localStorage.getItem(PLAN_WEEK_KEY));
  return stored ? mondayOf(stored) : mondayOf();
}

export function setPlanningMonday(ms) {
  localStorage.setItem(PLAN_WEEK_KEY, String(mondayOf(ms)));
}

function weekHref(ms) {
  return `#/planning/w/${isoDate(mondayOf(ms))}`;
}

export function movePlanningWeek(step) {
  const monday = step === "today" ? mondayNow() : addDays(planningMonday(), step === "prev" ? -7 : 7);
  setPlanningMonday(monday);
  return weekHref(monday);
}

function openWorkOrderForAppointment(ctx, appointment) {
  if (!appointment?.workOrderId) return null;
  const wo = ctx.workOrders.find((w) => w.id === appointment.workOrderId);
  if (!wo || wo.status === "gefactureerd") return null;
  return wo;
}

function jobForm(ctx, row, startMs) {
  const start = row?.start || startMs || Date.now();
  const end = row?.end || start + 3600000;
  return `<form class="panel grid" data-save="appointment">
        <input type="hidden" name="id" value="${h(row?.id || "")}">
        ${field("Job / titel", input("title", row?.title, "required"))}
        <div class="grid grid-2">
          ${field("Klant", searchSelect("customerId", customerChoiceOptions(ctx), row?.customerId, "required"))}
          ${field("Voertuig", searchSelect("vehicleId", vehicleChoiceOptions(ctx), row?.vehicleId))}
        </div>
        <div class="grid grid-3">
          ${field("Start", `<input class="input" type="datetime-local" name="start" value="${toDatetimeLocal(start)}" required>`)}
          ${field("Einde", `<input class="input" type="datetime-local" name="end" value="${toDatetimeLocal(end)}" required>`)}
          ${field(
            "Monteur",
            select("technicianId", [
              { value: "", label: "—" },
              ...ctx.technicians.map((t) => ({ value: t.id, label: t.name })),
            ], row?.technicianId)
          )}
        </div>
        ${field("Notities", area("notes", row?.notes))}
        <div class="row">
          <button class="btn accent" type="submit">Opslaan</button>
          ${
            row
              ? openWorkOrderForAppointment(ctx, row)
                ? `<a class="btn secondary" href="#/werkbonnen/${row.workOrderId}">Open werkbon</a>`
                : `<button class="btn accent" type="button" data-workorder="${row.id}">Maak werkbon</button>`
              : ""
          }
          <a class="btn secondary" href="${weekHref(planningMonday())}">Terug naar kalender</a>
        </div>
      </form>`;
}

export async function planning(ctx, id, extra) {
  if (id === "w") {
    const parsed = parseIsoDate(extra);
    if (!Number.isNaN(parsed)) setPlanningMonday(parsed);
    id = "";
  }
  if (id === "new" || (id && id !== "new")) {
    const row = id === "new" ? null : ctx.appointments.find((a) => a.id === id);
    if (id !== "new" && !row) return { title: "Job", html: empty("Job niet gevonden.") };
    let startMs = Date.now();
    if (id === "new" && extra) {
      const parsed = Date.parse(decodeURIComponent(extra));
      if (!Number.isNaN(parsed)) startMs = parsed;
    }
    return {
      title: row ? row.title : "Nieuwe job",
      subtitle: "Planning",
      actions: row
        ? `${
            openWorkOrderForAppointment(ctx, row)
              ? `<a class="btn secondary" href="#/werkbonnen/${row.workOrderId}">Open werkbon</a>`
              : `<button class="btn accent" type="button" data-workorder="${row.id}">Maak werkbon</button>`
          }<button class="btn danger" data-delete="appointments:${row.id}">Verwijderen</button>`
        : "",
      html: jobForm(ctx, row, startMs),
    };
  }

  const monday = planningMonday();
  const weekEnd = addDays(monday, 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const dayNames = ["ma", "di", "wo", "do", "vr", "za", "zo"];
  const dayHeadFmt = new Intl.DateTimeFormat("nl-BE", { day: "numeric", month: "short" });
  const hours = Array.from({ length: PLAN_HOUR_END - PLAN_HOUR_START }, (_, i) => PLAN_HOUR_START + i);
  const height = (PLAN_HOUR_END - PLAN_HOUR_START) * PLAN_SLOT_PX;
  const jobs = ctx.appointments.filter((a) => a.start < weekEnd && a.end > monday);
  const weekLabel = `${dateFmt.format(monday)} – ${dateFmt.format(addDays(monday, 6))}`;
  const today = startOfDay();
  return {
    title: "Planning",
    subtitle: weekLabel,
    actions: `<div class="row">
      <button class="btn secondary" type="button" data-week-nav="today">Vandaag</button>
      <a class="btn accent" href="#/planning/new">Nieuwe job</a>
    </div>`,
    html: `<div class="panel cal-wrap">
      <div class="cal-weekbar">
        <button class="btn secondary cal-arrow" type="button" data-week-nav="prev" aria-label="Vorige week">←</button>
        <strong>${h(weekLabel)}</strong>
        <button class="btn secondary cal-arrow" type="button" data-week-nav="next" aria-label="Volgende week">→</button>
      </div>
      <div class="cal">
        <div class="cal-corner"></div>
        ${days
          .map((day, i) => {
            const isToday = day === today;
            return `<div class="cal-head ${isToday ? "today" : ""}">${dayNames[i]}<div>${h(dayHeadFmt.format(day))}</div></div>`;
          })
          .join("")}
        <div class="cal-hours" style="height:${height}px">
          ${hours.map((hour) => `<div class="cal-hour" style="height:${PLAN_SLOT_PX}px">${String(hour).padStart(2, "0")}:00</div>`).join("")}
        </div>
        ${days
          .map((day) => {
            const dayJobs = jobs.filter((a) => a.start < addDays(day, 1) && a.end > day);
            return `<div class="cal-day ${day === today ? "today" : ""}" data-plan-day="${day}" style="height:${height}px">
              ${hours.map(() => `<div class="cal-line" style="height:${PLAN_SLOT_PX}px"></div>`).join("")}
              ${dayJobs
                .map((a) => {
                  const topMin = (Math.max(a.start, day) - day) / 60000;
                  const bottomMin = (Math.min(a.end, addDays(day, 1)) - day) / 60000;
                  const top = ((topMin - PLAN_HOUR_START * 60) / 60) * PLAN_SLOT_PX;
                  const hgt = Math.max(56, ((bottomMin - topMin) / 60) * PLAN_SLOT_PX);
                  const wo = openWorkOrderForAppointment(ctx, a);
                  return `<div class="cal-job" style="top:${top}px;height:${hgt}px">
                    <button type="button" class="cal-job-open" data-go="#/planning/${a.id}">
                      <strong>${h(timeFmt.format(a.start))} ${h(a.title)}</strong>
                      <span>${h(customerName(ctx, a.customerId))}</span>
                      <span class="muted">${h(techName(ctx, a.technicianId))}</span>
                    </button>
                    ${
                      wo
                        ? `<a class="cal-job-action" href="#/werkbonnen/${wo.id}">Open werkbon</a>`
                        : `<button type="button" class="cal-job-action" data-workorder="${a.id}">Maak werkbon</button>`
                    }
                  </div>`;
                })
                .join("")}
            </div>`;
          })
          .join("")}
      </div>
    </div>`,
  };
}

export async function afspraken(ctx, id, extra) {
  return planning(ctx, id, extra);
}

function anprMatchHtml(ctx, match) {
  if (match.kind === "unknown") {
    return `<span class="badge unknown">Onbekende wagen</span><div class="muted">Geen voertuig met dit kenteken in de garage.</div>`;
  }
  const vehicle = `${match.vehicle.licensePlate} · ${match.vehicle.brand} ${match.vehicle.model}`;
  const customer = customerName(ctx, match.vehicle.customerId);
  if (match.kind === "no_order") {
    return `<span class="badge unknown">Geen opdracht</span>
      <div>${h(vehicle)}</div>
      <div class="muted">${h(customer)} — geen open werkbon of planningjob.</div>`;
  }
  const wo = match.workOrder
    ? `${match.workOrder.number} · ${statusLabel(match.workOrder.status)}`
    : null;
  const appt = (match.appointments || [])
    .map((a) => `${timeFmt.format(a.start)} ${a.title}`)
    .join(" · ") || (match.appointment ? `${timeFmt.format(match.appointment.start)} ${match.appointment.title}` : null);
  return `<span class="badge booked">Geboekt</span>
    <div>${h(vehicle)}</div>
    <div class="muted">${h(customer)}${wo ? ` · ${h(wo)}` : ""}${appt ? ` · ${h(appt)}` : ""}</div>`;
}

export async function inrit(ctx) {
  const since = Date.now() - ANPR_WINDOW_MS;
  const recent = [...(ctx.cameraReads || [])].sort((a, b) => b.readAt - a.readAt);
  const windowReads = recent.filter((row) => row.readAt >= since);
  const queue = windowReads.filter((row) => !row.matchedWorkOrderId);
  const plateOptions = ctx.vehicles
    .map((v) => `<option value="${h(v.licensePlate)}">${h(v.brand)} ${h(v.model)} · ${h(customerName(ctx, v.customerId))}</option>`)
    .join("");

  return {
    title: "ANPR / Poort",
    subtitle: "Kentekens die de camera aan de inrit heeft gelezen",
    html: `
      <div class="grid grid-2 anpr-layout">
        <div class="panel">
          <h3>Camera (receptie / demo)</h3>
          <p class="muted">Er is geen fysieke camera gekoppeld. Simuleer een uitlezing, of plak een kenteken in de live-feed alsof de camera het doorstuurt. Een echte ANPR-camera kan later dezelfde lokale lijst vullen (push/POST naar <code>cameraReads</code> of <code>window.werkplaatsAnprIngest(plaat)</code>).</p>
          <form class="grid" data-save="cameraRead" style="margin-top:12px">
            ${field(
              "Kenteken",
              `${input("plate", "", 'required list="anpr-plates" placeholder="Typ of kies een nummerplaat" autocomplete="off"')}
               <datalist id="anpr-plates">${plateOptions}</datalist>`
            )}
            ${field("Camera", input("cameraName", "Poort inrit"))}
            <div class="row"><button class="btn accent" type="submit">Camera ziet wagen</button></div>
          </form>
          <div class="field" style="margin-top:16px">
            <label>Live camerafeed</label>
            <input class="input mono" data-anpr-live placeholder="Kenteken zoals de camera het pusht — Enter om te registreren" autocomplete="off">
          </div>
          <h3 style="margin-top:24px">Laatste uitlezingen</h3>
          ${
            recent.length
              ? `<table><thead><tr>${ths(
                  "anpr",
                  [
                    { key: "time", label: "Tijd" },
                    { key: "plate", label: "Plaat" },
                    { key: "camera", label: "Camera" },
                    { key: "match", label: "Match" },
                  ],
                  "time",
                  "desc"
                )}</tr></thead><tbody>
            ${sorted(
              "anpr",
              recent,
              {
                time: (row) => row.readAt,
                plate: (row) => row.plate,
                camera: (row) => row.cameraName,
                match: (row) => matchAnpr(ctx, row.plate).kind,
              },
              "time",
              "desc"
            )
              .slice(0, 40)
              .map((row) => {
                const match = matchAnpr(ctx, row.plate);
                return `<tr class="${match.kind === "booked" ? "anpr-booked-row" : ""}">
                  <td>${dateTimeFmt.format(row.readAt)}</td>
                  <td class="mono">${h(row.plate)}</td>
                  <td>${h(row.cameraName)}</td>
                  <td>${anprMatchHtml(ctx, match)}${row.matchedWorkOrderId ? `<div class="muted">Geclaimd</div>` : ""}</td>
                </tr>`;
              })
              .join("")}</tbody></table>`
              : empty("Nog geen camera-uitlezingen.")
          }
        </div>
        <div class="panel">
          <h3>Monteur — kies een gelezen plaat</h3>
          <p class="muted">Alleen kentekens die de camera de laatste 12 uur heeft gezien. Niet de volledige voertuiglijst.</p>
          ${
            queue.length
              ? `<div class="anpr-queue">${queue
                  .map((row) => {
                    const match = matchAnpr(ctx, row.plate);
                    const canOpen = Boolean(match.vehicle);
                    return `<article class="anpr-card ${match.kind}">
                      <div class="anpr-card-head">
                        <strong class="mono">${h(row.plate)}</strong>
                        <span class="muted">${timeFmt.format(row.readAt)} · ${h(row.cameraName)}</span>
                      </div>
                      ${anprMatchHtml(ctx, match)}
                      ${
                        canOpen
                          ? `<div class="row" style="margin-top:12px"><button class="btn accent" type="button" data-anpr-claim="${row.id}">${match.workOrder ? "Open werkbon" : "Maak werkbon"}</button></div>`
                          : `<p class="muted" style="margin:12px 0 0">Geen werkbon te openen tot receptie een opdracht aanmaakt.</p>`
                      }
                    </article>`;
                  })
                  .join("")}</div>`
              : empty("Geen openstaande uitlezingen in de laatste 12 uur.")
          }
        </div>
      </div>`,
  };
}

export async function apparatuur(ctx, id) {
  if (id === "new" || id) {
    const row = id === "new" ? null : ctx.equipment.find((e) => e.id === id);
    if (id !== "new" && !row) return { title: "Apparatuur", html: empty("Niet gevonden.") };
    return {
      title: row ? `${row.brand} ${row.model}` : "Nieuwe apparatuur",
      actions: row ? `<button class="btn danger" data-delete="equipment:${row.id}">Verwijderen</button>` : "",
      html: `<form class="panel grid" data-save="equipment">
        <input type="hidden" name="id" value="${h(row?.id || "")}">
        ${field(
          "Type",
          select(
            "type",
            EQUIPMENT_TYPES.map((t) => ({ value: t.id, label: t.label })),
            row?.type
          )
        )}
        <div class="grid grid-3">
          ${field("Merk", input("brand", row?.brand, "required"))}
          ${field("Model", input("model", row?.model, "required"))}
          ${field("Serienummer", input("serial", row?.serial))}
        </div>
        ${field("Werkstationnummer", input("workstationNumber", row?.workstationNumber, "required"))}
        <div class="grid grid-2">
          ${field("Geïnstalleerd", input("installedAt", row?.installedAt || todayIso(), 'type="date"'))}
          ${field("Volgende keuring", input("nextInspectionAt", row?.nextInspectionAt || "", 'type="date"'))}
        </div>
        ${field("Notities", area("notes", row?.notes))}
        <div class="row"><button class="btn accent" type="submit">Opslaan</button></div>
      </form>`,
    };
  }
  return {
    title: "Werkplaatsapparatuur",
    subtitle: "Hefbruggen, bandenmachines en keuringen",
    actions: `<a class="btn accent" href="#/apparatuur/new">Toevoegen</a>`,
    html: `<div class="panel">${
      ctx.equipment.length
        ? `<table><thead><tr>${ths(
            "apparatuur",
            [
              { key: "ws", label: "Werkstation" },
              { key: "type", label: "Type" },
              { key: "machine", label: "Machine" },
              { key: "serial", label: "Serie" },
              { key: "inspection", label: "Keuring" },
            ],
            "ws"
          )}</tr></thead><tbody>
      ${sorted(
        "apparatuur",
        ctx.equipment,
        {
          ws: (e) => e.workstationNumber || "",
          type: (e) => equipmentLabel(e.type),
          machine: (e) => `${e.brand} ${e.model}`,
          serial: (e) => e.serial || "",
          inspection: (e) => e.nextInspectionAt || "",
        },
        "ws"
      )
        .map((e) => {
          const dueSoon = e.nextInspectionAt && new Date(e.nextInspectionAt).getTime() < Date.now() + 45 * 86400000;
          return `<tr class="clickable" data-go="#/apparatuur/${e.id}">
            <td class="mono">${h(e.workstationNumber || "—")}</td>
            <td>${h(equipmentLabel(e.type))}</td>
            <td>${h(e.brand)} ${h(e.model)}</td>
            <td class="mono">${h(e.serial)}</td>
            <td>${dueSoon ? `<span class="badge low">${h(e.nextInspectionAt)}</span>` : h(e.nextInspectionAt)}</td>
          </tr>`;
        })
        .join("")}</tbody></table>`
        : empty("Nog geen apparatuur geregistreerd.")
    }</div>`,
  };
}

export async function instellingen(ctx) {
  const g = ctx.garage;
  return {
    title: "Instellingen",
    subtitle: "Garagegegevens, tarieven en monteurs",
    html: `<form class="panel grid" data-save="garage">
      ${field("Garagenaam", input("name", g.name, "required"))}
      <div class="grid grid-2">
        ${field("BTW-nummer", input("vatNumber", g.vatNumber))}
        ${field("IBAN", input("iban", g.iban))}
      </div>
      <div class="grid grid-3">
        ${field("Adres", input("address", g.address))}
        ${field("Postcode", input("postalCode", g.postalCode))}
        ${field("Gemeente", input("city", g.city))}
      </div>
      <div class="grid grid-2">
        ${field("Telefoon", input("phone", g.phone))}
        ${field("E-mail", input("email", g.email, 'type="email"'))}
      </div>
      <div class="grid grid-3">
        ${field("BTW-tarief %", input("vatRate", g.vatRate, 'type="number" step="0.01"'))}
        ${field("Uurtarief excl.", input("hourlyRate", g.hourlyRate, 'type="number" step="0.01"'))}
        ${field("Betaaltermijn (dagen)", input("paymentDays", g.paymentDays, 'type="number"'))}
      </div>
      ${field("Peppol-ID (bv. 0208:0123456789 of leeg = afgeleid van BTW-nummer)", input("peppolId", g.peppolId))}
      <p class="muted">Peppol-verzending gebeurt via jouw access point. Werkplaats maakt het UBL-bestand; upload dat bij Billit, Exact of je boekhouder.</p>
      <div class="row"><button class="btn accent" type="submit">Garage opslaan</button></div>
    </form>
    <div class="panel" style="margin-top:16px">
      <h3>Monteurs</h3>
      <form class="row" data-save="technician">
        ${field("Naam", input("name", "", "required"))}
        <button class="btn" type="submit">Toevoegen</button>
      </form>
      ${
        ctx.technicians.length
          ? `<table><thead><tr>${ths("monteurs", [{ key: "name", label: "Naam" }], "name")}<th></th></tr></thead><tbody>${sorted(
              "monteurs",
              ctx.technicians,
              { name: (t) => t.name },
              "name"
            )
              .map(
                (t) =>
                  `<tr><td>${h(t.name)}</td><td class="right"><button class="btn danger" data-delete="technicians:${t.id}">Verwijderen</button></td></tr>`
              )
              .join("")}</tbody></table>`
          : empty("Nog geen monteurs.")
      }
    </div>
    <div class="panel" style="margin-top:16px">
      <h3>Backup</h3>
      <p class="muted">Download alle gegevens als JSON, of herstel een backup. Herstellen vervangt de huidige lokale data.</p>
      <div class="row">
        <button class="btn secondary" type="button" data-backup>Backup downloaden</button>
        <label class="btn secondary" style="cursor:pointer">Backup herstellen<input type="file" accept="application/json" data-restore hidden></label>
      </div>
    </div>`,
  };
}

export async function handleSave(type, data, ctx) {
  const garageId = ctx.garage?.id;
  if (type === "cameraRead") {
    await ingestCameraRead(garageId, data.plate, data.cameraName);
    return "#/inrit";
  }
  if (type === "customer") {
    const id = data.id || uid();
    const prevCustomer = data.id ? await db.get("customers", data.id) : null;
    await db.put("customers", {
      id,
      garageId,
      name: data.name,
      company: data.company || "",
      phone: data.phone || "",
      phone2: data.phone2 || "",
      phone3: data.phone3 || "",
      email: data.email || "",
      address: data.address || "",
      postalCode: data.postalCode || "",
      city: data.city || "",
      vatNumber: data.vatNumber || "",
      peppolId: data.peppolId || "",
      notes: data.notes || "",
      createdAt: prevCustomer?.createdAt || Date.now(),
    });
    return `#/klanten/${id}`;
  }
  if (type === "vehicle") {
    const id = data.id || uid();
    await db.put("vehicles", {
      id,
      garageId,
      customerId: data.customerId,
      licensePlate: data.licensePlate.toUpperCase(),
      brand: data.brand,
      model: data.model,
      year: Number(data.year || 0),
      vin: data.vin || "",
      fuel: data.fuel,
      mileage: Number(data.mileage || 0),
    });
    return `#/voertuigen/${id}`;
  }
  if (type === "workOrder") {
    const id = data.id || uid();
    const prev = data.id ? await db.get("workOrders", data.id) : null;
    await db.put("workOrders", {
      ...(prev || {}),
      id,
      garageId,
      number: prev?.number || (await nextDocNumber(garageId, "workOrders", "WB")),
      customerId: data.customerId,
      vehicleId: data.vehicleId,
      technicianId: data.technicianId || null,
      equipmentId: data.equipmentId || null,
      status: data.status,
      complaint: data.complaint || "",
      diagnosis: data.diagnosis || "",
      mileageIn: Number(data.mileageIn || 0),
      createdAt: prev?.createdAt || Date.now(),
      completedAt: data.status === "klaar" || data.status === "gefactureerd" ? Date.now() : null,
    });
    if (data.mileageIn) {
      const vehicle = await db.get("vehicles", data.vehicleId);
      if (vehicle) await db.put("vehicles", { ...vehicle, mileage: Number(data.mileageIn) });
    }
    if (data.cameraReadId) {
      const read = await db.get("cameraReads", data.cameraReadId);
      if (read) await db.put("cameraReads", { ...read, matchedWorkOrderId: id });
    }
    if (data.appointmentId) {
      const appointment = await db.get("appointments", data.appointmentId);
      if (appointment) await db.put("appointments", { ...appointment, workOrderId: id });
    }
    return `#/werkbonnen/${id}`;
  }
  if (type === "workOrderLine") {
    let description = data.description;
    let unitPrice = Number(data.unitPrice);
    let partId = data.partId || null;
    if (partId) {
      const part = await db.get("parts", partId);
      if (part) {
        description = description || part.name;
        unitPrice = unitPrice || part.unitPrice;
        part.stock = Number(part.stock) - Number(data.qty);
        await db.put("parts", part);
      }
    }
    await db.put("workOrderLines", {
      id: uid(),
      garageId,
      workOrderId: data.workOrderId,
      type: data.type,
      description,
      partId,
      qty: Number(data.qty),
      unitPrice,
    });
    return `#/werkbonnen/${data.workOrderId}`;
  }
  if (type === "part") {
    const id = data.id || uid();
    const prev = data.id ? await db.get("parts", data.id) : null;
    await db.put("parts", {
      ...(prev || {}),
      id,
      garageId,
      sku: data.sku,
      name: data.name,
      brand: data.brand || "",
      category: data.category || "",
      supplier: data.supplier || "",
      purchasePrice: Number(data.purchasePrice || 0),
      unitPrice: Number(data.unitPrice),
      stock: Number(data.stock || 0),
      minStock: Number(data.minStock || 0),
      location: data.location || "",
    });
    return `#/onderdelen/${id}`;
  }
  if (type === "quote") {
    const id = data.id || uid();
    const prev = data.id ? await db.get("quotes", data.id) : null;
    await db.put("quotes", {
      id,
      garageId,
      number: prev?.number || (await nextDocNumber(garageId, "quotes", "OF")),
      customerId: data.customerId,
      vehicleId: data.vehicleId || null,
      title: data.title,
      notes: data.notes || "",
      status: data.status || prev?.status || "concept",
      validUntil: data.validUntil ? new Date(data.validUntil).getTime() : Date.now() + 14 * 86400000,
      workOrderId: prev?.workOrderId || null,
      sentVia: prev?.sentVia || null,
      createdAt: prev?.createdAt || Date.now(),
    });
    return `#/offertes/${id}`;
  }
  if (type === "quoteLine") {
    let description = data.description;
    let unitPrice = Number(data.unitPrice);
    let partId = data.partId || null;
    if (partId) {
      const part = await db.get("parts", partId);
      if (part) {
        description = description || part.name;
        unitPrice = unitPrice || part.unitPrice;
      }
    }
    await db.put("quoteLines", {
      id: uid(),
      garageId,
      quoteId: data.quoteId,
      type: data.type,
      description,
      partId,
      qty: Number(data.qty),
      unitPrice,
    });
    return `#/offertes/${data.quoteId}`;
  }
  if (type === "appointment") {
    const id = data.id || uid();
    const prev = data.id ? await db.get("appointments", data.id) : null;
    await db.put("appointments", {
      id,
      garageId,
      title: data.title,
      customerId: data.customerId,
      vehicleId: data.vehicleId || null,
      technicianId: data.technicianId || null,
      workOrderId: prev?.workOrderId || null,
      start: new Date(data.start).getTime(),
      end: new Date(data.end).getTime(),
      notes: data.notes || "",
    });
    return weekHref(new Date(data.start).getTime());
  }
  if (type === "equipment") {
    const id = data.id || uid();
    const prev = data.id ? await db.get("equipment", data.id) : null;
    await db.put("equipment", {
      ...(prev || {}),
      id,
      garageId,
      type: data.type,
      brand: data.brand,
      model: data.model,
      serial: data.serial || "",
      workstationNumber: String(data.workstationNumber || "").trim(),
      installedAt: data.installedAt,
      nextInspectionAt: data.nextInspectionAt,
      notes: data.notes || "",
    });
    return `#/apparatuur/${id}`;
  }
  if (type === "garage") {
    await db.put("garages", {
      ...ctx.garage,
      ...data,
      vatRate: Number(data.vatRate),
      hourlyRate: Number(data.hourlyRate),
      paymentDays: Number(data.paymentDays),
    });
    return "#/instellingen";
  }
  if (type === "technician") {
    await db.put("technicians", { id: uid(), garageId, name: data.name, active: true });
    return "#/instellingen";
  }
  return location.hash;
}

export async function handleDelete(store, id, ctx) {
  if (store === "workOrderLines") {
    const line = await db.get("workOrderLines", id);
    if (line?.partId) {
      const part = await db.get("parts", line.partId);
      if (part) {
        part.stock = Number(part.stock) + Number(line.qty);
        await db.put("parts", part);
      }
    }
    await db.remove(store, id);
    return `#/werkbonnen/${line.workOrderId}`;
  }
  if (store === "workOrders") {
    const lines = ctx.lines.filter((l) => l.workOrderId === id);
    for (const line of lines) await handleDelete("workOrderLines", line.id, ctx);
    const files = await db.byIndex("workOrderFiles", "workOrderId", id);
    for (const file of files) await db.remove("workOrderFiles", file.id);
    await db.remove(store, id);
    return "#/werkbonnen";
  }
  if (store === "workOrderFiles") {
    const file = await db.get("workOrderFiles", id);
    await db.remove(store, id);
    return `#/werkbonnen/${file?.workOrderId || ""}`;
  }
  if (store === "quoteLines") {
    const line = await db.get("quoteLines", id);
    await db.remove(store, id);
    return `#/offertes/${line.quoteId}`;
  }
  if (store === "quotes") {
    const lines = (ctx.quoteLines || []).filter((l) => l.quoteId === id);
    for (const line of lines) await db.remove("quoteLines", line.id);
    await db.remove(store, id);
    return "#/offertes";
  }
  await db.remove(store, id);
  return `#/${store === "customers" ? "klanten" : store === "vehicles" ? "voertuigen" : store === "parts" ? "onderdelen" : store === "equipment" ? "apparatuur" : store === "technicians" ? "instellingen" : store === "appointments" ? "planning" : "dashboard"}`;
}

export async function createWorkOrderFromAppointment(appointmentId, ctx, options = {}) {
  const appointment = ctx.appointments.find((a) => a.id === appointmentId);
  if (!appointment) return "#/planning";
  if (appointment.workOrderId) {
    const existing = await db.get("workOrders", appointment.workOrderId);
    if (existing && existing.status !== "gefactureerd") {
      if (options.start && existing.status === "gepland") {
        await db.put("workOrders", { ...existing, status: "in_uitvoering" });
      }
      return `#/werkbonnen/${existing.id}`;
    }
  }
  const id = uid();
  await db.put("workOrders", {
    id,
    garageId: ctx.garage.id,
    number: await nextDocNumber(ctx.garage.id, "workOrders", "WB"),
    customerId: appointment.customerId,
    vehicleId: appointment.vehicleId,
    technicianId: appointment.technicianId,
    equipmentId: appointment.equipmentId || null,
    status: options.start ? "in_uitvoering" : "gepland",
    complaint: appointment.title,
    diagnosis: appointment.notes || "",
    mileageIn: ctx.vehicles.find((v) => v.id === appointment.vehicleId)?.mileage || 0,
    createdAt: Date.now(),
    completedAt: null,
  });
  await db.put("appointments", { ...appointment, workOrderId: id });
  return `#/werkbonnen/${id}`;
}

const MAX_WO_FILE = 20 * 1024 * 1024;

export async function importPartsExcel(file, ctx) {
  const rows = await rowsFromSpreadsheet(file);
  const incoming = partsFromRows(rows);
  if (!incoming.length) {
    alert("Geen onderdelen gevonden in dit bestand. Controleer de kolomkoppen.");
    return "#/onderdelen";
  }
  const existing = new Map(ctx.parts.map((part) => [String(part.sku).toLowerCase(), part]));
  let created = 0;
  let updated = 0;
  for (const part of incoming) {
    const prev = existing.get(part.sku.toLowerCase());
    await db.put("parts", {
      ...(prev || {}),
      id: prev?.id || uid(),
      garageId: ctx.garage.id,
      sku: part.sku,
      name: part.name,
      brand: part.brand,
      category: part.category,
      supplier: part.supplier || prev?.supplier || "",
      purchasePrice: part.purchasePrice || prev?.purchasePrice || 0,
      unitPrice: part.unitPrice,
      stock: part.stock,
      minStock: part.minStock,
      location: part.location,
    });
    if (prev) updated += 1;
    else created += 1;
  }
  alert(`${incoming.length} rijen verwerkt: ${created} nieuw, ${updated} bijgewerkt.`);
  return "#/onderdelen";
}

export async function addWorkOrderFiles(workOrderId, fileList, garageId) {
  const files = [...fileList];
  for (const file of files) {
    if (file.size > MAX_WO_FILE) {
      alert(`${file.name} is groter dan 20 MB.`);
      continue;
    }
    const ok = /pdf|jpeg|jpg|png|webp/i.test(file.type) || /\.pdf$/i.test(file.name);
    if (!ok) {
      alert(`${file.name} is geen PDF of afbeelding.`);
      continue;
    }
    await db.put("workOrderFiles", {
      id: uid(),
      garageId,
      workOrderId,
      name: file.name,
      type: file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : file.type),
      size: file.size,
      addedAt: Date.now(),
      blob: file,
    });
  }
  return `#/werkbonnen/${workOrderId}`;
}

export async function openWorkOrderFile(id) {
  const file = await db.get("workOrderFiles", id);
  if (!file?.blob) return;
  const url = URL.createObjectURL(file.blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function claimCameraRead(readId, ctx) {
  const read = await db.get("cameraReads", readId);
  if (!read) return "#/inrit";
  const match = matchAnpr(ctx, read.plate);
  if (!match.vehicle) return "#/inrit";
  if (match.workOrder) {
    const wo = match.workOrder;
    if (wo.status === "gepland") {
      await db.put("workOrders", { ...wo, status: "in_uitvoering" });
    }
    await db.put("cameraReads", { ...read, matchedWorkOrderId: wo.id });
    return `#/werkbonnen/${wo.id}`;
  }
  return `#/werkbonnen/new/${read.id}`;
}

export function anprUnclaimedCount(ctx) {
  return anprQueue(ctx).length;
}

export function anprQueue(ctx) {
  const since = Date.now() - ANPR_WINDOW_MS;
  const seen = new Set();
  return [...(ctx.cameraReads || [])]
    .filter((row) => row.readAt >= since && !row.matchedWorkOrderId)
    .sort((a, b) => b.readAt - a.readAt)
    .filter((row) => {
      const key = normalizePlate(row.plate);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export async function downloadBackup() {
  const data = await exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `werkplaats-backup-${todayIso()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function restoreBackup(file) {
  const text = await file.text();
  await importAll(JSON.parse(text));
}

export async function createInvoice(workOrderId, ctx) {
  const wo = ctx.workOrders.find((w) => w.id === workOrderId);
  if (!wo) return "#/werkbonnen";
  const existing = ctx.invoices.find((i) => i.workOrderId === workOrderId);
  if (existing) return `#/facturen/${existing.id}`;
  const id = uid();
  const issuedAt = Date.now();
  await db.put("invoices", {
    id,
    garageId: ctx.garage.id,
    number: await nextDocNumber(ctx.garage.id, "invoices", "F"),
    workOrderId,
    customerId: wo.customerId,
    status: "concept",
    sentVia: null,
    issuedAt,
    dueAt: issuedAt + (ctx.garage.paymentDays || 14) * 86400000,
    paidAt: null,
  });
  await db.put("workOrders", { ...wo, status: "gefactureerd", completedAt: issuedAt });
  return `#/facturen/${id}`;
}

export async function markPaid(id) {
  const invoice = await db.get("invoices", id);
  await db.put("invoices", { ...invoice, status: "betaald", paidAt: Date.now() });
  return `#/facturen/${id}`;
}

export async function markSent(id, sentVia) {
  const invoice = await db.get("invoices", id);
  if (!invoice || invoice.status === "betaald") return `#/facturen/${id}`;
  await db.put("invoices", {
    ...invoice,
    status: "verzonden",
    sentVia,
    sentAt: Date.now(),
  });
  return `#/facturen/${id}`;
}

export async function markQuoteSent(id, sentVia) {
  const quote = await db.get("quotes", id);
  if (!quote) return `#/offertes/${id}`;
  const status = quote.status === "concept" ? "verzonden" : quote.status;
  await db.put("quotes", {
    ...quote,
    status,
    sentVia,
    sentAt: Date.now(),
  });
  return `#/offertes/${id}`;
}

export async function setQuoteStatus(id, status) {
  const quote = await db.get("quotes", id);
  if (!quote) return "#/offertes";
  await db.put("quotes", { ...quote, status });
  return `#/offertes/${id}`;
}

export async function convertQuoteToWorkOrder(quoteId, ctx) {
  const quote = ctx.quotes.find((q) => q.id === quoteId) || (await db.get("quotes", quoteId));
  if (!quote) return "#/offertes";
  if (quote.workOrderId) return `#/werkbonnen/${quote.workOrderId}`;
  const id = uid();
  await db.put("workOrders", {
    id,
    garageId: ctx.garage.id,
    number: await nextDocNumber(ctx.garage.id, "workOrders", "WB"),
    customerId: quote.customerId,
    vehicleId: quote.vehicleId,
    technicianId: null,
    equipmentId: null,
    status: "gepland",
    complaint: quote.title,
    diagnosis: quote.notes || "",
    mileageIn: ctx.vehicles.find((v) => v.id === quote.vehicleId)?.mileage || 0,
    createdAt: Date.now(),
    completedAt: null,
  });
  const lines = (ctx.quoteLines || []).filter((l) => l.quoteId === quote.id);
  for (const line of lines) {
    await db.put("workOrderLines", {
      id: uid(),
      garageId: ctx.garage.id,
      workOrderId: id,
      type: line.type,
      description: line.description,
      partId: line.partId,
      qty: line.qty,
      unitPrice: line.unitPrice,
    });
  }
  await db.put("quotes", { ...quote, status: "aanvaard", workOrderId: id });
  return `#/werkbonnen/${id}`;
}

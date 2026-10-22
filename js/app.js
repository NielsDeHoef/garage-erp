import { db } from "./db.js";
import { ensureDemoCameraReads, ensureDemoQuotes, ensureEquipmentWorkstations, ensureSingleGarage, ensureWorkOrderEquipment, seedDemo } from "./seed.js";
import { h, toDatetimeLocal } from "./format.js";
import * as pages from "./pages.js";
import {
  downloadInvoicePdf,
  downloadPeppolUbl,
  downloadQuotePdf,
  sendInvoiceEmail,
  sendQuoteEmail,
  sendQuoteSms,
} from "./invoice-export.js";

const appEl = document.getElementById("app");
let search = "";

function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/");
  const section = parts[0] || "dashboard";
  const id = parts[1];
  const extra = parts.slice(2).join("/");
  return { section: section === "afspraken" ? "planning" : section, id, extra, search };
}

async function loadCtx(garageId) {
  const [
    garages,
    customers,
    vehicles,
    technicians,
    appointments,
    parts,
    workOrders,
    lines,
    invoices,
    quotes,
    quoteLines,
    equipment,
    cameraReads,
  ] = await Promise.all([
    db.getAll("garages"),
    db.byGarage("customers", garageId),
    db.byGarage("vehicles", garageId),
    db.byGarage("technicians", garageId),
    db.byGarage("appointments", garageId),
    db.byGarage("parts", garageId),
    db.byGarage("workOrders", garageId),
    db.byGarage("workOrderLines", garageId),
    db.byGarage("invoices", garageId),
    db.byGarage("quotes", garageId),
    db.byGarage("quoteLines", garageId),
    db.byGarage("equipment", garageId),
    db.byGarage("cameraReads", garageId),
  ]);
  const garage = garages.find((g) => g.id === garageId) || garages[0];
  return {
    garages,
    garage,
    customers,
    vehicles,
    technicians,
    appointments,
    parts,
    workOrders,
    lines,
    invoices,
    quotes,
    quoteLines,
    equipment,
    cameraReads,
    query: search.toLowerCase(),
    search,
  };
}

function setupScreen() {
  appEl.innerHTML = `
    <div class="setup">
      <div class="setup-card">
        <h2>Welkom bij Werkplaats</h2>
        <p>ERP voor garages: klanten, voertuigen, werkbonnen, voorraad, facturen en hefbruggen. Alles blijft in deze browser en werkt offline. Andere gebruikers van dezelfde link hebben hun eigen data.</p>
        <div class="row">
          <button class="btn accent" id="demo">Start met voorbeelddata</button>
        </div>
        <form id="first" class="grid" style="margin-top:24px">
          <label>Of maak meteen je eigen garage aan</label>
          <input class="input" name="name" placeholder="Naam van de garage" required>
          <button class="btn" type="submit">Garage aanmaken</button>
        </form>
      </div>
    </div>`;
  document.getElementById("demo").onclick = async () => {
    const id = await seedDemo();
    localStorage.setItem("werkplaats-garage", id);
    location.hash = "#/dashboard";
    render();
  };
  document.getElementById("first").onsubmit = async (event) => {
    event.preventDefault();
    const name = new FormData(event.target).get("name");
    const id = crypto.randomUUID();
    await db.put("garages", {
      id,
      name,
      vatNumber: "",
      address: "",
      postalCode: "",
      city: "",
      phone: "",
      email: "",
      iban: "",
      vatRate: 21,
      paymentDays: 14,
      hourlyRate: 75,
      createdAt: Date.now(),
    });
    localStorage.setItem("werkplaats-garage", id);
    location.hash = "#/dashboard";
    render();
  };
}

async function pageFor(section, id, ctx, extra) {
  switch (section) {
    case "klanten":
      return pages.klanten(ctx, id);
    case "voertuigen":
      return pages.voertuigen(ctx, id, extra);
    case "werkbonnen":
      return pages.werkbonnen(ctx, id, extra);
    case "inrit":
      return pages.inrit(ctx);
    case "onderdelen":
      return pages.onderdelen(ctx, id);
    case "facturen":
      return pages.facturen(ctx, id);
    case "offertes":
      return pages.offertes(ctx, id);
    case "planning":
      return pages.planning(ctx, id, extra);
    case "apparatuur":
      return pages.apparatuur(ctx, id);
    case "instellingen":
      return pages.instellingen(ctx);
    default:
      return pages.dashboard(ctx);
  }
}

async function render() {
  const garages = await db.getAll("garages");
  if (!garages.length) {
    setupScreen();
    return;
  }
  const garageId = await ensureSingleGarage(localStorage.getItem("werkplaats-garage"));
  await ensureDemoCameraReads(garageId);
  await ensureDemoQuotes(garageId);
  await ensureEquipmentWorkstations();
  await ensureWorkOrderEquipment();
  const ctx = await loadCtx(garageId);
  const { section, id, extra } = route();
  const page = await pageFor(section, id, ctx, extra);

  appEl.innerHTML = `
    <div class="app">
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <img src="favicon.svg" alt="">
          <div>
            <h1>Werkplaats</h1>
            <p>Garage ERP</p>
          </div>
        </div>
        <nav>
          ${pages.NAV.map(([key, label]) => {
            const count = pages.navBadge(ctx, key);
            const badge = count ? `<span class="nav-count">${count}</span>` : "";
            return `<a href="#/${key}" class="${section === key ? "active" : ""}">${label}${badge}</a>`;
          }).join("")}
        </nav>
        <div class="sidebar-foot">Data blijft in deze browser · niet gedeeld met anderen</div>
      </aside>
      <main class="main">
        <div class="topbar">
          <div>
            <button class="btn secondary menu-btn" id="menu">Menu</button>
            <h2>${h(page.title)}</h2>
            <p>${h(page.subtitle || ctx.garage.city || ctx.garage.name)}</p>
          </div>
          <div class="row">${page.actions || ""}</div>
        </div>
        <div id="content">${page.html}</div>
      </main>
    </div>`;

  bind(ctx);
}

function bind(ctx) {
  document.getElementById("menu")?.addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
  });

  appEl.querySelectorAll("[data-go]").forEach((el) => {
    el.addEventListener("click", () => {
      location.hash = el.getAttribute("data-go");
    });
  });

  appEl.querySelectorAll("[data-sort]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      pages.setTableSort(btn.getAttribute("data-sort"));
      render();
    });
  });

  const searchEl = appEl.querySelector("[data-search]");
  if (searchEl) {
    searchEl.focus();
    const pos = searchEl.value.length;
    searchEl.setSelectionRange(pos, pos);
    searchEl.addEventListener("input", (event) => {
      search = event.target.value;
      clearTimeout(searchEl._t);
      searchEl._t = setTimeout(() => render(), 120);
    });
  }

  appEl.querySelectorAll("form[data-save]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const type = form.getAttribute("data-save");
      const data = Object.fromEntries(new FormData(form).entries());
      const next = await pages.handleSave(type, data, ctx);
      location.hash = next;
      search = "";
      await render();
    });
  });

  appEl.querySelector("[data-parts-excel]")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      location.hash = await pages.importPartsExcel(file, ctx);
      await render();
    } catch (error) {
      alert(error.message || "Excel-import mislukt.");
    }
  });

  appEl.querySelector("[data-wo-file]")?.addEventListener("change", async (event) => {
    const input = event.target;
    const workOrderId = input.getAttribute("data-wo-file");
    if (!input.files?.length) return;
    location.hash = await pages.addWorkOrderFiles(workOrderId, input.files, ctx.garage.id);
    await render();
  });
  appEl.querySelectorAll("[data-open-file]").forEach((btn) => {
    btn.addEventListener("click", () => pages.openWorkOrderFile(btn.getAttribute("data-open-file")));
  });

  appEl.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!confirm("Dit item verwijderen?")) return;
      const [store, id] = btn.getAttribute("data-delete").split(":");
      const next = await pages.handleDelete(store, id, ctx);
      location.hash = next;
      await render();
    });
  });

  appEl.querySelectorAll("[data-invoice]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      location.hash = await pages.createInvoice(btn.getAttribute("data-invoice"), ctx);
      await render();
    });
  });

  appEl.querySelectorAll("[data-paid]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      location.hash = await pages.markPaid(btn.getAttribute("data-paid"));
      await render();
    });
  });

  appEl.querySelector("[data-invoice-pdf]")?.addEventListener("click", () => {
    downloadInvoicePdf(ctx, appEl.querySelector("[data-invoice-pdf]").getAttribute("data-invoice-pdf"));
  });
  appEl.querySelector("[data-invoice-print]")?.addEventListener("click", async () => {
    const id = appEl.querySelector("[data-invoice-print]").getAttribute("data-invoice-print");
    window.print();
    location.hash = await pages.markSent(id, "print");
    await render();
  });
  appEl.querySelector("[data-invoice-email]")?.addEventListener("click", async () => {
    const id = appEl.querySelector("[data-invoice-email]").getAttribute("data-invoice-email");
    const sent = await sendInvoiceEmail(ctx, id);
    if (!sent) return;
    location.hash = await pages.markSent(id, "email");
    await render();
  });
  appEl.querySelector("[data-invoice-peppol]")?.addEventListener("click", async () => {
    const id = appEl.querySelector("[data-invoice-peppol]").getAttribute("data-invoice-peppol");
    const sent = downloadPeppolUbl(ctx, id);
    if (!sent) return;
    location.hash = await pages.markSent(id, "peppol");
    await render();
  });

  appEl.querySelector("[data-quote-pdf]")?.addEventListener("click", () => {
    downloadQuotePdf(ctx, appEl.querySelector("[data-quote-pdf]").getAttribute("data-quote-pdf"));
  });
  appEl.querySelector("[data-quote-print]")?.addEventListener("click", async () => {
    const id = appEl.querySelector("[data-quote-print]").getAttribute("data-quote-print");
    window.print();
    location.hash = await pages.markQuoteSent(id, "print");
    await render();
  });
  appEl.querySelector("[data-quote-email]")?.addEventListener("click", async () => {
    const id = appEl.querySelector("[data-quote-email]").getAttribute("data-quote-email");
    const sent = await sendQuoteEmail(ctx, id);
    if (!sent) return;
    location.hash = await pages.markQuoteSent(id, "email");
    await render();
  });
  appEl.querySelector("[data-quote-sms]")?.addEventListener("click", async () => {
    const id = appEl.querySelector("[data-quote-sms]").getAttribute("data-quote-sms");
    const sent = sendQuoteSms(ctx, id);
    if (!sent) return;
    location.hash = await pages.markQuoteSent(id, "sms");
    await render();
  });
  appEl.querySelector("[data-quote-workorder]")?.addEventListener("click", async () => {
    location.hash = await pages.convertQuoteToWorkOrder(
      appEl.querySelector("[data-quote-workorder]").getAttribute("data-quote-workorder"),
      ctx
    );
    await render();
  });
  appEl.querySelectorAll("[data-quote-status]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const [id, status] = btn.getAttribute("data-quote-status").split(":");
      location.hash = await pages.setQuoteStatus(id, status);
      await render();
    });
  });

  appEl.querySelectorAll("[data-week-nav]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const hash = pages.movePlanningWeek(btn.getAttribute("data-week-nav"));
      if (location.hash === hash) render();
      else location.hash = hash;
    });
  });

  appEl.querySelectorAll("[data-plan-day]").forEach((col) => {
    col.addEventListener("click", (event) => {
      if (event.target.closest("[data-go], a, button")) return;
      const day = Number(col.getAttribute("data-plan-day"));
      const y = event.clientY - col.getBoundingClientRect().top;
      const hour = Math.min(18, Math.max(7, 7 + Math.floor(y / 48)));
      const start = new Date(day);
      start.setHours(hour, 0, 0, 0);
      location.hash = `#/planning/new/${encodeURIComponent(toDatetimeLocal(start.getTime()))}`;
    });
  });

  appEl.querySelectorAll("[data-workorder]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      location.hash = await pages.createWorkOrderFromAppointment(btn.getAttribute("data-workorder"), ctx);
      await render();
    });
  });

  appEl.querySelectorAll("[data-anpr-claim]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      location.hash = await pages.claimCameraRead(btn.getAttribute("data-anpr-claim"), ctx);
      await render();
    });
  });

  const liveEl = appEl.querySelector("[data-anpr-live]");
  if (liveEl) {
    const pushLive = async () => {
      const plate = liveEl.value.trim();
      if (!plate) return;
      await pages.ingestCameraRead(ctx.garage.id, plate, "Live-feed", { debounce: true });
      liveEl.value = "";
      await render();
    };
    liveEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        pushLive();
      }
    });
  }

  appEl.querySelector("[data-backup]")?.addEventListener("click", () => pages.downloadBackup());
  appEl.querySelector("[data-restore]")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!confirm("Huidige data vervangen door deze backup?")) return;
    await pages.restoreBackup(file);
    await render();
  });

  const syncComboFromSelect = (selectEl) => {
    const search = selectEl?.closest("[data-combo]")?.querySelector("[data-combo-search]");
    if (search) search.value = selectEl.selectedOptions[0]?.textContent?.trim() || "";
  };

  appEl.querySelectorAll("[data-combo]").forEach((combo) => {
    const selectEl = combo.querySelector("select");
    const search = combo.querySelector("[data-combo-search]");
    const panel = combo.querySelector(".combo-panel");
    if (!selectEl || !search || !panel) return;
    const items = () => [...combo.querySelectorAll(".combo-item")];
    const filterItems = () => {
      const q = search.value.trim().toLowerCase();
      const customerId = appEl.querySelector("select[name=customerId]")?.value || "";
      const isVehicle = selectEl.name === "vehicleId";
      items().forEach((item) => {
        const textOk = !q || item.textContent.toLowerCase().includes(q);
        const customerOk =
          !isVehicle || !item.dataset.customerId || !customerId || item.dataset.customerId === customerId;
        item.hidden = !(textOk && customerOk);
      });
    };
    const open = () => {
      panel.hidden = false;
      filterItems();
    };
    search.addEventListener("focus", open);
    search.addEventListener("input", open);
    search.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        panel.hidden = true;
        syncComboFromSelect(selectEl);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        items().find((item) => !item.hidden)?.click();
      }
    });
    search.addEventListener("blur", () => {
      setTimeout(() => {
        panel.hidden = true;
        syncComboFromSelect(selectEl);
      }, 180);
    });
    items().forEach((item) => {
      item.addEventListener("mousedown", (event) => event.preventDefault());
      item.addEventListener("click", () => {
        selectEl.value = item.dataset.value;
        search.value = item.textContent.trim();
        panel.hidden = true;
        selectEl.dispatchEvent(new Event("change"));
      });
    });
  });

  const appointmentSelect = appEl.querySelector("form[data-save=workOrder] select[name=appointmentId]");
  const appointmentOptions = appointmentSelect
    ? [...appointmentSelect.options].map((option) => option.cloneNode(true))
    : [];
  const applyAppointmentChoice = (form) => {
    if (!form || !appointmentSelect) return;
    const option = appointmentSelect.selectedOptions[0];
    if (!option?.value) return;
    const customer = form.querySelector("select[name=customerId]");
    const vehicle = form.querySelector("select[name=vehicleId]");
    const technician = form.querySelector("select[name=technicianId]");
    const equipment = form.querySelector("select[name=equipmentId]");
    const complaint = form.querySelector("[name=complaint]");
    const diagnosis = form.querySelector("[name=diagnosis]");
    if (option.dataset.customerId && customer) {
      customer.value = option.dataset.customerId;
      syncComboFromSelect(customer);
    }
    if (option.dataset.vehicleId && vehicle) {
      vehicle.value = option.dataset.vehicleId;
      syncComboFromSelect(vehicle);
    }
    if (option.dataset.technicianId && technician) technician.value = option.dataset.technicianId;
    if (option.dataset.equipmentId && equipment) equipment.value = option.dataset.equipmentId;
    if (option.dataset.name && complaint) complaint.value = option.dataset.name;
    if (diagnosis) diagnosis.value = option.dataset.notes || "";
  };
  const filterAppointments = (vehicleId, preferredId) => {
    if (!appointmentSelect) return;
    const keep = appointmentOptions.filter(
      (option) => !option.value || !vehicleId || option.dataset.vehicleId === vehicleId
    );
    appointmentSelect.innerHTML = "";
    keep.forEach((option) => appointmentSelect.appendChild(option.cloneNode(true)));
    const preferred =
      (preferredId && keep.some((option) => option.value === preferredId) && preferredId) ||
      keep.find((option) => option.value)?.value ||
      "";
    appointmentSelect.value = preferred;
  };
  appointmentSelect?.addEventListener("change", () => {
    applyAppointmentChoice(appointmentSelect.closest("form"));
  });

  appEl.querySelectorAll("[data-anpr-pick]").forEach((radio) => {
    const apply = () => {
      const form = radio.closest("form");
      if (!form) return;
      const customer = form.querySelector("select[name=customerId]");
      const vehicle = form.querySelector("select[name=vehicleId]");
      if (radio.dataset.customerId && customer) {
        customer.value = radio.dataset.customerId;
        syncComboFromSelect(customer);
      }
      if (radio.dataset.vehicleId && vehicle) {
        vehicle.value = radio.dataset.vehicleId;
        syncComboFromSelect(vehicle);
        vehicle.dispatchEvent(new Event("change"));
      }
      filterAppointments(radio.dataset.vehicleId || "", radio.dataset.appointmentId || "");
      applyAppointmentChoice(form);
    };
    radio.addEventListener("change", apply);
    if (radio.checked) apply();
  });

  const customerSelect = appEl.querySelector("select[name=customerId]");
  const vehicleSelect = appEl.querySelector("select[name=vehicleId]");
  if (customerSelect && vehicleSelect) {
    const filterVehicles = () => {
      const cid = customerSelect.value;
      const stillValid = [...vehicleSelect.options].some(
        (option) =>
          option.value === vehicleSelect.value && (!option.dataset.customerId || option.dataset.customerId === cid)
      );
      if (!stillValid) {
        vehicleSelect.value = "";
        syncComboFromSelect(vehicleSelect);
      }
    };
    customerSelect.addEventListener("change", filterVehicles);
    vehicleSelect.addEventListener("change", () => {
      filterAppointments(vehicleSelect.value, appointmentSelect?.value || "");
    });
    filterVehicles();
  }

  appEl.querySelectorAll("form[data-save=workOrderLine], form[data-save=quoteLine]").forEach((form) => {
    form.querySelector("[name=partId]")?.addEventListener("change", (event) => {
      const option = event.target.selectedOptions[0];
      if (!option?.dataset.price) return;
      form.querySelector("[name=unitPrice]").value = option.dataset.price;
      if (option.dataset.name) form.querySelector("[name=description]").value = option.dataset.name;
      form.querySelector("[name=type]").value = "onderdeel";
    });
  });
}

window.werkplaatsAnprIngest = async (plate, cameraName = "ANPR") => {
  const garageId = localStorage.getItem("werkplaats-garage");
  if (!garageId) return null;
  const read = await pages.ingestCameraRead(garageId, plate, cameraName);
  const section = location.hash.replace(/^#\/?/, "").split("/")[0];
  if (section === "inrit") await render();
  return read;
};

window.addEventListener("hashchange", () => {
  search = "";
  render();
});
render();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

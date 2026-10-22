import { customerPhones, isoDate } from "./format.js";
import { lineTotals } from "./db.js";

function xml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function money(n) {
  return Number(n || 0).toFixed(2);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function invoicePayload(ctx, invoiceId) {
  const invoice = ctx.invoices.find((row) => row.id === invoiceId);
  if (!invoice) throw new Error("Factuur niet gevonden");
  const customer = ctx.customers.find((row) => row.id === invoice.customerId) || {};
  const workOrder = ctx.workOrders.find((row) => row.id === invoice.workOrderId);
  const vehicle = ctx.vehicles.find((row) => row.id === workOrder?.vehicleId);
  const lines = ctx.lines.filter((row) => row.workOrderId === invoice.workOrderId);
  const totals = lineTotals(lines, ctx.garage.vatRate);
  return { invoice, customer, workOrder, vehicle, lines, totals, garage: ctx.garage };
}

export function peppolEndpoint(vatNumber, explicit) {
  if (explicit && String(explicit).trim()) {
    const raw = String(explicit).trim();
    const idx = raw.indexOf(":");
    if (idx > 0) return { scheme: raw.slice(0, idx), id: raw.slice(idx + 1).replace(/\D/g, "") || raw.slice(idx + 1) };
    return { scheme: "0208", id: raw.replace(/\D/g, "") || raw };
  }
  const clean = String(vatNumber || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  if (clean.startsWith("BE") && clean.length >= 12) return { scheme: "0208", id: clean.slice(2) };
  if (clean.startsWith("NL")) return { scheme: "9944", id: clean };
  if (clean) return { scheme: "9925", id: clean };
  return null;
}

function pdfEscape(text) {
  return String(text ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("€", "EUR ")
    .replaceAll("—", "-");
}

function wrap(text, width) {
  const words = String(text ?? "").split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width) {
      if (current) lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function buildInvoicePdf(payload) {
  const { invoice, customer, workOrder, vehicle, lines, totals, garage } = payload;
  const commands = [];
  let y = 800;
  const line = (text, size = 11, x = 48) => {
    commands.push(`BT /F1 ${size} Tf ${x} ${y} Td (${pdfEscape(text)}) Tj ET`);
    y -= size + 6;
  };

  line(garage.name || "Garage", 16);
  line(`${garage.address || ""} ${garage.postalCode || ""} ${garage.city || ""}`.trim(), 10);
  line(`BTW ${garage.vatNumber || "-"}  ${garage.iban || ""}`.trim(), 10);
  y -= 8;
  const kind = payload.docKind || "FACTUUR";
  line(`${kind} ${invoice.number}`, 18);
  line(`Datum: ${isoDate(invoice.issuedAt)}   ${kind === "OFFERTE" ? "Geldig tot" : "Vervaldatum"}: ${isoDate(invoice.dueAt)}`, 10);
  if (workOrder) line(`Werkbon: ${workOrder.number}`, 10);
  if (vehicle) line(`Voertuig: ${vehicle.licensePlate} ${vehicle.brand} ${vehicle.model}`, 10);
  y -= 10;
  line("Factuur aan", 12);
  line(customer.company || customer.name || "-", 11);
  line(`${customer.address || ""} ${customer.postalCode || ""} ${customer.city || ""}`.trim(), 10);
  if (customer.vatNumber) line(`BTW ${customer.vatNumber}`, 10);
  y -= 12;
  line("Omschrijving                              Aantal      Prijs       Totaal", 10);
  commands.push(`BT /F1 10 Tf 48 ${y + 4} Td (${pdfEscape("----------------------------------------------------------------")}) Tj ET`);
  y -= 8;
  for (const item of lines) {
    const desc = wrap(item.description, 38);
    const qty = String(item.qty);
    const price = money(item.unitPrice);
    const tot = money(item.qty * item.unitPrice);
    line(`${desc[0].padEnd(40)} ${qty.padStart(6)}  ${price.padStart(9)}  ${tot.padStart(9)}`, 10);
    for (const extra of desc.slice(1)) line(`  ${extra}`, 10);
  }
  y -= 10;
  line(`Excl. BTW          EUR ${money(totals.excl)}`, 11, 280);
  line(`BTW ${garage.vatRate}%            EUR ${money(totals.vat)}`, 11, 280);
  line(`${kind === "OFFERTE" ? "Totaal offerte" : "Te betalen"}         EUR ${money(totals.incl)}`, 13, 280);
  y -= 8;
  line(
    kind === "OFFERTE"
      ? `Deze offerte is geldig tot ${isoDate(invoice.dueAt)}.`
      : `Gelieve te betalen op ${garage.iban || "-"} met mededeling ${invoice.number}.`,
    10
  );
  line("Gegenereerd met Werkplaats Garage ERP", 8);

  const content = commands.join("\n");
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  add(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
  );
  add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const startxref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

export function downloadInvoicePdf(ctx, invoiceId) {
  const payload = invoicePayload(ctx, invoiceId);
  const bytes = buildInvoicePdf(payload);
  downloadBlob(`${payload.invoice.number}.pdf`, new Blob([bytes], { type: "application/pdf" }));
}

export function quotePayload(ctx, quoteId) {
  const quote = ctx.quotes.find((row) => row.id === quoteId);
  if (!quote) throw new Error("Offerte niet gevonden");
  const customer = ctx.customers.find((row) => row.id === quote.customerId) || {};
  const vehicle = ctx.vehicles.find((row) => row.id === quote.vehicleId);
  const lines = (ctx.quoteLines || []).filter((row) => row.quoteId === quote.id);
  const totals = lineTotals(lines, ctx.garage.vatRate);
  return {
    invoice: {
      number: quote.number,
      issuedAt: quote.createdAt,
      dueAt: quote.validUntil || quote.createdAt + 14 * 86400000,
    },
    customer,
    workOrder: null,
    vehicle,
    lines,
    totals,
    garage: ctx.garage,
    docKind: "OFFERTE",
  };
}

export function downloadQuotePdf(ctx, quoteId) {
  const payload = quotePayload(ctx, quoteId);
  const bytes = buildInvoicePdf(payload);
  downloadBlob(`${payload.invoice.number}.pdf`, new Blob([bytes], { type: "application/pdf" }));
}

export async function sendQuoteEmail(ctx, quoteId) {
  const payload = quotePayload(ctx, quoteId);
  const bytes = buildInvoicePdf(payload);
  const blob = new Blob([bytes], { type: "application/pdf" });
  downloadBlob(`${payload.invoice.number}.pdf`, blob);
  const email = payload.customer.email;
  if (!email) {
    alert("Deze klant heeft geen e-mailadres. Vul dat eerst in bij Klanten.");
    return false;
  }
  const subject = encodeURIComponent(`Offerte ${payload.invoice.number} — ${payload.garage.name}`);
  const body = encodeURIComponent(
    `Beste ${payload.customer.name || ""},\n\nIn bijlage offerte ${payload.invoice.number} van ${payload.garage.name}.\nTotaal: EUR ${money(payload.totals.incl)} (incl. BTW).\nGeldig tot ${isoDate(payload.invoice.dueAt)}.\n\nDe PDF is gedownload. Voeg ${payload.invoice.number}.pdf toe als bijlage.\n\nMet vriendelijke groeten,\n${payload.garage.name}`
  );
  window.location.href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
  return true;
}

function smsNumber(phone) {
  let n = String(phone || "").replace(/[^\d+]/g, "");
  if (!n) return "";
  if (n.startsWith("00")) n = `+${n.slice(2)}`;
  if (n.startsWith("0")) {
    n = n.startsWith("06") ? `+31${n.slice(1)}` : `+32${n.slice(1)}`;
  }
  return n;
}

export function sendQuoteSms(ctx, quoteId) {
  const payload = quotePayload(ctx, quoteId);
  const phone = customerPhones(payload.customer)[0];
  if (!phone) {
    alert("Deze klant heeft geen telefoonnummer. Vul dat eerst in bij Klanten.");
    return false;
  }
  const text = `Offerte ${payload.invoice.number} van ${payload.garage.name}: EUR ${money(payload.totals.incl)} incl. BTW, geldig tot ${isoDate(payload.invoice.dueAt)}. ${payload.garage.phone ? `Tel ${payload.garage.phone}` : ""}`.trim();
  const num = smsNumber(phone);
  const sep = /iPhone|iPad|Macintosh/i.test(navigator.userAgent) ? "&" : "?";
  window.location.href = `sms:${num}${sep}body=${encodeURIComponent(text)}`;
  return true;
}

function emailBody(payload) {
  const { invoice, garage, totals, customer } = payload;
  return [
    `Beste ${customer.name || ""},`,
    "",
    `In bijlage / hierbij factuur ${invoice.number} van ${garage.name}.`,
    `Bedrag: EUR ${money(totals.incl)} (incl. ${garage.vatRate}% BTW).`,
    `Vervaldatum: ${isoDate(invoice.dueAt)}.`,
    garage.iban ? `Betaling op ${garage.iban} met mededeling ${invoice.number}.` : "",
    "",
    "Met vriendelijke groeten,",
    garage.name,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export async function sendInvoiceEmail(ctx, invoiceId) {
  const payload = invoicePayload(ctx, invoiceId);
  const bytes = buildInvoicePdf(payload);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const file = new File([blob], `${payload.invoice.number}.pdf`, { type: "application/pdf" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: `Factuur ${payload.invoice.number}`,
        text: emailBody(payload),
      });
      return true;
    }
  } catch {
    return false;
  }
  const email = payload.customer.email;
  if (!email) {
    alert("Deze klant heeft geen e-mailadres. Vul dat eerst in bij Klanten, of kies Afdrukken / Peppol.");
    return false;
  }
  downloadBlob(`${payload.invoice.number}.pdf`, blob);
  const subject = encodeURIComponent(`Factuur ${payload.invoice.number} — ${payload.garage.name}`);
  const body = encodeURIComponent(`${emailBody(payload)}\n\nDe PDF is gedownload. Voeg ${payload.invoice.number}.pdf toe als bijlage.`);
  window.location.href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
  return true;
}

export function downloadPeppolUbl(ctx, invoiceId) {
  const payload = invoicePayload(ctx, invoiceId);
  const { invoice, customer, garage, lines, totals, workOrder } = payload;
  const supplier = peppolEndpoint(garage.vatNumber, garage.peppolId);
  const buyer = peppolEndpoint(customer.vatNumber, customer.peppolId);
  if (!supplier) {
    alert("Vul in Instellingen een BTW-nummer of Peppol-ID van de garage in.");
    return false;
  }
  if (!buyer) {
    alert("Peppol is bedoeld voor B2B. Vul het BTW-nummer of Peppol-ID van de klant in.");
    return false;
  }

  const ublLines = lines
    .map(
      (item, index) => `    <cac:InvoiceLine>
      <cbc:ID>${index + 1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="C62">${xml(money(item.qty))}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="EUR">${xml(money(item.qty * item.unitPrice))}</cbc:LineExtensionAmount>
      <cac:Item>
        <cbc:Name>${xml(item.description)}</cbc:Name>
        <cac:ClassifiedTaxCategory>
          <cbc:ID>S</cbc:ID>
          <cbc:Percent>${xml(money(garage.vatRate))}</cbc:Percent>
          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
        </cac:ClassifiedTaxCategory>
      </cac:Item>
      <cac:Price>
        <cbc:PriceAmount currencyID="EUR">${xml(money(item.unitPrice))}</cbc:PriceAmount>
      </cac:Price>
    </cac:InvoiceLine>`
    )
    .join("\n");

  const ubl = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${xml(invoice.number)}</cbc:ID>
  <cbc:IssueDate>${xml(isoDate(invoice.issuedAt))}</cbc:IssueDate>
  <cbc:DueDate>${xml(isoDate(invoice.dueAt))}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${xml(workOrder?.number || invoice.number)}</cbc:BuyerReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="${xml(supplier.scheme)}">${xml(supplier.id)}</cbc:EndpointID>
      <cac:PartyName><cbc:Name>${xml(garage.name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${xml(garage.address)}</cbc:StreetName>
        <cbc:CityName>${xml(garage.city)}</cbc:CityName>
        <cbc:PostalZone>${xml(garage.postalCode)}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${xml((garage.vatNumber || "BE").replace(/[^A-Za-z]/g, "").slice(0, 2) || "BE")}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${xml(String(garage.vatNumber || "").replace(/[^A-Za-z0-9]/g, ""))}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xml(garage.name)}</cbc:RegistrationName>
        <cbc:CompanyID>${xml(supplier.id)}</cbc:CompanyID>
      </cac:PartyLegalEntity>
      <cac:Contact>
        <cbc:ElectronicMail>${xml(garage.email)}</cbc:ElectronicMail>
        <cbc:Telephone>${xml(garage.phone)}</cbc:Telephone>
      </cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cbc:EndpointID schemeID="${xml(buyer.scheme)}">${xml(buyer.id)}</cbc:EndpointID>
      <cac:PartyName><cbc:Name>${xml(customer.company || customer.name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${xml(customer.address)}</cbc:StreetName>
        <cbc:CityName>${xml(customer.city)}</cbc:CityName>
        <cbc:PostalZone>${xml(customer.postalCode)}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${xml((customer.vatNumber || "BE").replace(/[^A-Za-z]/g, "").slice(0, 2) || "BE")}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${xml(String(customer.vatNumber || "").replace(/[^A-Za-z0-9]/g, ""))}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xml(customer.company || customer.name)}</cbc:RegistrationName>
        <cbc:CompanyID>${xml(buyer.id)}</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>
    <cbc:PaymentID>${xml(invoice.number)}</cbc:PaymentID>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${xml(String(garage.iban || "").replace(/\s/g, ""))}</cbc:ID>
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${xml(money(totals.vat))}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${xml(money(totals.excl))}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">${xml(money(totals.vat))}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${xml(money(garage.vatRate))}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${xml(money(totals.excl))}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${xml(money(totals.excl))}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${xml(money(totals.incl))}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">${xml(money(totals.incl))}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${ublLines}
</Invoice>
`;
  downloadBlob(`${invoice.number}-peppol.xml`, new Blob([ubl], { type: "application/xml" }));
  alert(
    "Peppol-UBL is gedownload. Werkplaats kan niet zelf over het Peppol-netwerk versturen: upload dit XML-bestand in je Peppol access point (bijv. Billit, Exact of je boekhouder)."
  );
  return true;
}

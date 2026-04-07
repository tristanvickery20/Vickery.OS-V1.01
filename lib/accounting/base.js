// lib/accounting/base.js
// Accounting provider interface contract (documentation).
// All providers must implement every method listed here.
// Methods must return Promise<{ ok: boolean, ...data }> — never throw on expected provider errors.
//
// ─────────────────────────────────────────────────────────
// Method signatures
// ─────────────────────────────────────────────────────────
//
// createCustomer({ name, phone, email })
//   → { ok, customer_ref, display }
//
// createInvoice({ invoice_number, invoice_id, customer_name, total, subtotal, tax_amount, notes, line_items })
//   → { ok, provider_ref, invoice_url, invoice_number }
//
// sendInvoice({ provider_ref, invoice_number, customer_name, customer_email })
//   → { ok, sent_to }
//
// recordPayment({ invoice_ref, amount, method, date, note })
//   → { ok, provider_ref }
//
// getInvoiceStatus({ provider_ref })
//   → { ok, status }   // status: one of draft | sent | deposit_received | partial | paid | void
//
// getCustomerBalance({ customer_ref })
//   → { ok, balance, currency }
//
// ─────────────────────────────────────────────────────────
// Implementation rules
// ─────────────────────────────────────────────────────────
// 1. Never throw — always return { ok: false, error: 'message' } on failure.
// 2. All methods are async and return Promises.
// 3. provider.name must be a non-empty string identifying the provider.
// 4. Providers are loaded as singletons via lib/accounting/index.js.

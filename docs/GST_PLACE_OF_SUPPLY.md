# GST place of supply on invoices

How AMS decides whether an invoice is **intra-state** (CGST + SGST) or **inter-state** (IGST), what it refuses, and which cases are still waiting for a tax-policy decision.

Code: `Advocate-app-BE-Django/invoices/gst.py`, used by `invoices/views.py::_place_of_supply`. Tests: `invoices/tests_gst.py`.

## The rule AMS applies

Legal services have no special place-of-supply rule, so the general rule for services between parties in India applies: **IGST Act s.12(2)**.

| Who the client is | Place of supply | What AMS uses |
|---|---|---|
| Registered (has a GSTIN) | Client's location | The **GSTIN's state** (first two digits) |
| Not registered, address on record | Client's address | The client's **state** (a name, a short form like "TN", or a 2-digit code) |
| Not registered, no address on record | The firm's own location (s.12(2)(b)(ii)) | **Not applied.** A forward-charge invoice is refused instead (see "Pending decisions") |

**Matching states:** states are compared only as 2-digit GST state codes (`core/validators.py` `GST_STATE_CODES`), never as free text.
- "TN", "Tamilnadu", "33" and "Tamil Nadu" are the same state.
- Old and new codes of one state (28/37, 25/26) also count as the same.

**The firm's location:**
- It comes from the firm's GSTIN: the practice owner's Profile → Office → GST number first, then Firm Settings → GST number.
- Only when no GSTIN is stored at all does it come from the firm's state.

**What AMS refuses.** A refusal never saves the invoice, and no invoice number is used.

| Situation | Forward charge | Reverse charge (no tax added) |
|---|---|---|
| Client's state unknown and no GSTIN | Refused: `RECIPIENT_STATE_REQUIRED` | Saved; intra/inter recorded as unknown |
| Firm's state and GSTIN both missing | Refused: `SUPPLIER_STATE_REQUIRED` | Saved; recorded as unknown |
| **Stored firm GSTIN is invalid** | Refused: `FIRM_GSTIN_INVALID`, naming where to fix it | Saved; firm location recorded as unknown, **never taken from the state instead** |
| Client's GSTIN and state disagree | Refused: `STATE_GSTIN_MISMATCH` | Refused |
| State not recognised | Refused: `UNKNOWN_STATE` | Refused |

**Other guarantees:**
- AMS never changes a stored GSTIN.
- Earlier invoices are never recalculated.
- `manage.py integrity_report` lists stored firm GSTINs that are invalid, so an administrator can correct them.

## Pending tax-policy decisions (not implemented)

1. **Unregistered client with no address on record.** The law puts the supply at the firm's location. A safe workflow would be an explicit "client has no address on record" choice on the invoice, recorded with the invoice, never assumed.
2. **Clients outside India (export of services, IGST Act s.13).** There is no "outside India" option yet, and no LUT / zero-rated handling. Forward-charge invoices for foreign clients are refused today.
3. **SEZ clients.** Supplies to an SEZ are always inter-state and zero-rated. Not modelled.
4. **Firms registered in more than one state.** Only one firm GSTIN is used; there is no per-branch choice.
5. **Exempt legal services.** Services to individuals, and to business entities below the turnover limit, are exempt. AMS relies on the user choosing reverse or forward charge, and doesn't suggest the treatment from the client's type.
6. **Correcting invalid stored GSTINs.** These are left to the firm. AMS reports them but doesn't change them.

"""Small helper for building professional-looking PDFs with ReportLab.

Exact layout need not match the old Spring/OpenPDF output — the frontend just
downloads the resulting blob. We aim for clean, readable, data-correct PDFs.
"""

import datetime
import os
from io import BytesIO
from xml.sax.saxutils import escape as _xesc

from django.conf import settings

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, HRFlowable)

_styles = getSampleStyleSheet()
_H1 = ParagraphStyle('H1x', parent=_styles['Heading1'], fontSize=18, textColor=colors.HexColor('#1f3a8a'))
_H2 = ParagraphStyle('H2x', parent=_styles['Heading2'], fontSize=13, textColor=colors.HexColor('#334155'))
_META = ParagraphStyle('metax', parent=_styles['Normal'], fontSize=9, textColor=colors.grey)
_NORMAL = _styles['Normal']
_OFFICE = ParagraphStyle('officex', parent=_styles['Heading2'], fontSize=15, textColor=colors.HexColor('#1f3a8a'), spaceAfter=1)
_OFFICE_META = ParagraphStyle('officemetax', parent=_styles['Normal'], fontSize=8.5, textColor=colors.HexColor('#475569'), leading=12)
_SIGN = ParagraphStyle('signx', parent=_styles['Normal'], fontSize=9, textColor=colors.HexColor('#334155'))

BRAND = colors.HexColor('#1f3a8a')
HEADER_BG = colors.HexColor('#1f3a8a')
ROW_ALT = colors.HexColor('#f1f5f9')


def _hex(value, fallback):
    """Parse a stored brand colour, tolerating blanks / bad values."""
    try:
        return colors.HexColor(value) if value else fallback
    except (ValueError, TypeError):
        return fallback


def _abs(path):
    """Absolute on-disk path for a stored 'branding/xxx.png' value, or None."""
    if not path:
        return None
    full = os.path.join(settings.DOCUMENT_UPLOAD_DIR, path)
    return full if os.path.exists(full) else None


def letterhead_from_advocate(advocate):
    """Build the branding dict a PDF letterhead needs from an Advocate row.
    Returns None if there's nothing brand-worthy to show."""
    if advocate is None:
        return None
    addr_bits = [advocate.office_address, advocate.city, advocate.state,
                 getattr(advocate, 'pin_code', None), advocate.country]
    address = ', '.join([b for b in addr_bits if b])
    contact = ' · '.join([b for b in [advocate.office_phone, advocate.office_email,
                                      getattr(advocate, 'website', None)] if b])
    return {
        'office_name': advocate.office_name or advocate.full_name or '',
        'address': address,
        'contact': contact,
        'logo': _abs(advocate.office_logo_path),
        'signature': _abs(advocate.signature_path),
        'seal': _abs(advocate.office_seal_path),
        'advocate_name': advocate.full_name or '',
        'primary': _hex(advocate.primary_brand_color, BRAND),
        'gstin': advocate.gst_number or '',
        'pan': advocate.pan_number or '',
    }


def _letterhead_flowables(b):
    """Top-of-page firm letterhead: logo (left) + office identity (right)."""
    right = [Paragraph(b['office_name'], _OFFICE)]
    if b['address']:
        right.append(Paragraph(b['address'], _OFFICE_META))
    if b['contact']:
        right.append(Paragraph(b['contact'], _OFFICE_META))

    if b['logo']:
        try:
            logo = Image(b['logo'], width=26 * mm, height=26 * mm, kind='proportional')
        except Exception:
            logo = Paragraph('', _NORMAL)
        head = Table([[logo, right]], colWidths=[30 * mm, 140 * mm])
        head.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ]))
    else:
        head = Table([[right]], colWidths=[170 * mm])
        head.setStyle(TableStyle([('LEFTPADDING', (0, 0), (-1, -1), 0)]))

    return [head, Spacer(1, 2 * mm),
            HRFlowable(width='100%', thickness=1.4, color=b['primary'], spaceAfter=6)]


def _signature_flowables(b):
    """Bottom-of-page signature + seal, when the firm has uploaded them."""
    if not (b['signature'] or b['seal']):
        return []
    cells = []
    if b['signature']:
        try:
            cells.append([Image(b['signature'], width=40 * mm, height=18 * mm, kind='proportional'),
                          Paragraph('Authorised Signatory<br/>' + b['advocate_name'], _SIGN)])
        except Exception:
            pass
    seal_flow = None
    if b['seal']:
        try:
            seal_flow = Image(b['seal'], width=24 * mm, height=24 * mm, kind='proportional')
        except Exception:
            seal_flow = None
    left = Table(cells, colWidths=[42 * mm, 45 * mm]) if cells else Paragraph('', _NORMAL)
    if cells:
        left.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'BOTTOM'),
                                  ('LEFTPADDING', (0, 0), (-1, -1), 0)]))
    row = Table([[left, seal_flow or Paragraph('', _NORMAL)]], colWidths=[120 * mm, 50 * mm])
    row.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'BOTTOM'),
                             ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
                             ('LEFTPADDING', (0, 0), (-1, -1), 0)]))
    return [Spacer(1, 14 * mm), row]


def money(v):
    try:
        return f"Rs. {float(v or 0):,.2f}"
    except (TypeError, ValueError):
        return "Rs. 0.00"


def _table(headers, rows, col_widths=None):
    data = [headers] + (rows if rows else [['—'] * len(headers)])
    t = Table(data, colWidths=col_widths, repeatRows=1)
    style = [
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_BG),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cbd5e1')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, ROW_ALT]),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ]
    t.setStyle(TableStyle(style))
    return t


def build_pdf(title, blocks, subtitle=None, branding=None):
    """blocks: list of dicts:
       {'type':'heading','text':...}
       {'type':'para','text':...}
       {'type':'kv','rows':[(k,v),...]}
       {'type':'table','headers':[...],'rows':[[...]], 'widths':[...] optional}
    branding: optional dict from letterhead_from_advocate() — renders a firm
       letterhead at the top and a signature/seal block at the bottom.
    """
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=18 * mm, bottomMargin=18 * mm,
                            leftMargin=16 * mm, rightMargin=16 * mm, title=title)
    story = []
    if branding:
        story.extend(_letterhead_flowables(branding))
    story.append(Paragraph(title, _H1))
    if subtitle:
        story.append(Paragraph(subtitle, _META))
    story.append(Paragraph('Generated on ' + datetime.datetime.now().strftime('%d %b %Y, %H:%M'), _META))
    story.append(Spacer(1, 8 * mm))

    for b in blocks:
        bt = b['type']
        if bt == 'heading':
            story.append(Spacer(1, 3 * mm))
            story.append(Paragraph(b['text'], _H2))
            story.append(Spacer(1, 2 * mm))
        elif bt == 'para':
            story.append(Paragraph(b['text'], _NORMAL))
            story.append(Spacer(1, 2 * mm))
        elif bt == 'kv':
            rows = [[str(k), str(v)] for k, v in b['rows']]
            t = Table(rows, colWidths=[60 * mm, 110 * mm])
            t.setStyle(TableStyle([
                ('FONTSIZE', (0, 0), (-1, -1), 10),
                ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
                ('TEXTCOLOR', (0, 0), (0, -1), colors.HexColor('#475569')),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ('TOPPADDING', (0, 0), (-1, -1), 2),
            ]))
            story.append(t)
            story.append(Spacer(1, 3 * mm))
        elif bt == 'table':
            story.append(_table(b['headers'], b.get('rows', []), b.get('widths')))
            story.append(Spacer(1, 4 * mm))

    if branding:
        story.extend(_signature_flowables(branding))

    doc.build(story)
    return buf.getvalue()


# --------------------------------------------------------------------------- #
#  GST tax invoice                                                            #
# --------------------------------------------------------------------------- #

_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
         'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
         'seventeen', 'eighteen', 'nineteen']
_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']


def _two_words(n):        # 0..99
    if n < 20:
        return _ONES[n]
    return (_TENS[n // 10] + (' ' + _ONES[n % 10] if n % 10 else '')).strip()


def _three_words(n):      # 0..999
    out = ''
    if n // 100:
        out = _ONES[n // 100] + ' hundred'
    if n % 100:
        out += (' ' if out else '') + _two_words(n % 100)
    return out


def _int_words(n):
    """Integer -> words using the Indian numbering system (lakh/crore)."""
    if n <= 0:
        return 'zero'
    segs = []
    crore, n = divmod(n, 10 ** 7)
    lakh, n = divmod(n, 10 ** 5)
    thousand, hundreds = divmod(n, 10 ** 3)
    if crore:
        segs.append(_three_words(crore) + ' crore')
    if lakh:
        segs.append(_two_words(lakh) + ' lakh')
    if thousand:
        segs.append(_two_words(thousand) + ' thousand')
    if hundreds:
        segs.append(_three_words(hundreds))
    return ' '.join(segs).strip()


def amount_in_words(value):
    """`40000` -> 'FORTY THOUSAND RUPEES and ZERO PAISA ONLY' (rupees + paise)."""
    try:
        v = float(value or 0)
    except (TypeError, ValueError):
        v = 0.0
    rupees = int(v)
    paise = int(round((v - rupees) * 100))
    if paise == 100:            # rounding edge, e.g. 12.999
        rupees += 1
        paise = 0
    return '{} RUPEES and {} PAISA ONLY'.format(
        _int_words(rupees).upper(), _int_words(paise).upper())


# Invoice-specific paragraph styles (small, print-like).
_INV_TITLE = ParagraphStyle('invtitle', parent=_styles['Heading1'], fontSize=15,
                            alignment=TA_CENTER, textColor=colors.black, spaceBefore=2, spaceAfter=2)
_INV_CELL = ParagraphStyle('invcell', parent=_styles['Normal'], fontSize=8.5, leading=12)
_INV_ADDR = ParagraphStyle('invaddr', parent=_styles['Normal'], fontSize=8.5, leading=12,
                           textColor=colors.HexColor('#475569'))
_INV_DESC = ParagraphStyle('invdesc', parent=_styles['Normal'], fontSize=9, leading=13)
_INV_HEAD = ParagraphStyle('invhead', parent=_styles['Normal'], fontSize=9,
                           fontName='Helvetica-Bold', textColor=colors.white)
_INV_HEAD_R = ParagraphStyle('invheadr', parent=_INV_HEAD, alignment=TA_RIGHT)
_INV_NOTE = ParagraphStyle('invnote', parent=_styles['Normal'], fontSize=8, leading=11,
                           textColor=colors.HexColor('#334155'))
_INV_NOTE_B = ParagraphStyle('invnoteb', parent=_INV_NOTE, fontName='Helvetica-Bold')


def _g(obj, attr, default=''):
    return (getattr(obj, attr, None) or default) if obj else default


def build_invoice_pdf(invoice, items, tax, firm, branding):
    """Render a GST legal-services tax invoice matching the standard Indian format:
    firm letterhead, a From/To party+GST block, a DESCRIPTION/AMOUNT line-item table
    with taxable-value total and amount-in-words, then PAN + bank remittance + GST
    reverse-charge / ISO notes and the authorised signature/seal.

    invoice: core.models.Invoice   items: list[InvoiceItem]   tax: InvoiceTaxDetail|None
    firm: FirmBillingProfile|None   branding: dict from letterhead_from_advocate()|None
    """
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=15 * mm, bottomMargin=15 * mm,
                            leftMargin=15 * mm, rightMargin=15 * mm,
                            title='Invoice ' + (invoice.invoice_number or ''))
    primary = branding['primary'] if branding else BRAND
    story = []

    # --- letterhead + centered title ---
    if branding:
        story.extend(_letterhead_flowables(branding))
    story.append(Paragraph('INVOICE', _INV_TITLE))
    story.append(Spacer(1, 3 * mm))

    client = invoice.client if invoice.client_id else None
    case = invoice.case if invoice.case_id else None
    supplier_gstin = (branding.get('gstin') if branding else '') or 'UNREGISTERED'
    supplier_pan = (branding.get('pan') if branding else '') or ''
    firm_name = (branding.get('office_name') if branding else '') or ''
    place = _g(tax, 'place_of_supply') or (
        '{} - {}'.format(_g(tax, 'recipient_state'), _g(tax, 'recipient_state_code')).strip(' -'))
    recip_addr = _g(tax, 'recipient_address') or _g(client, 'address')

    def P(html, style=_INV_CELL):
        return Paragraph(html, style)

    # Party block — only render lines that have a value, so an older invoice with no
    # captured GST detail looks clean rather than showing empty "GSTIN :" labels.
    left = []
    if _g(tax, 'kind_attn'):
        left.append(P('Kind Attn: <b>{}</b>'.format(_xesc(_g(tax, 'kind_attn')))))
    if _g(client, 'phone'):
        left.append(P('Phone Number : {}'.format(_xesc(_g(client, 'phone')))))
    if _g(client, 'name'):
        left.append(P('<b>{}</b>'.format(_xesc(_g(client, 'name')))))
    if recip_addr:
        left.append(P(_xesc(recip_addr).replace('\n', '<br/>'), _INV_ADDR))
    if _g(tax, 'recipient_gstin'):
        left.append(P('GSTIN/UIN of Recipient : {}'.format(_xesc(_g(tax, 'recipient_gstin')))))
    if _g(tax, 'recipient_state'):
        left.append(P('Name of the State &amp; Code : {} - {}'.format(
            _xesc(_g(tax, 'recipient_state')), _xesc(_g(tax, 'recipient_state_code')))))
    if not left:
        left = [P('&nbsp;')]

    inv_date = invoice.invoice_date.strftime('%d %B %Y') if invoice.invoice_date else ''
    right = []
    if _g(client, 'email'):
        right.append(P('E: {}'.format(_xesc(_g(client, 'email')))))
    if _g(case, 'case_number'):
        right.append(P('Case ID : {}'.format(_xesc(_g(case, 'case_number')))))
    right.append(P('<b>Invoice No. {}</b>'.format(_xesc(invoice.invoice_number or ''))))
    right.append(P('<b>Invoice Date {}</b>'.format(_xesc(inv_date))))
    right.append(P('GSTIN of Supplier : {}'.format(_xesc(supplier_gstin))))
    if _g(firm, 'service_category'):
        right.append(P('Category : {}'.format(_xesc(firm.service_category))))
    if _g(firm, 'hsn_code'):
        right.append(P('HSN : {}'.format(_xesc(firm.hsn_code))))
    if place:
        right.append(P('Place of Supply : {}'.format(_xesc(place))))

    party = Table([[left, right]], colWidths=[100 * mm, 80 * mm])
    party.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (0, 0), 0),
        ('RIGHTPADDING', (-1, 0), (-1, 0), 0),
    ]))
    story.append(party)
    story.append(Spacer(1, 5 * mm))

    # --- GST figures (snapshotted on the invoice; forward = firm charges GST) ---
    mode = _g(tax, 'tax_mode', 'rcm')
    if tax and (tax.taxable_value or tax.total_value):
        taxable = tax.taxable_value or round(sum((it.amount or 0) for it in items), 2)
        cgst, sgst, igst = tax.cgst_amount, tax.sgst_amount, tax.igst_amount
        grand = tax.total_value or taxable
        rate = tax.gst_rate or 18
    else:
        taxable = round(sum((it.amount or 0) for it in items), 2) if items else (invoice.amount or 0)
        cgst = sgst = igst = 0
        grand = taxable
        mode, rate = 'rcm', 18

    right_b = ParagraphStyle('rr', parent=_INV_DESC, alignment=TA_RIGHT)

    def _sum_row(label, value, bold=True):
        lab = '<b>{}</b>'.format(label) if bold else label
        rs = '<b>Rs.</b>' if bold else 'Rs.'
        amt = ('<b>{:,.2f}</b>' if bold else '{:,.2f}').format(value)
        return [Paragraph(lab, right_b), Paragraph(rs, _INV_DESC), Paragraph(amt, right_b)]

    # --- line items ---
    data = [[Paragraph('DESCRIPTION', _INV_HEAD), Paragraph('', _INV_HEAD),
             Paragraph('AMOUNT', _INV_HEAD_R)]]
    for it in items:
        data.append([Paragraph(_xesc(it.description or ''), _INV_DESC),
                     Paragraph('Rs.', _INV_DESC),
                     Paragraph('{:,.2f}'.format(it.amount or 0),
                               ParagraphStyle('r', parent=_INV_DESC, alignment=TA_RIGHT))])
    if not items:
        data.append([Paragraph('&nbsp;', _INV_DESC), Paragraph('', _INV_DESC), Paragraph('', _INV_DESC)])
    n_items = len(data) - 1

    summary_start = len(data)                       # first summary row (TAXABLE)
    data.append(_sum_row('TAXABLE VALUE OF SUPPLY OF SERVICE', taxable))
    if mode == 'forward':
        if igst:
            data.append(_sum_row('IGST @ {:g}%'.format(rate), igst, bold=False))
        else:
            data.append(_sum_row('CGST @ {:g}%'.format(rate / 2), cgst, bold=False))
            data.append(_sum_row('SGST @ {:g}%'.format(rate / 2), sgst, bold=False))
        data.append(_sum_row('TOTAL INVOICE VALUE', grand))
    last_num_row = len(data) - 1
    words_row = len(data)                           # amount-in-words row index
    data.append([Paragraph('<b>**** {}</b>'.format(_xesc(amount_in_words(grand))), _INV_DESC), '', ''])

    items_tbl = Table(data, colWidths=[130 * mm, 16 * mm, 34 * mm])
    items_tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), primary),
        ('BACKGROUND', (0, last_num_row), (-1, last_num_row),
         colors.HexColor('#eef2f7') if mode == 'forward' else colors.white),
        ('BOX', (0, 0), (-1, -1), 0.8, colors.HexColor('#94a3b8')),
        ('LINEBELOW', (0, 0), (-1, 0), 0.8, colors.HexColor('#94a3b8')),
        ('LINEABOVE', (0, summary_start), (-1, summary_start), 0.8, colors.HexColor('#94a3b8')),
        ('LINEABOVE', (0, words_row), (-1, words_row), 0.8, colors.HexColor('#94a3b8')),
        ('LINEBEFORE', (1, 1), (1, last_num_row), 0.8, colors.HexColor('#94a3b8')),
        ('SPAN', (0, words_row), (-1, words_row)),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 5),
        ('BOTTOMPADDING', (0, 1), (-1, n_items), 22),   # tall description block, like the sample
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(items_tbl)
    story.append(Spacer(1, 8 * mm))

    # --- PAN + firm name row ---
    pan_row = Table([[Paragraph('PAN NO: <b>{}</b>'.format(_xesc(supplier_pan)), _INV_DESC),
                      Paragraph('<b>{}</b>'.format(_xesc(firm_name)),
                                ParagraphStyle('fr', parent=_INV_DESC, alignment=TA_RIGHT))]],
                     colWidths=[90 * mm, 90 * mm])
    pan_row.setStyle(TableStyle([('LEFTPADDING', (0, 0), (0, 0), 0),
                                 ('RIGHTPADDING', (-1, 0), (-1, 0), 0),
                                 ('VALIGN', (0, 0), (-1, -1), 'BOTTOM')]))
    story.append(pan_row)
    story.append(Spacer(1, 4 * mm))

    # --- bank remittance block ---
    if firm and (firm.account_number or firm.bank_name or firm.pay_in_favour_of):
        bank = ("KINDLY PAY IN FAVOUR OF '{payee}'. BANK DETAILS FOR REMITTANCE: {bank} {branch}, "
                "CURRENT A/C NO. {acc}, IFSC CODE – {ifsc}; MICR CODE – {micr}. "
                "PLEASE E-MAIL REMITTANCE PARTICULARS TO {email} ALONG WITH INVOICE NUMBER(S).").format(
            payee=_xesc(firm.pay_in_favour_of or firm_name), bank=_xesc(firm.bank_name),
            branch=_xesc(firm.bank_branch_address), acc=_xesc(firm.account_number),
            ifsc=_xesc(firm.ifsc_code), micr=_xesc(firm.micr_code),
            email=_xesc(firm.remittance_email))
        story.append(Paragraph(bank, _INV_NOTE_B))
        story.append(Spacer(1, 3 * mm))

    # GST note: the reverse-charge paragraph applies only to RCM invoices. Under
    # forward charge the firm has already added the tax, so show a forward-charge
    # declaration instead (and note the tax rate).
    if mode == 'forward':
        tax_kind = 'IGST' if igst else 'CGST + SGST'
        story.append(Paragraph(
            'Tax charged under forward charge mechanism ({} @ {:g}%). '
            'Amount payable includes GST.'.format(tax_kind, rate), _INV_NOTE))
        story.append(Spacer(1, 3 * mm))
    else:
        gst_note = _g(firm, 'gst_note')
        if gst_note:
            story.append(Paragraph(_xesc(gst_note), _INV_NOTE))
            story.append(Spacer(1, 3 * mm))
    iso_note = _g(firm, 'iso_note')
    if iso_note:
        story.append(Paragraph('<b>{}</b>'.format(_xesc(iso_note)), _INV_NOTE))

    # --- authorised signature + seal ---
    if branding:
        story.extend(_signature_flowables(branding))

    doc.build(story)
    return buf.getvalue()

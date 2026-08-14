"""Small helper for building professional-looking PDFs with ReportLab.

Exact layout need not match the old Spring/OpenPDF output — the frontend just
downloads the resulting blob. We aim for clean, readable, data-correct PDFs.
"""

import datetime
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle)

_styles = getSampleStyleSheet()
_H1 = ParagraphStyle('H1x', parent=_styles['Heading1'], fontSize=18, textColor=colors.HexColor('#1f3a8a'))
_H2 = ParagraphStyle('H2x', parent=_styles['Heading2'], fontSize=13, textColor=colors.HexColor('#334155'))
_META = ParagraphStyle('metax', parent=_styles['Normal'], fontSize=9, textColor=colors.grey)
_NORMAL = _styles['Normal']

BRAND = colors.HexColor('#1f3a8a')
HEADER_BG = colors.HexColor('#1f3a8a')
ROW_ALT = colors.HexColor('#f1f5f9')


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


def build_pdf(title, blocks, subtitle=None):
    """blocks: list of dicts:
       {'type':'heading','text':...}
       {'type':'para','text':...}
       {'type':'kv','rows':[(k,v),...]}
       {'type':'table','headers':[...],'rows':[[...]], 'widths':[...] optional}
    """
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=18 * mm, bottomMargin=18 * mm,
                            leftMargin=16 * mm, rightMargin=16 * mm, title=title)
    story = [Paragraph(title, _H1)]
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

    doc.build(story)
    return buf.getvalue()

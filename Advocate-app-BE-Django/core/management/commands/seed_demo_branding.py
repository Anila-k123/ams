"""Give the demo firm (Kumar & Associates — rajesh/priya/suresh) a full set of
branding assets so invoices, reports, emails and the dashboard can be demoed.

Generates placeholder logo / signature / seal / profile-photo PNGs with Pillow
(available via the pdfplumber dependency) into the same uploads/branding folder
real uploads use, and sets the office + brand-colour fields. Idempotent: uses
fixed filenames, so re-running overwrites rather than piling up.

    venv\\Scripts\\python.exe manage.py seed_demo_branding
"""

import os

from django.conf import settings
from django.core.management.base import BaseCommand

from core.models import Advocate
from invoices.models import FirmBillingProfile, DEFAULT_GST_NOTE

PRIMARY = '#1f3a8a'      # deep indigo
SECONDARY = '#c99a2e'    # gold

FIRM = dict(
    office_name='Kumar & Associates',
    office_address='2nd Floor, Temple Tower, Anna Salai',
    city='Chennai', state='Tamil Nadu', country='India', pin_code='600002',
    office_phone='+91 44 2345 6789',
    office_email='contact@kumar-associates.in',
    website='www.kumar-associates.in',
    gst_number='33ABCDE1234F1Z5', pan_number='ABCDE1234F',
    primary_brand_color=PRIMARY, secondary_brand_color=SECONDARY,
)

# Firm's static billing block for GST tax invoices (owned by the practice owner).
FIRM_BILLING = dict(
    pay_in_favour_of='KUMAR & ASSOCIATES',
    bank_name='HDFC BANK LTD.',
    bank_branch_address='Anna Salai Branch, Chennai - 600002',
    account_number='50200012345678',
    ifsc_code='HDFC0000032',
    micr_code='600240004',
    remittance_email='accounts@kumar-associates.in',
    hsn_code='998212',
    service_category='LEGAL SERVICES',
    gst_note=DEFAULT_GST_NOTE,
    iso_note='An ISO 27001 : 2013 Certified Law Firm',
)


def _font(size, bold=False, italic=False):
    from PIL import ImageFont
    win = r'C:\Windows\Fonts'
    names = []
    if bold and italic:
        names += ['arialbi.ttf', 'timesbi.ttf']
    elif bold:
        names += ['arialbd.ttf', 'timesbd.ttf']
    elif italic:
        names += ['ariali.ttf', 'timesi.ttf']
    names += ['arial.ttf', 'times.ttf']
    for n in names:
        try:
            return ImageFont.truetype(os.path.join(win, n), size)
        except OSError:
            continue
    return ImageFont.load_default()


def _center(draw, box, text, font, fill):
    l, t, r, b = draw.textbbox((0, 0), text, font=font)
    w, h = r - l, b - t
    draw.text((box[0] + (box[2] - box[0] - w) / 2 - l,
               box[1] + (box[3] - box[1] - h) / 2 - t), text, font=font, fill=fill)


class Command(BaseCommand):
    help = 'Seed Kumar & Associates branding (logo/signature/seal/photos + office info).'

    def handle(self, *args, **o):
        try:
            from PIL import Image, ImageDraw  # noqa: F401
        except ImportError:
            self.stderr.write('Pillow (PIL) is not available; cannot generate images.')
            return

        brand_dir = os.path.join(settings.DOCUMENT_UPLOAD_DIR, 'branding')
        os.makedirs(brand_dir, exist_ok=True)

        rajesh = Advocate.objects.filter(email='rajesh@kumar-associates.demo').first()
        priya = Advocate.objects.filter(email='priya@kumar-associates.demo').first()
        suresh = Advocate.objects.filter(email='suresh@kumar-associates.demo').first()
        if rajesh is None:
            self.stderr.write('Demo advocates not found — run `seed_demo` first.')
            return

        logo = self._logo(brand_dir)
        seal = self._seal(brand_dir)
        sign = self._signature(brand_dir, 'Rajesh Kumar')

        # The firm letterhead comes from the practice OWNER (rajesh): give him the
        # logo, signature and seal plus office details + brand colours.
        for k, v in FIRM.items():
            setattr(rajesh, k, v)
        rajesh.office_logo_path = logo
        rajesh.signature_path = sign
        rajesh.office_seal_path = seal
        rajesh.profile_photo_path = self._avatar(brand_dir, 'rajesh', 'RK', PRIMARY)
        rajesh.save()
        self.stdout.write('  rajesh: logo + signature + seal + office info + GSTIN/PAN set')

        # Firm billing profile (bank / HSN / GST notes) for the GST tax invoice.
        FirmBillingProfile.objects.update_or_create(
            advocate_id=rajesh.id, defaults=FIRM_BILLING)
        self.stdout.write('  rajesh: firm billing profile set')

        # Team members: office info + a profile photo for the dashboard avatar.
        for adv, key, initials, colour in (
                (priya, 'priya', 'PN', '#8b5cf6'),
                (suresh, 'suresh', 'SK', '#0ea5e9')):
            if adv is None:
                continue
            for k, v in FIRM.items():
                setattr(adv, k, v)
            adv.profile_photo_path = self._avatar(brand_dir, key, initials, colour)
            adv.save()
            self.stdout.write(f'  {key}: office info + profile photo set')

        self.stdout.write(self.style.SUCCESS('Done. Kumar & Associates branding seeded.'))

    # --- image generators (return the stored 'branding/<name>' path) ---------

    def _save(self, img, brand_dir, name):
        img.save(os.path.join(brand_dir, name))
        return f'branding/{name}'

    def _logo(self, brand_dir):
        from PIL import Image, ImageDraw
        img = Image.new('RGB', (400, 400), 'white')
        d = ImageDraw.Draw(img)
        d.rounded_rectangle([20, 20, 380, 380], radius=40, fill=PRIMARY)
        d.rounded_rectangle([40, 40, 360, 360], radius=28, outline=SECONDARY, width=6)
        _center(d, (40, 70, 360, 250), 'K&A', _font(150, bold=True), SECONDARY)
        _center(d, (40, 255, 360, 310), 'KUMAR & ASSOCIATES', _font(26, bold=True), 'white')
        _center(d, (40, 312, 360, 350), 'ADVOCATES · CHENNAI', _font(18), '#dbe2f5')
        return self._save(img, brand_dir, 'demo_ka_logo.png')

    def _seal(self, brand_dir):
        from PIL import Image, ImageDraw
        img = Image.new('RGBA', (360, 360), (255, 255, 255, 0))
        d = ImageDraw.Draw(img)
        d.ellipse([10, 10, 350, 350], outline=PRIMARY, width=8)
        d.ellipse([40, 40, 320, 320], outline=PRIMARY, width=3)
        _center(d, (60, 120, 300, 175), 'KUMAR &', _font(34, bold=True), PRIMARY)
        _center(d, (60, 175, 300, 230), 'ASSOCIATES', _font(34, bold=True), PRIMARY)
        _center(d, (60, 235, 300, 275), '★ CHENNAI ★', _font(22), SECONDARY)
        return self._save(img, brand_dir, 'demo_ka_seal.png')

    def _signature(self, brand_dir, name):
        from PIL import Image, ImageDraw
        img = Image.new('RGBA', (600, 200), (255, 255, 255, 0))
        d = ImageDraw.Draw(img)
        _center(d, (0, 20, 600, 130), name, _font(70, italic=True), '#12234f')
        d.line([60, 150, 540, 150], fill=PRIMARY, width=3)
        return self._save(img, brand_dir, 'demo_rajesh_sign.png')

    def _avatar(self, brand_dir, key, initials, colour):
        from PIL import Image, ImageDraw
        img = Image.new('RGB', (256, 256), colour)
        d = ImageDraw.Draw(img)
        _center(d, (0, 0, 256, 256), initials, _font(110, bold=True), 'white')
        return self._save(img, brand_dir, f'demo_{key}_photo.png')

"""Build the PactPro desktop add-ons (docs/DESKTOP_EDITING.md, "Save to PactPro inside Word / LibreOffice").

    python desktop-addins/build.py                                   LibreOffice extension only
    python desktop-addins/build.py --web https://app.example.in --api https://api.example.in
                                                                     + the Word / Office add-in manifest

Output goes to the frontend's public folder, so PactPro serves it:
    /addins/pactpro.oxt               LibreOffice: double-click to install (Tools > Extension Manager)
    /addins/word/manifest.xml         Office: upload in the Microsoft 365 admin centre (needs HTTPS)
    /addins/word/icon-*.png           the ribbon icons
The task pane (taskpane.html / .js) already lives in public/addins/word.
"""

import argparse
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT.parent / 'Advocate-app-FE-main' / 'public' / 'addins'


def build_oxt():
    # The file name is part of the script URLs in Addons.xcu: keep it pactpro.oxt.
    src = ROOT / 'libreoffice'
    target = OUT / 'pactpro.oxt'
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
        for path in sorted(src.rglob('*')):
            if path.is_file() and '__pycache__' not in path.parts:
                z.write(path, path.relative_to(src).as_posix())
    print(f'LibreOffice extension: {target}')


def build_icons():
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print('Pillow not installed: icons skipped (pip install pillow, or add icon-16/32/80.png yourself)')
        return
    for size in (16, 32, 80):
        img = Image.new('RGBA', (size, size), (31, 35, 40, 255))
        draw = ImageDraw.Draw(img)
        try:
            font = ImageFont.truetype('arialbd.ttf', int(size * 0.7))
        except OSError:
            font = ImageFont.load_default()
        box = draw.textbbox((0, 0), 'P', font=font)
        draw.text(((size - (box[2] - box[0])) / 2 - box[0], (size - (box[3] - box[1])) / 2 - box[1]), 'P',
                  font=font, fill=(255, 255, 255, 255))
        img.save(OUT / 'word' / f'icon-{size}.png')
    print(f'Office icons: {OUT / "word"}')


def build_manifest(web, api):
    for name, url in (('--web', web), ('--api', api)):
        if not url.startswith('https://'):
            raise SystemExit(f'{name} must be an https:// address: Office loads add-ins only over HTTPS.')
    text = (ROOT / 'word' / 'manifest.template.xml').read_text(encoding='utf-8')
    text = text.replace('https://PACTPRO_WEB', web.rstrip('/')).replace('https://PACTPRO_API', api.rstrip('/'))
    target = OUT / 'word' / 'manifest.xml'
    target.write_text(text, encoding='utf-8')
    print(f'Office add-in manifest: {target}')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--web', help="PactPro's web (frontend) address, https://")
    parser.add_argument('--api', help="PactPro's backend address, https:// (the WebDAV links' host)")
    args = parser.parse_args()
    build_oxt()
    build_icons()
    if args.web or args.api:
        build_manifest(args.web or '', args.api or args.web or '')
    else:
        print('Office add-in manifest skipped: pass --web and --api (https) when PactPro is hosted.')


if __name__ == '__main__':
    main()

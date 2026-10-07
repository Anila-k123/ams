# Inlines src/* into a single self-contained HTML page (double-click to open).
#   .\build.ps1                  -> index.html     + dist/artifact.html           ("Red Tape")
#   .\build.ps1 -Theme chambers  -> chambers.html  + dist/artifact-chambers.html  ("Chambers")
#   .build.ps1 -Theme nightcourt -> nightcourt.html + dist/artifact-nightcourt.html ("Night Court", dark-first)
# The artifact files are the same page without <html>/<head>/<body>, for publishing.
param([ValidateSet('redtape', 'chambers', 'nightcourt')][string]$Theme = 'redtape')
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$src = Join-Path $root 'src'
$enc = New-Object System.Text.UTF8Encoding($false)
$read = { param($f) [System.IO.File]::ReadAllText((Join-Path $src $f), $enc) }

$css = & $read 'styles.css'
if ($Theme -ne 'redtape') { $css += "`n`n" + (& $read "theme-$Theme.css") }
$order = @('data.js', 'core.js') + (Get-ChildItem $src -Filter 'pages-*.js' | Sort-Object Name | ForEach-Object Name)
$js = ($order | ForEach-Object { "/* ===== $_ ===== */`n" + (& $read $_) }) -join "`n`n"

$prelude = ''
if ($Theme -eq 'nightcourt') {
  $title = 'PactPro Night Court'; $page = 'nightcourt.html'; $art = 'artifact-nightcourt.html'
  $fontFamilies = 'family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600'
  # Dark-first: start in dark unless the viewer already chose a theme.
  $prelude = "(function(){try{if(!localStorage.getItem('pp_theme'))document.documentElement.dataset.theme='dark'}catch(e){document.documentElement.dataset.theme='dark'}})();`n"
} elseif ($Theme -eq 'chambers') {
  $title = 'PactPro Chambers'; $page = 'chambers.html'; $art = 'artifact-chambers.html'
  $fontFamilies = 'family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Source+Sans+3:ital,wght@0,400;0,500;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;500;600'
} else {
  $title = 'PactPro'; $page = 'index.html'; $art = 'artifact.html'
  $fontFamilies = 'family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400'
}
$fonts = "<link rel=`"preconnect`" href=`"https://fonts.googleapis.com`"><link rel=`"preconnect`" href=`"https://fonts.gstatic.com`" crossorigin><link rel=`"stylesheet`" href=`"https://fonts.googleapis.com/css2?$fontFamilies&display=swap`">"
$bodyInner = "<div id=`"app`"></div>`n<script>`n$prelude$js`n</script>"

$full = "<!doctype html>`n<html lang=`"en-IN`">`n<head>`n<meta charset=`"utf-8`">`n<meta name=`"viewport`" content=`"width=device-width, initial-scale=1, viewport-fit=cover`">`n<title>$title</title>`n<meta name=`"description`" content=`"PactPro redesign demo: practice management for advocates`">`n$fonts`n<style>`n$css`n</style>`n</head>`n<body>`n$bodyInner`n</body>`n</html>`n"
[System.IO.File]::WriteAllText((Join-Path $root $page), $full, $enc)

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
[System.IO.File]::WriteAllText((Join-Path $dist $art), "<title>$title</title>`n$fonts`n<style>`n$css`n</style>`n$bodyInner`n", $enc)
"Built $page ($([math]::Round($full.Length/1kb)) KB, theme $Theme) from: $($order -join ', ')"

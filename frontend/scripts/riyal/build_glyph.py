"""Build the Saudi Riyal sign (U+20C1) as a bundled webfont and an SVG path.

Why this exists
---------------
SAMA introduced the new riyal mark in February 2025 and Unicode encoded it at U+20C1
in version 17.0 (September 2025). No font on a stock macOS, Windows or Android
install carries the glyph yet, so writing the bare character into the UI renders a
tofu box — on screen and, worse, on a thermal receipt. Until OS font stacks catch up,
the only way to display it reliably is to ship the outline with the app.

Source of the outline
---------------------
`official.svg` in this directory is SAMA's own artwork, taken verbatim from
https://www.sama.gov.sa/ar-sa/Currency/Documents/Saudi_Riyal_Symbol-2.svg

Nothing here redraws it. The script only scales it onto an em square and emits:

  frontend/src/styles/riyal-font.css   @font-face with the one-glyph WOFF2 inlined
  frontend/src/lib/riyal-path.ts       the same artwork as an SVG path

so text contexts (anything going through `formatCurrency`) and standalone chrome
(the rate board, the totals) draw the identical shape.

Regenerate with:

    ../../../../env/bin/python build_glyph.py
"""

import base64
import os
import re
import xml.etree.ElementTree as ET

CODEPOINT = 0x20C1
GLYPH_NAME = "uni20C1"

# Fixed head timestamp (2025-02-20, the day the symbol was approved) so the build
# is byte-reproducible.
EPOCH = 3822854400
UPM = 1000
# Currency marks read best aligned to cap height rather than filling the em.
GLYPH_HEIGHT = 740
SIDE_BEARING = 55

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SVG = os.path.join(HERE, "official.svg")


def read_official():
	"""The viewBox and every path's `d`, in document order."""
	tree = ET.parse(SVG)
	root = tree.getroot()
	view_box = [float(v) for v in re.split(r"[ ,]+", root.attrib["viewBox"].strip())]
	paths = [
		element.attrib["d"]
		for element in root.iter("{http://www.w3.org/2000/svg}path")
		if element.attrib.get("d")
	]
	if not paths:
		raise SystemExit("official.svg has no <path d=...>")
	return view_box, paths


def transform(view_box):
	"""Map SVG user units (y down) onto font units (y up), centred on the advance.

	Returns the affine as fontTools expects it, plus the advance width.
	"""
	_x, _y, width, height = view_box
	scale = GLYPH_HEIGHT / height
	advance = round(width * scale) + SIDE_BEARING * 2
	# (xx, xy, yx, yy, dx, dy): flip y, then lift so the artwork sits on the baseline.
	return (scale, 0, 0, -scale, SIDE_BEARING, height * scale), advance


# Quadratic error budget, in font units on a 1000 em. A tenth of a unit is far
# below anything a screen or a receipt printer can resolve.
CU2QU_MAX_ERR = 0.1


def build_glyph(paths, affine):
	"""Scale SAMA's artwork into the em square and convert it to TrueType curves.

	The SVG is cubic; glyf format 0 only stores quadratics, so cu2qu approximates
	them on the way in. The pens compose outermost-last: parse -> transform ->
	cubic-to-quadratic -> glyph.
	"""
	from fontTools.pens.cu2quPen import Cu2QuPen
	from fontTools.pens.transformPen import TransformPen
	from fontTools.pens.ttGlyphPen import TTGlyphPen
	from fontTools.svgLib.path import parse_path

	glyph_pen = TTGlyphPen(None)
	quad_pen = Cu2QuPen(glyph_pen, CU2QU_MAX_ERR)
	# SAMA's file is two <path> elements that together make the mark; both have to
	# land in the one glyph.
	for data in paths:
		parse_path(data, TransformPen(quad_pen, affine))
	return glyph_pen.glyph()


def build_font(path, paths, affine, advance):
	from fontTools.fontBuilder import FontBuilder
	from fontTools.pens.ttGlyphPen import TTGlyphPen

	builder = FontBuilder(UPM, isTTF=True)
	builder.setupGlyphOrder([".notdef", GLYPH_NAME])
	builder.setupCharacterMap({CODEPOINT: GLYPH_NAME})
	builder.setupGlyf({".notdef": TTGlyphPen(None).glyph(), GLYPH_NAME: build_glyph(paths, affine)})
	builder.setupHorizontalMetrics(
		{".notdef": (advance, 0), GLYPH_NAME: (advance, SIDE_BEARING)}
	)
	builder.setupHorizontalHeader(ascent=800, descent=-200)
	builder.setupNameTable(
		{
			"familyName": "Saudi Riyal Sign",
			"styleName": "Regular",
			"uniqueFontIdentifier": "SaudiRiyalSign-Regular-posawesome",
			"fullName": "Saudi Riyal Sign",
			"psName": "SaudiRiyalSign-Regular",
			"version": "Version 1.000",
			"copyright": "Glyph artwork: Saudi Central Bank (SAMA), official Saudi Riyal symbol.",
		}
	)
	builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
	builder.setupPost()
	# Pin the timestamps. Without this every regeneration produces different bytes,
	# and the inlined base64 in riyal-font.css shows up as a diff for no reason.
	builder.font["head"].created = EPOCH
	builder.font["head"].modified = EPOCH
	builder.save(path)


def main():
	view_box, paths = read_official()
	affine, advance = transform(view_box)

	# The font is inlined into CSS rather than shipped as a file. It is under a
	# kilobyte, and Vite empties its own output directory on every build, so a loose
	# font sitting in there would be deleted by the next `npm run build`.
	ttf = os.path.join(HERE, "riyal.ttf")
	woff2 = os.path.join(HERE, "riyal.woff2")

	build_font(ttf, paths, affine, advance)

	from fontTools.ttLib import TTFont

	font = TTFont(ttf)
	font.flavor = "woff2"
	font.save(woff2)
	font.close()
	os.remove(ttf)

	with open(woff2, "rb") as fh:
		encoded = base64.b64encode(fh.read()).decode()

	css_target = os.path.join(APP, "frontend", "src", "styles", "riyal-font.css")
	with open(css_target, "w") as fh:
		fh.write(
			"/*\n"
			" * The Saudi Riyal sign (U+20C1) as a one-glyph font — generated, do not edit.\n"
			" *\n"
			" * Regenerate with frontend/scripts/riyal/build_glyph.py. The artwork is SAMA's\n"
			" * own file (frontend/scripts/riyal/official.svg).\n"
			" *\n"
			" * This family carries exactly one codepoint, so it is listed FIRST in the sans\n"
			" * stack: the browser resolves U+20C1 here and falls through to Inter for every\n"
			" * other character. Inlining it as a data URI keeps it working offline and stops\n"
			" * Vite's emptyOutDir from deleting it.\n"
			" */\n\n"
			"@font-face {\n"
			'\tfont-family: "Saudi Riyal Sign";\n'
			"\tfont-style: normal;\n"
			"\tfont-weight: 100 900;\n"
			"\tfont-display: block;\n"
			f'\tsrc: url("data:font/woff2;base64,{encoded}") format("woff2");\n'
			"\tunicode-range: U+20C1;\n"
			"}\n"
		)

	_x, _y, width, height = view_box
	target = os.path.join(APP, "frontend", "src", "lib", "riyal-path.ts")
	joined = " ".join(paths)
	with open(target, "w") as fh:
		fh.write(
			"/**\n"
			" * The Saudi Riyal sign (U+20C1) — generated, do not edit by hand.\n"
			" *\n"
			" * Artwork is the Saudi Central Bank's own file, carried in\n"
			" * frontend/scripts/riyal/official.svg and turned into these two outputs by\n"
			" * frontend/scripts/riyal/build_glyph.py.\n"
			" *\n"
			" * No stock OS font carries this codepoint yet, so the outline ships with the\n"
			" * app: as an SVG path here for standalone chrome, and as a one-glyph WOFF2 in\n"
			" * the stylesheet so the bare character renders in ordinary text.\n"
			" */\n\n"
			"/** The character itself. Written as an escape so it survives any editor.  */\n"
			'export const RIYAL_CHAR = "\\u20C1";\n\n'
			f"export const RIYAL_VIEWBOX = \"0 0 {width} {height}\";\n\n"
			f'export const RIYAL_PATH =\n\t"{joined}";\n\n'
		)

	print(f"advance {advance}  height {GLYPH_HEIGHT}  subpaths {len(paths)}")
	print(f"woff2: {os.path.getsize(woff2)} bytes")
	print(f"css:   {css_target}")
	print(f"path:  {len(joined)} chars -> {target}")


if __name__ == "__main__":
	main()

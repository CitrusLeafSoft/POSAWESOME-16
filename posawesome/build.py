"""Build hooks.

`bench build --app posawesome` only bundles the desk assets (see the frappe
build command). The POS itself is a standalone vite SPA under frontend/, so it
is not touched by that. An after_build hook makes sure `npm run build` runs
there too, keeping the compiled bundle in sync whenever the app is built.
"""

import os
import subprocess

import frappe


def build_frontend():
	frontend_dir = os.path.join(frappe.get_app_path("posawesome"), "..", "frontend")
	frontend_dir = os.path.abspath(frontend_dir)
	if not os.path.exists(os.path.join(frontend_dir, "package.json")):
		return
	frappe.commands.popen("npm run build", cwd=frontend_dir, raise_err=True)

"""Controller for the POS Awesome SPA shell at /posawesome."""

import frappe

# The shell itself carries no data, but it must never be served to a guest — the
# SPA immediately calls session-scoped endpoints.
no_cache = 1


def get_context(context):
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/login?redirect-to=/posawesome"
		raise frappe.Redirect

	context.csrf_token = frappe.sessions.get_csrf_token()
	context.boot = frappe.as_json(
		{
			"user": frappe.session.user,
			"full_name": frappe.utils.get_fullname(frappe.session.user),
			"sitename": frappe.local.site,
			"lang": frappe.local.lang,
		}
	)
	return context

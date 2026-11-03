app_name = "posawesome"
app_title = "POS Awesome"
app_publisher = "WaleedAboHashima"
app_description = "POS Awesome — a modern point of sale for ERPNext"
app_email = "waleedsabry.abohashima@gmail.com"
app_license = "GPL-3.0"

# ------------------------------------------------------------------------------
# Desk assets
# ------------------------------------------------------------------------------
# The POS itself is a standalone SPA (see posawesome/www/posawesome.html); only the
# doctype form scripts below need to ride along with the desk bundle.

doctype_js = {
	"POS Profile": "posawesome/api/pos_profile.js",
	"Sales Invoice": "posawesome/api/invoice.js",
	"Company": "posawesome/api/company.js",
	"Quotation" : "public/js/quotation.js"
}

override_doctype_class = {
	"Sales Invoice": "posawesome.posawesome.overrides.sales_invoice.PosaSalesInvoice",
}

# ------------------------------------------------------------------------------
# Website
# ------------------------------------------------------------------------------
# Serve the SPA at /posawesome and let vue-router own everything beneath it.

website_route_rules = [
	{"from_route": "/posawesome/<path:app_path>", "to_route": "posawesome"},
]

# ------------------------------------------------------------------------------
# Installation
# ------------------------------------------------------------------------------

after_install = "posawesome.install.after_install"
after_migrate = "posawesome.install.after_migrate"
after_uninstall = "posawesome.uninstall.after_uninstall"
after_build = "posawesome.build.build_frontend"

# ------------------------------------------------------------------------------
# Document events
# ------------------------------------------------------------------------------

doc_events = {
	"Sales Invoice": {
		"validate": "posawesome.posawesome.api.invoice.validate",
		"before_submit": "posawesome.posawesome.api.invoice.before_submit",
		"before_cancel": "posawesome.posawesome.api.invoice.before_cancel",
		"on_update" : "posawesome.posawesome.overrides.sales_invoice.update_quotation_status",
		"on_cancel" : "posawesome.posawesome.overrides.sales_invoice.update_quotation_status_on_cancel"
	},
	"Customer": {
		"validate": "posawesome.posawesome.api.customer.validate",
		"after_insert": "posawesome.posawesome.api.customer.after_insert",
	},
}

# ------------------------------------------------------------------------------
# Scheduled tasks
# ------------------------------------------------------------------------------

scheduler_events = {
	"hourly_long": [
		"posawesome.posawesome.api.offline.prune_expired_sync_log",
	],
}


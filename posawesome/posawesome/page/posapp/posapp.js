// The POS Awesome desk page is now only a redirect. The point of sale itself is a
// standalone SPA served at /posawesome so it boots without the desk bundle.
frappe.pages["posapp"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("POS Awesome"),
		single_column: true,
	});

	window.location.replace("/posawesome");
};

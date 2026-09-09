frappe.ui.form.on('POS Profile', {
	setup: function (frm) {
		frm.set_query("posa_cash_mode_of_payment", function (doc) {
			return {
				filters: { 'type': 'Cash' }
			};
		});
	},
	refresh: async function (frm) {

		await frappe.xcall("posawesome.posawesome.api.pos_profile.get_posa_invoice_naming_series").then(r => {
			console.log("POS Invoice Naming Series:", r.options);
			frm.set_df_property('posa_invoice_naming_series', 'options', r.options);
			frm.refresh_field('posa_invoice_naming_series');
		}).catch(e => {
			console.error(e);
			frappe.msgprint(__("Failed to fetch POS Invoice Naming Series"), __("Error"));
		});
	}
});
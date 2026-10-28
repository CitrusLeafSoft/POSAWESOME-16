frappe.ui.form.on("Quotation", {
    refresh(frm) {
        add_create_si_button(frm);
    }
});

function add_create_si_button(frm) {
    if (
        frm.doc.docstatus === 1 &&
        frm.doc.quotation_to === "Customer" &&
        frm.doc.party_name &&
		!["Invoiced", "Lost", "Expired", "Cancelled"].includes(frm.doc.status)
    ) {
        frm.add_custom_button("POS Sales Invoice", function () {
            open_pos_sale(frm);
        }, "Create");
    }
}

function open_pos_sale(frm) {
    if (!(frm.doc.items || []).some((row) => row.item_code)) {
        frappe.msgprint(__("This quotation has no items to send to the POS."));
        return;
    }

    const params = new URLSearchParams();
    params.set("quotation", frm.doc.name);

    window.open(`/posawesome/sell?${params.toString()}`, "_blank");
}
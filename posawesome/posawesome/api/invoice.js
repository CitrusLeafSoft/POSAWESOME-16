
frappe.ui.form.on('Sales Invoice', {
    setup: function (frm) {
        frm.set_query("posa_delivery_charges", function (doc) {
            return {
                filters: { 'company': doc.company, 'disabled': 0 }
            };
        });
    },
    refresh: function (frm) {
        augment_pos_credit_workflow_status(frm);
    },

    workflow_state: function (frm) {
        augment_pos_credit_workflow_status(frm);
    },
    status: function (frm) {
        augment_pos_credit_workflow_status(frm);
    },
});

const POS_CREDIT_WORKFLOW_NAME = "POS Credit Approval";
const POS_CREDIT_PENDING_STATE = "Pending Credit Approval";
const POS_DISCOUNT_PENDING_STATE = "Pending Discount Approval";
const POS_CREDIT_REJECTED_STATE = "Rejected";

const POS_CREDIT_CSS_MARKER = "posa-credit-posa-status";


function pos_credit_workflow_colour(state) {
    switch (state) {
        case POS_CREDIT_PENDING_STATE:
        case POS_DISCOUNT_PENDING_STATE:
            return "orange";
        case POS_CREDIT_REJECTED_STATE:
            return "red";
        case "Approved":
            return "green";
        case "Cancelled":
            return "blue";
        default:
            return "gray";
    }
}

function pos_credit_doc_status_label(frm) {
    var d = frm.doc;
    if (d.__unsaved) return __("Not Saved");
    if (d.docstatus === 2) return __("Cancelled");
    if (d.docstatus === 0) return __(d.status || "Draft");
    return __(d.status || "Submitted");
}

function pos_credit_reason_html(frm, state) {
    var d = frm.doc;

    if (state === POS_CREDIT_PENDING_STATE) {
        var outstanding = flt(d.grand_total) - flt(d.paid_amount);
        return (
            '<div class="alert alert-warning pos-credit-banner" role="alert">' +
                '<i class="fa fa-info-circle" aria-hidden="true"></i> ' +
                __("This invoice is a POS credit sale taking the ") +
                '<b>' + __(POS_CREDIT_WORKFLOW_NAME) + '</b>' +
                " workflow. " +
                __("It was tendered through the Credit payment mode,") +
                " so " +
                frappe.format(outstanding, { fieldtype: "Currency" }) +
                " remains outstanding and must be approved before it is submitted." +
            '</div>'
        );
    }

    if (state === POS_DISCOUNT_PENDING_STATE) {
        var discounted = [];
        $.each(d.doc.items || [], function (i, item) {
            if (flt(item.custom_nlc) > flt(item.rate)) {
                discounted.push(item.item_name || item.item_code);
            }
        });
        return (
            '<div class="alert alert-warning pos-credit-banner" role="alert">' +
                '<i class="fa fa-info-circle" aria-hidden="true"></i> ' +
                __("This invoice is a POS discount sale taking the ") +
                '<b>' + __(POS_CREDIT_WORKFLOW_NAME) + '</b>' +
                " workflow. " +
                __("Sold below the Normal Lowest Cost (NLC) on: ") +
                frappe.utils.escape_html(discounted.join(", ")) +
                ". " +
                __("It must be approved before it is submitted.") +
            '</div>'
        );
    }

    if (state === POS_CREDIT_REJECTED_STATE) {
        return (
            '<div class="alert alert-danger pos-credit-banner" role="alert">' +
                '<i class="bi bi-x-circle"></i> ' +
                __("This POS credit sale was rejected in the ") + POS_CREDIT_WORKFLOW_NAME +
                " workflow — it has NOT been submitted and no payment has been posted." +
            '</div>'
        );
    }

    return "";
}

function clear_pos_credit_markers(frm) {
    if (frm.page) {
        frm.page.$title_area && frm.page.$title_area.find("." + POS_CREDIT_CSS_MARKER).remove();
        frm.page.main && frm.page.main.find(".pos-credit-banner").remove();
    }
}

function augment_pos_credit_workflow_status(frm) {
    clear_pos_credit_markers(frm);

    frappe.workflow.get_state_fieldname("Sales Invoice");
    var wf = frappe.workflow && frappe.workflow.workflows &&
        frappe.workflow.workflows["Sales Invoice"];
    if (!wf || wf.workflow_name !== POS_CREDIT_WORKFLOW_NAME) return;

    var state = frm.doc.workflow_state || "";

    if (state && frm.doc.custom_is_pos_credit) {
        frm.page.set_indicator(__(state), pos_credit_workflow_colour(state));
        var doc_label = pos_credit_doc_status_label(frm);
        if (doc_label) {
            var $doc_pill = $(
                '<span class="indicator-pill no-indicator-dot ' + POS_CREDIT_CSS_MARKER +
                ' gray-white ml-1" style="background:var(--gray-200);color:var(--text-muted)">' +
                __(doc_label) +
                '</span>'
            );
            frm.page.$title_area.append($doc_pill);
        }
        frm.page.indicator.attr("title", __(state));
    }

    var banner = pos_credit_reason_html(frm, state);
    if (banner && frm.page.main) {
        $(banner).prependTo(frm.page.main);
    }
}
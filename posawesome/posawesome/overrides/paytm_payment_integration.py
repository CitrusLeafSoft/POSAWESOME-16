
import frappe
import requests
from datetime import datetime
from frappe.utils import flt
from posawesome.posawesome.overrides.paytm_checksum import generate_checksum, verify_checksum

PAYTM_MODE_OF_PAYMENT = "Paytm Machine"


def get_paytm_settings():
	return frappe.get_single("Paytm Settings")


def generate_merchant_transaction_id():
	return "POSAOS{}".format(datetime.now().strftime("%Y%m%d%H%M%S%f"))


def _send_sale_request(settings, merchant_transaction_id, amount, date):
	amount = str(int(float(amount) * 100))
	body = {
		"paytmMid": settings.paytm_mid,
		"paytmTid": settings.paytm_tid,
		"transactionDateTime": date,
		"merchantTransactionId": merchant_transaction_id,
		"merchantReferenceNo": merchant_transaction_id,
		"transactionAmount": amount,
	}

	checksum = generate_checksum(body, settings.merchant_key)
	if not verify_checksum(body, settings.merchant_key, checksum):
		return {
			"payment_status": False,
			"status": "CHECKSUM_FAILED",
			"message": "Checksum Verification Failed",
		}

	payload = {
		"head": {
			"requestTimeStamp": date,
			"channelId": settings.channel_id,
			"checksum": checksum,
			"version": settings.version,
		},
		"body": body,
	}

	try:
		response = requests.post(
			settings.sale_request_api_url,
			json=payload,
			headers={"Content-Type": "application/json"},
			timeout=30,
		)
	except requests.RequestException as e:
		frappe.log_error(title="Paytm Sale API Error", message=str(e))
		return {
			"payment_status": False,
			"status": "API_ERROR",
			"message": str(e),
		}

	if response.status_code != 200:
		return {
			"payment_status": False,
			"status": "SALE_API_FAILED",
			"http_code": response.status_code,
			"message": response.text,
		}

	return {
		"payment_status": True,
		"status": "REQUEST_SENT",
		"response": response.json(),
	}


@frappe.whitelist()
def initiate_paytm_payment(amount, sales_invoice=None):
	settings = get_paytm_settings()
	merchant_transaction_id = generate_merchant_transaction_id()
	transaction_datetime = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

	if sales_invoice:
		_save_transaction_reference(sales_invoice, merchant_transaction_id)

	result = _send_sale_request(settings, merchant_transaction_id, amount, transaction_datetime)
	result.update(
		{
			"merchant_transaction_id": merchant_transaction_id,
			"transaction_datetime": transaction_datetime,
		}
	)
	return result


def _save_transaction_reference(sales_invoice, merchant_transaction_id):
	try:
		doc = frappe.get_doc("Sales Invoice", sales_invoice)
		doc.custom_paytm_merchant_transaction_id = merchant_transaction_id
		doc.save()
	except Exception:
		frappe.log_error(
			title="Paytm - save transaction reference",
			message=frappe.get_traceback(),
		)


@frappe.whitelist()
def check_paytm_payment_status(merchant_transaction_id, transaction_datetime, sales_invoice=None, amount=0):
	settings = get_paytm_settings()
	result = _check_paytm_payment_status(settings, merchant_transaction_id, transaction_datetime)

	if result.get("verified") and sales_invoice:
		_record_paytm_payment_on_invoice(sales_invoice, merchant_transaction_id, amount, result)

	return result


def _record_paytm_payment_on_invoice(sales_invoice, merchant_transaction_id, amount, result):
	try:
		doc = frappe.get_doc("Sales Invoice", sales_invoice)
		doc.custom_paytm_merchant_transaction_id = merchant_transaction_id
		doc.custom_paytm_payment_response = result

		if flt(amount):
			doc.append(
				"payments",
				{
					"mode_of_payment": PAYTM_MODE_OF_PAYMENT,
					"amount": flt(amount),
					"base_amount": flt(amount),
				},
			)

		doc.save()
	except Exception:
		frappe.log_error(
			title="Paytm - record payment on invoice",
			message=frappe.get_traceback(),
		)


def _check_paytm_payment_status(settings, merchant_transaction_id, transaction_datetime):
	status_body = {
		"paytmMid": settings.paytm_mid,
		"paytmTid": settings.paytm_tid,
		"transactionDateTime": transaction_datetime,
		"merchantTransactionId": merchant_transaction_id,
	}
	checksum = generate_checksum(status_body, settings.merchant_key)

	if not verify_checksum(status_body, settings.merchant_key, checksum):
		return {
			"verified": False,
			"status": "CHECKSUM_FAILED",
			"message": "Status checksum verification failed",
		}

	status_payload = {
		"head": {
			"requestTimeStamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
			"channelId": settings.channel_id,
			"checksum": checksum,
			"version": settings.version,
		},
		"body": status_body,
	}

	try:
		response = requests.post(
			settings.status_enquiry_api_url,
			json=status_payload,
			headers={"Content-Type": "application/json"},
			timeout=30,
		)
	except requests.RequestException as e:
		frappe.log_error(title="Paytm Status API Error", message=str(e))
		return {
			"verified": False,
			"status": "API_ERROR",
			"message": str(e),
		}

	if response.status_code != 200:
		return {
			"verified": False,
			"status": "HTTP_ERROR",
			"http_code": response.status_code,
			"message": response.text,
		}

	try:
		status_response = response.json()
	except ValueError:
		return {
			"verified": False,
			"status": "INVALID_RESPONSE",
			"message": "Paytm returned an invalid JSON response",
			"response": response.text,
		}

	result_info = status_response.get("body", {}).get("resultInfo", {})

	result_status = result_info.get("resultStatus")
	result_code = result_info.get("resultCode")
	result_code_id = result_info.get("resultCodeId")
	result_message = result_info.get("resultMsg")

	if result_status == "SUCCESS" and result_code == "S" and result_code_id == "0000":
		return {
			"verified": True,
			"status": "VERIFIED",
			"resultCode": result_code,
			"resultCodeId": result_code_id,
			"message": result_message,
			"response": status_response,
		}

	elif result_status in ("PENDING", "U"):
		return {
			"verified": False,
			"status": "PENDING",
			"resultCode": result_code,
			"resultCodeId": result_code_id,
			"message": result_message,
			"response": status_response,
		}

	else:
		return {
			"verified": False,
			"status": "FAILED",
			"resultCode": result_code,
			"resultCodeId": result_code_id,
			"message": result_message,
			"response": status_response,
		}

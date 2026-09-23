import re
import time
import frappe
import requests
from datetime import datetime
from frappe.utils import flt
from posawesome.posawesome.overrides.paytm_checksum import generate_checksum, verify_checksum

PAYTM_MODE_OF_PAYMENT = "Paytm Machine"

MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 2
RETRYABLE_HTTP_CODES = (429, 500, 502, 503, 504)

POLL_MAX_ATTEMPTS = 15
POLL_INTERVAL_SECONDS = 5

_ID_SANITIZE_RE = re.compile(r"[^A-Za-z0-9]")


def get_paytm_settings():
	return frappe.get_single("Paytm Settings")


def generate_merchant_transaction_id(sales_invoice=None):
	if not sales_invoice:
		frappe.throw("Sales Invoice is required to generate a merchant transaction ID")

	return re.sub(r"[^A-Za-z0-9]", "", sales_invoice)


def _post_with_retry(url, payload, error_title):
	last_exception = None

	for attempt in range(1, MAX_RETRIES + 1):
		try:
			print("payload",payload)
			response = requests.post(
				url,
				json=payload,
				headers={"Content-Type": "application/json"},
				timeout=30,
			)
   
   
		except requests.RequestException as e:
			last_exception = e
			frappe.log_error(
				title=f"{error_title} (attempt {attempt}/{MAX_RETRIES})",
				message=str(e),
			)
			if attempt < MAX_RETRIES:
				time.sleep(RETRY_BACKOFF_SECONDS * attempt)
			continue

		if response.status_code != 200:
			frappe.log_error(
				title=f"{error_title} - HTTP {response.status_code} (attempt {attempt}/{MAX_RETRIES})",
				message=response.text,
			)
			if response.status_code in RETRYABLE_HTTP_CODES and attempt < MAX_RETRIES:
				time.sleep(RETRY_BACKOFF_SECONDS * attempt)
				continue
			return response, None

		return response, None

	return None, {
		"status": "API_ERROR",
		"message": str(last_exception) if last_exception else "Unknown error contacting Paytm",
	}


def get_sales_invoice_by_transaction_id(merchant_transaction_id):
	return frappe.db.get_value(
		"Sales Invoice",
		{"custom_paytm_merchant_transaction_id": merchant_transaction_id},
		"name",
	)


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
	print(checksum)
	if not verify_checksum(body, settings.merchant_key, checksum):
		return {
			"payment_status": False,
			"status": "CHECKSUM_FAILED",
			"message": "Checksum Verification Failed",
		}
	print(body,"=========body")
	payload = {
		"head": {
			"requestTimeStamp": date,
			"channelId": settings.channel_id,
			"checksum": checksum,
			"version": settings.version,
		},
		"body": body,
	}

	response, error = _post_with_retry(
		settings.sale_request_api_url, payload, "Paytm Sale API Error"
	)
	if error:
		frappe.log_error(
					title="Sale API failn",
					message=f"merchant_transaction_id={merchant_transaction_id}",
				)
		return {"payment_status": False, **error}
	print(response.status_code,"=========================")
	if response.status_code != 200:
		return {
			"payment_status": False,
			"status": "SALE_API_FAILED",
			"http_code": response.status_code,
			"message": response.text,
		}

	try:
		response_json = response.json()
	except ValueError:
		return {
			"payment_status": False,
			"status": "INVALID_RESPONSE",
			"message": "Paytm returned an invalid JSON response",
			"response": response.text,
		}

	result_info = response_json.get("body", {}).get("resultInfo") or {}
	result_status = result_info.get("resultStatus")

	if result_status and result_status not in ("PENDING", "U"):
		if result_status not in ("SUCCESS","ACCEPTED_SUCCESS"):
			return {
				"payment_status": False,
				"status": "SALE_REQUEST_REJECTED",
				"resultCode": result_info.get("resultCode"),
				"resultCodeId": result_info.get("resultCodeId"),
				"message": result_info.get("resultMsg") or "Paytm rejected the sale request",
				"response": response_json,
			}

	return {
		"payment_status": True,
		"status": "REQUEST_SENT",
		"response": response_json,
	}


@frappe.whitelist()
def initiate_paytm_payment(amount, sales_invoice = None):
	
	settings = get_paytm_settings()

	if not sales_invoice:
		frappe.throw("Sales invoice is required")

	merchant_transaction_id = generate_merchant_transaction_id(sales_invoice)
	transaction_datetime = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

	_save_transaction_reference(sales_invoice, merchant_transaction_id)
	print(settings, merchant_transaction_id, amount, transaction_datetime)
	result = _send_sale_request(settings, merchant_transaction_id, amount, transaction_datetime)
	print(result,"======================result")
	result.update(
		{
			"merchant_transaction_id": merchant_transaction_id,
			"transaction_datetime": transaction_datetime,
		}
	)

	if result.get("payment_status"):
		frappe.enqueue(
			method="posawesome.posawesome.overrides.paytm_payment_integration.poll_paytm_payment_status",
			queue="long",
			timeout=(POLL_MAX_ATTEMPTS * POLL_INTERVAL_SECONDS) + 60,
			enqueue_after_commit=True,
			merchant_transaction_id=merchant_transaction_id,
			transaction_datetime=transaction_datetime,
			amount=amount,
		)
	else:
		_finalize_paytm_payment_on_invoice(merchant_transaction_id, 0, result)

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

	response, error = _post_with_retry(
		settings.status_enquiry_api_url, status_payload, "Paytm Status API Error"
	)
	if error:
		frappe.log_error(
					title="Getting error while status check api call",
					message=f"merchant_transaction_id={merchant_transaction_id}",
				)
		return {"verified": False, **error}

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


def poll_paytm_payment_status(merchant_transaction_id, transaction_datetime, amount=0):
	settings = get_paytm_settings()
	result = None

	for attempt in range(1, POLL_MAX_ATTEMPTS + 1):
		result = _check_paytm_payment_status(settings, merchant_transaction_id, transaction_datetime)

		if result.get("status") != "PENDING":
			break

		if attempt < POLL_MAX_ATTEMPTS:
			time.sleep(POLL_INTERVAL_SECONDS)

	if result is None:
		result = {
			"verified": False,
			"status": "API_ERROR",
			"message": "No response received from Paytm status enquiry",
		}
	elif result.get("status") == "PENDING":
		result = dict(result, status="TIMEOUT", message="Gave up waiting for Paytm to resolve the transaction")

	_finalize_paytm_payment_on_invoice(merchant_transaction_id, amount, result)
	return result


def _finalize_paytm_payment_on_invoice(merchant_transaction_id, amount, result):
	sales_invoice = get_sales_invoice_by_transaction_id(merchant_transaction_id)

	if not sales_invoice:
		frappe.log_error(
			title="Paytm - no invoice found for transaction",
			message=f"merchant_transaction_id={merchant_transaction_id}",
		)
		return

	try:
		doc = frappe.get_doc("Sales Invoice", sales_invoice)
		doc.custom_paytm_payment_response = result

		if result.get("verified") and flt(amount):
			already_recorded = any(
				p.mode_of_payment == PAYTM_MODE_OF_PAYMENT and flt(p.amount) == flt(amount)
				for p in doc.payments
			)
			if not already_recorded:
				doc.append(
					"payments",
					{
						"mode_of_payment": PAYTM_MODE_OF_PAYMENT,
						"amount": flt(amount),
						"base_amount": flt(amount),
					},
				)

		doc.save()
		frappe.db.commit()
	except Exception:
		frappe.log_error(
			title="Paytm - record payment on invoice",
			message=frappe.get_traceback(),
		)


@frappe.whitelist()
def get_paytm_payment_status(sales_invoice=None, merchant_transaction_id=None):
	if not sales_invoice and merchant_transaction_id:
		sales_invoice = get_sales_invoice_by_transaction_id(merchant_transaction_id)

	if not sales_invoice:
		frappe.throw("Provide either sales_invoice or merchant_transaction_id")

	response = frappe.db.get_value(
		"Sales Invoice",
		sales_invoice,
		["custom_paytm_payment_response"],
	)

	return {
		"sales_invoice": sales_invoice,
		"response": response,
	}
 
 
 
 
def check_refund():
	import json
	try:
		paytmParams = dict()

		paytmParams["body"] = {
			"mid"          : "fOCDPB57648908808819",
			"txnType"      : "REFUND",
			"orderId"      : "POSINV2600139",
			"txnId"        : "20260915011650000306664141490996621",
			"refId"        : "REFUNDID_90085765",
			"refundAmount" : "1180000.00",
		}

		print("1. Function started")
		checksum = generate_checksum((paytmParams["body"]), "AnuWFy9OJLiHUxs&")
		print("3. Checksum generated")
		print(checksum,"==========checksum")
		if not verify_checksum((paytmParams["body"]), "AnuWFy9OJLiHUxs&", checksum):
			print("yes")
			return {
				"verified": False,
				"status": "CHECKSUM_FAILED",
				"message": "Status checksum verification failed",
			}
		print("here")
		paytmParams["head"] = {
			"signature"    : checksum
		}

		# post_data = json.dumps(paytmParams)
		# url = "https://securegw.paytmpayments.com/refund/apply"
		url = "https://securegw-stage.paytm.in/refund/apply"
			
		print(paytmParams)
		response = requests.post(url, data = paytmParams, headers = {"Content-type": "application/json"})
		print(response.json())        

		print(response.status_code)
		print(response.text)
				

	except Exception:
		frappe.log_error(
			title="Paytm - Refund Failed",
			message=frappe.get_traceback(),
		)
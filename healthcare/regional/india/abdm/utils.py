import json

import frappe
import requests
from healthcare.regional.india.abdm.abdm_config import get_url


@frappe.whitelist()
def get_authorization_token():
	client_id, client_secret, auth_base_url = frappe.db.get_value(
		'ABDM Integration',
		{
			'company': frappe.defaults.get_user_default("Company"),
			'default': 1
		},
		['client_id', 'client_secret', 'auth_base_url']
	)

	config = get_url('authorization')
	auth_base_url = auth_base_url.rstrip('/')
	url = auth_base_url + config.get('url')
	payload = {
		"clientId": client_id,
		"clientSecret": client_secret
	}
	if not auth_base_url:
		frappe.throw(
			title='Not Configured',
			msg='Base URL not configured in ABDM Integration!',
		)

	req = frappe.new_doc('ABDM Request')
	req.request = json.dumps(payload, indent=4)
	req.url = url
	req.request_name = 'Authorization Token'
	try:
		response = requests.request(
			method=config.get('method'),
			url=url,
			headers={"Content-Type": "application/json; charset=UTF-8"},
			data=json.dumps(payload)
		)
		response.raise_for_status()
		response = response.json()
		req.response = json.dumps(response, indent=4)
		req.status = 'Granted'
		req.insert(ignore_permissions=True)
		return response.get('accessToken'), response.get('tokenType')

	except Exception as e:
		try:
			req.response = json.dumps(response.json(), indent=4)
		except json.decoder.JSONDecodeError:
			req.response = response.text
		req.traceback = e
		req.status = 'Revoked'
		req.insert(ignore_permissions=True)
		traceback = f"Remote URL {url}\nPayload: {payload}\nTraceback: {e}"
		frappe.log_error(message=traceback, title='Cant create session')
		return auth_base_url, None, None


@frappe.whitelist()
def abdm_request(payload, url_key, req_type, rec_headers=None, to_be_enc=None, patient_name=None):
	if payload and isinstance(payload, str):
		payload = json.loads(payload)

	if req_type == 'Health ID':
		url_type = 'health_id_base_url'

	base_url = frappe.db.get_value(
		'ABDM Integration',
		{
			'company': frappe.defaults.get_user_default("Company"),
			'default': 1
		},
		[url_type]
	)
	if not base_url:
		frappe.throw(
			title='Not Configured',
			msg='Base URL not configured in ABDM Integration!'
		)

	config = get_url(url_key)
	base_url = base_url.rstrip('/')
	url = base_url + config.get('url')
	# Check the abdm_config, if the data need to be encypted, encrypts message
	# Build payload with encrypted message
	if config.get('encrypted'):
		message = payload.get('to_encrypt')
		encrypted = get_encrypted_message(message)
		if 'encrypted_msg' in encrypted and encrypted['encrypted_msg']:
			payload[to_be_enc] = payload.pop('to_encrypt')
			payload[to_be_enc] = encrypted['encrypted_msg']

	access_token, token_type = get_authorization_token()

	if not access_token:
		frappe.throw(
			title='Authorization Failed',
			msg='Access token generation for authorization failed, Please try again.'
		)

	authorization = ("Bearer " if token_type == "bearer" else '') + access_token
	headers = {
		'Content-Type': 'application/json',
		'Accept': 'application/json',
		'Authorization': authorization,
	}
	if rec_headers:
		if isinstance(rec_headers, str):
			rec_headers = json.loads(rec_headers)
		headers.update(rec_headers)
	req = frappe.new_doc('ABDM Request')
	req.status = 'Requested'
	# TODO: skip saving or encrypt the data saved
	req.request = json.dumps(payload, indent=4)
	req.url = url
	req.request_name = url_key
	try:
		response = requests.request(
			method=config.get('method'),
			url=url,
			headers=headers,
			data=json.dumps(payload)
		)
		response.raise_for_status()
		if url_key == 'get_card':
			pdf = response.content
			_file = frappe.get_doc({
				"doctype": "File",
				"file_name": 'abha_card{}.png'.format(patient_name),
				"attached_to_doctype": 'Patient',
				"attached_to_name": patient_name,
				"attached_to_field": "abha_card",
				"is_private": 0,
				"content": pdf})
			_file.save()
			frappe.db.commit()
			return _file
		req.response = json.dumps(response.json(), indent=4)
		req.status = 'Granted'
		req.insert(ignore_permissions=True)
		return response.json()

	except Exception as e:
		req.traceback = e
		req.response = json.dumps(response.json(), indent=4)
		req.status = 'Revoked'
		req.insert(ignore_permissions=True)
		traceback = f"Remote URL {url}\nPayload: {payload}\nTraceback: {e}"
		frappe.log_error(message=traceback, title='Cant complete API call')
		return response.json()


def get_encrypted_message(message):
	base_url = frappe.db.get_value(
		'ABDM Integration',
		{
			'company': frappe.defaults.get_user_default("Company"),
			'default': 1
		},
		['health_id_base_url']
	)

	config = get_url('auth_cert')
	url = base_url+config.get('url')
	req = frappe.new_doc('ABDM Request')
	req.status = 'Requested'
	req.url = url
	req.request_name = 'auth_cert'
	try:
		response = requests.request(
			method=config.get('method'),
			url=url,
			headers={'Content-Type': 'application/json'}
		)

		response.raise_for_status()
		pub_key = response.text
		pub_key = pub_key.replace('\n', '').replace(
			'-----BEGIN PUBLIC KEY-----', '').replace('-----END PUBLIC KEY-----', '')
		if pub_key:
			encrypted_msg = rsa_encryption(message, pub_key)
			req.response = encrypted_msg
			req.status = 'Granted'
		req.insert(ignore_permissions=True)
		encrypted = {
			'public_key': pub_key,
			'encrypted_msg': encrypted_msg
		}
		return encrypted

	except Exception as e:
		req.traceback = e
		req.response = json.dumps(response.json(), indent=4)
		req.status = 'Revoked'
		req.insert(ignore_permissions=True)
		traceback = f"Remote URL {url}\nTraceback: {e}"
		frappe.log_error(message=traceback, title='Cant complete API call')
		return None


def rsa_encryption(message, pub_key):
	# TODO:- Use cryptography
	from Crypto.Cipher import PKCS1_v1_5
	from Crypto.PublicKey import RSA
	from base64 import b64decode, b64encode

	message = bytes(message, 'utf-8')
	pubkey = b64decode(pub_key)
	rsa_key = RSA.importKey(pubkey)
	cipher = PKCS1_v1_5.new(rsa_key)
	ciphertext = cipher.encrypt(message)
	emsg = b64encode(ciphertext)
	encrypted_msg = emsg.decode('UTF-8')
	return encrypted_msg


@frappe.whitelist()
def get_health_data(otp, txnId, auth_method):
	confirm_w_otp_payload = {
		"to_encrypt": otp,
		"txnId": txnId
	}
	if auth_method == 'AADHAAR_OTP':
		url_key = 'confirm_w_aadhaar_otp'
	elif auth_method == 'MOBILE_OTP':
		url_key = 'confirm_w_mobile_otp'
	# returns X-Token
	response = abdm_request(confirm_w_otp_payload, url_key, 'Health ID', '', 'otp')
	if response and response.get('token'):
		header = {
			"X-Token": 'Bearer ' + response['token']
		}
		response = abdm_request('', 'get_acc_info', 'Health ID', header, '')
	return response


def set_consent_attachment_details(doc, method=None):
	if doc.consent_for_aadhaar_use:
		file_name = frappe.db.get_value('File', {
			'file_url': doc.consent_for_aadhaar_use
		}, 'name')
		frappe.db.set_value('File', file_name, {
			'attached_to_doctype': 'Patient',
			'attached_to_name': doc.name,
			'attached_to_field': doc.consent_for_aadhaar_use
		})
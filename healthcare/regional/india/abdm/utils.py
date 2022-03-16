from __future__ import unicode_literals
import json
import requests
import frappe
from frappe import _
from healthcare.regional.india.abdm.sandbox_config import get_urls

@frappe.whitelist()
def get_authorization_token():
	client_id, client_secret, base_url = frappe.db.get_value('ABDM Integration', \
		{'company': frappe.defaults.get_user_default("Company"), 'default': 1},\
		['client_id', 'client_secret', 'auth_base_url'])
	url = get_urls()
	payload = {
		"clientId": client_id,
		"clientSecret": client_secret
	}
	if base_url:
		req = frappe.new_doc('ABDM Request')
		req.request = json.dumps(payload, indent=4)
		req.url = base_url+url.get('authorization')[1]
		req.request_name = 'Authorization Token'
		try:
			response = requests.request(
				method=url.get('authorization')[0],
				url=base_url+url.get('authorization')[1],
				headers={"Content-Type": "application/json; charset=UTF-8"},
				data=json.dumps(payload)
			)

			response.raise_for_status()
			req.response = json.dumps(response.json(), indent=4)
			response = json.loads(json.dumps(response.json()))
			req.status = 'Granted'
			req.insert(ignore_permissions=True)
			return response.get('accessToken'), response.get('tokenType')

		except Exception as e:
			req.response = e
			req.status = 'Revoked'
			req.insert(ignore_permissions=True)
			traceback = f"Remote URL {base_url+url.get('authorization')[1]}\nPayload: {payload}\nTraceback: {e}"
			frappe.log_error(message=traceback, title='Cant create session')

@frappe.whitelist()
def abdm_request(payload, url_key, req_type, rec_headers=None):
	if isinstance(payload, str):
		payload = json.dumps(json.loads(payload))

	if req_type == 'Health ID':
		url_type = 'health_id_base_url'

	base_url = frappe.db.get_value('ABDM Integration', \
		{'company': frappe.defaults.get_user_default("Company"), 'default': 1},\
		[url_type])
	if not base_url:
		frappe.throw(title='Not Configured', msg='Base URL not configured in ABDM Integration!')
	url = get_urls()

	access_token, tokenType = get_authorization_token()

	authorization = ("Bearer " if tokenType == "bearer" else '') + access_token
	headers = {'Content-Type': 'application/json', 'Authorization': authorization, 'Accept': 'application/json'}
	if rec_headers:
		headers.update(json.loads(rec_headers))
	if access_token:
		req = frappe.new_doc('ABDM Request')
		req.status = 'Requested'
		#TODO: skip saving or encrypt the data saved
		req.request = json.dumps(json.loads(payload), indent=4)
		req.url = base_url+url.get(url_key)[1]
		req.request_name = url_key
		try:
			response=requests.request(
				method=url.get(url_key)[0],
				url=base_url+url.get(url_key)[1],
				headers=headers,
				data=payload
			)
			response.raise_for_status()
			req.response = json.dumps(response.json(), indent=4)
			response=json.loads(json.dumps(response.json()))
			req.insert(ignore_permissions=True)
			return response

		except Exception as e:
			req.response = e
			req.insert(ignore_permissions=True)
			traceback = f"Remote URL {base_url+url.get(url_key)[1]}\nPayload: {payload}\nTraceback: {e}"
			frappe.log_error(message=traceback, title='Cant complete API call')
			return e
	else:
		return ''

@frappe.whitelist()
def auth_cert_and_rsa_encryption(message):
	base_url = frappe.db.get_value('ABDM Integration', \
		{'company': frappe.defaults.get_user_default("Company"), 'default': 1},\
		['health_id_base_url'])
	url = get_urls()
	req = frappe.new_doc('ABDM Request')
	req.status = 'Requested'
	req.url = base_url+url.get('auth_cert')[1]
	req.request_name = 'auth_cert'
	try:
		response = requests.request(
			method=url.get('auth_cert')[0],
			url=base_url+url.get('auth_cert')[1],
			headers={'Content-Type': 'application/json; charset=UTF-8'}
		)
		response.raise_for_status()
		pub_key = response.text
		pub_key = pub_key.replace('\n', '').replace('-----BEGIN PUBLIC KEY-----', '').replace('-----END PUBLIC KEY-----', '')
		if pub_key:
			encrypted_msg = rsa_encryption(message, pub_key)
			req.response = encrypted_msg
		req.insert(ignore_permissions=True)
		encrypted = {
			'public_key': pub_key,
			'encrypted_msg': encrypted_msg
		}
		return encrypted
	except Exception as e:
		req.response = e
		req.insert(ignore_permissions=True)
		traceback = f"Remote URL {base_url+url.get('auth_cert')[1]}\nTraceback: {e}"
		frappe.log_error(message=traceback, title='Cant complete API call')
		return None

@frappe.whitelist()
def rsa_encryption (message, pub_key):
	# TODO:- Use cryptography
	from Crypto.Cipher import PKCS1_v1_5
	from Crypto.PublicKey import RSA
	from base64 import b64decode, b64encode

	public_key = pub_key
	message = bytes(message, 'utf-8')
	pubkey = b64decode(public_key)
	rsa_key = RSA.importKey(pubkey)
	cipher = PKCS1_v1_5.new(rsa_key)
	ciphertext = cipher.encrypt(message)
	emsg = b64encode(ciphertext)
	encrypted_msg = emsg.decode('UTF-8')
	return encrypted_msg
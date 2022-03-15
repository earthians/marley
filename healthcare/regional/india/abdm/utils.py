from __future__ import unicode_literals
import json
import requests
import frappe
from frappe import _
import os
from healthcare.regional.india.abdm.sandbox_config import get_urls

@frappe.whitelist()
def get_authorization_token():
	client_id, client_secret, base_url = frappe.db.get_value('ABDM Integration', \
		{'company': frappe.db.get_single_value('Global Defaults', 'default_company'), 'default': 1},\
		['client_id', 'client_secret', 'auth_base_url'])
	url = get_urls()
	payload = {
		"clientId": client_id,
		"clientSecret": client_secret
	}
	if base_url:
		req = frappe.new_doc('ABDM Request')
		req.status = 'Requested'
		req.request = json.dumps(payload, indent=1)
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
			req.response = response
			response = json.loads(json.dumps(response.json()))
			req.insert(ignore_permissions=True)
			return response.get('accessToken'), response.get('tokenType')

		except Exception as e:
			req.response = e
			req.insert(ignore_permissions=True)
			traceback = f"Remote URL {base_url+url.get('authorization')[1]}\nPayload: {payload}\nTraceback: {e}"
			frappe.log_error(message=traceback, title='Cant create session')

@frappe.whitelist()
def abdm_request(payload, url_key, req_type):
	if isinstance(payload, str):
		payload = json.dumps(json.loads(payload))

	if req_type == 'Health ID':
		url_type = 'health_id_base_url'

	base_url = frappe.db.get_value('ABDM Integration', \
		{'company': frappe.db.get_single_value('Global Defaults', 'default_company'), 'default': 1},\
		[url_type])
	if not base_url:
		frappe.throw(title='Not Configured', msg='Base URL not configured in ABDM Integration!')
	url = get_urls()

	access_token, tokenType = get_authorization_token()
	if access_token:
		req = frappe.new_doc('ABDM Request')
		req.status = 'Requested'
		#TODO: skip saving or encrypt the data saved
		req.request = json.dumps(payload, indent=1)
		req.url = base_url+url.get(url_key)[1]
		req.request_name = url_key
		try:
			authorization = ("Bearer " if tokenType == "bearer" else '') + access_token
			response=requests.request(
				method=url.get(url_key)[0],
				url=base_url+url.get(url_key)[1],
				headers={'Content-Type': 'application/json', 'Authorization': authorization,
					'Accept': 'application/json'},
				data=payload
			)
			response.raise_for_status()
			req.response = response
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

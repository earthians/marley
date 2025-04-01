import requests
import sys
from urllib.parse import urlparse

NETLOC_LIST = ["marley.frappe.cloud", "marleyhealth.io", ]

def uri_validator(x):
	result = urlparse(x)
	return all([result.scheme, result.netloc, result.path])

def docs_link_exists(body):
	for line in body.splitlines():
		for word in line.split("("):
			if word.startswith("http") and uri_validator(word):
				parsed_url = urlparse(word)
				if any(loc == parsed_url.netloc for loc in NETLOC_LIST) and "/wiki" in parsed_url.path:
					return True

if __name__ == "__main__":
	pr = sys.argv[1]
	response = requests.get("https://api.github.com/repos/earthians/marley/pulls/{}".format(pr))

	if response.ok:
		payload = response.json()
		title = (payload.get("title") or "").lower().strip()
		head_sha = (payload.get("head") or {}).get("sha")
		body = (payload.get("body") or "").lower()

		if (title.startswith("feat")
			and head_sha
			and "no-docs" not in body
			and "backport" not in body
		):
			if docs_link_exists(body):
				print("Documentation Link Found. You're Awesome! 🎉")

			else:
				print("Documentation Link Not Found! ⚠️")
				sys.exit(1)

		else:
			print("Skipping documentation checks... 🏃‍➡️")

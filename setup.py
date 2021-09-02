from setuptools import setup, find_packages

with open("requirements.txt") as f:
	install_requires = f.read().strip().split("\n")

# get version from __version__ variable in healthcare/__init__.py
from healthcare import __version__ as version

setup(
	name="healthcare",
	version=version,
	description="healthcare",
	author="healthcare",
	author_email="healthcare",
	packages=find_packages(),
	zip_safe=False,
	include_package_data=True,
	install_requires=install_requires
)

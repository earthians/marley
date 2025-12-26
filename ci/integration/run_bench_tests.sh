#!/usr/bin/env bash
set -euo pipefail

echo "Starting bench integration test script"

# This script is a template to run bench-based integration tests on a runner
# where Frappe/Bench is already installed and configured. It is intentionally
# conservative: it expects the operator to verify environment and modify site
# and DB names as required.

# Example steps (uncomment and adapt for your environment):
# bench new-site --no-mariadb-socket /path/to/site.local --admin-password admin
# bench --site site.local install-app healthcare
# bench --site site.local run-tests --app healthcare

echo "No automatic actions taken — customize this script for your bench runner."
echo "Suggested steps (example):"
echo "  bench new-site <site> --admin-password <pw>"
echo "  bench --site <site> install-app healthcare"
echo "  bench --site <site> run-tests --app healthcare"

exit 0

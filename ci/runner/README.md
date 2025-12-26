Self-hosted GitHub Actions runner for Frappe Bench
=================================================

Overview
--------
This folder contains helper scripts and guidance to provision a self-hosted GitHub
Actions runner prepared to run Bench-based integration tests. The runner(s) must be
registered to your repository or organization in GitHub and have Docker, Docker Compose
and (optionally) Frappe Bench installed.

High-level steps
----------------
1. Provision an Ubuntu 22.04+ VM (recommended: 4 vCPUs, 8GB RAM, 100GB disk).
2. SSH into the VM and run `setup_runner.sh` to install Docker, Docker Compose, and common tools.
3. Register the GitHub Actions runner using `register_runner.sh` (you must provide a registration token).
4. (Optional) Install Frappe Bench or run Bench inside Docker on the runner. See the Bench notes below.

Files
-----
- `setup_runner.sh` — installs Docker, Docker Compose, Git, and basic utilities.
- `register_runner.sh` — interactive script to download and register the GitHub Actions runner (requires a token).
- `runner.service` — systemd template to run the runner as a service (edit `WorkingDirectory` and `ExecStart`).

Bench notes
-----------
- For integration tests that need a full Frappe bench, you can either:
  - Install Bench and dependencies directly on the runner (more manual), or
  - Use the runner's Docker engine and run a Bench Docker setup (recommended for reproducibility).
- The helper integration script `ci/integration/run_bench_tests.sh` is a template — update it with your bench/site names.

Security
--------
- Protect the repository registration token (short-lived) when executing `register_runner.sh`.
- Limit network exposure of the runner; prefer running it in a private subnet behind a bastion host.

Troubleshooting
---------------
- If GitHub Actions cannot reach the runner, verify the runner service is running and the token is valid.
- Check `/var/log/syslog` and the runner logs under the runner install directory for errors.

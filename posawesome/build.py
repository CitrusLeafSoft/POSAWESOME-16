import os
import shutil
import subprocess

import frappe


def build_frontend():
    frontend_dir = os.path.abspath(
        os.path.join(frappe.get_app_path("posawesome"), "..", "frontend")
    )
    if not os.path.exists(os.path.join(frontend_dir, "package.json")):
        return

    env = {**os.environ, "NODE_ENV": "development"}

    if os.path.exists(os.path.join(frontend_dir, "yarn.lock")) and shutil.which("yarn"):
        install = ["yarn", "install", "--frozen-lockfile", "--production=false"]
    elif os.path.exists(os.path.join(frontend_dir, "package-lock.json")):
        install = ["npm", "ci", "--include=dev"]
    else:
        install = ["npm", "install", "--include=dev"]

    subprocess.run(install, cwd=frontend_dir, env=env, check=True)
    subprocess.run(
        ["npm", "run", "build"],
        cwd=frontend_dir,
        env={**os.environ, "NODE_ENV": "production"},
        check=True,
    )
#!/bin/sh
set -eu

rm -rf /plugin/py_modules
python -m pip install \
  --disable-pip-version-check \
  --no-cache-dir \
  --requirement /plugin/backend/requirements.lock \
  --target /plugin/py_modules

python -c "import sys; sys.path.insert(0, '/plugin/py_modules'); import evdev, pyudev; print('Vendored evdev and pyudev for CPython', sys.version)"

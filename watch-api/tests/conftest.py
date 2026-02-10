import os
import sys

# Allow running tests from repo root: `pytest watch-api/tests`.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


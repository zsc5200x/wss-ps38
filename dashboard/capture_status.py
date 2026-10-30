"""Read-only collector status adapter for the dashboard."""
from __future__ import annotations
import json
from pathlib import Path
from typing import Any, Dict

def read_capture_status(path: Path) -> Dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return {'ok': False, 'status': 'unavailable'}
    except (OSError, ValueError):
        return {'ok': False, 'status': 'invalid'}
    return payload if isinstance(payload, dict) else {'ok': False, 'status': 'invalid'}

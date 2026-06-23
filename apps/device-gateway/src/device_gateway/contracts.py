"""Validação dos jobs contra o JSON Schema exportado de @netx-nms/shared.

Os arquivos em ../contracts/*.schema.json são GERADOS por
`pnpm --filter @netx-nms/shared export:schema`. São a mesma fonte da verdade do Node —
não edite à mão. Se ausentes, a validação é pulada com aviso (scaffold inicial).
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

import structlog
from jsonschema import Draft7Validator

log = structlog.get_logger()

# .../apps/device-gateway/src/device_gateway/contracts.py -> parents[2] = apps/device-gateway
_CONTRACTS_DIR = Path(__file__).resolve().parents[2] / "contracts"


@cache
def _load_validator(name: str) -> Draft7Validator | None:
    path = _CONTRACTS_DIR / f"{name}.schema.json"
    if not path.exists():
        log.warning("contract_schema_missing", schema=name, path=str(path))
        return None
    schema = json.loads(path.read_text(encoding="utf-8"))
    return Draft7Validator(schema)


def validate_job(job: dict[str, Any]) -> None:
    """Lança jsonschema.ValidationError se o job não casar com o contrato."""
    validator = _load_validator("DeviceJob")
    if validator is not None:
        validator.validate(job)

"""Travas de segurança em código (espelha assertJobIsSafe do @netx-nms/shared).

AGENTS.md §1–3: jobs são read-only por padrão; escrita exige aprovação humana
(`approvedBy`). A IA nunca preenche `approvedBy`. O gateway recusa o que violar isso.
"""

from __future__ import annotations

from typing import Any


class UnsafeJobError(RuntimeError):
    """Job viola uma regra de segurança não-negociável."""


def assert_job_is_safe(job: dict[str, Any]) -> dict[str, Any]:
    access_mode = job.get("accessMode", "read")
    if access_mode == "write" and not job.get("approvedBy"):
        raise UnsafeJobError(
            f"Job {job.get('jobId')} ({job.get('kind')}) é de escrita sem approvedBy. "
            "Escrita em equipamento exige aprovação humana explícita."
        )
    return job

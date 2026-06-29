"""Travas de segurança em código (espelha assertJobIsSafe do @netx-nms/shared).

AGENTS.md §1–3: jobs são read-only por padrão; escrita exige aprovação humana
(`approvedBy`). A IA nunca preenche `approvedBy`. O gateway recusa o que violar isso.
"""

from __future__ import annotations

from typing import Any

# Espelha WRITE_KINDS do @netx-nms/shared: kinds inerentemente de escrita exigem approvedBy
# MESMO se accessMode vier 'read' (ninguém burla a aprovação rotulando apply como leitura).
WRITE_KINDS = frozenset({"apply-config", "confirm-commit"})


class UnsafeJobError(RuntimeError):
    """Job viola uma regra de segurança não-negociável."""


def assert_job_is_safe(job: dict[str, Any]) -> dict[str, Any]:
    is_write = job.get("accessMode") == "write" or job.get("kind") in WRITE_KINDS
    if is_write and not job.get("approvedBy"):
        raise UnsafeJobError(
            f"Job {job.get('jobId')} ({job.get('kind')}) é de escrita sem approvedBy. "
            "Escrita em equipamento exige aprovação humana explícita."
        )
    return job

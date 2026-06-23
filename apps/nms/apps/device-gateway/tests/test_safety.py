import pytest

from device_gateway.safety import UnsafeJobError, assert_job_is_safe

BASE = {
    "jobId": "00000000-0000-0000-0000-000000000001",
    "deviceId": "00000000-0000-0000-0000-000000000002",
    "requestedBy": "charles",
    "requestedAt": "2026-06-19T12:00:00.000Z",
    "kind": "connectivity-test",
    "params": {},
}


def test_read_job_ok():
    assert assert_job_is_safe({**BASE, "accessMode": "read"})


def test_default_is_safe():
    assert assert_job_is_safe(dict(BASE))


def test_write_without_approval_rejected():
    with pytest.raises(UnsafeJobError):
        assert_job_is_safe({**BASE, "accessMode": "write"})


def test_write_with_approval_ok():
    assert assert_job_is_safe({**BASE, "accessMode": "write", "approvedBy": "noc-lead"})

"""Entrypoint do device-gateway. Sobe o worker e segura o processo até SIGINT/SIGTERM."""

from __future__ import annotations

import asyncio
import signal

import structlog

from .crypto import CryptoService
from .settings import load_settings
from .terminal import serve_terminal
from .worker import build_worker

log = structlog.get_logger()


async def main() -> None:
    settings = load_settings()
    structlog.configure(
        wrapper_class=structlog.make_filtering_bound_logger(
            __import__("logging").getLevelName(settings.log_level)
        ),
    )
    worker = build_worker(settings)
    crypto = CryptoService.from_key_b64(settings.master_key) if settings.master_key else None
    term_server = await serve_terminal(settings.terminal_host, settings.terminal_port, crypto)
    log.info(
        "device_gateway_started",
        concurrency=settings.concurrency,
        cofre="on" if settings.master_key else "off",
    )

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    await stop.wait()
    log.info("device_gateway_stopping")
    term_server.close()
    await worker.close()


def run() -> None:
    asyncio.run(main())


if __name__ == "__main__":
    run()

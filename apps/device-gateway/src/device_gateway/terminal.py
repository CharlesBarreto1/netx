"""Servidor WebSocket de terminal SSH (uso manual N3).

O gateway é o ÚNICO que abre SSH (§3). O browser fala com a API, que faz proxy de bytes
para este servidor; aqui abrimos um shell interativo (paramiko) e fazemos a ponte.

Protocolo: a primeira mensagem é JSON de init {mgmtIp, username, passwordEnc, sshPort, cols, rows}.
Depois, mensagens de texto = stdin do shell; mensagem "\x1b[resize:COLS,ROWS" redimensiona o PTY.
A saída do shell volta como mensagens de texto.
"""

from __future__ import annotations

import asyncio
import json
import threading
from typing import Any

import structlog

from .crypto import CryptoService

log = structlog.get_logger()
_RESIZE_PREFIX = "\x1b[resize:"


async def serve_terminal(host: str, port: int, crypto: CryptoService | None) -> Any:
    import websockets

    async def handler(ws: Any) -> None:
        await _session(ws, crypto)

    log.info("terminal_server_listening", host=host, port=port)
    return await websockets.serve(handler, host, port, max_size=2**20)


async def _session(ws: Any, crypto: CryptoService | None) -> None:
    import paramiko

    try:
        init = json.loads(await ws.recv())
    except Exception:
        await ws.close()
        return

    password = None
    if crypto is not None and init.get("passwordEnc"):
        password = crypto.decrypt(init["passwordEnc"])

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            init["mgmtIp"],
            port=int(init.get("sshPort", 22)),
            username=init["username"],
            password=password,
            timeout=10,
            allow_agent=False,
            look_for_keys=False,
        )
    except Exception as e:  # noqa: BLE001
        await ws.send(f"\r\n*** falha SSH: {e}\r\n")
        await ws.close()
        return

    chan = client.invoke_shell(
        term="xterm-256color",
        width=int(init.get("cols", 120)),
        height=int(init.get("rows", 30)),
    )
    chan.settimeout(0.2)
    loop = asyncio.get_running_loop()
    stop = threading.Event()

    def pump() -> None:
        while not stop.is_set():
            try:
                data = chan.recv(4096)
            except TimeoutError:
                continue
            except Exception:  # noqa: BLE001
                break
            if not data:
                break
            asyncio.run_coroutine_threadsafe(ws.send(data.decode("utf-8", "replace")), loop)
        asyncio.run_coroutine_threadsafe(_safe_close(ws), loop)

    threading.Thread(target=pump, daemon=True).start()
    log.info("terminal_session_open", host=init.get("mgmtIp"))

    try:
        async for msg in ws:
            text = msg if isinstance(msg, str) else msg.decode("utf-8", "replace")
            if text.startswith(_RESIZE_PREFIX):
                try:
                    cols, rows = text[len(_RESIZE_PREFIX) :].split(",")
                    chan.resize_pty(width=int(cols), height=int(rows))
                except Exception:  # noqa: BLE001
                    pass
            else:
                chan.send(text)
    except Exception:  # noqa: BLE001
        pass
    finally:
        stop.set()
        chan.close()
        client.close()
        log.info("terminal_session_closed", host=init.get("mgmtIp"))


async def _safe_close(ws: Any) -> None:
    try:
        await ws.close()
    except Exception:  # noqa: BLE001
        pass

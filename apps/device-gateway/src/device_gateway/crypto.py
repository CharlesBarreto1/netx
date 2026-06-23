"""CryptoService AES-256-GCM para credenciais de equipamento (ADR 0002).

Formato do ciphertext: ``v1:<iv>:<tag>:<ct>`` (cada parte em base64), espelhando o
CryptoService do NetX principal. A chave-mestra (32 bytes) vem do ambiente e vive SÓ aqui
(§4): apenas o device-gateway cifra/decifra segredo de equipamento.
"""

from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_VERSION = "v1"
_IV_LEN = 12
_TAG_LEN = 16


class CryptoService:
    def __init__(self, key: bytes) -> None:
        if len(key) != 32:
            raise ValueError("chave-mestra deve ter 32 bytes (AES-256)")
        self._key = key

    @classmethod
    def from_key_b64(cls, key_b64: str) -> CryptoService:
        return cls(base64.b64decode(key_b64))

    def encrypt(self, plaintext: str) -> str:
        iv = os.urandom(_IV_LEN)
        sealed = AESGCM(self._key).encrypt(iv, plaintext.encode("utf-8"), None)
        # AESGCM concatena ct||tag; separamos para o formato v1:iv:tag:ct.
        ct, tag = sealed[:-_TAG_LEN], sealed[-_TAG_LEN:]
        return ":".join([_VERSION, _b64(iv), _b64(tag), _b64(ct)])

    def decrypt(self, blob: str) -> str:
        version, iv_b64, tag_b64, ct_b64 = blob.split(":")
        if version != _VERSION:
            raise ValueError(f"versão de ciphertext não suportada: {version!r}")
        iv, tag, ct = _unb64(iv_b64), _unb64(tag_b64), _unb64(ct_b64)
        plaintext = AESGCM(self._key).decrypt(iv, ct + tag, None)
        return plaintext.decode("utf-8")


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _unb64(s: str) -> bytes:
    return base64.b64decode(s)

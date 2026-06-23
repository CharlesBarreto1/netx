import base64
import os

import pytest
from cryptography.exceptions import InvalidTag

from device_gateway.crypto import CryptoService

KEY_B64 = base64.b64encode(os.urandom(32)).decode()


def svc() -> CryptoService:
    return CryptoService.from_key_b64(KEY_B64)


def test_roundtrip():
    c = svc()
    secret = "S3nh@-do-roteador!"
    blob = c.encrypt(secret)
    assert c.decrypt(blob) == secret


def test_format_v1_quatro_partes():
    blob = svc().encrypt("x")
    parts = blob.split(":")
    assert parts[0] == "v1"
    assert len(parts) == 4


def test_iv_aleatorio_gera_ciphertext_diferente():
    c = svc()
    assert c.encrypt("igual") != c.encrypt("igual")


def test_chave_de_tamanho_errado_falha():
    with pytest.raises(ValueError):
        CryptoService(b"curta")


def test_decifrar_com_outra_chave_falha():
    blob = svc().encrypt("segredo")
    outra = CryptoService.from_key_b64(base64.b64encode(os.urandom(32)).decode())
    with pytest.raises(InvalidTag):
        outra.decrypt(blob)

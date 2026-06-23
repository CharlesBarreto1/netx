"""Config validada no boot (pydantic-settings). Falha cedo se faltar."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    redis_url: str = "redis://localhost:6379"
    log_level: str = "INFO"
    concurrency: int = 4

    # Chave-mestra AES-256 (32 bytes em base64) do cofre. SOMENTE este serviço a possui
    # (AGENTS.md §4 / ADR 0002). Sem ela, jobs de credencial falham.
    master_key: str | None = None

    # Diretório onde o gateway materializa a config SNMP do Telegraf (ADR 0003).
    telegraf_config_dir: str = "/etc/telegraf/telegraf.d"

    # Servidor WebSocket de terminal SSH (a API faz proxy de bytes até aqui).
    terminal_host: str = "127.0.0.1"
    terminal_port: int = 8766


def load_settings() -> Settings:
    return Settings()

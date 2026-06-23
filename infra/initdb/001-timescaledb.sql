-- Habilita o TimescaleDB no banco do NetX NMS (roda só na primeira subida do volume).
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Schema das séries temporais do Telegraf, separado do `public` (gerenciado pelo Prisma).
CREATE SCHEMA IF NOT EXISTS metrics;

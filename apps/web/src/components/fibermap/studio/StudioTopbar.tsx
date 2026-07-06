'use client';

/**
 * StudioTopbar — barra de ferramentas do Estúdio FiberMap (h-12).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Mesma ergonomia do estúdio /mapa: voltar pro NetX, modos com atalho de
 * teclado visível (kbd), badge de aviso quando o viewport truncou e contagem
 * de elementos visíveis. Botões de escrita somem sem `fibermap.write`.
 */
import {
  AlertTriangle,
  ChevronLeft,
  Download,
  MousePointer,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Spline,
  Upload,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/Badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/cn';
import type { FibermapElementType } from '@/lib/fibermap-api';

import {
  ELEMENT_TYPE_COLOR,
  ELEMENT_TYPE_ICON,
  MORE_ADD_TYPES,
  QUICK_ADD_TOOLS,
  type StudioMode,
} from './constants';

interface StudioTopbarProps {
  mode: StudioMode;
  onSelectMode: () => void;
  onAddMode: (type: FibermapElementType) => void;
  /** FM-2: entra no modo de desenho de cabo (atalho C). */
  onDrawMode: () => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  count: number;
  truncated: boolean;
  canWrite: boolean;
  canAdmin: boolean;
  /** FM-7: export baixa o KML; import abre o modal (só com write). */
  onExportKml: () => void;
  onImportKml: () => void;
}

export function StudioTopbar({
  mode,
  onSelectMode,
  onAddMode,
  onDrawMode,
  panelOpen,
  onTogglePanel,
  count,
  truncated,
  canWrite,
  canAdmin,
  onExportKml,
  onImportKml,
}: StudioTopbarProps) {
  const t = useTranslations('fibermap');
  const moreActive =
    mode.kind === 'add' && MORE_ADD_TYPES.includes(mode.type);

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface px-2 shadow-sm">
      <Link
        href="/dashboard"
        title={t('studio.topbar.backTitle')}
        className="flex h-8 items-center gap-1 rounded-md px-2 text-sm font-medium text-text-muted hover:bg-surface-hover hover:text-text"
      >
        <ChevronLeft className="h-4 w-4" />
        NetX
      </Link>
      <div className="mx-2 h-6 w-px bg-border" />
      <span className="text-sm font-semibold tracking-tight text-text">
        {t('studio.topbar.title')}
      </span>
      <button
        type="button"
        onClick={onTogglePanel}
        title={t('studio.topbar.panelToggle')}
        className="ml-1 flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text"
      >
        {panelOpen ? (
          <PanelLeftClose className="h-4 w-4" />
        ) : (
          <PanelLeftOpen className="h-4 w-4" />
        )}
      </button>

      <div className="mx-2 h-6 w-px bg-border" />

      <ToolButton
        active={mode.kind === 'select'}
        onClick={onSelectMode}
        icon={<MousePointer className="h-4 w-4" />}
        label={t('studio.toolbar.select')}
        shortcut="V"
      />

      {canWrite && (
        <>
          <div className="mx-2 h-6 w-px bg-border" />
          <ToolButton
            active={mode.kind === 'draw'}
            onClick={onDrawMode}
            icon={<Spline className="h-4 w-4" />}
            label={t('studio.toolbar.drawCable')}
            shortcut="C"
            title={t('studio.toolbar.drawCableTooltip')}
          />
          {QUICK_ADD_TOOLS.map(({ type, shortcut }) => {
            const Icon = ELEMENT_TYPE_ICON[type];
            const label = t(`studio.type.${type}`);
            return (
              <ToolButton
                key={type}
                active={mode.kind === 'add' && mode.type === type}
                onClick={() => onAddMode(type)}
                icon={<Icon className="h-4 w-4" />}
                label={label}
                shortcut={shortcut}
                title={t('studio.toolbar.addTooltip', { type: label })}
              />
            );
          })}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title={t('studio.toolbar.more')}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition',
                  moreActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text',
                )}
              >
                <Plus className="h-4 w-4" />
                <span>{t('studio.toolbar.more')}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="z-[2000]">
              {MORE_ADD_TYPES.map((type) => {
                const Icon = ELEMENT_TYPE_ICON[type];
                return (
                  <DropdownMenuItem key={type} onSelect={() => onAddMode(type)}>
                    <Icon
                      className="h-3.5 w-3.5"
                      style={{ color: ELEMENT_TYPE_COLOR[type] }}
                    />
                    {t(`studio.type.${type}`)}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      <div className="ml-auto flex items-center gap-2">
        {truncated && (
          <Badge tone="warning" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            {t('studio.topbar.truncated')}
          </Badge>
        )}
        <span className="hidden text-xs text-text-muted sm:inline">
          {t('studio.topbar.count', { count })}
        </span>
        <button
          type="button"
          onClick={onExportKml}
          title={t('studio.kml.exportTitle')}
          className="flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-text-muted hover:bg-surface-hover hover:text-text"
        >
          <Download className="h-3.5 w-3.5" />
          KML
        </button>
        {canWrite && (
          <button
            type="button"
            onClick={onImportKml}
            title={t('studio.kml.importTitle')}
            className="flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-text-muted hover:bg-surface-hover hover:text-text"
          >
            <Upload className="h-3.5 w-3.5" />
            KML
          </button>
        )}
        {canAdmin && (
          <Link
            href="/fibermap/settings"
            title={t('studio.topbar.settings')}
            className="flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-text-muted hover:bg-surface-hover hover:text-text"
          >
            <Settings className="h-3.5 w-3.5" />
            {t('studio.topbar.settings')}
          </Link>
        )}
      </div>
    </header>
  );
}

function ToolButton({
  active,
  onClick,
  icon,
  label,
  shortcut,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? (shortcut ? `${label} (${shortcut})` : label)}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-text-muted hover:bg-surface-hover hover:text-text',
      )}
    >
      {icon}
      <span>{label}</span>
      {shortcut && (
        <kbd className="hidden rounded border border-current/30 px-1 text-2xs opacity-60 md:inline">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

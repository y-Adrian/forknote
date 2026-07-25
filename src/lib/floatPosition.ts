/** 与主对话区 .ds-messages 同宽的悬浮层定位 */
export function getMessagesColumnRect(): DOMRect {
  const el = document.querySelector(".ds-messages");
  if (el) return el.getBoundingClientRect();
  const maxW =
    typeof document !== "undefined"
      ? parseInt(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--ds-content-max-width",
          ),
          10,
        ) || 920
      : 920;
  return new DOMRect(
    Math.max(0, (window.innerWidth - maxW) / 2),
    0,
    Math.min(maxW, window.innerWidth - 32),
    window.innerHeight,
  );
}

const DEPTH_STAGGER = 28;

/** 在父浮窗下方为子批注浮窗生成锚点 */
export function anchorRectBelowPanel(
  panel: HTMLElement,
  gap = 12,
): DOMRect {
  const r = panel.getBoundingClientRect();
  return new DOMRect(r.left + DEPTH_STAGGER, r.bottom + gap, r.width, 0);
}

/** Update width / max-height / z-index without moving left/top (avoids blink on resize). */
export function sizeFloatingPanel(
  panel: HTMLElement,
  depth = 0,
  zIndex?: number,
): void {
  const column = getMessagesColumnRect();
  const stagger = depth * DEPTH_STAGGER;
  const width = Math.max(280, column.width - stagger);
  const maxHeight = Math.min(
    420 - depth * 20,
    window.innerHeight * (0.55 - depth * 0.04),
  );

  panel.style.width = `${width}px`;
  panel.style.maxHeight = `${Math.max(200, maxHeight)}px`;
  panel.style.setProperty("--float-depth", String(depth));
  panel.dataset.floatDepth = String(depth);
  panel.style.zIndex = String(zIndex ?? 220 + depth * 14);
}

export function clampPanelPosition(
  panel: HTMLElement,
  left: number,
  top: number,
): { left: number; top: number } {
  const w = panel.offsetWidth || 280;
  const h = panel.offsetHeight || 200;
  const nextLeft = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  const nextTop = Math.max(8, Math.min(top, window.innerHeight - h - 8));
  panel.style.left = `${nextLeft}px`;
  panel.style.top = `${nextTop}px`;
  return { left: nextLeft, top: nextTop };
}

export function positionFloatingPanel(
  panel: HTMLElement,
  anchorRect: DOMRect | null,
  preferBelow = true,
  depth = 0,
  zIndex?: number,
): void {
  sizeFloatingPanel(panel, depth, zIndex);

  const column = getMessagesColumnRect();
  const stagger = depth * DEPTH_STAGGER;
  const left = column.left + stagger;

  const panelHeight = panel.offsetHeight || 200;
  const gap = 10;
  let top: number;

  if (anchorRect) {
    if (
      preferBelow &&
      anchorRect.bottom + gap + panelHeight < window.innerHeight - 16
    ) {
      top = anchorRect.bottom + gap;
    } else {
      top = Math.max(16, anchorRect.top - gap - panelHeight);
    }
  } else {
    top = Math.max(16, window.innerHeight - panelHeight - 120);
  }

  clampPanelPosition(
    panel,
    left,
    Math.max(16, Math.min(top, window.innerHeight - panelHeight - 16)),
  );
}

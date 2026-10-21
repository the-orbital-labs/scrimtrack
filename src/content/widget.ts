export const widgetHostId = 'scrimtrack-page-widget'

export const createWidget = () => {
  if (document.getElementById(widgetHostId)) {
    return null
  }

  const host = document.createElement('div')
  host.id = widgetHostId
  host.hidden = true
  const shadow = host.attachShadow({ mode: 'open' })

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        position: fixed;
        right: max(16px, env(safe-area-inset-right));
        bottom: max(16px, env(safe-area-inset-bottom));
        z-index: 2147483647;
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      :host([hidden]) {
        display: none !important;
      }

      *, *::before, *::after {
        box-sizing: border-box;
      }

      .widget {
        display: grid;
        gap: 10px;
        width: min(312px, calc(100vw - 32px));
        border: 1px solid rgba(22, 33, 52, 0.16);
        border-radius: 8px;
        padding: 12px;
        background: #ffffff;
        box-shadow: 0 18px 42px rgba(12, 18, 31, 0.22);
        color: #101828;
        font: inherit;
      }

      .widget.is-collapsed {
        width: auto;
        min-width: 188px;
        padding: 8px;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        cursor: grab;
        touch-action: none;
        user-select: none;
      }

      .widget-controls {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 6px;
      }

      .brand {
        display: inline-flex;
        align-items: center;
        min-width: 0;
        gap: 8px;
        font-weight: 800;
      }

      .mark {
        display: inline-grid;
        flex: 0 0 auto;
        width: 24px;
        height: 24px;
        place-items: center;
        border-radius: 6px;
        background: #111827;
        color: #ffffff;
        font-size: 11px;
        font-weight: 900;
      }

      .status {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        color: #344054;
        font-size: 12px;
        font-weight: 800;
        white-space: nowrap;
      }

      .dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #16a34a;
      }

      .dot.is-paused {
        background: #b42318;
      }

      .dot.is-idle {
        background: #f59e0b;
      }

      .icon-button {
        display: inline-grid;
        flex: 0 0 auto;
        width: 28px;
        height: 28px;
        place-items: center;
        border: 1px solid rgba(22, 33, 52, 0.16);
        border-radius: 6px;
        background: #f8fafc;
        color: #101828;
        font: inherit;
        font-size: 16px;
        line-height: 1;
        cursor: pointer;
      }

      .icon-button:hover {
        border-color: #7c3aed;
        color: #6d28d9;
      }

      .icon-button:focus-visible,
      .button:focus-visible {
        outline: 3px solid rgba(124, 58, 237, 0.28);
        outline-offset: 2px;
      }

      .collapsed-line {
        display: none;
        align-items: center;
        gap: 8px;
        cursor: grab;
        touch-action: none;
        user-select: none;
      }

      .widget.is-dragging .header,
      .widget.is-dragging .collapsed-line {
        cursor: grabbing;
      }

      .widget.is-collapsed .header,
      .widget.is-collapsed .body,
      .widget.is-collapsed .actions {
        display: none;
      }

      .widget.is-collapsed .collapsed-line {
        display: flex;
        cursor: default;
        touch-action: auto;
      }

      .body {
        display: grid;
        gap: 10px;
      }

      .metrics {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .metric {
        display: grid;
        gap: 4px;
        min-width: 0;
        border: 1px solid rgba(22, 33, 52, 0.12);
        border-radius: 7px;
        padding: 9px;
        background: #f8fafc;
        color: #667085;
        font-size: 12px;
        font-weight: 800;
      }

      .metric strong {
        overflow-wrap: anywhere;
        color: #101828;
        font-size: 20px;
        line-height: 1;
      }

      .progress {
        display: grid;
        gap: 6px;
        color: #667085;
        font-size: 12px;
        font-weight: 800;
      }

      .progress-label {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }

      .progress-label strong {
        color: #101828;
      }

      .track {
        overflow: hidden;
        height: 7px;
        border-radius: 999px;
        background: #e4e7ec;
      }

      .track span {
        display: block;
        width: 0%;
        height: 100%;
        border-radius: inherit;
        background: #16a34a;
        transition: width 180ms ease;
      }

      .actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .button {
        min-height: 34px;
        border: 1px solid rgba(22, 33, 52, 0.16);
        border-radius: 7px;
        padding: 7px 10px;
        background: #ffffff;
        color: #101828;
        font: inherit;
        font-size: 13px;
        font-weight: 800;
        cursor: pointer;
      }

      .button.primary {
        border-color: #7c3aed;
        background: #7c3aed;
        color: #ffffff;
      }

      .button:hover {
        border-color: #7c3aed;
        color: #6d28d9;
      }

      .button.primary:hover {
        color: #ffffff;
        background: #6d28d9;
      }
    </style>

    <aside class="widget" aria-label="ScrimTrack page widget">
      <div class="collapsed-line" data-drag-handle>
        <span class="mark" aria-hidden="true">ST</span>
        <span class="status">
          <span class="dot" data-status-dot></span>
          <span data-collapsed-status>Tracking</span>
        </span>
        <span class="widget-controls">
          <button class="icon-button" type="button" title="Expand widget" aria-label="Expand widget" data-expand>+</button>
          <button class="icon-button" type="button" title="Close widget" aria-label="Close widget" data-close>&times;</button>
        </span>
      </div>

      <div class="header" data-drag-handle>
        <span class="brand">
          <span class="mark" aria-hidden="true">ST</span>
          ScrimTrack
        </span>
        <span class="widget-controls">
          <button class="icon-button" type="button" title="Collapse widget" aria-label="Collapse widget" data-collapse>-</button>
          <button class="icon-button" type="button" title="Close widget" aria-label="Close widget" data-close>&times;</button>
        </span>
      </div>

      <div class="body">
        <span class="status">
          <span class="dot" data-status-dot></span>
          <span data-status-text>Tracking</span>
        </span>

        <div class="metrics">
          <span class="metric">
            Today
            <strong data-today>0m</strong>
          </span>
          <span class="metric">
            Goal
            <strong data-goal>30m</strong>
          </span>
        </div>

        <div class="progress">
          <div class="progress-label">
            <span data-progress-label>0m remaining</span>
            <strong data-progress-percent>0%</strong>
          </div>
          <div class="track" aria-hidden="true">
            <span data-progress-bar></span>
          </div>
        </div>
      </div>

      <div class="actions">
        <button class="button primary" type="button" data-open-dashboard>Dashboard</button>
        <button class="button" type="button" data-toggle-tracking>Pause</button>
      </div>
    </aside>
  `

  document.documentElement.append(host)

  return {
    host,
    shadow,
    widget: shadow.querySelector<HTMLElement>('.widget'),
    statusDots: shadow.querySelectorAll<HTMLElement>('[data-status-dot]'),
    statusText: shadow.querySelector<HTMLElement>('[data-status-text]'),
    collapsedStatus: shadow.querySelector<HTMLElement>('[data-collapsed-status]'),
    today: shadow.querySelector<HTMLElement>('[data-today]'),
    goal: shadow.querySelector<HTMLElement>('[data-goal]'),
    progressLabel: shadow.querySelector<HTMLElement>('[data-progress-label]'),
    progressPercent: shadow.querySelector<HTMLElement>('[data-progress-percent]'),
    progressBar: shadow.querySelector<HTMLElement>('[data-progress-bar]'),
    toggleTracking: shadow.querySelector<HTMLButtonElement>('[data-toggle-tracking]'),
    openDashboard: shadow.querySelector<HTMLButtonElement>('[data-open-dashboard]'),
    collapse: shadow.querySelector<HTMLButtonElement>('[data-collapse]'),
    expand: shadow.querySelector<HTMLButtonElement>('[data-expand]'),
    closeButtons: shadow.querySelectorAll<HTMLButtonElement>('[data-close]'),
    dragHandles: shadow.querySelectorAll<HTMLElement>('[data-drag-handle]'),
  }
}

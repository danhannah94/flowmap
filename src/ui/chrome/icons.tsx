// Small line icons for the toolbar (18 px, currentColor).
import type { ReactNode } from 'react';

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const icons = {
  undo: (
    <Icon>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Icon>
  ),
  redo: (
    <Icon>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </Icon>
  ),
  connect: (
    <Icon>
      <circle cx="5" cy="12" r="2.5" />
      <path d="M7.5 12h9" />
      <path d="m14 8.5 4 3.5-4 3.5" />
    </Icon>
  ),
  duplicate: (
    <Icon>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </Icon>
  ),
  delete: (
    <Icon>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V4h6v3" />
    </Icon>
  ),
  unpin: (
    <Icon>
      <path d="M12 17v5" />
      <path d="M9 10.8V4h6v6.8l2.5 3.2h-11z" />
      <path d="m3 3 18 18" />
    </Icon>
  ),
  relayout: (
    <Icon>
      <rect x="3" y="4" width="7" height="5" rx="1" />
      <rect x="14" y="4" width="7" height="5" rx="1" />
      <rect x="8.5" y="15" width="7" height="5" rx="1" />
      <path d="M6.5 9v2.5h11V9M12 11.5V15" />
    </Icon>
  ),
  addLane: (
    <Icon>
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <path d="M3 15h8M3 20h8" />
      <path d="M17 14v6M14 17h6" />
    </Icon>
  ),
  direction: (
    <Icon>
      <path d="M4 7h13l-3-3M17 7l-3 3" />
      <path d="M7 11v9l-3-3M7 20l3-3" />
    </Icon>
  ),
  styles: (
    <Icon>
      <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.9 1.2-1.8-.5-1-.1-2.2 1.1-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z" />
      <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />
      <circle cx="10.5" cy="7" r="1.2" fill="currentColor" />
      <circle cx="15" cy="8" r="1.2" fill="currentColor" />
    </Icon>
  ),
  fit: (
    <Icon>
      <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
      <rect x="8.5" y="9" width="7" height="6" rx="1" />
    </Icon>
  ),
  exportSvg: (
    <Icon>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
    </Icon>
  ),
  exportPng: (
    <Icon>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="m21 16-5-5-8 8" />
    </Icon>
  ),
  sun: (
    <Icon>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Icon>
  ),
  moon: (
    <Icon>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </Icon>
  ),
  zoomIn: (
    <Icon size={16}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  ),
  zoomOut: (
    <Icon size={16}>
      <path d="M5 12h14" />
    </Icon>
  ),
  keyboard: (
    <Icon>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </Icon>
  ),
  back: (
    <Icon>
      <path d="m14 6-6 6 6 6" />
    </Icon>
  ),
};

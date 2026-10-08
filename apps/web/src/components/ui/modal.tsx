'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import X from 'lucide-react/dist/esm/icons/x';
import { cn } from '@/lib/utils';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  placement?: 'center' | 'drawer';
}
const sizeClasses = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl', full: 'max-w-4xl' };
const FooterContext = React.createContext<HTMLDivElement | null | undefined>(undefined);
const openDialogs: HTMLDivElement[] = [];
let originalBodyOverflow = '';
let originalFocus: HTMLElement | null = null;

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')]
    .filter(element => {
      if (element.tabIndex < 0 || element.matches(':disabled, input[type="hidden"]') || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
      for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
        if (ancestor === dialog) break;
      }
      return true;
    });
}

function focusFirst(dialog: HTMLElement) {
  const controls = focusableElements(dialog);
  const target = controls.find(element => element.getAttribute('aria-invalid') === 'true')
    || controls.find(element => element.hasAttribute('autofocus'))
    || controls.find(element => !element.hasAttribute('data-modal-close'))
    || controls[0] || dialog;
  target.focus();
}

export function Modal({ isOpen, onClose, title, description, children, size = 'md', placement = 'center' }: ModalProps) {
  const modalRef = React.useRef<HTMLDivElement>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const [footerContainer, setFooterContainer] = React.useState<HTMLDivElement | null>(null);
  const titleId = React.useId(), descriptionId = React.useId();

  // ponytail: close is synchronous and controlled by the caller. No exit timer
  // can call onClose twice or outlive the dialog; callers can refuse a dirty close.
  const handleClose = React.useCallback(() => onCloseRef.current(), []);

  React.useLayoutEffect(() => {
    if (!isOpen || !modalRef.current) return;
    const dialog = modalRef.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (openDialogs.length === 0) {
      originalBodyOverflow = document.body.style.overflow;
      originalFocus = trigger;
    }
    openDialogs.push(dialog);
    // DOM stacking order, not child-first React layout-effect order.
    openDialogs.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    document.body.style.overflow = 'hidden';
    const isTopmost = () => openDialogs[openDialogs.length - 1] === dialog;
    if (isTopmost()) focusFirst(dialog);
    const handleFocus = (event: FocusEvent) => {
      if (isTopmost() && !dialog.contains(event.target as Node)) focusFirst(dialog);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopmost()) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); handleClose();
      } else if (event.key === 'Tab') {
        const controls = focusableElements(dialog);
        const index = controls.indexOf(document.activeElement as HTMLElement);
        if (!controls.length) { event.preventDefault(); dialog.focus(); }
        else if (event.shiftKey && index <= 0) { event.preventDefault(); controls[controls.length - 1].focus(); }
        else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) { event.preventDefault(); controls[0].focus(); }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocus);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocus);
      const wasTopmost = isTopmost();
      openDialogs.splice(openDialogs.indexOf(dialog), 1);
      if (!openDialogs.length) {
        document.body.style.overflow = originalBodyOverflow;
        if (originalFocus?.isConnected) originalFocus.focus();
        originalFocus = null;
      } else if (wasTopmost && trigger?.isConnected) trigger.focus();
    };
  }, [isOpen, handleClose]);

  React.useLayoutEffect(() => {
    const dialog = modalRef.current;
    // Portal footer controls exist only after the target ref has mounted.
    if (isOpen && footerContainer && dialog && openDialogs[openDialogs.length - 1] === dialog) focusFirst(dialog);
  }, [isOpen, footerContainer]);

  const lastInvalidField = React.useRef<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    if (!isOpen || !modalRef.current) { lastInvalidField.current = null; return; }
    const firstInvalid = focusableElements(modalRef.current).find(element => element.getAttribute('aria-invalid') === 'true') || null;
    if (openDialogs[openDialogs.length - 1] === modalRef.current && firstInvalid && firstInvalid !== lastInvalidField.current) firstInvalid.focus();
    lastInvalidField.current = firstInvalid;
  });

  if (!isOpen) return null;
  return <div className={cn('fixed inset-0 z-50 flex', placement === 'drawer' ? 'items-stretch justify-start' : 'items-center justify-center p-4')}>
    <div className="absolute inset-0 bg-black/50" onClick={handleClose} aria-hidden="true" />
    <div ref={modalRef} role="dialog" aria-modal="true" tabIndex={-1}
      aria-labelledby={title ? titleId : undefined} aria-describedby={description ? descriptionId : undefined}
      className={cn('relative z-10 flex w-full flex-col border bg-card text-card-foreground shadow-lg', placement === 'drawer' ? 'h-dvh max-w-[18rem]' : 'max-h-[90dvh] rounded-container motion-safe:animate-scale-in', placement === 'center' && sizeClasses[size])}>
      <div className="flex shrink-0 items-start justify-between gap-4 border-b p-4">
        <div className="min-w-0">
          {title && <h2 id={titleId} className="text-lg font-semibold">{title}</h2>}
          {description && <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        <button type="button" data-modal-close onClick={handleClose} aria-label="Close"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-button transition-colors hover:bg-muted">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <FooterContext.Provider value={footerContainer}>
        <div data-modal-body className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </FooterContext.Provider>
      <div ref={setFooterContainer} className="shrink-0 empty:hidden" />
    </div>
  </div>;
}

interface ModalFooterProps { children: React.ReactNode; className?: string }
export function ModalFooter({ children, className }: ModalFooterProps) {
  const container = React.useContext(FooterContext);
  const footer = <div className={cn('flex flex-wrap items-center justify-end gap-3 border-t p-4', className)}>{children}</div>;
  // Existing footer actions use explicit handlers. A submit action must supply
  // its native form="id" association when rendered outside the scrolling form.
  if (container === undefined) return footer;
  return container ? createPortal(footer, container) : null;
}

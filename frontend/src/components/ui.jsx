import { useEffect, useRef } from 'react';

export function RequestError({ error }) {
  if (!error) return null;
  return <div className="notice notice-error" role="alert">
    <strong>{error.message}</strong>
    {error.requestId && <span>Request ID: <code>{error.requestId}</code></span>}
  </div>;
}

export function Dialog({ title, onClose, returnFocus, children, className = '' }) {
  const panel = useRef(null);
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    const shell = document.getElementById('app-shell');
    if (shell) shell.inert = true;
    closeRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...panel.current.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href]')];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (shell) shell.inert = false;
      if (previous?.isConnected) previous.focus();
      else returnFocus?.current?.focus();
    };
  }, [returnFocus]);

  return <div className="dialog-backdrop">
    <section ref={panel} className={`dialog-panel ${className}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="dialog-top"><div><p className="eyebrow">API Monitor</p><h2>{title}</h2></div>
        <button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label="Close panel">×</button>
      </div>
      {children}
    </section>
  </div>;
}

// Stub: replaced by Task 6 (settings dialog).
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="glass-strong w-full max-w-sm rounded-2xl p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <p className="text-sm font-medium">Settings</p>
        <p className="mt-1 text-xs text-muted-foreground">Coming soon.</p>
        <button onClick={onClose} className="mt-4 h-8 rounded-lg border border-foreground/10 px-3 text-xs text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
          Close
        </button>
      </div>
    </div>
  );
}

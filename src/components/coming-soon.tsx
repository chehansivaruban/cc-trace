// Placeholder shown by views and pages that aren't built yet. Delete once nothing imports it.
export function ComingSoon({ title, text, onBack }: { title: string; text?: string; onBack?: () => void }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text ?? "Coming soon."}</p>
        {onBack && (
          <button
            onClick={onBack}
            className="mt-4 h-8 rounded-lg border border-foreground/10 px-3 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            Back to the session
          </button>
        )}
      </div>
    </div>
  );
}

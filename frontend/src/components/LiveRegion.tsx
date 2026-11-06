/** Announces status changes politely (spec 5.4). Only meaningful changes are passed in. */
export function LiveRegion({ message }: { message: string }) {
  return (
    <div
      className="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="live-region"
    >
      {message}
    </div>
  );
}

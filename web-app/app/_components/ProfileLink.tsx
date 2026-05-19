"use client";

// Renders a button (not an anchor) so it can sit safely inside another <a>
// (e.g. inside a Next <Link> that wraps a whole card). Opens the URL in a new
// tab on click without triggering the outer link.
export function ProfileLink({
  href,
  label = "profile ↗",
  className = "",
}: {
  href: string;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(href, "_blank", "noopener,noreferrer");
      }}
      className={className}
    >
      {label}
    </button>
  );
}

import * as React from "react";

/**
 * Product identity. The glyph is drawn from the same paths as static/icon.png so the
 * header mark and the Marketplace icon are one logo.
 */
export const BRAND = {
  id: "repo-dependency-mapper",
  name: "Repository Dependency Mapper",
  tagline: "Map cross-repo dependencies, deployment order and circular references",
};

export const BrandGlyph: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable={false}
  >
    <circle cx="12" cy="4.5" r="2.5" />
    <path d="m10.2 6.3-3.9 3.9" />
    <circle cx="4.5" cy="12" r="2.5" />
    <path d="M7 12h10" />
    <circle cx="19.5" cy="12" r="2.5" />
    <path d="m13.8 17.7 3.9-3.9" />
    <circle cx="12" cy="19.5" r="2.5" />
  </svg>
);

import type { ReactNode } from "react";

import "./Nav.css";

export function Nav({ solid, children }: { solid: boolean; children?: ReactNode }) {
  return (
    <header className="nav" data-solid={solid}>
      <a className="brand" href="#top">
        <span className="brand-mark" aria-hidden="true" />
        Intraday averages
      </a>
      <div className="nav-actions">{children}</div>
    </header>
  );
}

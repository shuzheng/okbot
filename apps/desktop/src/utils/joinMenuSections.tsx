import { Fragment, type ReactNode } from 'react';

type MenuSection = ReactNode | ReactNode[] | null | undefined | false;

function sectionItems(section: MenuSection): ReactNode[] {
  if (section == null || section === false) return [];
  const raw = Array.isArray(section) ? section : [section];
  return raw.filter((n) => n != null && n !== false && n !== true);
}

/**
 * Join context-menu blocks with `.menu-sep` dividers.
 * Empty blocks are skipped so menus never show adjacent, leading,
 * or trailing-only separators when items are conditionally absent.
 */
export function joinMenuSections(...sections: MenuSection[]): ReactNode[] {
  const out: ReactNode[] = [];
  let n = 0;
  for (const section of sections) {
    const items = sectionItems(section);
    if (items.length === 0) continue;
    if (out.length > 0) {
      out.push(<div key={`menu-sep-${n}`} className="menu-sep" />);
    }
    out.push(<Fragment key={`menu-sec-${n}`}>{items}</Fragment>);
    n += 1;
  }
  return out;
}

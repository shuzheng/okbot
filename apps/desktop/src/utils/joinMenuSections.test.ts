import assert from 'node:assert/strict';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { joinMenuSections } from './joinMenuSections';

type ItemProps = { 'data-id'?: string; className?: string; children?: ReactNode };

function collectTypes(nodes: ReactNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (!isValidElement(n)) continue;
    const el = n as ReactElement<ItemProps>;
    if (el.props.className === 'menu-sep') {
      out.push('sep');
      continue;
    }
    const kids = el.props.children;
    const arr = Array.isArray(kids) ? kids : kids != null ? [kids] : [];
    for (const k of arr) {
      if (!isValidElement(k)) continue;
      const child = k as ReactElement<ItemProps>;
      out.push(child.props['data-id'] ?? 'item');
    }
  }
  return out;
}

function item(id: string) {
  return createElement('button', { 'data-id': id }, id);
}

{
  const nodes = joinMenuSections(
    [item('a'), item('b')],
    [item('c')],
    [item('d'), item('e')],
  );
  assert.deepEqual(collectTypes(nodes), ['a', 'b', 'sep', 'c', 'sep', 'd', 'e']);
}

{
  // Empty middle block collapses — no adjacent seps
  const nodes = joinMenuSections(
    [item('pin'), null, item('unread')],
    [item('rename'), false],
    [null, undefined, false],
    [item('hide'), item('delete')],
  );
  assert.deepEqual(collectTypes(nodes), [
    'pin',
    'unread',
    'sep',
    'rename',
    'sep',
    'hide',
    'delete',
  ]);
}

{
  // Leading empty + trailing empty — no leading/trailing sep
  const nodes = joinMenuSections([null], [item('up'), item('down')], [false]);
  assert.deepEqual(collectTypes(nodes), ['up', 'down']);
}

{
  assert.deepEqual(joinMenuSections([null], false, []), []);
}

{
  const nodes = joinMenuSections([item('only')]);
  assert.deepEqual(collectTypes(nodes), ['only']);
}

console.log('joinMenuSections.test.ts: ok');

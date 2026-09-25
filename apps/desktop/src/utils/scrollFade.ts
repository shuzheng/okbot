export function updateScrollFade(el: HTMLElement | null) {
  if (!el) return;
  const { scrollTop, scrollHeight, clientHeight } = el;
  const canScroll = scrollHeight > clientHeight + 1;
  el.classList.toggle('can-scroll', canScroll);
  el.classList.toggle('fade-top', canScroll && scrollTop > 1);
  el.classList.toggle('fade-bottom', canScroll && scrollTop + clientHeight < scrollHeight - 1);
}

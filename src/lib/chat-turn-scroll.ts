/** Position a submitted user turn once; replies never own the viewport. */
export function createChatTurnScroll(
  container: HTMLElement,
  content: HTMLElement,
  anchor: HTMLElement,
  suspended: () => boolean,
) {
  let turnIndex: number | null = null;
  let positionUser = false;
  let resetPending = false;
  const cancelFrame = () => {
    if (frame != null) cancelAnimationFrame(frame);
    frame = null;
  };
  let frame: number | null = null;
  let disposed = false;
  const rows = () => Array.from(content.querySelectorAll<HTMLElement>('[data-chat-message-index]'))
    .filter(row => turnIndex != null && Number(row.dataset.chatMessageIndex) >= turnIndex);
  const schedule = () => {
    if (disposed || (!positionUser && !resetPending) || (!resetPending && suspended()) || frame != null) return;
    // Two frames allow the native WebView to apply message and keyboard layout.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = null;
        if (disposed) return;
        if (resetPending) {
          const mounted = content.querySelectorAll<HTMLElement>('[data-chat-message-index]');
          if (mounted.length !== 1 || mounted[0].dataset.chatMessageRole !== 'assistant') return;
          anchor.style.height = '1px';
          container.scrollTop = 0;
          resetPending = false;
          mutation.disconnect();
          return;
        }
        if (!positionUser || suspended()) return;
        const active = rows();
        const user = active.find(row => Number(row.dataset.chatMessageIndex) === turnIndex && row.dataset.chatMessageRole === 'user');
        if (!user) return;
        const rootTop = container.getBoundingClientRect().top;
        const userTop = container.scrollTop + user.getBoundingClientRect().top - rootTop;
        const tail = active[active.length - 1];
        const tailBottom = container.scrollTop + tail.getBoundingClientRect().bottom - rootTop;
        const usableHeight = Math.max(0, container.clientHeight - parseFloat(getComputedStyle(container).paddingBottom || '0') - 20);
        // Keep this space stable for the turn: shrinking it during reply growth
        // can clamp scrollTop while the user is reading. Reset on the next submit.
        anchor.style.height = `${Math.max(1, usableHeight - (tailBottom - userTop))}px`;
        container.scrollTop = Math.max(0, userTop - 20);
        positionUser = false;
        mutation.disconnect();
      });
    });
  };
  // Wait only for the submitted user row to mount, not for reply updates.
  const mutation = new MutationObserver(schedule);
  const stop = () => { positionUser = false; mutation.disconnect(); };
  const wheel = (event: WheelEvent) => { if (event.deltaY !== 0) stop(); };
  let touchY = 0;
  const touchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? 0; };
  const touchMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY ?? touchY;
    if (Math.abs(y - touchY) > 4) stop();
    touchY = Math.min(touchY, y);
  };
  const key = (event: KeyboardEvent) => { if (['PageUp','PageDown','Home','End','ArrowUp','ArrowDown'].includes(event.key)) stop(); };
  container.addEventListener('wheel', wheel, {passive:true});
  container.addEventListener('touchstart', touchStart, {passive:true});
  container.addEventListener('touchmove', touchMove, {passive:true});
  container.addEventListener('keydown', key);
  return {
    begin(index: number) {
      if (turnIndex === index) return;
      cancelFrame(); resetPending = false;
      turnIndex = index; positionUser = true;
      mutation.observe(content, {childList:true, subtree:true});
      schedule();
    },
    update: schedule,
    resetToInitial() {
      cancelFrame(); stop(); turnIndex = null; resetPending = true;
      mutation.observe(content, {childList:true, subtree:true});
      schedule();
    },
    restore(top: number) { cancelFrame(); resetPending = false; stop(); turnIndex = null; anchor.style.height = '1px'; container.scrollTop = top; },
    dispose() {
      disposed = true; mutation.disconnect();
      cancelFrame();
      container.removeEventListener('wheel', wheel);
      container.removeEventListener('touchstart', touchStart);
      container.removeEventListener('touchmove', touchMove);
      container.removeEventListener('keydown', key);
      anchor.style.height = '1px';
    },
  };
}

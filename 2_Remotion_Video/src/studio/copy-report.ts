/** Clipboard API can be denied in embedded/local Chromium; keep a user-click copy fallback. */
export async function copyReport(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const previous = document.activeElement as HTMLElement | null;
    const area = document.createElement('textarea');
    area.value = text;
    area.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
    document.body.appendChild(area);
    try {
      area.focus(); area.select(); area.setSelectionRange(0,text.length);
      if (!document.execCommand('copy')) throw Error('Clipboard blocked; copy the readable Render report below.');
    } finally { area.remove(); previous?.focus(); }
  }
}

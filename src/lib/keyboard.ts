type ModEvent = {
  metaKey: boolean;
  ctrlKey: boolean;
};

export function isModKey(e: ModEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target) {
    return false;
  }

  const element =
    target instanceof HTMLElement
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;

  if (!element) {
    return false;
  }

  if (element.isContentEditable) {
    return true;
  }

  return Boolean(
    element.closest(
      "input, textarea, select, [contenteditable='true'], [role='textbox'], .cm-editor, .cm-content",
    ),
  );
}

export function shouldIgnoreGlobalShortcut(e: KeyboardEvent): boolean {
  return isEditableTarget(e.target) || isEditableTarget(document.activeElement);
}

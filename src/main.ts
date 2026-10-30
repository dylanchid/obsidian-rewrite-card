import { Editor, EditorPosition, Notice, Plugin, setIcon } from "obsidian";

const CARD_WIDTH = 440;
const CARD_GAP = 10;
const VIEWPORT_PADDING = 12;

function positionComesBefore(a: EditorPosition, b: EditorPosition): boolean {
  return a.line < b.line || (a.line === b.line && a.ch <= b.ch);
}

class RewriteCard {
  private readonly from: EditorPosition;
  private readonly to: EditorPosition;
  private readonly original: string;
  private readonly startOffset: number;
  private readonly cardEl: HTMLDivElement;
  private readonly textareaEl: HTMLTextAreaElement;
  private closed = false;

  constructor(
    private readonly editor: Editor,
    anchor: EditorPosition,
    head: EditorPosition,
    private readonly onClose: () => void,
  ) {
    [this.from, this.to] = positionComesBefore(anchor, head)
      ? [anchor, head]
      : [head, anchor];
    this.original = editor.getRange(this.from, this.to);
    this.startOffset = editor.posToOffset(this.from);

    this.cardEl = document.body.createDiv({ cls: "rewrite-card" });
    this.cardEl.setAttribute("role", "dialog");
    this.cardEl.setAttribute("aria-modal", "false");
    this.cardEl.setAttribute("aria-labelledby", "rewrite-card-title");

    const headerEl = this.cardEl.createDiv({ cls: "rewrite-card__header" });
    headerEl.createEl("span", {
      cls: "rewrite-card__eyebrow",
      text: "WORKING COPY",
    });
    const closeButton = headerEl.createEl("button", {
      cls: "rewrite-card__icon-button",
      attr: { "aria-label": "Cancel rewrite", type: "button" },
    });
    setIcon(closeButton, "x");

    this.cardEl.createEl("div", {
      cls: "rewrite-card__title",
      text: "Rewrite selection",
      attr: { id: "rewrite-card-title" },
    });

    const originalEl = this.cardEl.createEl("blockquote", {
      cls: "rewrite-card__original",
      text: this.original,
    });
    originalEl.setAttribute("aria-label", "Original selected text");

    this.textareaEl = this.cardEl.createEl("textarea", {
      cls: "rewrite-card__draft",
      attr: {
        "aria-label": "Rewrite draft",
        placeholder: "Try another version...",
        rows: "4",
        spellcheck: "true",
      },
    });
    this.textareaEl.value = this.original;

    const footerEl = this.cardEl.createDiv({ cls: "rewrite-card__footer" });
    footerEl.createEl("span", {
      cls: "rewrite-card__hint",
      text: "Original stays unchanged until you apply",
    });
    const actionsEl = footerEl.createDiv({ cls: "rewrite-card__actions" });
    const cancelButton = actionsEl.createEl("button", {
      cls: "rewrite-card__button rewrite-card__button--quiet",
      text: "Cancel",
      attr: { type: "button" },
    });
    const applyButton = actionsEl.createEl("button", {
      cls: "rewrite-card__button rewrite-card__button--apply",
      text: "Apply",
      attr: { type: "button" },
    });

    closeButton.addEventListener("click", () => this.close());
    cancelButton.addEventListener("click", () => this.close());
    applyButton.addEventListener("click", () => this.apply());
    this.cardEl.addEventListener("keydown", (event) => this.handleKeydown(event));
    window.addEventListener("resize", this.position);
    document.addEventListener("scroll", this.position, true);

    this.position();
    window.setTimeout(() => {
      this.textareaEl.focus();
      this.textareaEl.setSelectionRange(
        this.textareaEl.value.length,
        this.textareaEl.value.length,
      );
    });
  }

  private position = (): void => {
    if (this.closed) return;

    const editorView = (this.editor as Editor & {
      cm?: { coordsAtPos?: (offset: number) => DOMRect | null };
    }).cm;
    const anchorOffset = this.editor.posToOffset(this.to);
    const coordinates = editorView?.coordsAtPos?.(anchorOffset);

    const naturalLeft = coordinates?.left ?? (window.innerWidth - CARD_WIDTH) / 2;
    const left = Math.max(
      VIEWPORT_PADDING,
      Math.min(naturalLeft, window.innerWidth - CARD_WIDTH - VIEWPORT_PADDING),
    );

    this.cardEl.style.left = `${left}px`;
    this.cardEl.style.top = `${(coordinates?.bottom ?? 80) + CARD_GAP}px`;

    const cardRect = this.cardEl.getBoundingClientRect();
    if (cardRect.bottom > window.innerHeight - VIEWPORT_PADDING && coordinates) {
      const top = Math.max(
        VIEWPORT_PADDING,
        coordinates.top - cardRect.height - CARD_GAP,
      );
      this.cardEl.style.top = `${top}px`;
      this.cardEl.addClass("rewrite-card--above");
    } else {
      this.cardEl.removeClass("rewrite-card--above");
    }
  };

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.apply();
    }
  }

  private apply(): void {
    if (this.editor.getRange(this.from, this.to) !== this.original) {
      new Notice("The selected text changed. Reopen Rewrite Card to avoid replacing newer edits.");
      return;
    }

    const rewrite = this.textareaEl.value;
    this.editor.replaceRange(rewrite, this.from, this.to);
    const newEnd = this.editor.offsetToPos(this.startOffset + rewrite.length);
    this.close(false);
    this.editor.setCursor(newEnd);
    this.editor.focus();
  }

  close(restoreFocus = true): void {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener("resize", this.position);
    document.removeEventListener("scroll", this.position, true);
    this.cardEl.remove();
    this.onClose();

    if (restoreFocus) {
      this.editor.focus();
      this.editor.setSelection(this.from, this.to);
    }
  }
}

export default class RewriteCardPlugin extends Plugin {
  private activeCard: RewriteCard | null = null;

  onload(): void {
    this.addCommand({
      id: "open-rewrite-card",
      name: "Rewrite selected text in card",
      icon: "sticky-note",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "/" }],
      editorCheckCallback: (checking, editor) => {
        const selection = editor.listSelections()[0];
        const hasSelection = Boolean(selection && editor.getSelection());
        if (!hasSelection) return false;

        if (!checking && selection) {
          this.activeCard?.close(false);
          this.activeCard = new RewriteCard(
            editor,
            selection.anchor,
            selection.head,
            () => { this.activeCard = null; },
          );
        }
        return true;
      },
    });
  }

  onunload(): void {
    this.activeCard?.close(false);
    this.activeCard = null;
  }
}

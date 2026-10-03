import { strings } from "./strings";

/** The avatar's reply as it streams in. */
export interface AssistantBubble {
  append(text: string): void;
  set(text: string): void;
  /** Adds a muted remark after the text, e.g. "(keskeytetty)". */
  note(text: string): void;
  error(text: string): void;
}

export class ChatLog {
  constructor(private readonly el: HTMLElement) {}

  clear(): void {
    this.el.replaceChildren();
  }

  addUser(text: string): void {
    this.add("user", strings.you).textContent = text;
  }

  addAssistant(): AssistantBubble {
    const body = this.add("assistant", strings.avatar);
    const textEl = document.createElement("span");
    body.append(textEl);
    body.classList.add("pending");

    const update = (mutate: () => void) => {
      const pinned = this.isPinnedToBottom();
      mutate();
      body.classList.toggle("pending", !textEl.textContent && body.childElementCount === 1);
      if (pinned) this.scrollToBottom();
    };
    const addRemark = (className: string, text: string) => {
      const remark = document.createElement("span");
      remark.className = className;
      remark.textContent = text;
      body.append(remark);
    };

    return {
      append: (text) => update(() => textEl.append(text)),
      set: (text) => update(() => (textEl.textContent = text)),
      note: (text) => update(() => addRemark("remark", text)),
      error: (text) => update(() => addRemark("remark error", text)),
    };
  }

  private add(kind: "user" | "assistant", who: string): HTMLElement {
    const msg = document.createElement("div");
    msg.className = `msg ${kind}`;
    const whoEl = document.createElement("div");
    whoEl.className = "who";
    whoEl.textContent = who;
    const body = document.createElement("div");
    body.className = "body";
    msg.append(whoEl, body);
    this.el.append(msg);
    this.scrollToBottom();
    return body;
  }

  private isPinnedToBottom(): boolean {
    return this.el.scrollHeight - this.el.scrollTop - this.el.clientHeight < 40;
  }

  private scrollToBottom(): void {
    this.el.scrollTop = this.el.scrollHeight;
  }
}

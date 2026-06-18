export type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  id: number;
  level: LogLevel;
  message: string;
}

export interface LogViewOptions {
  listEl: HTMLElement;
  measurerEl: HTMLElement;
  pageLabelEl: HTMLElement;
  prevBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  filterButtons: HTMLButtonElement[];
}

export class LogView {
  private readonly listEl: HTMLElement;
  private readonly measurerEl: HTMLElement;
  private readonly pageLabelEl: HTMLElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly enabledLevels = new Set<LogLevel>(['info', 'warn', 'error']);

  private entries: LogEntry[] = [];
  private nextId = 0;
  private pageIndex = 0;
  private pageStarts: number[] = [0, 0];
  private layoutScheduled = false;

  constructor(options: LogViewOptions) {
    this.listEl = options.listEl;
    this.measurerEl = options.measurerEl;
    this.pageLabelEl = options.pageLabelEl;
    this.prevBtn = options.prevBtn;
    this.nextBtn = options.nextBtn;

    for (const btn of options.filterButtons) {
      const level = btn.dataset.level as LogLevel | undefined;
      if (!level) continue;
      btn.addEventListener('click', () => {
        if (this.enabledLevels.has(level)) {
          this.enabledLevels.delete(level);
          btn.classList.remove('active');
        } else {
          this.enabledLevels.add(level);
          btn.classList.add('active');
        }
        this.pageIndex = 0;
        this.scheduleLayout();
      });
    }

    this.prevBtn.addEventListener('click', () => {
      if (this.pageIndex > 0) {
        this.pageIndex -= 1;
        this.render();
      }
    });

    this.nextBtn.addEventListener('click', () => {
      if (this.pageIndex < this.pageCount - 1) {
        this.pageIndex += 1;
        this.render();
      }
    });

    const observer = new ResizeObserver(() => this.scheduleLayout());
    observer.observe(this.listEl);

    this.scheduleLayout();
  }

  append(message: string, level: LogLevel = 'info'): void {
    const stayOnLatest = this.pageIndex === 0;
    this.entries.push({ id: this.nextId++, level, message });
    if (stayOnLatest) this.pageIndex = 0;
    this.scheduleLayout();
  }

  relayout(): void {
    this.scheduleLayout();
  }

  private get pageCount(): number {
    return Math.max(1, this.pageStarts.length - 1);
  }

  private filteredNewestFirst(): LogEntry[] {
    return this.entries
      .filter((entry) => this.enabledLevels.has(entry.level))
      .slice()
      .reverse();
  }

  private scheduleLayout(): void {
    if (this.layoutScheduled) return;
    this.layoutScheduled = true;
    requestAnimationFrame(() => {
      this.layoutScheduled = false;
      this.recomputePages();
      this.render();
    });
  }

  private recomputePages(): void {
    const entries = this.filteredNewestFirst();
    const styles = getComputedStyle(this.listEl);
    const padY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
    const maxHeight = this.listEl.clientHeight - padY;

    if (entries.length === 0 || maxHeight <= 0) {
      this.pageStarts = [0, 0];
      this.pageIndex = 0;
      return;
    }

    this.measurerEl.style.width = `${this.listEl.clientWidth}px`;
    this.measurerEl.innerHTML = '';

    const starts = [0];
    let pageStart = 0;
    let pageHeight = 0;

    for (let i = 0; i < entries.length; i += 1) {
      const lineEl = this.createLineElement(entries[i]);
      this.measurerEl.appendChild(lineEl);
      const lineHeight = lineEl.getBoundingClientRect().height;

      if (pageHeight + lineHeight > maxHeight && i > pageStart) {
        starts.push(i);
        pageStart = i;
        pageHeight = lineHeight;
      } else {
        pageHeight += lineHeight;
      }
    }

    starts.push(entries.length);
    this.pageStarts = starts;

    if (this.pageIndex >= starts.length - 1) {
      this.pageIndex = Math.max(0, starts.length - 2);
    }
  }

  private render(): void {
    const entries = this.filteredNewestFirst();
    const start = this.pageStarts[this.pageIndex] ?? 0;
    const end = this.pageStarts[this.pageIndex + 1] ?? entries.length;

    this.listEl.replaceChildren();
    for (const entry of entries.slice(start, end)) {
      this.listEl.appendChild(this.createLineElement(entry));
    }

    const total = this.pageCount;
    const current = entries.length === 0 ? 0 : this.pageIndex + 1;
    this.pageLabelEl.textContent =
      entries.length === 0 ? 'No logs' : `${current} / ${total}`;

    this.prevBtn.disabled = this.pageIndex <= 0;
    this.nextBtn.disabled = this.pageIndex >= total - 1 || entries.length === 0;
  }

  private createLineElement(entry: LogEntry): HTMLDivElement {
    const line = document.createElement('div');
    line.className = 'log-line';

    const badge = document.createElement('span');
    badge.className = `badge ${entry.level === 'info' ? 'ok' : entry.level === 'warn' ? 'warn' : 'err'}`;
    badge.textContent = entry.level.toUpperCase();
    line.appendChild(badge);
    line.appendChild(document.createTextNode(entry.message));
    return line;
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTooltipLeakFix } from './tooltipLeakFix';

type Listener = EventListenerOrEventListenerObject;

class FakeElement {
  parentElement: FakeElement | null = null;
  isConnected = true;
  className = '';
  textContent = '';
  style: Record<string, string> = {};
  private readonly attributes = new Map<string, string>();

  constructor(title?: string, parentElement?: FakeElement) {
    if (title !== undefined) this.attributes.set('title', title);
    this.parentElement = parentElement ?? null;
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string) {
    return this.attributes.has(name);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  getBoundingClientRect() {
    return { width: 100, height: 20 };
  }

  remove() {
    tips.splice(tips.indexOf(this), 1);
  }
}

/** Tooltips currently in the fake document body. */
let tips: FakeElement[] = [];

function eventSource() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener(type: string, listener: Listener) {
      const group = listeners.get(type) ?? new Set<Listener>();
      group.add(listener);
      listeners.set(type, group);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type: string, init: Record<string, unknown> = {}) {
      const event = { pointerType: 'mouse', target: null, ...init } as unknown as Event;
      for (const listener of listeners.get(type) ?? []) {
        if (typeof listener === 'function') listener(event);
        else listener.handleEvent(event);
      }
    },
  };
}

function browser() {
  const documentEvents = eventSource();
  const windowEvents = eventSource();
  tips = [];

  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('document', {
    ...documentEvents,
    createElement: () => new FakeElement(),
    body: { appendChild: (element: FakeElement) => tips.push(element) },
  });
  vi.stubGlobal('window', { ...windowEvents, innerWidth: 1000, innerHeight: 800 });

  return { documentEvents, windowEvents };
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('native tooltip leak fix', () => {
  it('takes the titles off the hovered chain and puts them back on leave', () => {
    const { documentEvents } = browser();
    const parent = new FakeElement('Parent tooltip');
    const child = new FakeElement('Child tooltip', parent);
    const elsewhere = new FakeElement();
    const uninstall = installTooltipLeakFix();

    documentEvents.emit('pointerover', { target: child });
    expect(child.getAttribute('title')).toBeNull();
    expect(parent.getAttribute('title')).toBeNull();

    documentEvents.emit('pointerover', { target: elsewhere });
    expect(child.getAttribute('title')).toBe('Child tooltip');
    expect(parent.getAttribute('title')).toBe('Parent tooltip');

    uninstall();
  });

  it('shows the nearest title after a delay, at the cursor, and hides it on leave', () => {
    const { documentEvents } = browser();
    const parent = new FakeElement('Parent tooltip');
    const child = new FakeElement('Child tooltip', parent);
    const uninstall = installTooltipLeakFix();

    documentEvents.emit('pointermove', { clientX: 40, clientY: 50 });
    documentEvents.emit('pointerover', { target: child });
    expect(tips).toHaveLength(0);

    vi.advanceTimersByTime(600);
    expect(tips).toHaveLength(1);
    expect(tips[0].textContent).toBe('Child tooltip');
    expect(tips[0].style).toEqual({ left: '40px', top: '68px' });

    documentEvents.emit('pointerover', { target: parent });
    expect(tips).toHaveLength(0);
    vi.advanceTimersByTime(600);
    expect(tips[0].textContent).toBe('Parent tooltip');

    documentEvents.emit('pointerout', { target: parent, relatedTarget: null });
    expect(tips).toHaveLength(0);
    expect(parent.getAttribute('title')).toBe('Parent tooltip');

    uninstall();
  });

  it('keeps the tooltip inside the viewport', () => {
    const { documentEvents } = browser();
    const element = new FakeElement('Tooltip');
    const uninstall = installTooltipLeakFix();

    documentEvents.emit('pointermove', { clientX: 990, clientY: 790 });
    documentEvents.emit('pointerover', { target: element });
    vi.advanceTimersByTime(600);
    expect(tips[0].style).toEqual({ left: '894px', top: '762px' });

    uninstall();
  });

  it('dismisses on click, key, scroll and blur without restoring the title under the cursor', () => {
    const { documentEvents, windowEvents } = browser();
    const element = new FakeElement('Tooltip');
    const uninstall = installTooltipLeakFix();

    for (const dismiss of [
      () => documentEvents.emit('pointerdown'),
      () => documentEvents.emit('keydown'),
      () => documentEvents.emit('scroll'),
      () => windowEvents.emit('blur'),
    ]) {
      documentEvents.emit('pointerover', { target: new FakeElement() });
      documentEvents.emit('pointerover', { target: element });
      vi.advanceTimersByTime(600);
      expect(tips).toHaveLength(1);

      dismiss();
      expect(tips).toHaveLength(0);
      expect(element.getAttribute('title')).toBeNull();
    }

    // A pending tooltip is cancelled too.
    documentEvents.emit('pointerover', { target: new FakeElement() });
    documentEvents.emit('pointerover', { target: element });
    documentEvents.emit('pointerdown');
    vi.advanceTimersByTime(600);
    expect(tips).toHaveLength(0);

    uninstall();
  });

  it('closes once the cursor moves away from where it appeared, until another element is hovered', () => {
    const { documentEvents } = browser();
    const element = new FakeElement('Tooltip');
    const uninstall = installTooltipLeakFix();

    documentEvents.emit('pointermove', { clientX: 40, clientY: 50 });
    documentEvents.emit('pointerover', { target: element });
    vi.advanceTimersByTime(600);
    documentEvents.emit('pointermove', { clientX: 43, clientY: 52 });
    expect(tips).toHaveLength(1);

    documentEvents.emit('pointermove', { clientX: 60, clientY: 50 });
    expect(tips).toHaveLength(0);
    documentEvents.emit('pointerover', { target: element });
    vi.advanceTimersByTime(600);
    expect(tips).toHaveLength(0);

    uninstall();
  });

  it('ignores touch and pen pointers', () => {
    const { documentEvents } = browser();
    const element = new FakeElement('Tooltip');
    const uninstall = installTooltipLeakFix();

    documentEvents.emit('pointerover', { target: element, pointerType: 'touch' });
    vi.advanceTimersByTime(600);
    expect(tips).toHaveLength(0);
    expect(element.getAttribute('title')).toBe('Tooltip');

    uninstall();
  });

  it('does not overwrite a title set while the element was hovered', () => {
    const { documentEvents } = browser();
    const element = new FakeElement('Original tooltip');
    const uninstall = installTooltipLeakFix();

    documentEvents.emit('pointerover', { target: element });
    element.setAttribute('title', 'Updated while hovered');
    uninstall();

    expect(element.getAttribute('title')).toBe('Updated while hovered');
  });

  it('restores held titles and removes every listener when uninstalled', () => {
    const { documentEvents } = browser();
    const element = new FakeElement('Tooltip');
    const uninstall = installTooltipLeakFix();

    documentEvents.emit('pointerover', { target: element });
    vi.advanceTimersByTime(600);
    expect(element.getAttribute('title')).toBeNull();

    uninstall();
    expect(element.getAttribute('title')).toBe('Tooltip');
    expect(tips).toHaveLength(0);

    documentEvents.emit('pointerover', { target: element });
    expect(element.getAttribute('title')).toBe('Tooltip');
  });
});

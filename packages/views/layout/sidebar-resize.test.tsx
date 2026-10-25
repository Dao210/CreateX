import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Sidebar,
  SidebarProvider,
  SidebarRail,
  useSidebar,
} from "@auro/ui/components/ui/sidebar";
import { renderWithI18n } from "../test/i18n";

describe("left sidebar resizing", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-sidebar-resizing");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("previews width directly and commits only when the pointer is released", () => {
    const stableConsumerRender = vi.fn();

    function StableSidebarConsumer() {
      useSidebar();
      stableConsumerRender();
      return null;
    }

    const { container } = renderWithI18n(
      <SidebarProvider>
        <Sidebar>
          <StableSidebarConsumer />
          <SidebarRail />
        </Sidebar>
        <div data-sidebar-resize-consumer />
      </SidebarProvider>,
    );

    const wrapper = container.querySelector<HTMLElement>("[data-slot='sidebar-wrapper']")!;
    const sidebarContainer = container.querySelector<HTMLElement>("[data-slot='sidebar-container']")!;
    const sidebarGap = container.querySelector<HTMLElement>("[data-slot='sidebar-gap']")!;
    const sidebar = container.querySelector<HTMLElement>("[data-slot='sidebar']")!;
    const liveWidthConsumer = container.querySelector<HTMLElement>(
      "[data-sidebar-resize-consumer]",
    )!;
    const rail = container.querySelector<HTMLButtonElement>("[data-slot='sidebar-rail']")!;
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    rail.setPointerCapture = setPointerCapture;
    rail.hasPointerCapture = vi.fn(() => true);
    rail.releasePointerCapture = releasePointerCapture;

    vi.spyOn(sidebarContainer, "getBoundingClientRect").mockReturnValue({
      bottom: 0,
      height: 0,
      left: 0,
      right: 256,
      top: 0,
      width: 256,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(rail, {
      button: 0,
      clientX: 256,
      isPrimary: true,
      pointerId: 7,
    });

    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(rail).toHaveClass("cursor-ew-resize");
    expect(wrapper).toHaveAttribute("data-sidebar-resizing", "true");
    expect(document.documentElement).toHaveAttribute("data-sidebar-resizing", "true");

    fireEvent.pointerMove(document, { buttons: 1, clientX: 280, pointerId: 7 });
    fireEvent.pointerMove(document, { buttons: 1, clientX: 300, pointerId: 7 });

    expect(sidebarGap.style.width).toBe("300px");
    expect(sidebarContainer.style.width).toBe("300px");
    expect(
      liveWidthConsumer.style.getPropertyValue("--sidebar-live-width"),
    ).toBe("300px");
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("256px");
    expect(localStorage.getItem("sidebar_width")).toBeNull();
    expect(stableConsumerRender).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(document, { pointerId: 7 });

    expect(sidebarGap.style.width).toBe("");
    expect(sidebarContainer.style.width).toBe("");
    expect(
      liveWidthConsumer.style.getPropertyValue("--sidebar-live-width"),
    ).toBe("");
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("300px");
    expect(localStorage.getItem("sidebar_width")).toBe("300");
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(wrapper).not.toHaveAttribute("data-sidebar-resizing");
    expect(document.documentElement).not.toHaveAttribute("data-sidebar-resizing");
    expect(stableConsumerRender).toHaveBeenCalledTimes(1);

    fireEvent.click(rail);
    expect(sidebar).toHaveAttribute("data-state", "expanded");
  });

  it("restores the committed width and cursor state when pointer capture is cancelled", () => {
    const { container } = renderWithI18n(
      <SidebarProvider>
        <Sidebar>
          <SidebarRail />
        </Sidebar>
        <div data-sidebar-resize-consumer />
      </SidebarProvider>,
    );

    const wrapper = container.querySelector<HTMLElement>("[data-slot='sidebar-wrapper']")!;
    const sidebarContainer = container.querySelector<HTMLElement>("[data-slot='sidebar-container']")!;
    const sidebarGap = container.querySelector<HTMLElement>("[data-slot='sidebar-gap']")!;
    const liveWidthConsumer = container.querySelector<HTMLElement>(
      "[data-sidebar-resize-consumer]",
    )!;
    const rail = container.querySelector<HTMLButtonElement>("[data-slot='sidebar-rail']")!;
    rail.setPointerCapture = vi.fn();
    rail.hasPointerCapture = vi.fn(() => true);
    rail.releasePointerCapture = vi.fn();

    vi.spyOn(sidebarContainer, "getBoundingClientRect").mockReturnValue({
      bottom: 0,
      height: 0,
      left: 0,
      right: 256,
      top: 0,
      width: 256,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(rail, {
      button: 0,
      clientX: 256,
      isPrimary: true,
      pointerId: 8,
    });
    fireEvent.pointerMove(document, { buttons: 1, clientX: 320, pointerId: 8 });
    expect(
      liveWidthConsumer.style.getPropertyValue("--sidebar-live-width"),
    ).toBe("320px");
    fireEvent.pointerCancel(document, { pointerId: 8 });

    expect(sidebarGap.style.width).toBe("");
    expect(sidebarContainer.style.width).toBe("");
    expect(
      liveWidthConsumer.style.getPropertyValue("--sidebar-live-width"),
    ).toBe("");
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("256px");
    expect(localStorage.getItem("sidebar_width")).toBeNull();
    expect(wrapper).not.toHaveAttribute("data-sidebar-resizing");
    expect(document.documentElement).not.toHaveAttribute("data-sidebar-resizing");
  });

  it("collapses into the icon rail when an expanded drag is released below the threshold", () => {
    const { container } = renderWithI18n(
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>,
    );

    const wrapper = container.querySelector<HTMLElement>("[data-slot='sidebar-wrapper']")!;
    const sidebarContainer = container.querySelector<HTMLElement>("[data-slot='sidebar-container']")!;
    const sidebar = container.querySelector<HTMLElement>("[data-slot='sidebar']")!;
    const rail = container.querySelector<HTMLButtonElement>("[data-slot='sidebar-rail']")!;
    rail.setPointerCapture = vi.fn();
    rail.hasPointerCapture = vi.fn(() => true);
    rail.releasePointerCapture = vi.fn();

    vi.spyOn(sidebarContainer, "getBoundingClientRect").mockReturnValue({
      bottom: 0,
      height: 0,
      left: 0,
      right: 256,
      top: 0,
      width: 256,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(rail, {
      button: 0,
      clientX: 256,
      isPrimary: true,
      pointerId: 9,
    });
    fireEvent.pointerMove(document, { buttons: 1, clientX: 120, pointerId: 9 });
    fireEvent.pointerUp(document, { pointerId: 9 });

    expect(sidebar).toHaveAttribute("data-state", "collapsed");
    expect(sidebar).toHaveAttribute("data-collapsible", "icon");
    // The expanded width survives the collapse so expanding restores it.
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("256px");
    expect(localStorage.getItem("sidebar_width")).toBeNull();
  });

  it("expands out of the icon rail when dragged past the expand threshold", () => {
    const { container } = renderWithI18n(
      <SidebarProvider defaultOpen={false}>
        <Sidebar collapsible="icon">
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>,
    );

    const wrapper = container.querySelector<HTMLElement>("[data-slot='sidebar-wrapper']")!;
    const sidebar = container.querySelector<HTMLElement>("[data-slot='sidebar']")!;
    const rail = container.querySelector<HTMLButtonElement>("[data-slot='sidebar-rail']")!;
    rail.setPointerCapture = vi.fn();
    rail.hasPointerCapture = vi.fn(() => true);
    rail.releasePointerCapture = vi.fn();

    expect(sidebar).toHaveAttribute("data-state", "collapsed");

    fireEvent.pointerDown(rail, {
      button: 0,
      clientX: 0,
      isPrimary: true,
      pointerId: 10,
    });
    fireEvent.pointerMove(document, { buttons: 1, clientX: 60, pointerId: 10 });
    fireEvent.pointerUp(document, { pointerId: 10 });

    expect(sidebar).toHaveAttribute("data-state", "expanded");
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("200px");
    expect(localStorage.getItem("sidebar_width")).toBe("200");
  });
});

import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import { StepWelcome } from "./step-welcome";

describe("StepWelcome", () => {
 it("continues through the primary action", () => {
  const onNext=vi.fn();renderWithI18n(<StepWelcome onNext={onNext} />);
  fireEvent.click(screen.getByRole("button"));expect(onNext).toHaveBeenCalledOnce();
 });
});

import { describe, expect, test } from "vitest";
import { EXPERIENCE_STYLES } from "../../src/remote/web-dashboard-experience-styles.js";
import { DEVICE_WIZARD_STYLES } from "../../src/remote/web-dashboard-device-wizard-styles.js";

describe("device wizard stylesheet composition", () => {
  test("keeps the complete wizard stylesheet once and in its original cascade position", () => {
    expect(DEVICE_WIZARD_STYLES).toContain(".device-wizard {");
    expect(DEVICE_WIZARD_STYLES).toContain(".wizard-stepper {");
    expect(DEVICE_WIZARD_STYLES).toContain(".wizard-footer-link a:hover {");
    expect(EXPERIENCE_STYLES.split(DEVICE_WIZARD_STYLES)).toHaveLength(2);
    const start = EXPERIENCE_STYLES.indexOf(DEVICE_WIZARD_STYLES);
    expect(start).toBeGreaterThan(EXPERIENCE_STYLES.indexOf(".barchart-label {"));
    expect(start + DEVICE_WIZARD_STYLES.length).toBe(
      EXPERIENCE_STYLES.indexOf("/* Product stage & terminal preview */"),
    );
    expect(EXPERIENCE_STYLES.indexOf("@media(max-width:640px)")).toBeGreaterThan(start);
  });
});

import { describe, it, expect } from "vitest";
import { createParameterService, DEFAULT_PARAMETERS } from "../design";

describe("Parameter Service", () => {
  it("returns default parameters", async () => {
    const service = createParameterService();
    const params = await service.getParameters();
    expect(params.version).toBe(DEFAULT_PARAMETERS.version);
    expect(params.tax.defaultTaxRate).toBeDefined();
  });
});

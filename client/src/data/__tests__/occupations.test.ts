import { describe, it, expect } from "vitest";
import { OCCUPATION_CATEGORIES, searchOccupations } from "../occupations";

describe("occupations", () => {
  describe("OCCUPATION_CATEGORIES", () => {
    it("should have all required categories", () => {
      const categoryNames = OCCUPATION_CATEGORIES.map((cat) => cat.name);

      expect(categoryNames).toContain("Technology");
      expect(categoryNames).toContain("Healthcare");
      expect(categoryNames).toContain("Business & Finance");
      expect(categoryNames).toContain("Education");
    });

    it("should have icons for all categories", () => {
      OCCUPATION_CATEGORIES.forEach((category) => {
        expect(category.icon).toBeDefined();
        expect(category.icon.length).toBeGreaterThan(0);
      });
    });

    it("should have occupations in each category", () => {
      OCCUPATION_CATEGORIES.forEach((category) => {
        expect(category.occupations).toBeDefined();
        expect(category.occupations.length).toBeGreaterThan(0);
      });
    });

    it("should include Clinical Informatics Specialist in Technology category", () => {
      const techCategory = OCCUPATION_CATEGORIES.find(
        (cat) => cat.name === "Technology"
      );
      expect(techCategory).toBeDefined();
      expect(techCategory!.occupations).toContain(
        "Clinical Informatics Specialist"
      );
    });

    it("should have comprehensive technology roles", () => {
      const techCategory = OCCUPATION_CATEGORIES.find(
        (cat) => cat.name === "Technology"
      );
      expect(techCategory).toBeDefined();

      const techOccupations = techCategory!.occupations;
      expect(techOccupations).toContain("Software Developer");
      expect(techOccupations).toContain("Data Scientist");
      expect(techOccupations).toContain("DevOps Engineer");
      expect(techOccupations).toContain("Product Manager (Tech)");
    });

    it("should have healthcare roles", () => {
      const healthcareCategory = OCCUPATION_CATEGORIES.find(
        (cat) => cat.name === "Healthcare"
      );
      expect(healthcareCategory).toBeDefined();

      const healthcareOccupations = healthcareCategory!.occupations;
      expect(healthcareOccupations).toContain("Doctor");
      expect(healthcareOccupations).toContain("Nurse");
      expect(healthcareOccupations).toContain("Clinical Officer");
    });

    it("should have at least 250 total occupations", () => {
      const totalOccupations = OCCUPATION_CATEGORIES.reduce(
        (total, category) => total + category.occupations.length,
        0
      );
      expect(totalOccupations).toBeGreaterThanOrEqual(250);
    });
  });

  describe("searchOccupations", () => {
    it("should return all occupations when query is empty", () => {
      const results = searchOccupations("");
      const totalOccupations = OCCUPATION_CATEGORIES.reduce(
        (total, category) => total + category.occupations.length,
        0
      );
      expect(results.length).toBe(totalOccupations);
    });

    it('should find developer roles when searching for "dev"', () => {
      const results = searchOccupations("dev");

      expect(
        results.some((result) =>
          result.occupation.toLowerCase().includes("developer")
        )
      ).toBe(true);

      expect(
        results.some((result) =>
          result.occupation.toLowerCase().includes("devops")
        )
      ).toBe(true);
    });

    it('should find Clinical Informatics Specialist when searching for "clinical"', () => {
      const results = searchOccupations("clinical");

      expect(
        results.some(
          (result) => result.occupation === "Clinical Informatics Specialist"
        )
      ).toBe(true);

      expect(
        results.some((result) => result.occupation === "Clinical Officer")
      ).toBe(true);
    });

    it("should be case insensitive", () => {
      const lowerResults = searchOccupations("software");
      const upperResults = searchOccupations("SOFTWARE");
      const mixedResults = searchOccupations("SoftWare");

      expect(lowerResults.length).toBe(upperResults.length);
      expect(lowerResults.length).toBe(mixedResults.length);
      expect(lowerResults.length).toBeGreaterThan(0);
    });

    it("should search across all categories", () => {
      const results = searchOccupations("manager");

      // Should find managers in different categories
      const categories = [...new Set(results.map((r) => r.category))];
      expect(categories.length).toBeGreaterThan(1);
    });

    it("should return empty array for non-existent occupations", () => {
      const results = searchOccupations("xyz123nonexistent");
      expect(results).toEqual([]);
    });

    it("should handle partial matches", () => {
      const results = searchOccupations("eng");

      expect(
        results.some((result) =>
          result.occupation.toLowerCase().includes("engineer")
        )
      ).toBe(true);
    });

    it("should return results with correct structure", () => {
      const results = searchOccupations("software");

      expect(results.length).toBeGreaterThan(0);
      results.forEach((result) => {
        expect(result).toHaveProperty("occupation");
        expect(result).toHaveProperty("category");
        expect(result).toHaveProperty("icon");
        expect(typeof result.occupation).toBe("string");
        expect(typeof result.category).toBe("string");
        expect(typeof result.icon).toBe("string");
      });
    });

    it("should find occupations by category name", () => {
      const results = searchOccupations("technology");

      expect(results.length).toBeGreaterThan(0);
      expect(results.every((result) => result.category === "Technology")).toBe(
        true
      );
    });

    it("should handle special characters in search", () => {
      // Should not crash with special regex characters
      expect(() => searchOccupations("()")).not.toThrow();
      expect(() => searchOccupations("[]")).not.toThrow();
      expect(() => searchOccupations(".*")).not.toThrow();
    });

    it("should limit results appropriately", () => {
      const results = searchOccupations("a"); // Very broad search

      // Should return results but not be overwhelming
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThan(1000); // Reasonable upper limit
    });
  });

  describe("data quality", () => {
    it("should not have duplicate occupations within categories", () => {
      OCCUPATION_CATEGORIES.forEach((category) => {
        const occupations = category.occupations;
        const uniqueOccupations = [...new Set(occupations)];
        expect(occupations.length).toBe(uniqueOccupations.length);
      });
    });

    it("should not have duplicate occupations across categories", () => {
      const allOccupations: string[] = [];
      OCCUPATION_CATEGORIES.forEach((category) => {
        allOccupations.push(...category.occupations);
      });

      const uniqueOccupations = [...new Set(allOccupations)];
      expect(allOccupations.length).toBe(uniqueOccupations.length);
    });

    it("should have properly formatted occupation names", () => {
      OCCUPATION_CATEGORIES.forEach((category) => {
        category.occupations.forEach((occupation) => {
          // Should not be empty
          expect(occupation.trim().length).toBeGreaterThan(0);

          // Should not have excessive whitespace
          expect(occupation).toBe(occupation.trim());

          // Should start with capital letter
          expect(occupation[0]).toBe(occupation[0].toUpperCase());
        });
      });
    });

    it("should have reasonable category sizes", () => {
      OCCUPATION_CATEGORIES.forEach((category) => {
        // Each category should have a reasonable number of occupations
        expect(category.occupations.length).toBeGreaterThan(5);
        expect(category.occupations.length).toBeLessThan(100);
      });
    });
  });
});

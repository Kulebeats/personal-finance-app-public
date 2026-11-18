export interface SalaryRange {
  value: string;
  label: string;
  min: number;
  max: number | null;
}

export const SALARY_RANGES: SalaryRange[] = [
  { value: "0-5000", label: "Under K5,000", min: 0, max: 5000 },
  { value: "5000-10000", label: "K5,000 - K10,000", min: 5000, max: 10000 },
  { value: "10000-20000", label: "K10,000 - K20,000", min: 10000, max: 20000 },
  { value: "20000-50000", label: "K20,000 - K50,000", min: 20000, max: 50000 },
  {
    value: "50000-100000",
    label: "K50,000 - K100,000",
    min: 50000,
    max: 100000,
  },
  { value: "100000+", label: "Over K100,000", min: 100000, max: null },
];

export interface HouseholdData {
  household: {
    id: string;
    name: string;
    currency: string;
    fiscalYearStartMonth: number;
  };
  preferences: unknown;
}

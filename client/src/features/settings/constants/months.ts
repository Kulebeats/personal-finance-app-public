export interface MonthOption {
  value: string;
  label: string;
  shortLabel: string;
}

export const MONTHS: MonthOption[] = [
  { value: '01', label: 'January', shortLabel: 'Jan' },
  { value: '02', label: 'February', shortLabel: 'Feb' },
  { value: '03', label: 'March', shortLabel: 'Mar' },
  { value: '04', label: 'April', shortLabel: 'Apr' },
  { value: '05', label: 'May', shortLabel: 'May' },
  { value: '06', label: 'June', shortLabel: 'Jun' },
  { value: '07', label: 'July', shortLabel: 'Jul' },
  { value: '08', label: 'August', shortLabel: 'Aug' },
  { value: '09', label: 'September', shortLabel: 'Sep' },
  { value: '10', label: 'October', shortLabel: 'Oct' },
  { value: '11', label: 'November', shortLabel: 'Nov' },
  { value: '12', label: 'December', shortLabel: 'Dec' },
];

export const getMonthLabel = (value: string): string => {
  const month = MONTHS.find(m => m.value === value);
  return month?.label ?? '';
};

export const getMonthShortLabel = (value: string): string => {
  const month = MONTHS.find(m => m.value === value);
  return month?.shortLabel ?? '';
};
